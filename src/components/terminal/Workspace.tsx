import { useApp } from "@/store/app";
import { Icon } from "../ui/Icon";
import { Pane } from "./Pane";
import { TabBar } from "./TabBar";

export function Workspace() {
  const { tabs, activeTab, newTab } = useApp();
  const tab = tabs.find((t) => t.id === activeTab);

  return (
    <div className="work">
      <TabBar />
      <div className="stage">
        {!tab && (
          <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center" }}>
            <div className="empty">
              <Icon n="terminal" s={34} w={1.3} />
              <b>Chưa có tab nào</b>
              <div style={{ marginTop: 10 }}>
                <button type="button" className="btn primary" onClick={() => newTab()}>
                  <Icon n="plus" s={14} /> Tab mới
                </button>
              </div>
              <div style={{ marginTop: 10, fontSize: "var(--fs-xs)" }}>
                hoặc <kbd>⌘K</kbd> để mở bảng lệnh
              </div>
            </div>
          </div>
        )}

        {tab && (
          <div className={`pane-grid ${tab.layout === "rows" ? "v" : ""}`}>
            {tab.layout === "grid" ? (
              <>
                <div className="pane-grid v">
                  {[tab.panes[0], tab.panes[2]].filter(Boolean).map((p) => (
                    <Pane key={p.id} tab={tab} pane={p} />
                  ))}
                </div>
                <div className="pane-grid v" style={{ borderLeft: "1px solid var(--border)" }}>
                  {[tab.panes[1], tab.panes[3]].filter(Boolean).map((p) => (
                    <Pane key={p.id} tab={tab} pane={p} />
                  ))}
                </div>
              </>
            ) : (
              tab.panes.map((p) => <Pane key={p.id} tab={tab} pane={p} />)
            )}
          </div>
        )}
      </div>
    </div>
  );
}
