"use client";

import { useMemo, useSyncExternalStore } from "react";
import { getAlertsSnapshot, parseAlerts, subscribeAlerts } from "./alerts";

export function useAlerts() {
  const raw = useSyncExternalStore(subscribeAlerts, getAlertsSnapshot, () => "[]");
  return useMemo(() => parseAlerts(raw), [raw]);
}
