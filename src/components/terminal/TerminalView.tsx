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
import { b64ToBytes, themeFromCss } from "@/lib/term";
import { useApp } from "@/store/app";
import { useConfig } from "@/store/config";
import { IBtn, Field } from "../ui/primitives";

function TerminalViewInner({ termId, focused }: { termId: string; focused: boolean }) {
  const host = useRef<HTMLDivElement>(null);
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
    const dataSub = t.onData(send);
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
      <div className="term-host" ref={host} />
    </div>
  );
}

/// Terminal chỉ dựng lại khi đổi termId; memo chặn re-render theo store.
export const TerminalView = memo(TerminalViewInner);
