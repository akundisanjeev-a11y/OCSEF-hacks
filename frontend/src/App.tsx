import { useState } from "react";
import { liveApi, sampleApi } from "./api/client";
import { DetectionLab } from "./components/DetectionLab";
import { InvestigationDashboard } from "./components/InvestigationDashboard";

type Tab = "investigation" | "detection";
type Source = "live" | "sample";

export function App() {
  const [tab, setTab] = useState<Tab>("investigation");
  const [source, setSource] = useState<Source>("live");
  const api = source === "live" ? liveApi : sampleApi;

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">GhostFleet</div>
        <nav className="tabs" aria-label="Screens">
          <button
            type="button"
            className={tab === "investigation" ? "active" : undefined}
            onClick={() => setTab("investigation")}
          >
            Investigation
          </button>
          <button
            type="button"
            className={tab === "detection" ? "active" : undefined}
            onClick={() => setTab("detection")}
          >
            Detection lab
          </button>
        </nav>
        <label className="inline-field source">
          <span>Backend</span>
          <select value={source} onChange={(e) => setSource(e.target.value as Source)}>
            <option value="live">Live API</option>
            <option value="sample">Sample data (no backend)</option>
          </select>
        </label>
      </header>

      <main className="content">
        {tab === "investigation" ? (
          <InvestigationDashboard key={source} api={api} />
        ) : (
          <DetectionLab key={source} api={api} />
        )}
      </main>
    </div>
  );
}
