import { useEffect, useState } from "react";

export function LoadingStatus({ label, detail }: { label: string; detail?: string }) {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    const started = Date.now();
    const timer = window.setInterval(() => setSeconds(Math.floor((Date.now() - started) / 1000)), 1000);
    return () => window.clearInterval(timer);
  }, []);
  return <div className="loading-status" role="status">
    <span className="loading-spinner" aria-hidden="true" />
    <div><strong>{label}</strong>{detail && <span className="loading-detail">{detail}</span>}</div>
    {seconds >= 3 && <span className="loading-elapsed" aria-hidden="true">{seconds}s</span>}
  </div>;
}

export function Skeleton({ variant = "report", label = "Loading vessel evidence" }: { variant?: "report" | "table" | "values"; label?: string }) {
  return <div className={`skeleton-content skeleton-${variant}`} role="status" aria-label={label}>
    <span className="sr-only">{label}</span>
    <div aria-hidden="true">{Array.from({ length: variant === "values" ? 3 : variant === "table" ? 5 : 7 }, (_, index) =>
      <div className="skeleton-row" key={index}><span className="skeleton skeleton-primary" /><span className="skeleton skeleton-secondary" />{variant === "table" && <span className="skeleton skeleton-action" />}</div>
    )}</div>
  </div>;
}
