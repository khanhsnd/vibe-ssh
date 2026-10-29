import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { STAGE_META } from "@/lib/kinds";
import type { PaneLayout } from "@/lib/types";
import { isMac, modKey } from "@/lib/util";
import { useApp, type Tab } from "@/store/app";
import { useConfig } from "@/store/config";
import { Icon } from "../ui/Icon";
import { Menu, Popover, usePopover } from "../ui/Popover";
import { IBtn } from "../ui/primitives";

const LAYOUTS: { value: PaneLayout; icon: string; label: string }[] = [
  { value: "single", icon: "paneSingle", label: "Một pane" },
  { value: "cols", icon: "paneCols", label: "Chia dọc" },
  { value: "rows", icon: "paneRows", label: "Chia ngang" },
  { value: "grid", icon: "paneGrid", label: "Lưới 2×2" },
];

/// Hàng trên cùng của vùng chính: tab dạng viên + các thao tác của tab đang mở.
/// Chỗ trống giữa là vùng kéo cửa sổ.
export function TopBar() {
  const app = useApp();
  const { settings, patchSettings } = useConfig();
  const tab = app.tabs.find((t) => t.id === app.activeTab);
  const hasSsh = !!app.tabs.find((t) => t.id === app.activeTab)?.panes.some((p) => p.kind === "ssh");
  const running = Object.values(app.tunnels).filter((t) => t.state === "running").length;
  const split = usePopover<null>();

  return (
    <div className="topbar" data-tauri-drag-region>
      {!app.side && (
        <>
          {isMac() && <div className="mac-inset" data-tauri-drag-region />}
          <IBtn icon="sidebar" tip="Hiện sidebar (⌘B)" onClick={() => app.setSide("sessions")} />
        </>
      )}

      <div className="pills">
        {app.tabs.map((t) => <TabPill key={t.id} t={t} />)}
        <IBtn icon="plus" tip={`Tab mới (${modKey()}T)`} size="sm" onClick={() => app.newTab()} />
      </div>

      <div className="drag-zone" data-tauri-drag-region />

      <IBtn
        icon={LAYOUTS.find((l) => l.value === tab?.layout)?.icon ?? "paneSingle"}
        tip="Chia pane" disabled={!tab} on={!!split.state}
        onClick={(e) => split.openAt(e.currentTarget, null)}
      />
      <IBtn
        icon="broadcast" tip={app.broadcast ? "Tắt multi-exec" : "Multi-exec: gõ một lần, gửi mọi pane"}
        on={app.broadcast} onClick={app.toggleBroadcast}
      />
      <IBtn
        icon="files" tip={settings.showSftp ? "Ẩn SFTP" : "Hiện SFTP"}
        on={settings.showSftp && hasSsh}
        disabled={!hasSsh}
        onClick={() => patchSettings({ showSftp: !settings.showSftp })}
      />
      <span className="badged">
        <IBtn icon="plug" tip="Trình quản lý tunnel" on={app.tunnelsOpen} onClick={() => app.setTunnelsOpen(!app.tunnelsOpen)} />
        {running > 0 && <i className="badge">{running}</i>}
      </span>
      <button type="button" className="search-btn" onClick={() => app.setPalette(true)}>
        <Icon n="search" s={13} />
        <span>Tìm / kết nối</span>
        <kbd>{modKey()}K</kbd>
      </button>

      {split.state && tab && (
        <Popover anchor={split.state.anchor} onClose={split.close} width={180}>
          <Menu
            onClose={split.close}
            items={LAYOUTS.map((l) => ({
              label: l.label,
              icon: l.icon,
              shortcut: tab.layout === l.value ? "✓" : undefined,
              onPick: () => app.setLayout(tab.id, l.value),
            }))}
          />
        </Popover>
      )}

      {!isMac() && <WinControls />}
    </div>
  );
}

function TabPill({ t }: { t: Tab }) {
  const { activeTab, selectTab, closeTab, reconnectPane } = useApp();
  const state = t.panes.reduce<string>((acc, p) => {
    if (p.status === "error") return "err";
    if (p.status === "connecting" && acc !== "err") return "busy";
    if (p.status === "ready" && acc === "") return "ok";
    return acc;
  }, "");
  const down = t.panes.filter((p) => p.sessionId && (p.status === "closed" || p.status === "error"));
  const stage = t.stage ? STAGE_META[t.stage] : null;

  return (
    <div
      className={`pill ${t.id === activeTab ? "on" : ""}`}
      style={stage ? ({ "--stage": stage.color } as React.CSSProperties) : undefined}
      onMouseDown={(e) => {
        if (e.button === 1) closeTab(t.id);
        else selectTab(t.id);
      }}
    >
      <span className={`led ${state}`} />
      <span className="nm">{t.title}</span>
      {stage && <span className="stage">{stage.label}</span>}
      {down.length > 0 && (
        <span
          className="x re" role="button" aria-label="Nối lại" data-tip="Mất kết nối — nối lại"
          onMouseDown={(e) => { e.stopPropagation(); down.forEach((p) => void reconnectPane(t.id, p.id)); }}
        >
          <Icon n="refresh" s={11} />
        </span>
      )}
      <span
        className="x" role="button" aria-label="Đóng tab"
        onMouseDown={(e) => { e.stopPropagation(); closeTab(t.id); }}
      >
        <Icon n="x" s={11} />
      </span>
    </div>
  );
}

function WinControls() {
  const [maximized, setMaximized] = useState(false);
  useEffect(() => {
    void getCurrentWindow().isMaximized().then(setMaximized).catch(() => {});
  }, []);

  return (
    <div className="win-controls">
      <button type="button" data-tip="Thu nhỏ" onClick={() => void getCurrentWindow().minimize()}>
        <Icon n="minimize" s={13} />
      </button>
      <button
        type="button"
        data-tip={maximized ? "Thu về" : "Phóng to"}
        onClick={async () => {
          await getCurrentWindow().toggleMaximize();
          setMaximized(await getCurrentWindow().isMaximized());
        }}
      >
        <Icon n="maximize" s={12} />
      </button>
      <button type="button" className="close" data-tip="Đóng" onClick={() => void getCurrentWindow().close()}>
        <Icon n="x" s={13} />
      </button>
    </div>
  );
}
