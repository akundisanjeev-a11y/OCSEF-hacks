// Local demo transport only. No camera footage, audio, phone delivery, or server.
export type AlertReason = "help_requested" | "no_response";
export type AlertTrigger = "camera" | "simulation" | "manual";
export type TestAlert = {
  id: string;
  contactName: string;
  createdAt: string;
  reason: AlertReason;
  trigger: AlertTrigger;
  acknowledgedAt: string | null;
};

export const SAMPLE_CONTACTS = ["Alex (sample teammate)", "Jordan (sample teammate)"];
const STORAGE_KEY = "fall-check.test-alerts.v1";
const CHANNEL = "fall-check.test-alerts.v1";
const LOCAL_EVENT = "fall-check-alerts-changed";

export function parseAlerts(raw: string | null): TestAlert[] {
  if (!raw) return [];
  try {
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value)) return [];
    return value.filter((a): a is TestAlert =>
      a !== null && typeof a === "object" &&
      typeof a.id === "string" && typeof a.contactName === "string" &&
      typeof a.createdAt === "string" && Number.isFinite(Date.parse(a.createdAt)) &&
      ["help_requested", "no_response"].includes(a.reason) &&
      ["camera", "simulation", "manual"].includes(a.trigger) &&
      (a.acknowledgedAt === null || (typeof a.acknowledgedAt === "string" &&
        Number.isFinite(Date.parse(a.acknowledgedAt)))));
  } catch {
    return [];
  }
}

export function getAlertsSnapshot(): string {
  try {
    return window.localStorage.getItem(STORAGE_KEY) ?? "[]";
  } catch {
    return "[]";
  }
}

export function subscribeAlerts(onChange: () => void): () => void {
  const onStorage = (event: StorageEvent) => {
    if (event.key === STORAGE_KEY || event.key === null) onChange();
  };
  const channel = typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel(CHANNEL);
  // Messages are notifications only; storage is the source of truth.
  if (channel) channel.onmessage = onChange;
  window.addEventListener("storage", onStorage);
  window.addEventListener(LOCAL_EVENT, onChange);
  return () => {
    channel?.close();
    window.removeEventListener("storage", onStorage);
    window.removeEventListener(LOCAL_EVENT, onChange);
  };
}

async function updateAlerts<T>(change: (alerts: TestAlert[]) => { alerts: TestAlert[]; result: T }): Promise<T> {
  // Chrome on localhost supports Web Locks. Serialize writes across both windows
  // so an acknowledgment and a new alert cannot overwrite each other.
  if (!navigator.locks) throw new Error("Use desktop Chrome on localhost for local test alerts.");
  return navigator.locks.request(STORAGE_KEY, () => {
    const current = parseAlerts(window.localStorage.getItem(STORAGE_KEY));
    const { alerts, result } = change(current);
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(alerts));
    window.dispatchEvent(new Event(LOCAL_EVENT));
    if (typeof BroadcastChannel !== "undefined") {
      const channel = new BroadcastChannel(CHANNEL);
      channel.postMessage("changed");
      channel.close();
    }
    return result;
  });
}

// Capture contactName and id when check-in starts. Reuse that id for every
// resolution attempt: the first alert wins even if Help and timeout race.
export async function createTestAlert(input: Pick<TestAlert, "id" | "contactName" | "reason" | "trigger">): Promise<TestAlert> {
  if (!input.id.trim() || !input.contactName.trim() ||
      !["help_requested", "no_response"].includes(input.reason) ||
      !["camera", "simulation", "manual"].includes(input.trigger)) {
    throw new Error("An event ID, contact, reason, and trigger are required.");
  }
  return updateAlerts((alerts) => {
    const existing = alerts.find((alert) => alert.id === input.id);
    if (existing) return { alerts, result: existing };
    const alert: TestAlert = {
      ...input, createdAt: new Date().toISOString(), acknowledgedAt: null,
    };
    return { alerts: [...alerts, alert], result: alert };
  });
}

export async function acknowledgeAlert(id: string, contactName: string): Promise<TestAlert> {
  return updateAlerts((alerts) => {
    const existing = alerts.find((alert) => alert.id === id && alert.contactName === contactName);
    if (!existing) throw new Error("This contact's alert could not be found.");
    const updated = { ...existing, acknowledgedAt: existing.acknowledgedAt ?? new Date().toISOString() };
    return {
      alerts: alerts.map((alert) => alert.id === id ? updated : alert),
      result: updated,
    };
  });
}
