import { useMemo, useState } from "react";
import { KIND_ICON, kindSubtitle, parseAddress } from "@/lib/kinds";
import { ago, modKey } from "@/lib/util";
import { useApp } from "@/store/app";
import { useConfig } from "@/store/config";
import { Icon } from "../ui/Icon";
import { Btn, StageTag } from "../ui/primitives";

const TUNNEL_STATE = {
  running: { text: "Đang chạy", color: "var(--ok)" },
  connecting: { text: "Đang kết nối", color: "var(--info)" },
  retrying: { text: "Đang nối lại", color: "var(--warn)" },
  stopped: { text: "Đã dừng", color: "var(--danger)" },
} as const;

/// Pane trống = màn Home kiểu MobaXterm: kết nối nhanh, hai nút lớn, session gần đây.
export function Home({ target }: { target: { tabId: string; paneId: string } }) {
  const cfg = useConfig();
  const app = useApp();
  const [addr, setAddr] = useState("");

  const recent = useMemo(
    () => cfg.sessions.filter((s) => !s.quick)
      .sort((a, b) => (b.lastUsed ?? 0) - (a.lastUsed ?? 0))
      .slice(0, 8),
    [cfg.sessions],
  );
  const live = cfg.tunnels.filter((t) => app.tunnels[t.id]);
  const valid = !!parseAddress(addr);
  const connect = () => valid && void app.quickConnect(addr, target);

  return (
    <div className="home">
      <div className="home-col">
        <div className="home-brand">
          <span className="home-logo"><Icon n="terminal" s={26} /></span>
          <div>
            <h1>Vibe SSH</h1>
            <div className="hint">Terminal · SFTP · Tunnel</div>
          </div>
        </div>

        <label className={`home-addr ${valid ? "ok" : ""}`}>
          <Icon n="globe" s={16} />
          <input
            className="mono"
            autoFocus
            aria-label="Địa chỉ SSH"
            placeholder="user@host:port"
            value={addr}
            onChange={(e) => setAddr(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && connect()}
          />
          <Btn variant="primary" small disabled={!valid} onClick={connect}>Kết nối</Btn>
        </label>

        <div className="home-big">
          <button type="button" onClick={() => void app.openLocal(target)}>
            <Icon n="terminal" s={22} />
            <b>Shell máy này</b>
          </button>
          <button type="button" onClick={() => app.setEditing("new")}>
            <Icon n={KIND_ICON.ssh} s={22} />
            <b>Session mới</b>
          </button>
          <button type="button" onClick={() => void app.importSshConfig()}>
            <Icon n="download" s={22} />
            <b>Nhập ~/.ssh/config</b>
          </button>
        </div>

        {recent.length > 0 && (
          <section>
            <h2>Session gần đây</h2>
            <div className="home-list">
              {recent.map((s) => {
                const open = !!app.conns[app.connBySession[s.id]];
                return (
                  <button key={s.id} type="button" className="home-row" onClick={() => void app.openSession(s.id, target)}>
                    <span className={`led ${open ? "ok" : ""}`} />
                    <span className="main">
                      <span className="t1">{s.name || s.host}</span>
                      <span className="t2 mono">{kindSubtitle(s)}</span>
                    </span>
                    <StageTag stage={s.stage} />
                    <span className="hint">{open ? "Đang mở" : ago(s.lastUsed)}</span>
                  </button>
                );
              })}
            </div>
          </section>
        )}

        {live.length > 0 && (
          <section>
            <h2>Tunnel</h2>
            <div className="home-list">
              {live.map((t) => {
                const st = TUNNEL_STATE[app.tunnels[t.id].state];
                return (
                  <button key={t.id} type="button" className="home-row" onClick={() => app.setTunnelsOpen(true)}>
                    <span className="led" style={{ background: st.color }} />
                    <span className="main">
                      <span className="t1">{t.name || t.kind}</span>
                      <span className="t2 mono">{t.bindHost}:{t.bindPort} → {t.kind === "dynamic" ? "SOCKS5" : `${t.destHost}:${t.destPort}`}</span>
                    </span>
                    <span className="hint" style={{ color: st.color }}>{st.text}</span>
                  </button>
                );
              })}
            </div>
          </section>
        )}

        <div className="hint" style={{ textAlign: "center" }}>
          Mật khẩu nhập một lần, lưu trong Keychain · Bảng lệnh: <kbd>{modKey()}K</kbd>
        </div>
      </div>
    </div>
  );
}
