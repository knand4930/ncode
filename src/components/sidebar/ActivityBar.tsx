// src/components/sidebar/ActivityBar.tsx
import { memo } from "react";
import { Files, Search, Hash, GitBranch, Puzzle, Bot, Settings, ListTodo, ShieldAlert, Network, History } from "lucide-react";
import { useUIStore } from "../../store/uiStore";
import { useAIStore } from "../../store/aiStore";
import { useEditorStore } from "../../store/editorStore";

const items = [
  { id: "explorer",  icon: Files,       label: "Explorer (Ctrl+Shift+E)" },
  { id: "search",    icon: Search,      label: "Search (Ctrl+Shift+F)" },
  { id: "symbols",   icon: Hash,        label: "Symbols (Ctrl+T)" },
  { id: "code-graph",icon: Network,     label: "Code Graph" },
  { id: "git",       icon: GitBranch,   label: "Source Control (Ctrl+Shift+G)" },
  { id: "extensions",icon: Puzzle,      label: "Extensions (Ctrl+Shift+X)" },
  { id: "tasks",     icon: ListTodo,    label: "Tasks" },
  { id: "review",    icon: ShieldAlert, label: "AI Code Review" },
  { id: "history",   icon: History,     label: "Change History & Rollback" },
];

export const ActivityBar = memo(function ActivityBar() {
  const {
    activeView, showSidebar, openView, toggleSidebar,
    toggleAIPanel, showAIPanel, toggleSettingsPanel,
  } = useUIStore();
  const { isOllamaRunning } = useAIStore();
  const { aiChangeHistory } = useEditorStore();
  const pendingChanges = aiChangeHistory.filter(e => !e.rolledBack).length;

  return (
    <div className="activity-bar">
      <div className="activity-bar-top">
        {items.map(({ id, icon: Icon, label }) => (
          <button
            key={id}
            className={`activity-item ${showSidebar && activeView === id ? "active" : ""}`}
            onClick={() => {
              if (showSidebar && activeView === id) { toggleSidebar(); return; }
              openView(id as any);
            }}
            title={label}
            style={{ position: "relative" }}
          >
            <Icon size={22} />
            {showSidebar && activeView === id && <div className="activity-active-bar" />}
            {/* Badge for history */}
            {id === "history" && pendingChanges > 0 && (
              <span style={{
                position: "absolute", top: 6, right: 6,
                minWidth: 14, height: 14, borderRadius: 7,
                background: "var(--accent)", color: "#fff",
                fontSize: 9, fontWeight: 700,
                display: "flex", alignItems: "center", justifyContent: "center",
                padding: "0 3px", lineHeight: 1,
              }}>
                {pendingChanges > 99 ? "99+" : pendingChanges}
              </span>
            )}
          </button>
        ))}
      </div>

      <div className="activity-bar-bottom">
        {/* AI Toggle */}
        <button
          className={`activity-item ${showAIPanel ? "active" : ""}`}
          onClick={toggleAIPanel}
          title="AI Assistant (Ctrl+Shift+A)"
        >
          <Bot size={22} />
          {isOllamaRunning && <div className="activity-ai-dot" />}
        </button>

        <button className="activity-item" title="Settings" onClick={toggleSettingsPanel}>
          <Settings size={22} />
        </button>
      </div>
    </div>
  );
});
