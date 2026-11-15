import { afterEach, expect, test, vi } from "vitest";
import { fetchHistoricalVessel } from "./historical";

const query = { mode: 'gfw' as const, hours_ago: 100, window_hours: 24, start: '2026-01-01T00:00:00Z', end: '2026-01-02T00:00:00Z' };
const report = { mode: 'gfw', vessel_id: 'boat-one', start: query.start, end: query.end };
afterEach(() => vi.unstubAllGlobals());

test('accepts the requested boat and equivalent UTC period formats', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ ...report, start: '2025-12-31T16:00:00-08:00', end: '2026-01-02T00:00:00.000Z' })));
  expect((await fetchHistoricalVessel('boat-one', query)).vessel_id).toBe('boat-one');
});
test('rejects wrong boat, wrong data mode, wrong dates and malformed report times', async () => {
  for (const change of [{ vessel_id: 'boat-two' }, { mode: 'synthetic' }, { start: '2025-12-31T00:00:00Z' }, { end: '2026-01-03T00:00:00Z' }, { start: 'invalid' }]) {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ ...report, ...change })));
    await expect(fetchHistoricalVessel('boat-one', query)).rejects.toThrow(/No report was saved/);
  }
});
