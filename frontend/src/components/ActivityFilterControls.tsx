import { useState, type FormEvent } from "react";
import type { ActivityFilters, HistoricalQuery } from "../api/historical";

export function ActivityFilterControls({ layer, onApply }: { layer: HistoricalQuery["layer"]; onApply: (filters: ActivityFilters) => void }) {
  const [flag, setFlag] = useState("");
  const [gear, setGear] = useState("");
  const [vessel, setVessel] = useState("");
  const [type, setType] = useState("");
  const [speed, setSpeed] = useState("");
  const [port, setPort] = useState("");
  const [matched, setMatched] = useState<NonNullable<ActivityFilters["sar_matched"]>>("false");
  const identityUnavailable = layer === "sar" && matched === "false";
  function apply(event: FormEvent) {
    event.preventDefault();
    const filters: ActivityFilters = {};
    if (!identityUnavailable) {
      if (flag.trim()) filters.flag = flag.split(",").map(v => v.trim().toUpperCase()).filter(Boolean);
      if (vessel.trim()) filters.vessel_id = vessel.trim();
      if (layer !== "presence" && gear.trim()) filters.geartype = gear.split(",").map(v => v.trim()).filter(Boolean);
      if (layer === "sar" && type.trim()) filters.shiptype = type.trim();
    }
    if (layer === "presence") {
      if (type.trim()) filters.vessel_type = type.trim();
      if (speed) filters.speed = speed as ActivityFilters["speed"];
    }
    if (layer === "fishing" && port !== "") filters.distance_from_port_km = Number(port) as ActivityFilters["distance_from_port_km"];
    if (layer === "sar") { filters.sar_matched = matched; }
    onApply(filters);
  }
  return <details><summary>Filter boats and activity</summary><form onSubmit={apply}>
    {layer === "sar" && <><label className="filter"><span>Link to boat radio (AIS)</span><select value={matched} onChange={e => setMatched(e.target.value as typeof matched)}><option value="false">No known radio identity</option><option value="true">Linked to a radio identity</option><option value="all">All radar sightings</option></select></label>
      <p className="muted">Satellite radar can see objects on the water without knowing which boat they are.</p></>}
    <label className="filter"><span>Registration country codes (e.g. ESP,USA)</span><input disabled={identityUnavailable} value={flag} onChange={e => setFlag(e.target.value)} /></label>
    <label className="filter"><span>GFW record ID from a boat report</span><input disabled={identityUnavailable} value={vessel} onChange={e => setVessel(e.target.value)} /></label>
    {layer !== "presence" && <label className="filter"><span>Fishing method codes (e.g. trawlers)</span><input disabled={identityUnavailable} value={gear} onChange={e => setGear(e.target.value)} /></label>}
    {layer === "sar" && <label className="filter"><span>Matched ship type (e.g. cargo)</span><input disabled={identityUnavailable} value={type} onChange={e => setType(e.target.value)} /></label>}
    {layer === "presence" && <><label className="filter"><span>Vessel type (e.g. cargo)</span><input value={type} onChange={e => setType(e.target.value)} /></label><label className="filter"><span>Speed (knots)</span><select value={speed} onChange={e => setSpeed(e.target.value)}><option value="">Any speed</option>{["<2","2-4","4-6","6-10","10-15","15-25",">25"].map(v => <option key={v}>{v}</option>)}</select></label></>}
    {layer === "fishing" && <label className="filter"><span>Minimum port distance</span><select value={port} onChange={e => setPort(e.target.value)}><option value="">Provider default (no filter)</option>{[0,1,2,3,4,5].map(v => <option value={v} key={v}>{v} km</option>)}</select></label>}
    {identityUnavailable && <p className="muted">These sightings have no known boat identity, so we cannot filter them by country or boat ID.</p>}
    <button type="submit">Apply activity filters</button><button type="button" onClick={() => { setFlag(""); setGear(""); setVessel(""); setType(""); setSpeed(""); setPort(""); setMatched("false"); onApply({}); }}>Clear filters</button>
  </form></details>;
}
