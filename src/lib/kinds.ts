import type { Session, SessionKind, Stage } from "./types";

export const STAGE_META: Record<Stage, { label: string; color: string; bg: string }> = {
  prod: { label: "prod", color: "var(--danger)", bg: "var(--danger-bg)" },
  staging: { label: "staging", color: "var(--warn)", bg: "var(--warn-bg)" },
  dev: { label: "dev", color: "var(--info)", bg: "var(--accent-bg)" },
};

/// `user@host:port` (user và port tùy chọn) → các phần. `null` nếu chuỗi không
/// giống địa chỉ: một từ trơn như "prod" là để tìm kiếm, không phải host.
export function parseAddress(text: string): { user: string; host: string; port: number } | null {
  const m = /^(?:([^@\s]+)@)?(\[[^\]]+\]|[^:\s@\[]+)(?::(\d{1,5}))?$/.exec(text.trim());
  if (!m) return null;
  const [, user = "", rawHost, rawPort] = m;
  const host = rawHost.replace(/^\[|\]$/g, "");
  if (!user && !rawPort && !host.includes(".") && !host.includes(":")) return null;
  const port = rawPort ? Number(rawPort) : 22;
  if (port < 1 || port > 65535) return null;
  return { user, host, port };
}

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

/// Dùng file khóa `path` và thử khóa trước mọi phương thức khác.
export function withKey(s: Session, path: string): Session {
  return { ...s, keyPath: path, auth: ["key", ...s.auth.filter((m) => m !== "key")] };
}
