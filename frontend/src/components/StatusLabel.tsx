import type { AuthorizationStatus } from "../api/types";
import { authorizationLabel } from "../format";

// Small coloured label for a case's permit decision (Authorized / Potential violation / Unknown).
// The colour comes from the status-* CSS classes, and the square mark keeps it readable without colour.
export function StatusLabel({ status }: { status: AuthorizationStatus }) {
  return (
    <span className={`status status-${status}`}>
      {/* Decorative coloured square before the text. */}
      <span className="status-mark" aria-hidden="true" />
      {/* Human-readable name of the status. */}
      {authorizationLabel[status]}
    </span>
  );
}
