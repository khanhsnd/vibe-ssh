import { useApp, type SidePanel } from "@/store/app";
import { useConfig } from "@/store/config";
import { Icon } from "../ui/Icon";

const ITEMS: { id: Exclude<SidePanel, null>; icon: string; tip: string }[] = [
  { id: "sessions", icon: "server", tip: "Sessions" },
  { id: "tunnels", icon: "plug", tip: "Tunnels" },
  { id: "macros", icon: "zap", tip: "Macro & snippet" },
  { id: "keys", icon: "key", tip: "Khóa & host key" },
  { id: "settings", icon: "settings", tip: "Cài đặt" },
];

export function Rail() {
  const { side, setSide, tunnels, setPalette } = useApp();
  const sessions = useConfig((s) => s.sessions.length);
  const running = Object.values(tunnels).filter((t) => t.state === "running").length;

  const badge = (id: string) =>
    id === "sessions" ? (sessions || null) : id === "tunnels" ? (running || null) : null;

  return (
    <div className="rail">
      {ITEMS.map((it) => (
        <button
          key={it.id}
          type="button"
          className={`rail-btn ${side === it.id ? "active" : ""}`}
          data-tip={it.tip}
          aria-label={it.tip}
          aria-pressed={side === it.id}
          onClick={() => setSide(it.id)}
        >
          <Icon n={it.icon} s={18} />
          {badge(it.id) != null && <span className="rail-badge">{badge(it.id)}</span>}
        </button>
      ))}
      <div className="spacer" />
      <button
        type="button"
        className="rail-btn"
        data-tip="Bảng lệnh"
        aria-label="Bảng lệnh"
        onClick={() => setPalette(true)}
      >
        <Icon n="command" s={17} />
      </button>
    </div>
  );
}
