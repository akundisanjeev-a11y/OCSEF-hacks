import { useMemo, useState, type ReactNode } from "react";
import { ApiError, sampleApi, type Api } from "../api/client";
import { GfwOverview } from "./GfwOverview";
import type { AuthorizationStatus, DataMode, IdentityStatus, ReviewLevel } from "../api/types";
import { authorizationLabel, dataModeLabel, identityLabel, registration, reviewLabel } from "../format";
import { errorMessage, useCase, useCases, type Load } from "../useCases";
import { nearestZone } from "../zones";
import { CaseDetail } from "./CaseDetail";
import { CaseList } from "./CaseList";
import { CaseMap, type Area, type Located } from "./CaseMap";

type Proximity = "any" | "inside" | "10" | "25" | "50";

const proximityLabel: Record<Exclude<Proximity, "any">, string> = {
  inside: "Inside a zone",
  "10": "Within 10 km",
  "25": "Within 25 km",
  "50": "Within 50 km",
};

function Filter({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <label className="filter">
      <span>{label}</span>
      {children}
    </label>
  );
}

function Select<T extends string>(props: {
  label: string;
  value: T | "all";
  allLabel: string;
  options: Record<T, string>;
  onChange: (v: T | "all") => void;
}) {
  return (
    <Filter label={props.label}>
      <select value={props.value} onChange={(e) => props.onChange(e.target.value as T | "all")}>
        <option value="all">{props.allLabel}</option>
        {(Object.keys(props.options) as T[]).map((k) => (
          <option key={k} value={k}>
            {props.options[k]}
          </option>
        ))}
      </select>
    </Filter>
  );
}

interface Props {
  api: Api;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onOpenInvestigation: () => void;
}

export function Overview(props: Props) {
  const [mode, setMode] = useState<"gfw" | "fictional">("gfw");
  return <>
    <div className="toolbar"><label className="inline-field"><span>Overview data</span><select value={mode} onChange={(e) => setMode(e.target.value as "gfw" | "fictional")}><option value="gfw">Global Fishing Watch · historical</option><option value="fictional">Fictional cases · five located near Ghana</option></select></label><span className="muted">{mode === "gfw" ? "Area selection queries GFW; a backend token is required." : "Fixed sample cases, not newly detected vessels."}</span></div>
    {mode === "gfw" ? <GfwOverview /> : <DemoOverview {...props} api={sampleApi} />}
  </>;
}

