import { API_BASE_URL, ApiError, request } from "./client";

export type Area = { west: number; south: number; east: number; north: number };
export type ActivityFilters = {
  flag?: string[]; geartype?: string[]; vessel_id?: string; vessel_type?: string; shiptype?: string;
  speed?: "<2" | "2-4" | "4-6" | "6-10" | "10-15" | "15-25" | ">25";
  distance_from_port_km?: 0 | 1 | 2 | 3 | 4 | 5;
  sar_matched?: "false" | "true" | "all";
  neural_vessel_type?: "all" | "likely_fishing" | "likely_non_fishing" | "unknown";
};
export type HistoricalQuery = Area & ActivityFilters & { mode: "gfw" | "synthetic"; layer: "presence" | "fishing" | "sar"; hours_ago: number; window_hours: number; start?: string; end?: string; allow_land?: boolean };
export type ActivityCell = { id: string; lat: number; lon: number; value: number; date: string; vessel_type: string; vessel_count_lower_bound?: number | null; mean_length_m?: number | null; source_rows?: number };
export type HistoricalVessel = { vessel_id: string; name: string; mmsi: string | null; vessel_type: string; hours: number; length_m?: number | null };
export type HistoricalAreaResult = { cells: ActivityCell[]; vessels: HistoricalVessel[]; mode: HistoricalQuery["mode"]; layer: HistoricalQuery["layer"]; start: string; end: string; dataset: string; bounds?: Area; applied_filters?: ActivityFilters; notes: string[]; skipped?: boolean; land_check?: { status: string; land_fraction: number | null; skip: boolean; note: string; source: string } | null };
export type RiskIndicator = { code: string; label: string; count: number | null; event_ids: string[]; reported_positive?: boolean; status?: string; count_basis?: string; count_is_lower_bound?: boolean; quality_notes?: string[] };
export type HistoricalEvidence = {
  mode: HistoricalQuery["mode"]; vessel_id: string; start: string; end: string;
  authorization: { status: string; explanation: string };
  summary: { name: string; mmsi: string | null; imo: string | null; flag: string | null; vessel_type: string; documentation: string; identity_note: string; public_authorization_records: unknown[]; length_m?: number | null };
  indicators: RiskIndicator[];
  risk?: { state: "flagged" | "no_flags" | "unknown"; flag_count: number; missing_count: number; source_period_precision?: string; quality_notes?: string[] };
  warnings: string[]; sources: string[]; identity: Record<string, unknown>; insights: Record<string, unknown>;
};
const post = (body: unknown) => ({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
export const fetchHistoricalArea = (query: HistoricalQuery) => request<HistoricalAreaResult>("/historical/area", post(query));
export type VesselSearchMatch = { vessel_id: string; name: string; mmsi: string | null; imo: string | null; flag: string | null; vessel_type: string };
export const searchVessels = (query: string, since?: string, signal?: AbortSignal) => request<{ results: VesselSearchMatch[]; since: string | null; source: string }>("/historical/vessels/search", { ...post({ query, ...(since ? { since } : {}) }), signal });
export async function checkBackendConnection(): Promise<void> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    await request("/health", { signal: controller.signal });
  } catch {
    throw new Error("FastAPI is unavailable or unresponsive on port 8000. Stop the old backend with Ctrl+C in its terminal, then restart it from the project virtual environment. The globe can load even while the backend is down.");
  } finally { clearTimeout(timer); }
}
export async function fetchHistoricalVessel(vessel_id: string, query: Pick<HistoricalQuery, "mode" | "hours_ago" | "window_hours"> & { start?: string; end?: string }) {
  const report = await request<HistoricalEvidence>("/historical/vessel", post({ vessel_id, ...query }));
  if (report.vessel_id !== vessel_id || report.mode !== query.mode) throw new ApiError("Vessel report does not match the requested boat. No report was saved.", 502);
  if (!(Date.parse(report.end) > Date.parse(report.start)) ||
      (query.start && Date.parse(report.start) !== Date.parse(query.start)) ||
      (query.end && Date.parse(report.end) !== Date.parse(query.end))) throw new ApiError("Vessel report dates do not match the requested period. No report was saved.", 502);
  return report;
}
export type RiskEventEvidence = { id: string; status: "matched" | "unverified" | "unavailable"; message?: string; type?: string; start?: string; end?: string; duration_hours?: number; position?: { lat: number; lon: number } | null; reported_point_in_selected_area?: boolean | null; start_distance_from_port_km?: number | null; protected_area_ids?: string[]; regional_fisheries_codes?: string[]; scope_note?: string };
export const fetchRiskEvents = (query: { vessel_id: string; code: string; event_ids: string[]; start: string; end: string; area?: Area }, signal?: AbortSignal) => request<{ events: RiskEventEvidence[]; dataset: string; source: string }>("/historical/risk-events", { ...post(query), signal });

