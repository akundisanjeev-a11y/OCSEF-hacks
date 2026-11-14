import assert from "node:assert/strict";
import { test } from "node:test";
import { startSpokenCheckIn } from "./spokenCheckIn.ts";

function fixture(t) {
  let now = 0;
  let queuedTick;
  const finishes = [];
  const spoken = [];
  const ticks = [];
  t.mock.method(performance, "now", () => now);
  const previousWindow = globalThis.window;
  const previousDocument = globalThis.document;
  const previousUtterance = globalThis.SpeechSynthesisUtterance;
  class Utterance { constructor(text) { this.text = text; } }
  globalThis.SpeechSynthesisUtterance = Utterance;
  globalThis.document = new EventTarget();
  globalThis.window = {
    setTimeout(callback) { queuedTick = callback; return 1; },
    clearTimeout() {},
    SpeechSynthesisUtterance: Utterance,
    speechSynthesis: { speak(u) { spoken.push(u); }, cancel() {} },
  };
  t.after(() => {
    globalThis.window = previousWindow;
    globalThis.document = previousDocument;
    globalThis.SpeechSynthesisUtterance = previousUtterance;
  });
  const check = startSpokenCheckIn({
    onTick: (seconds) => ticks.push(seconds),
    onFinish: (reason) => finishes.push(reason),
    onSpeechUnavailable: () => assert.fail("Expected speech support"),
  });
  return { check, finishes, spoken, ticks, at(ms) { now = ms; }, tick() { queuedTick(); } };
}

test("OK cancels even when a late Help click and an old timeout callback arrive", (t) => {
  const f = fixture(t);
  f.at(14999);
  f.check.respond("ok");
  f.check.respond("help_requested");
  f.at(15000);
  f.tick();
  assert.deepEqual(f.finishes, ["ok"]);
});

test("Help wins before the deadline; later answers or ticks cannot send again", (t) => {
  const f = fixture(t);
  f.at(14999);
  f.check.respond("help_requested");
  f.check.respond("ok");
  f.at(15050);
  f.tick();
  assert.deepEqual(f.finishes, ["help_requested"]);
});

test("a click at the deadline yields one timeout even if the timer was delayed", (t) => {
  const f = fixture(t);
  f.at(15000);
  f.check.respond("ok");
  f.tick();
  assert.deepEqual(f.finishes, ["no_response"]);
});

test("slow speech skips stale numbers; disposal stops later ticks and alerts", (t) => {
  const f = fixture(t);
  f.at(1000);
  f.tick();
  assert.deepEqual(f.ticks, [14]);
  assert.equal(f.spoken.length, 1);
  f.spoken[0].onend();
  f.at(4000);
  f.tick();
  assert.equal(f.spoken[1].text, "11");
  f.check.dispose();
  f.at(16000);
  f.tick();
  assert.deepEqual(f.finishes, []);
  assert.equal(f.spoken.length, 2);
});
