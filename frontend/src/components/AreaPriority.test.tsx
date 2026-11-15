// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AreaPriority } from './AreaPriority';
import { createPriority, getPriority, cancelPriority, priorityRequest, type PriorityJob } from '../api/priority';
import type { HistoricalAreaResult } from '../api/historical';
vi.mock('../api/priority', async importOriginal => ({ ...await importOriginal<typeof import('../api/priority')>(), createPriority: vi.fn(), getPriority: vi.fn(), cancelPriority: vi.fn() }));
const report: HistoricalAreaResult = { mode: 'gfw', layer: 'presence', cells: [], vessels: [], dataset: 'test', notes: [],
  start: '2025-11-05T00:00:00Z', end: '2025-11-12T00:00:00Z', bounds: { west: 0, south: 0, east: 5, north: 5 }, applied_filters: { flag: ['USA'] } };
const complete: PriorityJob = { id: 'test', status: 'complete', progress: { phase: 'complete', completed: 1, total: 1 }, error: null, request: priorityRequest(report), created_at: report.start,
  result: { policy_version: 'v1', status: 'partial', priority_score: 4, priority_category: null, score_kind: 'minimum_supported_review_priority', score_range: [4, 64], coverage_percent: 40,
    area: report.bounds!, start: report.start, end_exclusive: report.end, selection_key: 's', factors: [], adjustments: [], review_triggers: [], excluded_components: { habitats: 'Not date-matched' }, limitations: [] } };
beforeEach(() => { vi.resetAllMocks(); vi.mocked(createPriority).mockResolvedValue(complete); vi.mocked(cancelPriority).mockResolvedValue({ ...complete, status: 'cancelled', result: null }); });
afterEach(cleanup);

it('uses the report rectangle, dates and filters and labels incomplete results honestly', async () => {
  render(<AreaPriority report={report} />);
  fireEvent.click(screen.getByText('Calculate priority'));
  expect(await screen.findByText('Assessment incomplete')).toBeTruthy();
  expect(screen.queryByText('Minimal')).toBeNull();
  expect(createPriority).toHaveBeenCalledWith(expect.objectContaining({ area: report.bounds, start: report.start, end: report.end, filters: { flag: ['USA'] } }), expect.any(AbortSignal));
});

it('clears a completed assessment after the rectangle changes', async () => {
  const view = render(<AreaPriority report={report} />);
  fireEvent.click(screen.getByText('Calculate priority'));
  await screen.findByText('Assessment incomplete');
  view.rerender(<AreaPriority report={{ ...report, bounds: { west: 5, east: 10, south: 0, north: 5 } }} />);
  expect(screen.queryByText('Assessment incomplete')).toBeNull();
});

it('cancels a pending job and ignores stale results', async () => {
  vi.mocked(createPriority).mockResolvedValue({ ...complete, status: 'running', result: null });
  render(<AreaPriority report={report} />);
  fireEvent.click(screen.getByText('Calculate priority'));
  await waitFor(() => expect(screen.getByText('Stop assessment')).toBeTruthy());
  await waitFor(() => expect(createPriority).toHaveBeenCalled());
  fireEvent.click(screen.getByText('Stop assessment'));
  await waitFor(() => expect(cancelPriority).toHaveBeenCalledWith('test'));
  expect(getPriority).not.toHaveBeenCalled();
});
