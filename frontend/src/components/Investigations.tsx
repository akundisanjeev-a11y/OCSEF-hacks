import { useMemo, useState } from "react";
import type { Api } from "../api/client";
import type { Case } from "../api/types";
import { identityLabel, reviewLabel } from "../format";
import { priorityRank, useCase, useCases } from "../useCases";
import { formatProximity, nearestZone } from "../zones";
import { CaseDetail } from "./CaseDetail";
import { CaseTrace } from "./CaseTrace";
import { StatusLabel } from "./StatusLabel";

// The three ways the investigation queue can be ordered.
type Sort = "priority" | "score" | "time";

// One comparison function per sort option, used by Array.sort.
// "priority" puts High first and breaks ties by detection score; "score" is highest score first;
// "time" is most recent capture first (cases with no capture time go last).
const sorters: Record<Sort, (a: Case, b: Case) => number> = {
  priority: (a, b) => priorityRank(a) - priorityRank(b) || b.observation.detection_confidence - a.observation.detection_confidence,
  score: (a, b) => b.observation.detection_confidence - a.observation.detection_confidence,
  time: (a, b) => (b.observation.captured_at ?? "").localeCompare(a.observation.captured_at ?? ""),
};

// What the page receives from App: the backend connection and which case is currently selected
// (shared with the other pages so a case opened elsewhere stays selected here).
interface Props {
  api: Api;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}

// The Investigations page: a ranked list of cases on the left, and the full evidence for the
// selected case on the right (a step-by-step trail plus every detail).
export function Investigations({ api, selectedId, onSelect }: Props) {
  // How the queue is ordered, and the text typed into the search box.
  const [sort, setSort] = useState<Sort>("priority");
  // Text typed into the search box (a case id or MMSI).
  const [query, setQuery] = useState("");
  // Loads every case from the backend, and separately the full record of the selected case.
  const { list } = useCases(api, "all");
  // The full case for the selected id, loaded from the backend.
  const detail = useCase(api, selectedId);

  // The visible queue: cases matching the search text (case ID or MMSI), in the chosen order.
  // Recomputed only when the loaded cases, the search or the sort option change.
  const queue = useMemo(() => {
    const q = query.trim().toLowerCase();
    // Every loaded case, or an empty list while loading or after an error.
    const all = list.state === "ok" ? list.data : [];
    return all
      .filter((c) => !q || c.observation.observation_id.toLowerCase().includes(q) || c.observation.mmsi?.includes(q))
      .sort(sorters[sort]);
  }, [list, query, sort]);

  return (
    <div className="invest">
      {/* Left panel: the investigation queue. */}
      <section className="panel queue">
        <div className="panel-head">
          <h2>Investigation queue</h2>
          {/* Number of cases currently in the queue. */}
          <span className="muted">{list.state === "ok" ? `${queue.length} cases` : ""}</span>
        </div>
        {/* Search box and sort menu. */}
        <div className="queue-tools">
          <input
            type="search"
            placeholder="Search case ID or MMSI"
            aria-label="Search case ID or MMSI"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <select aria-label="Sort by" value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
            <option value="priority">Highest priority first</option>
            <option value="score">Highest detection score first</option>
            <option value="time">Most recent first</option>
          </select>
        </div>
        {/* Loading, error and empty messages for the list. */}
        {list.state === "loading" && <p className="empty">Loading cases…</p>}
        {list.state === "error" && (
          <div className="notice error">
            <strong>Could not load cases.</strong> {list.message}
          </div>
        )}
        {list.state === "ok" && queue.length === 0 && <p className="empty">No cases match.</p>}
        {/* One clickable card per case, showing its ID, review priority, permit decision and key facts. */}
        <ul className="queue-list">
          {queue.map((c) => {
            const o = c.observation;
            // The case's unique id.
            const id = o.observation_id;
            return (
              <li key={id}>
                {/* The card is a button so it works with the keyboard; the selected one is highlighted. */}
                <button
                  type="button"
                  className={id === selectedId ? "queue-item selected" : "queue-item"}
                  onClick={() => onSelect(id)}
                  aria-pressed={id === selectedId}
                >
                  {/* Top row: case ID on the left, review priority on the right. */}
                  <span className="queue-top">
                    <span className="mono">{id}</span>
                    <span className={`priority priority-${c.review_priority?.level ?? "none"}`}>
                      {c.review_priority ? reviewLabel[c.review_priority.level] : "No priority"}
                    </span>
                  </span>
                  {/* The backend's permit decision. */}
                  <StatusLabel status={c.authorization.status} />
                  {/* One-line summary: AIS match result, detection score and distance to the nearest fishing zone. */}
                  <span className="muted small">
                    AIS {identityLabel[o.identity_status].toLowerCase()} · score {o.detection_confidence.toFixed(2)} ·{" "}
                    {formatProximity(nearestZone(o.position))}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </section>

      {/* Right panel: the selected case, or a message while nothing is selected or loading. */}
      <section className="panel invest-detail">
        {detail.state === "idle" && (
          <p className="empty">Select a case from the queue to walk through its evidence, from radar detection to authorization.</p>
        )}
        {detail.state === "loading" && <p className="empty">Loading case…</p>}
        {detail.state === "error" && (
          <div className="notice error">
            <strong>Could not load case {selectedId}.</strong> {detail.message}
          </div>
        )}
        {/* Once loaded: the five-step evidence trail on top, then the full case detail in two columns. */}
        {detail.state === "ok" && (
          <>
            <CaseTrace data={detail.data} />
            <CaseDetail data={detail.data} wide />
          </>
        )}
      </section>
    </div>
  );
}
