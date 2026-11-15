// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { checkBackendConnection, fetchHistoricalArea, fetchHistoricalVessel, screenHistoricalRisks, type HistoricalAreaResult, type HistoricalEvidence } from "../api/historical";
import { GfwOverview } from "./GfwOverview";

vi.mock("../api/historical", () => ({ checkBackendConnection: vi.fn(), fetchHistoricalArea: vi.fn(), fetchHistoricalVessel: vi.fn(), screenHistoricalRisks: vi.fn() }));
vi.mock("./ForecastPanel", () => ({ ForecastPanel: () => <div>Forecast panel</div> }));
vi.mock("./CaseMap", () => ({ CaseMap: ({ onAreaChange }: { onAreaChange: (area: unknown) => void }) => <>
  <button onClick={() => onAreaChange({ west: -5, east: 3, south: 1, north: 7 })}>Draw test area</button>
  <button onClick={() => onAreaChange(null)}>Clear test area</button>
</> }));

const areaResult: HistoricalAreaResult = {
  mode: "gfw", layer: "presence", start: "2026-01-01T00:00:00Z", end: "2026-01-02T00:00:00Z",
  dataset: "public-global-presence:latest", notes: [],
  cells: [{ id: "cell-1", lat: 4, lon: -1, value: .5, date: "2026-01-01", vessel_type: "cargo" }],
  vessels: [{ vessel_id: "test-vessel-1", name: "Test vessel", mmsi: "123456789", vessel_type: "cargo", hours: .5 }],
};
const evidence: HistoricalEvidence = {
  mode: "gfw", vessel_id: "test-vessel-1", start: areaResult.start, end: areaResult.end,
  authorization: { status: "unknown", explanation: "Permit evidence is missing." },
  summary: { name: "Test vessel identity", mmsi: "123456789", imo: null, flag: "TEST", vessel_type: "cargo",
    documentation: "ais_identity_only", identity_note: "Self-reported", public_authorization_records: [] },
  indicators: [{ code: "gap", label: "AIS gaps", count: null, event_ids: [] }],
  warnings: [], sources: ["Test source"], identity: {}, insights: {},
};

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(checkBackendConnection).mockResolvedValue(undefined);
  vi.mocked(fetchHistoricalArea).mockResolvedValue(areaResult);
  vi.mocked(fetchHistoricalVessel).mockResolvedValue(evidence);
});
afterEach(cleanup);

describe("Overview GFW integration", () => {
  it("reports an unresponsive backend before attempting provider reports", async () => {
    vi.mocked(checkBackendConnection).mockRejectedValue(new Error("FastAPI is unresponsive. Restart the backend."));
    render(<GfwOverview />);
    fireEvent.click(screen.getByText("Draw test area"));
    expect((await screen.findByRole("alert")).textContent).toContain("FastAPI is unresponsive");
    expect(fetchHistoricalArea).not.toHaveBeenCalled();
  });
  it("screens risk without fetching full reports and then allows report selection", async () => {
    vi.mocked(screenHistoricalRisks).mockResolvedValue({ results: [{ vessel_id: "test-vessel-1", state: "flagged", flag_count: 1, missing_count: 0, indicators: [{ code: "gap", label: "AIS gaps", count: 2, event_ids: [] }], cached: false }] });
    render(<GfwOverview />);
    fireEvent.click(screen.getByText("Draw test area"));
    fireEvent.click(await screen.findByText("Screen vessel risks"));
    expect(await screen.findByText("Flagged (1)")).toBeTruthy();
    expect(fetchHistoricalVessel).not.toHaveBeenCalled();
    expect(screenHistoricalRisks).toHaveBeenCalledWith(["test-vessel-1"], areaResult.start, areaResult.end, expect.any(AbortSignal));
    fireEvent.click(screen.getByText("Inspect vessel"));
    expect(await screen.findByText("Test vessel identity")).toBeTruthy();
  });

  it("explains a land skip rather than claiming no vessels exist", async () => {
    vi.mocked(fetchHistoricalArea).mockResolvedValue({ ...areaResult, cells: [], vessels: [], skipped: true, land_check: { status: "estimated", land_fraction: .9, skip: true, note: "Conservative estimate", source: "test geometry" } });
    render(<GfwOverview />);
    fireEvent.click(screen.getByText("Draw test area"));
    expect(await screen.findByText(/Area skipped because it exceeds/)).toBeTruthy();
    expect(screenHistoricalRisks).not.toHaveBeenCalled();
  });
  it("queries real historical data when a globe area is selected", async () => {
    render(<GfwOverview />);
    expect(fetchHistoricalArea).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("Draw test area"));
    expect(await screen.findByText("Test vessel")).toBeTruthy();
    expect(fetchHistoricalArea).toHaveBeenCalledWith({ west: -5, east: 3, south: 1, north: 7, mode: "gfw", layer: "presence", hours_ago: 100, window_hours: 24 });
    expect(screen.getByText(/not exact boat locations/)).toBeTruthy();
  });

  it("opens identity and evidence for the selected area vessel", async () => {
    render(<GfwOverview />);
    fireEvent.click(screen.getByText("Draw test area"));
    fireEvent.click(await screen.findByText("Inspect vessel"));
    expect(await screen.findByText("Test vessel identity")).toBeTruthy();
    expect(fetchHistoricalVessel).toHaveBeenCalledWith("test-vessel-1", { mode: "gfw", hours_ago: 100, window_hours: 24, start: areaResult.start, end: areaResult.end });
    expect(screen.getByText("Authorization: unknown")).toBeTruthy();
    expect(screen.getByText("Unavailable")).toBeTruthy();
  });

  it("shows a token failure instead of fictional vessels", async () => {
    vi.mocked(fetchHistoricalArea).mockRejectedValue(new Error("GFW token rejected"));
    render(<GfwOverview />);
    fireEvent.click(screen.getByText("Draw test area"));
    expect((await screen.findByRole("alert")).textContent).toBe("GFW token rejected");
    expect(screen.queryByText("Test vessel")).toBeNull();
    expect(screen.queryByText("Inspect vessel")).toBeNull();
  });

  it("does not show stale results after clearing the selected area", async () => {
    let resolve!: (result: HistoricalAreaResult) => void;
    vi.mocked(fetchHistoricalArea).mockReturnValue(new Promise((done) => { resolve = done; }));
    render(<GfwOverview />);
    fireEvent.click(screen.getByText("Draw test area"));
    fireEvent.click(screen.getByText("Clear test area"));
    resolve(areaResult);
    await waitFor(() => expect(screen.queryByText("Test vessel")).toBeNull());
    expect(screen.getByText(/That selection now triggers a GFW query/)).toBeTruthy();
  });

  it("re-queries the selected area when switching to SAR with the older cutoff", async () => {
    render(<GfwOverview />);
    fireEvent.click(screen.getByText("Draw test area"));
    await screen.findByText("Test vessel");
    fireEvent.change(screen.getByLabelText("Activity layer"), { target: { value: "sar" } });
    await waitFor(() => expect(fetchHistoricalArea).toHaveBeenLastCalledWith(expect.objectContaining({ layer: "sar", hours_ago: 124, mode: "gfw" })));
  });
});
