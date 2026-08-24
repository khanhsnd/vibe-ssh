import { useState } from "react";
import type { MacroDef } from "@/lib/types";
import { useApp } from "@/store/app";
import { useConfig } from "@/store/config";
import { Icon } from "../ui/Icon";
import { Confirm, Popover, usePopover } from "../ui/Popover";
import { Btn, Field, IBtn, Row, Switch } from "../ui/primitives";

const blank = (): MacroDef => ({ id: crypto.randomUUID(), name: "", body: "", enter: true });

export function MacrosPanel() {
  const cfg = useConfig();
  const { sendText, broadcast, broadcastTargets } = useApp();
  const [edit, setEdit] = useState<MacroDef | null>(null);
  const pop = usePopover<MacroDef>();

  if (edit) {
    return (
      <>
        <div className="side-head">
          <IBtn icon="chevronLeft" tip="Quay lại" size="sm" onClick={() => setEdit(null)} />
          <span className="side-title">Macro</span>
        </div>
        <div className="side-body">
          <div className="grp">
            <Row label="Tên">
              <Field value={edit.name} onChange={(v) => setEdit({ ...edit, name: v })} placeholder="ví dụ: xem log nginx" />
            </Row>
            <Row label="Nội dung" stack>
              <textarea
                value={edit.body}
                onChange={(e) => setEdit({ ...edit, body: e.target.value })}
                className="ta"
                rows={5}
                spellCheck={false}
              />
            </Row>
            <Row label="">
              <Switch checked={edit.enter} onChange={(v) => setEdit({ ...edit, enter: v })} label="Thêm Enter ở cuối" />
            </Row>
          </div>
        </div>
        <div className="side-foot" style={{ display: "flex", gap: 6 }}>
          <Btn variant="primary" small icon="save"
            onClick={() => { cfg.upsertMacro({ ...edit, name: edit.name.trim() || "Macro" }); setEdit(null); }}>
            Lưu
          </Btn>
          <div style={{ flex: 1 }} />
          <Btn variant="ghost" small onClick={() => setEdit(null)}>Hủy</Btn>
        </div>
      </>
    );
  }

  return (
    <>
      <div className="side-head">
        <span className="side-title">Macro & snippet</span>
        <IBtn icon="plus" tip="Macro mới" size="sm" onClick={() => setEdit(blank())} />
      </div>
      <div className="side-body">
        {broadcast && (
          <div className="hint" style={{ padding: "8px 10px", borderBottom: "1px solid var(--border)", color: "var(--accent)" }}>
            Multi-exec đang bật · gửi tới {broadcastTargets.length} pane
          </div>
        )}
        {cfg.macros.length === 0 && (
          <div className="empty">
            <Icon n="zap" s={28} w={1.3} />
            <b>Chưa có macro</b>
            Lưu các lệnh hay dùng để gửi một cú nhấp.
          </div>
        )}
        <div className="list">
          {cfg.macros.map((m) => (
            <div key={m.id} className="list-item">
              <span style={{ color: "var(--warn)", display: "grid" }}><Icon n="zap" s={15} /></span>
              <div className="main">
                <div className="t1">{m.name}</div>
                <div className="t2">{m.body.split("\n")[0]}</div>
              </div>
              <IBtn icon="play" tip="Gửi vào pane đang chọn" size="sm" onClick={() => void sendText(m.body, m.enter)} />
              <IBtn icon="edit" tip="Sửa" size="sm" onClick={() => setEdit(m)} />
              <IBtn icon="trash" tip="Xóa" size="sm" danger onClick={(e) => pop.open(e, m)} />
            </div>
          ))}
        </div>
      </div>
      {pop.state && (
        <Popover anchor={pop.state.anchor} onClose={pop.close}>
          <Confirm
            message={`Xóa macro “${pop.state.data.name}”?`}
            onClose={pop.close}
            onConfirm={() => cfg.removeMacro(pop.state!.data.id)}
          />
        </Popover>
      )}
    </>
  );
}
