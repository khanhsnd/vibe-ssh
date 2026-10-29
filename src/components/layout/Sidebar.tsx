import { fmtSize, isMac } from "@/lib/util";
import { useApp, type SidePanel } from "@/store/app";
import { useConfig } from "@/store/config";
import { KeysPanel } from "../sidebar/KeysPanel";
import { MacrosPanel } from "../sidebar/MacrosPanel";
import { SessionsPanel } from "../sidebar/SessionsPanel";
import { SettingsPanel } from "../sidebar/SettingsPanel";
import { TunnelsSection } from "../sidebar/TunnelsSection";
import { IBtn } from "../ui/primitives";

const NAV: { id: Exclude<SidePanel, null>; icon: string; tip: string }[] = [
  { id: "sessions", icon: "server", tip: "Host & tunnel" },
  { id: "macros", icon: "zap", tip: "Macro & snippet" },
  { id: "keys", icon: "key", tip: "Khóa SSH & host key" },
  { id: "settings", icon: "settings", tip: "Cài đặt" },
];

/// Sidebar liền với nền cửa sổ: hàng trên kéo được cửa sổ, giữa là bảng đang
/// chọn, đáy là thanh chuyển bảng.
export function Sidebar() {
  const { side, setSide, setEditing, editing, mem } = useApp();
  const width = useConfig((s) => s.settings.sidebarWidth);

  return (
    <aside className="sidebar" style={{ width }}>
      <div className="sb-top" data-tauri-drag-region>
        {isMac() && <div className="mac-inset" data-tauri-drag-region />}
        <span className="sb-brand" data-tauri-drag-region>Vibe SSH</span>
        <IBtn icon="plus" tip="Session mới" onClick={() => setEditing("new")} />
        <IBtn icon="sidebar" tip="Ẩn sidebar (⌘B)" onClick={() => setSide(null)} />
      </div>

      <div className="sb-panel">
        {side === "sessions" && (
          <>
            <SessionsPanel />
            {!editing && <TunnelsSection />}
          </>
        )}
        {side === "macros" && <MacrosPanel />}
        {side === "keys" && <KeysPanel />}
        {side === "settings" && <SettingsPanel />}
      </div>

      <nav className="sb-nav">
        {NAV.map((n) => (
          <IBtn key={n.id} icon={n.icon} tip={n.tip} on={side === n.id} onClick={() => setSide(n.id)} />
        ))}
        <span className="sb-mem" data-tip="RAM của app (không gồm process con)">
          {mem ? fmtSize(mem * 1024) : ""}
        </span>
      </nav>
    </aside>
  );
}
