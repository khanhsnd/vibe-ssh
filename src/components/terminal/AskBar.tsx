import { useEffect, useRef, useState } from "react";
import { useApp, type Ask } from "@/store/app";
import { Icon } from "../ui/Icon";
import { Btn, Switch } from "../ui/primitives";

/// Mọi câu hỏi của backend hiện thành dải inline trong pane, không dùng modal.
export function AskBar({ ask }: { ask: Ask }) {
  const answerAsk = useApp((s) => s.answerAsk);
  if (ask.event === "hostkey:ask") return <HostKey ask={ask} answer={answerAsk} />;
  if (ask.event === "auth:secret") return <Secret ask={ask} answer={answerAsk} />;
  return <Interactive ask={ask} answer={answerAsk} />;
}

type Answer = (askId: string, value: unknown) => Promise<void>;

const barStyle: React.CSSProperties = {
  flex: "none",
  borderBottom: "1px solid var(--border)",
  background: "var(--surface)",
  padding: "9px 11px",
  display: "flex",
  flexDirection: "column",
  gap: 8,
};

function HostKey({ ask, answer }: { ask: Ask; answer: Answer }) {
  const p = ask.payload as Record<string, string>;
  const changed = p.status === "changed";
  const [remember, setRemember] = useState(true);

  return (
    <div style={{ ...barStyle, borderLeft: `3px solid var(--${changed ? "danger" : "warn"})` }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ color: `var(--${changed ? "danger" : "warn"})`, display: "grid" }}>
          <Icon n={changed ? "alert" : "shield"} s={16} />
        </span>
        <b style={{ fontSize: "var(--fs-md)" }}>
          {changed ? "Host key đã ĐỔI" : "Host key chưa được biết"}
        </b>
        <span className="mono" style={{ color: "var(--text-3)", fontSize: "var(--fs-xs)" }}>
          {p.host}:{p.port}
        </span>
      </div>

      <div className="hint" style={{ userSelect: "text" }}>
        <div className="mono" style={{ color: "var(--text)" }}>
          {p.algo} · {p.fingerprint}
        </div>
        {changed && (
          <div className="mono" style={{ color: "var(--danger)", marginTop: 2 }}>
            trước đó: {p.previous}
          </div>
        )}
        {changed
          ? "Khóa khác với lần trước. Chỉ chấp nhận nếu bạn biết server vừa được cài lại."
          : "Hãy đối chiếu fingerprint với nguồn đáng tin trước khi chấp nhận."}
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <Switch checked={remember} onChange={setRemember} label="Ghi nhớ khóa này" />
        <div style={{ flex: 1 }} />
        <Btn small onClick={() => void answer(ask.askId, { accept: false })}>Từ chối</Btn>
        <Btn
          small
          variant={changed ? "danger" : "primary"}
          onClick={() => void answer(ask.askId, { accept: true, remember })}
        >
          Chấp nhận
        </Btn>
      </div>
    </div>
  );
}

function Secret({ ask, answer }: { ask: Ask; answer: Answer }) {
  const p = ask.payload as Record<string, string>;
  const [value, setValue] = useState("");
  const [show, setShow] = useState(false);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => ref.current?.focus(), []);

  const submit = () => void answer(ask.askId, { value });

  return (
    <div style={{ ...barStyle, borderLeft: "3px solid var(--accent)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ color: "var(--accent)", display: "grid" }}>
          <Icon n={p.kind === "passphrase" ? "key" : "lock"} s={15} />
        </span>
        <b style={{ fontSize: "var(--fs-md)" }}>{p.title}</b>
        <span className="mono" style={{ color: "var(--text-3)", fontSize: "var(--fs-xs)" }}>
          {p.detail}
        </span>
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <div className="field" style={{ flex: 1 }}>
          <input
            ref={ref}
            type={show ? "text" : "password"}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") submit();
              if (e.key === "Escape") void answer(ask.askId, { value: "" });
            }}
          />
          <button
            type="button"
            className="ibtn sm"
            data-tip={show ? "Ẩn" : "Hiện"}
            onClick={() => setShow((v) => !v)}
          >
            <Icon n={show ? "eyeOff" : "eye"} s={13} />
          </button>
        </div>
        <Btn small variant="primary" onClick={submit}>Gửi</Btn>
      </div>
    </div>
  );
}

function Interactive({ ask, answer }: { ask: Ask; answer: Answer }) {
  const p = ask.payload as {
    name?: string;
    instructions?: string;
    prompts?: { prompt: string; echo: boolean }[];
  };
  const prompts = p.prompts ?? [];
  const [vals, setVals] = useState<string[]>(() => prompts.map(() => ""));

  return (
    <div style={{ ...barStyle, borderLeft: "3px solid var(--accent)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ color: "var(--accent)", display: "grid" }}>
          <Icon n="user" s={15} />
        </span>
        <b style={{ fontSize: "var(--fs-md)" }}>{p.name || "Xác thực tương tác"}</b>
      </div>
      {p.instructions && <div className="hint" style={{ userSelect: "text" }}>{p.instructions}</div>}
      {prompts.map((q, i) => (
        <div key={i} style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span className="hint" style={{ minWidth: 120, color: "var(--text-2)" }}>{q.prompt}</span>
          <div className="field" style={{ flex: 1 }}>
            <input
              type={q.echo ? "text" : "password"}
              value={vals[i] ?? ""}
              autoFocus={i === 0}
              onChange={(e) => setVals(vals.map((v, j) => (j === i ? e.target.value : v)))}
              onKeyDown={(e) => {
                if (e.key === "Enter" && i === prompts.length - 1) {
                  void answer(ask.askId, { values: vals });
                }
              }}
            />
          </div>
        </div>
      ))}
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <Btn small onClick={() => void answer(ask.askId, { values: [] })}>Bỏ qua</Btn>
        <Btn small variant="primary" onClick={() => void answer(ask.askId, { values: vals })}>Gửi</Btn>
      </div>
    </div>
  );
}
