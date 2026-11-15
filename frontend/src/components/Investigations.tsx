import { useMemo, useState } from "react";
import type { Api } from "../api/client";
import type { Case } from "../api/types";
import { identityLabel, reviewLabel } from "../format";
import { priorityRank, useCase, useCases } from "../useCases";
import { formatProximity, nearestZone } from "../zones";
import { CaseDetail } from "./CaseDetail";
import { CaseTrace } from "./CaseTrace";
import { StatusLabel } from "./StatusLabel";

type Sort = "priority" | "score" | "time";

const sorters: Record<Sort, (a: Case, b: Case) => number> = {
  priority: (a, b) => priorityRank(a) - priorityRank(b) || b.observation.detection_confidence - a.observation.detection_confidence,
  score: (a, b) => b.observation.detection_confidence - a.observation.detection_confidence,
  time: (a, b) => (b.observation.captured_at ?? "").localeCompare(a.observation.captured_at ?? ""),
};

interface Props {
  api: Api;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}

export function Investigations({ api, selectedId, onSelect }: Props) {
  const [sort, setSort] = useState<Sort>("priority");
  const [query, setQuery] = useState("");
  const { list } = useCases(api, "all");
  const detail = useCase(api, selectedId);

  const queue = useMemo(() => {
    const q = query.trim().toLowerCase();
    const all = list.state === "ok" ? list.data : [];
    return all
      .filter((c) => !q || c.observation.observation_id.toLowerCase().includes(q) || c.observation.mmsi?.includes(q))
      .sort(sorters[sort]);
  }, [list, query, sort]);

  return (
    <div className="invest">
      <section className="panel queue">
        <div className="panel-head">
          <h2>Investigation queue</h2>
          <span className="muted">{list.state === "ok" ? `${queue.length} cases` : ""}</span>
        </div>
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
        {list.state === "loading" && <p className="empty">Loading cases…</p>}
        {list.state === "error" && (
          <div className="notice error">
            <strong>Could not load cases.</strong> {list.message}
          </div>
        )}
        {list.state === "ok" && queue.length === 0 && <p className="empty">No cases match.</p>}
        <ul className="queue-list">
          {queue.map((c) => {
            const o = c.observation;
            const id = o.observation_id;
            return (
              <li key={id}>
                <button
                  type="button"
                  className={id === selectedId ? "queue-item selected" : "queue-item"}
                  onClick={() => onSelect(id)}
                  aria-pressed={id === selectedId}
                >
                  <span className="queue-top">
                    <span className="mono">{id}</span>
                    <span className={`priority priority-${c.review_priority?.level ?? "none"}`}>
                      {c.review_priority ? reviewLabel[c.review_priority.level] : "No priority"}
                    </span>
                  </span>
                  <StatusLabel status={c.authorization.status} />
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
