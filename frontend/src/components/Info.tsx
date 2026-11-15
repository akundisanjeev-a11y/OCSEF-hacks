import type { ReactNode } from "react";

// A quiet "more about this" disclosure: a one-line label that opens an explanation in place.
export function Info({ label, children }: { label: string; children: ReactNode }) {
  return <details className="info-disclosure"><summary aria-label={`About ${label}`}>{label}</summary><div className="info-content">{children}</div></details>;
}
