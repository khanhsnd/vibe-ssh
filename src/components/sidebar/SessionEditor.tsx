import { useEffect, useState } from "react";
import * as ipc from "@/lib/ipc";
import type { AuthMethod, LocalKey, SerialPortInfo, Session, SessionKind } from "@/lib/types";
import { useApp } from "@/store/app";
import { useConfig } from "@/store/config";
import { Icon } from "../ui/Icon";
import { Btn, Chip, Field, Group, IBtn, NumField, Row, Select, Switch } from "../ui/primitives";

const KINDS: { value: SessionKind; label: string; icon: string }[] = [
  { value: "ssh", label: "SSH", icon: "server" },
  { value: "local", label: "Shell", icon: "terminal" },
  { value: "telnet", label: "Telnet", icon: "wifi" },
  { value: "serial", label: "Serial", icon: "cpu" },
  { value: "mosh", label: "Mosh", icon: "bolt" },
  { value: "rdp", label: "RDP", icon: "monitor" },
  { value: "vnc", label: "VNC", icon: "eye" },
];

const BAUDS = [9600, 19200, 38400, 57600, 115200, 230400, 460800, 921600];

const AUTHS: { value: AuthMethod; label: string; tip: string }[] = [
  { value: "agent", label: "agent", tip: "ssh-agent đang chạy trên máy" },
  { value: "key", label: "khóa", tip: "khóa riêng chỉ định bên dưới" },
  { value: "password", label: "mật khẩu", tip: "mật khẩu (hỏi khi kết nối nếu không lưu)" },
  { value: "interactive", label: "tương tác", tip: "keyboard-interactive, ví dụ OTP/2FA" },
];

const DEFAULT_PORT: Record<SessionKind, number> = {
  ssh: 22, local: 0, telnet: 23, serial: 0, mosh: 22, rdp: 3389, vnc: 5900,
};

