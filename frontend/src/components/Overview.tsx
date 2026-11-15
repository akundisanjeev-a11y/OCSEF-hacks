import { useMemo, useState, type ReactNode } from "react";
import { ApiError, type Api } from "../api/client";
import type { AuthorizationStatus, DataMode, IdentityStatus, ReviewLevel } from "../api/types";
import { authorizationLabel, dataModeLabel, identityLabel, registration, reviewLabel } from "../format";
import { errorMessage, useCase, useCases, type Load } from "../useCases";
import { nearestZone } from "../zones";
import { CaseDetail } from "./CaseDetail";
import { CaseList } from "./CaseList";
import { CaseMap, type Area, type Located } from "./CaseMap";

// The choices for the "distance to a fishing zone" filter.
type Proximity = "any" | "inside" | "10" | "25" | "50";

// Text shown for each proximity choice ("any" is added separately in the dropdown).
const proximityLabel: Record<Exclude<Proximity, "any">, string> = {
  inside: "Inside a zone",
  "10": "Within 10 km",
  "25": "Within 25 km",
  "50": "Within 50 km",
};

// One labelled filter control in the left sidebar: a small caption with the control under it.
function Filter({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <label className="filter">
      <span>{label}</span>
      {children}
    </label>
  );
}

// A dropdown filter with an "all" choice plus one option per entry in `options`.
// Reused for data source, AIS match status, authorization and review priority.
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
        {/* The "no filtering" choice. */}
        <option value="all">{props.allLabel}</option>
        {/* One option per key of `options`, showing its readable label. */}
        {(Object.keys(props.options) as T[]).map((k) => (
          <option key={k} value={k}>
            {props.options[k]}
          </option>
        ))}
      </select>
    </Filter>
  );
}

// What the page needs from App: the data source, the selected case (shared with other tabs),
// a way to change it, and a way to jump to the Investigations tab.
interface Props {
  api: Api;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onOpenInvestigation: () => void;
}

