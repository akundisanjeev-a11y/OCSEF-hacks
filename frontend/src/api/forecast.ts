import { request } from "./client";
import type { Area } from "./historical";

type Period = { data_mode: "historical_demo"; observation_cutoff: string;
  simulated_issue_date: string; target_start: string; target_end: string };
export type ForecastResult = Period & { cell_id: string; bounds: Area } & (
  { status: "insufficient_data"; reason: string } |
  { status: "scored"; predicted_week_hours: number; repeat_last_week_hours: number;
    selected_explanation: string; data_quality_notes: string[]; source_dataset: string; model_version: string }
);
export const fetchForecast = (latitude: number, longitude: number, signal?: AbortSignal) =>
  request<ForecastResult>("/activity-forecast", { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ latitude, longitude }), signal });
