import type { ForecastResult } from "../api/forecast";
import { forecastFeatures, type ActivityArrow, type ForecastComparison } from "../forecastMap";
import { Info } from "./Info";
import { LoadingStatus } from "./Loading";
import { forecastNarrative } from "../evidenceNarrative";

const hours = (value: number) => value.toLocaleString(undefined, { maximumFractionDigits: 1 });
const featureNames: Record<string, string> = {
  seasonal_change_fraction: "Seasonal pattern compared with last week",
  recent_three_day_change_fraction: "Most recent three days compared with last week",
  recent_week_daily_mean: "Average daily activity last week",
  previous_week_daily_mean: "Average daily activity the week before",
  previous_month_daily_mean: "Average daily activity over the previous month",
};
export function ForecastEvidence({ forecast: initialForecast, comparison, arrow }: { forecast: ForecastResult; comparison: ForecastComparison | null; arrow: ActivityArrow | null }) {
  const forecast = arrow ? comparison?.cells.find(cell => cell.cell_id === arrow.to_id) ?? initialForecast : initialForecast;
  const story = forecast.status === "scored" ? forecastNarrative(forecast) : null;
  return <div className="forecast-evidence">
    <div className="block"><span className="forecast-badge">HISTORICAL MODEL EXAMPLE</span><h3>Why this area is highlighted</h3><p>Square {forecast.cell_id}: {forecast.bounds.south}°–{forecast.bounds.north}° north/south, {forecast.bounds.west}°–{forecast.bounds.east}° east/west.</p><p>Forecast dates: {forecast.target_start} through {forecast.target_end}. Observations end {forecast.observation_cutoff}.</p>
      {forecast.status === "insufficient_data" ? <p>There is not enough history for a forecast here. {forecast.reason}</p> : <><p className="analysis-headline">{story?.headline}</p>{story?.reasons.map(reason => <article className="explanation-card" key={reason.title}><h4>{reason.title}</h4><p>{reason.text}</p></article>)}
      <div className="evidence-limit"><strong>What this cannot explain</strong><p>This model does not use port locations, trip schedules, fish species, weather or fishing-ground conditions. It cannot tell us that boats are heading for a port, following fish or moving for a particular reason. Those would require additional observations and a validated model using them.</p></div>
      <Info label="See the supporting numbers"><p>The model estimates <strong>{hours(forecast.predicted_week_hours)} fishing boat-hours</strong>, compared with <strong>{hours(forecast.repeat_last_week_hours)}</strong> in the last observed week.</p>{forecast.reasoning_evidence && <ul><li>History used: {forecast.reasoning_evidence.history_start} to {forecast.reasoning_evidence.history_end}.</li><li>Last week's daily average: {hours(forecast.reasoning_evidence.last_week_daily_mean)} boat-hours.</li><li>Latest three days' daily average: {hours(forecast.reasoning_evidence.recent_three_day_daily_mean)} boat-hours.</li><li>Monthly daily average: {hours(forecast.reasoning_evidence.month_daily_mean)} boat-hours.</li><li>Calendar-based estimate: {hours(forecast.reasoning_evidence.seasonal_estimate_hours)} weekly boat-hours{!forecast.seasonal_reference_available ? " (fallback to recent activity)" : ""}.</li></ul>}<p>One boat-hour is one boat active for one hour. These totals do not give the number of boats or their destinations.</p></Info>
      <Info label="Exact model calculation"><p>{forecast.selected_explanation}</p><p>{forecast.interpretation}</p><p>Seasonal reference: {forecast.seasonal_reference_available ? "available" : "not available; fallback used"}.</p>{forecast.data_quality_notes.map(note => <p key={note}>{note}</p>)}</Info>
      {(!forecast.selected_method || !forecast.decision_path_applies_to || forecast.selected_method === forecast.decision_path_applies_to) && <Info label="The model's decision steps"><p>The model compares seasonal patterns and recent activity. These are scaled comparisons, not boat speeds or travel directions.</p><ol>{forecast.decision_path.map((step, index) => <li key={index}>{featureNames[step.feature] ?? step.feature.replaceAll("_", " ")}: {step.observed.toFixed(4)} {step.comparison === "<=" ? "was at or below" : "was above"} {step.threshold.toFixed(4)}.</li>)}</ol>{!forecast.decision_path.length && <p>No decision steps were returned for this forecast.</p>}</Info>}</>}
    </div>
    <div className="block"><h3>What the arrows mean</h3><p>Gold arrows point from a square with less predicted fishing activity toward a neighboring square with more. They compare model forecasts; they are <strong>not boat routes or predicted migration</strong>.</p>
      {comparison ? <p>{comparison.cells.length} squares have usable forecasts; {comparison.unavailable} nearby squares could not be compared. {forecastFeatures(comparison).arrows.features.length === 0 ? "No higher-activity comparison could be drawn from the available forecasts." : "Click a gold arrow to see the values behind it."}</p> : forecast.status === "scored" ? <LoadingStatus label="Comparing nearby forecast areas…" detail="No travel directions are assumed." /> : <p>Nearby comparisons are unavailable. No travel directions are assumed.</p>}
      {arrow && <div className="arrow-explanation"><h3>Why this arrow points here</h3><p>The destination square has more predicted fishing activity than the square at the arrow's tail. That comparison sets the arrow's direction; the model has not predicted boats moving between them.</p><Info label="Compare the two estimates"><p>{arrow.from_id}: {hours(arrow.from_hours)} boat-hours → {arrow.to_id}: {hours(arrow.to_hours)} boat-hours.</p><p>The difference is {hours(arrow.difference)} predicted boat-hours, not a count of migrating boats.</p></Info></div>}
    </div>
    {forecast.status === "scored" && <p className="stat-note">Model: {forecast.model_version} · Data: {forecast.source_dataset}</p>}
  </div>;
}
