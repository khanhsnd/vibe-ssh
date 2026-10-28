import { useEffect, useState } from "react";
import * as ipc from "@/lib/ipc";
import type { ThemeName } from "@/lib/types";
import { useApp } from "@/store/app";
import { useConfig } from "@/store/config";
import { Icon } from "../ui/Icon";
import { Chip, Field, Group, IBtn, NumField, Row, Seg, Select, Switch } from "../ui/primitives";

const THEMES: { value: ThemeName; icon: string; tip: string }[] = [
  { value: "dark", icon: "moon", tip: "Tối" },
  { value: "light", icon: "sun", tip: "Sáng" },
  { value: "contrast", icon: "contrast", tip: "Tương phản cao (AAA)" },
  { value: "system", icon: "cpu", tip: "Theo hệ thống" },
];

export function SettingsPanel() {
  const { settings, patchSettings } = useConfig();
  const toast = useApp((s) => s.toast);
  const [dir, setDir] = useState("");

  useEffect(() => { void ipc.dataDir().then(setDir).catch(() => {}); }, []);

  return (
    <>
      <div className="side-head">
        <span className="side-title">Cài đặt</span>
      </div>
      <div className="side-body">
        <div className="editor">
          <Group title="Giao diện" icon="sun">
            <Row label="Theme">
              <Seg value={settings.theme} onChange={(v) => patchSettings({ theme: v })} options={THEMES} />
            </Row>
            <Row label="Font">
              <Field mono value={settings.fontFamily} onChange={(v) => patchSettings({ fontFamily: v })} />
            </Row>
            <Row label="Cỡ chữ">
              <NumField value={settings.fontSize} onChange={(v) => patchSettings({ fontSize: v })} min={8} max={28} width={64} />
              <span className="hint">px</span>
            </Row>
            <Row label="Chiều dòng">
              <NumField
                value={Math.round(settings.lineHeight * 100)}
                onChange={(v) => patchSettings({ lineHeight: v / 100 })}
                min={90} max={200} width={64}
              />
              <span className="hint">%</span>
            </Row>
            <Row label="Con trỏ">
              <Select
                value={settings.cursorStyle}
                onChange={(v) => patchSettings({ cursorStyle: v })}
                options={[
                  { value: "bar", label: "Vạch dọc" },
                  { value: "block", label: "Khối" },
                  { value: "underline", label: "Gạch dưới" },
                ]}
              />
              <Switch checked={settings.cursorBlink} onChange={(v) => patchSettings({ cursorBlink: v })} label="Nháy" />
            </Row>
          </Group>

          <Group title="Terminal" icon="terminal">
            <Row label="Scrollback">
              <NumField value={settings.scrollback} onChange={(v) => patchSettings({ scrollback: v })} min={200} max={200000} width={92} />
              <span className="hint">dòng</span>
            </Row>
            <Row label="">
              <Switch checked={settings.copyOnSelect} onChange={(v) => patchSettings({ copyOnSelect: v })}
                label="Copy khi bôi đen" />
            </Row>
            <Row label="">
              <Switch checked={settings.rightClickPaste} onChange={(v) => patchSettings({ rightClickPaste: v })}
                label="Chuột phải để dán" />
            </Row>
            <Row label="">
              <Switch checked={settings.suggest} onChange={(v) => patchSettings({ suggest: v })}
                label="Gợi ý lệnh khi gõ (→ để nhận)" />
            </Row>
            <Row label="">
              <Switch checked={settings.webgl} onChange={(v) => patchSettings({ webgl: v })}
                label="Tăng tốc WebGL"
                tip="Vẽ nhanh hơn, tốn thêm vài MB VRAM. Tắt nếu thấy hiển thị lạ. Áp dụng cho pane mở sau." />
            </Row>
          </Group>

          <Group title="Log & dữ liệu" icon="files">
            <Row label="Thư mục log">
              <Field mono value={settings.logDir} onChange={(v) => patchSettings({ logDir: v })} placeholder="~/VibeSSH-logs" />
              <IBtn
                icon="folder" tip="Chọn thư mục"
                onClick={async () => {
                  const { open } = await import("@tauri-apps/plugin-dialog");
                  const r = await open({ directory: true, multiple: false }).catch(() => null);
                  if (typeof r === "string") patchSettings({ logDir: r });
                }}
              />
            </Row>
            <Row label="Cấu hình" stack>
              <div className="hint mono" style={{ userSelect: "text", wordBreak: "break-all" }}>{dir || "…"}</div>
              <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
                <button type="button" className="btn sm" onClick={() => { void navigator.clipboard.writeText(dir); toast("ok", "Đã copy đường dẫn"); }}>
                  <Icon n="copy" s={12} /> Copy
                </button>
                <button
                  type="button" className="btn sm"
                  onClick={async () => {
                    const { revealItemInDir } = await import("@tauri-apps/plugin-opener");
                    await revealItemInDir(dir).catch(() => toast("err", "Không mở được thư mục"));
                  }}
                >
                  <Icon n="folderOpen" s={12} /> Mở
                </button>
              </div>
            </Row>
          </Group>

          <Group title="Phạm vi hiện tại" icon="info">
            <div className="hint" style={{ lineHeight: 1.7 }}>
              <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginBottom: 8 }}>
                <Chip tone="ok">SSH</Chip>
                <Chip tone="ok">SFTP</Chip>
                <Chip tone="ok">Tunnel L/R/D</Chip>
                <Chip tone="ok">Bastion</Chip>
                <Chip tone="ok">Shell cục bộ</Chip>
                <Chip tone="ok">X11 fwd</Chip>
                <Chip tone="ok">Agent fwd</Chip>
                <Chip tone="ok">Multi-exec</Chip>
                <Chip tone="ok">Telnet</Chip>
                <Chip tone="ok">Serial</Chip>
                <Chip tone="warn">Mosh: cần mosh cài sẵn</Chip>
                <Chip tone="warn">RDP/VNC: mở app ngoài</Chip>
              </div>
              X11 forwarding cần X server cục bộ đang chạy (XQuartz trên macOS, VcXsrv/Xming trên
              Windows) — app không kèm X server. Mosh chạy qua chương trình <span className="mono">mosh</span>
              cài trên máy. RDP/VNC được chuyển sang ứng dụng mặc định của hệ thống, không nhúng.
            </div>
          </Group>
        </div>
      </div>
    </>
  );
}
