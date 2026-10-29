import { useEffect, useState } from "react";
import * as ipc from "@/lib/ipc";
import { STAGE_META, parseAddress, withKey } from "@/lib/kinds";
import type { AuthMethod, LocalKey, SerialPortInfo, Session, SessionKind, Stage } from "@/lib/types";
import { useApp } from "@/store/app";
import { useConfig } from "@/store/config";
import { Icon } from "../ui/Icon";
import { Btn, Chip, Field, Group, IBtn, NumField, Row, Seg, Select, Switch } from "../ui/primitives";

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

/// Ba lựa chọn dễ hiểu thay cho việc tự xếp thứ tự phương thức.
const AUTH_MODES: { value: string; label: string; auth: AuthMethod[] }[] = [
  { value: "auto", label: "Tự động", auth: ["agent", "key", "password", "interactive"] },
  { value: "password", label: "Mật khẩu", auth: ["password", "interactive"] },
  { value: "key", label: "Khóa SSH", auth: ["key", "agent"] },
];
const authMode = (auth: AuthMethod[]) =>
  AUTH_MODES.find((m) => m.auth.join() === auth.join())?.value ?? "auto";

const DEFAULT_PORT: Record<SessionKind, number> = {
  ssh: 22, local: 0, telnet: 23, serial: 0, mosh: 22, rdp: 3389, vnc: 5900,
};

