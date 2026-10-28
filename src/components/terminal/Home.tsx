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

/// Pane trống = màn Home: kết nối nhanh, session gần đây, tunnel, lối tắt.
export function Home({ target }: { target: { tabId: string; paneId: string } }) {
  const cfg = useConfig();
  const app = useApp();
  const [addr, setAddr] = useState("");

  const recent = useMemo(
    () => cfg.sessions.filter((s) => !s.quick)
      .sort((a, b) => (b.lastUsed ?? 0) - (a.lastUsed ?? 0))
      .slice(0, 6),
    [cfg.sessions],
  );
  const valid = !!parseAddress(addr);
  const connect = () => valid && void app.quickConnect(addr, target);

  return (
    <div className="home">
      <section className="home-sec">
        <h1>Kết nối</h1>
        <div className="home-quick">
          <label className={`home-addr ${valid ? "ok" : ""}`}>
            <Icon n="terminal" s={16} />
            <input
              className="mono"
              autoFocus
              aria-label="Địa chỉ SSH"
              placeholder="user@host:port"
              value={addr}
              onChange={(e) => setAddr(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && connect()}
            />
            <span className="hint">Enter để kết nối</span>
          </label>
          <Btn variant="primary" disabled={!valid} onClick={connect}>Kết nối</Btn>
        </div>
        <div className="hint">Kết nối xong sẽ hỏi có lưu thành session không. Mật khẩu nhập một lần, lưu trong Keychain.</div>
      </section>

      {recent.length > 0 && (
        <section className="home-sec">
          <h2>Gần đây</h2>
          <div className="home-cards">
            {recent.map((s) => {
              const live = !!app.conns[app.connBySession[s.id]];
              return (
                <div key={s.id} className="home-card">
                  <div className="row1">
                    <span className={`led ${live ? "ok" : ""}`} />
                    <b>{s.name || s.host}</b>
                    <StageTag stage={s.stage} />
                  </div>
                  <div className="addr">{kindSubtitle(s)}</div>
                  <div className="row1">
                    <span className="hint" style={{ flex: 1 }}>{live ? "Đang mở" : ago(s.lastUsed)}</span>
                    <Btn small icon="play" onClick={() => void app.openSession(s.id, target)}>Mở</Btn>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      <div className="home-split">
        <section className="home-sec">
          <h2>Tunnel</h2>
          {cfg.tunnels.length === 0 ? (
            <div className="hint">Chưa có tunnel nào.</div>
          ) : (
            <div className="home-list">
              {cfg.tunnels.slice(0, 5).map((t) => {
                const st = app.tunnels[t.id] ? TUNNEL_STATE[app.tunnels[t.id].state] : null;
                return (
                  <button key={t.id} type="button" className="home-row" onClick={() => app.setSide("tunnels")}>
                    <span className="led" style={st ? { background: st.color } : undefined} />
                    <span className="main">
                      <span className="t1">{t.name || t.kind}</span>
                      <span className="t2 mono">{t.bindHost}:{t.bindPort} → {t.kind === "dynamic" ? "SOCKS5" : `${t.destHost}:${t.destPort}`}</span>
                    </span>
                    <span className="hint" style={st ? { color: st.color } : undefined}>{st?.text ?? "Tắt"}</span>
                  </button>
                );
              })}
            </div>
          )}
        </section>

        <section className="home-sec">
          <h2>Bắt đầu nhanh</h2>
          <div className="home-list">
            <button type="button" className="home-row" onClick={() => void app.importSshConfig()}>
              <Icon n="download" s={15} /><span className="main t1">Nhập host từ ~/.ssh/config</span>
            </button>
            <button type="button" className="home-row" onClick={() => void app.openLocal(target)}>
              <Icon n="terminal" s={15} /><span className="main t1">Shell máy này</span>
            </button>
            <button type="button" className="home-row" onClick={() => app.setEditing("new")}>
              <Icon n={KIND_ICON.ssh} s={15} /><span className="main t1">Session mới</span>
            </button>
            <button type="button" className="home-row" onClick={() => app.setSide("tunnels")}>
              <Icon n="plug" s={15} /><span className="main t1">Tạo tunnel</span>
            </button>
          </div>
          <div className="hint">Mở bảng lệnh bất cứ lúc nào: <kbd>{modKey()}K</kbd></div>
        </section>
      </div>
    </div>
  );
}
