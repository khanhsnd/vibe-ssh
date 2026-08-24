import { useEffect, useRef, useState } from "react";

/// Thanh kéo đổi kích thước; `sign` = -1 khi panel nằm bên phải.
export function Resizer({
  value, onChange, min, max, sign = 1, row,
}: {
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  sign?: 1 | -1;
  row?: boolean;
}) {
  const [dragging, setDragging] = useState(false);
  const start = useRef({ pos: 0, val: 0 });

  useEffect(() => {
    if (!dragging) return;
    const move = (e: MouseEvent) => {
      const p = row ? e.clientY : e.clientX;
      const next = start.current.val + (p - start.current.pos) * sign;
      onChange(Math.max(min, Math.min(max, next)));
    };
    const up = () => setDragging(false);
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
    document.body.style.cursor = row ? "row-resize" : "col-resize";
    return () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
      document.body.style.cursor = "";
    };
  }, [dragging, min, max, onChange, sign, row]);

  return (
    <div
      className={`resizer ${row ? "row" : ""} ${dragging ? "dragging" : ""}`}
      role="separator"
      aria-orientation={row ? "horizontal" : "vertical"}
      onMouseDown={(e) => {
        start.current = { pos: row ? e.clientY : e.clientX, val: value };
        setDragging(true);
      }}
      onDoubleClick={() => onChange((min + max) / 2)}
    />
  );
}
