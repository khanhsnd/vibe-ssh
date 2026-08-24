import { useApp } from "@/store/app";
import type { PaneLayout } from "@/lib/types";
import { Icon } from "../ui/Icon";
import { IBtn, Seg } from "../ui/primitives";

const LAYOUTS: { value: PaneLayout; icon: string; tip: string }[] = [
  { value: "single", icon: "paneSingle", tip: "Một pane" },
  { value: "cols", icon: "paneCols", tip: "Chia dọc (2)" },
  { value: "rows", icon: "paneRows", tip: "Chia ngang (2)" },
  { value: "grid", icon: "paneGrid", tip: "Lưới 2×2" },
];

export function TabBar() {
  const { tabs, activeTab, selectTab, closeTab, newTab, setLayout, broadcast, toggleBroadcast } = useApp();
  const tab = tabs.find((t) => t.id === activeTab);

  return (
    <div className="tabs">
      <div className="tabs-scroll">
        {tabs.map((t) => {
          const worst = t.panes.reduce<string>((acc, p) => {
            if (p.status === "error") return "err";
            if (p.status === "connecting" && acc !== "err") return "busy";
            if (p.status === "ready" && acc === "") return "ok";
            return acc;
          }, "");
          return (
            <div
              key={t.id}
              className={`tab ${t.id === activeTab ? "active" : ""}`}
              onMouseDown={(e) => {
                if (e.button === 1) closeTab(t.id);
                else selectTab(t.id);
              }}
            >
              <span className={`dot ${worst}`} style={t.color ? { background: t.color } : undefined} />
              <span className="nm">{t.title}</span>
              <span
                className="x"
                role="button"
                aria-label="Đóng tab"
                onMouseDown={(e) => { e.stopPropagation(); closeTab(t.id); }}
              >
                <Icon n="x" s={11} />
              </span>
            </div>
          );
        })}
        <button type="button" className="tab" style={{ minWidth: 34, maxWidth: 34, justifyContent: "center", padding: 0 }} data-tip="Tab mới (⌘T)" onClick={() => newTab()}>
          <Icon n="plus" s={14} />
        </button>
      </div>

      <div className="tabs-actions">
        {tab && (
          <Seg
            value={tab.layout}
            onChange={(v) => setLayout(tab.id, v)}
            options={LAYOUTS.map((l) => ({ value: l.value, icon: l.icon, tip: l.tip }))}
          />
        )}
        <IBtn
          icon="broadcast"
          tip={broadcast ? "Tắt multi-exec" : "Multi-exec: gõ một lần, gửi mọi pane"}
          on={broadcast}
          onClick={toggleBroadcast}
        />
      </div>
    </div>
  );
}
