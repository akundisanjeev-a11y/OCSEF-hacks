import { useCallback, useEffect, useState } from "react";
import type { Api } from "./api/client";
import type { Case, DataMode, ReviewLevel } from "./api/types";

// The state of anything being loaded from the backend: not started, in progress, failed, or done with its data.
// Screens switch on `state` to show a spinner message, an error box or the content.
export type Load<T> =
  | { state: "idle" }
  | { state: "loading" }
  | { state: "error"; message: string }
  | { state: "ok"; data: T };

// Gets a readable message out of whatever was thrown.
export const errorMessage = (e: unknown) => (e instanceof Error ? e.message : String(e));

// Hook: loads the list of cases for a data mode ("all" means no filter) and exposes a reload function.
export function useCases(api: Api, dataMode: DataMode | "all") {
  const [list, setList] = useState<Load<Case[]>>({ state: "idle" });

  // Fetch the cases, moving through loading, then ok or error. Recreated only when the api or data mode changes.
  const reload = useCallback(async () => {
    setList({ state: "loading" });
    try {
      const res = await api.listCases(dataMode === "all" ? undefined : dataMode);
      setList({ state: "ok", data: res.cases });
    } catch (e) {
      setList({ state: "error", message: errorMessage(e) });
    }
  }, [api, dataMode]);

  // Load automatically on first show and whenever the api or data mode changes.
  useEffect(() => {
    reload();
  }, [reload]);

  return { list, reload };
}

// Hook: loads one case by id. With no id it stays idle, so "nothing selected" shows an empty panel.
export function useCase(api: Api, id: string | null) {
  const [detail, setDetail] = useState<Load<Case>>({ state: "idle" });

  // Fetch the case whenever the selected id changes.
  useEffect(() => {
    if (!id) {
      setDetail({ state: "idle" });
      return;
    }
    // If the user picks another case before this one arrives, ignore the old answer.
    let cancelled = false;
    setDetail({ state: "loading" });
    api.getCase(id).then(
      (data) => !cancelled && setDetail({ state: "ok", data }),
      (e) => !cancelled && setDetail({ state: "error", message: errorMessage(e) }),
    );
    // Cleanup runs when the id changes or the screen closes: mark this request as stale.
    return () => {
      cancelled = true;
    };
  }, [api, id]);

  return detail;
}

// Sort order for review levels: the lower the number, the more urgent.
const order: Record<ReviewLevel, number> = { high: 0, review: 1, routine: 2 };

// A case's urgency as a number for sorting. Cases with no review priority sort last.
export const priorityRank = (c: Case) => (c.review_priority ? order[c.review_priority.level] : 3);