export function SessionEditor({ session, isNew }: { session: Session; isNew: boolean }) {
  const cfg = useConfig();
  const { setEditing, openSession, toast, pendingFolder, setTunnelsOpen, tunnels: liveTunnels } = useApp();
  const [s, setS] = useState<Session>(() =>
    isNew ? { ...session, folderId: pendingFolder ?? session.folderId } : session,
  );
  const [password, setPassword] = useState("");
  const [passphrase, setPassphrase] = useState("");
  /// `error` = không đọc được keychain → tuyệt đối không ghi đè bí mật đã lưu.
  const [secretState, setSecretState] = useState<"loading" | "ok" | "error">(
    isNew ? "ok" : "loading",
  );
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
    void Promise.all([ipc.secretGet(`pw:${s.id}`), ipc.secretGet(`pp:${s.id}`)])
      .then(([pw, pp]) => {
        if (pw) setPassword(pw);
        if (pp) setPassphrase(pp);
        setSecretState("ok");
      })
      .catch(() => setSecretState("error"));
    // Chỉ nạp một lần cho session đang mở.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.id]);

  const isNet = ["ssh", "telnet", "mosh", "rdp", "vnc"].includes(s.kind);
  const isSsh = s.kind === "ssh";
  const isMosh = s.kind === "mosh";

  const save = async (): Promise<Session | null> => {
    if (isNet && !s.host.trim()) {
      toast("err", "Cần nhập host");
      return null;
    }
    if (secretState === "loading") {
      toast("warn", "Đang đọc keychain, vui lòng chờ");
      return null;
    }
    // Không đọc được keychain thì giữ nguyên bí mật cũ, đừng xoá nhầm.
    const keepStored = secretState === "error";
    // Dán cả `user@host:port` vào ô Host thì tách khi lưu.
    const addr = s.host.includes("@") || /:\d+$/.test(s.host) ? parseAddress(s.host) : null;
    const host = addr?.host ?? s.host.trim();
    const out: Session = {
      ...s,
      host,
      user: addr?.user || s.user,
      name: s.name.trim() || (s.kind === "local" ? "Shell" : host),
      port: addr?.port ?? (s.port || DEFAULT_PORT[s.kind]),
    };

    // Ghi bí mật trước: nếu keychain lỗi thì không lưu gì cả, để trạng thái
    // không rơi vào cảnh "session đã lưu nhưng mật khẩu thì không".
    if (!keepStored) {
      const write = async (key: string, value: string) => {
        if (value) await ipc.secretSet(key, value);
        // Session mới thì chưa có gì để xoá.
        else if (!isNew) await ipc.secretDelete(key);
      };
      try {
        await write(`pw:${out.id}`, password.trim());
        await write(`pp:${out.id}`, passphrase);
      } catch (e) {
        // Nuốt lỗi ở đây chính là lý do "đã lưu mà vẫn hỏi mật khẩu".
        toast("err", `Không lưu được vào keychain: ${e}`);
        return null;
      }
    }

    cfg.upsertSession(out);
    return out;
  };

  const selectKey = (path: string) => setS((prev) => withKey(prev, path));

  const pickFile = async (kind: "key" | "dir") => {
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const res = await open({
        title: kind === "key" ? "Chọn file PEM / khóa riêng SSH" : "Chọn thư mục",
        directory: kind === "dir", multiple: false,
      });
      if (typeof res === "string") kind === "key" ? selectKey(res) : set("cwd", res);
    } catch (e) {
      toast("err", `Không mở được hộp chọn file: ${e}`);
    }
  };

  const jumpCandidates = cfg.sessions.filter((x) => x.id !== s.id && x.kind === "ssh");
  const jump = jumpCandidates.find((j) => j.id === s.jumpId);
  const ownTunnels = cfg.tunnels.filter((t) => t.sessionId === s.id);


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
                <Row label="Host" tip="Dán cả user@host:port, khi lưu app tự tách">
                  <Field value={s.host} onChange={(v) => set("host", v)} placeholder="host, IP hoặc user@host:port" mono />
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
            <Row label="Môi trường" stack tip="Tô màu viền tab để không gõ nhầm vào máy production">
              <Seg
                value={s.stage ?? ""}
                onChange={(v) => set("stage", (v || undefined) as Stage | undefined)}
                options={[
                  ...(Object.keys(STAGE_META) as Stage[]).map((k) => ({ value: k, label: STAGE_META[k].label })),
                  { value: "", label: "không" },
                ]}
              />
            </Row>
          </Group>

          {isSsh && (
            <Group title="Xác thực" icon="key">
              <Row label="Đăng nhập" stack>
                <Seg
                  value={authMode(s.auth)}
                  onChange={(v) => set("auth", AUTH_MODES.find((m) => m.value === v)!.auth)}
                  options={AUTH_MODES.map((m) => ({ value: m.value, label: m.label }))}
                />
              </Row>
              <Row label="">
                <span className="hint">
                  {authMode(s.auth) === "auto"
                    ? "Thử ssh-agent, khóa, rồi mật khẩu. Hỏi khi cần và nhớ trong Keychain."
                    : authMode(s.auth) === "key" ? "Dùng file khóa riêng (.pem hoặc OpenSSH) bên dưới." : "Hỏi mật khẩu lần đầu, sau đó dùng bản trong Keychain."}
                </span>
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
                            onClick={() => selectKey(k.path)}
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
                      placeholder="để trống nếu khóa không mã hoá"
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
                      placeholder={secretState === "loading" ? "đang đọc keychain…" : "để trống = hỏi mỗi lần"}
                      right={<IBtn icon={showPw ? "eyeOff" : "eye"} tip="Hiện/ẩn" size="sm" onClick={() => setShowPw((v) => !v)} />}
                    />
                  </Row>
                  <Row label="">
                    {password
                      ? <span className="hint" style={{ color: "var(--ok)" }}>✓ Đã lưu trong Keychain, không nằm trong file cấu hình.</span>
                      : <span className="hint">Để trống = hỏi khi kết nối rồi lưu vào Keychain.</span>}
                  </Row>
                </>
              )}

            </Group>
          )}

          {isSsh && (
            <Group
              title="Nâng cao" icon="settings"
              actions={<IBtn icon={advanced ? "chevronUp" : "chevronDown"} tip={advanced ? "Thu gọn" : "Mở rộng"} size="sm" onClick={() => setAdvanced((v) => !v)} />}
            >
              {!advanced && (
                <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
                  {jump && <Chip tone="accent">qua {jump.name || jump.host}</Chip>}
                  {s.x11 && <Chip tone="accent">X11</Chip>}
                  {s.agentForward && <Chip tone="accent">agent fwd</Chip>}
                  {s.compression && <Chip tone="accent">nén</Chip>}
                  {s.strictHostKey && <Chip tone="warn">strict host key</Chip>}
                  {s.logToFile && <Chip>ghi log</Chip>}
                  {s.initCommands.length > 0 && <Chip>{s.initCommands.length} lệnh đầu</Chip>}
                  {!jump && !s.x11 && !s.agentForward && !s.compression && !s.strictHostKey && !s.logToFile && !s.initCommands.length && (
                    <span className="hint">Đang dùng mặc định</span>
                  )}
                </div>
              )}
              {advanced && (
                <>
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

          {isSsh && !isNew && (
            <Group
              title="Tunnel" icon="plug"
              actions={<IBtn icon="plus" tip="Thêm tunnel" size="sm" onClick={() => setTunnelsOpen(true)} />}
            >
              {ownTunnels.length === 0 && <span className="hint">Chưa có tunnel nào qua session này.</span>}
              {ownTunnels.map((t) => (
                <button key={t.id} type="button" className="home-row" onClick={() => setTunnelsOpen(true)}>
                  <span className="led" style={liveTunnels[t.id]?.state === "running" ? { background: "var(--ok)" } : undefined} />
                  <span className="main t1">{t.name}</span>
                  <span className="hint mono">{t.bindPort} → {t.kind === "dynamic" ? "SOCKS5" : t.destPort}</span>
                </button>
              ))}
            </Group>
          )}

          <Group title="Ghi chú" icon="tag">
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
