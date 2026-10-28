import { useEffect, useState, type ReactNode } from "react";
import { pickKeyFile } from "@/lib/dialog";
import * as ipc from "@/lib/ipc";
import { parseAddress } from "@/lib/kinds";
import { newSession, type LocalKey, type TunnelDef } from "@/lib/types";
import { tunnelConnId, useApp, type LiveTunnel } from "@/store/app";
import { useConfig } from "@/store/config";
import { AskBar } from "../terminal/AskBar";
import { Icon } from "../ui/Icon";
import { Confirm, Popover, usePopover } from "../ui/Popover";
import { Btn, Chip, Field, IBtn, NumField, Seg, Select, Switch } from "../ui/primitives";

type Kind = TunnelDef["kind"];

const KIND_LABEL: Record<Kind, string> = { local: "Local", remote: "Remote", dynamic: "SOCKS5" };
const KIND_HINT: Record<Kind, string> = {
  local: "Mở cổng trên máy bạn, đi qua SSH server tới máy đích.",
  remote: "Mở cổng trên SSH server, chuyển về máy đích nhìn từ máy bạn.",
  dynamic: "Proxy SOCKS5 trên máy bạn: mọi kết nối đi ra từ phía SSH server.",
};
const PRESETS = [
  { name: "PostgreSQL", port: 5432 }, { name: "MySQL", port: 3306 },
  { name: "Redis", port: 6379 }, { name: "Web", port: 8080 },
];

const STATE: Record<LiveTunnel["state"], { text: (l: LiveTunnel) => string; color: string }> = {
  running: { text: () => "Đang chạy", color: "var(--ok)" },
  connecting: { text: () => "Đang kết nối", color: "var(--info)" },
  retrying: { text: (l) => `Nối lại sau ${l.retryIn}s`, color: "var(--warn)" },
  stopped: { text: () => "Đã dừng", color: "var(--danger)" },
};

const blank = (sessionId: string): TunnelDef => ({
  id: crypto.randomUUID(), name: "", sessionId, kind: "local",
  bindHost: "127.0.0.1", bindPort: 5432, destHost: "localhost", destPort: 5432,
  autoStart: true, autoReconnect: true,
});

const isLive = (live?: LiveTunnel) => !!live && live.state !== "stopped";
const endpoint = (host: string, port: number) => `${host.includes(":") ? `[${host}]` : host}:${port || "tự chọn"}`;

