// @vitest-environment jsdom
import { afterEach, expect, test, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { HistoricalWorkspace, useHistoricalWorkspace } from '../HistoricalWorkspace';
import { VesselCheck } from './VesselCheck';
import { fetchHistoricalVessel, searchVessels, streamHistoricalRisks, type HistoricalAreaResult, type HistoricalEvidence } from '../api/historical';

vi.mock('../api/historical', () => ({ fetchHistoricalVessel: vi.fn(), searchVessels: vi.fn(), streamHistoricalRisks: vi.fn() }));
const area: HistoricalAreaResult = { mode: 'gfw', layer: 'presence', start: '2026-01-01T00:00:00Z', end: '2026-01-02T00:00:00Z', dataset: 'presence', bounds: { west: 0, east: 10, south: 0, north: 10 }, notes: [], cells: [], vessels: [{ vessel_id: 'boat-one', name: 'Selected boat', hours: 1, mmsi: null, vessel_type: 'unknown' }] };
const report = { vessel_id: 'boat-one', start: area.start, end: area.end, summary: { name: 'Earlier report' } } as HistoricalEvidence;
function Controls() {
  const workspace = useHistoricalWorkspace()!;
  return <>
    <button onClick={() => workspace.setResult(area)}>First selection</button>
    <button onClick={() => workspace.setResult({ ...area, bounds: { west: 10, east: 20, south: 0, north: 10 } })}>Different rectangle</button>
    <button onClick={() => workspace.setResult({ ...area, end: '2026-01-03T00:00:00Z' })}>Different dates</button>
    <button onClick={() => workspace.saveReport(report)}>Save report</button>
    <button onClick={() => void workspace.startScreening()}>Screen</button>
    <span>Saved: {workspace.reports.length}; active: {workspace.selectedReport?.vessel_id ?? 'none'}; checks: {Object.keys(workspace.risks).length}</span>
  </>;
}
afterEach(() => { cleanup(); vi.resetAllMocks(); });

test('a different rectangle clears active evidence and checks even with the same IDs and dates', async () => {
  vi.mocked(streamHistoricalRisks).mockImplementation(async (_ids, _start, _end, callback) => {
    callback({ vessel_id: 'boat-one', state: 'no_flags', flag_count: 0, missing_count: 0, indicators: [], cached: false });
    return { checked: 1, remaining: 0, paused: false, elapsed_ms: 1 };
  });
  render(<HistoricalWorkspace><Controls /></HistoricalWorkspace>);
  fireEvent.click(screen.getByText('First selection'));
  fireEvent.click(screen.getByText('Save report'));
  fireEvent.click(screen.getByText('Screen'));
  await screen.findByText('Saved: 1; active: boat-one; checks: 1');
  expect(streamHistoricalRisks).toHaveBeenCalledWith(['boat-one'], area.start, area.end, expect.any(Function), expect.any(AbortSignal));
  fireEvent.click(screen.getByText('Different rectangle'));
  expect(screen.getByText('Saved: 1; active: none; checks: 0')).toBeTruthy();
});

test('a pending ID report cannot be saved after the observation dates change', async () => {
  vi.mocked(searchVessels).mockResolvedValue({ results: [{ vessel_id: 'boat-one', name: 'Matched boat', mmsi: null, imo: null, flag: null, vessel_type: 'unknown' }], since: null, source: 'GFW' });
  let resolve!: (value: HistoricalEvidence) => void;
  vi.mocked(fetchHistoricalVessel).mockReturnValue(new Promise(done => { resolve = done; }));
  render(<HistoricalWorkspace><Controls /><VesselCheck /></HistoricalWorkspace>);
  fireEvent.click(screen.getByText('First selection'));
  fireEvent.change(screen.getByLabelText('MMSI, IMO, call sign or vessel name'), { target: { value: 'boat-one' } });
  fireEvent.click(screen.getByText('Search Global Fishing Watch'));
  fireEvent.click(await screen.findByText('Open report'));
  expect(fetchHistoricalVessel).toHaveBeenCalledWith('boat-one', expect.objectContaining({ start: area.start, end: area.end }));
  fireEvent.click(screen.getByText('Different dates'));
  await act(async () => resolve(report));
  expect(screen.getByText('Saved: 0; active: none; checks: 0')).toBeTruthy();
  expect(screen.queryByText('Earlier report')).toBeNull();
});
