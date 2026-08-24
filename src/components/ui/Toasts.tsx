import { useApp } from "@/store/app";
import { Icon } from "./Icon";

const ICON = { ok: "check", err: "alert", warn: "alert", info: "info" } as const;

export function Toasts() {
  const { toasts, dropToast } = useApp();
  return (
    <div className="toasts">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.kind}`} role="status">
          <span className="ic"><Icon n={ICON[t.kind]} s={15} /></span>
          <span className="msg" style={{ flex: 1 }}>{t.msg}</span>
          <button type="button" className="ibtn sm" data-tip="Đóng" onClick={() => dropToast(t.id)}>
            <Icon n="x" s={12} />
          </button>
        </div>
      ))}
    </div>
  );
}
