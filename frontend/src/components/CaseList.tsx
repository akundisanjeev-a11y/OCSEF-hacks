import type { Case } from "../api/types";
import { formatTime, identityLabel, reviewLabel } from "../format";
import { StatusLabel } from "./StatusLabel";

interface Props {
  cases: Case[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}

export function CaseList({ cases, selectedId, onSelect }: Props) {
  return (
    <table className="case-table">
      <thead>
        <tr>
          <th>Authorization</th>
          <th>Observation</th>
          <th>AIS match</th>
          <th>MMSI</th>
          <th>Review</th>
          <th>Captured</th>
        </tr>
      </thead>
      <tbody>
        {cases.map((c) => {
          const o = c.observation;
          const id = o.observation_id;
          return (
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
              <td>
                <StatusLabel status={c.authorization.status} />
              </td>
              <td className="mono">{id}</td>
              <td>{identityLabel[o.identity_status]}</td>
              <td className="mono">{o.mmsi ?? "—"}</td>
              <td>{c.review_priority ? reviewLabel[c.review_priority.level] : "—"}</td>
              <td>{formatTime(o.captured_at)}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
