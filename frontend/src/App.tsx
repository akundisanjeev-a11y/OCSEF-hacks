import { useState } from "react";
import { HistoricalWorkspace } from "./HistoricalWorkspace";
import { GfwOverview } from "./components/GfwOverview";
import { CoastalImpact } from "./components/CoastalImpact";
import { VesselCheck } from "./components/VesselCheck";
import { Investigations } from "./components/Investigations";

const tabs = { overview: "Overview", lookup: "Check vessel ID", investigations: "Investigations", impact: "Coastal impact" } as const;
type Tab = keyof typeof tabs;

// Root component: the top bar (tabs and backend switch) plus whichever screen is selected.
export function App() {
  // Which screen is showing.
  const [tab, setTab] = useState<Tab>("overview");
  return <HistoricalWorkspace><div className="app">
    <header className="topbar"><div className="brand">GHOSTFLEET</div><nav className="tabs" aria-label="Screens">
      {(Object.keys(tabs) as Tab[]).map(key => <button type="button" key={key} className={tab === key ? "active" : undefined} aria-current={tab === key ? "page" : undefined} onClick={() => setTab(key)}>{tabs[key]}</button>)}
    </nav><span className="source-badge">Global Fishing Watch · historical</span></header>
    <main className="content">
      <div hidden={tab !== "overview"}><GfwOverview onInvestigations={() => setTab("investigations")} /></div>
      {tab === "lookup" && <VesselCheck />}
      {tab === "investigations" && <Investigations onOverview={() => setTab("overview")} />}
      {tab === "impact" && <CoastalImpact onOverview={() => setTab("overview")} onInvestigations={() => setTab("investigations")} />}
    </main>
    <footer className="footnote">Powered by Global Fishing Watch. Historical observations and risk indicators support investigation; they do not establish illegal activity or fishing authorization.</footer>
  </div></HistoricalWorkspace>;
}
