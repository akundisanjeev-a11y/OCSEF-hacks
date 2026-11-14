import { useCallback, useEffect, useState } from "react";
import { ApiError, type Api } from "../api/client";
import type { Case, DataMode } from "../api/types";
import { dataModeLabel } from "../format";
import { CaseDetail } from "./CaseDetail";
import { CaseList } from "./CaseList";

type Load<T> = { state: "idle" } | { state: "loading" } | { state: "error"; message: string } | { state: "ok"; data: T };

const errorMessage = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function InvestigationDashboard({ api }: { api: Api }) {
  const [dataMode, setDataMode] = useState<DataMode>("synthetic");
  const [list, setList] = useState<Load<Case[]>>({ state: "idle" });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<Load<Case>>({ state: "idle" });
  const [demo, setDemo] = useState<Load<string[]>>({ state: "idle" });

  const loadCases = useCallback(async () => {
    setList({ state: "loading" });
    try {
      const res = await api.listCases(dataMode);
      setList({ state: "ok", data: res.cases });
    } catch (e) {
      setList({ state: "error", message: errorMessage(e) });
    }
  }, [api, dataMode]);

  useEffect(() => {
    loadCases();
  }, [loadCases]);

  useEffect(() => {
    if (!selectedId) {
      setDetail({ state: "idle" });
      return;
    }
    let cancelled = false;
    setDetail({ state: "loading" });
    api.getCase(selectedId).then(
      (data) => !cancelled && setDetail({ state: "ok", data }),
      (e) => !cancelled && setDetail({ state: "error", message: errorMessage(e) }),
    );
    return () => {
      cancelled = true;
    };
  }, [api, selectedId]);

  async function runDemo() {
    setDemo({ state: "loading" });
    try {
      const res = await api.runDemo();
      setDemo({ state: "ok", data: res.case_ids });
      if (dataMode !== "synthetic") setDataMode("synthetic");
      else await loadCases();
    } catch (e) {
      const message =
        e instanceof ApiError && e.status === 404
          ? "The backend has no POST /demo/run route yet. The cases below are the ones it loaded at startup."
          : errorMessage(e);
      setDemo({ state: "error", message });
    }
  }

  const cases = list.state === "ok" ? list.data : [];

  return (
    <div className="investigation">
      <div className="toolbar">
        <label className="inline-field">
          <span>Data</span>
          <select value={dataMode} onChange={(e) => setDataMode(e.target.value as DataMode)}>
            {(Object.keys(dataModeLabel) as DataMode[]).map((m) => (
              <option key={m} value={m}>
                {dataModeLabel[m]}
              </option>
            ))}
          </select>
        </label>
        <button type="button" onClick={loadCases} disabled={list.state === "loading"}>
          Refresh
        </button>
        <button type="button" className="primary" onClick={runDemo} disabled={demo.state === "loading"}>
          {demo.state === "loading" ? "Running…" : "Run fictional demo"}
        </button>
        <div className="toolbar-note" role="status">
          {demo.state === "ok" && `Demo run returned ${demo.data.length} case ID${demo.data.length === 1 ? "" : "s"}.`}
          {demo.state === "error" && <span className="error-text">{demo.message}</span>}
        </div>
      </div>

      <div className="split">
        <section className="panel list-panel">
          <div className="panel-head">
            <h2>Cases</h2>
            <span className="muted">{list.state === "ok" ? `${cases.length} total` : ""}</span>
          </div>
          {list.state === "loading" && <p className="empty">Loading cases…</p>}
          {list.state === "error" && (
            <div className="notice error">
              <strong>Could not load cases.</strong> {list.message}
            </div>
          )}
          {list.state === "ok" && cases.length === 0 && (
            <p className="empty">
              No {dataModeLabel[dataMode].toLowerCase()} cases yet.
              {dataMode === "synthetic" && " Use Run fictional demo to generate them."}
            </p>
          )}
          {list.state === "ok" && cases.length > 0 && (
            <CaseList cases={cases} selectedId={selectedId} onSelect={setSelectedId} />
          )}
        </section>

        <section className="panel detail-panel">
          {detail.state === "idle" && <p className="empty">Select a case to see its evidence.</p>}
          {detail.state === "loading" && <p className="empty">Loading case…</p>}
          {detail.state === "error" && (
            <div className="notice error">
              <strong>Could not load case {selectedId}.</strong> {detail.message}
            </div>
          )}
          {detail.state === "ok" && <CaseDetail data={detail.data} />}
        </section>
      </div>
    </div>
  );
}
