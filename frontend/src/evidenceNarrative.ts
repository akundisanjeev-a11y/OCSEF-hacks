import type { ScoredForecast } from "./api/forecast";
import type { HistoricalAreaResult, HistoricalEvidence, VesselRisk } from "./api/historical";

type Indicator = HistoricalEvidence["indicators"][number];
export const validCount = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
export const hasRiskEvidence = (indicator: Indicator) => indicator.status !== "unverified" && (indicator.reported_positive === true || (validCount(indicator.count) && indicator.count > 0));
const relative = (a: number, b: number) => a > b ? "higher" : a < b ? "lower" : "the same";
export function forecastNarrative(forecast: ScoredForecast) {
  const higher = forecast.predicted_week_hours > forecast.repeat_last_week_hours;
  const lower = forecast.predicted_week_hours < forecast.repeat_last_week_hours;
  const headline = higher ? "The model expects a busier fishing week here." : lower ? "The model expects a quieter fishing week here." : "The model expects activity similar to the last observed week.";
  const evidence = forecast.reasoning_evidence;
  const reasons: { title: string; text: string }[] = [];
  if (!evidence) return { headline, reasons: [{ title: "Limited explanation available", text: "The forecast includes an estimate and a comparison with the previous week, but its supporting input measurements were not returned. We cannot infer local causes from those numbers." }] };
  const used = new Set(evidence.used_signals);
  if (used.has("last_week")) reasons.push({ title: "It starts with activity already observed here", text: "The selected model uses the area's last observed week as a starting point or input. This anchors the estimate to recorded fishing activity rather than an assumed port or destination." });
  if (used.has("recent_three_day_change_fraction")) reasons.push({ title: "It checks the most recent pattern", text: `Average daily fishing activity over the last three observed days was ${relative(evidence.recent_three_day_daily_mean, evidence.last_week_daily_mean)} than the last week's daily average. The learned rule used that comparison; it does not identify why activity changed.`.replace("the same than", "the same as") });
  if (used.has("seasonal_change_fraction")) reasons.push(forecast.seasonal_reference_available && evidence.seasonal_reference_start ? { title: "It compares the same time of year", text: `A comparison using ${evidence.seasonal_reference_start} through ${evidence.seasonal_reference_end} from the previous year, adjusted for recent activity, suggests ${relative(evidence.seasonal_estimate_hours, forecast.repeat_last_week_hours)} activity than simply repeating last week. This is a calendar pattern, not evidence of spawning, weather or port arrivals.`.replace("the same activity than", "the same activity as") } : { title: "A seasonal comparison was unavailable", text: "The model did not have a usable comparison from the previous year and fell back to recent activity. A seasonal cause cannot be claimed here." });
  const method = forecast.selected_method;
  if (method === "seasonal_correction_tree") reasons.push({ title: "A learned rule combines those observations", text: `The rule selected an estimate ${higher ? "above" : lower ? "below" : "equal to"} last week's activity. This is a pattern learned from earlier examples, not a finding about a port, a species or a boat's intentions.` });
  else if (method === "trained_calibration") reasons.push({ title: "A learned adjustment is applied", text: "The model scales the previous week's activity using a factor learned from earlier examples. It does not use a port or seasonal explanation for this selected method." });
  else if (method === "seasonal_blend") reasons.push({ title: "The selected inputs are combined", text: "The model combines its selected recent and calendar-based inputs using weights learned from earlier examples. The comparison above describes the available pattern, not the physical reason boats were there." });
  else if (method === "repeat_last_week") reasons.push({ title: "It repeats the previous week's activity", text: "This method carries the last observed week forward. It does not infer a new destination or a reason boats might move." });
  return { headline, reasons };
}

const guides: Record<string, { finding: (n: number) => string; why: string; limit: string; next: string }> = {
  fishing_in_no_take_mpa: { finding: n => `GFW reports ${n} estimated fishing event${n === 1 ? "" : "s"} linked to no-take protected areas.`, why: "A no-take area restricts fishing to protect marine life, so a reported overlap deserves review.", limit: "The estimated activity and boundary match can be wrong. The summary alone does not establish a violation.", next: "Compare the source event track with the protected-area boundary and the rules in force on those dates." },
  no_known_rfmo_authorization: { finding: n => `GFW reports ${n} estimated fishing event${n === 1 ? "" : "s"} without a matching permit in its regional fisheries records.`, why: "This is a gap between reported activity and the public permit records checked by GFW.", limit: "Regional records do not cover every national permit and can be incomplete or outdated. Missing records do not prove that permission was absent.", next: "Check the relevant regional registry and the boat's permit for the event dates, area and activity." },
  ais_gap: { finding: n => `GFW reports ${n} radio-signal gap event${n === 1 ? "" : "s"} for this boat.`, why: "A gap leaves part of the boat's activity harder to account for.", limit: "The summary does not establish intentional disabling or what happened during the gap. This GFW indicator covers qualifying offshore gaps, not every missing signal, and does not rule out gaps near shore. Reception issues must also be considered.", next: "Check the event times, location, reception information and records before and after the gap." },
  iuu_listing: { finding: n => `GFW reports ${n} illegal-fishing list record${n === 1 ? "" : "s"} for this identity in the selected period.`, why: "A listing is a documentary lead that requires verification against the issuing source.", limit: "Identity and listing dates must match. This count does not locate the listed conduct in your selected area.", next: "Verify the original regional fisheries list, the boat's identifiers and the dates of inclusion." },
};
export function indicatorNarrative(indicator: Indicator) {
  const known = validCount(indicator.count), positive = hasRiskEvidence(indicator);
  const guide = guides[indicator.code];
  const positiveFinding = validCount(indicator.count) && indicator.count > 0 ? (guide?.finding(indicator.count) ?? `The source reports ${indicator.count} record(s) for “${indicator.label}”.`) : "";
  return {
    status: positive ? "flagged" as const : !known || indicator.status === "unverified" ? "unavailable" as const : "clear" as const,
    finding: positive && (!known || indicator.count === 0) ? "The source contains positive evidence for this check, but its count is unavailable or inconsistent. Review the source records; no exact count is asserted." : !known || indicator.status === "unverified" ? "The source did not return a usable count for this check. It was not treated as zero." : !positive ? "The source returned zero for this check during the report dates. This is not a general safety or permission decision." : indicator.count_is_lower_bound ? positiveFinding.replace("reports ", "reports at least ") : positiveFinding,
    why: positive ? guide?.why ?? "This source result is a reason to review the underlying records." : "",
    limit: guide?.limit ?? "The available summary does not explain the cause or establish wrongdoing.",
    next: guide?.next ?? "Open the source report and verify the record, identity, dates and location.",
  };
}
export function areaNarrative(result: HistoricalAreaResult, risks: Record<string, VesselRisk>) {
  const current = result.vessels.map(vessel => risks[vessel.vessel_id]).filter(Boolean);
  const successful = current.filter(risk => !risk.error);
  const flagged = successful.filter(risk => risk.state === "flagged").length;
  const incomplete = current.filter(risk => risk.error || risk.state === "unknown" || risk.missing_count > 0).length;
  const codes = [...new Set(successful.flatMap(risk => risk.indicators.map(indicator => indicator.code)))];
  const findings = codes.map(code => ({ code, boats: successful.filter(risk => risk.indicators.some(indicator => indicator.code === code && hasRiskEvidence(indicator))).length })).filter(row => row.boats > 0);
  return { flagged, incomplete, attempted: current.length, unchecked: result.vessels.length - current.length, failed: current.filter(risk => risk.error).length, findings };
}
