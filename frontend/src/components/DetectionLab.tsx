import { useEffect, useState } from "react";
import type { Api } from "../api/client";
import type { DetectionsResponse } from "../api/types";
import metricsJson from "@fixtures/samples/model_metrics.json";

// Upload limit for radar images; larger files are rejected before they reach the backend.
const MAX_BYTES = 10 * 1024 * 1024;
// The only image types the detector endpoint accepts.
const ACCEPTED = ["image/png", "image/jpeg"];

// The detector's evaluation numbers (precision, recall, mAP@0.5), loaded from a JSON file that
// Backend 1 fills in after testing the model. Any value still null shows as "Not reported yet".
const metrics = metricsJson as {
  checkpoint: string | null;
  evaluation_split: string | null;
  precision: number | null;
  recall: number | null;
  map50: number | null;
};

// The detection request is always in exactly one of these states, so the page can show
// the right message (nothing yet, running, failed, or results).
type Result =
  | { state: "idle" }
  | { state: "loading" }
  | { state: "error"; message: string }
  | { state: "ok"; data: DetectionsResponse };

// Normalised [x_min, y_min, x_max, y_max], from YOLO label lines (box or polygon form).
type TruthBox = [number, number, number, number];

// Turns the text of a YOLO label file (the "correct answers" for an image) into boxes we can draw.
// Each line is "class x y w h" (a box) or "class x1 y1 x2 y2 ..." (a polygon, reduced to its outer box).
// All numbers are fractions of the image size, so the boxes scale with any preview size.
function parseYoloLabels(text: string): TruthBox[] {
  const boxes: TruthBox[] = [];
  // Go through the file one line at a time; each line describes one ship.
  for (const line of text.split(/\r?\n/)) {
    // Drop the class number at the start and read the rest as numbers.
    const n = line.trim().split(/\s+/).slice(1).map(Number);
    // Skip blank, too-short or non-numeric lines.
    if (n.length < 4 || n.some(Number.isNaN)) continue;
    if (n.length === 4) {
      // Box form: centre point plus width and height, converted to corner coordinates.
      const [cx, cy, w, h] = n;
      boxes.push([cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2]);
    } else {
      // Polygon form: alternating x and y values; take the smallest and largest of each as the box.
      const xs = n.filter((_, i) => i % 2 === 0);
      // Every y value (the odd positions) of the polygon's corners.
      const ys = n.filter((_, i) => i % 2 === 1);
      boxes.push([Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]);
    }
  }
  return boxes;
}

// Formats a metric to 3 decimals, or says it has not been measured yet.
const metric = (v: number | null) => (v == null ? "Not reported yet" : v.toFixed(3));

