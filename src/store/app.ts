import { listen } from "@tauri-apps/api/event";
import { create } from "zustand";
import * as ipc from "@/lib/ipc";
import { newSession, type ConnInfo, type Stage, type PaneLayout, type Session } from "@/lib/types";
import { parseAddress, withKey } from "@/lib/kinds";
import { useConfig } from "./config";

export type PaneStatus = "empty" | "connecting" | "ready" | "closed" | "error";

export interface Pane {
  id: string;
  termId: string | null;
  sessionId: string | null;
  connId: string | null;
  title: string;
  kind: "ssh" | "local" | "empty";
  status: PaneStatus;
  detail: string;
}

export interface Tab {
  id: string;
  title: string;
  layout: PaneLayout;
  panes: Pane[];
  active: string;
  stage?: Stage;
}

export interface Ask {
  askId: string;
  event: "hostkey:ask" | "auth:secret" | "auth:interactive";
  payload: Record<string, unknown>;
}

export interface Toast {
  id: string;
  kind: "ok" | "err" | "warn" | "info";
  msg: string;
}

export interface Xfer {
  id: string;
  name: string;
  dir: "up" | "down";
  done: number;
  total: number;
  state: "run" | "ok" | "err";
}

export type SidePanel = "sessions" | "tunnels" | "keys" | "macros" | "settings" | null;

/** Trạng thái theo sự kiện `tunnel:state` của backend. */
export interface LiveTunnel {
  state: "connecting" | "running" | "retrying" | "stopped";
  port?: number;
  /** Lý do rớt / dừng. */
  detail?: string;
  /** Số giây tới lần nối lại kế tiếp. */
  retryIn?: number;
}

/// Tunnel phải phát hiện rớt mạng nhanh để nối lại, bất kể keepalive của session.
const TUNNEL_KEEPALIVE = 15;

export const tunnelConnId = (tunnelId: string) => `tun-${tunnelId}`;

interface AppStore {
  tabs: Tab[];
  activeTab: string | null;
  conns: Record<string, ConnInfo>;
  connBySession: Record<string, string>;
  asks: Ask[];
  toasts: Toast[];
  xfers: Xfer[];
  tunnels: Record<string, LiveTunnel>;
  side: SidePanel;
  editing: string | null; // session id đang sửa trong sidebar
  /// Thư mục mặc định cho session sắp tạo (đặt từ menu "Session mới ở đây").
  pendingFolder: string | null;
  palette: boolean;
  broadcast: boolean;
  broadcastTargets: string[];
  mem: number | null;
  /// Người dùng đã tự tắt bảng SFTP trong phiên này → không tự mở lại.
  sftpDismissed: boolean;
  /// Thư mục hiện tại của từng terminal, do shell báo qua OSC 7.
  cwdByTerm: Record<string, string>;

  init: () => Promise<void>;
  toast: (kind: Toast["kind"], msg: string) => void;
  dropToast: (id: string) => void;
  setSide: (p: SidePanel) => void;
  setEditing: (id: string | null, folderId?: string | null) => void;
  setPalette: (v: boolean) => void;

  newTab: () => string;
  closeTab: (id: string) => void;
  selectTab: (id: string) => void;
  setLayout: (tabId: string, layout: PaneLayout) => void;
  focusPane: (tabId: string, paneId: string) => void;
  closePane: (tabId: string, paneId: string) => void;

  openSession: (
    sessionId: string,
    target?: { tabId?: string; paneId?: string },
    opts?: { forceNew?: boolean },
  ) => Promise<void>;
  openLocal: (target?: { tabId?: string; paneId?: string }) => Promise<void>;
  /// Kết nối thẳng tới `user@host:port`, tạo session tạm nếu chưa có.
  quickConnect: (address: string, target?: { tabId?: string; paneId?: string }) => Promise<void>;
  saveQuick: (sessionId: string, name: string) => void;
  importSshConfig: () => Promise<void>;
  discardQuick: (sessionId: string) => void;
  reconnectPane: (tabId: string, paneId: string) => Promise<void>;

