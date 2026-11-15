import { useEffect, useRef, useState } from "react";
import { fetchRiskEvents, type Area, type HistoricalEvidence, type RiskEventEvidence } from "../api/historical";
import { indicatorNarrative } from "../evidenceNarrative";
import { warningNames } from "../vesselLanguage";
import { LoadingStatus } from "./Loading";

type Indicator = HistoricalEvidence["indicators"][number];
export function IndicatorExplanation({ indicator }: { indicator: Indicator }) {
  const explanation = indicatorNarrative(indicator);
  return <article className={`explanation-card explanation-${explanation.status}`}>
    <h4>{warningNames[indicator.code] ?? indicator.label}</h4><p className="evidence-observation">{explanation.finding}</p>
    {indicator.quality_notes?.map(note => <p className="evidence-limit" key={note}>{note}</p>)}
    {indicator.count_is_lower_bound && <p className="small">This counts distinct event IDs supplied by GFW. The total number of events may be larger.</p>}
    {explanation.status === "flagged" && <><h5>Why review it?</h5><p>{explanation.why}</p><h5>What is not established</h5><p>{explanation.limit}</p><h5>What to check next</h5><p>{explanation.next}</p></>}
    <small>Source: GFW Insights summary for the report dates.</small>
  </article>;
}

export function ListingEvidence({ report }: { report: HistoricalEvidence }) {
  const object = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const listing = object(object(report.insights.vesselIdentity).iuuVesselList);
  const entries = Array.isArray(listing.valuesInThePeriod) ? listing.valuesInThePeriod.map(object).filter(row => typeof row.from === "string" && typeof row.to === "string" && Number.isFinite(Date.parse(row.from)) && Number.isFinite(Date.parse(row.to)) && Date.parse(row.to) > Date.parse(report.start) && Date.parse(row.from) < Date.parse(report.end) && Date.parse(row.to) >= Date.parse(row.from)) : [];
  return <div className="source-event-details">{entries.length ? <><p className="small">Available source listing periods overlapping this report:</p><ul>{entries.slice(0, 5).map((row, index) => <li key={index}>{String(row.from)} to {String(row.to)}</li>)}</ul></> : <p className="evidence-limit">The summary did not provide usable individual listing dates. The count alone cannot establish a current listing.</p>}<p className="small">Verify the identity and dates against the <a href="https://iuu-vessels.org/" target="_blank" rel="noreferrer">original Combined IUU Vessel List</a>. No location or motive is inferred from a listing.</p></div>;
}

export function SourceEventDetails({ report, indicator, area }: { report: HistoricalEvidence; indicator: Indicator; area?: Area }) {
  const [events, setEvents] = useState<RiskEventEvidence[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const active = useRef<AbortController | null>(null);
  const ids = [...new Set(indicator.event_ids)].filter(id => typeof id === "string" && /^[A-Za-z0-9_-]{1,200}$/.test(id)).slice(0, 3);
  const key = JSON.stringify([report.vessel_id, report.start, report.end, indicator.code, ids, area]);
  useEffect(() => { active.current?.abort(); setEvents(null); setError(""); setLoading(false); return () => active.current?.abort(); }, [key]);
  if (!ids.length || !["ais_gap", "fishing_in_no_take_mpa", "no_known_rfmo_authorization"].includes(indicator.code)) return <p className="evidence-limit">No event records were supplied for this check. Exact times, locations and local causes cannot be inferred from the count alone.</p>;
  async function load() {
    active.current?.abort(); const controller = new AbortController(); active.current = controller;
    setLoading(true); setError("");
    try {
      const response = await fetchRiskEvents({ vessel_id: report.vessel_id, code: indicator.code, event_ids: ids, start: report.start, end: report.end, ...(area ? { area } : {}) }, controller.signal);
      if (!controller.signal.aborted) setEvents(response.events);
    } catch (e) { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : "Event records unavailable."); }
    finally { if (!controller.signal.aborted) setLoading(false); }
  }
  return <div className="source-event-details">
    {!events && <button type="button" disabled={loading} onClick={() => void load()}>Load up to {ids.length} source event records</button>}
    {loading && <LoadingStatus label="Checking source events…" detail="Matching each record to this boat and these dates." />}
    {error && <p role="alert" className="notice error">{error}</p>}
    {events && <><p className="small">A sample of source records, not a complete reconstruction of the boat's activity.</p>{events.map(event => <article className="source-event" key={event.id}>
      {event.status !== "matched" ? <p>{event.message ?? "This event could not be verified."}</p> : <>
        <p><strong>Source event: {event.start} to {event.end}</strong></p>
        {event.duration_hours != null && <p>The full event spans about {event.duration_hours.toFixed(1)} hours; part may fall outside the report window.</p>}
        <p>{event.position ? `Reported event point: ${event.position.lat.toFixed(3)}°, ${event.position.lon.toFixed(3)}°.` : "A usable event location was not returned."}</p>
        {event.reported_point_in_selected_area != null && <p>The reported point is {event.reported_point_in_selected_area ? "inside" : "outside"} your current selected rectangle. This is one point, not the whole track.</p>}
        {event.start_distance_from_port_km != null && <p>The source reports the event's starting point about {event.start_distance_from_port_km.toFixed(1)} km from a port. This does not establish a port visit or explain the boat's purpose.</p>}
        {!!event.protected_area_ids?.length && <p>Protected-area record IDs: {event.protected_area_ids.join(", ")}. Names and boundary checks have not been added.</p>}
        <p className="small">{event.scope_note}</p>
      </>}
      <small>GFW Events API · record {event.id}</small>
    </article>)}</>}
  </div>;
}
