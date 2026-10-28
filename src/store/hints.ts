import * as ipc from "@/lib/ipc";
import type { Source } from "@/lib/suggest";

/// Dữ liệu cho gợi ý lệnh: lịch sử theo từng session (lưu đĩa) và tên lấy từ server (cache ngắn).

const FILE = "history.json";
const MAX = 300;
const REMOTE_TTL = 30_000;

const REMOTE_CMD: Record<Source, string> = {
  container: "docker ps -a --format '{{.Names}}'",
  image: "docker images --format '{{.Repository}}:{{.Tag}}'",
  unit: "systemctl list-units --type=service --all --no-legend --plain | awk '{print $1}'",
  pod: "kubectl get pods -o name | cut -d/ -f2",
};

let saved: Record<string, string[]> = {};
const loading = ipc.storeRead<Record<string, string[]>>(FILE)
  .then((d) => { saved = { ...(d ?? {}), ...saved }; })
  .catch(() => {});
/** Lịch sử đọc từ ~/.bash_history / ~/.zsh_history của server, theo kết nối. */
const serverHistory: Record<string, string[]> = {};
const remote = new Map<string, { at: number; list: string[] }>();
let saveTimer: number | undefined;

const lines = (out: string) => out.split("\n").map((l) => l.trim()).filter(Boolean);

/** Lịch sử để gợi ý, mới nhất trước: lệnh gõ trong app rồi tới lịch sử sẵn có trên server. */
export function historyOf(key: string, connId: string | null): string[] {
  return [...(saved[key] ?? []), ...(connId ? serverHistory[connId] ?? [] : [])];
}

export function remember(key: string, cmd: string) {
  cmd = cmd.trim();
  if (!cmd) return;
  saved[key] = [cmd, ...(saved[key] ?? []).filter((c) => c !== cmd)].slice(0, MAX);
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => void loading.then(() => ipc.storeWrite(FILE, saved)), 1000);
}

/// Nạp lịch sử shell của server một lần cho mỗi kết nối.
export function loadServerHistory(connId: string) {
  if (serverHistory[connId]) return;
  serverHistory[connId] = [];
  void ipc.sshExec(connId, "tail -n 1000 ~/.bash_history ~/.zsh_history 2>/dev/null")
    .then((out) => {
      // zsh lưu dạng ": 1700000000:0;lệnh"
      const all = lines(out).map((l) => l.replace(/^: \d+:\d+;/, "")).filter((l) => !l.startsWith("==>"));
      serverHistory[connId] = [...new Set(all.reverse())];
    })
    .catch(() => {});
}

/// Tên container/unit/pod của server; lần đầu trả [] và gọi `onReady` khi có dữ liệu.
export function remoteWords(connId: string | null, src: Source, onReady: () => void): string[] {
  if (!connId) return [];
  const key = `${connId}:${src}`;
  const hit = remote.get(key);
  if (hit && Date.now() - hit.at < REMOTE_TTL) return hit.list;
  remote.set(key, { at: Date.now(), list: hit?.list ?? [] });
  void ipc.sshExec(connId, `${REMOTE_CMD[src]} 2>/dev/null`)
    .then((out) => {
      remote.set(key, { at: Date.now(), list: lines(out) });
      onReady();
    })
    .catch(() => {});
  return hit?.list ?? [];
}
