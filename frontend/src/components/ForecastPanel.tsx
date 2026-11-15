import { useEffect, useRef, useState } from "react";
import type { Area } from "../api/historical";
import { fetchForecast, fetchForecastInfo, type ForecastResult, type ScoredForecast } from "../api/forecast";
import { LoadingStatus, Skeleton } from "./Loading";
import { neighborPoints, sameForecastPeriod, type ForecastComparison } from "../forecastMap";

const hours = (value: number) => value.toLocaleString(undefined, { maximumFractionDigits: 1 });

type Props = { area: Area | null; onBoundsChange: (bounds: Area | null) => void; onForecastChange?: (value: ForecastResult | null) => void; onComparisonChange?: (value: ForecastComparison | null) => void; onShowReasoning?: () => void };
export function ForecastPanel({ area, onBoundsChange, onForecastChange, onComparisonChange, onShowReasoning }: Props) {
  const [result, setResult] = useState<ForecastResult | null>(null);
  const [latitude, setLatitude] = useState("");
  const [longitude, setLongitude] = useState("");
  const [loading, setLoading] = useState(false);
  const [comparing, setComparing] = useState(false);
  const [error, setError] = useState("");
  const [infoError, setInfoError] = useState("");
  const [infoLoading, setInfoLoading] = useState(true);
  const [retryInfo, setRetryInfo] = useState(0);
  const current = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const callbacks = useRef({ onForecastChange, onComparisonChange });
  callbacks.current = { onForecastChange, onComparisonChange };

  useEffect(() => {
    const abort = new AbortController();
    setInfoError("");
    setInfoLoading(true);
    // Only checks that the forecast model is reachable; the panel no longer displays its details.
    fetchForecastInfo(abort.signal)
      .catch((e) => { if (!abort.signal.aborted) setInfoError(e instanceof Error ? e.message : String(e)); })
      .finally(() => { if (!abort.signal.aborted) setInfoLoading(false); });
    return () => abort.abort();
  }, [retryInfo]);

  function clear() {
    current.current++; abortRef.current?.abort(); setLoading(false); setComparing(false); setResult(null); setError(""); onBoundsChange(null); callbacks.current.onForecastChange?.(null); callbacks.current.onComparisonChange?.(null);
  }
  useEffect(() => {
    clear();
    // Four decimals (about 11 m) is far finer than the model's map squares, and keeps the fields readable.
    if (area) { setLatitude(((area.south + area.north) / 2).toFixed(4)); setLongitude(((area.west + area.east) / 2).toFixed(4)); }
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
      callbacks.current.onForecastChange?.(data);
      if (data.status === "scored") {
        setLoading(false); setComparing(true);
        const points = neighborPoints(data.bounds);
        const cells: ScoredForecast[] = [data];
        let next = 0, unavailable = 0;
        async function compareNearby() {
          while (next < points.length && !abort.signal.aborted) {
            const [lon, lat] = points[next++];
            try {
              const neighbor = await fetchForecast(lat, lon, abort.signal);
              if (neighbor.status === "scored" && sameForecastPeriod(data as ScoredForecast, neighbor) && lon >= neighbor.bounds.west && lon < neighbor.bounds.east && lat >= neighbor.bounds.south && lat < neighbor.bounds.north && !cells.some(cell => cell.cell_id === neighbor.cell_id)) cells.push(neighbor);
              else unavailable++;
            } catch { unavailable++; }
          }
        }
        await Promise.all(Array.from({ length: Math.min(3, points.length) }, compareNearby));
        if (version !== current.current || abort.signal.aborted) return;
        const nearby = { cells, attempted: points.length + 1, unavailable };
        callbacks.current.onComparisonChange?.(nearby); setComparing(false);
      }
    } catch (e) { if (version === current.current && !abort.signal.aborted) setError(e instanceof Error ? e.message : String(e)); }
    finally { if (version === current.current) setLoading(false); }
  }

  const scored = result?.status === "scored" ? result : null;
  const change = scored && scored.repeat_last_week_hours > 0 ? 100 * (scored.predicted_week_hours - scored.repeat_last_week_hours) / scored.repeat_last_week_hours : null;
  return <section id="forecast-panel" className="forecast-panel" aria-label="Fishing activity forecast" aria-busy={loading || comparing || infoLoading}>
    <div className="panel-head"><h2>Fishing activity forecast</h2><span className="tag">ML model · historical</span></div>

    {/* Inputs: a point to forecast. Selecting an area on the map fills in its centre. */}
    <div className="block forecast-inputs">
      <p className="forecast-intro">Estimates next week's apparent fishing activity for the model square around a point. Selecting an area on the map fills in its centre.</p>
      <div className="forecast-controls"><label className="field-label">Forecast latitude<input type="number" min={-90} max={90} step="any" value={latitude} onChange={(e) => { clear(); setLatitude(e.target.value); }} /></label><label className="field-label">Forecast longitude<input type="number" min={-180} max={180} step="any" value={longitude} onChange={(e) => { clear(); setLongitude(e.target.value); }} /></label></div>
      <div className="forecast-actions">
        <button type="button" className="primary" disabled={loading || comparing || latitude === "" || longitude === ""} onClick={() => void predict(Number(latitude), Number(longitude))}>{loading ? "Calculating forecast…" : "Get fishing forecast"}</button>
        {result && <button type="button" onClick={clear}>Clear forecast</button>}
      </div>
    </div>

    {/* Progress and errors. */}
    {infoLoading && <LoadingStatus label="Connecting to the forecast model…" />}
    {loading && <><LoadingStatus label="Calculating fishing activity forecast…" /><Skeleton variant="values" label="Loading forecast values" /></>}
    {comparing && <LoadingStatus label="Comparing nearby areas…" detail="Checking neighboring squares for higher predicted activity." />}
    {infoError && <div className="block"><p className="notice error">{infoError} <button onClick={() => setRetryInfo((value) => value + 1)}>Retry model connection</button></p></div>}
    {error && <div className="block"><p className="notice error" role="alert">{error}</p></div>}
    {result?.status === "insufficient_data" && <div className="block"><p role="status">Not enough usable activity history. Try another location. {result.reason}</p></div>}

    {/* Result: the forecast, the baseline it is compared with, and the change. */}
    {scored && <div className="block forecast-result" aria-live="polite">
      <div className="forecast-values"><div><strong>{hours(scored.predicted_week_hours)}</strong><span>Predicted apparent fishing vessel-hours</span></div><div><strong>{hours(scored.repeat_last_week_hours)}</strong><span>Repeat-last-week baseline vessel-hours</span></div><div><strong>{change === null ? "Unavailable" : `${change >= 0 ? "+" : ""}${change.toFixed(1)}%`}</strong><span>Change versus baseline</span></div></div>
      {onShowReasoning ? <button type="button" onClick={onShowReasoning}>Show forecast reasoning</button> : <details className="plain"><summary>How was this estimated?</summary><p>{scored.selected_explanation}</p><p>{scored.interpretation}</p></details>}
    </div>}
  </section>;
}
