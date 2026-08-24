import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { isMac, modKey } from "@/lib/util";
import { useApp } from "@/store/app";
import { useConfig } from "@/store/config";
import { Icon } from "../ui/Icon";
import { IBtn } from "../ui/primitives";

const NEXT_THEME = { dark: "light", light: "contrast", contrast: "dark", system: "dark" } as const;
const THEME_ICON = { dark: "moon", light: "sun", contrast: "contrast", system: "cpu" } as const;

export function TitleBar() {
  const mac = isMac();
  const { settings, patchSettings } = useConfig();
  const { setPalette, activePane, setSftpVisible } = useApp();
  const [maximized, setMaximized] = useState(false);
  const cur = activePane();
  const showSftp = settings.showSftp;

  useEffect(() => {
    if (mac) return;
    void getCurrentWindow().isMaximized().then(setMaximized).catch(() => {});
  }, [mac]);

  return (
    <div className="titlebar" data-tauri-drag-region>
      {mac ? <div className="mac-inset" data-tauri-drag-region /> : <div style={{ width: 10 }} />}
      <span style={{ display: "grid", color: "var(--accent)" }}><Icon n="terminal" s={15} /></span>
      <span className="app-title">VIBE SSH</span>
      <div className="drag-zone" data-tauri-drag-region />

      <button
        type="button"
        className="btn ghost sm"
        data-tip={`Bảng lệnh (${modKey()}K)`}
        onClick={() => setPalette(true)}
        style={{ gap: 8 }}
      >
        <Icon n="search" s={13} />
        <span style={{ color: "var(--text-3)" }}>Tìm hoặc chạy lệnh</span>
        <kbd>{modKey()}K</kbd>
      </button>

      <div className="drag-zone" data-tauri-drag-region />

      <IBtn
        icon="files"
        tip={showSftp ? "Ẩn SFTP" : "Hiện SFTP"}
        on={showSftp}
        disabled={cur?.pane.kind !== "ssh"}
        onClick={() => setSftpVisible(!showSftp)}
      />
      <IBtn
        icon={THEME_ICON[settings.theme]}
        tip={`Theme: ${settings.theme} → ${NEXT_THEME[settings.theme]}`}
        onClick={() => patchSettings({ theme: NEXT_THEME[settings.theme] })}
      />

      {!mac && (
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
      )}
    </div>
  );
}
