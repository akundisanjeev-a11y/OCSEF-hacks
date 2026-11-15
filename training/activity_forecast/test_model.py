import hashlib
import json
import joblib
import numpy as np
import pandas as pd

from sklearn.metrics import mean_absolute_error, mean_squared_error

from training.activity_forecast.common import DATA, FEATURES, ROOT
from training.activity_forecast.train import chronological_split


def main():
    best = ROOT / 'weights/activity_forecast/best_model.joblib'
    saved = ROOT / 'weights/activity_forecast/best_model_metadata.json'
    if best.is_file() and saved.is_file():
        metadata = json.loads(saved.read_text())
        if hashlib.sha256(best.read_bytes()).hexdigest() != metadata['model_sha256']:
            raise ValueError('Best checkpoint differs from its recorded evaluation')
        report = metadata['evaluation']
        result = report['fresh_test']
        print('Recorded held-out results for best_model.joblib; no new test evaluation.')
        print(f"Selected method: {report['selected_method']}")
        print(f"Test examples: {result['rows']:,}")
        print(f"Model MAE: {result['mae_hours']:,.2f} hours")
        print(f"Baseline MAE: {result['baseline_mae_hours']:,.2f} hours")
        print(f"Beats baseline: {result['beats_baseline']}")
        return
    bundle = joblib.load(
        ROOT / "weights/activity_forecast/model.joblib"
    )
    if bundle.get('schema_version') == 2:
        from training.activity_forecast.improve import evaluate_fresh
        report = evaluate_fresh(ROOT / 'weights/activity_forecast')
        result = report['fresh_test']
        print(f"Selected method: {report['selected_method']}")
        print(f"Test examples: {result['rows']:,}")
        print(f"Model MAE: {result['mae_hours']:,.2f} hours")
        print(f"Model RMSE: {result['rmse_hours']:,.2f} hours")
        print(f"Baseline MAE: {result['baseline_mae_hours']:,.2f} hours")
        print(f"Beats baseline: {result['beats_baseline']}")
        return

    rows = pd.read_csv(
        DATA / "processed/training_rows.csv"
    )

    _, _, test = chronological_split(rows)

    actual = test["target_week_hours"].to_numpy()
    baseline = test[FEATURES[0]].to_numpy() * 7

    selected = bundle["default_method"]

    if selected == "trained_calibration":
        predictions = baseline * bundle["calibration_scale"]

    elif selected == "decision_tree":
        predictions = bundle["model"].predict(test[FEATURES])

    elif selected == "repeat_last_week":
        predictions = baseline

    else:
        raise ValueError(f"Unknown model method: {selected}")

    mae = mean_absolute_error(actual, predictions)
    rmse = np.sqrt(mean_squared_error(actual, predictions))
    baseline_mae = mean_absolute_error(actual, baseline)

    print(f"Selected method: {selected}")
    print(f"Test examples: {len(test):,}")
    print(f"Model MAE: {mae:,.2f} hours")
    print(f"Model RMSE: {rmse:,.2f} hours")
    print(f"Baseline MAE: {baseline_mae:,.2f} hours")
    print(f"Beats baseline: {mae < baseline_mae}")


if __name__ == "__main__":
    main()
