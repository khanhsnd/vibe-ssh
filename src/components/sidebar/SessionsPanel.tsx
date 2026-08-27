import { useMemo, useState } from "react";
import * as ipc from "@/lib/ipc";
import { KIND_ICON, kindSubtitle } from "@/lib/kinds";
import type { Folder, Session } from "@/lib/types";
import { newSession } from "@/lib/types";
import { useApp } from "@/store/app";
import { useConfig } from "@/store/config";
import { Icon } from "../ui/Icon";
import { Confirm, Menu, Popover, usePopover } from "../ui/Popover";
import { Field, IBtn } from "../ui/primitives";
import { SessionEditor } from "./SessionEditor";

type Ctx =
  | { t: "session"; s: Session }
  | { t: "folder"; f: Folder }
  | { t: "delSession"; s: Session }
  | { t: "delFolder"; f: Folder };

export function SessionsPanel() {
  const cfg = useConfig();
  const { editing, setEditing, openSession, connBySession, disconnectConn, toast, newTab, tabs, activeTab } = useApp();
  const [q, setQ] = useState("");
  const [renaming, setRenaming] = useState<string | null>(null);
  const pop = usePopover<Ctx>();
  const [dropOn, setDropOn] = useState<string | null>(null);

  const needle = q.trim().toLowerCase();
  const match = (s: Session) => `${s.name} ${s.host} ${s.user}`.toLowerCase().includes(needle);
  const visible = useMemo(
    () => (needle ? cfg.sessions.filter(match) : cfg.sessions),
    [cfg.sessions, needle],
  );

  if (editing) {
    const s = editing === "new" ? newSession() : cfg.sessions.find((x) => x.id === editing);
    if (s) return <SessionEditor session={s} isNew={editing === "new"} />;
  }

  /// `pane`: mở, hoặc nhảy tới nếu session đang mở sẵn.
  /// `tab`: luôn mở thêm một phiên mới ở tab riêng.
  const openIn = (s: Session, mode: "pane" | "tab") => {
    if (mode === "tab") {
      const id = newTab();
      const t = useApp.getState().tabs.find((x) => x.id === id)!;
      void openSession(s.id, { tabId: id, paneId: t.active });
    } else {
      void openSession(s.id);
    }
  };

  const importSsh = async () => {
    const hosts = await ipc.sshConfigImport().catch(() => []);
    if (!hosts.length) return toast("warn", "Không tìm thấy mục nào trong ~/.ssh/config");
    const byName = new Map(cfg.sessions.map((s) => [s.name, s]));
    let added = 0;
    const folderId = cfg.folders.find((f) => f.name === "Nhập từ ~/.ssh/config")?.id
      ?? cfg.addFolder("Nhập từ ~/.ssh/config");
    for (const h of hosts) {
      if (byName.has(h.name)) continue;
      cfg.upsertSession(
        newSession({
          name: h.name, host: h.host || h.name, port: h.port || 22,
          user: h.user, keyPath: h.identityFile, folderId,
        }),
      );
      added++;
    }
    toast(added ? "ok" : "info", added ? `Đã nhập ${added} session` : "Tất cả đã có sẵn");
  };

  const commitRename = (f: Folder, value: string) => {
    cfg.renameFolder(f.id, value.trim() || f.name);
    setRenaming(null);
  };

  const renderSessions = (list: Session[], depth: number) =>
    list
      .slice()
      .sort((a, b) => (a.name || a.host).localeCompare(b.name || b.host))
      .map((s) => {
        const live = !!connBySession[s.id];
        const inUse = tabs.some((t) => t.id === activeTab && t.panes.some((p) => p.sessionId === s.id));
        return (
          <div
            key={s.id}
            className={`node ${live ? "live" : ""} ${inUse ? "sel" : ""}`}
            style={{ paddingLeft: 8 + depth * 13 }}
            draggable
            onDragStart={(e) => e.dataTransfer.setData("text/session", s.id)}
            onDoubleClick={() => openIn(s, "tab")}
            onClick={() => openIn(s, "pane")}
            onContextMenu={(e) => { e.preventDefault(); pop.open(e, { t: "session", s }); }}
            title={kindSubtitle(s)}
          >
            <span className="twist" />
            <span className="ico"><Icon n={KIND_ICON[s.kind]} s={14} /></span>
            <span className="label">{s.name || s.host || "(không tên)"}</span>
            {live && <span className="led ok" />}
            <span className="act">
              <IBtn icon="edit" tip="Sửa" size="sm" onClick={(e) => { e.stopPropagation(); setEditing(s.id); }} />
              <IBtn
                icon="dots" tip="Thêm" size="sm"
                onClick={(e) => { e.stopPropagation(); pop.open(e, { t: "session", s }); }}
              />
            </span>
          </div>
        );
      });

  const renderFolders = (parentId: string | null, depth: number): React.ReactNode => {
    const folders = cfg.folders
      .filter((f) => f.parentId === parentId)
      .sort((a, b) => a.name.localeCompare(b.name));
    return folders.map((f) => {
      const kids = visible.filter((s) => s.folderId === f.id);
      const open = f.open || !!needle;
      if (needle && kids.length === 0 && !cfg.folders.some((x) => x.parentId === f.id)) return null;
      return (
        <div key={f.id}>
          <div
            className={`node ${dropOn === f.id ? "drop" : ""}`}
            style={{ paddingLeft: 8 + depth * 13 }}
            onClick={() => cfg.toggleFolder(f.id)}
            onContextMenu={(e) => { e.preventDefault(); pop.open(e, { t: "folder", f }); }}
            onDragOver={(e) => { e.preventDefault(); setDropOn(f.id); }}
            onDragLeave={() => setDropOn((v) => (v === f.id ? null : v))}
            onDrop={(e) => {
              const id = e.dataTransfer.getData("text/session");
              if (id) cfg.moveSession(id, f.id);
              setDropOn(null);
            }}
          >
            <span className="twist"><Icon n={open ? "chevronDown" : "chevronRight"} s={12} /></span>
            <span className="ico" style={{ color: "var(--text-3)" }}>
              <Icon n={open ? "folderOpen" : "folder"} s={14} />
            </span>
            {renaming === f.id ? (
              <input
                className="label"
                autoFocus
                defaultValue={f.name}
                style={{ background: "var(--surface-2)", border: "1px solid var(--border-focus)", borderRadius: 3, color: "var(--text)", minWidth: 0 }}
                onClick={(e) => e.stopPropagation()}
                onFocus={(e) => e.currentTarget.select()}
                onBlur={(e) => commitRename(f, e.target.value)}
                onKeyDown={(e) => {
                  // Ghi trực tiếp thay vì gọi blur(): không phụ thuộc vào việc
                  // onBlur có kịp chạy hay không.
                  if (e.key === "Enter") commitRename(f, (e.target as HTMLInputElement).value);
                  if (e.key === "Escape") setRenaming(null);
                }}
              />
            ) : (
              <span className="label">{f.name}</span>
            )}
            <span className="sub">{kids.length || ""}</span>
            <span className="act">
              <IBtn icon="plus" tip="Session trong thư mục này" size="sm"
                onClick={(e) => { e.stopPropagation(); setEditing("new", f.id); }} />
              <IBtn icon="dots" tip="Thêm" size="sm"
                onClick={(e) => { e.stopPropagation(); pop.open(e, { t: "folder", f }); }} />
            </span>
          </div>
          {open && (
            <>
              {renderFolders(f.id, depth + 1)}
              {renderSessions(kids, depth + 1)}
            </>
          )}
        </div>
      );
    });
  };

  const rootSessions = visible.filter(
    (s) => !s.folderId || !cfg.folders.some((f) => f.id === s.folderId),
  );

  return (
    <>
      <div className="side-head">
        <span className="side-title">Sessions</span>
        <IBtn icon="download" tip="Nhập từ ~/.ssh/config" size="sm" onClick={() => void importSsh()} />
        <IBtn icon="folderPlus" tip="Thư mục mới" size="sm"
          onClick={() => setRenaming(cfg.addFolder("Thư mục mới"))} />
        <IBtn icon="plus" tip="Session mới" size="sm" onClick={() => setEditing("new")} />
      </div>

      <div style={{ padding: "6px 8px", flex: "none" }}>
        <Field icon="search" small value={q} onChange={setQ} placeholder="Tìm session…" />
      </div>

      <div
        className="side-body"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          const id = e.dataTransfer.getData("text/session");
          if (id) cfg.moveSession(id, null);
        }}
      >
        <div className="tree">
          {renderFolders(null, 0)}
          {renderSessions(rootSessions, 0)}
          {cfg.sessions.length === 0 && cfg.folders.length === 0 && (
            <div className="empty">
              <Icon n="server" s={28} w={1.3} />
              <b>Chưa có session</b>
              Tạo mới hoặc nhập từ ~/.ssh/config
            </div>
          )}
        </div>
      </div>

      {pop.state && (
        <Popover anchor={pop.state.anchor} onClose={pop.close}>
          {pop.state.data.t === "session" && (
            <Menu
              onClose={pop.close}
              items={[
                { label: "Mở / chuyển tới", icon: "play", onPick: () => openIn((pop.state!.data as { s: Session }).s, "pane") },
                { label: "Mở thêm phiên (tab mới)", icon: "plus", onPick: () => openIn((pop.state!.data as { s: Session }).s, "tab") },
                { separator: true, label: "" },
                { label: "Sửa", icon: "edit", onPick: () => setEditing((pop.state!.data as { s: Session }).s.id) },
                {
                  label: "Nhân bản", icon: "copy",
                  onPick: () => {
                    const s = (pop.state!.data as { s: Session }).s;
                    cfg.upsertSession({ ...s, id: crypto.randomUUID(), name: `${s.name || s.host} (bản sao)` });
                  },
                },
                ...(connBySession[(pop.state.data as { s: Session }).s.id]
                  ? [{
                      label: "Ngắt kết nối", icon: "logout",
                      onPick: () => void disconnectConn(connBySession[(pop.state!.data as { s: Session }).s.id]),
                    }]
                  : []),
                { separator: true, label: "" },
                {
                  label: "Xóa", icon: "trash", danger: true,
                  onPick: () => pop.open(
                    { clientX: pop.state!.anchor.x, clientY: pop.state!.anchor.y },
                    { t: "delSession", s: (pop.state!.data as { s: Session }).s },
                  ),
                },
              ]}
            />
          )}
          {pop.state.data.t === "folder" && (
            <Menu
              onClose={pop.close}
              items={[
                { label: "Session mới ở đây", icon: "plus", onPick: () => setEditing("new", (pop.state!.data as { f: Folder }).f.id) },
                { label: "Thư mục con", icon: "folderPlus", onPick: () => setRenaming(cfg.addFolder("Thư mục mới", (pop.state!.data as { f: Folder }).f.id)) },
                { label: "Đổi tên", icon: "edit", onPick: () => setRenaming((pop.state!.data as { f: Folder }).f.id) },
                { separator: true, label: "" },
                {
                  label: "Xóa thư mục", icon: "trash", danger: true,
                  onPick: () => pop.open(
                    { clientX: pop.state!.anchor.x, clientY: pop.state!.anchor.y },
                    { t: "delFolder", f: (pop.state!.data as { f: Folder }).f },
                  ),
                },
              ]}
            />
          )}
          {pop.state.data.t === "delSession" && (
            <Confirm
              message={`Xóa session “${(pop.state.data as { s: Session }).s.name || (pop.state.data as { s: Session }).s.host}”? Mật khẩu đã lưu cũng bị xóa khỏi keychain.`}
              onClose={pop.close}
              onConfirm={() => {
                const s = (pop.state!.data as { s: Session }).s;
                void ipc.secretDelete(`pw:${s.id}`);
                void ipc.secretDelete(`pp:${s.id}`);
                cfg.removeSession(s.id);
              }}
            />
          )}
          {pop.state.data.t === "delFolder" && (
            <Confirm
              message="Xóa thư mục? Session bên trong sẽ chuyển lên cấp trên."
              onClose={pop.close}
              onConfirm={() => cfg.removeFolder((pop.state!.data as { f: Folder }).f.id)}
            />
          )}
        </Popover>
      )}
    </>
  );
}
