import { afterEach, expect, test, vi } from "vitest";
import { streamHistoricalRisks, type VesselRisk } from "./historical";

const risk: VesselRisk = { vessel_id: "v-1", state: "flagged", flag_count: 1, missing_count: 0, indicators: [], cached: false };
const encoded = (event: unknown) => new TextEncoder().encode(JSON.stringify(event) + "\n");
const completion = { type: "complete", checked: 1, total: 1, remaining: 0, paused: false, elapsed_ms: 1 };
afterEach(() => vi.unstubAllGlobals());

test("streams a result immediately, handles split lines and validates completion", async () => {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const body = new ReadableStream<Uint8Array>({ start(value) { controller = value; } });
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(body)));
  const onResult = vi.fn();
  const promise = streamHistoricalRisks(["v-1"], "start", "end", onResult, new AbortController().signal);
  const line = encoded({ type: "result", result: risk });
  controller.enqueue(line.slice(0, 13)); controller.enqueue(line.slice(13));
  await vi.waitFor(() => expect(onResult).toHaveBeenCalledWith(risk));
  controller.enqueue(encoded(completion)); controller.close();
  expect((await promise).paused).toBe(false);
});

test("does not silently declare an interrupted or incomplete stream finished", async () => {
  for (const ending of ["", JSON.stringify({ ...completion, checked: 2, total: 2 }) + "\n"]) {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ type: "result", result: risk }) + "\n" + ending)));
    const onResult = vi.fn();
    await expect(streamHistoricalRisks(["v-1", "v-2"], "start", "end", onResult, new AbortController().signal)).rejects.toThrow(/Completed checks are saved/);
    expect(onResult).toHaveBeenCalledOnce();
  }
});

test("rejects a result belonging to a different requested vessel", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ type: "result", result: { ...risk, vessel_id: "wrong-vessel" } }) + "\n")));
  const onResult = vi.fn();
  await expect(streamHistoricalRisks(["v-1"], "start", "end", onResult, new AbortController().signal)).rejects.toThrow(/Unexpected vessel/);
  expect(onResult).not.toHaveBeenCalled();
});
