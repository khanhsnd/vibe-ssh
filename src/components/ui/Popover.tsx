import { useEffect, useRef, useState } from "react";
import { Icon, type IconName } from "./Icon";

export interface MenuItem {
  label: string;
  icon?: IconName | string;
  shortcut?: string;
  danger?: boolean;
  onPick?: () => void;
  separator?: boolean;
}

export interface Anchor { x: number; y: number }

/// Popover nhỏ, tự lật khi sát mép; dùng cho menu ngữ cảnh và xác nhận nhanh.
export function Popover({
  anchor, onClose, children, width = 200,
}: {
  anchor: Anchor;
  onClose: () => void;
  children: React.ReactNode;
  width?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: anchor.x, top: anchor.y });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos({
      left: Math.min(anchor.x, window.innerWidth - r.width - 8),
      top: Math.min(anchor.y, window.innerHeight - r.height - 8),
    });
  }, [anchor.x, anchor.y]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("mousedown", onDown, true);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown, true);
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  return (
    <div ref={ref} className="pop" style={{ left: pos.left, top: pos.top, minWidth: width }} role="menu">
      {children}
    </div>
  );
}

export function Menu({ items, onClose }: { items: MenuItem[]; onClose: () => void }) {
  return (
    <>
      {items.map((it, i) =>
        it.separator ? (
          <div key={i} className="pop-sep" />
        ) : (
          <button
            key={i}
            type="button"
            role="menuitem"
            className={`pop-item ${it.danger ? "danger" : ""}`}
            // Đóng trước, rồi mới chạy: có mục mở popover khác (xác nhận xóa),
            // nếu đóng sau thì popover mới bị dập ngay.
            onClick={() => { onClose(); it.onPick?.(); }}
          >
            {it.icon && <Icon n={it.icon} s={13} />}
            <span>{it.label}</span>
            {it.shortcut && <span className="sc">{it.shortcut}</span>}
          </button>
        ),
      )}
    </>
  );
}

export function Confirm({
  message, confirmLabel = "Xóa", onConfirm, onClose,
}: {
  message: string;
  confirmLabel?: string;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <>
      <div className="pop-msg">{message}</div>
      <div className="pop-actions">
        <button type="button" className="btn sm" onClick={onClose}>Hủy</button>
        <button
          type="button"
          className="btn sm danger"
          onClick={() => { onConfirm(); onClose(); }}
        >
          {confirmLabel}
        </button>
      </div>
    </>
  );
}

/// Quản lý một popover duy nhất đang mở.
export function usePopover<T>() {
  const [state, setState] = useState<{ anchor: Anchor; data: T } | null>(null);
  const open = (e: { clientX: number; clientY: number }, data: T) =>
    setState({ anchor: { x: e.clientX, y: e.clientY }, data });
  const openAt = (el: HTMLElement, data: T) => {
    const r = el.getBoundingClientRect();
    setState({ anchor: { x: r.left, y: r.bottom + 4 }, data });
  };
  return { state, open, openAt, close: () => setState(null) };
}
