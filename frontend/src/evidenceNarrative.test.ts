import { expect, test } from "vitest";
import { areaNarrative, forecastNarrative, indicatorNarrative } from "./evidenceNarrative";
import type { ScoredForecast } from "./api/forecast";
import type { HistoricalAreaResult, VesselRisk } from "./api/historical";

const forecast: ScoredForecast = { status: "scored", data_mode: "historical_demo", cell_id: "one", bounds: { west: 0, east: 5, south: 0, north: 5 }, observation_cutoff: "2025-07-31", simulated_issue_date: "2025-08-03", target_start: "2025-08-04", target_end: "2025-08-10", predicted_week_hours: 120, repeat_last_week_hours: 100, selected_method: "seasonal_correction_tree", selected_explanation: "Exact calculation", interpretation: "Activity estimate", model_version: "one", source_dataset: "GFW", data_quality_notes: [], seasonal_reference_available: true, decision_path: [], reasoning_evidence: { history_start: "2025-07-04", history_end: "2025-07-31", last_week_daily_mean: 100/7, previous_week_daily_mean: 10, recent_three_day_daily_mean: 50, month_daily_mean: 12, seasonal_estimate_hours: 140, seasonal_reference_start: "2024-08-04", seasonal_reference_end: "2024-08-10", prediction_change_hours: 20, used_signals: ["last_week", "seasonal_change_fraction"] } };

test("forecast story describes only inputs used by the selected model path", () => {
  const story = forecastNarrative(forecast);
  expect(story.headline).toContain("busier");
  expect(story.reasons.some(reason => reason.title.includes("time of year"))).toBe(true);
  expect(story.reasons.some(reason => reason.title.includes("most recent"))).toBe(false);
  expect(story.reasons.map(reason => reason.text).join(" ")).not.toMatch(/boats (will|are) (moving|heading)/i);
});
test("missing seasonality and missing explanation inputs do not become invented causes", () => {
  const missing = forecastNarrative({ ...forecast, seasonal_reference_available: false });
  expect(missing.reasons.some(reason => reason.text.includes("seasonal cause cannot be claimed"))).toBe(true);
  const absent = forecastNarrative({ ...forecast, reasoning_evidence: null });
  expect(absent.reasons[0].text).toContain("cannot infer local causes");
});
test("zero and invalid risk counts are distinct from a positive report", () => {
  const base = { code: "no_known_rfmo_authorization", label: "Permit check", event_ids: [] };
  expect(indicatorNarrative({ ...base, count: 2 }).finding).toContain("without a matching permit");
  expect(indicatorNarrative({ ...base, count: 2 }).limit).toContain("Missing records do not prove");
  expect(indicatorNarrative({ ...base, count: 0 }).status).toBe("clear");
  expect(indicatorNarrative({ ...base, count: null }).status).toBe("unavailable");
  expect(indicatorNarrative({ ...base, count: NaN }).status).toBe("unavailable");
});
test("coastal analysis counts boat records once and retains overlapping missing-information status", () => {
  const result = { vessels: [{ vessel_id: "one" }, { vessel_id: "two" }] } as HistoricalAreaResult;
  const risk: VesselRisk = { vessel_id: "one", state: "flagged", flag_count: 2, missing_count: 2, cached: false, indicators: [{ code: "ais_gap", label: "Gaps", count: 3, event_ids: [] }, { code: "fishing_in_no_take_mpa", label: "Fishing", count: 1, event_ids: [] }] };
  const story = areaNarrative(result, { one: risk });
  expect(story.flagged).toBe(1); expect(story.unchecked).toBe(1); expect(story.incomplete).toBe(1);
  expect(story.findings).toHaveLength(2);
  expect(story.findings.every(finding => finding.boats === 1)).toBe(true);
});
