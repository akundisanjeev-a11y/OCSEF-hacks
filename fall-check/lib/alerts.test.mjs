// Node 24: node --test lib/alerts.test.mjs
import assert from "node:assert/strict";
import { test } from "node:test";
import { acknowledgeAlert, createTestAlert, getAlertsSnapshot, parseAlerts, subscribeAlerts } from "./alerts.ts";

// A small browser stand-in for testing storage and competing operations.
const values = new Map();
const browser = new EventTarget();
browser.localStorage = {
  getItem: (key) => values.get(key) ?? null,
  setItem: (key, value) => values.set(key, value),
};
globalThis.window = browser;
globalThis.BroadcastChannel = undefined;
let queue = Promise.resolve();
Object.defineProperty(globalThis, "navigator", { configurable: true, value: {
  locks: { request: (_key, callback) => {
    const operation = queue.then(callback);
    queue = operation.catch(() => {});
    return operation;
  } },
} });

test("local alert lifecycle, duplicate resolution, and stale acknowledgment", async () => {
  let notifications = 0;
  const unsubscribe = subscribeAlerts(() => { notifications++; });
  const input = { id: "check-in-1", contactName: "Alex", reason: "help_requested", trigger: "simulation" };
  const [help, timeout] = await Promise.all([
    createTestAlert(input),
    createTestAlert({ ...input, reason: "no_response" }),
  ]);
  assert.equal(help.id, timeout.id);
  assert.equal(timeout.reason, "help_requested");
  assert.equal(parseAlerts(getAlertsSnapshot()).length, 1);

  // A later event and an old acknowledgment can arrive together.
  await Promise.all([
    createTestAlert({ ...input, id: "check-in-2", reason: "no_response", contactName: "Jordan" }),
    acknowledgeAlert("check-in-1", "Alex"),
  ]);
  const recovered = parseAlerts(getAlertsSnapshot());
  assert.equal(recovered.length, 2);
  assert.ok(recovered[0].acknowledgedAt);
  assert.equal(recovered[1].acknowledgedAt, null);
  assert.equal(recovered[1].contactName, "Jordan");
  const again = await acknowledgeAlert("check-in-1", "Alex");
  assert.equal(again.acknowledgedAt, recovered[0].acknowledgedAt);
  await assert.rejects(acknowledgeAlert("check-in-2", "Alex"));
  await assert.rejects(acknowledgeAlert("missing-id", "Alex"));
  await assert.rejects(createTestAlert({ ...input, id: "" }));
  assert.ok(notifications > 0);
  unsubscribe();
});

test("malformed saved data does not crash reads", () => {
  assert.deepEqual(parseAlerts("not json"), []);
  assert.deepEqual(parseAlerts('{"id":"wrong shape"}'), []);
  assert.deepEqual(parseAlerts('[null,{"id":1}]'), []);
});

test("storage write failure is reported instead of claiming delivery", async () => {
  const save = browser.localStorage.setItem;
  browser.localStorage.setItem = () => { throw new Error("Storage blocked"); };
  try {
    await assert.rejects(createTestAlert({ id: "blocked", contactName: "Alex", reason: "no_response", trigger: "manual" }), /Storage blocked/);
    assert.equal(parseAlerts(getAlertsSnapshot()).some((a) => a.id === "blocked"), false);
  } finally {
    browser.localStorage.setItem = save;
  }
});
