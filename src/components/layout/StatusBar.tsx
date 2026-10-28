import { fmtSize } from "@/lib/util";
import { useApp } from "@/store/app";
import { useConfig } from "@/store/config";
import { Icon } from "../ui/Icon";

export function StatusBar() {
  const { activePane, conns, tunnels, xfers, broadcast, broadcastTargets, mem, setSide, toggleBroadcast, disconnectConn } =
    useApp();
  const sessions = useConfig((s) => s.sessions.length);
  const cur = activePane();
  const conn = cur?.pane.connId ? conns[cur.pane.connId] : undefined;
  const running = Object.values(tunnels).filter((t) => t.state === "running");
  const active = xfers.filter((x) => x.state === "run");

  return (
    <div className="status">
      <span className={`seg ${conn ? "on" : ""}`}>
        <span className={`led ${cur?.pane.status === "ready" ? "ok" : cur?.pane.status === "connecting" ? "busy" : cur?.pane.status === "error" ? "err" : ""}`} />
        {conn ? `${conn.user}@${conn.host}:${conn.port}` : cur?.pane.title || "chưa kết nối"}
      </span>

      {conn && conn.via.length > 0 && (
        <span className="seg" data-tip={`Đi qua: ${conn.via.join(" → ")}`}>
          <Icon n="jump" s={12} />
          {conn.via.length} bastion
        </span>
      )}

      {conn && (
        <button type="button" className="seg" data-tip="Ngắt kết nối này" onClick={() => void disconnectConn(conn.id)}>
          <Icon n="logout" s={12} />
        </button>
      )}

      <span className="spacer" />

      {active.length > 0 && (
        <span className="seg on" data-tip={active.map((x) => x.name).join(", ")}>
          <Icon n={active[0].dir === "up" ? "upload" : "download"} s={12} />
          {active.length} · {fmtSize(active.reduce((a, x) => a + x.done, 0))}
        </span>
      )}

      <button
        type="button"
        className={`seg ${broadcast ? "on" : ""}`}
        data-tip={broadcast ? `Multi-exec: ${broadcastTargets.length} pane` : "Bật multi-exec"}
        onClick={toggleBroadcast}
      >
        <Icon n="broadcast" s={12} />
        {broadcast ? broadcastTargets.length : ""}
      </button>

      <button
        type="button"
        className={`seg ${running.length ? "on" : ""}`}
        data-tip={running.length ? running.map((t) => `cổng ${t.port}`).join(", ") : "Chưa có tunnel nào chạy"}
        onClick={() => setSide("tunnels")}
      >
        <Icon n="plug" s={12} />
        {running.length}
      </button>

      <button type="button" className="seg" data-tip="Sessions đã lưu" onClick={() => setSide("sessions")}>
        <Icon n="server" s={12} />
        {sessions}
      </button>

      <span className="seg" data-tip="RAM tiến trình chính (không gồm process con)">
        <Icon n="cpu" s={12} />
        {mem ? fmtSize(mem * 1024) : "—"}
      </span>
    </div>
  );
}
