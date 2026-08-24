// Bộ icon tự vẽ (stroke 24×24). Không dùng thư viện icon để giữ bundle nhỏ.

const dot = (x: number, y: number) => `M${x} ${y - 0.5}v1`;
const circle = (cx: number, cy: number, r: number) =>
  `M${cx} ${cy - r}a${r} ${r} 0 1 0 0 ${r * 2}a${r} ${r} 0 1 0 0 ${-r * 2}`;

const P: Record<string, string[]> = {
  terminal: ["M3 5h18v14H3z", "M7 10l2.5 2.5L7 15", "M13 15h4"],
  server: ["M3 4h18v6H3z", "M3 14h18v6H3z", dot(7, 7), dot(7, 17)],
  folder: ["M3 7a2 2 0 0 1 2-2h3.5l2 2H19a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"],
  folderOpen: [
    "M3 7a2 2 0 0 1 2-2h3.5l2 2H19a2 2 0 0 1 2 2v1H3z",
    "M3 9h18l-2 9a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1z",
  ],
  folderPlus: [
    "M3 7a2 2 0 0 1 2-2h3.5l2 2H19a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z",
    "M12 11v6", "M9 14h6",
  ],
  plus: ["M12 5v14", "M5 12h14"],
  minus: ["M5 12h14"],
  x: ["M6 6l12 12", "M18 6L6 18"],
  chevronRight: ["M9.5 6l6 6-6 6"],
  chevronDown: ["M6 9.5l6 6 6-6"],
  chevronLeft: ["M14.5 6l-6 6 6 6"],
  chevronUp: ["M6 14.5l6-6 6 6"],
  search: [circle(11, 11, 7), "M16.2 16.2L21 21"],
  settings: ["M4 7h9", "M17 7h3", "M4 17h3", "M11 17h9", circle(15, 7, 2), circle(9, 17, 2)],
  key: [circle(16, 8, 4), "M13.2 10.8L4 20v-2.5", "M4 20h2.5v-2.5H9V15"],
  shield: ["M12 3l8 3v5.5C20 17 16.6 20 12 21 7.4 20 4 17 4 11.5V6z", "M9 12l2 2 4-4"],
  link: ["M9.5 14.5l5-5", "M11 7.5l1.2-1.2a4 4 0 0 1 5.5 5.5L16.5 13", "M13 16.5l-1.2 1.2a4 4 0 0 1-5.5-5.5L7.5 11"],
  upload: ["M12 16V4", "M7.5 8.5L12 4l4.5 4.5", "M4 20h16"],
  download: ["M12 4v12", "M7.5 11.5L12 16l4.5-4.5", "M4 20h16"],
  refresh: ["M20.5 12a8.5 8.5 0 1 1-2.6-6.1", "M20.5 4v4.5H16"],
  trash: ["M4 7h16", "M9.5 7V4.5h5V7", "M6 7l1 13h10l1-13", "M10 11v6", "M14 11v6"],
  edit: ["M4 20h4L20.5 7.5l-4-4L4 16z", "M15 5l4 4"],
  copy: ["M9 9h11v11H9z", "M15 5H4v11"],
  clipboard: ["M9 3.5h6v3H9z", "M7.5 5H6a1 1 0 0 0-1 1v13a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1h-1.5"],
  paneSingle: ["M4 4h16v16H4z"],
  paneCols: ["M4 4h16v16H4z", "M12 4v16"],
  paneRows: ["M4 4h16v16H4z", "M4 12h16"],
  paneGrid: ["M4 4h16v16H4z", "M12 4v16", "M4 12h16"],
  play: ["M8 5l11 7-11 7z"],
  stop: ["M6.5 6.5h11v11h-11z"],
  files: ["M13.5 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8.5z", "M13.5 3v5.5H19"],
  home: ["M3 11l9-7.5 9 7.5", "M6 10v10h12V10"],
  arrowUp: ["M12 19V6", "M6 12l6-6 6 6"],
  dots: [dot(12, 7), dot(12, 12), dot(12, 17)],
  zap: ["M13.5 2.5L5.5 13.5H11l-1 8 8-11.5h-5.5z"],
  broadcast: [circle(12, 12, 2), "M7.8 7.8a6 6 0 0 0 0 8.4", "M16.2 16.2a6 6 0 0 0 0-8.4", "M4.9 4.9a10 10 0 0 0 0 14.2", "M19.1 19.1a10 10 0 0 0 0-14.2"],
  save: ["M5 4h11l3.5 3.5V20H5z", "M8.5 4v5.5h7V4", "M8.5 14h7v6h-7z"],
  lock: ["M6 11h12v9H6z", "M9 11V8a3 3 0 0 1 6 0v3"],
  eye: ["M2.5 12S6 6.5 12 6.5 21.5 12 21.5 12 18 17.5 12 17.5 2.5 12 2.5 12z", circle(12, 12, 2.6)],
  eyeOff: ["M4 4l16 16", "M9.5 5.2A9 9 0 0 1 12 5c6 0 9.5 7 9.5 7a17 17 0 0 1-2.6 3.5", "M6.6 7.9A17 17 0 0 0 2.5 12S6 19 12 19a9 9 0 0 0 3-.5"],
  check: ["M5 13l4.5 4.5L19 7"],
  alert: ["M12 4l9 16H3z", "M12 10v4.5", dot(12, 17.5)],
  info: [circle(12, 12, 8.5), "M12 11.5v5.5", dot(12, 8)],
  minimize: ["M5 12h14"],
  maximize: ["M6.5 6.5h11v11h-11z"],
  sun: [circle(12, 12, 4), "M12 2v2.5", "M12 19.5V22", "M2 12h2.5", "M19.5 12H22", "M5 5l1.8 1.8", "M17.2 17.2L19 19", "M19 5l-1.8 1.8", "M6.8 17.2L5 19"],
  moon: ["M20.5 14.5A8.5 8.5 0 1 1 10.5 3a6.8 6.8 0 0 0 10 11.5z"],
  contrast: [circle(12, 12, 8.5), "M12 3.5v17a8.5 8.5 0 0 0 0-17z"],
  cpu: ["M6.5 6.5h11v11h-11z", "M10 10h4v4h-4z", "M10 3v3.5", "M14 3v3.5", "M10 17.5V21", "M14 17.5V21", "M3 10h3.5", "M3 14h3.5", "M17.5 10H21", "M17.5 14H21"],
  clock: [circle(12, 12, 8.5), "M12 7.5V12l3 2"],
  user: [circle(12, 8, 3.6), "M5 20a7 7 0 0 1 14 0"],
  globe: [circle(12, 12, 8.5), "M3.5 12h17", "M12 3.5c2.5 2.5 2.5 14 0 17-2.5-3-2.5-14.5 0-17z"],
  list: ["M4 7h16", "M4 12h16", "M4 17h10"],
  plug: ["M9 3v5", "M15 3v5", "M6.5 8h11v3.5a5.5 5.5 0 0 1-11 0z", "M12 17v4"],
  jump: ["M4 5v6.5a2 2 0 0 0 2 2h11", "M14 9.5l4 4-4 4"],
  monitor: ["M3 5h18v11H3z", "M9 20h6", "M12 16v4"],
  wifi: ["M4.5 9a12 12 0 0 1 15 0", "M7.5 12.5a8 8 0 0 1 9 0", "M10.5 16a4 4 0 0 1 3 0", dot(12, 19)],
  network: ["M9 3.5h6v4H9z", "M3 16.5h5v4H3z", "M16 16.5h5v4h-5z", "M12 7.5v4.5", "M5.5 16.5V12h13v4.5", "M12 12h0"],
  filter: ["M4 5h16l-6 7v6l-4 2v-8z"],
  command: ["M7.5 4a2.5 2.5 0 0 1 2.5 2.5v11a2.5 2.5 0 1 1-2.5-2.5h9a2.5 2.5 0 1 1-2.5 2.5v-11A2.5 2.5 0 1 1 16.5 9h-9A2.5 2.5 0 0 1 5 6.5 2.5 2.5 0 0 1 7.5 4z"],
  logout: ["M14 4H6a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h8", "M17 8.5l3.5 3.5L17 15.5", "M10 12h10.5"],
  layers: ["M12 3l9 5-9 5-9-5z", "M3.5 13L12 17.7 20.5 13", "M3.5 17L12 21.7 20.5 17"],
  bolt: ["M13.5 2.5L5.5 13.5H11l-1 8 8-11.5h-5.5z"],
  hash: ["M7 4l-1 16", "M14 4l-1 16", "M4 9h16", "M3.5 15h16"],
};

export type IconName = keyof typeof P;

export function Icon({
  n,
  s = 16,
  w = 1.7,
  className,
}: {
  n: IconName | string;
  s?: number;
  w?: number;
  className?: string;
}) {
  const paths = P[n as string] ?? P.info;
  return (
    <svg
      width={s}
      height={s}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={w}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      {paths.map((d, i) => (
        <path key={i} d={d} />
      ))}
    </svg>
  );
}