  answerAsk: (askId: string, value: unknown) => Promise<void>;
  activePane: () => { tab: Tab; pane: Pane } | null;
  setSftpVisible: (v: boolean) => void;
  setTermCwd: (termId: string, path: string) => void;
  toggleBroadcast: () => void;
  toggleBroadcastTarget: (termId: string) => void;
  sendText: (text: string, enter: boolean) => Promise<void>;

  startTunnel: (tunnelId: string) => Promise<void>;
  stopTunnel: (tunnelId: string) => Promise<void>;
  disconnectConn: (connId: string) => Promise<void>;
  addXfer: (x: Xfer) => void;
  dropXfer: (id: string) => void;
}

let inited = false;
const uid = () => crypto.randomUUID();
const emptyPane = (): Pane => ({
  id: uid(), termId: null, sessionId: null, connId: null,
  title: "", kind: "empty", status: "empty", detail: "",
});
const paneCount = (l: PaneLayout) => (l === "single" ? 1 : l === "grid" ? 4 : 2);

/// Chuỗi bastion: đi ngược theo `jumpId`, chặn vòng lặp và giới hạn 4 chặng.
function jumpChain(session: Session, all: Session[]): Session[] {
  const chain: Session[] = [];
  const seen = new Set<string>([session.id]);
  let cur = session.jumpId;
  while (cur && chain.length < 4) {
    if (seen.has(cur)) break;
    const s = all.find((x) => x.id === cur);
    if (!s) break;
    seen.add(s.id);
    chain.unshift(s);
    cur = s.jumpId ?? null;
  }
  return chain;
}

function connectOpts(id: string, s: Session, all: Session[]): ipc.ConnectOpts {
  return {
    id,
    target: hopOf(s),
    jumps: jumpChain(s, all).map(hopOf),
    keepalive: s.keepalive,
    compression: s.compression,
    x11: s.x11,
    agentForward: s.agentForward,
    strictHostKey: s.strictHostKey,
  };
}

function hopOf(s: Session): ipc.Hop {
  return {
    label: s.name || `${s.user}@${s.host}`,
    host: s.host,
    port: s.port || 22,
    user: s.user,
    auth: s.auth,
    keyPath: s.keyPath || undefined,
    secretId: s.id,
  };
}

