import type { PendingPermission } from "../lib/types";
import { OUTCOMES } from "../lib/useDroid";

export default function PermissionSheet({
  permission,
}: {
  permission: PendingPermission;
}) {
  return (
    <div className="sheet-backdrop">
      <div className="sheet">
        <div className="sheet-title">
          <span className="sheet-badge">需要确认</span>
          <span>{permission.title}</span>
        </div>
        <pre className="sheet-detail">{permission.detail}</pre>
        <div className="sheet-actions">
          <button
            className="btn ghost"
            onClick={() => permission.resolve(OUTCOMES.cancel)}
          >
            拒绝
          </button>
          <button
            className="btn subtle"
            onClick={() => permission.resolve(OUTCOMES.always)}
          >
            总是允许
          </button>
          <button
            className="btn primary"
            onClick={() => permission.resolve(OUTCOMES.once)}
          >
            允许一次
          </button>
        </div>
      </div>
    </div>
  );
}