// The Detection lab page: upload a radar image, run the YOLO ship detector through the backend,
// and draw the detected boxes (and optional ground-truth boxes) over the image.
export function DetectionLab({ api }: { api: Api }) {
  // The chosen image file, and a temporary browser URL used to display it.
  const [file, setFile] = useState<File | null>(null);
  // Temporary browser address used to show the chosen image.
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  // The image's real pixel size, used to place boxes before the backend has answered.
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  // Message shown when the chosen image is the wrong type or too large.
  const [pickError, setPickError] = useState<string | null>(null);
  // Where the detection request currently stands.
  const [result, setResult] = useState<Result>({ state: "idle" });
  // Detections scoring below this (0 to 1) are hidden; 0.35 is a common starting cut-off.
  const [minScore, setMinScore] = useState(0.35);
  // The optional correct-answer boxes from a YOLO label file, and any error reading it.
  const [truth, setTruth] = useState<TruthBox[] | null>(null);
  // Message shown when the label file cannot be read.
  const [truthError, setTruthError] = useState<string | null>(null);

  // Creates a preview URL whenever a new image is chosen, and frees it when the image changes
  // or the page closes so the browser does not hold on to the file.
  useEffect(() => {
    if (!file) {
      setPreviewUrl(null);
      return;
    }
    // Make a temporary address so the chosen file can be displayed in an image tag.
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  // Handles choosing an image: clears the old results, then checks the type and size
  // before accepting the file.
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

  // Handles choosing the optional YOLO label file: reads its text and turns it into ground-truth boxes.
  async function pickTruth(f: File | undefined) {
    setTruthError(null);
    if (!f) return setTruth(null);
    // Read the label file's text and convert its lines into boxes.
    const boxes = parseYoloLabels(await f.text());
    if (boxes.length === 0) {
      setTruth(null);
      return setTruthError("No YOLO label lines found in that file.");
    }
    setTruth(boxes);
  }

  // Sends the image to the backend detector and stores the answer (or the error) in `result`.
  async function detect() {
    if (!file) return;
    setResult({ state: "loading" });
    try {
      setResult({ state: "ok", data: await api.detect(file) });
    } catch (e) {
      setResult({ state: "error", message: e instanceof Error ? e.message : String(e) });
    }
  }

  // Values worked out on every render from the result and the score slider:
  // the response data, the detections above the threshold, how many were hidden,
  // and the image size used for the overlay (the backend's size once known, otherwise the file's own).
  const data = result.state === "ok" ? result.data : null;
  // Detections at or above the score threshold: the ones that are drawn and listed.
  const shown = data ? data.observations.filter((o) => o.detection_confidence >= minScore) : [];
  // How many detections the score threshold is hiding.
  const hidden = data ? data.observations.length - shown.length : 0;
  // Image size used to scale the overlay.
  const size = data ? { w: data.image_width, h: data.image_height } : natural;

  return (
    <div className="lab">
      {/* Top bar: pick the image, optionally pick a label file, run detection, and set the score threshold. */}
      <div className="toolbar">
        {/* Radar image picker (PNG or JPEG). */}
        <label className="file-pick">
          <span className="muted">Radar image</span>
          <input type="file" accept="image/png,image/jpeg" onChange={(e) => pick(e.target.files?.[0])} />
        </label>
        {/* Optional YOLO label file, used to compare the model's boxes with the known answers. */}
        <label className="file-pick">
          <span className="muted">Ground-truth labels (optional, YOLO .txt)</span>
          <input type="file" accept=".txt,text/plain" onChange={(e) => pickTruth(e.target.files?.[0])} />
        </label>
        {/* Runs the detector; disabled until an image is chosen and while a run is in progress. */}
        <button type="button" className="primary" onClick={detect} disabled={!file || result.state === "loading"}>
          {result.state === "loading" ? "Detecting…" : "Detect ships"}
        </button>
        {/* Slider that hides low-confidence detections without re-running the model. */}
        <label className="inline-field threshold">
          <span>
            Score threshold <b>{Math.round(minScore * 100)}%</b>
          </span>
          <input type="range" min={0} max={1} step={0.05} value={minScore} onChange={(e) => setMinScore(Number(e.target.value))} />
        </label>
      </div>

      {/* Error messages for a rejected image or an unreadable label file. */}
      {pickError && <div className="notice error">{pickError}</div>}
      {truthError && <div className="notice error">{truthError}</div>}

      {/* Two columns: the image with boxes on the left, results and model numbers on the right. */}
      <div className="split">
        {/* Image panel: header with a colour key, then the preview with boxes drawn on top. */}
        <section className="panel">
          <div className="panel-head">
            <h2>Image</h2>
            {/* Key explaining the box colours, plus the image size in pixels. */}
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
          {/* Show the preview once an image is chosen, otherwise a prompt. */}
          {previewUrl ? (
            <div className="preview">
              {/* The uploaded image; on load it records its real size for the overlay. */}
              <img
                src={previewUrl}
                alt="Uploaded radar image"
                onLoad={(e) => setNatural({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
              />
              {/* Transparent layer on top of the image. Its coordinate system equals the image's pixels,
                  so boxes stay lined up when the preview is resized. */}
              {size && (
                <svg className="overlay" viewBox={`0 0 ${size.w} ${size.h}`} preserveAspectRatio="none">
                  {/* Dashed boxes for the correct answers; the label file stores fractions, so scale to pixels. */}
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
                  {/* Solid numbered boxes for each detection above the score threshold. */}
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

        {/* Right column: detections table and model evaluation. */}
        <div className="lab-side">
          {/* Detections panel: counts in the header, then a message or the table depending on the result. */}
          <section className="panel">
            <div className="panel-head">
              <h2>Detections</h2>
              {/* How many detections are shown, hidden by the threshold, and in the label file. */}
              {data && (
                <span className="muted">
                  {shown.length} shown{hidden > 0 && `, ${hidden} below threshold`}
                  {truth && ` · ${truth.length} labeled`}
                </span>
              )}
            </div>
            {/* One status message for each state: not run yet, running, failed. */}
            {result.state === "idle" && <p className="empty">Run detection to see boxes and scores.</p>}
            {result.state === "loading" && <p className="empty">Running the detector…</p>}
            {result.state === "error" && (
              <div className="notice error">
                <strong>Detection failed.</strong> {result.message}
              </div>
            )}
            {/* Two empty results: the model found nothing, or the threshold hides everything it found. */}
            {data && data.observations.length === 0 && <p className="empty">No ships detected in this image.</p>}
            {data && data.observations.length > 0 && shown.length === 0 && (
              <p className="empty">All detections are below the score threshold.</p>
            )}
            {/* Table of the visible detections: number, score, pixel box and observation ID. */}
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
                  {/* One row per detection; the number matches the label drawn on the image. */}
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

          {/* Model evaluation panel: how well the YOLO11n detector did on the held-out test images. */}
          <section className="panel">
            <div className="panel-head">
              <h2>Model evaluation</h2>
              <span className="muted">YOLO11n fine-tuned on HRSID</span>
            </div>
            <dl className="block">
              {/* Precision: of the boxes the model drew, how many were real ships. */}
              <div className="field">
                <dt>Precision</dt>
                <dd>{metric(metrics.precision)}</dd>
              </div>
              {/* Recall: of the real ships, how many the model found. */}
              <div className="field">
                <dt>Recall</dt>
                <dd>{metric(metrics.recall)}</dd>
              </div>
              {/* mAP@0.5: overall detection quality, counting a box as correct if it overlaps the true one by at least half. */}
              <div className="field">
                <dt>mAP@0.5</dt>
                <dd>{metric(metrics.map50)}</dd>
              </div>
              {/* Which images the model was tested on, and which saved model file was used. */}
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