export type VesselRisk = { vessel_id: string; state: "flagged" | "no_flags" | "unknown"; flag_count: number; missing_count: number; indicators: HistoricalEvidence["indicators"]; quality_notes?: string[]; source_period_precision?: string; error?: string; error_status?: number | null; cached: boolean };
export const screenHistoricalRisks = (vessel_ids: string[], start: string, end: string, signal?: AbortSignal) =>
  request<{ results: VesselRisk[] }>("/historical/risks", { ...post({ vessel_ids, start, end }), signal });

export type RiskScreenCompletion = { paused: boolean; checked: number; remaining: number; elapsed_ms: number };
export async function streamHistoricalRisks(vessel_ids: string[], start: string, end: string, onResult: (risk: VesselRisk) => void, signal: AbortSignal): Promise<RiskScreenCompletion> {
  const response = await fetch(`${API_BASE_URL}/historical/risks/stream`, { ...post({ vessel_ids, start, end }), signal });
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new ApiError(typeof body?.detail === "string" ? body.detail : `Screening failed (${response.status}).`, response.status);
  }
  if (!response.body) throw new Error("This browser cannot stream screening results.");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const expected = new Set(vessel_ids), seen = new Set<string>();
  let buffer = "";
  let completion: RiskScreenCompletion | null = null;
  let started = false;
  function consume(line: string) {
    if (!line.trim()) return;
    const event = JSON.parse(line);
    if (event.type === "start") {
      if (started || event.total !== expected.size || !Number.isFinite(Date.parse(event.start)) || Date.parse(event.start) !== Date.parse(start) || Date.parse(event.end) !== Date.parse(end)) throw new Error("Screening dates do not match the requested period. Screening stopped.");
      started = true;
    } else if (event.type === "result") {
      if (!started || completion) throw new Error("Screening result arrived outside its verified period. Screening stopped.");
      const risk = event.result as VesselRisk;
      if (!risk || !expected.has(risk.vessel_id) || !["flagged", "no_flags", "unknown"].includes(risk.state)) throw new Error("Unexpected vessel in screening results. Screening stopped.");
      if (!seen.has(risk.vessel_id)) { seen.add(risk.vessel_id); onResult(risk); }
    } else if (event.type === "complete") {
      if (!started || event.checked !== seen.size || event.total !== expected.size || event.remaining !== expected.size - seen.size || typeof event.paused !== "boolean" || (!event.paused && event.remaining !== 0)) throw new Error("Screening ended with missing results. Completed checks are saved; resume to check the rest.");
      completion = event as RiskScreenCompletion;
    }
  }
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (signal.aborted) throw new DOMException("Screening stopped", "AbortError");
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
      if (buffer.length > 2_000_000) throw new Error("Screening response is too large.");
      const lines = buffer.split("\n"); buffer = lines.pop() ?? "";
      lines.forEach(consume);
      if (done) break;
    }
    consume(buffer);
    if (!completion) throw new Error("Connection ended before screening finished. Completed checks are saved; resume to check the rest.");
    return completion;
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
