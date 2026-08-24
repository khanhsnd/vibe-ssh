export function fmtSize(n: number): string {
  if (n < 1024) return `${n} B`;
  const u = ["KB", "MB", "GB", "TB"];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return `${v < 10 ? v.toFixed(1) : Math.round(v)} ${u[i]}`;
}

export function fmtTime(unixSecs?: number): string {
  if (!unixSecs) return "—";
  const d = new Date(unixSecs * 1000);
  const now = new Date();
  const sameYear = d.getFullYear() === now.getFullYear();
  const p = (n: number) => String(n).padStart(2, "0");
  return sameYear
    ? `${p(d.getDate())}/${p(d.getMonth() + 1)} ${p(d.getHours())}:${p(d.getMinutes())}`
    : `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`;
}

export const baseName = (p: string) => p.split("/").filter(Boolean).pop() ?? p;

/// Ghép đường dẫn phía xa: SFTP luôn dùng POSIX.
export function joinPath(dir: string, name: string): string {
  if (dir === "/") return `/${name}`;
  return `${dir.replace(/\/$/, "")}/${name}`;
}

/// Ghép đường dẫn trên máy người dùng: giữ đúng dấu phân cách của Windows.
export function joinLocal(dir: string, name: string): string {
  const sep = dir.includes("\\") && !dir.includes("/") ? "\\" : "/";
  return `${dir.replace(/[\\/]$/, "")}${sep}${name}`;
}

export function parentPath(p: string): string {
  const parts = p.split("/").filter(Boolean);
  parts.pop();
  return `/${parts.join("/")}`;
}

export const isMac = () => navigator.platform.toLowerCase().includes("mac");
export const modKey = () => (isMac() ? "⌘" : "Ctrl");
