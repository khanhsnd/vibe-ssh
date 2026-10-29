import { useEffect } from "react";
import { isMac } from "@/lib/util";
import { useApp } from "@/store/app";
import { useConfig } from "@/store/config";
import { Resizer } from "./components/layout/Resizer";
import { Sidebar } from "./components/layout/Sidebar";
import { TopBar } from "./components/layout/TopBar";
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

  // SFTP theo pane SSH đang focus; focus sang pane khác trong cùng tab thì giữ
  // pane SSH còn sống đầu tiên, để khối SFTP không chớp tắt làm terminal nhảy.
  // Pane lỗi hoặc đã đóng thì mọi lệnh SFTP đều thất bại nên bị bỏ qua.
  const cur = app.activePane();
  const live = (p: { kind: string; status: string; connId: string | null }) =>
    p.kind === "ssh" && p.status === "ready" && !!p.connId;
  const sftp = !cfg.settings.showSftp || !cur
    ? null
    : live(cur.pane) ? cur.pane : cur.tab.panes.find(live) ?? null;

  return (
    <div className="app">
      {app.side && (
        <>
          <Sidebar />
          <Resizer
            value={cfg.settings.sidebarWidth}
            onChange={(v) => cfg.patchSettings({ sidebarWidth: Math.round(v) })}
            min={220}
            max={480}
          />
        </>
      )}

      <main className="main">
        <TopBar />
        <div className="card term-card">
          <Workspace />
          {/* Phủ lên terminal thay vì thay thế: các phiên phía sau vẫn sống. */}
          {app.tunnelsOpen && <TunnelsPanel />}
        </div>
        {sftp && (
          <>
            <Resizer
              row
              sign={-1}
              value={cfg.settings.sftpHeight}
              onChange={(v) => cfg.patchSettings({ sftpHeight: Math.round(v) })}
              min={140}
              max={640}
            />
            <div className="card sftp-card" style={{ height: cfg.settings.sftpHeight }}>
              <SftpPanel key={sftp.connId} connId={sftp.connId!} termId={sftp.termId ?? undefined} />
            </div>
          </>
        )}
      </main>

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
      const tab = app.tabs.find((t) => t.id === app.activeTab);
      const k = e.key.toLowerCase();

      if (k === "k") { e.preventDefault(); app.setPalette(true); return; }
      if (k === "t") { e.preventDefault(); app.newTab(); return; }
      if (k === "w" && tab) { e.preventDefault(); app.closeTab(tab.id); return; }
      if (k === "b") { e.preventDefault(); app.setSide(app.side ? null : "sessions"); return; }
      if (k === "d" && tab) {
        e.preventDefault();
        app.setLayout(tab.id, e.shiftKey ? "rows" : "cols");
        return;
      }
      if (k === "e") {
        e.preventDefault();
        useConfig.getState().patchSettings({ showSftp: !useConfig.getState().settings.showSftp });
        return;
      }
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