export function SessionEditor({ session, isNew }: { session: Session; isNew: boolean }) {
  const cfg = useConfig();
  const { setEditing, openSession, toast, pendingFolder } = useApp();
  const [s, setS] = useState<Session>(() =>
    isNew ? { ...session, folderId: pendingFolder ?? session.folderId } : session,
  );
  const [password, setPassword] = useState("");
  const [passphrase, setPassphrase] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [keys, setKeys] = useState<LocalKey[]>([]);
  const [advanced, setAdvanced] = useState(false);
  const [display, setDisplay] = useState<string | null | undefined>(undefined);

  const set = <K extends keyof Session>(k: K, v: Session[K]) => setS((p) => ({ ...p, [k]: v }));

  useEffect(() => { void ipc.localKeys().then(setKeys).catch(() => setKeys([])); }, []);
  useEffect(() => {
    if (s.x11 && display === undefined) void ipc.readEnv("DISPLAY").then(setDisplay).catch(() => setDisplay(null));
  }, [s.x11, display]);
  useEffect(() => {
    if (isNew) return;
    void ipc.secretGet(`pw:${s.id}`).then((v) => v && setPassword(v)).catch(() => {});
    void ipc.secretGet(`pp:${s.id}`).then((v) => v && setPassphrase(v)).catch(() => {});
    // Chỉ nạp một lần cho session đang mở.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.id]);

  const isNet = ["ssh", "telnet", "mosh", "rdp", "vnc"].includes(s.kind);
  const isSsh = s.kind === "ssh";
  const isMosh = s.kind === "mosh";

  const save = async (): Promise<Session | null> => {
    const name = s.name.trim() || (s.kind === "local" ? "Shell" : s.host.trim());
    if (isNet && !s.host.trim()) {
      toast("err", "Cần nhập host");
      return null;
    }
    const out: Session = { ...s, name, port: s.port || DEFAULT_PORT[s.kind] };
    cfg.upsertSession(out);
    if (out.savePassword && password) await ipc.secretSet(`pw:${out.id}`, password).catch(() => {});
    if (!out.savePassword) await ipc.secretDelete(`pw:${out.id}`).catch(() => {});
    if (passphrase) await ipc.secretSet(`pp:${out.id}`, passphrase).catch(() => {});
    return out;
  };

  const pickFile = async (kind: "key" | "dir") => {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const res = await open({ directory: kind === "dir", multiple: false }).catch(() => null);
    if (typeof res === "string") kind === "key" ? set("keyPath", res) : set("cwd", res);
  };

  const toggleAuth = (m: AuthMethod) => {
    const has = s.auth.includes(m);
    const next = has ? s.auth.filter((x) => x !== m) : [...AUTHS.map((a) => a.value).filter((v) => s.auth.includes(v) || v === m)];
    set("auth", next.length ? next : ["password"]);
  };

  const jumpCandidates = cfg.sessions.filter((x) => x.id !== s.id && x.kind === "ssh");

  return (
    <>
      <div className="side-head">
        <IBtn icon="chevronLeft" tip="Quay lại danh sách" size="sm" onClick={() => setEditing(null)} />
        <span className="side-title">{isNew ? "Session mới" : "Sửa session"}</span>
        <IBtn
          icon="play" tip="Lưu & kết nối" size="sm"
          onClick={async () => {
            const out = await save();
            if (out) { setEditing(null); void openSession(out.id); }
          }}
        />
        <IBtn icon="save" tip="Lưu" size="sm" onClick={async () => { if (await save()) setEditing(null); }} />
      </div>

      <div className="side-body">
        <div className="editor">
          <Group title="Cơ bản" icon="info">
            <Row label="Tên">
              <Field value={s.name} onChange={(v) => set("name", v)} placeholder="ví dụ: prod-web-01" />
            </Row>
            <Row label="Loại">
              <div className="seg-ctl" style={{ flex: 1 }}>
                {KINDS.map((k) => (
                  <button
                    key={k.value}
                    type="button"
                    className={s.kind === k.value ? "on" : ""}
                    data-tip={k.label}
                    onClick={() => {
                      set("kind", k.value);
                      if (!s.port || s.port === DEFAULT_PORT[s.kind]) set("port", DEFAULT_PORT[k.value]);
                    }}
                  >
                    <Icon n={k.icon} s={12} />
                  </button>
                ))}
              </div>
            </Row>
            {isNet && (
              <>
                <Row label="Host">
                  <Field value={s.host} onChange={(v) => set("host", v)} placeholder="host hoặc IP" mono />
                  <NumField value={s.port} onChange={(v) => set("port", v)} min={1} max={65535} width={70} />
                </Row>
                {(isSsh || isMosh || s.kind === "telnet") && (
                  <Row label="User">
                    <Field value={s.user} onChange={(v) => set("user", v)} placeholder="tên đăng nhập" mono />
                  </Row>
                )}
              </>
            )}
            {s.kind === "serial" && <SerialFields s={s} set={set} />}
            {isMosh && (
              <Row label="">
                <span className="hint">
                  Dùng <span className="mono">mosh</span> cài trên máy; khóa và cổng ở trên được
                  truyền qua <span className="mono">--ssh</span>.
                </span>
              </Row>
            )}
            {s.kind === "local" && (
              <>
                <Row label="Shell">
                  <Field value={s.shell ?? ""} onChange={(v) => set("shell", v)} placeholder="mặc định của hệ thống" mono />
                </Row>
                <Row label="Thư mục">
                  <Field value={s.cwd ?? ""} onChange={(v) => set("cwd", v)} placeholder="~" mono />
                  <IBtn icon="folder" tip="Chọn thư mục" onClick={() => void pickFile("dir")} />
                </Row>
              </>
            )}
            <Row label="Thư mục">
              <Select
                value={s.folderId ?? ""}
                onChange={(v) => set("folderId", v || null)}
                options={[{ value: "", label: "— gốc —" }, ...cfg.folders.map((f) => ({ value: f.id, label: f.name }))]}
              />
            </Row>
          </Group>

          {isSsh && (
            <Group title="Xác thực" icon="key">
              <Row label="Thứ tự thử" stack tip="Thử lần lượt từ trên xuống, dừng khi thành công">
                <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
                  {AUTHS.map((a) => {
                    const i = s.auth.indexOf(a.value);
                    return (
                      <button
                        key={a.value}
                        type="button"
                        className="chip"
                        data-tip={a.tip}
                        style={
                          i >= 0
                            ? { background: "var(--accent-bg)", borderColor: "color-mix(in srgb, var(--accent) 42%, transparent)", color: "var(--accent)" }
                            : undefined
                        }
                        onClick={() => toggleAuth(a.value)}
                      >
                        {i >= 0 ? `${i + 1}. ` : ""}{a.label}
                      </button>
                    );
                  })}
                </div>
              </Row>

              {s.auth.includes("key") && (
                <>
                  <Row label="Khóa riêng">
                    <Field value={s.keyPath ?? ""} onChange={(v) => set("keyPath", v)} placeholder="~/.ssh/id_ed25519" mono />
                    <IBtn icon="folder" tip="Chọn file khóa" onClick={() => void pickFile("key")} />
                  </Row>
                  {keys.length > 0 && (
                    <Row label="">
                      <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
                        {keys.map((k) => (
                          <button
                            key={k.path}
                            type="button"
                            className="chip"
                            data-tip={k.fingerprint ?? k.path}
                            onClick={() => set("keyPath", k.path)}
                          >
                            {k.name}
                          </button>
                        ))}
                      </div>
                    </Row>
                  )}
                  <Row label="Passphrase">
                    <Field
                      value={passphrase} onChange={setPassphrase}
                      type={showPw ? "text" : "password"}
                      placeholder="để trống nếu khóa không mã hóa"
                      right={<IBtn icon={showPw ? "eyeOff" : "eye"} tip="Hiện/ẩn" size="sm" onClick={() => setShowPw((v) => !v)} />}
                    />
                  </Row>
                </>
              )}

              {s.auth.includes("password") && (
                <>
                  <Row label="Mật khẩu">
                    <Field
                      value={password} onChange={setPassword}
                      type={showPw ? "text" : "password"}
                      placeholder="hỏi khi kết nối nếu để trống"
                      right={<IBtn icon={showPw ? "eyeOff" : "eye"} tip="Hiện/ẩn" size="sm" onClick={() => setShowPw((v) => !v)} />}
                    />
                  </Row>
                  <Row label="">
                    <Switch
                      checked={s.savePassword}
                      onChange={(v) => set("savePassword", v)}
                      label="Lưu vào keychain hệ thống"
                      tip="macOS Keychain / Windows Credential Manager — không nằm trong file cấu hình"
                    />
                  </Row>
                </>
              )}

              <Row label="Bastion" tip="Kết nối gián tiếp qua session khác (ProxyJump)">
                <Select
                  value={s.jumpId ?? ""}
                  onChange={(v) => set("jumpId", v || null)}
                  options={[
                    { value: "", label: "— trực tiếp —" },
                    ...jumpCandidates.map((j) => ({ value: j.id, label: j.name || `${j.user}@${j.host}` })),
                  ]}
                />
              </Row>
            </Group>
          )}

          {isSsh && (
            <Group
              title="Nâng cao" icon="settings"
              actions={<IBtn icon={advanced ? "chevronUp" : "chevronDown"} tip={advanced ? "Thu gọn" : "Mở rộng"} size="sm" onClick={() => setAdvanced((v) => !v)} />}
            >
              {!advanced && (
                <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
                  {s.x11 && <Chip tone="accent">X11</Chip>}
                  {s.agentForward && <Chip tone="accent">agent fwd</Chip>}
                  {s.compression && <Chip tone="accent">nén</Chip>}
                  {s.strictHostKey && <Chip tone="warn">strict host key</Chip>}
                  {s.logToFile && <Chip>ghi log</Chip>}
                  {s.initCommands.length > 0 && <Chip>{s.initCommands.length} lệnh đầu</Chip>}
                  {!s.x11 && !s.agentForward && !s.compression && !s.strictHostKey && !s.logToFile && !s.initCommands.length && (
                    <span className="hint">Đang dùng mặc định</span>
                  )}
                </div>
              )}
              {advanced && (
                <>
                  <Row label="">
                    <Switch checked={s.x11} onChange={(v) => set("x11", v)} label="X11 forwarding"
                      tip="Cần X server cục bộ đang chạy (XQuartz trên macOS, VcXsrv trên Windows)" />
                  </Row>
                  {s.x11 && (
                    <Row label="">
                      {display
                        ? <span className="hint">X server: <span className="mono">{display}</span></span>
                        : <span className="hint warn">Chưa thấy biến DISPLAY — hãy chạy XQuartz (macOS) hoặc VcXsrv (Windows) trước khi kết nối.</span>}
                    </Row>
                  )}
                  <Row label="">
                    <Switch checked={s.agentForward} onChange={(v) => set("agentForward", v)} label="Agent forwarding"
                      tip="Cho phép máy đích dùng ssh-agent của bạn" />
                  </Row>
                  <Row label="">
                    <Switch checked={s.compression} onChange={(v) => set("compression", v)} label="Nén dữ liệu (zlib)" />
                  </Row>
                  <Row label="">
                    <Switch checked={s.strictHostKey} onChange={(v) => set("strictHostKey", v)} label="Từ chối host key lạ"
                      tip="Bật để không bao giờ được hỏi chấp nhận khóa mới" />
                  </Row>
                  <Row label="">
                    <Switch checked={s.logToFile} onChange={(v) => set("logToFile", v)} label="Ghi log phiên ra file" />
                  </Row>
                  <Row label="Keepalive">
                    <NumField value={s.keepalive} onChange={(v) => set("keepalive", v)} min={0} max={3600} width={72} />
                    <span className="hint">giây · 0 = tắt</span>
                  </Row>
                  <Row label="TERM">
                    <Field value={s.term} onChange={(v) => set("term", v)} mono />
                  </Row>
                  <Row label="Lệnh đầu" stack tip="Gửi vào shell ngay sau khi kết nối, mỗi dòng một lệnh">
                    <textarea
                      value={s.initCommands.join("\n")}
                      onChange={(e) => set("initCommands", e.target.value.split("\n"))}
                className="ta"
                rows={3}
                spellCheck={false}
                    />
                  </Row>
                  <Row label="Biến môi trường" stack>
                    <EnvEditor value={s.env} onChange={(v) => set("env", v)} />
                  </Row>
                </>
              )}
            </Group>
          )}

          <Group title="Ghi chú & màu" icon="tag">
            <Row label="Màu tab">
              <div style={{ display: "flex", gap: 5 }}>
                {["", "#58a6ff", "#3fb950", "#e3b341", "#ff7b72", "#d2a8ff"].map((c) => (
                  <button
                    key={c || "none"}
                    type="button"
                    data-tip={c || "không màu"}
                    onClick={() => set("color", c || undefined)}
                    style={{
                      width: 20, height: 20, borderRadius: 5, cursor: "default",
                      background: c || "transparent",
                      border: `1px solid ${s.color === c || (!s.color && !c) ? "var(--text)" : "var(--border-strong)"}`,
                    }}
                  />
                ))}
              </div>
            </Row>
            <Row label="Ghi chú" stack>
              <Field value={s.note ?? ""} onChange={(v) => set("note", v)} placeholder="tuỳ chọn" />
            </Row>
          </Group>
        </div>
      </div>

      <div className="side-foot" style={{ display: "flex", gap: 6 }}>
        <Btn variant="primary" icon="play" small
          onClick={async () => { const out = await save(); if (out) { setEditing(null); void openSession(out.id); } }}>
          Lưu & kết nối
        </Btn>
        <Btn icon="save" small onClick={async () => { if (await save()) setEditing(null); }}>Lưu</Btn>
        <div style={{ flex: 1 }} />
        <Btn variant="ghost" small onClick={() => setEditing(null)}>Hủy</Btn>
      </div>
    </>
  );
}

function SerialFields({
  s, set,
}: {
  s: Session;
  set: <K extends keyof Session>(k: K, v: Session[K]) => void;
}) {
  const [ports, setPorts] = useState<SerialPortInfo[]>([]);
  const [err, setErr] = useState("");

  const reload = () => {
    void ipc
      .serialPorts()
      .then(setPorts)
      .catch((e) => setErr(String(e)));
  };
  useEffect(reload, []);

  return (
    <>
      <Row label="Cổng">
        <Field mono value={s.serialPath ?? ""} onChange={(v) => set("serialPath", v)}
          placeholder="/dev/tty.usbserial hoặc COM3" />
        <IBtn icon="refresh" tip="Quét lại cổng" onClick={reload} />
      </Row>
      {ports.length > 0 && (
        <Row label="">
          <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
            {ports.map((p) => (
              <button key={p.name} type="button" className="chip"
                data-tip={`${p.kind}${p.label ? ` · ${p.label}` : ""}`}
                onClick={() => set("serialPath", p.name)}>
                {p.name.replace(/^\/dev\//, "")}
              </button>
            ))}
          </div>
        </Row>
      )}
      {ports.length === 0 && (
        <Row label="">
          <span className="hint" data-tip={err || undefined}>
            {err ? "Không đọc được danh sách cổng serial" : "Không thấy cổng serial nào."}
          </span>
        </Row>
      )}
      <Row label="Baud">
        <Select
          value={String(s.baud ?? 115200)}
          onChange={(v) => set("baud", Number(v))}
          options={BAUDS.map((b) => ({ value: String(b), label: String(b) }))}
        />
      </Row>
      <Row label="Khung" tip="Số bit dữ liệu · parity · số bit stop">
        <Select value={String(s.dataBits ?? 8)} onChange={(v) => set("dataBits", Number(v) as 8)}
          options={[5, 6, 7, 8].map((n) => ({ value: String(n), label: `${n} bit` }))} width={76} />
        <Select value={s.parity ?? "none"} onChange={(v) => set("parity", v as "none")}
          options={[
            { value: "none", label: "none" },
            { value: "odd", label: "odd" },
            { value: "even", label: "even" },
          ]} width={82} />
        <Select value={String(s.stopBits ?? 1)} onChange={(v) => set("stopBits", Number(v) as 1)}
          options={[{ value: "1", label: "1 stop" }, { value: "2", label: "2 stop" }]} width={82} />
      </Row>
      <Row label="Flow">
        <Select value={s.flow ?? "none"} onChange={(v) => set("flow", v as "none")}
          options={[
            { value: "none", label: "không" },
            { value: "hardware", label: "RTS/CTS" },
            { value: "software", label: "XON/XOFF" },
          ]} />
      </Row>
    </>
  );
}

function EnvEditor({
  value, onChange,
}: {
  value: [string, string][];
  onChange: (v: [string, string][]) => void;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
      {value.map(([k, v], i) => (
        <div key={i} style={{ display: "flex", gap: 5 }}>
          <Field small mono value={k} onChange={(nv) => onChange(value.map((p, j) => (j === i ? [nv, p[1]] : p)))} placeholder="TÊN" />
          <Field small mono value={v} onChange={(nv) => onChange(value.map((p, j) => (j === i ? [p[0], nv] : p)))} placeholder="giá trị" />
          <IBtn icon="minus" tip="Bỏ" size="sm" onClick={() => onChange(value.filter((_, j) => j !== i))} />
        </div>
      ))}
      <Btn small icon="plus" variant="ghost" onClick={() => onChange([...value, ["", ""]])}>Thêm biến</Btn>
    </div>
  );
}
