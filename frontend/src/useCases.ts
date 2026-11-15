import { useCallback, useEffect, useState } from "react";
import type { Api } from "./api/client";
import type { Case, DataMode, ReviewLevel } from "./api/types";

export type Load<T> =
  | { state: "idle" }
  | { state: "loading" }
  | { state: "error"; message: string }
  | { state: "ok"; data: T };

export const errorMessage = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function useCases(api: Api, dataMode: DataMode | "all") {
  const [list, setList] = useState<Load<Case[]>>({ state: "idle" });

  const reload = useCallback(async () => {
    setList({ state: "loading" });
    try {
      const res = await api.listCases(dataMode === "all" ? undefined : dataMode);
      setList({ state: "ok", data: res.cases });
    } catch (e) {
      setList({ state: "error", message: errorMessage(e) });
    }
  }, [api, dataMode]);

  useEffect(() => {
    reload();
  }, [reload]);

  return { list, reload };
}

export function useCase(api: Api, id: string | null) {
  const [detail, setDetail] = useState<Load<Case>>({ state: "idle" });

  useEffect(() => {
    if (!id) {
      setDetail({ state: "idle" });
      return;
    }
    let cancelled = false;
    setDetail({ state: "loading" });
    api.getCase(id).then(
      (data) => !cancelled && setDetail({ state: "ok", data }),
      (e) => !cancelled && setDetail({ state: "error", message: errorMessage(e) }),
    );
    return () => {
      cancelled = true;
    };
  }, [api, id]);

  return detail;
}

const order: Record<ReviewLevel, number> = { high: 0, review: 1, routine: 2 };

export const priorityRank = (c: Case) => (c.review_priority ? order[c.review_priority.level] : 3);
