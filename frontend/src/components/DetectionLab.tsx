import { useEffect, useState } from "react";
import { ApiError, sampleApi, type Api } from "../api/client";
import type { DetectionsResponse } from "../api/types";

const MAX_BYTES = 10 * 1024 * 1024;
const ACCEPTED = ["image/png", "image/jpeg"];

type Result =
  | { state: "idle" }
  | { state: "loading" }
  | { state: "error"; message: string }
  | { state: "ok"; data: DetectionsResponse };

export function DetectionLab({ api }: { api: Api }) {
  const sampleMode = api === sampleApi;
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
    setResult({ state: "loading" });
    try {
      if (sampleMode) {
        setResult({ state: "ok", data: await sampleApi.detect() });
      } else if (file) {
        setResult({ state: "ok", data: await api.detect(file) });
      }
    } catch (e) {
      const message = e instanceof ApiError && (e.status === 404 || e.status === 501)
        ? "Live image detection is unavailable on this backend. Select Sample data to explore an example result."
        : e instanceof Error ? e.message : String(e);
      setResult({ state: "error", message });
    }
  }

  const data = result.state === "ok" ? result.data : null;

  return (
    <div className="lab">
      <div className="toolbar">
        {!sampleMode && (
          <label className="file-pick">
            <input type="file" accept="image/png,image/jpeg" onChange={(e) => pick(e.target.files?.[0])} />
          </label>
        )}
        <button type="button" className="primary" onClick={detect} disabled={(!sampleMode && !file) || result.state === "loading"}>
          {result.state === "loading" ? "Loading…" : sampleMode ? "Show example detections" : "Detect ships"}
        </button>
        <div className="toolbar-note muted">
          {sampleMode ? "Fixed example detections from the sample fixture." : "Live detection requires a connected image detector. PNG or JPEG, up to 10 MB."}
        </div>
      </div>

      {pickError && <div className="notice error">{pickError}</div>}

      <div className="split">
        <section className="panel">
          <div className="panel-head">
            <h2>{sampleMode ? "Example bounding boxes" : "Image"}</h2>
            {data && <span className="muted">{data.image_width} × {data.image_height} px</span>}
          </div>
          {previewUrl || (sampleMode && data) ? (
            <div className="preview" style={sampleMode && data ? {
              aspectRatio: `${data.image_width} / ${data.image_height}`,
              background: "var(--text)",
            } : undefined}>
              {previewUrl && <img src={previewUrl} alt="Uploaded radar image" />}
              {data && (
                <svg
                  className="overlay"
                  role="img"
                  aria-label="Detection bounding boxes"
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
            <p className="empty">{sampleMode ? "Show example detections to view the bounding boxes." : "Choose an image to preview it here."}</p>
          )}
        </section>

        <section className="panel">
          <div className="panel-head">
            <h2>Detections</h2>
          </div>
          {result.state === "idle" && <p className="empty">{sampleMode ? "Show the example to see its scores." : "Run detection to see boxes and scores."}</p>}
          {result.state === "loading" && <p className="empty">{sampleMode ? "Loading example…" : "Running the detector…"}</p>}
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
