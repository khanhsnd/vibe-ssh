import { useMemo, useState } from "react";
import { useApp, type Pane as PaneT, type Tab } from "@/store/app";
import { KIND_ICON, kindSubtitle } from "@/lib/kinds";
import { useConfig } from "@/store/config";
import { Icon } from "../ui/Icon";
import { Btn, Field, IBtn } from "../ui/primitives";
import { AskBar } from "./AskBar";
import { TerminalView } from "./TerminalView";

export function Pane({ tab, pane }: { tab: Tab; pane: PaneT }) {
  const focused = tab.active === pane.id;
  const focusPane = useApp((s) => s.focusPane);
  const closePane = useApp((s) => s.closePane);
  const reconnectPane = useApp((s) => s.reconnectPane);
  const toggleBroadcastTarget = useApp((s) => s.toggleBroadcastTarget);
  const asks = useApp((s) => s.asks);
  const broadcast = useApp((s) => s.broadcast);
  const broadcastTargets = useApp((s) => s.broadcastTargets);
  const conn = useApp((s) => (pane.connId ? s.conns[pane.connId] : undefined));

  // Mọi câu hỏi từ backend đều mang connId, nên lọc chặt: pane trống hoặc
  // pane của kết nối khác không được hiện dải xác nhận của người ta.
  const paneAsks = useMemo(
    () => (pane.connId ? asks.filter((a) => a.payload.connId === pane.connId) : []),
    [asks, pane.connId],
  );

  return (
    <div className={`pane ${focused ? "focused" : ""}`} onMouseDown={() => focusPane(tab.id, pane.id)}>
      {pane.status !== "empty" && (
        <div className="pane-bar">
          <span className={`led ${pane.status === "ready" ? "ok" : pane.status === "connecting" ? "busy" : pane.status === "error" ? "err" : ""}`} />
          <span className="who">{pane.title}</span>
          {conn && (
            <span className="mono" style={{ color: "var(--text-3)", fontSize: 10 }}>
              {conn.user}@{conn.host}:{conn.port}
              {conn.via.length > 0 && ` · qua ${conn.via.length} bastion`}
            </span>
          )}
          {pane.detail && (
            <span style={{ color: "var(--text-3)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {pane.detail}
            </span>
          )}
          <div style={{ flex: 1 }} />
          {broadcast && pane.termId && (
            <IBtn
              icon={broadcastTargets.includes(pane.termId) ? "check" : "broadcast"}
              tip={broadcastTargets.includes(pane.termId) ? "Đang nhận multi-exec" : "Thêm vào multi-exec"}
              size="sm"
              on={broadcastTargets.includes(pane.termId)}
              onClick={() => toggleBroadcastTarget(pane.termId!)}
            />
          )}
          <IBtn icon="refresh" tip="Kết nối lại" size="sm" onClick={() => void reconnectPane(tab.id, pane.id)} />
          <IBtn icon="x" tip="Đóng pane" size="sm" onClick={() => closePane(tab.id, pane.id)} />
        </div>
      )}

      {paneAsks.map((a) => <AskBar key={a.askId} ask={a} />)}

      {pane.status === "empty" && <Launcher tab={tab} pane={pane} />}

      {pane.status === "connecting" && (
        <Center>
          <span className="led busy" style={{ width: 9, height: 9 }} />
          <div style={{ marginTop: 10, color: "var(--text-2)" }}>{pane.title}</div>
          <div className="hint" style={{ marginTop: 3 }}>{pane.detail || "đang kết nối…"}</div>
        </Center>
      )}

      {(pane.status === "ready" || pane.status === "closed") && pane.termId && (
        <TerminalView termId={pane.termId} focused={focused} />
      )}

      {pane.status === "error" && (
        <Center>
          <span style={{ color: "var(--danger)", display: "grid", placeItems: "center" }}>
            <Icon n="alert" s={26} />
          </span>
          <div style={{ marginTop: 10, color: "var(--text)" }}>Không kết nối được</div>
          <div className="hint err" style={{ marginTop: 4, maxWidth: 460, userSelect: "text" }}>{pane.detail}</div>
          <div style={{ marginTop: 14, display: "flex", gap: 8 }}>
            <Btn icon="refresh" small onClick={() => void reconnectPane(tab.id, pane.id)}>Thử lại</Btn>
            <Btn icon="x" small onClick={() => closePane(tab.id, pane.id)}>Đóng</Btn>
          </div>
        </Center>
      )}

      {pane.status === "closed" && !pane.termId && (
        <Center>
          <div className="hint">Phiên đã đóng</div>
          <div style={{ marginTop: 12 }}>
            <Btn icon="refresh" small onClick={() => void reconnectPane(tab.id, pane.id)}>Mở lại</Btn>
          </div>
        </Center>
      )}
    </div>
  );
}

function Center({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ flex: 1, display: "grid", placeItems: "center", textAlign: "center", padding: 20 }}>
      <div>{children}</div>
    </div>
  );
}

/// Pane trống = bảng khởi động gọn, thay cho hộp thoại "new session".
function Launcher({ tab, pane }: { tab: Tab; pane: PaneT }) {
  const [q, setQ] = useState("");
  const sessions = useConfig((s) => s.sessions);
  const { openSession, openLocal, setEditing, setSide } = useApp();

  const hits = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const list = needle
      ? sessions.filter((s) =>
          `${s.name} ${s.host} ${s.user}`.toLowerCase().includes(needle),
        )
      : sessions;
    return list.slice(0, 9);
  }, [q, sessions]);

  const target = { tabId: tab.id, paneId: pane.id };

  return (
    <div style={{ flex: 1, overflow: "auto", padding: "26px 22px", display: "grid", placeItems: "start center" }}>
      <div style={{ width: "min(440px, 100%)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
          <span style={{ color: "var(--accent)", display: "grid" }}><Icon n="terminal" s={18} /></span>
          <b style={{ fontSize: "var(--fs-lg)" }}>Mở phiên mới</b>
        </div>

        <Field icon="search" value={q} onChange={setQ} placeholder="Tìm session đã lưu…" autoFocus />

        <div style={{ display: "flex", gap: 6, marginTop: 10, flexWrap: "wrap" }}>
          <Btn icon="terminal" small onClick={() => void openLocal(target)}>Shell máy này</Btn>
          <Btn icon="plus" small onClick={() => { setSide("sessions"); setEditing("new"); }}>Session mới</Btn>
        </div>

        <div className="list" style={{ marginTop: 14, border: "1px solid var(--border)", borderRadius: "var(--radius)", overflow: "hidden" }}>
          {hits.length === 0 && (
            <div className="hint" style={{ padding: "14px 12px" }}>
              {sessions.length === 0 ? "Chưa có session nào được lưu." : "Không có kết quả."}
            </div>
          )}
          {hits.map((s) => (
            <button
              key={s.id}
              type="button"
              className="list-item"
              style={{ background: "transparent", border: 0, borderBottom: "1px solid var(--border)", textAlign: "left", width: "100%" }}
              onClick={() => void openSession(s.id, target)}
            >
              <Icon n={KIND_ICON[s.kind]} s={15} />
              <div className="main">
                <div className="t1">{s.name || s.host || "(không tên)"}</div>
                <div className="t2">{kindSubtitle(s)}</div>
              </div>
              <Icon n="chevronRight" s={14} />
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
