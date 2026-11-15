import { useEffect, useRef, useState } from "react";
import type { Area } from "../api/historical";
import { fetchForecast, fetchForecastInfo, type ForecastInfo, type ForecastResult } from "../api/forecast";

const hours = (value: number) => value.toLocaleString(undefined, { maximumFractionDigits: 1 });

export function ForecastPanel({ area, onBoundsChange }: { area: Area | null; onBoundsChange: (bounds: Area | null) => void }) {
  const [info, setInfo] = useState<ForecastInfo | null>(null);
  const [result, setResult] = useState<ForecastResult | null>(null);
  const [latitude, setLatitude] = useState("");
  const [longitude, setLongitude] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [infoError, setInfoError] = useState("");
  const [retryInfo, setRetryInfo] = useState(0);
  const current = useRef(0);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const abort = new AbortController();
    setInfoError("");
    fetchForecastInfo(abort.signal).then((data) => { if (!abort.signal.aborted) setInfo(data); })
      .catch((e) => { if (!abort.signal.aborted) setInfoError(e instanceof Error ? e.message : String(e)); });
    return () => abort.abort();
  }, [retryInfo]);

  function clear() {
    current.current++; abortRef.current?.abort(); setLoading(false); setResult(null); setError(""); onBoundsChange(null);
  }
  useEffect(() => {
    clear();
    if (area) { setLatitude(String((area.south + area.north) / 2)); setLongitude(String((area.west + area.east) / 2)); }
    else { setLatitude(""); setLongitude(""); }
    // The stable parent setter prevents an overlay update from clearing itself.
  }, [area, onBoundsChange]);
  useEffect(() => () => { current.current++; abortRef.current?.abort(); }, []);

  async function predict(lat: number, lon: number) {
    clear();
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) { setError("Enter latitude from -90 to 90 and longitude from -180 to 180."); return; }
    const version = ++current.current;
    const abort = new AbortController(); abortRef.current = abort;
    setLoading(true);
    try {
      const data = await fetchForecast(lat, lon, abort.signal);
      if (version !== current.current || abort.signal.aborted) return;
      setResult(data);
      onBoundsChange(data.status === "scored" ? data.bounds : null);
    } catch (e) { if (version === current.current && !abort.signal.aborted) setError(e instanceof Error ? e.message : String(e)); }
    finally { if (version === current.current) setLoading(false); }
  }

  const scored = result?.status === "scored" ? result : null;
  const change = scored && scored.repeat_last_week_hours > 0 ? 100 * (scored.predicted_week_hours - scored.repeat_last_week_hours) / scored.repeat_last_week_hours : null;
  const period = result ?? info;
  return <section id="forecast-panel" className="panel forecast-panel" aria-label="Fishing activity forecast">
    <div className="panel-head"><h2>ML fishing-activity forecast</h2><span className="forecast-badge">HISTORICAL DEMO</span></div>
    <div className="block">
      <p>Forecast the 5° model cell containing the selected area's center, or enter a point. This forecasts apparent fishing vessel-hours, not boat counts or illegality.</p>
      <div className="forecast-controls"><label>Forecast latitude<input type="number" min={-90} max={90} step="any" value={latitude} onChange={(e) => { clear(); setLatitude(e.target.value); }} /></label><label>Forecast longitude<input type="number" min={-180} max={180} step="any" value={longitude} onChange={(e) => { clear(); setLongitude(e.target.value); }} /></label>
        <button type="button" className="primary" disabled={loading || latitude === "" || longitude === ""} onClick={() => void predict(Number(latitude), Number(longitude))}>{loading ? "Calculating forecast…" : "Get fishing forecast"}</button>
        <button type="button" disabled={loading} onClick={() => { setLatitude("27.5"); setLongitude("122.5"); void predict(27.5, 122.5); }}>Try verified historical example</button>
        {result && <button type="button" onClick={clear}>Clear forecast</button>}
      </div>
      {infoError && <p className="notice error">{infoError} <button onClick={() => setRetryInfo((value) => value + 1)}>Retry model connection</button></p>}
      {error && <p className="notice error" role="alert">{error}</p>}
      {period && <p className="forecast-period">Observed through {period.observation_cutoff} · simulated issue {period.simulated_issue_date} · forecast {period.target_start} through {period.target_end}. These dates are separate from the GFW observation window above.</p>}
      {result?.status === "insufficient_data" && <p role="status">Not enough usable activity history. Try another location. {result.reason}</p>}
      {scored && <div aria-live="polite"><div className="forecast-values"><div><strong>{hours(scored.predicted_week_hours)}</strong><span>Predicted apparent fishing vessel-hours</span></div><div><strong>{hours(scored.repeat_last_week_hours)}</strong><span>Repeat-last-week baseline vessel-hours</span></div><div><strong>{change === null ? "Unavailable" : `${change >= 0 ? "+" : ""}${change.toFixed(1)}%`}</strong><span>Change versus baseline</span></div></div>
        <p>Purple outline: model cell {scored.cell_id}, {scored.bounds.south}–{scored.bounds.north}° latitude and {scored.bounds.west}–{scored.bounds.east}° longitude. It does not represent a precise forecast for the drawn rectangle.</p>
        <details><summary>How was this estimated?</summary><p>{scored.selected_explanation}</p><p>{scored.interpretation}</p><p>Seasonal reference: {scored.seasonal_reference_available ? "available" : "unavailable; fallback used"}.</p>{scored.data_quality_notes.map((note) => <p key={note}>{note}</p>)}<p>Model: {scored.model_version} · source: {scored.source_dataset}</p><pre>{JSON.stringify(scored.decision_path, null, 2)}</pre></details>
      </div>}
      {info?.evaluation && <p className="small muted">Saved evaluation, {info.evaluation.issue_start}–{info.evaluation.issue_end}: MAE {hours(info.evaluation.mae_hours)} versus baseline {hours(info.evaluation.baseline_mae_hours)} hours{info.evaluation.mae_reduction_percent !== null ? ` (${info.evaluation.mae_reduction_percent.toFixed(2)}% lower average absolute error)` : ""}. This is not classification accuracy or a per-area confidence score.</p>}
      <p className="small"><a href="https://globalfishingwatch.org" target="_blank" rel="noreferrer">Powered by Global Fishing Watch</a>. The saved model runs locally; no GFW token is needed for this forecast.</p>
    </div>
  </section>;
}
