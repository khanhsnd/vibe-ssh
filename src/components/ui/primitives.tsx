import type { ReactNode, CSSProperties } from "react";
import { STAGE_META } from "@/lib/kinds";
import type { Stage } from "@/lib/types";
import { Icon, type IconName } from "./Icon";

// Tooltip dùng CSS `[data-tip]::after`; toạ độ do useTooltips() gắn ở App.

export function IBtn({
  icon, tip, onClick, on, disabled, danger, size = "md", tabIndex,
}: {
  icon: IconName | string;
  tip: string;
  onClick?: (e: React.MouseEvent<HTMLButtonElement>) => void;
  on?: boolean;
  disabled?: boolean;
  danger?: boolean;
  size?: "sm" | "md" | "lg";
  tabIndex?: number;
}) {
  const cls = ["ibtn", size === "sm" ? "sm" : size === "lg" ? "lg" : "", danger ? "danger" : ""]
    .filter(Boolean).join(" ");
  return (
    <button
      type="button"
      className={cls}
      data-tip={tip}
      aria-label={tip}
      aria-pressed={on}
      disabled={disabled}
      tabIndex={tabIndex}
      onClick={onClick}
    >
      <Icon n={icon} s={size === "sm" ? 13 : size === "lg" ? 17 : 15} />
    </button>
  );
}

export function Btn({
  children, icon, onClick, variant = "default", disabled, small, tip, type = "button",
}: {
  children?: ReactNode;
  icon?: IconName | string;
  onClick?: (e: React.MouseEvent<HTMLButtonElement>) => void;
  variant?: "default" | "primary" | "ghost" | "danger";
  disabled?: boolean;
  small?: boolean;
  tip?: string;
  type?: "button" | "submit";
}) {
  return (
    <button
      type={type}
      className={`btn ${variant === "default" ? "" : variant} ${small ? "sm" : ""}`}
      onClick={onClick}
      disabled={disabled}
      data-tip={tip}
    >
      {icon && <Icon n={icon} s={small ? 12 : 14} />}
      {children}
    </button>
  );
}

export function Field({
  value, onChange, placeholder, icon, type = "text", small, mono, onKeyDown, autoFocus, right, width,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  icon?: IconName | string;
  type?: string;
  small?: boolean;
  mono?: boolean;
  onKeyDown?: (e: React.KeyboardEvent) => void;
  autoFocus?: boolean;
  right?: ReactNode;
  width?: number | string;
}) {
  return (
    <div className={`field ${small ? "sm" : ""}`} style={width ? { width } : undefined}>
      {icon && <Icon n={icon} s={13} />}
      <input
        type={type}
        value={value}
        placeholder={placeholder}
        spellCheck={false}
        autoCapitalize="off"
        autoComplete="off"
        style={mono ? { fontFamily: "var(--font-mono)" } : undefined}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        autoFocus={autoFocus}
      />
      {right}
    </div>
  );
}

export function NumField({
  value, onChange, min = 0, max = 999999, width = 78, small,
}: {
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  width?: number;
  small?: boolean;
}) {
  return (
    <div className={`field ${small ? "sm" : ""}`} style={{ width, flex: "none" }}>
      <input
        type="number"
        value={Number.isFinite(value) ? value : 0}
        min={min}
        max={max}
        onChange={(e) => {
          const n = Number(e.target.value);
          onChange(Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : min);
        }}
      />
    </div>
  );
}

export function Select<T extends string>({
  value, onChange, options, small, width,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
  small?: boolean;
  width?: number | string;
}) {
  return (
    <div className={`field ${small ? "sm" : ""}`} style={width ? { width } : undefined}>
      <select value={value} onChange={(e) => onChange(e.target.value as T)}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </div>
  );
}

export function Switch({
  checked, onChange, label, tip,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label?: string;
  tip?: string;
}) {
  // Dùng <span>, không dùng <label>: quy tắc `.row > label` gán chiều rộng cố
  // định cho nhãn bên trái của form và sẽ bóp méo công tắc.
  return (
    <span
      style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}
      data-tip={tip}
    >
      <button
        type="button"
        role="switch"
        className="switch"
        aria-checked={checked}
        aria-label={label ?? tip ?? "bật/tắt"}
        onClick={() => onChange(!checked)}
      />
      {label && <span style={{ fontSize: "var(--fs-sm)", color: "var(--text-2)" }}>{label}</span>}
    </span>
  );
}

export function Seg<T extends string>({
  value, onChange, options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label?: string; icon?: IconName | string; tip?: string }[];
}) {
  return (
    <div className="seg-ctl" role="group">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          className={value === o.value ? "on" : ""}
          data-tip={o.tip}
          aria-label={o.tip ?? o.label}
          onClick={() => onChange(o.value)}
        >
          {o.icon && <Icon n={o.icon} s={13} />}
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Row({
  label, children, stack, tip,
}: {
  label?: string;
  children: ReactNode;
  stack?: boolean;
  tip?: string;
}) {
  return (
    <div className={`row ${stack ? "stack" : ""}`}>
      {label && <label data-tip={tip}>{label}</label>}
      {children}
    </div>
  );
}

export function Group({
  title, children, icon, actions,
}: {
  title?: string;
  children: ReactNode;
  icon?: IconName | string;
  actions?: ReactNode;
}) {
  return (
    <div className="grp">
      {title && (
        <div className="grp-title">
          {icon && <Icon n={icon} s={12} />}
          <span style={{ flex: 1 }}>{title}</span>
          {actions}
        </div>
      )}
      {children}
    </div>
  );
}

export function Empty({
  icon, title, hint, action,
}: {
  icon: IconName | string;
  title: string;
  hint?: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      <Icon n={icon} s={30} w={1.4} />
      <b>{title}</b>
      {hint}
      {action && <div style={{ marginTop: 12, display: "flex", justifyContent: "center" }}>{action}</div>}
    </div>
  );
}

export function Chip({
  children, tone, style,
}: {
  children: ReactNode;
  tone?: "ok" | "err" | "warn" | "accent";
  style?: CSSProperties;
}) {
  return <span className={`chip ${tone ?? ""}`} style={style}>{children}</span>;
}

/// Tag môi trường của session (prod / staging / dev), cùng màu với viền tab.
export function StageTag({ stage }: { stage?: Stage }) {
  if (!stage) return null;
  const m = STAGE_META[stage];
  return <Chip style={{ color: m.color, background: m.bg, borderColor: "transparent" }}>{m.label}</Chip>;
}
