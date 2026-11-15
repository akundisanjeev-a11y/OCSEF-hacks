"""Load the saved checkpoint and local history once; never train or call GFW here."""

import hashlib
import json
from pathlib import Path

import joblib
import numpy as np
import pandas as pd

from training.activity_forecast.common import FEATURES
from training.activity_forecast.improve import predict_improved_location
from training.activity_forecast.prepare import cell_for


class ActivityForecaster:
    def __init__(self, model_path: Path, processed_dir: Path):
        model_path, processed_dir = Path(model_path), Path(processed_dir)
        self.model_sha256 = hashlib.sha256(model_path.read_bytes()).hexdigest()
        # Only load the team's trusted, server-configured joblib artifact.
        self.bundle = joblib.load(model_path)
        if self.bundle.get("schema_version") != 2 or self.bundle.get("feature_names") != FEATURES:
            raise ValueError("The API requires the saved seasonal forecast bundle")
        expected = self.bundle["data_metadata"]
        self.grid = expected["grid_degrees"]
        self.lag = expected["availability_lag_days"]
        if self.grid <= 0 or 180 % self.grid or self.lag < 0:
            raise ValueError("Invalid forecast grid or publishing lag")

        def read_block(directory):
            metadata = json.loads((directory / "metadata.json").read_text())
            if any(metadata[key] != expected[key] for key in ("dataset", "grid_degrees")):
                raise ValueError("Forecast history source/grid differs from the checkpoint")
            if metadata.get("availability_lag_days", self.lag) != self.lag:
                raise ValueError("Forecast history publishing lag differs from the checkpoint")
            return pd.read_csv(directory / "daily_world.csv", parse_dates=["date"])

        daily = [read_block(processed_dir)]
        if (processed_dir / "fresh_test/daily_world.csv").is_file():
            daily.append(read_block(processed_dir / "fresh_test"))
        self.daily = self._validate_history(pd.concat(daily, ignore_index=True))
        annual = [read_block(processed_dir / "seasonal_history")]
        if (processed_dir / "inference_reference/daily_world.csv").is_file():
            annual.append(read_block(processed_dir / "inference_reference"))
        self.annual = self._validate_history(pd.concat(annual, ignore_index=True))
        self.cutoff = self.daily.date.max()
        issue = self.cutoff + pd.Timedelta(days=self.lag)
        if issue <= pd.Timestamp(self.bundle["trained_label_available_through"]):
            raise ValueError("No forecast period after availability of the checkpoint's training labels")
        self.period = {
            "data_mode": "historical_demo",
            "observation_cutoff": self.cutoff.date().isoformat(),
            "simulated_issue_date": issue.date().isoformat(),
            "target_start": (issue + pd.Timedelta(days=1)).date().isoformat(),
            "target_end": (issue + pd.Timedelta(days=7)).date().isoformat(),
        }
        self.evaluation = None
        metadata_path = model_path.with_name(model_path.stem + "_metadata.json")
        if metadata_path.is_file():
            saved = json.loads(metadata_path.read_text())
            if saved["model_sha256"] != self.model_sha256:
                raise ValueError("Checkpoint checksum differs from its saved metadata")
            evaluation = saved.get("evaluation", {})
            if evaluation.get("model_sha256") != self.model_sha256:
                raise ValueError("Saved evaluation belongs to another checkpoint")
            self.evaluation = evaluation.get("fresh_test")

    @staticmethod
    def _validate_history(frame):
        frame = frame[["cell_id", "date", "fishing_hours"]].copy()
        if frame.empty or frame.isna().any().any():
            raise ValueError("Forecast history is empty or contains missing values")
        if frame.duplicated(["cell_id", "date"]).any():
            raise ValueError("Duplicate forecast cell/day entries")
        if not np.isfinite(frame.fishing_hours).all() or (frame.fishing_hours < 0).any():
            raise ValueError("Invalid forecast history hours")
        frame = frame.sort_values(["cell_id", "date"])
        if not (frame.groupby("cell_id").date.diff().dropna() == pd.Timedelta(days=1)).all():
            raise ValueError("Forecast history has missing daily entries")
        return frame

    def info(self):
        return {
            **self.period, "status": "ready", "model_version": self.bundle["version"],
            "model_sha256": self.model_sha256, "selected_method": self.bundle["default_method"],
            "source_dataset": self.bundle["data_metadata"]["dataset"],
            "grid_degrees": self.grid, "minimum_history_days": 28,
            "availability_lag_days": self.lag, "evaluation": self.evaluation,
        }

    def predict(self, latitude, longitude):
        cell = cell_for(latitude, longitude, self.grid)
        # Keep requests small: only the selected cell is passed to feature creation.
        current = self.daily.loc[self.daily.cell_id == cell]
        annual = self.annual.loc[self.annual.cell_id == cell]
        result = predict_improved_location(
            latitude, longitude, self.bundle, current,
            cutoff=self.period["observation_cutoff"], annual_history=annual,
        )
        if result.get("status") == "scored":
            cutoff = pd.Timestamp(self.period["observation_cutoff"])
            history = current.loc[current.date.between(cutoff-pd.Timedelta(days=27), cutoff)].sort_values("date")
            hours = history.fishing_hours.to_numpy()
            method = result["selected_method"]
            signals = ["last_week"]
            if method == "seasonal_correction_tree":
                signals.extend(dict.fromkeys(step["feature"] for step in result["decision_path"]))
                signals.append("month_scale")
            elif method == "seasonal_blend":
                weights = self.bundle["models"]["blend_weights"]
                signals = (["last_week"] if weights[0] != 0 else []) + (["seasonal_change_fraction"] if weights[1] != 0 else [])
            elif method == "trained_calibration":
                signals.append("trained_adjustment")
            seasonal_available = result["seasonal_reference_available"]
            result["reasoning_evidence"] = {
                "history_start": history.date.min().date().isoformat(), "history_end": cutoff.date().isoformat(),
                "last_week_daily_mean": float(hours[-7:].mean()),
                "previous_week_daily_mean": float(hours[-14:-7].mean()),
                "recent_three_day_daily_mean": float(hours[-3:].mean()),
                "month_daily_mean": float(hours.mean()),
                "seasonal_estimate_hours": result["seasonal_estimate_hours"],
                "seasonal_reference_start": (pd.Timestamp(self.period["target_start"])-pd.DateOffset(years=1)).date().isoformat() if seasonal_available else None,
                "seasonal_reference_end": (pd.Timestamp(self.period["target_end"])-pd.DateOffset(years=1)).date().isoformat() if seasonal_available else None,
                "prediction_change_hours": result["predicted_week_hours"]-result["repeat_last_week_hours"],
                "used_signals": signals,
            }
        row, col = [int(part[3:]) for part in cell.split("_")]
        bounds = {"south": row*self.grid-90, "north": (row+1)*self.grid-90,
                  "west": col*self.grid-180, "east": (col+1)*self.grid-180}
        return {**self.period, "bounds": bounds, **result}
