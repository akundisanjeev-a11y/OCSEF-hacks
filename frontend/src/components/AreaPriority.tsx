import { useEffect, useRef, useState } from 'react';
import type { HistoricalAreaResult } from '../api/historical';
import { cancelPriority, createPriority, getPriority, priorityRequest, type PriorityJob } from '../api/priority';
import './AreaPriority.css';

export function AreaPriority({ report }: { report: HistoricalAreaResult }) {
  const [job, setJob] = useState<PriorityJob | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [includeVesselEvidence, setIncludeVesselEvidence] = useState(true);
  const version = useRef(0);
  const abort = useRef<AbortController | null>(null);
  const currentId = useRef<string | null>(null);
  const key = JSON.stringify([report.bounds, report.start, report.end, report.applied_filters, report.mode, report.skipped, includeVesselEvidence]);
  useEffect(() => {
    version.current++; abort.current?.abort();
    if (currentId.current) void cancelPriority(currentId.current).catch(() => {});
    currentId.current = null; setJob(null); setBusy(false); setError('');
    return () => {
      version.current++; abort.current?.abort();
      if (currentId.current) void cancelPriority(currentId.current).catch(() => {});
      currentId.current = null;
    };
  }, [key]);

  async function calculate() {
    const run = ++version.current;
    abort.current?.abort(); const controller = new AbortController(); abort.current = controller;
    setBusy(true); setError(''); setJob(null);
    try {
      let next = await createPriority({ ...priorityRequest(report), include_vessel_evidence: includeVesselEvidence }, controller.signal);
      if (run !== version.current) { void cancelPriority(next.id).catch(() => {}); return; }
      currentId.current = next.id; setJob(next);
      while (next.status === 'queued' || next.status === 'running') {
        await new Promise<void>(resolve => {
          const done = () => { clearTimeout(timer); controller.signal.removeEventListener('abort', done); resolve(); };
          const timer = setTimeout(done, 1000);
          controller.signal.addEventListener('abort', done, { once: true });
        });
        if (controller.signal.aborted || run !== version.current) return;
        next = await getPriority(next.id, controller.signal);
        if (run !== version.current) return;
        setJob(next);
      }
      currentId.current = null;
      if (next.error) setError(next.error);
    } catch (e) {
      if (!controller.signal.aborted && run === version.current) setError(e instanceof Error ? e.message : String(e));
    } finally { if (run === version.current) setBusy(false); }
  }
  function stop() {
    const run = ++version.current; abort.current?.abort(); setBusy(false);
    if (currentId.current) void cancelPriority(currentId.current).then(value => { if (run === version.current) setJob(value); }).catch(e => { if (run === version.current) setError(String(e)); });
    currentId.current = null;
  }
  const result = job?.result;
  const marine = result?.components?.habitats;
  const forecast = result?.components?.forecast;
  return <section className="panel area-priority" aria-busy={busy}>
    <div className="panel-head"><h2>Area review priority</h2><button type="button" disabled={busy || !report.bounds || report.skipped || report.mode !== 'gfw'} onClick={() => void calculate()}>Calculate priority</button>{busy && <button type="button" onClick={stop}>Stop assessment</button>}</div>
    <div className="block">
      <p>Uses this report’s rectangle, dates and fleet filters. Only matching, complete inputs contribute. Historical habitat maps are excluded; SAR views are compared rather than added.</p>
      <label><input type="checkbox" checked={includeVesselEvidence} disabled={busy} onChange={event => setIncludeVesselEvidence(event.target.checked)} /> Include detailed vessel/event checks (slower)</label>
      {!includeVesselEvidence && <p>Only map sources and an aligned forecast will be assessed. Vessel and event warning checks remain unknown; this is a partial assessment.</p>}
      {busy && <p role="status">{job?.progress.phase ?? 'Starting assessment'}{job?.progress.total != null ? ` · ${job.progress.completed}/${job.progress.total}` : ''}. Large fleets can take several minutes.</p>}
      {error && <p className="notice error" role="alert">{error}</p>}
      {result && <div aria-live="polite">
        <p><strong>{result.priority_score == null ? 'Priority unavailable' : `${result.status === 'partial' ? 'At least ' : ''}${result.priority_score.toFixed(1)} / 100`}</strong> · <span className={`priority-category priority-${result.priority_category?.toLowerCase() ?? 'unknown'}`}>{result.priority_category ?? 'Assessment incomplete'}</span></p>
        <p>{result.coverage_percent}% of policy weight assessed · possible policy range {result.score_range[0].toFixed(1)}–{result.score_range[1].toFixed(1)}. This is a review heuristic, not a probability of illegality or measured damage.</p>
        {result.status !== 'complete' && <p className="notice">Missing sources remain unknown. A low supported score does not establish low risk.</p>}
        {forecast?.reason === 'forecast_dates_do_not_match_selection' && <details><summary>Why the forecast is excluded</summary><p>The model covers {forecast.forecast_start} to {forecast.forecast_end_exclusive} (end exclusive). This assessment uses {result.start} to {result.end_exclusive}. Predictions from a different period cannot be added to this score.</p></details>}
        {marine && <details><summary>Marine habitat reference</summary>
          {!marine.layers?.length ? <p>Marine habitat reference data is not available for this assessment{marine.reason === 'habitat_index_not_prepared' ? ' because it has not been loaded on this backend' : ''}. This does not mean coral or seagrass is absent.</p> : marine.layers.map((layer, index) => <article key={`${layer.name}-${index}`}><p><strong>{layer.name}{layer.reference_year ? ` · ${layer.reference_year} reference` : ''}</strong></p>{layer.reference_only ? <p>{layer.reference_only.polygon_source_records_intersecting} source polygon records intersect this rectangle; {layer.reference_only.point_source_records_inside} source point records lie inside. Mapped polygon footprint: {layer.reference_only.mapped_polygon_area_km2.toLocaleString(undefined, { maximumFractionDigits: 2 })} km².</p> : <p>Reference measurements were unavailable for this layer.</p>}</article>)}
          <p>These are historical reference maps, not measurements of current habitat health or damage. They do not contribute to the numerical priority score.</p>
        </details>}
        {result.review_triggers.map(reason => <p key={reason}>{reason}</p>)}
        <details><summary>Score breakdown and exclusions</summary>
          <div className="table-scroll"><table className="case-table"><thead><tr><th>Factor</th><th>Weight</th><th>Points</th><th>Reason</th></tr></thead><tbody>{result.factors.map(factor => <tr key={factor.code}><td>{factor.label}</td><td>{factor.weight}%</td><td>{factor.contribution_points == null ? 'Unavailable' : factor.contribution_points.toFixed(2)}</td><td>{factor.reason}</td></tr>)}</tbody></table></div>
          {result.adjustments.map((item, i) => <p key={i}>Review escalation: +{item.points.toFixed(2)} points. {item.reason}</p>)}
          {Object.entries(result.excluded_components).map(([name, reason]) => <p key={name}><strong>{name.replaceAll('_', ' ')}:</strong> {reason ?? 'Not available for this assessment'}</p>)}
          {Object.entries(result.components ?? {}).filter(([, component]) => component.detail).map(([name, component]) => <p key={`detail-${name}`}><strong>{name.replaceAll('_', ' ')} source issue:</strong> {component.detail}</p>)}
          <p>{result.start} → {result.end_exclusive} (end exclusive) · {result.policy_version}</p>
        </details>
      </div>}
    </div>
  </section>;
}
