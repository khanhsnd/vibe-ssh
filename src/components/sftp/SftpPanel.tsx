import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import * as ipc from "@/lib/ipc";
import type { SftpEntry } from "@/lib/types";
import { baseName, fmtSize, fmtTime, joinLocal, joinPath, parentPath } from "@/lib/util";
import { useApp } from "@/store/app";
import { Icon } from "../ui/Icon";
import { Confirm, Popover, usePopover } from "../ui/Popover";
import { Btn, Chip, Empty, Field, IBtn } from "../ui/primitives";

type SortKey = "name" | "size" | "mtime";
type Ctx = { t: "del"; items: SftpEntry[] } | { t: "chmod"; item: SftpEntry };

export function SftpPanel({ connId, termId }: { connId: string; termId?: string }) {
  const { toast, xfers, addXfer, dropXfer } = useApp();
  const shellCwd = useApp((st) => (termId ? st.cwdByTerm[termId] : undefined));
  const [follow, setFollow] = useState(true);
  const [path, setPath] = useState("");
  const [entries, setEntries] = useState<SftpEntry[]>([]);
  const [sel, setSel] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [filter, setFilter] = useState("");
  const [sort, setSort] = useState<{ k: SortKey; asc: boolean }>({ k: "name", asc: true });
  const [creating, setCreating] = useState(false);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [dropping, setDropping] = useState(false);
  const droppingRef = useRef(false);
  const pathRef = useRef("");
  const [mode, setMode] = useState("");
  const [peek, setPeek] = useState<{ name: string; text: string; cut: boolean } | null>(null);
  const pop = usePopover<Ctx>();
  const listRef = useRef<HTMLDivElement>(null);

  const load = useCallback(
    async (target?: string) => {
      setLoading(true);
      setErr("");
      try {
        const p = target ?? (await ipc.sftpHome(connId));
        const res = await ipc.sftpList(connId, p);
        setPath(res.path);
        setEntries(res.entries);
        setSel([]);
      } catch (e) {
        setErr(String(e));
      } finally {
        setLoading(false);
      }
    },
    [connId],
  );

  useEffect(() => { void load(); }, [load]);

  // Đi theo `cd` trong terminal khi shell báo OSC 7.
  useEffect(() => {
    if (follow && shellCwd && shellCwd !== path) void load(shellCwd);
    // `path` cố tình không nằm trong deps: chỉ phản ứng khi shell đổi thư mục,
    // không phải khi người dùng tự bấm sang thư mục khác.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [follow, shellCwd, load]);

  const shown = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    const list = needle ? entries.filter((e) => e.name.toLowerCase().includes(needle)) : entries;
    const dir = sort.asc ? 1 : -1;
    return list.slice().sort((a, b) => {
      if ((a.kind === "dir") !== (b.kind === "dir")) return a.kind === "dir" ? -1 : 1;
      if (sort.k === "size") return (a.size - b.size) * dir;
      if (sort.k === "mtime") return ((a.mtime ?? 0) - (b.mtime ?? 0)) * dir;
      return a.name.localeCompare(b.name) * dir;
    });
  }, [entries, filter, sort]);

  const selected = entries.filter((e) => sel.includes(e.path));

  const upload = useCallback(
    async (locals: string[], dir: string) => {
      for (const local of locals) {
        const id = crypto.randomUUID();
        const name = local.split(/[\\/]/).pop() ?? local;
        addXfer({ id, name, dir: "up", done: 0, total: 0, state: "run" });
        try {
          await ipc.sftpUpload(connId, local, joinPath(dir, name), id);
          window.setTimeout(() => dropXfer(id), 1200);
        } catch (e) {
          toast("err", `Tải lên ${name}: ${e}`);
          dropXfer(id);
        }
      }
      void load(dir);
    },
    [connId, addXfer, dropXfer, load, toast],
  );

  droppingRef.current = dropping;
  pathRef.current = path;

  // Kéo file từ Finder/Explorer vào panel = tải lên thư mục đang mở.
  useEffect(() => {
    let off: (() => void) | undefined;
    void getCurrentWebview()
      .onDragDropEvent((e) => {
        if (e.payload.type === "over") {
          const el = listRef.current;
          if (!el) return;
          const r = el.getBoundingClientRect();
          const { x, y } = e.payload.position;
          setDropping(x >= r.left && x <= r.right && y >= r.top && y <= r.bottom);
        } else if (e.payload.type === "drop") {
          if (droppingRef.current && pathRef.current) void upload(e.payload.paths, pathRef.current);
          setDropping(false);
        } else {
          setDropping(false);
        }
      })
      .then((f) => { off = f; });
    return () => off?.();
  }, [upload]);

  const download = async (items: SftpEntry[]) => {
    if (!items.length) return;
    const { save, open } = await import("@tauri-apps/plugin-dialog");

    const run = async (e: SftpEntry, dest: string) => {
      const id = crypto.randomUUID();
      addXfer({ id, name: e.name, dir: "down", done: 0, total: e.size, state: "run" });
      try {
        await ipc.sftpDownload(connId, e.path, dest, id);
        window.setTimeout(() => dropXfer(id), 1200);
      } catch (err) {
        toast("err", `Tải xuống ${e.name}: ${err}`);
        dropXfer(id);
      }
    };

    // Một file lẻ → hỏi tên file đích. Thư mục hoặc nhiều mục → hỏi thư mục đích.
    if (items.length === 1 && items[0].kind === "file") {
      const dest = await save({ defaultPath: items[0].name }).catch(() => null);
      if (dest) await run(items[0], dest);
      return;
    }
    const dir = await open({ directory: true, multiple: false }).catch(() => null);
    if (typeof dir !== "string") return;
    for (const e of items) {
      if (e.kind === "link") {
        toast("warn", `Bỏ qua symlink ${e.name}`);
        continue;
      }
      await run(e, joinLocal(dir, e.name));
    }
  };

  const preview = async (e: SftpEntry) => {
    try {
      const [text, cut] = await ipc.sftpReadText(connId, e.path);
      setPeek({ name: e.name, text, cut });
    } catch (err) {
      toast("err", `Đọc ${e.name}: ${err}`);
    }
  };

  const crumbs = path.split("/").filter(Boolean);

  return (
    <div className="sftp">
      <div className="sftp-bar">
        <IBtn icon="home" tip="Thư mục nhà" size="sm" onClick={() => void load()} />
        <IBtn icon="arrowUp" tip="Lên một cấp" size="sm" disabled={path === "/" || !path}
          onClick={() => void load(parentPath(path))} />
        <IBtn icon="refresh" tip="Tải lại" size="sm" onClick={() => void load(path)} />
        <IBtn
          icon="link"
          tip={follow ? "Đang đi theo thư mục của terminal" : "Đi theo thư mục của terminal"}
          size="sm"
          on={follow}
          onClick={() => {
            setFollow((v) => !v);
            if (!follow && shellCwd) void load(shellCwd);
          }}
        />
        <div className="crumbs">
          <button type="button" className={`crumb ${crumbs.length === 0 ? "last" : ""}`} onClick={() => void load("/")}>/</button>
          {crumbs.map((c, i) => (
            <span key={i} style={{ display: "flex", alignItems: "center", gap: 1 }}>
              <button
                type="button"
                className={`crumb ${i === crumbs.length - 1 ? "last" : ""}`}
                onClick={() => void load(`/${crumbs.slice(0, i + 1).join("/")}`)}
              >
                {c}
              </button>
              {i < crumbs.length - 1 && <span className="crumb-sep"><Icon n="chevronRight" s={10} /></span>}
            </span>
          ))}
        </div>
      </div>

      <div className="sftp-bar" style={{ gap: 6 }}>
        <Field icon="search" small value={filter} onChange={setFilter} placeholder="Lọc…" />
        <IBtn icon="folder" tip="Thư mục mới trên server" size="sm" onClick={() => setCreating(true)} />
        <IBtn
          icon="upload" tip="Tải file lên" size="sm"
          onClick={async () => {
            const { open } = await import("@tauri-apps/plugin-dialog");
            const r = await open({ multiple: true }).catch(() => null);
            if (Array.isArray(r) && r.length) void upload(r as string[], path);
          }}
        />
        <IBtn
          icon="folderPlus" tip="Tải cả thư mục lên" size="sm"
          onClick={async () => {
            const { open } = await import("@tauri-apps/plugin-dialog");
            const r = await open({ directory: true, multiple: false }).catch(() => null);
            if (typeof r === "string") void upload([r], path);
          }}
        />
        <IBtn icon="download" tip="Tải xuống (file hoặc cả thư mục)" size="sm" disabled={!selected.length}
          onClick={() => void download(selected)} />
        <IBtn
          icon="trash" tip="Xóa" size="sm" danger disabled={!selected.length}
          onClick={(e) => pop.open(e, { t: "del", items: selected })}
        />
      </div>

      {err && (
        <div className="hint err" style={{ padding: "8px 10px", borderBottom: "1px solid var(--border)", userSelect: "text" }}>
          {err}
        </div>
      )}

      <div className={`fs-list ${dropping ? "fs-drop" : ""}`} ref={listRef}>
        <div className="fs-head">
          <button type="button" onClick={() => setSort({ k: "name", asc: sort.k === "name" ? !sort.asc : true })}>
            Tên {sort.k === "name" && <Icon n={sort.asc ? "chevronUp" : "chevronDown"} s={10} />}
          </button>
          <button type="button" onClick={() => setSort({ k: "size", asc: sort.k === "size" ? !sort.asc : false })}
            style={{ justifyContent: "flex-end" }}>
            Cỡ {sort.k === "size" && <Icon n={sort.asc ? "chevronUp" : "chevronDown"} s={10} />}
          </button>
          <button type="button" onClick={() => setSort({ k: "mtime", asc: sort.k === "mtime" ? !sort.asc : false })}>
            Sửa lúc {sort.k === "mtime" && <Icon n={sort.asc ? "chevronUp" : "chevronDown"} s={10} />}
          </button>
          <span>Quyền</span>
        </div>

        {creating && (
          <NewName
            icon="folder"
            onCancel={() => setCreating(false)}
            onSubmit={async (name) => {
              setCreating(false);
              try {
                await ipc.sftpMkdir(connId, joinPath(path, name));
                void load(path);
              } catch (e) { toast("err", String(e)); }
            }}
          />
        )}

        {shown.map((e) => {
          const isSel = sel.includes(e.path);
          if (renaming === e.path) {
            return (
              <NewName
                key={e.path}
                icon={e.kind === "dir" ? "folder" : "files"}
                initial={e.name}
                onCancel={() => setRenaming(null)}
                onSubmit={async (name) => {
                  setRenaming(null);
                  if (name === e.name) return;
                  try {
                    await ipc.sftpRename(connId, e.path, joinPath(path, name));
                    void load(path);
                  } catch (err2) { toast("err", String(err2)); }
                }}
              />
            );
          }
          return (
            <div
              key={e.path}
              className={`fs-row ${e.kind} ${isSel ? "sel" : ""}`}
              onClick={(ev) => {
                if (ev.metaKey || ev.ctrlKey) {
                  setSel(isSel ? sel.filter((p) => p !== e.path) : [...sel, e.path]);
                } else {
                  setSel([e.path]);
                }
              }}
              onDoubleClick={() => {
                if (e.kind === "dir") void load(e.path);
                else if (e.kind === "link") void ipc.sftpReadlink(connId, e.path)
                  .then((t) => toast("info", `${e.name} → ${t}`))
                  .catch(() => {});
                // File vừa phải thì xem ngay; file lớn thì tải xuống.
                else if (e.size <= 512 * 1024) void preview(e);
                else void download([e]);
              }}
              onContextMenu={(ev) => {
                ev.preventDefault();
                if (!isSel) setSel([e.path]);
              }}
            >
              <span className="nm">
                <Icon n={e.kind === "dir" ? "folder" : e.kind === "link" ? "link" : "files"} s={14} />
                <span>{e.name}</span>
              </span>
              <span className="num">{e.kind === "dir" ? "—" : fmtSize(e.size)}</span>
              <span className="num" style={{ textAlign: "left" }}>{fmtTime(e.mtime)}</span>
              <span className="num mono" style={{ fontSize: 10 }}>{e.modeStr}</span>
            </div>
          );
        })}

        {!loading && shown.length === 0 && !err && (
          <Empty icon="folderOpen" title="Thư mục trống" hint="Kéo file từ máy vào đây để tải lên." />
        )}
      </div>

      {selected.length === 1 && (
        <div className="sftp-bar" style={{ borderTop: "1px solid var(--border)", borderBottom: 0 }}>
          <span className="mono" style={{ flex: 1, fontSize: "var(--fs-xs)", color: "var(--text-3)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {baseName(selected[0].path)} · {selected[0].modeStr} · {selected[0].user ?? selected[0].uid ?? "?"}:{selected[0].group ?? selected[0].gid ?? "?"}
          </span>
          {selected[0].kind === "file" && (
            <IBtn icon="eye" tip="Xem nội dung" size="sm" onClick={() => void preview(selected[0])} />
          )}
          <IBtn icon="edit" tip="Đổi tên" size="sm" onClick={() => setRenaming(selected[0].path)} />
          <IBtn
            icon="lock" tip="Đổi quyền (chmod)" size="sm"
            onClick={(e) => { setMode((selected[0].mode & 0o777).toString(8)); pop.open(e, { t: "chmod", item: selected[0] }); }}
          />
          <IBtn icon="copy" tip="Copy đường dẫn" size="sm"
            onClick={() => { void navigator.clipboard.writeText(selected[0].path); toast("ok", "Đã copy đường dẫn"); }} />
        </div>
      )}

      {peek && (
        <div className="peek">
          <div className="sftp-bar" style={{ borderBottom: "1px solid var(--border)" }}>
            <Icon n="files" s={13} />
            <span className="mono" style={{ flex: 1, fontSize: "var(--fs-xs)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {peek.name}
            </span>
            {peek.cut && <Chip tone="warn">cắt bớt</Chip>}
            <IBtn icon="copy" tip="Copy nội dung" size="sm"
              onClick={() => { void navigator.clipboard.writeText(peek.text); toast("ok", "Đã copy nội dung"); }} />
            <IBtn icon="x" tip="Đóng" size="sm" onClick={() => setPeek(null)} />
          </div>
          <pre className="peek-body">{peek.text}</pre>
        </div>
      )}

      {xfers.length > 0 && (
        <div className="xfer">
          {xfers.map((x) => (
            <div key={x.id} className="xfer-row">
              <Icon n={x.dir === "up" ? "upload" : "download"} s={12} />
              <span className="nm">{x.name}</span>
              <span className="bar">
                <i style={{ width: `${x.total ? Math.min(100, (x.done / x.total) * 100) : 8}%` }} />
              </span>
              <span className="mono" style={{ minWidth: 58, textAlign: "right" }}>{fmtSize(x.done)}</span>
            </div>
          ))}
        </div>
      )}

      {pop.state && (
        <Popover anchor={pop.state.anchor} onClose={pop.close}>
          {pop.state.data.t === "del" && (
            <Confirm
              message={`Xóa ${pop.state.data.items.length} mục? Thư mục sẽ bị xóa cùng toàn bộ nội dung.`}
              onClose={pop.close}
              onConfirm={async () => {
                const items = (pop.state!.data as { items: SftpEntry[] }).items;
                for (const it of items) {
                  try { await ipc.sftpRemove(connId, it.path); }
                  catch (e) { toast("err", `${it.name}: ${e}`); }
                }
                void load(path);
              }}
            />
          )}
          {pop.state.data.t === "chmod" && (
            <div style={{ padding: 8, display: "flex", flexDirection: "column", gap: 8 }}>
              <div className="hint">Quyền dạng bát phân</div>
              <Field mono small value={mode} onChange={setMode} placeholder="644" autoFocus />
              <div style={{ display: "flex", gap: 6 }}>
                <Btn small onClick={pop.close}>Hủy</Btn>
                <Btn
                  small variant="primary"
                  onClick={async () => {
                    const item = (pop.state!.data as { item: SftpEntry }).item;
                    const n = parseInt(mode, 8);
                    pop.close();
                    if (!Number.isFinite(n)) return toast("err", "Giá trị không hợp lệ");
                    try { await ipc.sftpChmod(connId, item.path, n); void load(path); }
                    catch (e) { toast("err", String(e)); }
                  }}
                >
                  Áp dụng
                </Btn>
              </div>
            </div>
          )}
        </Popover>
      )}
    </div>
  );
}

function NewName({
  icon, initial = "", onSubmit, onCancel,
}: {
  icon: string;
  initial?: string;
  onSubmit: (name: string) => void;
  onCancel: () => void;
}) {
  const [v, setV] = useState(initial);
  return (
    <div className="fs-row sel">
      <span className="nm">
        <Icon n={icon} s={14} />
        <input
          autoFocus
          value={v}
          onChange={(e) => setV(e.target.value)}
          onBlur={() => (v.trim() ? onSubmit(v.trim()) : onCancel())}
          onKeyDown={(e) => {
            if (e.key === "Enter" && v.trim()) onSubmit(v.trim());
            if (e.key === "Escape") onCancel();
          }}
          style={{
            flex: 1, minWidth: 0, background: "var(--bg)", color: "var(--text)",
            border: "1px solid var(--border-focus)", borderRadius: 3,
            font: "inherit", padding: "1px 4px", userSelect: "text",
          }}
        />
      </span>
      <span /><span /><span />
    </div>
  );
}
