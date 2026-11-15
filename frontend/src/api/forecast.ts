import { request } from "./client";
import type { Area } from "./historical";

type ForecastPeriod = { data_mode: "historical_demo"; observation_cutoff: string; simulated_issue_date: string; target_start: string; target_end: string };
export type ForecastReasoningEvidence = { history_start: string; history_end: string; last_week_daily_mean: number; previous_week_daily_mean: number; recent_three_day_daily_mean: number; month_daily_mean: number; seasonal_estimate_hours: number; seasonal_reference_start: string | null; seasonal_reference_end: string | null; prediction_change_hours: number; used_signals: string[] };
export type ForecastInfo = ForecastPeriod & { status: "ready"; model_version: string; selected_method: string; grid_degrees: number; source_dataset: string; evaluation: { mae_hours: number; baseline_mae_hours: number; mae_reduction_percent: number | null; issue_start: string; issue_end: string } | null };
export type ForecastResult = ForecastPeriod & { cell_id: string; bounds: Area } & (
  { status: "insufficient_data"; reason: string } |
  { status: "scored"; predicted_week_hours: number; repeat_last_week_hours: number; selected_explanation: string; interpretation: string; source_dataset: string; model_version: string; selected_method?: string; decision_path_applies_to?: string; reasoning_evidence?: ForecastReasoningEvidence | null; data_quality_notes: string[]; seasonal_reference_available: boolean; decision_path: { feature: string; observed: number; comparison: string; threshold: number }[] }
);
export type ScoredForecast = Extract<ForecastResult, { status: "scored" }>;

async function withDeadline<T>(path: string, init: RequestInit, signal?: AbortSignal): Promise<T> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (signal?.aborted) controller.abort();
  signal?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(abort, 15000);
  try { return await request<T>(path, { ...init, signal: controller.signal }); }
  catch (error) {
    if (signal?.aborted) throw error;
    if (controller.signal.aborted) throw new Error("Forecast backend did not respond. Check /forecast/health and restart FastAPI if needed.");
    throw error;
  } finally { clearTimeout(timer); signal?.removeEventListener("abort", abort); }
}
export const fetchForecastInfo = (signal?: AbortSignal) => withDeadline<ForecastInfo>("/activity-forecast/info", {}, signal);
export const fetchForecast = (latitude: number, longitude: number, signal?: AbortSignal) => withDeadline<ForecastResult>("/activity-forecast", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ latitude, longitude }) }, signal);
