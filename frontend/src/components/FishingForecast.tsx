import { useEffect, useRef, useState } from "react";
import { fetchForecast, type ForecastResult } from "../api/forecast";

const hours = (n: number) => new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(n);

export function FishingForecast({ latitude, longitude }: { latitude: number | null; longitude: number | null }) {
  const [result, setResult] = useState<ForecastResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const active = useRef<AbortController | null>(null);
  useEffect(() => {
    active.current?.abort(); setResult(null); setError(""); setLoading(false);
    return () => active.current?.abort();
  }, [latitude, longitude]);
  async function calculate() {
    if (latitude === null || longitude === null) return;
    active.current?.abort();
    const controller = new AbortController(); active.current = controller;
    setLoading(true); setResult(null); setError("");
    try {
      const response = await fetchForecast(latitude, longitude, controller.signal);
      if (!controller.signal.aborted) setResult(response);
    } catch (e) {
      if (!controller.signal.aborted) setError(e instanceof Error ? e.message : "Forecast unavailable.");
    } finally { if (!controller.signal.aborted) setLoading(false); }
  }
  return <section className="block" aria-label="Your trained fishing forecast">
    <h3>Your ML: fishing activity forecast</h3>
    <p className="muted">Historical demo using the saved decision tree. Predicts fishing vessel-hours, not authorization or activity of every vessel type.</p>
    {latitude !== null && longitude !== null && <p>Selected point: {latitude.toFixed(2)}, {longitude.toFixed(2)}. Uses its complete 5° model cell, not the whole selected rectangle. Click an activity cell to change the point; otherwise the rectangle centre is used.</p>}
    <button type="button" disabled={latitude === null || loading} onClick={() => void calculate()}>{loading ? "Calculating forecast…" : "Get historical fishing forecast"}</button>
    {error && <p className="notice error" role="alert">{error}</p>}
    {result && <div aria-live="polite">
      <p><strong>Forecast: {result.target_start} to {result.target_end}</strong><br />Data through {result.observation_cutoff}; simulated issue {result.simulated_issue_date}.</p>
      <p>Cell: {result.bounds.south}–{result.bounds.north}° latitude, {result.bounds.west}–{result.bounds.east}° longitude.</p>
      {result.status === "insufficient_data" ? <p>Not enough usable activity history. Try another area.</p> : <>
        <p><strong>{hours(result.predicted_week_hours)} vessel-hours expected</strong><br />Last observed week: {hours(result.repeat_last_week_hours)} vessel-hours.</p>
        {result.repeat_last_week_hours > 0 && <p>Expected change: {(100 * (result.predicted_week_hours - result.repeat_last_week_hours) / result.repeat_last_week_hours).toFixed(1)}%.</p>}
        <details><summary>How was this estimated?</summary><p>{result.selected_explanation}</p>{result.data_quality_notes.map(note => <p key={note}>{note}</p>)}<small>{result.model_version} · {result.source_dataset}</small></details>
      </>}
      <p className="muted">These 2025 model dates differ from the GFW observation window. No new model is trained and GFW filters do not change this saved model's historical inputs.</p>
    </div>}
  </section>;
}
