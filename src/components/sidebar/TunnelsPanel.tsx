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
  const { tunnels, startTunnel, stopTunnel, connBySession } = useApp();
  const [edit, setEdit] = useState<TunnelDef | null>(null);
  const pop = usePopover<TunnelDef>();

  const sshSessions = cfg.sessions.filter((s) => s.kind === "ssh");

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
              <Row label={edit.kind === "remote" ? "Bind (xa)" : "Bind (máy này)"}>
                <Field mono value={edit.bindHost} onChange={(v) => setEdit({ ...edit, bindHost: v })} placeholder="127.0.0.1" />
                <NumField value={edit.bindPort} onChange={(v) => setEdit({ ...edit, bindPort: v })} min={0} max={65535} width={72} />
              </Row>
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
            onClick={() => { cfg.upsertTunnel(edit); setEdit(null); }}>Lưu</Btn>
          <div style={{ flex: 1 }} />
          <Btn variant="ghost" small onClick={() => setEdit(null)}>Hủy</Btn>
        </div>
      </>
    );
  }

  return (
    <>
      <div className="side-head">
        <span className="side-title">Tunnels</span>
        <IBtn
          icon="plus" tip="Tunnel mới" size="sm"
          disabled={sshSessions.length === 0}
          onClick={() => setEdit(blank(sshSessions[0]?.id ?? ""))}
        />
      </div>
      <div className="side-body">
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
            const connected = !!connBySession[t.sessionId];
            return (
              <div key={t.id} className="list-item">
                <span style={{ color: live ? "var(--ok)" : "var(--text-3)", display: "grid" }}>
                  <Icon n={t.kind === "dynamic" ? "globe" : "plug"} s={15} />
                </span>
                <div className="main">
                  <div className="t1">{t.name || KIND_LABEL[t.kind]}</div>
                  <div className="t2">
                    {t.kind === "dynamic"
                      ? `${t.bindHost}:${live?.port ?? t.bindPort} → SOCKS5`
                      : `${t.bindHost}:${live?.port ?? t.bindPort} → ${t.destHost}:${t.destPort}`}
                    {session && ` · ${session.name || session.host}`}
                  </div>
                </div>
                {live ? <Chip tone="ok">chạy</Chip> : connected ? <Chip>tắt</Chip> : <Chip tone="warn">chưa nối</Chip>}
                {live ? (
                  <IBtn icon="stop" tip="Dừng" size="sm" onClick={() => void stopTunnel(t.id)} />
                ) : (
                  <IBtn icon="play" tip="Chạy" size="sm" disabled={!connected} onClick={() => void startTunnel(t.id)} />
                )}
                <IBtn icon="edit" tip="Sửa" size="sm" onClick={() => setEdit(t)} />
                <IBtn icon="trash" tip="Xóa" size="sm" danger onClick={(e) => pop.open(e, t)} />
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
