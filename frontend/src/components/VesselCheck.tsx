import { useEffect, useRef, useState, type FormEvent } from "react";
import { fetchHistoricalVessel, searchVessels, type HistoricalEvidence, type VesselSearchMatch } from "../api/historical";
import { useHistoricalWorkspace } from "../HistoricalWorkspace";
import { VesselEvidence } from "./VesselEvidence";
import { Info } from "./Info";
import { LoadingStatus, Skeleton } from "./Loading";

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
  return <div className="split vessel-check">
    <section className="panel"><div className="panel-head"><h1>Check vessel ID</h1></div><form className="block lookup-fields" onSubmit={event => void search(event)}>
      <label>MMSI, IMO, call sign or vessel name<input required minLength={3} maxLength={100} value={query} onChange={event => { clear(); setQuery(event.target.value); }} placeholder="Enter at least 3 characters" /></label>
      <button className="primary" disabled={loading || query.trim().length < 3}>{loading ? "Loading…" : "Search Global Fishing Watch"}</button>
      <Info label="Identity search"><p>Searches GFW public vessel identity records. Names and identifiers can match multiple historical identities; choose the correct record before opening a report. A missing result does not establish that a vessel is undocumented or unauthorized.</p></Info>
      <Info label="Risk window"><p>{workspace.result ? `Uses Overview's selected period: ${workspace.result.start} to ${workspace.result.end}.` : "Uses a 24-hour historical window ending 100 hours ago until you select an area in Overview."} Public identity and authorization records have their own validity periods.</p></Info>
    </form>
    {loading && !matches && <><LoadingStatus label="Searching GFW vessel identities…" /><Skeleton variant="table" label="Loading vessel matches" /></>}
    {error && <div className="notice error" role="alert">{error}</div>}
    {matches?.length === 0 && <p className="empty">No matching records returned by GFW. Try another identifier.</p>}
    {matches && <div className="investigation-vessels">{matches.map(match => <div className="investigation-row" key={match.vessel_id}><span><strong>{match.name}</strong><br />MMSI {match.mmsi ?? "Unavailable"} · IMO {match.imo ?? "Unavailable"}<br />{match.flag ?? "Unknown flag"} · {match.vessel_id}</span><button disabled={loading} onClick={() => void inspect(match.vessel_id)}>Open report</button></div>)}</div>}
    {since && <div className="block"><button disabled={loading} onClick={() => void search(undefined, true)}>Load more matches</button></div>}
    </section>
    <section className="panel" aria-live="polite" aria-busy={loading}><div className="panel-head"><h2>Vessel evidence</h2></div>{report ? <VesselEvidence report={report} /> : loading ? <><LoadingStatus label="Retrieving GFW records…" /><Skeleton /></> : <p className="empty">Search an identifier and choose a matching vessel.</p>}</section>
  </div>;
}
