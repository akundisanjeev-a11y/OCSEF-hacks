import type { AuthorizationStatus } from "../api/types";
import { authorizationLabel } from "../format";

export function StatusLabel({ status }: { status: AuthorizationStatus }) {
  return (
    <span className={`status status-${status}`}>
      <span className="status-mark" aria-hidden="true" />
      {authorizationLabel[status]}
    </span>
  );
}
