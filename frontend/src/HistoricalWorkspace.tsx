import { createContext, useContext, useState, useCallback, useRef, useEffect, type ReactNode } from "react";
import type { HistoricalAreaResult, HistoricalEvidence, VesselRisk } from "./api/historical";
import { streamHistoricalRisks } from "./api/historical";

type Workspace = {
  result: HistoricalAreaResult | null;
  risks: Record<string, VesselRisk>;
  reports: HistoricalEvidence[];
  selectedReport: HistoricalEvidence | null;
  setResult: (result: HistoricalAreaResult | null) => void;
  screening: boolean;
  screenError: string;
  screenMessage: string;
  startScreening: () => Promise<void>;
  stopScreening: () => void;
  saveReport: (report: HistoricalEvidence) => void;
  selectReport: (report: HistoricalEvidence | null) => void;
};
const Context = createContext<Workspace | null>(null);
export function HistoricalWorkspace({ children }: { children: ReactNode }) {
  const [result, setResultState] = useState<HistoricalAreaResult | null>(null);
  const [risks, setRisks] = useState<Record<string, VesselRisk>>({});
  const [reports, setReports] = useState<HistoricalEvidence[]>([]);
  const [selectedReport, selectReport] = useState<HistoricalEvidence | null>(null);
  const [screening, setScreening] = useState(false);
  const [screenError, setScreenError] = useState("");
  const [screenMessage, setScreenMessage] = useState("");
  const current = useRef<HistoricalAreaResult | null>(null);
  const currentRisks = useRef<Record<string, VesselRisk>>({});
  const active = useRef<AbortController | null>(null);
  const version = useRef(0);
  const areaKey = (data: HistoricalAreaResult | null) => data ? JSON.stringify([data.mode, data.layer, data.bounds, data.applied_filters, data.start, data.end, data.dataset, data.vessels.map(vessel => vessel.vessel_id)]) : "";
  const setResult = useCallback((next: HistoricalAreaResult | null) => {
    if (areaKey(current.current) !== areaKey(next)) {
      version.current++; active.current?.abort(); active.current = null;
      currentRisks.current = {}; setRisks({}); setScreening(false); setScreenError(""); setScreenMessage("");
      selectReport(null);
    }
    current.current = next; setResultState(next);
  }, []);
  function stopScreening() {
    version.current++; active.current?.abort(); active.current = null;
    setScreening(false); setScreenMessage("Stopped. Completed checks are saved; resume to check the remaining boats.");
  }
  useEffect(() => () => { version.current++; active.current?.abort(); }, []);
  async function startScreening() {
    const area = current.current;
    if (!area || active.current) return;
    const pending = area.vessels.filter(vessel => !currentRisks.current[vessel.vessel_id] || currentRisks.current[vessel.vessel_id].error || currentRisks.current[vessel.vessel_id].state === "unknown" || currentRisks.current[vessel.vessel_id].missing_count > 0);
    if (!pending.length) return;
    const controller = new AbortController(); active.current = controller;
    const run = ++version.current;
    setScreening(true); setScreenError(""); setScreenMessage("");
    try {
      // Keep one connection per run. The backend fills four worker slots as
      // each boat finishes, rather than waiting for a whole batch of sixteen.
      for (let offset = 0; offset < pending.length; offset += 5000) {
        const done = await streamHistoricalRisks(pending.slice(offset, offset + 5000).map(vessel => vessel.vessel_id), area.start, area.end, risk => {
          if (run !== version.current || controller.signal.aborted) return;
          currentRisks.current = { ...currentRisks.current, [risk.vessel_id]: risk };
          setRisks(currentRisks.current);
        }, controller.signal);
        if (run !== version.current || controller.signal.aborted) return;
        if (done.paused) { setScreenError("GFW access, rate limit or availability interrupted screening. Completed checks are saved. Retry the remaining checks after resolving the provider issue."); return; }
      }
      setScreenMessage("Screening finished. Missing information stays unknown; warning signs are leads for review.");
    } catch (error) {
      if (run === version.current && !controller.signal.aborted) setScreenError(error instanceof Error ? error.message : "Could not reach screening. Completed checks are saved.");
    } finally {
      if (run === version.current) { active.current = null; setScreening(false); }
    }
  }
  function saveReport(report: HistoricalEvidence) {
    setReports(previous => [report, ...previous.filter(row => !(row.vessel_id === report.vessel_id && row.start === report.start && row.end === report.end))]);
    selectReport(report);
  }
  return <Context.Provider value={{ result, risks, reports, selectedReport, setResult, screening, screenError, screenMessage, startScreening, stopScreening, saveReport, selectReport }}>{children}</Context.Provider>;
}
export const useHistoricalWorkspace = () => useContext(Context);
