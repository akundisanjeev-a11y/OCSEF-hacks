// @vitest-environment jsdom
import { afterEach, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { GfwOverview } from "./GfwOverview";
import type { ScoredForecast } from "../api/forecast";
import type { ForecastComparison, ActivityArrow } from "../forecastMap";

const { forecast, comparison, arrow } = vi.hoisted(() => {
  const base = { status: "scored", data_mode: "historical_demo", observation_cutoff: "2025-07-31", simulated_issue_date: "2025-08-03", target_start: "2025-08-04", target_end: "2025-08-10", cell_id: "selected", bounds: { west: 120, east: 125, south: 25, north: 30 }, predicted_week_hours: 100, repeat_last_week_hours: 80, model_version: "model", source_dataset: "source", selected_explanation: "Selected square explanation", interpretation: "Not boat travel", data_quality_notes: [], seasonal_reference_available: true, decision_path: [] };
  const neighbor = { ...base, cell_id: "neighbor", bounds: { west: 125, east: 130, south: 25, north: 30 }, predicted_week_hours: 200, selected_explanation: "Higher activity neighbor explanation" };
  return { forecast: base, comparison: { cells: [base, neighbor], attempted: 9, unavailable: 7 }, arrow: { from_id: "selected", to_id: "neighbor", from_hours: 100, to_hours: 200, difference: 100 } };
});
vi.mock("./ForecastPanel", () => ({ ForecastPanel: ({ onForecastChange, onComparisonChange }: { onForecastChange: (value: ScoredForecast | null) => void; onComparisonChange: (value: ForecastComparison | null) => void }) => <div id="test-forecast"><button onClick={() => { onForecastChange(forecast as ScoredForecast); onComparisonChange(comparison as ForecastComparison); }}>Predict test area</button><button onClick={() => { onForecastChange(null); onComparisonChange(null); }}>Clear test forecast</button></div> }));
vi.mock("./CaseMap", () => ({ CaseMap: ({ onForecastArrowSelect }: { onForecastArrowSelect: (value: ActivityArrow) => void }) => <button onClick={() => onForecastArrowSelect(arrow)}>Inspect test arrow</button> }));
afterEach(cleanup);

test("forecast controls occupy the left drawer and reasoning opens in Evidence", async () => {
  const view = render(<GfwOverview />);
  expect(view.container.querySelector("#forecast-drawer #test-forecast")).toBeTruthy();
  expect(view.container.querySelector("#area-controls")).toBeTruthy();
  expect(view.container.querySelector(".left-slot #area-controls")).toBeNull();
  fireEvent.click(screen.getByText("Predict test area"));
  await screen.findByText("Selected square explanation");
  expect(screen.getByRole("heading", { name: "Forecast reasoning" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Evidence ›" }).getAttribute("aria-expanded")).toBe("true");
  fireEvent.click(screen.getByText("Inspect test arrow"));
  await screen.findByText("Higher activity neighbor explanation");
  expect(screen.getByText(/not boat routes or predicted migration/)).toBeTruthy();
  fireEvent.click(screen.getByText("Clear test forecast"));
  await waitFor(() => expect(screen.queryByText("Higher activity neighbor explanation")).toBeNull());
});
