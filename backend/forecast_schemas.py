"""Public contract for the historical activity forecast, separate from ship detection."""

from datetime import date
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field


class ForecastRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)
    latitude: float = Field(ge=-90, le=90, strict=True)
    longitude: float = Field(ge=-180, le=180, strict=True)


class Bounds(BaseModel):
    south: float
    north: float
    west: float
    east: float


class ForecastPeriod(BaseModel):
    data_mode: Literal["historical_demo"] = "historical_demo"
    observation_cutoff: date
    simulated_issue_date: date
    target_start: date
    target_end: date


class DecisionStep(BaseModel):
    feature: str
    observed: float
    comparison: Literal["<=", ">"]
    threshold: float


class ForecastReasoningEvidence(BaseModel):
    model_config = ConfigDict(allow_inf_nan=False)
    history_start: date
    history_end: date
    last_week_daily_mean: float = Field(ge=0)
    previous_week_daily_mean: float = Field(ge=0)
    recent_three_day_daily_mean: float = Field(ge=0)
    month_daily_mean: float = Field(ge=0)
    seasonal_estimate_hours: float = Field(ge=0)
    seasonal_reference_start: date | None = None
    seasonal_reference_end: date | None = None
    prediction_change_hours: float
    used_signals: list[str]


class ScoredForecast(ForecastPeriod):
    model_config = ConfigDict(allow_inf_nan=False)
    status: Literal["scored"]
    cell_id: str
    bounds: Bounds
    selected_method: str
    model_version: str
    source_dataset: str
    predicted_week_hours: float = Field(ge=0)
    repeat_last_week_hours: float = Field(ge=0)
    seasonal_estimate_hours: float = Field(ge=0)
    seasonal_reference_available: bool
    data_quality_notes: list[str]
    decision_path: list[DecisionStep]
    decision_path_applies_to: str
    learned_leaf_correction_fraction: float
    correction_scale_hours: float = Field(ge=1)
    selected_explanation: str
    interpretation: str
    reasoning_evidence: ForecastReasoningEvidence | None = None


class InsufficientForecast(ForecastPeriod):
    status: Literal["insufficient_data"]
    cell_id: str
    bounds: Bounds
    reason: str


ForecastResponse = Annotated[ScoredForecast | InsufficientForecast, Field(discriminator="status")]


class EvaluationSummary(BaseModel):
    issue_start: date
    issue_end: date
    rows: int
    cells: int
    mae_hours: float
    baseline_mae_hours: float
    rmse_hours: float
    baseline_rmse_hours: float
    mae_reduction_percent: float | None


class ForecastInfo(ForecastPeriod):
    status: Literal["ready"] = "ready"
    model_version: str
    model_sha256: str
    selected_method: str
    source_dataset: str
    grid_degrees: int
    minimum_history_days: int = 28
    availability_lag_days: int
    evaluation: EvaluationSummary | None = None