/// Trình quản lý tunnel kiểu MobaSSHTunnel: form sơ đồ 3 khung ở trên, bảng ở dưới.
/// Phủ lên vùng làm việc (terminal vẫn chạy phía sau).
export function TunnelsPanel() {
  const cfg = useConfig();
  const { tunnels, asks, startTunnel, stopTunnel, setSide, toast } = useApp();
  const sshSessions = cfg.sessions.filter((s) => s.kind === "ssh" && !s.quick);
  const [draft, setDraft] = useState<TunnelDef>(() => blank(sshSessions[0]?.id ?? ""));
  /// Như MobaXterm: chọn session có sẵn, hoặc gõ thẳng user@host:port.
  const [serverMode, setServerMode] = useState<"session" | "new">(sshSessions.length ? "session" : "new");
  const [newAddr, setNewAddr] = useState("");
  const [keys, setKeys] = useState<LocalKey[]>([]);
  useEffect(() => { void ipc.localKeys().then(setKeys).catch(() => setKeys([])); }, []);
  const editing = cfg.tunnels.some((t) => t.id === draft.id);
  const pop = usePopover<TunnelDef>();
  const running = cfg.tunnels.filter((t) => tunnels[t.id]?.state === "running").length;

  const patch = (p: Partial<TunnelDef>) => setDraft((d) => ({ ...d, ...p }));
  const reset = () => setDraft(blank(draft.sessionId || sshSessions[0]?.id || ""));

  /// Server gõ tay thành session SSH đã lưu, để tunnel khác và terminal dùng lại.
  const resolveServer = (): string | null => {
    if (serverMode === "session") return sshSessions.some((s) => s.id === draft.sessionId) ? draft.sessionId : null;
    const a = parseAddress(newAddr);
    if (!a) return null;
    const known = sshSessions.find((s) => s.host === a.host && s.port === a.port && s.user === a.user);
    if (known) return known.id;
    const created = newSession({ ...a, name: a.host });
    cfg.upsertSession(created);
    return created.id;
  };

  const save = (run: boolean) => {
    const valid = (port: number, min: number) => Number.isInteger(port) && port >= min && port <= 65535;
    const sessionId = resolveServer();
    if (!sessionId) return toast("err", serverMode === "new" ? "SSH server cần dạng user@host hoặc user@host:port" : "Chọn SSH server");
    if (draft.kind !== "dynamic" && !draft.destHost.trim()) return toast("err", "Nhập host đích");
    if (!valid(draft.bindPort, 0) || (draft.kind !== "dynamic" && !valid(draft.destPort, 1))) {
      return toast("err", "Cổng phải trong khoảng 1–65535 (cổng mở có thể là 0 để tự chọn)");
    }
    const server = useConfig.getState().sessions.find((s) => s.id === sessionId);
    const name = draft.name.trim() || `${KIND_LABEL[draft.kind]} ${draft.bindPort} · ${server?.name || server?.host}`;
    cfg.upsertTunnel({ ...draft, sessionId, name, destHost: draft.destHost.trim(), keyPath: draft.keyPath?.trim() || undefined });
    if (run) void startTunnel(draft.id);
    setServerMode("session");
    setNewAddr("");
    setDraft(blank(sessionId));
  };

  /// Đổi "tự nối lại" khi đang chạy thì chạy lại để áp dụng ngay.
  const toggle = (next: TunnelDef) => {
    const prev = cfg.tunnels.find((x) => x.id === next.id);
    cfg.upsertTunnel(next);
    if (isLive(tunnels[next.id]) && prev?.autoReconnect !== next.autoReconnect) void startTunnel(next.id);
  };

  const sessionKey = sshSessions.find((x) => x.id === draft.sessionId)?.keyPath;
  const serverPicker = (
    <>
      <Seg
        value={serverMode}
        onChange={setServerMode}
        options={[{ value: "session", label: "Session đã lưu" }, { value: "new", label: "Nhập mới" }]}
      />
      {serverMode === "session" ? (
        <Select
          value={draft.sessionId}
          onChange={(v) => patch({ sessionId: v })}
          options={sshSessions.map((s) => ({ value: s.id, label: `${s.name || s.host} · ${s.user ? `${s.user}@` : ""}${s.host}` }))}
        />
      ) : (
        <Field mono value={newAddr} onChange={setNewAddr} placeholder="user@host:port" />
      )}
      <label className="tn-field"><span>Khóa PEM (tuỳ chọn)</span>
        <Field
          mono
          value={draft.keyPath ?? ""}
          onChange={(v) => patch({ keyPath: v })}
          placeholder={serverMode === "session" && sessionKey ? `theo session: ${sessionKey}` : "không dùng"}
          right={
            <IBtn icon="folder" tip="Chọn file .pem / khóa riêng" size="sm" onClick={async () => {
              const path = await pickKeyFile().catch((e) => { toast("err", `Không mở được hộp chọn file: ${e}`); return null; });
              if (path) patch({ keyPath: path });
            }} />
          }
        />
      </label>
      {keys.length > 0 && (
        <div className="tn-keys">
          {keys.map((k) => (
            <button key={k.path} type="button" className={`chip ${draft.keyPath === k.path ? "accent" : ""}`}
              data-tip={k.fingerprint ?? k.path} onClick={() => patch({ keyPath: k.path })}>
              {k.name}
            </button>
          ))}
        </div>
      )}
      <span className="hint">Mật khẩu / passphrase hỏi một lần, lưu trong Keychain.</span>
    </>
  );
  const port = (label: string) => (
    <label className="tn-field"><span>{label}</span>
      <NumField value={draft.bindPort} onChange={(v) => patch({ bindPort: v })} min={0} max={65535} />
    </label>
  );
  const dest = (title: string, hint: string) => (
    <Node icon="layers" title={title}>
      <div style={{ display: "flex", gap: 8 }}>
        <label className="tn-field" style={{ flex: 1 }}><span>Host</span>
          <Field mono value={draft.destHost} onChange={(v) => patch({ destHost: v })} placeholder="db.internal" />
        </label>
        <label className="tn-field" style={{ width: 84 }}><span>Cổng</span>
          <NumField value={draft.destPort} onChange={(v) => patch({ destPort: v })} min={1} max={65535} />
        </label>
      </div>
      <span className="hint">{hint}</span>
    </Node>
  );

  return (
    <div className="tn">
      <div className="tn-head">
        <h1>SSH Tunnels</h1>
        <Chip tone="ok">{running}/{cfg.tunnels.length} đang chạy</Chip>
        <div style={{ flex: 1 }} />
        <Btn small icon="play" disabled={!cfg.tunnels.length} onClick={() => cfg.tunnels.forEach((t) => !isLive(tunnels[t.id]) && void startTunnel(t.id))}>Chạy tất cả</Btn>
        <Btn small icon="stop" disabled={!running} onClick={() => cfg.tunnels.forEach((t) => void stopTunnel(t.id))}>Dừng tất cả</Btn>
        <IBtn icon="x" tip="Đóng" onClick={() => setSide("tunnels")} />
      </div>

      <div className="tn-form">
        <div className="tn-row">
          <b>{editing ? "Sửa tunnel" : "Tunnel mới"}</b>
          <Seg
            value={draft.kind}
            onChange={(v) => patch({ kind: v })}
            options={(Object.keys(KIND_LABEL) as Kind[]).map((k) => ({ value: k, label: `${KIND_LABEL[k]} (-${k === "local" ? "L" : k === "remote" ? "R" : "D"})` }))}
          />
          <span className="hint">{KIND_HINT[draft.kind]}</span>
        </div>

        <div className="tn-diagram">
          {draft.kind === "remote" ? (
            <>
              <Node icon="server" title="SSH server" strong>
                {serverPicker}
                {port("Cổng mở trên server")}
              </Node>
              <Arrow label="qua SSH" />
              <Node icon="monitor" title="Máy bạn"><span className="hint">App nhận kết nối và chuyển tiếp.</span></Node>
              <Arrow label="mạng của bạn" />
              {dest("Máy đích", "Nhìn từ máy bạn: localhost = chính máy này.")}
            </>
          ) : (
            <>
              <Node icon="monitor" title="Máy bạn">
                {port(draft.kind === "dynamic" ? "Cổng SOCKS5" : "Cổng mở")}
                <span className="hint mono">localhost:{draft.bindPort || "tự chọn"}</span>
              </Node>
              <Arrow label="mã hoá SSH" />
              <Node icon="server" title="SSH server" strong>{serverPicker}</Node>
              <Arrow label={draft.kind === "dynamic" ? "ra Internet" : "mạng nội bộ"} />
              {draft.kind === "dynamic"
                ? <Node icon="globe" title="Mọi đích"><span className="hint">Trình duyệt / app đặt proxy SOCKS5 tới cổng trên.</span></Node>
                : dest("Máy đích", "Nhìn từ server: localhost = chính SSH server.")}
            </>
          )}
        </div>

        <div className="tn-row" style={{ flexWrap: "wrap" }}>
          <label className="tn-inline"><span>Tên</span>
            <Field value={draft.name} onChange={(v) => patch({ name: v })} placeholder="tự đặt nếu trống" width={190} />
          </label>
          {draft.kind === "local" && PRESETS.map((p) => (
            <Btn small key={p.name} onClick={() => patch({ name: p.name, bindPort: p.port, destPort: p.port })}>{p.name}</Btn>
          ))}
          <div style={{ flex: 1 }} />
          <Switch
            checked={draft.bindHost === "0.0.0.0"} onChange={(v) => patch({ bindHost: v ? "0.0.0.0" : "127.0.0.1" })}
            label="Mở cho mạng ngoài" tip="Bind 0.0.0.0: máy khác trong mạng dùng được cổng này"
          />
          <Switch checked={draft.autoStart} onChange={(v) => patch({ autoStart: v })} label="Tự bật" tip="Chạy ngay khi mở app" />
          <Switch checked={draft.autoReconnect} onChange={(v) => patch({ autoReconnect: v })} label="Tự nối lại" tip="Rớt mạng thì tự nối lại, không giới hạn số lần" />
          {editing && <Btn small variant="ghost" onClick={reset}>Hủy</Btn>}
          <Btn small onClick={() => save(false)}>Lưu</Btn>
          <Btn small variant="primary" icon="play" onClick={() => save(true)}>Lưu &amp; chạy</Btn>
        </div>
      </div>

      {cfg.tunnels.length > 0 && (
        <div className="tn-table">
          <table>
            <thead>
              <tr>
                <th aria-label="Chạy" />
                <th>Tên</th><th>Loại</th><th>Cổng mở</th><th>Đích</th><th>SSH server</th><th>Trạng thái</th>
                <th className="c">Tự bật</th><th className="c">Tự nối lại</th>
                <th aria-label="Thao tác" />
              </tr>
            </thead>
            <tbody>
              {cfg.tunnels.map((t) => {
                const live = tunnels[t.id];
                const st = live ? STATE[live.state] : null;
                const s = cfg.sessions.find((x) => x.id === t.sessionId);
                const shownPort = live?.port ?? t.bindPort;
                const tunnelAsks = asks.filter((a) => a.payload.connId === tunnelConnId(t.id));
                return [
                  <tr key={t.id} className={draft.id === t.id ? "sel" : ""}>
                    <td>
                      {isLive(live)
                        ? <IBtn icon="stop" tip="Dừng" size="sm" onClick={() => void stopTunnel(t.id)} />
                        : <IBtn icon="play" tip="Chạy" size="sm" disabled={!s} onClick={() => void startTunnel(t.id)} />}
                    </td>
                    <td className="nm">{t.name}</td>
                    <td>{KIND_LABEL[t.kind]}</td>
                    <td className="mono">
                      {endpoint(t.bindHost, shownPort)}
                      <IBtn icon="copy" tip="Copy địa chỉ" size="sm" onClick={() => {
                        void navigator.clipboard.writeText(endpoint(t.bindHost === "0.0.0.0" ? "localhost" : t.bindHost, shownPort));
                        toast("ok", "Đã copy");
                      }} />
                    </td>
                    <td className="mono dim">{t.kind === "dynamic" ? "—" : endpoint(t.destHost, t.destPort)}</td>
                    <td className="dim">
                      <span className="tn-state">
                        {s ? s.name || s.host : "Session đã bị xóa"}
                        {t.keyPath && <span data-tip={t.keyPath} style={{ display: "grid" }}><Icon n="key" s={12} /></span>}
                      </span>
                    </td>
                    <td>
                      <span className="tn-state" style={{ color: st?.color ?? "var(--text-3)" }} data-tip={live?.detail}>
                        <span className="led" style={{ background: st?.color }} />{st ? st.text(live!) : "Tắt"}
                      </span>
                    </td>
                    <td className="c"><Switch checked={t.autoStart} onChange={(v) => toggle({ ...t, autoStart: v })} tip="Chạy ngay khi mở app" /></td>
                    <td className="c"><Switch checked={t.autoReconnect} onChange={(v) => toggle({ ...t, autoReconnect: v })} tip="Rớt mạng thì tự nối lại" /></td>
                    <td>
                      <span style={{ display: "flex" }}>
                        <IBtn icon="edit" tip={isLive(live) ? "Dừng tunnel trước khi sửa" : "Sửa"} size="sm" disabled={isLive(live)} onClick={() => { setServerMode("session"); setDraft(t); }} />
                        <IBtn icon="trash" tip="Xóa" size="sm" danger onClick={(e) => pop.open(e, t)} />
                      </span>
                    </td>
                  </tr>,
                  ...tunnelAsks.map((a) => (
                    <tr key={a.askId}><td colSpan={10} className="ask"><AskBar ask={a} /></td></tr>
                  )),
                ];
              })}
            </tbody>
          </table>
        </div>
      )}

      {pop.state && (
        <Popover anchor={pop.state.anchor} onClose={pop.close}>
          <Confirm
            message={`Xóa tunnel “${pop.state.data.name}”?`}
            onClose={pop.close}
            onConfirm={() => {
              void stopTunnel(pop.state!.data.id);
              cfg.removeTunnel(pop.state!.data.id);
            }}
          />
        </Popover>
      )}
    </div>
  );
}

function Node({ icon, title, strong, children }: { icon: string; title: string; strong?: boolean; children: ReactNode }) {
  return (
    <div className={`tn-node ${strong ? "strong" : ""}`}>
      <div className="tn-node-title"><Icon n={icon} s={18} /><b>{title}</b></div>
      {children}
    </div>
  );
}

function Arrow({ label }: { label: string }) {
  return (
    <div className="tn-arrow" aria-hidden="true">
      <svg viewBox="0 0 48 24" width="40" height="20"><path d="M2 12h42M36 5l8 7-8 7" /></svg>
      <span>{label}</span>
    </div>
  );
}
