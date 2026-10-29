// Backend giả để chạy UI trên trình duyệt (`npm run dev`, không có Tauri).
// Chỉ nạp trong dev, nên không vào bản build. Đủ để thử các luồng thật:
// kết nối (kèm hỏi host key / lỗi), shell gõ được lệnh, SFTP, tunnel.
import { emit } from "@tauri-apps/api/event";
import { mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import { newSession } from "@/lib/types";

type Args = Record<string, any>;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const b64 = (s: string) => btoa(String.fromCharCode(...new TextEncoder().encode(s)));
const out = (termId: string, s: string) => void emit("term:data", { termId, b64: b64(s) });

const now = Math.floor(Date.now() / 1000);
const config = {
  version: 1,
  settings: {},
  folders: [
    { id: "f-prod", name: "Production", parentId: null, open: true, sort: 0 },
    { id: "f-stg", name: "Staging", parentId: null, open: true, sort: 1 },
  ],
  sessions: [
    ["s-web", "web-01", "10.0.1.11", "deploy", "f-prod", "prod"],
    ["s-db", "db-01", "10.0.1.20", "postgres", "f-prod", "prod"],
    ["s-api", "api", "stg.example.com", "ubuntu", "f-stg", "staging"],
    ["s-bad", "old-box (hỏng)", "fail.example.com", "root", null, undefined],
  ].map(([id, name, host, user, folderId, stage], i) => newSession({
    id: id!, name: name!, host: host!, user: user!, folderId: folderId ?? null, stage: stage as never, lastUsed: Date.now() - i * 3_600_000,
  })),
  macros: [{ id: "m1", name: "Dung lượng đĩa", body: "df -h", enter: true }],
  tunnels: [{
    id: "t-pg", name: "Postgres prod", kind: "local", sessionId: "s-db",
    bindHost: "127.0.0.1", bindPort: 5432, destHost: "localhost", destPort: 5432,
    autoStart: false, autoReconnect: true,
  }],
};

const files: Record<string, [string, "dir" | "file", number][]> = {
  "/home/deploy": [["app", "dir", 0], ["logs", "dir", 0], [".bashrc", "file", 3771], ["deploy.sh", "file", 1290], ["README.md", "file", 842]],
  "/home/deploy/app": [["src", "dir", 0], ["package.json", "file", 1544], ["server.js", "file", 8120]],
  "/home/deploy/logs": [["access.log", "file", 18_440_221], ["error.log", "file", 92_113]],
};

interface Shell { conn: string; user: string; host: string; cwd: string; line: string }
const shells: Record<string, Shell> = {};
const conns: Record<string, { user: string; host: string }> = {};
const trusted = new Set<string>();
const waiting: Record<string, (v: unknown) => void> = {};

const prompt = (s: Shell) =>
  `\x1b]7;file://${s.host}${s.cwd}\x07\x1b[1;32m${s.user}@${s.host}\x1b[0m:\x1b[1;34m${s.cwd.replace(`/home/${s.user}`, "~")}\x1b[0m$ `;

function run(termId: string, s: Shell, cmd: string) {
  const [c, arg] = cmd.trim().split(/\s+/);
  const ls = (files[s.cwd] ?? []).map(([n, k]) => (k === "dir" ? `\x1b[1;34m${n}\x1b[0m` : n)).join("  ");
  const res: Record<string, () => string> = {
    ls: () => ls,
    pwd: () => s.cwd,
    whoami: () => s.user,
    date: () => new Date().toString(),
    "df": () => "Filesystem  Size  Used Avail Use% Mounted on\n/dev/sda1    80G   31G   49G  39% /",
    uptime: () => " 10:42:01 up 41 days,  3:12,  1 user,  load average: 0.08, 0.11, 0.09",
    cd: () => {
      const next = !arg || arg === "~" ? `/home/${s.user}` : arg === ".." ? s.cwd.replace(/\/[^/]+$/, "") || "/" : arg.startsWith("/") ? arg : `${s.cwd}/${arg}`;
      if (!files[next]) return `cd: ${arg}: No such file or directory`;
      s.cwd = next;
      return "";
    },
    clear: () => "\x1b[2J\x1b[H",
  };
  if (c === "exit") {
    out(termId, "logout\r\n");
    setTimeout(() => void emit("term:exit", { termId, code: 0 }), 200);
    return;
  }
  const text = !c ? "" : res[c] ? res[c]() : `${c}: command not found`;
  out(termId, (text ? text.replace(/\n/g, "\r\n") + "\r\n" : "") + prompt(s));
}

function openShell(termId: string, conn: string, user: string, host: string, motd: string) {
  const s: Shell = { conn, user, host, cwd: `/home/${user}`, line: "" };
  shells[termId] = s;
  files[s.cwd] ??= files["/home/deploy"];
  setTimeout(() => out(termId, motd + prompt(s)), 80);
}

function type(termId: string, data: string) {
  const s = shells[termId];
  if (!s) return;
  for (const ch of data) {
    if (ch === "\r") {
      out(termId, "\r\n");
      run(termId, s, s.line);
      s.line = "";
    } else if (ch === "\x7f") {
      if (s.line) { s.line = s.line.slice(0, -1); out(termId, "\b \b"); }
    } else if (ch === "\x03") {
      s.line = "";
      out(termId, "^C\r\n" + prompt(s));
    } else if (ch >= " ") {
      s.line += ch;
      out(termId, ch);
    }
  }
}

const handlers: Record<string, (a: Args) => unknown> = {
  store_read: (a) => (a.file === "config.json" ? config : null),
  store_write: () => null,
  data_dir: () => "/Users/dev/Library/Application Support/vibe-ssh",
  secret_get: () => null,
  secret_set: () => null,
  secret_delete: () => null,
  mem_usage: () => 48_200,
  read_env: () => null,
  which_bin: () => null,
  local_keys: () => [{
    path: "/Users/dev/.ssh/id_ed25519", name: "id_ed25519", algo: "ssh-ed25519",
    fingerprint: "SHA256:Zk1…a8", comment: "dev@macbook", hasPublic: true,
  }],
  hostkeys_list: () => [{ host: "10.0.1.11", port: 22, algo: "ssh-ed25519", fingerprint: "SHA256:q3x…f9", addedAt: now }],
  hostkey_forget: () => null,
  hostkeys_import: () => ({ added: 0, skipped: 0 }),
  ssh_config_import: () => [],
  serial_ports: () => [],

  answer: (a) => { waiting[a.askId]?.(a.value); delete waiting[a.askId]; return null; },

  ssh_connect: async ({ opts }) => {
    const { host, user, port } = opts.target;
    for (const text of ["Đang mở TCP", "Trao đổi khóa", "Xác thực"]) {
      void emit("conn:phase", { connId: opts.id, text, hop: host });
      await sleep(350);
    }
    if (host.startsWith("fail")) throw `Không kết nối được ${host}:${port}: connection refused`;
    if (!trusted.has(host)) {
      const askId = crypto.randomUUID();
      void emit("hostkey:ask", {
        askId, connId: opts.id, host, port, algo: "ssh-ed25519",
        fingerprint: "SHA256:7bJk2…Qe0", status: "new",
      });
      const res = (await new Promise<unknown>((r) => (waiting[askId] = r))) as { accept?: boolean };
      if (!res?.accept) throw "Đã từ chối host key";
      trusted.add(host);
    }
    conns[opts.id] = { user, host };
    return { id: opts.id, host, port, user, via: opts.jumps.map((j: Args) => j.host), connectedAt: Date.now() };
  },
  ssh_disconnect: () => null,
  ssh_exec: () => "",
  shell_open: ({ opts }) => {
    const c = conns[opts.connId];
    openShell(opts.termId, opts.connId, c.user, c.host,
      `Welcome to Ubuntu 24.04 LTS\r\n\r\n  System load:  0.08   Memory usage: 31%\r\n\r\nLast login: ${new Date().toDateString()}\r\n`);
    return null;
  },
  pty_open: ({ opts }) => { openShell(opts.termId, "", "khanh", "macbook", ""); return null; },
  telnet_open: () => null,
  serial_open: () => null,
  term_write: (a) => { type(a.termId, a.data); return null; },
  term_write_b64: () => null,
  term_broadcast: (a) => { for (const id of a.termIds) type(id, a.data); return a.termIds.length; },
  term_resize: () => null,
  term_close: () => null,

  sftp_home: ({ connId }) => `/home/${conns[connId]?.user ?? "deploy"}`,
  sftp_list: async ({ path }) => {
    await sleep(120);
    const list = files[path] ?? files["/home/deploy"];
    return {
      path,
      entries: list.map(([name, kind, size], i) => ({
        name, kind, size, path: `${path}/${name}`.replace("//", "/"),
        mode: kind === "dir" ? 0o40755 : 0o100644, modeStr: kind === "dir" ? "drwxr-xr-x" : "-rw-r--r--",
        user: "deploy", group: "deploy", mtime: now - i * 86_400,
      })),
    };
  },
  sftp_read_text: () => ["#!/bin/bash\nset -euo pipefail\n\ngit pull\nnpm ci\npm2 reload all\n", false],
  sftp_write_text: () => null,
  sftp_mkdir: () => null,
  sftp_rename: () => null,
  sftp_chmod: () => null,
  sftp_remove: () => null,
  sftp_readlink: () => "",
  sftp_download: () => null,
  sftp_upload: () => null,

  tunnel_start: async ({ spec }) => {
    void emit("tunnel:state", { id: spec.id, state: "connecting" });
    await sleep(700);
    void emit("tunnel:state", { id: spec.id, state: "running", port: spec.bindPort });
    return null;
  },
  tunnel_stop: ({ id }) => { void emit("tunnel:state", { id, state: "stopped" }); return null; },
};

export function installMock() {
  mockWindows("main");
  mockIPC(async (cmd, args) => {
    // Các lệnh plugin (window, webview, event…) không cần trả gì.
    if (cmd.startsWith("plugin:")) return null;
    const h = handlers[cmd];
    if (!h) { console.warn("[mock] chưa có lệnh", cmd, args); return null; }
    return h((args ?? {}) as Args);
  }, { shouldMockEvents: true });
}
