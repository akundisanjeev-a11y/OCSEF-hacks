// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ForecastComparison } from "../forecastMap";
import { fetchForecast, fetchForecastInfo, type ForecastInfo, type ForecastResult } from "../api/forecast";
import { ForecastPanel } from "./ForecastPanel";

vi.mock("../api/forecast", () => ({ fetchForecast: vi.fn(), fetchForecastInfo: vi.fn() }));
const period = { data_mode: "historical_demo" as const, observation_cutoff: "2025-07-31", simulated_issue_date: "2025-08-03", target_start: "2025-08-04", target_end: "2025-08-10" };
const info: ForecastInfo = { ...period, status: "ready", model_version: "test-v1", selected_method: "seasonal_correction_tree", grid_degrees: 5, source_dataset: "test", evaluation: null };
const prediction: ForecastResult = { ...period, status: "scored", cell_id: "lat23_lon60", bounds: { south: 25, north: 30, west: 120, east: 125 }, predicted_week_hours: 34722.98, repeat_last_week_hours: 30003.75,
  selected_explanation: "A learned correction was applied.", interpretation: "Not proof of harm.", source_dataset: "test", model_version: "test-v1", data_quality_notes: [], seasonal_reference_available: true, decision_path: [] };
beforeEach(() => { vi.resetAllMocks(); vi.mocked(fetchForecastInfo).mockResolvedValue(info); vi.mocked(fetchForecast).mockResolvedValue(prediction); });
afterEach(cleanup);

describe("historical model globe panel", () => {
  it("requests the area's center and draws the returned model cell, not the exact rectangle", async () => {
    const onBoundsChange = vi.fn();
    render(<ForecastPanel area={{ west: 121, east: 124, south: 26, north: 29 }} onBoundsChange={onBoundsChange} />);
    fireEvent.click(screen.getByText("Get fishing forecast"));
    expect(await screen.findByText("34,723")).toBeTruthy();
    expect(fetchForecast).toHaveBeenCalledWith(27.5, 122.5, expect.any(AbortSignal));
    expect(onBoundsChange).toHaveBeenLastCalledWith(prediction.bounds);
    expect(screen.getByText(/forecast 2025-08-04 through 2025-08-10/)).toBeTruthy();
    expect(screen.getByText("+15.7%")).toBeTruthy();
  });

  it("renders valid zero predictions and avoids percentage division by zero", async () => {
    vi.mocked(fetchForecast).mockResolvedValue({ ...prediction, status: "scored", predicted_week_hours: 0, repeat_last_week_hours: 0 });
    render(<ForecastPanel area={null} onBoundsChange={vi.fn()} />);
    fireEvent.click(screen.getByText("Try verified historical example"));
    expect(await screen.findByText("Unavailable")).toBeTruthy();
    expect(screen.getAllByText("0").length).toBe(2);
  });

  it("clears old numbers and overlay when the location changes or history is insufficient", async () => {
    const onBoundsChange = vi.fn();
    render(<ForecastPanel area={null} onBoundsChange={onBoundsChange} />);
    fireEvent.click(screen.getByText("Try verified historical example"));
    await screen.findByText("34,723");
    fireEvent.change(screen.getByLabelText("Forecast latitude"), { target: { value: "89" } });
    expect(screen.queryByText("34,723")).toBeNull();
    vi.mocked(fetchForecast).mockResolvedValue({ ...period, status: "insufficient_data", cell_id: "empty", bounds: { west: 0, east: 5, south: 85, north: 90 }, reason: "Missing history" });
    fireEvent.click(screen.getByText("Get fishing forecast"));
    expect(await screen.findByText(/Not enough usable activity history/)).toBeTruthy();
    expect(onBoundsChange).toHaveBeenLastCalledWith(null);
  });

  it("ignores a stale prediction after the selected area changes", async () => {
    let resolve!: (value: ForecastResult) => void;
    vi.mocked(fetchForecast).mockReturnValue(new Promise((done) => { resolve = done; }));
    const callback = vi.fn();
    const view = render(<ForecastPanel area={null} onBoundsChange={callback} />);
    fireEvent.click(screen.getByText("Try verified historical example"));
    view.rerender(<ForecastPanel area={{ west: 0, east: 1, south: 0, north: 1 }} onBoundsChange={callback} />);
    resolve(prediction);
    await waitFor(() => expect(screen.queryByText("34,723")).toBeNull());
    expect(callback).not.toHaveBeenCalledWith(prediction.bounds);
  });

  it("compares actual neighboring forecasts using the same dates and model", async () => {
    vi.mocked(fetchForecast).mockImplementation(async (lat, lon) => ({ ...prediction, status: "scored", cell_id: `${lat}-${lon}`, bounds: { west: lon - 2.5, east: lon + 2.5, south: lat - 2.5, north: lat + 2.5 }, predicted_week_hours: lat * 10 + lon }));
    const onComparison = vi.fn();
    render(<ForecastPanel area={null} onBoundsChange={vi.fn()} onComparisonChange={onComparison} />);
    fireEvent.click(screen.getByText("Try verified historical example"));
    await waitFor(() => expect(onComparison).toHaveBeenLastCalledWith(expect.objectContaining({ attempted: 9, unavailable: 0 })));
    const comparison = onComparison.mock.calls.at(-1)![0] as ForecastComparison;
    expect(comparison.cells).toHaveLength(9);
    expect(new Set(comparison.cells.map(cell => cell.cell_id)).size).toBe(9);
    expect(fetchForecast).toHaveBeenCalledTimes(9);
  });

  it("clears pending neighbor arrows when the forecast point changes", async () => {
    const pending: ((value: ForecastResult) => void)[] = [];
    vi.mocked(fetchForecast).mockResolvedValueOnce(prediction).mockImplementation(() => new Promise(resolve => pending.push(resolve)));
    const onComparison = vi.fn();
    render(<ForecastPanel area={null} onBoundsChange={vi.fn()} onComparisonChange={onComparison} />);
    fireEvent.click(screen.getByText("Try verified historical example"));
    await screen.findByText("Comparing nearby areas…");
    fireEvent.change(screen.getByLabelText("Forecast latitude"), { target: { value: "0" } });
    await act(async () => pending.forEach(resolve => resolve(prediction)));
    expect(onComparison).toHaveBeenLastCalledWith(null);
    expect(onComparison.mock.calls.some(([value]) => value?.cells?.length)).toBe(false);
    expect(screen.queryByText("34,723")).toBeNull();
  });
});
