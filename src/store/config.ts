import { create } from "zustand";
import * as ipc from "@/lib/ipc";
import {
  DEFAULT_CONFIG, DEFAULT_SETTINGS,
  type AppConfig, type Folder, type MacroDef, type Session, type Settings, type TunnelDef,
} from "@/lib/types";

const FILE = "config.json";

let saveTimer: number | undefined;

interface ConfigStore extends AppConfig {
  loaded: boolean;
  load: () => Promise<void>;
  patchSettings: (p: Partial<Settings>) => void;

  upsertSession: (s: Session) => void;
  removeSession: (id: string) => void;
  moveSession: (id: string, folderId: string | null) => void;

  addFolder: (name: string, parentId?: string | null) => string;
  renameFolder: (id: string, name: string) => void;
  toggleFolder: (id: string) => void;
  removeFolder: (id: string) => void;

  upsertMacro: (m: MacroDef) => void;
  removeMacro: (id: string) => void;

  upsertTunnel: (t: TunnelDef) => void;
  removeTunnel: (id: string) => void;
}

/// Gộp cấu hình đọc từ đĩa với mặc định để nâng cấp schema không làm mất field.
function merge(raw: unknown): AppConfig {
  const d = (raw ?? {}) as Partial<AppConfig>;
  return {
    version: d.version ?? 1,
    settings: { ...DEFAULT_SETTINGS, ...(d.settings ?? {}) },
    folders: d.folders ?? [],
    sessions: (d.sessions ?? []).map((s) => ({ ...s })),
    macros: d.macros ?? [],
    tunnels: d.tunnels ?? [],
  };
}

export const useConfig = create<ConfigStore>((set, get) => {
  const persist = () => {
    window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => {
      const { settings, folders, sessions, macros, tunnels, version } = get();
      void ipc.storeWrite(FILE, { version, settings, folders, sessions, macros, tunnels });
    }, 350);
  };
  const commit = (patch: Partial<AppConfig>) => {
    set(patch as never);
    persist();
  };

  return {
    ...DEFAULT_CONFIG,
    loaded: false,

    load: async () => {
      const raw = await ipc.storeRead<AppConfig>(FILE).catch(() => null);
      set({ ...merge(raw), loaded: true });
    },

    patchSettings: (p) => commit({ settings: { ...get().settings, ...p } }),

    upsertSession: (s) => {
      const list = get().sessions;
      const i = list.findIndex((x) => x.id === s.id);
      commit({ sessions: i < 0 ? [...list, s] : list.map((x) => (x.id === s.id ? s : x)) });
    },
    removeSession: (id) =>
      commit({
        sessions: get().sessions.filter((s) => s.id !== id),
        tunnels: get().tunnels.filter((t) => t.sessionId !== id),
      }),
    moveSession: (id, folderId) =>
      commit({ sessions: get().sessions.map((s) => (s.id === id ? { ...s, folderId } : s)) }),

    addFolder: (name, parentId = null) => {
      const f: Folder = { id: crypto.randomUUID(), name, parentId, open: true, sort: Date.now() };
      commit({ folders: [...get().folders, f] });
      return f.id;
    },
    renameFolder: (id, name) =>
      commit({ folders: get().folders.map((f) => (f.id === id ? { ...f, name } : f)) }),
    toggleFolder: (id) =>
      commit({ folders: get().folders.map((f) => (f.id === id ? { ...f, open: !f.open } : f)) }),
    removeFolder: (id) => {
      // Con của thư mục bị xóa nhảy lên cấp cha để không bị "mất tích".
      const gone = get().folders.find((f) => f.id === id);
      commit({
        folders: get().folders
          .filter((f) => f.id !== id)
          .map((f) => (f.parentId === id ? { ...f, parentId: gone?.parentId ?? null } : f)),
        sessions: get().sessions.map((s) =>
          s.folderId === id ? { ...s, folderId: gone?.parentId ?? null } : s,
        ),
      });
    },

    upsertMacro: (m) => {
      const list = get().macros;
      const i = list.findIndex((x) => x.id === m.id);
      commit({ macros: i < 0 ? [...list, m] : list.map((x) => (x.id === m.id ? m : x)) });
    },
    removeMacro: (id) => commit({ macros: get().macros.filter((m) => m.id !== id) }),

    upsertTunnel: (t) => {
      const list = get().tunnels;
      const i = list.findIndex((x) => x.id === t.id);
      commit({ tunnels: i < 0 ? [...list, t] : list.map((x) => (x.id === t.id ? t : x)) });
    },
    removeTunnel: (id) => commit({ tunnels: get().tunnels.filter((t) => t.id !== id) }),
  };
});
