import { useState, type FormEvent } from "react";
import { checkVessel } from "../api/client";
import type { VesselCheckRequest, VesselCheckResponse } from "../api/types";
import { StatusLabel } from "./StatusLabel";

const initial: VesselCheckRequest = {
  registry_mode: "documented", identifier_type: "mmsi", identifier: "",
  activity: null, captured_at: null, zone_id: null,
};
const documentationLabels = {
  documented: "Documented in this registry", not_found: "Not found in this registry",
  registry_unavailable: "Registry not configured", ambiguous: "Ambiguous identity",
};

export function VesselCheck() {
  const [input, setInput] = useState(initial);
  const [result, setResult] = useState<VesselCheckResponse | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  function update(values: Partial<VesselCheckRequest>) {
    setInput((previous) => ({ ...previous, ...values }));
    setResult(null);
    setError("");
  }

  function example(kind: "authorized" | "conflict" | "missing") {
    update({ registry_mode: "synthetic", identifier_type: "mmsi",
      identifier: kind === "missing" ? "000000099" : "000000001", activity: "fishing",
      captured_at: "2026-01-01T10:00:00Z", zone_id: kind === "conflict" ? "DEMO-OFFSHORE-B" : "DEMO-OFFSHORE-A" });
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setLoading(true); setResult(null); setError("");
    try {
      setResult(await checkVessel({ ...input, identifier: input.identifier.trim(), zone_id: input.zone_id?.trim() || null }));
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setLoading(false); }
  }

  return (
    <div className="split vessel-check">
      <section className="panel">
        <div className="panel-head"><h2>Check a vessel ID</h2></div>
        <p className="notice">Look up a vessel record, then check permission for an entered activity, area and time. A missing record does not establish that a vessel is unauthorized.</p>
        <form onSubmit={submit}>
          <fieldset disabled={loading} className="lookup-fields">
            <label>Registry
              <select value={input.registry_mode} onChange={(e) => update({ registry_mode: e.target.value as VesselCheckRequest["registry_mode"] })}>
                <option value="documented">Sourced records (server configured)</option>
                <option value="synthetic">Fictional test registry</option>
              </select>
            </label>
            <p className="muted">{input.registry_mode === "synthetic" ? "Fictional identifiers, permits and rules only." : "Checks only the sourced records loaded by your server. There is no global registry connection yet."}</p>
            <label>Identifier type
              <select value={input.identifier_type} onChange={(e) => update({ identifier_type: e.target.value as VesselCheckRequest["identifier_type"], identifier: "" })}>
                <option value="mmsi">MMSI (9 digits)</option><option value="imo">IMO (7 digits)</option><option value="registration_id">Registration / boat ID</option>
              </select>
            </label>
            <label>Vessel identifier
              <input required maxLength={100} value={input.identifier} onChange={(e) => update({ identifier: e.target.value })} placeholder={input.identifier_type === "mmsi" ? "Enter MMSI" : "Enter vessel ID"} />
            </label>
            <h3>Optional authorization context</h3>
            <p className="muted">An ID alone checks documentation. Authorization also needs activity, a registry zone ID and capture time. These are entered claims, not verified satellite observations.</p>
            <label>Activity
              <select value={input.activity ?? ""} onChange={(e) => update({ activity: (e.target.value || null) as VesselCheckRequest["activity"] })}>
                <option value="">Not supplied</option><option value="fishing">Fishing</option><option value="transit">Transit</option><option value="cargo_transport">Cargo transport</option>
              </select>
            </label>
            <label>Zone ID from the sourced registry
              <input maxLength={100} value={input.zone_id ?? ""} onChange={(e) => update({ zone_id: e.target.value || null })} placeholder="For example: DEMO-OFFSHORE-A in fictional mode" />
            </label>
            <label>Capture time (UTC, ISO 8601)
              <input value={input.captured_at ?? ""} onChange={(e) => update({ captured_at: e.target.value || null })} placeholder="2026-01-01T10:00:00Z" />
            </label>
            <button className="primary" type="submit">{loading ? "Checking…" : "Check vessel"}</button>
            <div className="toolbar">
              <span className="muted">Fill a fictional test:</span>
              <button type="button" onClick={() => example("authorized")}>Valid permit</button>
              <button type="button" onClick={() => example("conflict")}>Rule conflict</button>
              <button type="button" onClick={() => example("missing")}>ID not found</button>
            </div>
          </fieldset>
        </form>
      </section>
      <section className="panel" aria-live="polite" aria-busy={loading}>
        <div className="panel-head"><h2>Vessel check result</h2></div>
        {loading && <p className="empty">Checking the selected registry…</p>}
        {error && <div className="notice error" role="alert">{error}</div>}
        {!result && !loading && !error && <p className="empty">Enter a vessel ID or fill a fictional test, then select Check vessel.</p>}
        {result && <>
          <div className="block">
            <div className="eyebrow">{result.registry_mode === "synthetic" ? "Fictional test result" : "Sourced registry result"}</div>
            <h2>{documentationLabels[result.documentation_status]}</h2><p>{result.explanation}</p>
            {result.vessel && <dl>
              <div className="field"><dt>Vessel</dt><dd>{result.vessel.name}</dd></div>
              <div className="field"><dt>Type in record</dt><dd>{result.vessel.vessel_type ?? "Unknown"}</dd></div>
              <div className="field"><dt>MMSI / IMO</dt><dd>{result.vessel.mmsi ?? "—"} / {result.vessel.imo ?? "—"}</dd></div>
              <div className="field"><dt>Registration</dt><dd>{result.vessel.registration_id ?? "—"}</dd></div>
            </dl>}
          </div>
          <div className="block"><h3>Authorization for entered context</h3>
            <StatusLabel status={result.authorization.status} /><p>{result.authorization.explanation}</p>
            {result.vessel?.permits.map((p) => <p key={p.permit_id}><strong>{p.permit_id}</strong>: {p.activity}, {p.zone_id}, {p.valid_from} to {p.valid_until} (end exclusive).</p>)}
          </div>
          <div className="block"><h3>Evidence scope</h3><p>{result.registry_description}</p>
            {result.registry_retrieved_at && <p>Registry retrieved: {result.registry_retrieved_at}</p>}
            <ul>{result.assumptions.map((a) => <li key={a}>{a}</li>)}</ul>
            <h3>Sources</h3><ul>{result.sources.map((s) => <li key={s}>{s}</li>)}</ul>
          </div>
        </>}
      </section>
    </div>
  );
}
