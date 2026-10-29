// Toàn bộ schema cấu hình được định nghĩa một lần ở đây; backend chỉ lưu JSON.

export type SessionKind = "ssh" | "local" | "telnet" | "serial" | "mosh" | "rdp" | "vnc";
export type AuthMethod = "agent" | "key" | "password" | "interactive";
export type ThemeName = "dark" | "light" | "contrast" | "system";
export type PaneLayout = "single" | "cols" | "rows" | "grid";
export type Stage = "prod" | "staging" | "dev";

export interface Folder {
  id: string;
  name: string;
  parentId: string | null;
  open: boolean;
  sort: number;
}

export interface Session {
  id: string;
  name: string;
  folderId: string | null;
  kind: SessionKind;
  sort: number;
  /** Môi trường (prod/staging/dev): tô màu tab và gắn tag trong danh sách. */
  stage?: Stage;
  note?: string;
  /** Tạo từ ô kết nối nhanh, chưa được người dùng lưu; bỏ đi khi mở lại app. */
  quick?: boolean;
  lastUsed?: number;

  // SSH / telnet
  host: string;
  port: number;
  user: string;
  auth: AuthMethod[];
  keyPath?: string;
  jumpId?: string | null;

  x11: boolean;
  agentForward: boolean;
  compression: boolean;
  keepalive: number;
  strictHostKey: boolean;

  term: string;
  env: [string, string][];
  initCommands: string[];
  logToFile: boolean;

  // Local shell
  shell?: string;
  cwd?: string;

  // Serial console
  serialPath?: string;
  baud?: number;
  dataBits?: 5 | 6 | 7 | 8;
  parity?: "none" | "odd" | "even";
  stopBits?: 1 | 2;
  flow?: "none" | "software" | "hardware";
}

export interface MacroDef {
  id: string;
  name: string;
  body: string;
  enter: boolean;
}

export interface TunnelDef {
  id: string;
  name: string;
  sessionId: string;
  kind: "local" | "remote" | "dynamic";
  bindHost: string;
  bindPort: number;
  destHost: string;
  destPort: number;
  /** File PEM / khóa riêng dùng riêng cho tunnel này, thay khóa của session. */
  keyPath?: string;
  /** Chạy ngay khi mở app. */
  autoStart: boolean;
  /** Rớt kết nối thì tự nối lại thay vì dừng hẳn. */
  autoReconnect: boolean;
}

export interface Settings {
  theme: ThemeName;
  fontFamily: string;
  fontSize: number;
  lineHeight: number;
  cursorStyle: "block" | "bar" | "underline";
  cursorBlink: boolean;
  scrollback: number;
  bell: boolean;
  copyOnSelect: boolean;
  rightClickPaste: boolean;
  suggest: boolean;
  webgl: boolean;
  sidebarWidth: number;
  /** Khối SFTP dưới terminal: bật/tắt và chiều cao. */
  showSftp: boolean;
  sftpHeight: number;
  logDir: string;
}

export interface AppConfig {
  version: number;
  settings: Settings;
  folders: Folder[];
  sessions: Session[];
  macros: MacroDef[];
  tunnels: TunnelDef[];
}

export const DEFAULT_SETTINGS: Settings = {
  theme: "dark",
  fontFamily: '"SF Mono", ui-monospace, "JetBrains Mono", Menlo, Consolas, monospace',
  fontSize: 13,
  lineHeight: 1.25,
  cursorStyle: "bar",
  cursorBlink: true,
  scrollback: 5000,
  bell: false,
  copyOnSelect: true,
  rightClickPaste: true,
  suggest: true,
  webgl: true,
  sidebarWidth: 300,
  showSftp: true,
  sftpHeight: 260,
  logDir: "",
};

export const DEFAULT_CONFIG: AppConfig = {
  version: 1,
  settings: DEFAULT_SETTINGS,
  folders: [],
  sessions: [],
  macros: [],
  tunnels: [],
};

export function newSession(patch: Partial<Session> = {}): Session {
  return {
    id: crypto.randomUUID(),
    name: "",
    folderId: null,
    kind: "ssh",
    sort: Date.now(),
    host: "",
    port: 22,
    user: "",
    auth: ["agent", "key", "password", "interactive"],
    jumpId: null,
    x11: false,
    agentForward: false,
    compression: false,
    keepalive: 30,
    strictHostKey: false,
    term: "xterm-256color",
    env: [],
    initCommands: [],
    logToFile: false,
    ...patch,
  };
}

// ── Kiểu dữ liệu từ backend ───────────────────────────────────────────────

export interface ConnInfo {
  id: string;
  host: string;
  port: number;
  user: string;
  via: string[];
  connectedAt: number;
}

export interface SftpEntry {
  name: string;
  path: string;
  kind: "dir" | "file" | "link";
  size: number;
  mode: number;
  modeStr: string;
  user?: string;
  group?: string;
  uid?: number;
  gid?: number;
  mtime?: number;
}

export interface SftpListing {
  path: string;
  entries: SftpEntry[];
}

export interface KnownHost {
  host: string;
  port: number;
  algo: string;
  fingerprint: string;
  addedAt: number;
}

export interface LocalKey {
  path: string;
  name: string;
  algo: string;
  fingerprint?: string;
  comment: string;
  hasPublic: boolean;
}

export interface SerialPortInfo {
  name: string;
  kind: "usb" | "bluetooth" | "pci" | "unknown";
  label?: string;
}

export interface SshHostImport {
  name: string;
  host: string;
  port: number;
  user: string;
  identityFile?: string;
  proxyJump?: string;
}
