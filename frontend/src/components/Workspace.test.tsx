// @vitest-environment jsdom
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { App } from "../App";
import { checkBackendConnection, fetchHistoricalArea, fetchHistoricalVessel, streamHistoricalRisks, searchVessels, type HistoricalAreaResult, type HistoricalEvidence, type VesselRisk, type RiskScreenCompletion } from "../api/historical";

vi.mock("../api/historical", () => ({ checkBackendConnection: vi.fn(), fetchHistoricalArea: vi.fn(), fetchHistoricalVessel: vi.fn(), streamHistoricalRisks: vi.fn(), searchVessels: vi.fn() }));
vi.mock("./ForecastPanel", () => ({ ForecastPanel: () => <div>Forecast panel</div> }));
vi.mock("./CaseMap", () => ({ CaseMap: ({ onAreaChange, onSelectingChange }: { onAreaChange: (value: unknown) => void; onSelectingChange: (active: boolean) => void }) => <><button onClick={() => onAreaChange({ west: -5, east: 3, south: 1, north: 7 })}>Draw area</button><button onClick={() => onSelectingChange(true)}>Start drawing</button><button onClick={() => onAreaChange(null)}>Clear area</button></> }));
const area: HistoricalAreaResult = { mode: "gfw", layer: "fishing", start: "2026-01-01T00:00:00Z", end: "2026-01-02T00:00:00Z", dataset: "public-global-fishing-effort:latest", notes: [], cells: [{ id: "1", lat: 4, lon: -1, value: 2, date: "2026-01-01", vessel_type: "fishing" }], vessels: [{ vessel_id: "real-id", name: "Observed ship", mmsi: "123456789", vessel_type: "fishing", hours: 2 }] };
const report: HistoricalEvidence = { mode: "gfw", vessel_id: "real-id", start: area.start, end: area.end, authorization: { status: "unknown", explanation: "Requires permit evidence" }, summary: { name: "Registry ship", mmsi: "123456789", imo: null, flag: "USA", vessel_type: "fishing", documentation: "public_registry_record_found", identity_note: "Public identity", public_authorization_records: [] }, indicators: [], warnings: [], sources: ["GFW"], identity: {}, insights: {} };
beforeEach(() => { vi.resetAllMocks(); vi.mocked(checkBackendConnection).mockResolvedValue(undefined); vi.mocked(fetchHistoricalArea).mockResolvedValue(area); vi.mocked(fetchHistoricalVessel).mockResolvedValue(report); });
afterEach(cleanup);

test("header Filters expands, retains settings when closed, and closes for area selection", async () => {
  const view = render(<App />);
  const menu = view.container.querySelector('.header-filters .filters-menu') as HTMLDetailsElement;
  expect(menu).toBeTruthy();
  expect(menu.open).toBe(false);
  fireEvent.click(menu.querySelector('summary')!);
  expect(menu.open).toBe(true);
  fireEvent.change(screen.getByLabelText('Window duration'), { target: { value: '168' } });
  fireEvent.click(screen.getByRole('button', { name: 'Close filters' }));
  expect(menu.open).toBe(false);
  fireEvent.click(menu.querySelector('summary')!);
  expect((screen.getByLabelText('Window duration') as HTMLSelectElement).value).toBe('168');
  fireEvent.click(screen.getByText('Start drawing'));
  expect(menu.open).toBe(false);
  fireEvent.click(screen.getByText('Draw area'));
  await screen.findByText('Inspect vessel');
  expect(fetchHistoricalArea).toHaveBeenCalledWith(expect.objectContaining({ window_hours: 168 }));
});

test("opens report drawer, hides controls, and hides empty evidence when drawing", async () => {
  render(<App />);
  const evidence = screen.getByRole("button", { name: "Evidence ‹" });
  expect(evidence.getAttribute("aria-expanded")).toBe("false");
  fireEvent.click(evidence);
  fireEvent.click(screen.getByText("Start drawing"));
  expect(evidence.getAttribute("aria-expanded")).toBe("false");
  fireEvent.click(screen.getByText("Draw area"));
  fireEvent.click(await screen.findByText("Inspect vessel"));
  await screen.findByText("Registry ship");
  expect(screen.getByRole("button", { name: "Evidence ›" }).getAttribute("aria-expanded")).toBe("true");
  expect(screen.getByRole("button", { name: "› Forecast" }).getAttribute("aria-expanded")).toBe("false");
  fireEvent.click(screen.getByText("Close report"));
  expect(screen.getByRole("button", { name: "Evidence ‹" }).getAttribute("aria-expanded")).toBe("false");
});

