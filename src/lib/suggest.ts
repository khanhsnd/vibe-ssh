/// Gợi ý lệnh kiểu fish: từ dòng đang gõ, trả về phần còn thiếu (chữ mờ sau con trỏ).
/// Ưu tiên lịch sử của host, sau đó tới cây lệnh có sẵn + tên lấy từ server.

/** Loại tham số lấy động từ server (xem `REMOTE_CMD` trong store/hints). */
export type Source = "container" | "image" | "unit" | "pod";

interface Node {
  sub?: Record<string, Node>;
  arg?: Source;
}

const LEAF: Node = {};
/** `words("a b c")` → các lệnh con không có gì phía sau. */
const words = (s: string, arg?: Source): Record<string, Node> =>
  Object.fromEntries(s.split(" ").map((w) => [w, arg ? { arg } : LEAF]));
const node = (sub: Record<string, Node>, arg?: Source): Node => ({ sub, arg });

const COMPOSE = node(words("up down ps logs restart pull build exec stop start config"));
const DOCKER = node({
  ...words("ps run images build stats login cp"),
  ...words("exec logs stop start restart rm inspect kill top attach", "container"),
  ...words("pull rmi tag push history", "image"),
  compose: COMPOSE,
  network: node(words("ls inspect create rm prune connect")),
  volume: node(words("ls inspect create rm prune")),
  system: node(words("prune df info")),
  image: node(words("ls prune rm inspect")),
  container: node(words("ls prune rm inspect")),
});

const K8S_KINDS = node({
  ...words("pods", "pod"), ...words("pod", "pod"),
  ...words("deployments services nodes namespaces ingress configmaps secrets events statefulsets daemonsets jobs cronjobs pvc all"),
});
const KUBECTL = node({
  get: K8S_KINDS, describe: K8S_KINDS, delete: K8S_KINDS, edit: K8S_KINDS,
  ...words("logs exec port-forward", "pod"),
  ...words("apply create scale"),
  rollout: node(words("status restart history undo")),
  top: node(words("pods nodes")),
  config: node(words("get-contexts current-context use-context view")),
});

const GIT = node({
  ...words("status add commit push pull fetch checkout switch branch log diff merge rebase reset restore clone tag show cherry-pick"),
  stash: node(words("list pop apply drop show")),
  remote: node(words("-v add remove set-url")),
});

const APT = node(words("update upgrade install remove purge autoremove search show list full-upgrade"));
const SYSTEMCTL = node({
  ...words("status restart start stop reload enable disable is-active is-enabled cat", "unit"),
  ...words("daemon-reload list-units list-unit-files list-timers --failed"),
});

/** Thứ tự = độ phổ biến: chữ đầu khớp lệnh nào trước thì gợi ý lệnh đó. */
const ROOT = node({
  sudo: LEAF,
  docker: DOCKER, "docker-compose": COMPOSE,
  systemctl: SYSTEMCTL, journalctl: { arg: "unit" },
  apt: APT, "apt-get": APT,
  git: GIT, kubectl: KUBECTL,
  cd: LEAF, ls: LEAF, cat: LEAF, tail: LEAF, less: LEAF, grep: LEAF,
  nano: LEAF, vim: LEAF, htop: LEAF, top: LEAF,
  df: LEAF, du: LEAF, free: LEAF, ps: LEAF, kill: LEAF,
  chmod: LEAF, chown: LEAF, mkdir: LEAF, rm: LEAF, cp: LEAF, mv: LEAF,
  curl: LEAF, wget: LEAF, tar: LEAF, unzip: LEAF, ping: LEAF, ip: LEAF, ss: LEAF,
  ufw: node(words("status allow deny enable disable delete reload")),
  pm2: node(words("list logs restart start stop status monit")),
  npm: node(words("install run start test ci")),
  nginx: LEAF, crontab: LEAF, history: LEAF, clear: LEAF, exit: LEAF,
  whoami: LEAF, uptime: LEAF, reboot: LEAF, service: LEAF,
});

/** Phần còn thiếu theo lịch sử (mới nhất trước), hoặc "". */
function fromHistory(line: string, history: string[]): string {
  const hit = history.find((h) => h.length > line.length && h.startsWith(line));
  return hit ? hit.slice(line.length) : "";
}

/** Phần còn thiếu theo cây lệnh, hoặc "". `remote` trả tên đã cache từ server. */
function fromSpec(line: string, remote: (s: Source) => string[]): string {
  const parts = line.trimStart().split(/\s+/);
  const partial = parts.pop() ?? "";
  if (!partial || partial.startsWith("-")) return "";

  let at = ROOT;
  for (const w of parts) {
    if (at === ROOT && w === "sudo") continue;
    if (w.startsWith("-")) continue;
    const next = at.sub?.[w];
    if (next) at = next;
    else if (!at.arg) return "";
  }

  const subs = Object.keys(at.sub ?? {});
  const hit = [...subs, ...(at.arg ? remote(at.arg) : [])]
    .find((c) => c.length > partial.length && c.startsWith(partial));
  if (!hit) return "";
  const more = at.sub?.[hit];
  return hit.slice(partial.length) + (more && (more.sub || more.arg) ? " " : "");
}

export function suggest(line: string, history: string[], remote: (s: Source) => string[]): string {
  if (!line.trim()) return "";
  return fromHistory(line, history) || fromSpec(line, remote);
}
