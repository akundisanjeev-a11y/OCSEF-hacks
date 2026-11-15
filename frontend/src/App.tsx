import { useState } from "react";
import { liveApi, sampleApi } from "./api/client";
import { CoastalImpact } from "./components/CoastalImpact";
import { HistoricalGlobe } from "./components/HistoricalGlobe";
import { VesselCheck } from "./components/VesselCheck";
import { Investigations } from "./components/Investigations";
import { Overview } from "./components/Overview";

const tabs = {
  overview: "Overview",
  historical: "GFW historical",
  lookup: "Check vessel ID",
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
        {(tab === "investigations" || tab === "impact") && <label className="inline-field source">
          <span>Backend</span>
          <select
            value={source}
            onChange={(e) => {
              setSource(e.target.value as Source);
              setSelectedId(null);
            }}
          >
            <option value="live">Case API (demo seeded)</option>
            <option value="sample">Sample data (no backend)</option>
          </select>
        </label>}
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
        {tab === "historical" && <HistoricalGlobe />}
        {tab === "lookup" && <VesselCheck />}
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
