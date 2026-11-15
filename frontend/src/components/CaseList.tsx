import type { Case } from "../api/types";
import { formatTime, identityLabel, registration, registrationLabel, reviewLabel } from "../format";
import { StatusLabel } from "./StatusLabel";
import { ShipSymbol } from "./ShipSymbol";

// What the table needs: the vessels to list, which one is highlighted, and what to do on click.
interface Props {
  cases: Case[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}

// Table of vessels (one row per case). Clicking or pressing Enter/Space on a row selects that case.
export function CaseList({ cases, selectedId, onSelect }: Props) {
  return (
    <table className="case-table">
      {/* Column headings. */}
      <thead>
        <tr>
          <th>Vessel</th>
          <th>Reported type</th>
          <th>Authorization</th>
          <th>Observation</th>
          <th>AIS match</th>
          <th>MMSI</th>
          <th>Review</th>
          <th>Captured</th>
        </tr>
      </thead>
      <tbody>
        {/* Build one row per case. */}
        {cases.map((c) => {
          // Shortcuts to the radar observation and its ID.
          const o = c.observation;
          // The case's unique id, used as the row key and when the row is selected.
          const id = o.observation_id;
          return (
            // The whole row is clickable and keyboard-focusable so it works without a mouse.
            <tr
              key={id}
              className={id === selectedId ? "selected" : undefined}
              onClick={() => onSelect(id)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onSelect(id);
                }
              }}
              tabIndex={0}
              aria-selected={id === selectedId}
            >
              {/* Registered / Unregistered / Unresolved, coloured like the map markers. */}
              <td className={`reg marker-${registration(o.identity_status)}`}>
                {registrationLabel[registration(o.identity_status)]}
              </td>
              <td><ShipSymbol type={c.vessel_assessment?.vessel_type} /> {c.vessel_assessment?.vessel_type?.replaceAll("_", " ") ?? "Unknown"}</td>
              {/* The permit decision from the authorization check. */}
              <td>
                <StatusLabel status={c.authorization.status} />
              </td>
              {/* Unique ID of this radar detection. */}
              <td className="mono">{id}</td>
              {/* The detailed AIS match result (matched, unmatched, ambiguous, insufficient data). */}
              <td>{identityLabel[o.identity_status]}</td>
              {/* Ship's AIS number; blank when no AIS track was matched. */}
              <td className="mono">{o.mmsi ?? "—"}</td>
              {/* How urgently a human should review this case, if the backend set one. */}
              <td>{c.review_priority ? reviewLabel[c.review_priority.level] : "—"}</td>
              {/* When the radar image was captured. */}
              <td>{formatTime(o.captured_at)}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