test("shares real area and screening across tabs without querying again", async () => {
  vi.mocked(streamHistoricalRisks).mockImplementation(async (_ids, _start, _end, onResult) => {
    onResult({ vessel_id: "real-id", state: "flagged", flag_count: 1, missing_count: 0, indicators: [{ code: "gap", label: "AIS gaps", count: 1, event_ids: [] }], cached: false });
    return { paused: false, checked: 1, remaining: 0, elapsed_ms: 50 };
  });
  render(<App />);
  expect(screen.queryByRole("button", { name: "GFW historical" })).toBeNull();
  expect(screen.queryByText("Query Gulf of Guinea area")).toBeNull();
  fireEvent.click(screen.getByText("Draw area"));
  fireEvent.click(await screen.findByText("Investigate selected boats"));
  expect(screen.getByRole('heading', { name: 'Area review priority' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Calculate priority' })).toBeTruthy();
  fireEvent.click(screen.getByText("Screen vessel risks"));
  await screen.findByText("Flagged (1)");
  fireEvent.click(screen.getByRole("button", { name: "Overview" }));
  fireEvent.click(screen.getByRole("button", { name: "Investigations" }));
  expect(screen.getByText("Flagged (1)")).toBeTruthy();
  fireEvent.click(screen.getByText("Full report"));
  await screen.findByRole("heading", { name: "Registry ship" });
  expect(fetchHistoricalVessel).toHaveBeenCalledWith("real-id", expect.objectContaining({ mode: "gfw", start: area.start, end: area.end }));
  fireEvent.click(screen.getByRole("button", { name: "Overview" }));
  expect(fetchHistoricalArea).toHaveBeenCalledTimes(1);
});

test("searches GFW identities and retains opened reports for investigations", async () => {
  vi.mocked(searchVessels).mockResolvedValue({ results: [{ vessel_id: "real-id", name: "Search ship", mmsi: "123456789", imo: null, flag: "USA", vessel_type: "fishing" }], since: null, source: "GFW" });
  render(<App />);
  fireEvent.click(screen.getByRole("button", { name: "Check vessel ID" }));
  fireEvent.change(screen.getByLabelText("MMSI, IMO, call sign or vessel name"), { target: { value: "123456789" } });
  fireEvent.click(screen.getByText("Search Global Fishing Watch"));
  fireEvent.click(await screen.findByText("Open report"));
  await screen.findByText("Registry ship");
  expect(searchVessels).toHaveBeenCalledWith("123456789", undefined, expect.any(AbortSignal));
  fireEvent.click(screen.getByRole("button", { name: "Investigations" }));
  await screen.findByText("Opened reports (1)");
  expect(screen.queryByText("Fictional test registry")).toBeNull();
});

test("a failed identity search shows the provider error without demo results", async () => {
  vi.mocked(searchVessels).mockRejectedValue(new Error("GFW token rejected"));
  render(<App />);
  fireEvent.click(screen.getByRole("button", { name: "Check vessel ID" }));
  fireEvent.change(screen.getByLabelText("MMSI, IMO, call sign or vessel name"), { target: { value: "123456789" } });
  fireEvent.click(screen.getByText("Search Global Fishing Watch"));
  await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("GFW token rejected"));
  expect(screen.queryByText("Open report")).toBeNull();
});

test("screening survives navigation, Stop preserves results, and resume skips completed boats", async () => {
  vi.mocked(fetchHistoricalArea).mockResolvedValue({ ...area, vessels: [...area.vessels, { ...area.vessels[0], vessel_id: "second-boat", name: "Second boat" }] });
  let onResult!: (risk: VesselRisk) => void;
  let resolve!: (completion: RiskScreenCompletion) => void;
  vi.mocked(streamHistoricalRisks).mockImplementation((_ids, _start, _end, callback) => { onResult = callback; return new Promise(done => { resolve = done; }); });
  render(<App />);
  fireEvent.click(screen.getByText("Draw area"));
  fireEvent.click(await screen.findByText("Investigate selected boats"));
  fireEvent.click(screen.getByText("Screen vessel risks"));
  const firstSignal = vi.mocked(streamHistoricalRisks).mock.calls[0][4];
  await act(async () => onResult({ vessel_id: "real-id", state: "no_flags", flag_count: 0, missing_count: 0, indicators: [], cached: false }));
  fireEvent.click(screen.getByRole("button", { name: "Overview" }));
  fireEvent.click(screen.getByRole("button", { name: "Investigations" }));
  expect(screen.getByText("Stop screening")).toBeTruthy();
  expect(streamHistoricalRisks).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByText("Stop screening"));
  expect(firstSignal.aborted).toBe(true);
  await act(async () => {
    onResult({ vessel_id: "second-boat", state: "flagged", flag_count: 1, missing_count: 0, indicators: [], cached: false });
    resolve({ checked: 2, remaining: 0, paused: false, elapsed_ms: 10 });
  });
  expect(screen.getByText("1 / 2 checked")).toBeTruthy();
  vi.mocked(streamHistoricalRisks).mockImplementation(async (_ids, _start, _end, callback) => {
    callback({ vessel_id: "second-boat", state: "no_flags", flag_count: 0, missing_count: 0, indicators: [], cached: false });
    return { checked: 1, remaining: 0, paused: false, elapsed_ms: 1 };
  });
  fireEvent.click(screen.getByText("Resume / retry remaining checks"));
  await screen.findByText("All boats checked");
  expect(vi.mocked(streamHistoricalRisks).mock.calls[1][0]).toEqual(["second-boat"]);
});

test("flagged boats with missing checks can be retried instead of being called complete", async () => {
  const partial: VesselRisk = { vessel_id: "real-id", state: "flagged", flag_count: 1, missing_count: 1, indicators: [{ code: "ais_gap", label: "Radio gaps", count: null, event_ids: [], reported_positive: true, status: "conflicting", quality_notes: ["The source fields disagree."] }], cached: false };
  vi.mocked(streamHistoricalRisks).mockImplementation(async (_ids, _start, _end, callback) => {
    callback(partial);
    return { checked: 1, remaining: 0, paused: false, elapsed_ms: 1 };
  });
  render(<App />);
  fireEvent.click(screen.getByText("Draw area"));
  fireEvent.click(await screen.findByText("Investigate selected boats"));
  fireEvent.click(screen.getByText("Screen vessel risks"));
  await screen.findByText("Resume / retry remaining checks");
  expect(screen.queryByText("All boats checked")).toBeNull();
  expect(screen.getByText(/exact count unavailable/)).toBeTruthy();
  fireEvent.click(screen.getByText("Why does this need review?"));
  expect(screen.getByText(/no exact count is asserted/)).toBeTruthy();
  vi.mocked(streamHistoricalRisks).mockImplementation(async (_ids, _start, _end, callback) => {
    callback({ ...partial, missing_count: 0, indicators: [{ code: "ais_gap", label: "Radio gaps", count: 1, event_ids: [] }] });
    return { checked: 1, remaining: 0, paused: false, elapsed_ms: 1 };
  });
  fireEvent.click(screen.getByText("Resume / retry remaining checks"));
  await screen.findByText("All boats checked");
  expect(vi.mocked(streamHistoricalRisks).mock.calls[1][0]).toEqual(["real-id"]);
});

test("clearing the selected area aborts screening and rejects stale results", async () => {
  let onResult!: (risk: VesselRisk) => void;
  let resolve!: (completion: RiskScreenCompletion) => void;
  vi.mocked(streamHistoricalRisks).mockImplementation((_ids, _start, _end, callback) => { onResult = callback; return new Promise(done => { resolve = done; }); });
  render(<App />);
  fireEvent.click(screen.getByText("Draw area"));
  fireEvent.click(await screen.findByText("Investigate selected boats"));
  fireEvent.click(screen.getByText("Screen vessel risks"));
  const signal = vi.mocked(streamHistoricalRisks).mock.calls[0][4];
  fireEvent.click(screen.getByRole("button", { name: "Overview" }));
  fireEvent.click(screen.getByText("Clear area"));
  expect(signal.aborted).toBe(true);
  await act(async () => { onResult({ vessel_id: "real-id", state: "flagged", flag_count: 1, missing_count: 0, indicators: [], cached: false }); resolve({ checked: 1, remaining: 0, paused: false, elapsed_ms: 10 }); });
  fireEvent.click(screen.getByRole("button", { name: "Investigations" }));
  expect(screen.queryByText("Flagged (1)")).toBeNull();
  expect(screen.queryByText("Stop screening")).toBeNull();
});
