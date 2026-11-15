import { useState } from "react";
import { liveApi, sampleApi } from "./api/client";
import { CoastalImpact } from "./components/CoastalImpact";
import { DetectionLab } from "./components/DetectionLab";
import { Investigations } from "./components/Investigations";
import { Overview } from "./components/Overview";

const tabs = {
  overview: "Overview",
  detection: "Detection lab",
  investigations: "Investigations",
  impact: "Coastal impact",
} as const;

type Tab = keyof typeof tabs;
type Source = "live" | "sample";

export function App() {
  const [tab, setTab] = useState<Tab>("overview");
  const [source, setSource] = useState<Source>("live");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const api = source === "live" ? liveApi : sampleApi;

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">GHOSTFLEET</div>
        <nav className="tabs" aria-label="Screens">
          {(Object.keys(tabs) as Tab[]).map((t) => (
            <button key={t} type="button" className={tab === t ? "active" : undefined} onClick={() => setTab(t)}>
              {tabs[t]}
            </button>
          ))}
        </nav>
        <label className="inline-field source">
          <span>Backend</span>
          <select
            value={source}
            onChange={(e) => {
              setSource(e.target.value as Source);
              setSelectedId(null);
            }}
          >
            <option value="live">Live API</option>
            <option value="sample">Sample data (no backend)</option>
          </select>
        </label>
      </header>

      <main className="content">
        {tab === "overview" && (
          <Overview
            key={source}
            api={api}
            selectedId={selectedId}
            onSelect={setSelectedId}
            onOpenInvestigation={() => setTab("investigations")}
          />
        )}
        {tab === "detection" && <DetectionLab key={source} api={api} />}
        {tab === "investigations" && (
          <Investigations key={source} api={api} selectedId={selectedId} onSelect={setSelectedId} />
        )}
        {tab === "impact" && (
          <CoastalImpact
            key={source}
            api={api}
            onOpenCase={(id) => {
              setSelectedId(id);
              setTab("investigations");
            }}
          />
        )}
      </main>

      <footer className="footnote">
        Vessel presence alone does not establish fishing, and an unmatched AIS observation is not proof of illegal
        fishing. Fictional records are labeled as fictional.
      </footer>
    </div>
  );
}
