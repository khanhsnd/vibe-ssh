import type { ITheme, Terminal } from "@xterm/xterm";

/// Đọc palette terminal từ CSS variable để terminal luôn khớp theme app.
export function themeFromCss(): ITheme {
  const s = getComputedStyle(document.documentElement);
  const v = (n: string) => s.getPropertyValue(n).trim();
  return {
    background: v("--t-bg"),
    foreground: v("--t-fg"),
    cursor: v("--t-cursor"),
    cursorAccent: v("--t-bg"),
    selectionBackground: v("--t-sel"),
    black: v("--t-black"),
    red: v("--t-red"),
    green: v("--t-green"),
    yellow: v("--t-yellow"),
    blue: v("--t-blue"),
    magenta: v("--t-magenta"),
    cyan: v("--t-cyan"),
    white: v("--t-white"),
    brightBlack: v("--t-bblack"),
    brightRed: v("--t-bred"),
    brightGreen: v("--t-bgreen"),
    brightYellow: v("--t-byellow"),
    brightBlue: v("--t-bblue"),
    brightMagenta: v("--t-bmagenta"),
    brightCyan: v("--t-bcyan"),
    brightWhite: v("--t-bwhite"),
  };
}

const B64 =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const LUT = new Uint8Array(128);
for (let i = 0; i < B64.length; i++) LUT[B64.charCodeAt(i)] = i;

/// atob() trả string nên phải copy thêm một lần; giải mã trực tiếp nhanh hơn
/// và tránh sai lệch khi byte không phải UTF-8 hợp lệ.
export function b64ToBytes(b64: string): Uint8Array {
  let len = b64.length;
  while (len > 0 && b64[len - 1] === "=") len--;
  const out = new Uint8Array((len * 3) >> 2);
  let o = 0;
  for (let i = 0; i + 3 < len; i += 4) {
    const n =
      (LUT[b64.charCodeAt(i)] << 18) |
      (LUT[b64.charCodeAt(i + 1)] << 12) |
      (LUT[b64.charCodeAt(i + 2)] << 6) |
      LUT[b64.charCodeAt(i + 3)];
    out[o++] = n >> 16;
    out[o++] = (n >> 8) & 255;
    out[o++] = n & 255;
  }
  const rem = len & 3;
  if (rem === 2) {
    const n = (LUT[b64.charCodeAt(len - 2)] << 2) | (LUT[b64.charCodeAt(len - 1)] >> 4);
    out[o++] = n & 255;
  } else if (rem === 3) {
    const a = LUT[b64.charCodeAt(len - 3)];
    const b = LUT[b64.charCodeAt(len - 2)];
    const c = LUT[b64.charCodeAt(len - 1)];
    out[o++] = ((a << 2) | (b >> 4)) & 255;
    out[o++] = ((b << 4) | (c >> 2)) & 255;
  }
  return o === out.length ? out : out.subarray(0, o);
}

/** Vị trí trong buffer (y tuyệt đối, tính cả scrollback). */
export interface Anchor { x: number; y: number }

export function cursorAt(t: Terminal): Anchor {
  const b = t.buffer.active;
  return { x: b.cursorX, y: b.baseY + b.cursorY };
}

/// Chữ trên màn hình từ `a` tới con trỏ (`before`) và phần còn lại của dòng (`after`).
/// Đọc từ màn hình nên vẫn đúng sau Tab, ↑ lịch sử hay sửa giữa dòng.
export function inputSince(t: Terminal, a: Anchor): { before: string; after: string } | null {
  const b = t.buffer.active;
  const y = b.baseY + b.cursorY;
  if (y < a.y || (y === a.y && b.cursorX < a.x)) return null;
  let before = "";
  for (let r = a.y; r <= y; r++) {
    const line = b.getLine(r);
    if (!line) return null;
    before += line.translateToString(false, r === a.y ? a.x : 0, r === y ? b.cursorX : undefined);
  }
  const after = b.getLine(y)?.translateToString(true, b.cursorX) ?? "";
  return { before, after };
}
