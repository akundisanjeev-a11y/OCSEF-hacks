import { useEffect, useState } from "react";
import type { Api } from "../api/client";
import type { DetectionsResponse } from "../api/types";
import metricsJson from "@fixtures/samples/model_metrics.json";

const MAX_BYTES = 10 * 1024 * 1024;
const ACCEPTED = ["image/png", "image/jpeg"];

const metrics = metricsJson as {
  checkpoint: string | null;
  evaluation_split: string | null;
  precision: number | null;
  recall: number | null;
  map50: number | null;
};

type Result =
  | { state: "idle" }
  | { state: "loading" }
  | { state: "error"; message: string }
  | { state: "ok"; data: DetectionsResponse };

// Normalised [x_min, y_min, x_max, y_max], from YOLO label lines (box or polygon form).
type TruthBox = [number, number, number, number];

function parseYoloLabels(text: string): TruthBox[] {
  const boxes: TruthBox[] = [];
  for (const line of text.split(/\r?\n/)) {
    const n = line.trim().split(/\s+/).slice(1).map(Number);
    if (n.length < 4 || n.some(Number.isNaN)) continue;
    if (n.length === 4) {
      const [cx, cy, w, h] = n;
      boxes.push([cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2]);
    } else {
      const xs = n.filter((_, i) => i % 2 === 0);
      const ys = n.filter((_, i) => i % 2 === 1);
      boxes.push([Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]);
    }
  }
  return boxes;
}

const metric = (v: number | null) => (v == null ? "Not reported yet" : v.toFixed(3));

