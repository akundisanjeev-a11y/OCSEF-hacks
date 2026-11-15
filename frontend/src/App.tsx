import { useState } from "react";
import { liveApi, sampleApi } from "./api/client";
import { CoastalImpact } from "./components/CoastalImpact";
import { HistoricalGlobe } from "./components/HistoricalGlobe";
import { VesselCheck } from "./components/VesselCheck";
import { Investigations } from "./components/Investigations";
import { Overview } from "./components/Overview";

// The screens. Keys are the ids kept in state; values are the labels shown in the top bar.
const tabs = {
  overview: "Overview",
  historical: "GFW historical",
  lookup: "Check vessel ID",
  investigations: "Investigations",
  impact: "Coastal impact",
} as const;

// The tab ids ("overview" | "detection" | ...), derived from the object above so the two never drift apart.
type Tab = keyof typeof tabs;

// Where data comes from: the real FastAPI backend, or the saved sample files (works with no backend running).
type Source = "live" | "sample";

// Root component: the top bar (tabs and backend switch) plus whichever screen is selected.
export function App() {
  // Which screen is showing.
  const [tab, setTab] = useState<Tab>("overview");
  // Live backend or sample data.
  const [source, setSource] = useState<Source>("live");
  // The case the user picked on the globe, list or report. Kept here so every screen opens the same case.
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Choose the matching set of API functions for the selected data source.
  const api = source === "live" ? liveApi : sampleApi;

  return (
    <div className="app">
      {/* Top bar: brand name, screen tabs and the backend selector. */}
      <header className="topbar">
        <div className="brand">GHOSTFLEET</div>
        {/* One button per screen; the active one is highlighted. */}
        <nav className="tabs" aria-label="Screens">
          {(Object.keys(tabs) as Tab[]).map((t) => (
            <button key={t} type="button" className={tab === t ? "active" : undefined} onClick={() => setTab(t)}>
              {tabs[t]}
            </button>
          ))}
        </nav>
        {/* Switch between the case API and sample data, shown only on the two tabs that use it. Changing it clears the selected case. */}
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

      {/* The selected screen. key={source} makes each screen reload its data when the source changes. */}
      <main className="content">
        {/* Globe, filters and vessel list. Opening a case's investigation jumps to that tab. */}
        {tab === "overview" && (
          <Overview
            key={source}
            api={api}
            selectedId={selectedId}
            onSelect={setSelectedId}
            onOpenInvestigation={() => setTab("investigations")}
          />
        )}
        {/* Globe of published Global Fishing Watch historical activity. */}
        {tab === "historical" && <HistoricalGlobe />}
        {/* Look up one vessel by its ID number. */}
        {tab === "lookup" && <VesselCheck />}
        {/* Priority queue with the evidence trail for the selected case. */}
        {tab === "investigations" && (
          <Investigations key={source} api={api} selectedId={selectedId} onSelect={setSelectedId} />
        )}
        {/* Summary report. Clicking a case there selects it and opens it in Investigations. */}
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

      {/* Standing reminder that these are leads for human review, not accusations. */}
      <footer className="footnote">
        Vessel presence alone does not establish fishing, and an unmatched AIS observation is not proof of illegal
        fishing. Fictional records are labeled as fictional.
      </footer>
    </div>
  );
}
