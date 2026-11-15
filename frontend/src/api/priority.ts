import { request } from './client';
import type { Area, ActivityFilters, HistoricalAreaResult } from './historical';

export type PriorityFilters = Omit<ActivityFilters, 'sar_matched' | 'neural_vessel_type'>;
export type PriorityRequest = { area: Area; start: string; end: string; filters: PriorityFilters; include_vessel_evidence: boolean };
export type PriorityCategory = 'Minimal' | 'Low' | 'Medium' | 'High' | 'Critical';
export type PriorityResult = {
  policy_version: string; status: 'complete' | 'partial' | 'unavailable';
  priority_score: number | null; priority_category: PriorityCategory | null;
  score_kind: 'minimum_supported_review_priority'; score_range: [number, number]; coverage_percent: number;
  area: Area; start: string; end_exclusive: string; selection_key: string;
  factors: { code: string; label: string; weight: number; available: boolean; normalized_value: number | null; contribution_points: number | null; reason: string; sources: string[] }[];
  adjustments: { points: number; reason: string }[]; review_triggers: string[];
  excluded_components: Record<string, string | null>; limitations: string[];
};
export type PriorityJob = {
  id: string; status: 'queued' | 'running' | 'complete' | 'failed' | 'cancelled';
  progress: { phase: string; completed: number; total: number | null };
  result: PriorityResult | null; error: string | null; request: PriorityRequest; created_at: string;
};

export function priorityRequest(report: HistoricalAreaResult): PriorityRequest {
  if (!report.bounds || report.skipped || report.mode !== 'gfw') throw new Error('Load a real, completed area report first.');
  // These two fields select the displayed SAR view, not a vessel population.
  // Priority explicitly combines all/matched/unmatched views without adding them.
  const { sar_matched: _view, neural_vessel_type: _neural, ...filters } = report.applied_filters ?? {};
  return { area: report.bounds, start: report.start, end: report.end, filters, include_vessel_evidence: true };
}
export const createPriority = (body: PriorityRequest, signal?: AbortSignal) => request<PriorityJob>('/priority/assessments', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal,
});
export const getPriority = (id: string, signal?: AbortSignal) => request<PriorityJob>(`/priority/assessments/${encodeURIComponent(id)}`, { signal });
export const cancelPriority = (id: string) => request<PriorityJob>(`/priority/assessments/${encodeURIComponent(id)}`, { method: 'DELETE' });
