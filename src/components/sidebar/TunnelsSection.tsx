import { useApp } from "@/store/app";
import { useConfig } from "@/store/config";
import { IBtn } from "../ui/primitives";

const LED = { running: "ok", connecting: "busy", retrying: "busy", stopped: "err" } as const;

/// Danh sách tunnel gọn dưới cây host: bật/tắt tại chỗ, sửa thì mở trình quản lý.
export function TunnelsSection() {
  const tunnels = useConfig((s) => s.tunnels);
  const { tunnels: live, startTunnel, stopTunnel, setTunnelsOpen } = useApp();

  return (
    <section className="sb-sec">
      <div className="side-head">
        <span className="side-title">Tunnel</span>
        <IBtn icon="plus" tip="Tạo tunnel" size="sm" onClick={() => setTunnelsOpen(true)} />
      </div>
      <div className="tree">
        {tunnels.length === 0 && (
          <button type="button" className="node ghost" onClick={() => setTunnelsOpen(true)}>
            <span className="label">Chuyển cổng qua SSH…</span>
          </button>
        )}
        {tunnels.map((t) => {
          const st = live[t.id]?.state;
          const on = !!st && st !== "stopped";
          return (
            <div key={t.id} className="node" onClick={() => setTunnelsOpen(true)} title="Mở trình quản lý tunnel">
              <span className={`led ${st ? LED[st] : ""}`} />
              <span className="label">{t.name || t.kind}</span>
              <span className="sub mono">:{t.bindPort}</span>
              <span onClick={(e) => e.stopPropagation()}>
                <IBtn
                  icon={on ? "stop" : "play"}
                  tip={on ? "Dừng" : "Chạy"}
                  size="sm"
                  onClick={() => void (on ? stopTunnel(t.id) : startTunnel(t.id))}
                />
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );
}
