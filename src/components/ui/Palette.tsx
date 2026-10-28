import { useEffect, useMemo, useRef, useState } from "react";
import { KIND_ICON, KIND_LABEL, kindSubtitle } from "@/lib/kinds";
import { modKey } from "@/lib/util";
import { useApp } from "@/store/app";
import { useConfig } from "@/store/config";
import { Icon } from "./Icon";

interface Cmd {
  id: string;
  label: string;
  group: string;
  icon: string;
  hint?: string;
  run: () => void;
}

/// Popup duy nhất trong app: bảng lệnh. Mọi thao tác khác đều inline.
export function Palette() {
  const app = useApp();
  const cfg = useConfig();
  const [q, setQ] = useState("");
  const [i, setI] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  const cmds = useMemo<Cmd[]>(() => {
    const out: Cmd[] = [];

    for (const s of cfg.sessions) {
      out.push({
        id: `s:${s.id}`,
        label: s.name || s.host || "(không tên)",
        group: KIND_LABEL[s.kind],
        icon: KIND_ICON[s.kind],
        hint: kindSubtitle(s),
        run: () => void app.openSession(s.id),
      });
    }

    for (const m of cfg.macros) {
      out.push({
        id: `m:${m.id}`,
        label: m.name,
        group: "Macro",
        icon: "zap",
        hint: m.body.split("\n")[0],
        run: () => void app.sendText(m.body, m.enter),
      });
    }

    const tab = app.tabs.find((t) => t.id === app.activeTab);
    out.push(
      { id: "a:tab", label: "Tab mới", group: "Hành động", icon: "plus", hint: `${modKey()}T`, run: () => app.newTab() },
      { id: "a:local", label: "Mở shell máy này", group: "Hành động", icon: "terminal", run: () => void app.openLocal() },
      { id: "a:new", label: "Tạo session mới", group: "Hành động", icon: "server", run: () => { app.setSide("sessions"); app.setEditing("new"); } },
      { id: "a:sftp", label: cfg.settings.showSftp ? "Ẩn bảng SFTP" : "Hiện bảng SFTP", group: "Hành động", icon: "files", run: () => app.setSftpVisible(!cfg.settings.showSftp) },
      { id: "a:bc", label: app.broadcast ? "Tắt multi-exec" : "Bật multi-exec", group: "Hành động", icon: "broadcast", run: () => app.toggleBroadcast() },
      { id: "a:theme", label: "Đổi theme", group: "Hành động", icon: "sun", run: () => {
          const order = ["dark", "light", "contrast"] as const;
          const next = order[(order.indexOf(cfg.settings.theme as "dark") + 1) % order.length];
          cfg.patchSettings({ theme: next });
        } },
    );
    if (tab) {
      out.push(
        { id: "a:split-c", label: "Chia pane dọc", group: "Bố cục", icon: "paneCols", run: () => app.setLayout(tab.id, "cols") },
        { id: "a:split-r", label: "Chia pane ngang", group: "Bố cục", icon: "paneRows", run: () => app.setLayout(tab.id, "rows") },
        { id: "a:split-g", label: "Lưới 2×2", group: "Bố cục", icon: "paneGrid", run: () => app.setLayout(tab.id, "grid") },
        { id: "a:split-s", label: "Một pane", group: "Bố cục", icon: "paneSingle", run: () => app.setLayout(tab.id, "single") },
      );
    }
    for (const t of cfg.tunnels) {
      const live = !!app.tunnels[t.id] && app.tunnels[t.id].state !== "stopped";
      out.push({
        id: `t:${t.id}`,
        label: `${live ? "Dừng" : "Chạy"} tunnel ${t.name || t.kind}`,
        group: "Tunnel",
        icon: "plug",
        hint: `${t.bindHost}:${t.bindPort}`,
        run: () => void (live ? app.stopTunnel(t.id) : app.startTunnel(t.id)),
      });
    }
    for (const p of ["sessions", "tunnels", "macros", "keys", "settings"] as const) {
      out.push({
        id: `p:${p}`,
        label: `Mở bảng ${p}`,
        group: "Điều hướng",
        icon: p === "sessions" ? "server" : p === "tunnels" ? "plug" : p === "macros" ? "zap" : p === "keys" ? "key" : "settings",
        run: () => app.setSide(p),
      });
    }
    return out;
  }, [cfg, app]);

  const hits = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return cmds.slice(0, 40);
    // Khớp rời rạc theo thứ tự ký tự, ưu tiên khớp liền.
    const score = (text: string) => {
      const t = text.toLowerCase();
      if (t.includes(needle)) return 1000 - t.indexOf(needle);
      let pos = -1;
      for (const ch of needle) {
        pos = t.indexOf(ch, pos + 1);
        if (pos < 0) return -1;
      }
      return 100;
    };
    return cmds
      .map((c) => ({ c, s: Math.max(score(c.label), score(c.hint ?? "") - 20) }))
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s)
      .slice(0, 40)
      .map((x) => x.c);
  }, [cmds, q]);

  useEffect(() => setI(0), [q]);
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(".palette-item.on")?.scrollIntoView({ block: "nearest" });
  }, [i]);

  const pick = (c?: Cmd) => {
    if (!c) return;
    app.setPalette(false);
    c.run();
  };

  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && app.setPalette(false)}>
      <div className="palette" role="dialog" aria-label="Bảng lệnh">
        <div className="palette-in">
          <Icon n="search" s={16} />
          <input
            autoFocus
            value={q}
            placeholder="Kết nối, chạy macro, đổi bố cục…"
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") { e.preventDefault(); setI((v) => Math.min(v + 1, hits.length - 1)); }
              if (e.key === "ArrowUp") { e.preventDefault(); setI((v) => Math.max(v - 1, 0)); }
              if (e.key === "Enter") pick(hits[i]);
              if (e.key === "Escape") app.setPalette(false);
            }}
          />
          <kbd>Esc</kbd>
        </div>
        <div className="palette-list" ref={listRef}>
          {hits.length === 0 && <div className="hint" style={{ padding: "14px 12px" }}>Không có kết quả</div>}
          {hits.map((c, idx) => (
            <button
              key={c.id}
              type="button"
              className={`palette-item ${idx === i ? "on" : ""}`}
              onMouseEnter={() => setI(idx)}
              onClick={() => pick(c)}
            >
              <Icon n={c.icon} s={14} />
              <span className="k">{c.label}</span>
              {c.hint && <span className="grp-tag mono">{c.hint}</span>}
              <span className="grp-tag">{c.group}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
