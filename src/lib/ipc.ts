import { invoke } from "@tauri-apps/api/core";
import type {
  ConnInfo, KnownHost, LocalKey, SerialPortInfo, SftpListing, SshHostImport,
} from "./types";

// ── Lưu trữ ───────────────────────────────────────────────────────────────
export const storeRead = <T>(file: string) => invoke<T | null>("store_read", { file });
export const storeWrite = (file: string, doc: unknown) => invoke<void>("store_write", { file, doc });
export const dataDir = () => invoke<string>("data_dir");

// ── Keychain ──────────────────────────────────────────────────────────────
export const secretSet = (key: string, value: string) => invoke<void>("secret_set", { key, value });
export const secretGet = (key: string) => invoke<string | null>("secret_get", { key });
export const secretDelete = (key: string) => invoke<void>("secret_delete", { key });

// ── Hỏi/đáp ───────────────────────────────────────────────────────────────
export const answer = (askId: string, value: unknown) => invoke<void>("answer", { askId, value });

// ── Kết nối ───────────────────────────────────────────────────────────────
export interface Hop {
  label?: string; host: string; port: number; user: string;
  auth: string[]; password?: string; keyPath?: string; keyPassphrase?: string;
}
export interface ConnectOpts {
  id: string; target: Hop; jumps: Hop[];
  keepalive: number; compression: boolean;
  x11: boolean; agentForward: boolean; strictHostKey: boolean;
}
export const sshConnect = (opts: ConnectOpts) => invoke<ConnInfo>("ssh_connect", { opts });
export const sshDisconnect = (id: string) => invoke<void>("ssh_disconnect", { id });

// ── Terminal ──────────────────────────────────────────────────────────────
export interface ShellOpts {
  termId: string; connId: string; cols: number; rows: number; term: string;
  env: [string, string][]; x11: boolean; agentForward: boolean;
  init: string[]; logPath?: string;
}
export const shellOpen = (opts: ShellOpts) => invoke<void>("shell_open", { opts });

export interface PtyOpts {
  termId: string; shell?: string; args: string[]; cwd?: string;
  cols: number; rows: number; env: [string, string][]; logPath?: string;
}
export const ptyOpen = (opts: PtyOpts) => invoke<void>("pty_open", { opts });

export interface TelnetOpts {
  termId: string; host: string; port: number;
  cols: number; rows: number; term: string; logPath?: string;
}
export const telnetOpen = (opts: TelnetOpts) => invoke<void>("telnet_open", { opts });

export interface SerialOpts {
  termId: string; path: string; baud: number;
  dataBits: number; parity: string; stopBits: number; flow: string;
  logPath?: string;
}
export const serialOpen = (opts: SerialOpts) => invoke<void>("serial_open", { opts });
export const serialPorts = () => invoke<SerialPortInfo[]>("serial_ports");

export const termWrite = (termId: string, data: string) => invoke<void>("term_write", { termId, data });
export const termWriteB64 = (termId: string, b64: string) => invoke<void>("term_write_b64", { termId, b64 });
export const termBroadcast = (termIds: string[], data: string) =>
  invoke<number>("term_broadcast", { termIds, data });
export const termResize = (termId: string, cols: number, rows: number) =>
  invoke<void>("term_resize", { termId, cols, rows });
export const termClose = (termId: string) => invoke<void>("term_close", { termId });

// ── SFTP ──────────────────────────────────────────────────────────────────
export const sftpList = (connId: string, path: string) => invoke<SftpListing>("sftp_list", { connId, path });
export const sftpHome = (connId: string) => invoke<string>("sftp_home", { connId });
export const sftpMkdir = (connId: string, path: string) => invoke<void>("sftp_mkdir", { connId, path });
export const sftpRename = (connId: string, from: string, to: string) =>
  invoke<void>("sftp_rename", { connId, from, to });
export const sftpChmod = (connId: string, path: string, mode: number) =>
  invoke<void>("sftp_chmod", { connId, path, mode });
export const sftpRemove = (connId: string, path: string) => invoke<void>("sftp_remove", { connId, path });
export const sftpReadlink = (connId: string, path: string) => invoke<string>("sftp_readlink", { connId, path });
/// Trả về [nội dung, đã bị cắt bớt].
export const sftpReadText = (connId: string, path: string, maxBytes = 512 * 1024) =>
  invoke<[string, boolean]>("sftp_read_text", { connId, path, maxBytes });
export const sftpDownload = (connId: string, remote: string, local: string, xferId: string) =>
  invoke<void>("sftp_download", { connId, remote, local, xferId });
export const sftpUpload = (connId: string, local: string, remote: string, xferId: string) =>
  invoke<void>("sftp_upload", { connId, local, remote, xferId });

// ── Tunnel ────────────────────────────────────────────────────────────────
export interface TunnelSpec {
  id: string; connId: string; kind: string;
  bindHost: string; bindPort: number; destHost: string; destPort: number;
}
export const tunnelStart = (spec: TunnelSpec) => invoke<number>("tunnel_start", { spec });
export const tunnelStop = (id: string) => invoke<void>("tunnel_stop", { id });

// ── Host key & nhập liệu ──────────────────────────────────────────────────
export const hostkeysList = () => invoke<KnownHost[]>("hostkeys_list");
export const hostkeyForget = (host: string, port: number) => invoke<void>("hostkey_forget", { host, port });
export const hostkeysImport = () => invoke<{ added: number; skipped: number }>("hostkeys_import");
export const sshConfigImport = () => invoke<SshHostImport[]>("ssh_config_import");
export const localKeys = () => invoke<LocalKey[]>("local_keys");

// ── Tiện ích ──────────────────────────────────────────────────────────────
export const readEnv = (name: string) => invoke<string | null>("read_env", { name });
export const whichBin = (name: string) => invoke<string | null>("which_bin", { name });
export const memUsage = () => invoke<number | null>("mem_usage");
