import { useState } from "react";
import { HistoricalWorkspace } from "./HistoricalWorkspace";
import { GfwOverview } from "./components/GfwOverview";
import { VesselCheck } from "./components/VesselCheck";
import { Investigations } from "./components/Investigations";

const tabs = { overview: "Overview", investigations: "Investigations", lookup: "Check vessel ID" } as const;
type Tab = keyof typeof tabs;

export function App() {
  const [tab, setTab] = useState<Tab>("overview");
  const [filtersTarget, setFiltersTarget] = useState<HTMLDivElement | null>(null);
  return <HistoricalWorkspace><div className="app">
    <header className="topbar"><div className="brand">GHOSTFLEET</div><nav className="tabs" aria-label="Screens">
      {(Object.keys(tabs) as Tab[]).map(key => <button type="button" key={key} className={tab === key ? "active" : undefined} aria-current={tab === key ? "page" : undefined} onClick={() => setTab(key)}>{tabs[key]}</button>)}
    </nav><div className="header-filters" ref={setFiltersTarget} hidden={tab !== "overview"} /></header>
    <main className="content">
      <div hidden={tab !== "overview"}><GfwOverview filtersTarget={filtersTarget} onInvestigations={() => setTab("investigations")} /></div>
      {tab === "lookup" && <VesselCheck />}
      {tab === "investigations" && <Investigations onOverview={() => setTab("overview")} />}
    </main>
    <footer className="footnote">Powered by Global Fishing Watch. Historical observations and risk indicators support investigation; they do not establish illegal activity or fishing authorization.</footer>
  </div></HistoricalWorkspace>;
}
