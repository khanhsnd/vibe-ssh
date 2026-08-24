import type { SessionKind } from "./types";

export const KIND_ICON: Record<SessionKind, string> = {
  ssh: "server",
  local: "terminal",
  telnet: "wifi",
  serial: "cpu",
  mosh: "bolt",
  rdp: "monitor",
  vnc: "eye",
};

export const KIND_LABEL: Record<SessionKind, string> = {
  ssh: "SSH",
  local: "Shell",
  telnet: "Telnet",
  serial: "Serial",
  mosh: "Mosh",
  rdp: "RDP",
  vnc: "VNC",
};

/// Dòng phụ hiển thị dưới tên session trong danh sách.
export function kindSubtitle(s: {
  kind: SessionKind;
  host: string;
  port: number;
  user: string;
  shell?: string;
  serialPath?: string;
  baud?: number;
}): string {
  switch (s.kind) {
    case "local":
      return s.shell || "shell mặc định";
    case "serial":
      return `${s.serialPath || "chưa chọn cổng"} · ${s.baud ?? 115200} baud`;
    default:
      return `${s.user ? `${s.user}@` : ""}${s.host}:${s.port}`;
  }
}