// The Overview page: filters on the left, the 3D globe in the middle, the selected case on the right,
// and the counts and vessel list below. Vessels only appear once the user drags a box on the globe.
export function Overview({ api, selectedId, onSelect, onOpenInvestigation }: Props) {
  // Current value of every filter. "all" or "" means "do not filter on this".
  const [dataMode, setDataMode] = useState<DataMode | "all">("all");
  // Authorization filter: one decision, or all.
  const [status, setStatus] = useState<AuthorizationStatus | "all">("all");
  // AIS match filter: one status, or all.
  const [identity, setIdentity] = useState<IdentityStatus | "all">("all");
  // Review priority filter: one level, or all.
  const [review, setReview] = useState<ReviewLevel | "all">("all");
  // Fishing-zone distance filter.
  const [proximity, setProximity] = useState<Proximity>("any");
  // Earliest capture date to show (empty means no limit).
  const [from, setFrom] = useState("");
  // Latest capture date to show (empty means no limit).
  const [to, setTo] = useState("");
  // Hide detections that scored below this value (0 to 1).
  const [minScore, setMinScore] = useState(0);
  // The box the user dragged on the globe (null until they select one).
  const [area, setArea] = useState<Area | null>(null);
  // Result of the last "Run fictional demo" click (idle, loading, ok or error).
  const [demo, setDemo] = useState<Load<string[]>>({ state: "idle" });

  // Load all cases from the backend (or sample data), and the full detail of the selected one.
  const { list, reload } = useCases(api, dataMode);
  // The full case for the selected id, loaded from the backend.
  const detail = useCase(api, selectedId);

  // Asks the backend to run its fictional demo, then reloads the cases.
  // If the backend has not built that route yet (404) it shows a plain explanation instead of a raw error.
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

  // Every case loaded so far, before any filtering (empty while loading or on error).
  const all = list.state === "ok" ? list.data : [];

  // The vessels to show: nothing until an area is selected, then only cases that pass every active filter.
  // The area test keeps only cases whose position is inside the dragged box, so cases with no position drop out.
  const cases = useMemo(
    () =>
      !area ? [] : all.filter((c) => {
        const o = c.observation;
        // Authorization, AIS match and review-priority filters.
        if (status !== "all" && c.authorization.status !== status) return false;
        if (identity !== "all" && o.identity_status !== identity) return false;
        if (review !== "all" && c.review_priority?.level !== review) return false;
        // Hide detections the model was less sure about than the slider value.
        if (o.detection_confidence < minScore) return false;
        // Capture-date range: compare the YYYY-MM-DD part of the timestamp; cases with no date are excluded.
        if (from || to) {
          const day = o.captured_at?.slice(0, 10);
          if (!day || (from && day < from) || (to && day > to)) return false;
        }
        // Fishing-zone proximity: either inside a zone or within the chosen number of km of one.
        if (proximity !== "any") {
          const z = nearestZone(o.position);
          if (!z || (proximity === "inside" ? !z.inside : z.km > Number(proximity))) return false;
        }
        // Only keep vessels whose latitude and longitude fall inside the dragged box.
        if (area) {
          const p = o.position;
          if (!p || p.lon < area.west || p.lon > area.east || p.lat < area.south || p.lat > area.north) return false;
        }
        return true;
      }),
    [all, status, identity, review, minScore, from, to, proximity, area],
  );

  // Groups cases that sit at exactly the same coordinates so the globe draws one marker with a count
  // instead of several markers stacked on top of each other. Cases without a position are skipped here.
  const groups = useMemo(() => {
    const byKey = new Map<string, Located>();
    for (const c of cases) {
      const p = c.observation.position;
      if (!p) continue;
      // Text that identifies this exact spot; cases at the same coordinates share it.
      const key = `${p.lat},${p.lon}`;
      // The marker group for this spot, created the first time the spot is seen.
      const g = byKey.get(key) ?? { key, lat: p.lat, lon: p.lon, cases: [] };
      g.cases.push(c);
      byKey.set(key, g);
    }
    return [...byKey.values()];
  }, [cases]);

  // Counts shown in the stats strip: by permit decision, and by registered / unregistered / unresolved.
  const count = (s: AuthorizationStatus) => cases.filter((c) => c.authorization.status === s).length;
  // Counts the shown cases in one group: registered, unregistered or unresolved.
  const reg = (r: ReturnType<typeof registration>) =>
    cases.filter((c) => registration(c.observation.identity_status) === r).length;
  // True when any sidebar filter has been changed (used to enable Reset and show "Filtered").
  const filtersActive =
    status !== "all" ||
    identity !== "all" ||
    review !== "all" ||
    proximity !== "any" ||
    from !== "" ||
    to !== "" ||
    minScore > 0;

  // Puts every sidebar filter back to "all". The selected area is kept on purpose.
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
      {/* Left column: all the filters. */}
      <aside className="panel filters">
        <div className="panel-head">
          <h2>Filters</h2>
        </div>
        <div className="filter-body">
          {/* Where the record came from: fictional, published historical, or a model upload. */}
          <Select label="Data source" value={dataMode} allLabel="All sources" options={dataModeLabel} onChange={setDataMode} />
          {/* Earliest and latest capture date to include. */}
          <div className="filter">
            <span>Capture date (UTC)</span>
            <div className="date-range">
              <input type="date" aria-label="From date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} />
              <input type="date" aria-label="To date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} />
            </div>
          </div>
          {/* Whether the ship matched an AIS tracking signal. */}
          <Select label="AIS match status" value={identity} allLabel="All vessels" options={identityLabel} onChange={setIdentity} />
          {/* The backend's permit decision. */}
          <Select label="Authorization" value={status} allLabel="All statuses" options={authorizationLabel} onChange={setStatus} />
          {/* How urgently a human should look at the case. */}
          <Select label="Review priority" value={review} allLabel="All levels" options={reviewLabel} onChange={setReview} />
          {/* Distance to the (illustrative) fishing zones. */}
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
          {/* Slider that hides detections below a minimum model score. */}
          <Filter
            label={
              <>
                Detection score threshold <b>{Math.round(minScore * 100)}%</b>
              </>
            }
          >
            <input type="range" min={0} max={1} step={0.05} value={minScore} onChange={(e) => setMinScore(Number(e.target.value))} />
          </Filter>
          {/* Read-only readout of the box dragged on the globe. */}
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
          {/* Clears the filters above (disabled when none are set). */}
          <button type="button" onClick={resetFilters} disabled={!filtersActive}>
            Reset filters
          </button>
        </div>
      </aside>

      {/* Centre: the 3D globe where the user drags a box and sees the vessels as markers. */}
      <section className="panel map-panel">
        <CaseMap groups={groups} selectedId={selectedId} onSelect={onSelect} area={area} onAreaChange={setArea} />
      </section>

      {/* Right column: full details of the selected case, or a hint, loading or error message. */}
      <aside className="panel case-panel">
        {/* Nothing selected yet. */}
        {detail.state === "idle" && (
          <>
            <div className="panel-head">
              <h2>Case</h2>
            </div>
            <p className="empty">Select a marker on the map or a row in the case list to see its evidence.</p>
          </>
        )}
        {/* Fetching the case. */}
        {detail.state === "loading" && <p className="empty">Loading case…</p>}
        {/* The case could not be fetched. */}
        {detail.state === "error" && (
          <div className="notice error">
            <strong>Could not load case {selectedId}.</strong> {detail.message}
          </div>
        )}
        {/* The case loaded: show the evidence, with Close and Open investigation actions. */}
        {detail.state === "ok" && (
          <CaseDetail data={detail.data} onClose={() => onSelect(null)} onOpenInvestigation={onOpenInvestigation} />
        )}
      </aside>

      {/* Strip of counts for the vessels in the selected area. */}
      <section className="panel stats">
        <div className="panel-head">
          <h2>Vessels in selected area</h2>
          {/* Reminder that the counts are being narrowed by sidebar filters. */}
          {area && filtersActive && <span className="muted">Filtered</span>}
        </div>
        <div className="stat-row">
          {/* Every vessel detected in the area (shows a dash until an area is selected). */}
          <div className="stat">
            <strong>{area ? cases.length : "—"}</strong>
            <span>Detected vessels</span>
          </div>
          {/* Ships that matched an AIS tracking signal. */}
          <div className="stat marker-registered">
            <strong>{area ? reg("registered") : "—"}</strong>
            <span>Registered (AIS matched)</span>
          </div>
          {/* Ships with no matching AIS signal even though AIS coverage was adequate. */}
          <div className="stat marker-unregistered">
            <strong>{area ? reg("unregistered") : "—"}</strong>
            <span>Unregistered (no AIS match)</span>
          </div>
          {/* Ambiguous matches and cases with missing data. */}
          <div className="stat marker-unresolved">
            <strong>{area ? reg("unresolved") : "—"}</strong>
            <span>Unresolved identity</span>
          </div>
          {/* Cases where the permit check found a conflict with a rule. */}
          <div className="stat status-potential_violation">
            <strong>{area ? count("potential_violation") : "—"}</strong>
            <span>Potential violation</span>
          </div>
        </div>
        {/* Plain-language definitions so nobody mistakes "registered" for an official registry check. */}
        <p className="stat-note muted">
          Registered means the radar detection matched an AIS track. Unregistered means AIS coverage was adequate and
          no track matched. Unresolved covers ambiguous matches and missing data.
        </p>
      </section>

      {/* Bottom: table of the vessels in the selected area. */}
      <section className="panel list-panel">
        <div className="panel-head">
          <h2>Vessels</h2>
          <div className="head-actions">
            {/* Feedback from the last demo run (success count or error message). */}
            <span className="head-note" role="status">
              {demo.state === "ok" && `Demo run returned ${demo.data.length} case ID${demo.data.length === 1 ? "" : "s"}.`}
              {demo.state === "error" && <span className="error-text">{demo.message}</span>}
            </span>
            {/* Re-fetch the cases from the backend. */}
            <button type="button" onClick={reload} disabled={list.state === "loading"}>
              Refresh
            </button>
            {/* Ask the backend to run its fictional demo pipeline. */}
            <button type="button" className="primary" onClick={runDemo} disabled={demo.state === "loading"}>
              {demo.state === "loading" ? "Running…" : "Run fictional demo"}
            </button>
          </div>
        </div>
        {/* Fetching the case list. */}
        {list.state === "loading" && <p className="empty">Loading cases…</p>}
        {/* The case list could not be fetched. */}
        {list.state === "error" && (
          <div className="notice error">
            <strong>Could not load cases.</strong> {list.message}
          </div>
        )}
        {/* Loaded but nothing to list: explain whether that is because no area is chosen, no data exists, or filters removed everything. */}
        {list.state === "ok" && cases.length === 0 && (
          <p className="empty">
            {!area
              ? "Select an area on the globe to list the vessels inside it."
              : all.length === 0
                ? "No cases yet for this data source."
                : "No vessels in this area match the filters."}
          </p>
        )}
        {/* The vessel table, scrollable when long. */}
        {list.state === "ok" && cases.length > 0 && (
          <div className="table-scroll">
            <CaseList cases={cases} selectedId={selectedId} onSelect={onSelect} />
          </div>
        )}
      </section>
    </div>
  );
}
