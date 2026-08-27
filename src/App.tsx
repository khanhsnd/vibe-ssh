import { useEffect } from "react";
import { isMac } from "@/lib/util";
import { useApp } from "@/store/app";
import { useConfig } from "@/store/config";
import { Rail } from "./components/layout/Rail";
import { Resizer } from "./components/layout/Resizer";
import { StatusBar } from "./components/layout/StatusBar";
import { TitleBar } from "./components/layout/TitleBar";
import { KeysPanel } from "./components/sidebar/KeysPanel";
import { MacrosPanel } from "./components/sidebar/MacrosPanel";
import { SessionsPanel } from "./components/sidebar/SessionsPanel";
import { SettingsPanel } from "./components/sidebar/SettingsPanel";
import { TunnelsPanel } from "./components/sidebar/TunnelsPanel";
import { SftpPanel } from "./components/sftp/SftpPanel";
import { Workspace } from "./components/terminal/Workspace";
import { Palette } from "./components/ui/Palette";
import { Toasts } from "./components/ui/Toasts";

export default function App() {
  const cfg = useConfig();
  const app = useApp();

  useEffect(() => {
    void cfg.load().then(() => void app.init());
    // Khởi động một lần.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useTheme(cfg.settings.theme);
  useTooltips();
  useShortcuts();

  const cur = app.activePane();
  // Chỉ mở SFTP cho kết nối đang sống: pane lỗi hoặc đã đóng thì mọi lệnh SFTP
  // đều thất bại, hiện bảng chỉ để báo lỗi là vô ích.
  const sftpConn =
    cfg.settings.showSftp && cur?.pane.kind === "ssh" && cur.pane.status === "ready" && cur.pane.connId
      ? cur.pane.connId
      : null;

  return (
    <div className="app">
      <TitleBar />
      <div className="app-body">
        <Rail />

        {app.side && (
          <>
            <div className="side" style={{ width: cfg.settings.sidebarWidth }}>
              {app.side === "sessions" && <SessionsPanel />}
              {app.side === "tunnels" && <TunnelsPanel />}
              {app.side === "macros" && <MacrosPanel />}
              {app.side === "keys" && <KeysPanel />}
              {app.side === "settings" && <SettingsPanel />}
            </div>
            <Resizer
              value={cfg.settings.sidebarWidth}
              onChange={(v) => cfg.patchSettings({ sidebarWidth: Math.round(v) })}
              min={240}
              max={520}
            />
          </>
        )}

        <Workspace />

        {sftpConn && (
          <>
            <Resizer
              value={cfg.settings.sftpWidth}
              onChange={(v) => cfg.patchSettings({ sftpWidth: Math.round(v) })}
              min={280}
              max={760}
              sign={-1}
            />
            <div className="side" style={{ width: cfg.settings.sftpWidth, borderRight: 0, borderLeft: "1px solid var(--border)" }}>
              <SftpPanel connId={sftpConn} termId={cur?.pane.termId ?? undefined} />
            </div>
          </>
        )}
      </div>
      <StatusBar />

      {app.palette && <Palette />}
      <Toasts />
    </div>
  );
}

/// "system" theo prefers-color-scheme; các giá trị khác đặt trực tiếp.
function useTheme(theme: string) {
  useEffect(() => {
    const root = document.documentElement;
    if (theme !== "system") {
      root.dataset.theme = theme;
      return;
    }
    const mq = window.matchMedia("(prefers-color-scheme: light)");
    const apply = () => { root.dataset.theme = mq.matches ? "light" : "dark"; };
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, [theme]);
}

/// Một listener duy nhất định vị tooltip CSS, thay vì mỗi component tự làm.
function useTooltips() {
  useEffect(() => {
    const onOver = (e: MouseEvent) => {
      const el = (e.target as HTMLElement | null)?.closest<HTMLElement>("[data-tip]");
      if (!el) return;
      const r = el.getBoundingClientRect();
      const below = r.bottom + 30 < window.innerHeight;
      el.style.setProperty("--tip-x", `${Math.max(6, Math.min(r.left, window.innerWidth - 240))}px`);
      el.style.setProperty("--tip-y", `${below ? r.bottom + 6 : r.top - 26}px`);
    };
    window.addEventListener("mouseover", onOver, true);
    return () => window.removeEventListener("mouseover", onOver, true);
  }, []);
}

function useShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = isMac() ? e.metaKey : e.ctrlKey;
      if (!mod) return;
      const app = useApp.getState();
      const cfg = useConfig.getState();
      const tab = app.tabs.find((t) => t.id === app.activeTab);
      const k = e.key.toLowerCase();

      if (k === "k") { e.preventDefault(); app.setPalette(true); return; }
      if (k === "t") { e.preventDefault(); app.newTab(); return; }
      if (k === "w" && tab) { e.preventDefault(); app.closeTab(tab.id); return; }
      if (k === "b") { e.preventDefault(); app.setSide(app.side ?? "sessions"); return; }
      if (k === "d" && tab) {
        e.preventDefault();
        app.setLayout(tab.id, e.shiftKey ? "rows" : "cols");
        return;
      }
      if (k === "e") { e.preventDefault(); app.setSftpVisible(!cfg.settings.showSftp); return; }
      if (k === "i" && e.shiftKey) { e.preventDefault(); app.toggleBroadcast(); return; }
      if (/^[1-9]$/.test(e.key)) {
        const t = app.tabs[Number(e.key) - 1];
        if (t) { e.preventDefault(); app.selectTab(t.id); }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}
