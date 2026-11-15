import type { ReactNode } from "react";

export function Info({ label, children }: { label: string; children: ReactNode }) {
  return <details className="info-disclosure"><summary aria-label={`About ${label}`}><span aria-hidden="true">ⓘ</span> {label}</summary><div className="info-content">{children}</div></details>;
}