export const useApp = create<AppStore>((set, get) => {
  const mapTab = (tabId: string, fn: (t: Tab) => Tab) =>
    set({ tabs: get().tabs.map((t) => (t.id === tabId ? fn(t) : t)) });

  const mapPane = (tabId: string, paneId: string, fn: (p: Pane) => Pane) =>
    mapTab(tabId, (t) => ({ ...t, panes: t.panes.map((p) => (p.id === paneId ? fn(p) : p)) }));

  const findPaneByTerm = (termId: string) => {
    for (const t of get().tabs) {
      const p = t.panes.find((x) => x.termId === termId);
      if (p) return { tab: t, pane: p };
    }
    return null;
  };
  const findPaneBySession = (sessionId: string) => {
    for (const t of get().tabs) {
      const p = t.panes.find((x) => x.sessionId === sessionId && x.status !== "empty");
      if (p) return { tab: t, pane: p };
    }
    return null;
  };

  const findPaneByConn = (connId: string) => {
    for (const t of get().tabs) {
      const p = t.panes.find((x) => x.connId === connId);
      if (p) return { tab: t, pane: p };
    }
    return null;
  };

  /// Mở terminal vào pane: chọn pane đích, hoặc tạo tab mới nếu chưa có.
  const resolveTarget = (target?: { tabId?: string; paneId?: string }) => {
    const st = get();
    if (target?.tabId && target?.paneId) return { tabId: target.tabId, paneId: target.paneId };
    const tab = st.tabs.find((t) => t.id === st.activeTab);
    if (tab) {
      const cur = tab.panes.find((p) => p.id === tab.active);
      if (cur && cur.status === "empty") return { tabId: tab.id, paneId: cur.id };
    }
    const id = get().newTab();
    const nt = get().tabs.find((t) => t.id === id)!;
    return { tabId: id, paneId: nt.active };
  };

  return {
    tabs: [], activeTab: null, conns: {}, connBySession: {},
    asks: [], toasts: [], xfers: [], tunnels: {},
    side: "sessions", editing: null, pendingFolder: null, palette: false,
    broadcast: false, broadcastTargets: [], mem: null, sftpDismissed: false, cwdByTerm: {},

    init: async () => {
      // StrictMode gọi effect hai lần trong dev; chỉ đăng ký listener một lần.
      if (inited) return;
      inited = true;

      if (get().tabs.length === 0) get().newTab();

      try {
        await wire(set, get, mapPane, findPaneByTerm, findPaneByConn);
      } catch (e) {
        // Chạy ngoài Tauri (xem UI trên trình duyệt) → không có kênh sự kiện.
        console.warn("Không nối được kênh sự kiện backend:", e);
        return;
      }
      for (const t of useConfig.getState().tunnels) if (t.autoStart) void get().startTunnel(t.id);
    },

    toast: (kind, msg) => {
      const id = uid();
      set({ toasts: [...get().toasts, { id, kind, msg }] });
      window.setTimeout(() => get().dropToast(id), kind === "err" ? 9000 : 4500);
    },
    dropToast: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),
    setSide: (p) => set({ side: get().side === p ? null : p }),
    setEditing: (id, folderId = null) =>
      set({ editing: id, pendingFolder: folderId, side: id ? "sessions" : get().side }),
    setPalette: (v) => set({ palette: v }),

    newTab: () => {
      const p = emptyPane();
      const tab: Tab = { id: uid(), title: "Tab mới", layout: "single", panes: [p], active: p.id };
      set({ tabs: [...get().tabs, tab], activeTab: tab.id });
      return tab.id;
    },

    closeTab: (id) => {
      const tab = get().tabs.find((t) => t.id === id);
      tab?.panes.forEach((p) => p.termId && void ipc.termClose(p.termId));
      const rest = get().tabs.filter((t) => t.id !== id);
      set({
        tabs: rest,
        activeTab: get().activeTab === id ? (rest.at(-1)?.id ?? null) : get().activeTab,
      });
    },

    selectTab: (id) => set({ activeTab: id }),

    setLayout: (tabId, layout) =>
      mapTab(tabId, (t) => {
        const want = paneCount(layout);
        let panes = t.panes.slice(0, want);
        while (panes.length < want) panes = [...panes, emptyPane()];
        // Pane bị cắt bỏ phải được đóng để không rò terminal.
        t.panes.slice(want).forEach((p) => p.termId && void ipc.termClose(p.termId));
        return { ...t, layout, panes, active: panes.some((p) => p.id === t.active) ? t.active : panes[0].id };
      }),

    focusPane: (tabId, paneId) => mapTab(tabId, (t) => ({ ...t, active: paneId })),

    closePane: (tabId, paneId) => {
      const tab = get().tabs.find((t) => t.id === tabId);
      const pane = tab?.panes.find((p) => p.id === paneId);
      if (pane?.termId) void ipc.termClose(pane.termId);
      if (tab && tab.layout === "single") return get().closeTab(tabId);
      mapPane(tabId, paneId, () => ({ ...emptyPane(), id: paneId }));
    },

    openSession: async (sessionId, target, opts) => {
      const cfg = useConfig.getState();
      const s = cfg.sessions.find((x) => x.id === sessionId);
      if (!s) return;
      cfg.upsertSession({ ...s, lastUsed: Date.now() });

      // Session đã mở ở đâu đó → nhảy tới đúng pane thay vì mở thêm tab.
      // Bỏ qua khi gọi vào một pane cụ thể hoặc khi người dùng chủ động
      // yêu cầu một phiên mới.
      if (!target && !opts?.forceNew) {
        const open = findPaneBySession(sessionId);
        if (open) {
          set({ activeTab: open.tab.id });
          mapTab(open.tab.id, (t) => ({ ...t, active: open.pane.id }));
          if (open.pane.status === "closed" || open.pane.status === "error") {
            await get().reconnectPane(open.tab.id, open.pane.id);
          }
          return;
        }
      }

      if (s.kind === "local") {
        const { tabId, paneId } = resolveTarget(target);
        const termId = uid();
        mapPane(tabId, paneId, (p) => ({
          ...p, termId, sessionId, connId: null, kind: "local",
          title: s.name || "Shell", status: "ready", detail: "",
        }));
        mapTab(tabId, (t) => ({ ...t, title: s.name || "Shell", stage: s.stage }));
        try {
          await ipc.ptyOpen({
            termId, shell: s.shell || undefined, args: [], cwd: s.cwd || undefined,
            cols: 80, rows: 24, env: s.env,
            logPath: s.logToFile ? logPath0(cfg.settings.logDir, s.name || "local") : undefined,
          });
        } catch (e) {
          mapPane(tabId, paneId, (p) => ({ ...p, status: "error", detail: String(e) }));
          get().toast("err", String(e));
        }
        return;
      }

      // Telnet, serial và mosh dùng cùng khung terminal, chỉ khác lớp vận chuyển.
      if (s.kind === "telnet" || s.kind === "serial" || s.kind === "mosh") {
        const { tabId, paneId } = resolveTarget(target);
        const termId = uid();
        const label =
          s.name || (s.kind === "serial" ? s.serialPath || "serial" : `${s.user}@${s.host}`);
        mapPane(tabId, paneId, (p) => ({
          ...p, termId, sessionId, connId: null, kind: "local",
          title: label, status: "ready", detail: "",
        }));
        mapTab(tabId, (t) => ({ ...t, title: label, stage: s.stage }));
        const logPath = s.logToFile ? logPath0(cfg.settings.logDir, label) : undefined;
        try {
          if (s.kind === "telnet") {
            await ipc.telnetOpen({
              termId, host: s.host, port: s.port || 23,
              cols: 80, rows: 24, term: s.term, logPath,
            });
          } else if (s.kind === "serial") {
            await ipc.serialOpen({
              termId, path: s.serialPath ?? "", baud: s.baud ?? 115200,
              dataBits: s.dataBits ?? 8, parity: s.parity ?? "none",
              stopBits: s.stopBits ?? 1, flow: s.flow ?? "none", logPath,
            });
          } else {
            const bin = await ipc.whichBin("mosh").catch(() => null);
            if (!bin) throw new Error("Chưa cài mosh trên máy này (macOS: brew install mosh)");
            await ipc.ptyOpen({
              termId, shell: bin, args: moshArgs(s), cols: 80, rows: 24, env: [], logPath,
            });
          }
        } catch (e) {
          mapPane(tabId, paneId, (p) => ({ ...p, status: "error", detail: String(e) }));
          get().toast("err", String(e));
        }
        return;
      }

      if (s.kind === "rdp" || s.kind === "vnc") {
        const url = s.kind === "rdp" ? `rdp://full%20address=s:${s.host}:${s.port || 3389}` : `vnc://${s.host}:${s.port || 5900}`;
        const { openUrl } = await import("@tauri-apps/plugin-opener");
        await openUrl(url).catch(() => get().toast("err", "Không mở được ứng dụng ngoài cho URL này"));
        get().toast("info", `Đã chuyển ${s.kind.toUpperCase()} sang ứng dụng hệ thống`);
        return;
      }

      const { tabId, paneId } = resolveTarget(target);
      const existing = get().connBySession[sessionId];
      const alive = existing && get().conns[existing];
      const connId = alive ? existing : `c-${uid()}`;
      const termId = uid();

      mapPane(tabId, paneId, (p) => ({
        ...p, termId: null, sessionId, connId, kind: "ssh",
        title: s.name || `${s.user}@${s.host}`,
        status: "connecting", detail: alive ? "dùng lại kết nối" : "đang kết nối…",
      }));
      mapTab(tabId, (t) => ({ ...t, title: s.name || s.host, stage: s.stage }));

      try {
        if (!alive) {
          const info = await ipc.sshConnect(connectOpts(connId, s, cfg.sessions));
          set({
            conns: { ...get().conns, [connId]: info },
            connBySession: { ...get().connBySession, [sessionId]: connId },
          });
        }
        await ipc.shellOpen({
          termId, connId, cols: 80, rows: 24, term: s.term,
          env: s.env, x11: s.x11, agentForward: s.agentForward,
          init: s.initCommands.filter(Boolean),
          logPath: s.logToFile ? logPath0(cfg.settings.logDir, s.name || s.host) : undefined,
        });
        mapPane(tabId, paneId, (p) => ({ ...p, termId, status: "ready", detail: "" }));
        // Mở luôn cây thư mục xa như MobaXterm, trừ khi người dùng đã tắt.
        if (!get().sftpDismissed && !cfg.settings.showSftp) {
          useConfig.getState().patchSettings({ showSftp: true });
        }
      } catch (e) {
        const msg = String(e);
        mapPane(tabId, paneId, (p) => ({ ...p, status: "error", detail: msg }));
        get().toast("err", msg);
        const cs = { ...get().connBySession };
        if (cs[sessionId] === connId) delete cs[sessionId];
        const cc = { ...get().conns };
        delete cc[connId];
        set({ connBySession: cs, conns: cc });
      }
    },

    openLocal: async (target) => {
      const { tabId, paneId } = resolveTarget(target);
      const termId = uid();
      mapPane(tabId, paneId, (p) => ({
        ...p, termId, sessionId: null, connId: null, kind: "local",
        title: "Shell", status: "ready", detail: "",
      }));
      mapTab(tabId, (t) => ({ ...t, title: "Shell" }));
      try {
        await ipc.ptyOpen({ termId, args: [], cols: 80, rows: 24, env: [] });
      } catch (e) {
        mapPane(tabId, paneId, (p) => ({ ...p, status: "error", detail: String(e) }));
      }
    },

    quickConnect: async (address, target) => {
      const a = parseAddress(address);
      if (!a) {
        get().toast("err", "Địa chỉ cần có dạng user@host hoặc user@host:port");
        return;
      }
      const cfg = useConfig.getState();
      const known = cfg.sessions.find(
        (s) => s.kind === "ssh" && s.host === a.host && s.port === a.port && s.user === a.user,
      );
      const s = known ?? newSession({ ...a, name: a.host, quick: true });
      if (!known) cfg.upsertSession(s);
      await get().openSession(s.id, target);
    },

    saveQuick: (sessionId, name) => {
      const cfg = useConfig.getState();
      const s = cfg.sessions.find((x) => x.id === sessionId);
      if (s) cfg.upsertSession({ ...s, name: name.trim() || s.host, quick: false });
    },

    importSshConfig: async () => {
      const cfg = useConfig.getState();
      const hosts = await ipc.sshConfigImport().catch(() => []);
      if (!hosts.length) return get().toast("warn", "Không tìm thấy mục nào trong ~/.ssh/config");
      const byName = new Set(cfg.sessions.map((s) => s.name));
      const fresh = hosts.filter((h) => !byName.has(h.name));
      if (!fresh.length) return get().toast("info", "Tất cả đã có sẵn");
      const folderId = cfg.folders.find((f) => f.name === "Nhập từ ~/.ssh/config")?.id
        ?? cfg.addFolder("Nhập từ ~/.ssh/config");
      for (const h of fresh) {
        cfg.upsertSession(newSession({
          name: h.name, host: h.host || h.name, port: h.port || 22,
          user: h.user, keyPath: h.identityFile, folderId,
        }));
      }
      get().toast("ok", `Đã nhập ${fresh.length} session`);
    },

    discardQuick: (sessionId) => {
      useConfig.getState().removeSession(sessionId);
      // Mật khẩu đã lưu trong lúc kết nối thuộc về session tạm này.
      void ipc.secretDelete(`pw:${sessionId}`).catch(() => {});
      void ipc.secretDelete(`pp:${sessionId}`).catch(() => {});
    },

    reconnectPane: async (tabId, paneId) => {
      const tab = get().tabs.find((t) => t.id === tabId);
      const pane = tab?.panes.find((p) => p.id === paneId);
      if (!pane) return;
      if (pane.connId) {
        const cs = { ...get().connBySession };
        if (pane.sessionId && cs[pane.sessionId] === pane.connId) delete cs[pane.sessionId];
        const cc = { ...get().conns };
        delete cc[pane.connId];
        set({ connBySession: cs, conns: cc });
        await ipc.sshDisconnect(pane.connId).catch(() => {});
      }
      if (pane.sessionId) await get().openSession(pane.sessionId, { tabId, paneId });
      else await get().openLocal({ tabId, paneId });
    },

    answerAsk: async (askId, value) => {
      set({ asks: get().asks.filter((a) => a.askId !== askId) });
      await ipc.answer(askId, value).catch(() => {});
    },

    activePane: () => {
      const st = get();
      const tab = st.tabs.find((t) => t.id === st.activeTab);
      if (!tab) return null;
      const pane = tab.panes.find((p) => p.id === tab.active) ?? tab.panes[0];
      return pane ? { tab, pane } : null;
    },

    setTermCwd: (termId, path) => {
      if (get().cwdByTerm[termId] === path) return;
      set({ cwdByTerm: { ...get().cwdByTerm, [termId]: path } });
    },

    setSftpVisible: (v) => {
      set({ sftpDismissed: !v });
      useConfig.getState().patchSettings({ showSftp: v });
    },

    toggleBroadcast: () => {
      const on = !get().broadcast;
      const targets = on
        ? get().tabs.flatMap((t) => t.panes.filter((p) => p.termId).map((p) => p.termId!))
        : [];
      set({ broadcast: on, broadcastTargets: targets });
    },

    toggleBroadcastTarget: (termId) => {
      const cur = get().broadcastTargets;
      set({
        broadcastTargets: cur.includes(termId) ? cur.filter((t) => t !== termId) : [...cur, termId],
      });
    },

    sendText: async (text, enter) => {
      const payload = enter ? `${text}\n` : text;
      if (get().broadcast && get().broadcastTargets.length) {
        await ipc.termBroadcast(get().broadcastTargets, payload);
        return;
      }
      const cur = get().activePane();
      if (cur?.pane.termId) await ipc.termWrite(cur.pane.termId, payload);
    },

    startTunnel: async (tunnelId) => {
      const cfg = useConfig.getState();
      const t = cfg.tunnels.find((x) => x.id === tunnelId);
      const s = t && cfg.sessions.find((x) => x.id === t.sessionId && x.kind === "ssh");
      if (!t || !s) {
        get().toast("err", "Session SSH của tunnel này đã bị xóa");
        return;
      }
      const setLive = (live: LiveTunnel) => set({ tunnels: { ...get().tunnels, [t.id]: live } });
      setLive({ state: "connecting" });
      try {
        await ipc.tunnelStart({
          id: t.id, kind: t.kind,
          connect: {
            ...connectOpts(tunnelConnId(t.id), t.keyPath ? withKey(s, t.keyPath) : s, cfg.sessions),
            keepalive: TUNNEL_KEEPALIVE,
          },
          bindHost: t.bindHost, bindPort: t.bindPort,
          destHost: t.destHost, destPort: t.destPort,
          autoReconnect: t.autoReconnect,
        });
      } catch (e) {
        setLive({ state: "stopped", detail: String(e) });
        get().toast("err", String(e));
      }
    },

    stopTunnel: async (tunnelId) => {
      await ipc.tunnelStop(tunnelId).catch(() => {});
      const next = { ...get().tunnels };
      delete next[tunnelId];
      set({ tunnels: next });
    },

    disconnectConn: async (connId) => {
      await ipc.sshDisconnect(connId).catch(() => {});
      const conns = { ...get().conns };
      delete conns[connId];
      const bySession = { ...get().connBySession };
      for (const [k, v] of Object.entries(bySession)) if (v === connId) delete bySession[k];
      set({ conns, connBySession: bySession });
      get().tabs.forEach((t) =>
        t.panes.forEach((p) => {
          if (p.connId === connId) mapPane(t.id, p.id, (x) => ({ ...x, status: "closed", detail: "đã ngắt" }));
        }),
      );
    },

    addXfer: (x) => set({ xfers: [...get().xfers, x] }),
    dropXfer: (id) => set({ xfers: get().xfers.filter((x) => x.id !== id) }),
  };
});

