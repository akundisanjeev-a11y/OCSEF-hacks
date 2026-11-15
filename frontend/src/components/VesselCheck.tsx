import { useEffect, useRef, useState, type FormEvent } from "react";
import { fetchHistoricalVessel, searchVessels, type HistoricalEvidence, type VesselSearchMatch } from "../api/historical";
import { useHistoricalWorkspace } from "../HistoricalWorkspace";
import { VesselEvidence } from "./VesselEvidence";
import { Info } from "./Info";
import { LoadingStatus, Skeleton } from "./Loading";
import { ShipSymbol } from "./ShipSymbol";
import { shipKind, shipNames } from "../vesselSymbols";

export function VesselCheck() {
  const workspace = useHistoricalWorkspace()!;
  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState<VesselSearchMatch[] | null>(null);
  const [since, setSince] = useState<string | null>(null);
  const [report, setReport] = useState<HistoricalEvidence | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const version = useRef(0);
  const active = useRef<AbortController | null>(null);
  function clear() { version.current++; active.current?.abort(); setMatches(null); setSince(null); setReport(null); setError(""); setLoading(false); }
  useEffect(() => () => { version.current++; active.current?.abort(); }, []);
  async function search(event?: FormEvent, more = false) {
    event?.preventDefault();
    active.current?.abort();
    const controller = new AbortController(); active.current = controller;
    const request = ++version.current;
    setLoading(true); setError(""); setReport(null);
    if (!more) { setMatches(null); setSince(null); }
    try {
      const response = await searchVessels(query.trim(), more ? since ?? undefined : undefined, controller.signal);
      if (request !== version.current) return;
      setMatches(previous => more ? [...new Map([...(previous ?? []), ...response.results].map(row => [row.vessel_id, row])).values()] : response.results);
      setSince(response.since);
    } catch (e) { if (request === version.current) setError(e instanceof Error ? e.message : String(e)); }
    finally { if (request === version.current) setLoading(false); }
  }
  async function inspect(id: string) {
    const request = ++version.current;
    setLoading(true); setError(""); setReport(null);
    const area = workspace.result;
    try {
      const data = await fetchHistoricalVessel(id, { mode: "gfw", hours_ago: 100, window_hours: 24, ...(area ? { start: area.start, end: area.end } : {}) });
      if (request !== version.current) return;
      setReport(data); workspace.saveReport(data);
    } catch (e) { if (request === version.current) setError(e instanceof Error ? e.message : String(e)); }
    finally { if (request === version.current) setLoading(false); }
  }
  // Shown for a field the record does not include. Nothing is filled in or guessed.
  const missing = <span className="state-missing">Not reported</span>;
  return <div className="split vessel-check">
    <section className="panel">
      <div className="panel-head"><h1>Check vessel ID</h1></div>

      {/* Search: one field, one action. */}
      <form className="lookup-search" onSubmit={event => void search(event)}>
        <p className="lookup-intro">Look up a vessel in Global Fishing Watch's public identity records.</p>
        <label className="field-label" htmlFor="vessel-query">MMSI, IMO, call sign or vessel name</label>
        <div className="lookup-row">
          <input id="vessel-query" required minLength={3} maxLength={100} value={query} onChange={event => { clear(); setQuery(event.target.value); }} placeholder="MMSI, IMO, call sign or name" autoComplete="off" spellCheck={false} />
          <button className="primary" disabled={loading || query.trim().length < 3}>{loading ? "Loading…" : "Search Global Fishing Watch"}</button>
        </div>
        <div className="lookup-notes">
          <span className="stat-note">MMSI is 9 digits, IMO is 7. At least 3 characters.</span>
          <Info label="Identity search"><p>Searches GFW public vessel identity records. Names and identifiers can match multiple historical identities; choose the correct record before opening a report. A missing result does not establish that a vessel is undocumented or unauthorized.</p></Info>
          <Info label="Risk window"><p>{workspace.result ? `Uses Overview's selected period: ${workspace.result.start} to ${workspace.result.end}.` : "Uses a 24-hour historical window ending 100 hours ago until you select an area in Overview."} Public identity and authorization records have their own validity periods.</p></Info>
        </div>
      </form>

      {/* Results. */}
      {loading && !matches && <><LoadingStatus label="Searching GFW vessel identities…" /><Skeleton variant="table" label="Loading vessel matches" /></>}
      {error && <div className="block"><div className="notice error" role="alert">{error}</div></div>}
      {matches?.length === 0 && <p className="empty">No matching records returned by GFW. Try another identifier.</p>}
      {!matches && !loading && !error && <div className="empty-state"><h3>Search by any identifier</h3><p>Results list every matching identity record. One vessel can appear more than once if its name, flag or radio ID changed over time.</p></div>}
      {!!matches?.length && <>
        <div className="list-head"><h2>{matches.length} matching record{matches.length === 1 ? "" : "s"}</h2></div>
        <div className="table-scroll"><table className="data-table lookup-table"><thead><tr><th>Vessel</th><th>MMSI</th><th>IMO</th><th>Flag</th><th>Type</th><th className="action"><span className="sr-only">Report</span></th></tr></thead>
          <tbody>{matches.map(match => <tr key={match.vessel_id} className={report?.vessel_id === match.vessel_id ? "selected" : undefined}>
            <td><strong className="match-name">{match.name}</strong><span className="match-id mono">{match.vessel_id}</span></td>
            <td className="id">{match.mmsi ?? missing}</td>
            <td className="id">{match.imo ?? missing}</td>
            <td>{match.flag ?? missing}</td>
            <td><span className="type-cell"><ShipSymbol type={match.vessel_type} />{shipNames[shipKind(match.vessel_type)]}</span></td>
            <td className="action"><button className="quiet" disabled={loading} onClick={() => void inspect(match.vessel_id)}>Open report</button></td>
          </tr>)}</tbody>
        </table></div>
      </>}
      {since && <div className="pager"><button disabled={loading} onClick={() => void search(undefined, true)}>Load more matches</button></div>}
    </section>

    {/* The report for the chosen record. */}
    <section className="panel" aria-live="polite" aria-busy={loading}><div className="panel-head"><h2>Vessel evidence</h2></div>
      {report ? <VesselEvidence report={report} /> : loading && matches ? <><LoadingStatus label="Retrieving GFW records…" /><Skeleton /></> : <div className="empty-state"><h3>No vessel selected</h3><ol><li>Search an identifier on the left.</li><li>Choose the matching record. Names can match several historical identities.</li><li>Open its report to see identity, authorization records and any warning signs.</li></ol></div>}
    </section>
  </div>;
}
