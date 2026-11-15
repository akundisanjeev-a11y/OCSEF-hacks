import { useEffect, useRef, useState } from "react";
import type { Area } from "../api/historical";
import { fetchForecast, fetchForecastInfo, type ForecastInfo, type ForecastResult, type ScoredForecast } from "../api/forecast";
import { Info } from "./Info";
import { LoadingStatus, Skeleton } from "./Loading";
import { neighborPoints, sameForecastPeriod, type ForecastComparison } from "../forecastMap";

const hours = (value: number) => value.toLocaleString(undefined, { maximumFractionDigits: 1 });

type Props = { area: Area | null; onBoundsChange: (bounds: Area | null) => void; onForecastChange?: (value: ForecastResult | null) => void; onComparisonChange?: (value: ForecastComparison | null) => void; onShowReasoning?: () => void };
export function ForecastPanel({ area, onBoundsChange, onForecastChange, onComparisonChange, onShowReasoning }: Props) {
  const [info, setInfo] = useState<ForecastInfo | null>(null);
  const [result, setResult] = useState<ForecastResult | null>(null);
  const [latitude, setLatitude] = useState("");
  const [longitude, setLongitude] = useState("");
  const [loading, setLoading] = useState(false);
  const [comparing, setComparing] = useState(false);
  const [comparison, setComparison] = useState<ForecastComparison | null>(null);
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
    fetchForecastInfo(abort.signal).then((data) => { if (!abort.signal.aborted) setInfo(data); })
      .catch((e) => { if (!abort.signal.aborted) setInfoError(e instanceof Error ? e.message : String(e)); })
      .finally(() => { if (!abort.signal.aborted) setInfoLoading(false); });
    return () => abort.abort();
  }, [retryInfo]);

  function clear() {
    current.current++; abortRef.current?.abort(); setLoading(false); setComparing(false); setResult(null); setComparison(null); setError(""); onBoundsChange(null); callbacks.current.onForecastChange?.(null); callbacks.current.onComparisonChange?.(null);
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
        setComparison(nearby); callbacks.current.onComparisonChange?.(nearby); setComparing(false);
      }
    } catch (e) { if (version === current.current && !abort.signal.aborted) setError(e instanceof Error ? e.message : String(e)); }
    finally { if (version === current.current) setLoading(false); }
  }

  const scored = result?.status === "scored" ? result : null;
  const change = scored && scored.repeat_last_week_hours > 0 ? 100 * (scored.predicted_week_hours - scored.repeat_last_week_hours) / scored.repeat_last_week_hours : null;
  const period = result ?? info;
  return <section id="forecast-panel" className="panel forecast-panel" aria-label="Fishing activity forecast" aria-busy={loading || comparing || infoLoading}>
    <div className="panel-head"><h2>ML fishing-activity forecast</h2><span className="forecast-badge">HISTORICAL DEMO</span></div>
    <div className="block">
      <Info label="How the fishing forecast works"><p>The trained model estimates next week's fishing activity for the large map square around your chosen point. It uses a saved historical example, not today's boat positions.</p><p>One vessel-hour means one boat active for one hour. Two boats active for one hour each contribute two vessel-hours. More hours does not automatically mean more boats, overfishing or illegal activity. Latitude measures how far north or south a place is; longitude measures how far east or west it is.</p></Info>
      <div className="forecast-controls"><label>Forecast latitude<input type="number" min={-90} max={90} step="any" value={latitude} onChange={(e) => { clear(); setLatitude(e.target.value); }} /></label><label>Forecast longitude<input type="number" min={-180} max={180} step="any" value={longitude} onChange={(e) => { clear(); setLongitude(e.target.value); }} /></label>
        <button type="button" className="primary" disabled={loading || comparing || latitude === "" || longitude === ""} onClick={() => void predict(Number(latitude), Number(longitude))}>{loading ? "Calculating forecast…" : "Get fishing forecast"}</button>
        {result && <button type="button" onClick={clear}>Clear forecast</button>}
      </div>
      {infoLoading && <LoadingStatus label="Connecting to the forecast model…" />}
      {loading && <><LoadingStatus label="Calculating fishing activity forecast…" /><Skeleton variant="values" label="Loading forecast values" /></>}
      {comparing && <LoadingStatus label="Comparing nearby areas…" detail="Checking neighboring squares for higher predicted activity." />}
      {infoError && <p className="notice error">{infoError} <button onClick={() => setRetryInfo((value) => value + 1)}>Retry model connection</button></p>}
      {error && <p className="notice error" role="alert">{error}</p>}
      {period && <Info label="Forecast dates and data"><p className="forecast-period">Observed through {period.observation_cutoff} · simulated issue {period.simulated_issue_date} · forecast {period.target_start} through {period.target_end}. These dates are separate from your selected activity window.</p></Info>}
      {result?.status === "insufficient_data" && <p role="status">Not enough usable activity history. Try another location. {result.reason}</p>}
      {scored && <div aria-live="polite"><div className="forecast-values"><div><strong>{hours(scored.predicted_week_hours)}</strong><span>Predicted apparent fishing vessel-hours</span></div><div><strong>{hours(scored.repeat_last_week_hours)}</strong><span>Repeat-last-week baseline vessel-hours</span></div><div><strong>{change === null ? "Unavailable" : `${change >= 0 ? "+" : ""}${change.toFixed(1)}%`}</strong><span>Change versus baseline</span></div></div>
        <Info label="Forecast map coverage"><p>Purple outline: model cell {scored.cell_id}, {scored.bounds.south}–{scored.bounds.north}° latitude and {scored.bounds.west}–{scored.bounds.east}° longitude. It does not represent a precise forecast for the drawn rectangle.</p>
        {comparison && <p className="small">Comparing {comparison.cells.length} squares. Gold arrows point toward higher predicted activity, not boat travel.</p>}</Info>
        {onShowReasoning ? <button type="button" onClick={onShowReasoning}>Show forecast reasoning</button> : <details><summary>How was this estimated?</summary><p>{scored.selected_explanation}</p><p>{scored.interpretation}</p></details>}
      </div>}
      <Info label="How well the model performed">{info?.evaluation && <p>In the saved test ({info.evaluation.issue_start}–{info.evaluation.issue_end}), the model was off by {hours(info.evaluation.mae_hours)} hours on average. Simply repeating the previous week was off by {hours(info.evaluation.baseline_mae_hours)} hours{info.evaluation.mae_reduction_percent !== null ? `, so the model reduced that average error by ${info.evaluation.mae_reduction_percent.toFixed(2)}%` : ""}. This average error is called MAE. It is not a guarantee for your chosen area.</p>}<p><a href="https://globalfishingwatch.org" target="_blank" rel="noreferrer">Data from Global Fishing Watch</a>. This saved model runs on the backend without a separate GFW request.</p></Info>
    </div>
  </section>;
}