function DemoOverview({ api, selectedId, onSelect, onOpenInvestigation }: Props) {
  const [dataMode, setDataMode] = useState<DataMode | "all">("all");
  const [status, setStatus] = useState<AuthorizationStatus | "all">("all");
  const [identity, setIdentity] = useState<IdentityStatus | "all">("all");
  const [review, setReview] = useState<ReviewLevel | "all">("all");
  const [proximity, setProximity] = useState<Proximity>("any");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [minScore, setMinScore] = useState(0);
  const [area, setArea] = useState<Area | null>(null);
  const [demo, setDemo] = useState<Load<string[]>>({ state: "idle" });

  const { list, reload } = useCases(api, dataMode);
  const detail = useCase(api, selectedId);

  async function runDemo() {
    setDemo({ state: "loading" });
    try {
      const res = await api.runDemo();
      setDemo({ state: "ok", data: res.case_ids });
      await reload();
    } catch (e) {
      const message =
        e instanceof ApiError && e.status === 404
          ? "The backend has no POST /demo/run route yet. These are the cases it loaded at startup."
          : errorMessage(e);
      setDemo({ state: "error", message });
    }
  }

  const all = list.state === "ok" ? list.data : [];

  const cases = useMemo(
    () =>
      !area ? [] : all.filter((c) => {
        const o = c.observation;
        if (status !== "all" && c.authorization.status !== status) return false;
        if (identity !== "all" && o.identity_status !== identity) return false;
        if (review !== "all" && c.review_priority?.level !== review) return false;
        if (o.detection_confidence < minScore) return false;
        if (from || to) {
          const day = o.captured_at?.slice(0, 10);
          if (!day || (from && day < from) || (to && day > to)) return false;
        }
        if (proximity !== "any") {
          const z = nearestZone(o.position);
          if (!z || (proximity === "inside" ? !z.inside : z.km > Number(proximity))) return false;
        }
        if (area) {
          const p = o.position;
          if (!p || p.lon < area.west || p.lon > area.east || p.lat < area.south || p.lat > area.north) return false;
        }
        return true;
      }),
    [all, status, identity, review, minScore, from, to, proximity, area],
  );

  const groups = useMemo(() => {
    const byKey = new Map<string, Located>();
    for (const c of cases) {
      const p = c.observation.position;
      if (!p) continue;
      const key = `${p.lat},${p.lon}`;
      const g = byKey.get(key) ?? { key, lat: p.lat, lon: p.lon, cases: [] };
      g.cases.push(c);
      byKey.set(key, g);
    }
    return [...byKey.values()];
  }, [cases]);

  const count = (s: AuthorizationStatus) => cases.filter((c) => c.authorization.status === s).length;
  const reg = (r: ReturnType<typeof registration>) =>
    cases.filter((c) => registration(c.observation.identity_status) === r).length;
  const filtersActive =
    status !== "all" ||
    identity !== "all" ||
    review !== "all" ||
    proximity !== "any" ||
    from !== "" ||
    to !== "" ||
    minScore > 0;

  function resetFilters() {
    setStatus("all");
    setIdentity("all");
    setReview("all");
    setProximity("any");
    setFrom("");
    setTo("");
    setMinScore(0);
  }

  return (
    <div className="dash">
      <aside className="panel filters">
        <div className="panel-head">
          <h2>Filters</h2>
        </div>
        <div className="filter-body">
          <Select label="Data source" value={dataMode} allLabel="All sources" options={dataModeLabel} onChange={setDataMode} />
          <div className="filter">
            <span>Capture date (UTC)</span>
            <div className="date-range">
              <input type="date" aria-label="From date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} />
              <input type="date" aria-label="To date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} />
            </div>
          </div>
          <Select label="AIS match status" value={identity} allLabel="All vessels" options={identityLabel} onChange={setIdentity} />
          <Select label="Authorization" value={status} allLabel="All statuses" options={authorizationLabel} onChange={setStatus} />
          <Select label="Review priority" value={review} allLabel="All levels" options={reviewLabel} onChange={setReview} />
          <Filter label="Fishing-zone proximity">
            <select value={proximity} onChange={(e) => setProximity(e.target.value as Proximity)}>
              <option value="any">Any distance</option>
              {(Object.keys(proximityLabel) as Exclude<Proximity, "any">[]).map((k) => (
                <option key={k} value={k}>
                  {proximityLabel[k]}
                </option>
              ))}
            </select>
          </Filter>
          <Filter
            label={
              <>
                Detection score threshold <b>{Math.round(minScore * 100)}%</b>
              </>
            }
          >
            <input type="range" min={0} max={1} step={0.05} value={minScore} onChange={(e) => setMinScore(Number(e.target.value))} />
          </Filter>
          <div className="filter">
            <span>Area</span>
            <div className="area-text">
              {area ? (
                <span className="mono">
                  {area.south.toFixed(2)}° to {area.north.toFixed(2)}° lat
                  <br />
                  {area.west.toFixed(2)}° to {area.east.toFixed(2)}° lon
                </span>
              ) : (
                <span className="muted">None yet. Use Select area on the globe.</span>
              )}
            </div>
          </div>
          <button type="button" onClick={resetFilters} disabled={!filtersActive}>
            Reset filters
          </button>
        </div>
      </aside>

      <section className="panel map-panel">
        <CaseMap groups={groups} selectedId={selectedId} onSelect={onSelect} area={area} onAreaChange={setArea} />
      </section>

      <aside className="panel case-panel">
        {detail.state === "idle" && (
          <>
            <div className="panel-head">
              <h2>Case</h2>
            </div>
            <p className="empty">Select a marker on the map or a row in the case list to see its evidence.</p>
          </>
        )}
        {detail.state === "loading" && <p className="empty">Loading case…</p>}
        {detail.state === "error" && (
          <div className="notice error">
            <strong>Could not load case {selectedId}.</strong> {detail.message}
          </div>
        )}
        {detail.state === "ok" && (
          <CaseDetail data={detail.data} onClose={() => onSelect(null)} onOpenInvestigation={onOpenInvestigation} />
        )}
      </aside>

      <section className="panel stats">
        <div className="panel-head">
          <h2>Vessels in selected area</h2>
          {area && filtersActive && <span className="muted">Filtered</span>}
        </div>
        <div className="stat-row">
          <div className="stat">
            <strong>{area ? cases.length : "—"}</strong>
            <span>Detected vessels</span>
          </div>
          <div className="stat marker-registered">
            <strong>{area ? reg("registered") : "—"}</strong>
            <span>AIS matched</span>
          </div>
          <div className="stat marker-unregistered">
            <strong>{area ? reg("unregistered") : "—"}</strong>
            <span>No AIS match</span>
          </div>
          <div className="stat marker-unresolved">
            <strong>{area ? reg("unresolved") : "—"}</strong>
            <span>Unresolved identity</span>
          </div>
          <div className="stat status-potential_violation">
            <strong>{area ? count("potential_violation") : "—"}</strong>
            <span>Potential violation</span>
          </div>
        </div>
        <p className="stat-note muted">
          AIS matched means a detection matched an AIS track. No AIS match means AIS coverage was adequate and
          no track matched. Unresolved covers ambiguous matches and missing data.
        </p>
      </section>

      <section className="panel list-panel">
        <div className="panel-head">
          <h2>Vessels</h2>
          <div className="head-actions">
            <span className="head-note" role="status">
              {demo.state === "ok" && `Demo run returned ${demo.data.length} case ID${demo.data.length === 1 ? "" : "s"}.`}
              {demo.state === "error" && <span className="error-text">{demo.message}</span>}
            </span>
            <button type="button" onClick={reload} disabled={list.state === "loading"}>
              Refresh
            </button>
            <button type="button" className="primary" onClick={runDemo} disabled={demo.state === "loading"}>
              {demo.state === "loading" ? "Running…" : "Run fictional demo"}
            </button>
          </div>
        </div>
        {list.state === "loading" && <p className="empty">Loading cases…</p>}
        {list.state === "error" && (
          <div className="notice error">
            <strong>Could not load cases.</strong> {list.message}
          </div>
        )}
        {list.state === "ok" && cases.length === 0 && (
          <p className="empty">
            {!area
              ? "Select an area on the globe to list the vessels inside it."
              : all.length === 0
                ? "No cases yet for this data source."
                : "No vessels in this area match the filters."}
          </p>
        )}
        {list.state === "ok" && cases.length > 0 && (
          <div className="table-scroll">
            <CaseList cases={cases} selectedId={selectedId} onSelect={onSelect} />
          </div>
        )}
      </section>
    </div>
  );
}