export function DetectionLab({ api }: { api: Api }) {
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const [pickError, setPickError] = useState<string | null>(null);
  const [result, setResult] = useState<Result>({ state: "idle" });
  const [minScore, setMinScore] = useState(0.35);
  const [truth, setTruth] = useState<TruthBox[] | null>(null);
  const [truthError, setTruthError] = useState<string | null>(null);

  useEffect(() => {
    if (!file) {
      setPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  function pick(f: File | undefined) {
    setResult({ state: "idle" });
    setPickError(null);
    setNatural(null);
    if (!f) return setFile(null);
    if (!ACCEPTED.includes(f.type)) {
      setFile(null);
      return setPickError("Choose a PNG or JPEG image.");
    }
    if (f.size > MAX_BYTES) {
      setFile(null);
      return setPickError("Image is larger than 10 MB.");
    }
    setFile(f);
  }

  async function pickTruth(f: File | undefined) {
    setTruthError(null);
    if (!f) return setTruth(null);
    const boxes = parseYoloLabels(await f.text());
    if (boxes.length === 0) {
      setTruth(null);
      return setTruthError("No YOLO label lines found in that file.");
    }
    setTruth(boxes);
  }

  async function detect() {
    if (!file) return;
    setResult({ state: "loading" });
    try {
      setResult({ state: "ok", data: await api.detect(file) });
    } catch (e) {
      setResult({ state: "error", message: e instanceof Error ? e.message : String(e) });
    }
  }

  const data = result.state === "ok" ? result.data : null;
  const shown = data ? data.observations.filter((o) => o.detection_confidence >= minScore) : [];
  const hidden = data ? data.observations.length - shown.length : 0;
  const size = data ? { w: data.image_width, h: data.image_height } : natural;

  return (
    <div className="lab">
      <div className="toolbar">
        <label className="file-pick">
          <span className="muted">Radar image</span>
          <input type="file" accept="image/png,image/jpeg" onChange={(e) => pick(e.target.files?.[0])} />
        </label>
        <label className="file-pick">
          <span className="muted">Ground-truth labels (optional, YOLO .txt)</span>
          <input type="file" accept=".txt,text/plain" onChange={(e) => pickTruth(e.target.files?.[0])} />
        </label>
        <button type="button" className="primary" onClick={detect} disabled={!file || result.state === "loading"}>
          {result.state === "loading" ? "Detecting…" : "Detect ships"}
        </button>
        <label className="inline-field threshold">
          <span>
            Score threshold <b>{Math.round(minScore * 100)}%</b>
          </span>
          <input type="range" min={0} max={1} step={0.05} value={minScore} onChange={(e) => setMinScore(Number(e.target.value))} />
        </label>
      </div>

      {pickError && <div className="notice error">{pickError}</div>}
      {truthError && <div className="notice error">{truthError}</div>}

      <div className="split">
        <section className="panel">
          <div className="panel-head">
            <h2>Image</h2>
            <span className="lab-legend">
              <span className="key key-detected">Detected</span>
              {truth && <span className="key key-truth">Ground truth</span>}
              {size && (
                <span className="muted">
                  {size.w} × {size.h} px
                </span>
              )}
            </span>
          </div>
          {previewUrl ? (
            <div className="preview">
              <img
                src={previewUrl}
                alt="Uploaded radar image"
                onLoad={(e) => setNatural({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
              />
              {size && (
                <svg className="overlay" viewBox={`0 0 ${size.w} ${size.h}`} preserveAspectRatio="none">
                  {truth?.map((t, i) => (
                    <rect
                      key={i}
                      className="truth"
                      x={t[0] * size.w}
                      y={t[1] * size.h}
                      width={(t[2] - t[0]) * size.w}
                      height={(t[3] - t[1]) * size.h}
                      vectorEffect="non-scaling-stroke"
                    />
                  ))}
                  {shown.map((o, i) =>
                    o.bbox_px ? (
                      <g key={o.observation_id}>
                        <rect
                          x={o.bbox_px[0]}
                          y={o.bbox_px[1]}
                          width={o.bbox_px[2] - o.bbox_px[0]}
                          height={o.bbox_px[3] - o.bbox_px[1]}
                          vectorEffect="non-scaling-stroke"
                        />
                        <text x={o.bbox_px[0]} y={o.bbox_px[1] - 4}>
                          {i + 1}
                        </text>
                      </g>
                    ) : null,
                  )}
                </svg>
              )}
            </div>
          ) : (
            <p className="empty">Choose a radar image to preview it here.</p>
          )}
        </section>

        <div className="lab-side">
          <section className="panel">
            <div className="panel-head">
              <h2>Detections</h2>
              {data && (
                <span className="muted">
                  {shown.length} shown{hidden > 0 && `, ${hidden} below threshold`}
                  {truth && ` · ${truth.length} labeled`}
                </span>
              )}
            </div>
            {result.state === "idle" && <p className="empty">Run detection to see boxes and scores.</p>}
            {result.state === "loading" && <p className="empty">Running the detector…</p>}
            {result.state === "error" && (
              <div className="notice error">
                <strong>Detection failed.</strong> {result.message}
              </div>
            )}
            {data && data.observations.length === 0 && <p className="empty">No ships detected in this image.</p>}
            {data && data.observations.length > 0 && shown.length === 0 && (
              <p className="empty">All detections are below the score threshold.</p>
            )}
            {shown.length > 0 && (
              <table className="case-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Score</th>
                    <th>Box (px)</th>
                    <th>Observation</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((o, i) => (
                    <tr key={o.observation_id}>
                      <td>{i + 1}</td>
                      <td>{o.detection_confidence.toFixed(2)}</td>
                      <td className="mono">{o.bbox_px ? `[${o.bbox_px.join(", ")}]` : "—"}</td>
                      <td className="mono">{o.observation_id}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

          <section className="panel">
            <div className="panel-head">
              <h2>Model evaluation</h2>
              <span className="muted">YOLO11n fine-tuned on HRSID</span>
            </div>
            <dl className="block">
              <div className="field">
                <dt>Precision</dt>
                <dd>{metric(metrics.precision)}</dd>
              </div>
              <div className="field">
                <dt>Recall</dt>
                <dd>{metric(metrics.recall)}</dd>
              </div>
              <div className="field">
                <dt>mAP@0.5</dt>
                <dd>{metric(metrics.map50)}</dd>
              </div>
              <div className="field">
                <dt>Evaluation split</dt>
                <dd>{metrics.evaluation_split ?? "Not reported yet"}</dd>
              </div>
              <div className="field">
                <dt>Checkpoint</dt>
                <dd>{metrics.checkpoint ?? "Not reported yet"}</dd>
              </div>
            </dl>
          </section>
        </div>
      </div>
    </div>
  );
}
