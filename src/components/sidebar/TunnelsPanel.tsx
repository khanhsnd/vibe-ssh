import { useState } from "react";
import type { TunnelDef } from "@/lib/types";
import { useApp } from "@/store/app";
import { useConfig } from "@/store/config";
import { Icon } from "../ui/Icon";
import { Confirm, Popover, usePopover } from "../ui/Popover";
import { Btn, Chip, Field, IBtn, NumField, Row, Select } from "../ui/primitives";

const KIND_LABEL: Record<TunnelDef["kind"], string> = {
  local: "Local (-L)", remote: "Remote (-R)", dynamic: "SOCKS5 (-D)",
};

const blank = (sessionId: string): TunnelDef => ({
  id: crypto.randomUUID(), name: "", sessionId, kind: "local",
  bindHost: "127.0.0.1", bindPort: 8080, destHost: "127.0.0.1", destPort: 80,
  autoStart: false,
});

export function TunnelsPanel() {
  const cfg = useConfig();
  const { tunnels, startTunnel, stopTunnel, connBySession, conns, openSession, setEditing, toast } = useApp();
  const [edit, setEdit] = useState<TunnelDef | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const pop = usePopover<TunnelDef>();

  const sshSessions = cfg.sessions.filter((s) => s.kind === "ssh");

  const save = () => {
    if (!edit) return;
    const portValid = (port: number, min: number) => Number.isInteger(port) && port >= min && port <= 65535;
    if (!sshSessions.some((s) => s.id === edit.sessionId)) return toast("err", "Chọn một session SSH");
    if (!edit.bindHost.trim() || (edit.kind !== "dynamic" && !edit.destHost.trim())) return toast("err", "Cần nhập địa chỉ cổng mở và đích");
    if (!portValid(edit.bindPort, 0) || (edit.kind !== "dynamic" && !portValid(edit.destPort, 1))) return toast("err", "Cổng không hợp lệ (1–65535; cổng mở có thể là 0 để tự chọn)");
    cfg.upsertTunnel({ ...edit, name: edit.name.trim(), bindHost: edit.bindHost.trim(), destHost: edit.destHost.trim() });
    setEdit(null);
  };

  const run = async (t: TunnelDef) => {
    setBusy(t.id);
    try { await startTunnel(t.id); } finally { setBusy(null); }
  };

  if (edit) {
    const dynamic = edit.kind === "dynamic";
    return (
      <>
        <div className="side-head">
          <IBtn icon="chevronLeft" tip="Quay lại" size="sm" onClick={() => setEdit(null)} />
          <span className="side-title">Tunnel</span>
        </div>
        <div className="side-body">
          <div className="editor">
            <div className="grp">
              <Row label="Mẫu nhanh" stack>
                <div className="tunnel-actions">
                  {[{ name: "PostgreSQL", port: 5432 }, { name: "MySQL", port: 3306 }, { name: "Web", port: 8080 }].map((preset) => (
                    <Btn small key={preset.name} onClick={() => setEdit({ ...edit, name: preset.name, kind: "local", bindPort: preset.port, destPort: preset.port })}>{preset.name}</Btn>
                  ))}
                  <Btn small onClick={() => setEdit({ ...edit, name: "SOCKS5", kind: "dynamic", bindPort: 1080 })}>SOCKS5</Btn>
                </div>
              </Row>
              <Row label="Tên">
                <Field value={edit.name} onChange={(v) => setEdit({ ...edit, name: v })} placeholder="ví dụ: db-prod" />
              </Row>
              <Row label="Session">
                <Select
                  value={edit.sessionId}
                  onChange={(v) => setEdit({ ...edit, sessionId: v })}
                  options={sshSessions.map((s) => ({ value: s.id, label: s.name || s.host }))}
                />
              </Row>
              <Row label="Loại">
                <Select
                  value={edit.kind}
                  onChange={(v) => setEdit({ ...edit, kind: v as TunnelDef["kind"] })}
                  options={(Object.keys(KIND_LABEL) as TunnelDef["kind"][]).map((k) => ({ value: k, label: KIND_LABEL[k] }))}
                />
              </Row>
              <TunnelRoute tunnel={edit} server={sshSessions.find((s) => s.id === edit.sessionId)?.host} />
              <Row label={edit.kind === "remote" ? "Bind (xa)" : "Bind (máy này)"}>
                <Field mono value={edit.bindHost} onChange={(v) => setEdit({ ...edit, bindHost: v })} placeholder="127.0.0.1" />
                <NumField value={edit.bindPort} onChange={(v) => setEdit({ ...edit, bindPort: v })} min={0} max={65535} width={72} />
              </Row>
              <div className="hint">Cổng mở = 0: tự chọn cổng trống khi chạy.</div>
              {!dynamic && (
                <Row label={edit.kind === "remote" ? "Đích (máy này)" : "Đích (từ server)"}>
                  <Field mono value={edit.destHost} onChange={(v) => setEdit({ ...edit, destHost: v })} />
                  <NumField value={edit.destPort} onChange={(v) => setEdit({ ...edit, destPort: v })} min={1} max={65535} width={72} />
                </Row>
              )}
              <Row label="">
                <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <input
                    type="checkbox"
                    checked={edit.autoStart}
                    onChange={(e) => setEdit({ ...edit, autoStart: e.target.checked })}
                  />
                  <span className="hint">Tự chạy khi session kết nối</span>
                </label>
              </Row>
              <div className="hint" style={{ marginTop: 8 }}>
                {edit.kind === "local" && "Cổng trên máy bạn → chuyển tới đích, đi qua server."}
                {edit.kind === "remote" && "Cổng mở trên server → chuyển về đích trên máy bạn."}
                {edit.kind === "dynamic" && "Proxy SOCKS5 trên máy bạn, mọi kết nối đi qua server."}
              </div>
            </div>
          </div>
        </div>
        <div className="side-foot" style={{ display: "flex", gap: 6 }}>
          <Btn variant="primary" small icon="save"
            onClick={save}>Lưu</Btn>
          <div style={{ flex: 1 }} />
          <Btn variant="ghost" small onClick={() => setEdit(null)}>Hủy</Btn>
        </div>
      </>
    );
  }

  return (
    <>
      <div className="side-head">
        <span className="side-title">SSH Tunnels</span>
        <Chip tone="ok">{Object.keys(tunnels).length} đang chạy</Chip>
        <IBtn
          icon="plus" tip="Tunnel mới" size="sm"
          disabled={sshSessions.length === 0}
          onClick={() => setEdit(blank(sshSessions[0]?.id ?? ""))}
        />
      </div>
      <div className="side-body">
        <div className="grp">
          <p className="hint">Mở cổng tới database, web nội bộ hoặc tạo proxy qua SSH.</p>
          <Btn icon="plus" variant="primary" small onClick={() => sshSessions.length ? setEdit(blank(sshSessions[0].id)) : setEditing("new")}>
            {sshSessions.length ? "Thêm tunnel" : "Tạo session SSH"}
          </Btn>
        </div>
        {cfg.tunnels.length === 0 && (
          <div className="empty">
            <Icon n="plug" s={28} w={1.3} />
            <b>Chưa có tunnel</b>
            {sshSessions.length === 0 ? "Tạo một session SSH trước." : "Local, remote hoặc SOCKS5."}
          </div>
        )}
        <div className="list">
          {cfg.tunnels.map((t) => {
            const live = tunnels[t.id];
            const session = cfg.sessions.find((s) => s.id === t.sessionId);
            const connected = !!conns[connBySession[t.sessionId]];
            return (
              <div key={t.id} className="tunnel-card">
                <div className="tunnel-actions">
                  <Icon n={t.kind === "dynamic" ? "globe" : "plug"} s={15} />
                  <strong className="tunnel-name">{t.name || KIND_LABEL[t.kind]}</strong>
                  {live ? <Chip tone="ok">Đang chạy</Chip> : <Chip tone={connected ? undefined : "warn"}>{connected ? "Đã dừng" : "Chưa kết nối"}</Chip>}
                </div>
                <div className="hint">{KIND_LABEL[t.kind]} · {session?.name || session?.host || "Session đã bị xóa"}{t.autoStart ? " · Tự chạy" : ""}</div>
                <TunnelRoute tunnel={t} server={session?.host} port={live?.port} />
                <div className="tunnel-actions">
                  {live ? (
                    <Btn small icon="stop" onClick={() => void stopTunnel(t.id)}>Dừng</Btn>
                  ) : connected ? (
                    <Btn small icon="play" disabled={busy !== null} onClick={() => void run(t)}>{busy === t.id ? "Đang mở…" : "Chạy tunnel"}</Btn>
                  ) : (
                    <Btn small icon="server" disabled={!session || busy !== null} onClick={async () => {
                      setBusy(t.id);
                      try { await openSession(t.sessionId); } finally { setBusy(null); }
                    }}>{busy === t.id ? "Đang kết nối…" : "Kết nối SSH"}</Btn>
                  )}
                  <div style={{ flex: 1 }} />
                  <IBtn icon="edit" tip={live ? "Dừng tunnel trước khi sửa" : "Sửa"} size="sm" disabled={!!live || busy === t.id} onClick={() => setEdit(t)} />
                  <IBtn icon="trash" tip="Xóa" size="sm" disabled={busy === t.id} danger onClick={(e) => pop.open(e, t)} />
                </div>
              </div>
            );
          })}
        </div>
      </div>
      {pop.state && (
        <Popover anchor={pop.state.anchor} onClose={pop.close}>
          <Confirm
            message={`Xóa tunnel “${pop.state.data.name || KIND_LABEL[pop.state.data.kind]}”?`}
            onClose={pop.close}
            onConfirm={() => {
              void stopTunnel(pop.state!.data.id);
              cfg.removeTunnel(pop.state!.data.id);
            }}
          />
        </Popover>
      )}
    </>
  );
}

function TunnelRoute({ tunnel: t, server, port }: { tunnel: TunnelDef; server?: string; port?: number }) {
  const endpoint = (host: string, value: number) => `${host.includes(":") ? `[${host}]` : host}:${value || "tự chọn"}`;
  return (
    <div className="tunnel-route">
      <div><span>{t.kind === "remote" ? "Cổng trên server" : "Cổng trên máy bạn"}</span><code>{endpoint(t.bindHost, port ?? t.bindPort)}</code></div>
      <div className="tunnel-hop">↓ SSH · {server || "Chọn session"}</div>
      <div><span>{t.kind === "dynamic" ? "Proxy SOCKS5" : t.kind === "remote" ? "Đích từ máy bạn" : "Đích từ server"}</span><code>{t.kind === "dynamic" ? "Internet / mạng phía server" : endpoint(t.destHost, t.destPort)}</code></div>
    </div>
  );
}