/// `mosh` tự gọi ssh, nên cấu hình cổng và khóa được truyền qua --ssh.
function moshArgs(s: Session): string[] {
  const ssh = ["ssh"];
  if (s.keyPath) ssh.push("-i", s.keyPath);
  if (s.port && s.port !== 22) ssh.push("-p", String(s.port));
  const args: string[] = [];
  if (ssh.length > 1) args.push(`--ssh=${ssh.join(" ")}`);
  args.push(s.user ? `${s.user}@${s.host}` : s.host);
  return args;
}

function logPath0(dir: string, name: string) {
  const safe = name.replace(/[^\w.-]+/g, "_") || "session";
  const stamp = new Date().toISOString().slice(0, 10);
  const base = dir?.trim() ? dir.replace(/\/$/, "") : "~/VibeSSH-logs";
  return `${base}/${safe}-${stamp}.log`;
}

type Setter = (p: Partial<AppStore>) => void;
type Getter = () => AppStore;

/// Nối các sự kiện backend vào store. Tách khỏi `init` để lỗi "không chạy trong
/// Tauri" không làm hỏng toàn bộ khởi động.
async function wire(
  set: Setter,
  get: Getter,
  mapPane: (tabId: string, paneId: string, fn: (p: Pane) => Pane) => void,
  findPaneByTerm: (termId: string) => { tab: Tab; pane: Pane } | null,
  findPaneByConn: (connId: string) => { tab: Tab; pane: Pane } | null,
) {
  await listen<{ termId: string; code: number | null }>("term:exit", (e) => {
    const hit = findPaneByTerm(e.payload.termId);
    if (!hit) return;
    mapPane(hit.tab.id, hit.pane.id, (p) => ({
      ...p,
      status: "closed",
      detail: e.payload.code == null ? "phiên đã đóng" : `kết thúc (mã ${e.payload.code})`,
    }));
  });

  await listen<{ connId: string; text: string; hop: string }>("conn:phase", (e) => {
    const hit = findPaneByConn(e.payload.connId);
    if (hit) mapPane(hit.tab.id, hit.pane.id, (p) => ({ ...p, detail: `${e.payload.text} · ${e.payload.hop}` }));
  });

  await listen<{ connId: string; text: string }>("conn:warn", (e) => {
    get().toast("warn", e.payload.text);
  });
  await listen<{ connId: string; text: string }>("conn:banner", (e) => {
    const t = e.payload.text.trim();
    if (t) get().toast("info", t.slice(0, 400));
  });

  for (const ev of ["hostkey:ask", "auth:secret", "auth:interactive"] as const) {
    await listen<Record<string, unknown>>(ev, (e) => {
      const askId = String(e.payload.askId ?? "");
      if (!askId) return;
      set({ asks: [...get().asks, { askId, event: ev, payload: e.payload }] });
    });
  }

  await listen<{ id: string; done: number; total: number }>("xfer:progress", (e) => {
    set({
      xfers: get().xfers.map((x) =>
        x.id === e.payload.id ? { ...x, done: e.payload.done, total: e.payload.total } : x,
      ),
    });
  });

  await listen<LiveTunnel & { id: string }>("tunnel:state", (e) => {
    const { id, ...live } = e.payload;
    // Người dùng đã bấm dừng thì bỏ qua sự kiện đến muộn.
    if (!get().tunnels[id]) return;
    set({ tunnels: { ...get().tunnels, [id]: live } });
  });

  const tick = async () => set({ mem: await ipc.memUsage().catch(() => null) });
  void tick();
  window.setInterval(tick, 15000);
}
