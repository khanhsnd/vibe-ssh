import { memo, useEffect, useRef, useState } from "react";
import { FitAddon } from "@xterm/addon-fit";
import { SearchAddon } from "@xterm/addon-search";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { WebglAddon } from "@xterm/addon-webgl";
import { Terminal } from "@xterm/xterm";
import { listen } from "@tauri-apps/api/event";
import "@xterm/xterm/css/xterm.css";
import * as ipc from "@/lib/ipc";
import { suggest } from "@/lib/suggest";
import { b64ToBytes, cursorAt, inputSince, themeFromCss, type Anchor } from "@/lib/term";
import { historyOf, loadServerHistory, remember, remoteWords } from "@/store/hints";
import { useApp } from "@/store/app";
import { useConfig } from "@/store/config";
import { IBtn, Field } from "../ui/primitives";

interface Props {
  termId: string;
  focused: boolean;
  /** Khóa lịch sử lệnh (id session, hoặc "local"). */
  histKey: string;
  /** Kết nối SSH để lấy lịch sử/tên container từ server; null với shell cục bộ. */
  connId: string | null;
}

function TerminalViewInner({ termId, focused, histKey, connId }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const ghostEl = useRef<HTMLDivElement>(null);
  const ctx = useRef({ histKey, connId });
  ctx.current = { histKey, connId };
  const term = useRef<Terminal | null>(null);
  const fit = useRef<FitAddon | null>(null);
  const search = useRef<SearchAddon | null>(null);
  const [finding, setFinding] = useState(false);
  const [query, setQuery] = useState("");

  const settings = useConfig((s) => s.settings);
  const theme = settings.theme;

  useEffect(() => {
    if (!host.current) return;
    const t = new Terminal({
      allowProposedApi: true,
      fontFamily: settings.fontFamily,
      fontSize: settings.fontSize,
      lineHeight: settings.lineHeight,
      cursorStyle: settings.cursorStyle,
      cursorBlink: settings.cursorBlink,
      scrollback: settings.scrollback,
      theme: themeFromCss(),
      macOptionIsMeta: true,
      rightClickSelectsWord: false,
      drawBoldTextInBrightColors: true,
      minimumContrastRatio: 3,
      convertEol: false,
    });
    const f = new FitAddon();
    const se = new SearchAddon();
    t.loadAddon(f);
    t.loadAddon(se);
    t.loadAddon(new WebLinksAddon());
    const u11 = new Unicode11Addon();
    t.loadAddon(u11);
    t.unicode.activeVersion = "11";
    t.open(host.current);
    if (settings.webgl) {
      try {
        t.loadAddon(new WebglAddon());
      } catch {
        /* máy không có WebGL2 → dùng canvas mặc định */
      }
    }
    term.current = t;
    fit.current = f;
    search.current = se;

    const send = (data: string) => {
      const st = useApp.getState();
      if (st.broadcast && st.broadcastTargets.includes(termId)) {
        void ipc.termBroadcast(st.broadcastTargets, data);
      } else {
        void ipc.termWrite(termId, data);
      }
    };
    // ── Gợi ý lệnh: chữ mờ sau con trỏ, → để nhận ───────────────────────
    // `anchor` là chỗ con trỏ đứng lúc bắt đầu gõ dòng lệnh (ngay sau prompt).
    let anchor: Anchor | null = null;
    let ghost = "";
    const hide = () => {
      ghost = "";
      if (ghostEl.current) ghostEl.current.textContent = "";
    };
    const refresh = () => {
      const b = t.buffer.active;
      const inp = anchor && inputSince(t, anchor);
      if (!useConfig.getState().settings.suggest || !inp || inp.after.trim()
        || b.type === "alternate" || b.viewportY !== b.baseY) return hide();
      const { histKey: key, connId: conn } = ctx.current;
      ghost = suggest(inp.before, historyOf(key, conn), (src) => remoteWords(conn, src, refresh));
      const el = ghostEl.current;
      const screen = t.element?.querySelector<HTMLElement>(".xterm-screen");
      if (!ghost || !el || !screen) return hide();
      const cellW = screen.clientWidth / t.cols;
      const cellH = screen.clientHeight / t.rows;
      const off = screen.getBoundingClientRect();
      const box = el.parentElement!.getBoundingClientRect();
      el.style.left = `${off.left - box.left + b.cursorX * cellW}px`;
      el.style.top = `${off.top - box.top + b.cursorY * cellH}px`;
      el.style.lineHeight = `${cellH}px`;
      el.textContent = ghost.slice(0, t.cols - b.cursorX);
    };
    const onInput = (data: string) => {
      if (t.buffer.active.type === "alternate") {
        anchor = null;
      } else if (data === "\r") {
        const inp = anchor && inputSince(t, anchor);
        // Dòng bắt đầu bằng dấu cách = không lưu lịch sử, như HISTCONTROL=ignorespace.
        if (inp && !inp.before.startsWith(" ")) remember(ctx.current.histKey, inp.before + inp.after);
        anchor = null;
      } else if (data === "\x03" || data === "\x0c") {
        anchor = null;
      } else if (!anchor) {
        anchor = cursorAt(t);
      }
      if (!anchor) hide();
      send(data);
    };
    t.attachCustomKeyEventHandler((e) => {
      const plain = !e.shiftKey && !e.altKey && !e.metaKey && !e.ctrlKey;
      if (!ghost || e.type !== "keydown" || e.key !== "ArrowRight" || !plain) return true;
      send(ghost);
      hide();
      return false;
    });
    const parsedSub = t.onWriteParsed(refresh);
    const scrollSub = t.onScroll(refresh);

    const dataSub = t.onData(onInput);
    const binSub = t.onBinary((raw) => {
      // raw là chuỗi latin-1: mỗi ký tự một byte.
      let bin = "";
      for (let i = 0; i < raw.length; i++) bin += String.fromCharCode(raw.charCodeAt(i) & 0xff);
      void ipc.termWriteB64(termId, btoa(bin));
    });
    const resizeSub = t.onResize(({ cols, rows }) => void ipc.termResize(termId, cols, rows));

    // OSC 7 (`file://host/path`) là cách shell báo thư mục hiện tại — zsh trên
    // macOS và nhiều distro Linux phát sẵn. Dùng để bảng SFTP đi theo terminal.
    const oscSub = t.parser.registerOscHandler(7, (data) => {
      const m = /^file:\/\/[^/]*(\/.*)$/.exec(data);
      if (m) {
        try {
          useApp.getState().setTermCwd(termId, decodeURIComponent(m[1]));
        } catch {
          useApp.getState().setTermCwd(termId, m[1]);
        }
      }
      return true;
    });

    const unlisten = listen<{ termId: string; b64: string }>("term:data", (e) => {
      if (e.payload.termId !== termId) return;
      t.write(b64ToBytes(e.payload.b64));
    });

    const ro = new ResizeObserver(() => {
      try {
        f.fit();
      } catch {
        /* host chưa có kích thước */
      }
    });
    ro.observe(host.current);
    // PTY được mở với 80×24; đồng bộ lại kích thước thật. Lặp lại một nhịp
    // vì terminal phía backend có thể chưa đăng ký xong ở lần đầu.
    const syncSize = () => {
      try {
        f.fit();
      } catch {
        return;
      }
      void ipc.termResize(termId, t.cols, t.rows);
    };
    const t0 = window.setTimeout(syncSize, 0);
    const t1 = window.setTimeout(syncSize, 320);

    const onCopySel = () => {
      if (!settings.copyOnSelect) return;
      const sel = t.getSelection();
      if (sel) void navigator.clipboard.writeText(sel);
    };
    const selSub = t.onSelectionChange(onCopySel);

    const el = host.current;
    const onContext = async (ev: MouseEvent) => {
      if (!settings.rightClickPaste) return;
      ev.preventDefault();
      const text = await navigator.clipboard.readText().catch(() => "");
      if (text) send(text);
    };
    el.addEventListener("contextmenu", onContext);

    return () => {
      window.clearTimeout(t0);
      window.clearTimeout(t1);
      dataSub.dispose();
      parsedSub.dispose();
      scrollSub.dispose();
      binSub.dispose();
      oscSub.dispose();
      resizeSub.dispose();
      selSub.dispose();
      ro.disconnect();
      el.removeEventListener("contextmenu", onContext);
      void unlisten.then((f2) => f2());
      t.dispose();
      term.current = null;
    };
    // Terminal được tạo một lần cho mỗi termId; thay đổi cấu hình xử lý riêng bên dưới.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [termId]);

  // Cập nhật theme khi người dùng đổi chế độ sáng/tối.
  useEffect(() => {
    if (term.current) term.current.options.theme = themeFromCss();
  }, [theme]);

  useEffect(() => {
    const t = term.current;
    if (!t) return;
    t.options.fontFamily = settings.fontFamily;
    t.options.fontSize = settings.fontSize;
    t.options.lineHeight = settings.lineHeight;
    t.options.cursorStyle = settings.cursorStyle;
    t.options.cursorBlink = settings.cursorBlink;
    t.options.scrollback = settings.scrollback;
    try {
      fit.current?.fit();
    } catch { /* noop */ }
  }, [
    settings.fontFamily, settings.fontSize, settings.lineHeight,
    settings.cursorStyle, settings.cursorBlink, settings.scrollback,
  ]);

  useEffect(() => {
    if (focused) term.current?.focus();
  }, [focused]);

  useEffect(() => {
    if (connId) loadServerHistory(connId);
  }, [connId]);

  // ⌘F / Ctrl+F mở thanh tìm kiếm ngay trong pane.
  useEffect(() => {
    if (!focused) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "f") {
        e.preventDefault();
        setFinding((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [focused]);

  return (
    <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
      {finding && (
        <div
          className="sftp-bar"
          style={{ borderBottom: "1px solid var(--border)", background: "var(--surface)" }}
        >
          <Field
            icon="search"
            small
            value={query}
            autoFocus
            placeholder="Tìm trong màn hình…"
            onChange={(v) => {
              setQuery(v);
              if (v) search.current?.findNext(v, { incremental: true });
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") search.current?.findNext(query);
              if (e.key === "Escape") setFinding(false);
            }}
          />
          <IBtn icon="chevronUp" tip="Trước (⇧⏎)" size="sm" onClick={() => search.current?.findPrevious(query)} />
          <IBtn icon="chevronDown" tip="Sau (⏎)" size="sm" onClick={() => search.current?.findNext(query)} />
          <IBtn icon="x" tip="Đóng (Esc)" size="sm" onClick={() => setFinding(false)} />
        </div>
      )}
      <div className="term-wrap">
        <div className="term-host" ref={host} />
        <div
          className="term-ghost"
          ref={ghostEl}
          style={{ fontFamily: settings.fontFamily, fontSize: settings.fontSize }}
        />
      </div>
    </div>
  );
}

/// Terminal chỉ dựng lại khi đổi termId; memo chặn re-render theo store.
export const TerminalView = memo(TerminalViewInner);
