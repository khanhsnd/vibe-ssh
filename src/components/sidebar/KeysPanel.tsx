import { useCallback, useEffect, useState } from "react";
import * as ipc from "@/lib/ipc";
import type { KnownHost, LocalKey } from "@/lib/types";
import { useApp } from "@/store/app";
import { Icon } from "../ui/Icon";
import { Confirm, Popover, usePopover } from "../ui/Popover";
import { Btn, Chip, Field, IBtn } from "../ui/primitives";

export function KeysPanel() {
  const toast = useApp((s) => s.toast);
  const [keys, setKeys] = useState<LocalKey[]>([]);
  const [hosts, setHosts] = useState<KnownHost[]>([]);
  const [q, setQ] = useState("");
  const pop = usePopover<KnownHost>();

  const reload = useCallback(async () => {
    setKeys(await ipc.localKeys().catch(() => []));
    setHosts(await ipc.hostkeysList().catch(() => []));
  }, []);

  useEffect(() => { void reload(); }, [reload]);

  const needle = q.trim().toLowerCase();
  const shownHosts = needle ? hosts.filter((h) => h.host.toLowerCase().includes(needle)) : hosts;

  const copy = (text: string, what: string) => {
    void navigator.clipboard.writeText(text);
    toast("ok", `Đã copy ${what}`);
  };

  return (
    <>
      <div className="side-head">
        <span className="side-title">Khóa & host key</span>
        <IBtn icon="refresh" tip="Tải lại" size="sm" onClick={() => void reload()} />
      </div>

      <div className="side-body">
        <div className="grp">
          <div className="grp-title">
            <Icon n="key" s={12} />
            <span style={{ flex: 1 }}>Khóa riêng trong ~/.ssh</span>
            <Chip>{keys.length}</Chip>
          </div>
          {keys.length === 0 && <div className="hint">Không tìm thấy khóa nào.</div>}
          <div className="list" style={{ margin: "0 -12px" }}>
            {keys.map((k) => (
              <div key={k.path} className="list-item">
                <span style={{ color: "var(--accent)", display: "grid" }}><Icon n="key" s={14} /></span>
                <div className="main">
                  <div className="t1">{k.name}</div>
                  <div className="t2">{k.fingerprint ?? k.algo}{k.comment ? ` · ${k.comment}` : ""}</div>
                </div>
                {!k.hasPublic && <Chip tone="warn">thiếu .pub</Chip>}
                <IBtn icon="copy" tip="Copy đường dẫn" size="sm" onClick={() => copy(k.path, "đường dẫn khóa")} />
              </div>
            ))}
          </div>
        </div>

        <div className="grp">
          <div className="grp-title">
            <Icon n="shield" s={12} />
            <span style={{ flex: 1 }}>Host key đã tin</span>
            <Chip>{hosts.length}</Chip>
          </div>
          <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
            <Field icon="search" small value={q} onChange={setQ} placeholder="Tìm host…" />
            <Btn
              small icon="download" tip="Đọc các dòng không băm trong ~/.ssh/known_hosts"
              onClick={async () => {
                const r = await ipc.hostkeysImport().catch(() => null);
                if (!r) return toast("err", "Không đọc được known_hosts");
                toast("ok", `Đã nhập ${r.added} khóa${r.skipped ? `, bỏ qua ${r.skipped} dòng đã băm` : ""}`);
                void reload();
              }}
            >
              Nhập
            </Btn>
          </div>
          {shownHosts.length === 0 && (
            <div className="hint">
              Trống. App sẽ hỏi và ghi nhớ khi bạn kết nối tới host mới.
            </div>
          )}
          <div className="list" style={{ margin: "0 -12px" }}>
            {shownHosts.map((h) => (
              <div key={`${h.host}:${h.port}`} className="list-item">
                <span style={{ color: "var(--ok)", display: "grid" }}><Icon n="shield" s={14} /></span>
                <div className="main">
                  <div className="t1">{h.host}{h.port !== 22 ? `:${h.port}` : ""}</div>
                  <div className="t2">{h.algo} · {h.fingerprint}</div>
                </div>
                <IBtn icon="copy" tip="Copy fingerprint" size="sm" onClick={() => copy(h.fingerprint, "fingerprint")} />
                <IBtn icon="trash" tip="Quên khóa này" size="sm" danger onClick={(e) => pop.open(e, h)} />
              </div>
            ))}
          </div>
        </div>

        <div className="grp">
          <div className="hint">
            Fingerprint được lưu dạng SHA256 trong thư mục cấu hình của app, độc lập với
            <span className="mono"> ~/.ssh/known_hosts</span>. Các dòng đã băm (<span className="mono">|1|…</span>)
            không nhập được vì không suy ra tên host.
          </div>
        </div>
      </div>

      {pop.state && (
        <Popover anchor={pop.state.anchor} onClose={pop.close}>
          <Confirm
            message={`Quên host key của ${pop.state.data.host}? Lần kết nối sau sẽ được hỏi lại.`}
            confirmLabel="Quên"
            onClose={pop.close}
            onConfirm={async () => {
              await ipc.hostkeyForget(pop.state!.data.host, pop.state!.data.port).catch(() => {});
              void reload();
            }}
          />
        </Popover>
      )}
    </>
  );
}
