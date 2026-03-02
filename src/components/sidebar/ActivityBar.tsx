// src/components/sidebar/ActivityBar.tsx
import { Files, Search, GitBranch, Puzzle, Bot, Settings } from "lucide-react";
import { useUIStore } from "../../store/uiStore";
import { useAIStore } from "../../store/aiStore";

const items = [
  { id: "explorer", icon: Files, label: "Explorer (Ctrl+Shift+E)" },
  { id: "search", icon: Search, label: "Search (Ctrl+Shift+F)" },
  { id: "symbols", icon: Search, label: "Symbols (Ctrl+T)" },
  { id: "git", icon: GitBranch, label: "Source Control (Ctrl+Shift+G)" },
  { id: "extensions", icon: Puzzle, label: "Extensions (Ctrl+Shift+X)" },
];

export function ActivityBar() {
  const { activeView, setActiveView, toggleAIPanel, showAIPanel, toggleSettingsPanel } = useUIStore();
  const { isOllamaRunning } = useAIStore();

  return (
    <div className="activity-bar">
      <div className="activity-bar-top">
        {items.map(({ id, icon: Icon, label }) => (
          <button
            key={id}
            className={`activity-item ${activeView === id ? "active" : ""}`}
            onClick={() => setActiveView(id as any)}
            title={label}
          >
            <Icon size={22} />
            {activeView === id && <div className="activity-active-bar" />}
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
}
