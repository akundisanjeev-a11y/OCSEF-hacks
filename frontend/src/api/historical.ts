import { request } from "./client";

export type Area = { west: number; south: number; east: number; north: number };
export type HistoricalQuery = Area & { mode: "gfw" | "synthetic"; layer: "presence" | "fishing" | "sar"; hours_ago: number; window_hours: number; allow_land?: boolean };
export type ActivityCell = { id: string; lat: number; lon: number; value: number; date: string; vessel_type: string };
export type HistoricalVessel = { vessel_id: string; name: string; mmsi: string | null; vessel_type: string; hours: number };
export type HistoricalAreaResult = { cells: ActivityCell[]; vessels: HistoricalVessel[]; mode: HistoricalQuery["mode"]; layer: HistoricalQuery["layer"]; start: string; end: string; dataset: string; notes: string[]; skipped?: boolean; land_check?: { status: string; land_fraction: number | null; skip: boolean; note: string; source: string } | null };
export type HistoricalEvidence = {
  mode: HistoricalQuery["mode"]; vessel_id: string; start: string; end: string;
  authorization: { status: string; explanation: string };
  summary: { name: string; mmsi: string | null; imo: string | null; flag: string | null; vessel_type: string; documentation: string; identity_note: string; public_authorization_records: unknown[] };
  indicators: { code: string; label: string; count: number | null; event_ids: string[] }[];
  warnings: string[]; sources: string[]; identity: Record<string, unknown>; insights: Record<string, unknown>;
};
const post = (body: unknown) => ({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
export const fetchHistoricalArea = (query: HistoricalQuery) => request<HistoricalAreaResult>("/historical/area", post(query));
export const fetchHistoricalVessel = (vessel_id: string, query: Pick<HistoricalQuery, "mode" | "hours_ago" | "window_hours"> & { start?: string; end?: string }) => request<HistoricalEvidence>("/historical/vessel", post({ vessel_id, ...query }));

export type VesselRisk = { vessel_id: string; state: "flagged" | "no_flags" | "unknown"; flag_count: number; missing_count: number; indicators: HistoricalEvidence["indicators"]; error?: string; error_status?: number; cached: boolean };
export const screenHistoricalRisks = (vessel_ids: string[], start: string, end: string, signal?: AbortSignal) =>
  request<{ results: VesselRisk[] }>("/historical/risks", { ...post({ vessel_ids, start, end }), signal });
