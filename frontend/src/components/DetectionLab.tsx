import { useEffect, useState } from "react";
import type { Api } from "../api/client";
import type { DetectionsResponse } from "../api/types";

const MAX_BYTES = 10 * 1024 * 1024;
const ACCEPTED = ["image/png", "image/jpeg"];

type Result =
  | { state: "idle" }
  | { state: "loading" }
  | { state: "error"; message: string }
  | { state: "ok"; data: DetectionsResponse };

export function DetectionLab({ api }: { api: Api }) {
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [pickError, setPickError] = useState<string | null>(null);
  const [result, setResult] = useState<Result>({ state: "idle" });

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

  return (
    <div className="lab">
      <div className="toolbar">
        <label className="file-pick">
          <input type="file" accept="image/png,image/jpeg" onChange={(e) => pick(e.target.files?.[0])} />
        </label>
        <button type="button" className="primary" onClick={detect} disabled={!file || result.state === "loading"}>
          {result.state === "loading" ? "Detecting…" : "Detect ships"}
        </button>
        <div className="toolbar-note muted">Radar image, PNG or JPEG, up to 10 MB.</div>
      </div>

      {pickError && <div className="notice error">{pickError}</div>}

      <div className="split">
        <section className="panel">
          <div className="panel-head">
            <h2>Image</h2>
            {data && <span className="muted">{data.image_width} × {data.image_height} px</span>}
          </div>
          {previewUrl ? (
            <div className="preview">
              <img src={previewUrl} alt="Uploaded radar image" />
              {data && (
                <svg
                  className="overlay"
                  viewBox={`0 0 ${data.image_width} ${data.image_height}`}
                  preserveAspectRatio="none"
                >
                  {data.observations.map((o, i) =>
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
            <p className="empty">Choose an image to preview it here.</p>
          )}
        </section>

        <section className="panel">
          <div className="panel-head">
            <h2>Detections</h2>
          </div>
          {result.state === "idle" && <p className="empty">Run detection to see boxes and scores.</p>}
          {result.state === "loading" && <p className="empty">Running the detector…</p>}
          {result.state === "error" && (
            <div className="notice error">
              <strong>Detection failed.</strong> {result.message}
            </div>
          )}
          {data && data.observations.length === 0 && <p className="empty">No ships detected in this image.</p>}
          {data && data.observations.length > 0 && (
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
                {data.observations.map((o, i) => (
                  <tr key={o.observation_id}>
                    <td>{i + 1}</td>
                    <td>{o.detection_confidence?.toFixed(2) ?? "—"}</td>
                    <td className="mono">{o.bbox_px ? `[${o.bbox_px.join(", ")}]` : "—"}</td>
                    <td className="mono">{o.observation_id}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>
    </div>
  );
}
