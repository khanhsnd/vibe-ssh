import { useMemo, useState } from "react";
import { useApp, type Pane as PaneT, type Tab } from "@/store/app";
import { useConfig } from "@/store/config";
import { Icon } from "../ui/Icon";
import { Btn, Field, IBtn } from "../ui/primitives";
import { AskBar } from "./AskBar";
import { Home } from "./Home";
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
  const quick = useConfig((s) => s.sessions.find((x) => x.id === pane.sessionId && x.quick));

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

      {pane.status === "ready" && quick && <QuickSave sessionId={quick.id} host={quick.host} />}

      {pane.status === "empty" && <Home target={{ tabId: tab.id, paneId: pane.id }} />}

      {pane.status === "connecting" && (
        <Center>
          <span className="led busy" style={{ width: 9, height: 9 }} />
          <div style={{ marginTop: 10, color: "var(--text-2)" }}>{pane.title}</div>
          <div className="hint" style={{ marginTop: 3 }}>{pane.detail || "đang kết nối…"}</div>
        </Center>
      )}

      {(pane.status === "ready" || pane.status === "closed") && pane.termId && (
        <TerminalView termId={pane.termId} focused={focused} histKey={pane.sessionId ?? "local"} connId={pane.connId} />
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

/// Sau kết nối nhanh: hỏi inline có lưu thành session không.
function QuickSave({ sessionId, host }: { sessionId: string; host: string }) {
  const { saveQuick, discardQuick } = useApp();
  const [name, setName] = useState(host);
  return (
    <div className="quick-save">
      <Icon n="check" s={15} />
      <span>Đã kết nối <b className="mono">{host}</b>. Lưu thành session?</span>
      <Field value={name} onChange={setName} placeholder="Tên session" />
      <Btn small variant="primary" onClick={() => saveQuick(sessionId, name)}>Lưu</Btn>
      <div style={{ flex: 1 }} />
      <IBtn icon="x" tip="Không lưu" size="sm" onClick={() => discardQuick(sessionId)} />
    </div>
  );
}
