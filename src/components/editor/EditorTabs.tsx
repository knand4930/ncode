// src/components/editor/EditorTabs.tsx
import { X, Circle } from "lucide-react";
import { useEditorStore } from "../../store/editorStore";

const LANGUAGE_ICONS: Record<string, string> = {
  typescript: "🔷",
  javascript: "🟨",
  python: "🐍",
  rust: "🦀",
  go: "🐹",
  java: "☕",
  cpp: "⚙️",
  c: "⚙️",
  html: "🌐",
  css: "🎨",
  json: "📋",
  markdown: "📝",
  yaml: "⚙️",
  toml: "⚙️",
  shell: "🐚",
  sql: "🗄️",
  ruby: "💎",
  php: "🐘",
  swift: "🍎",
  kotlin: "🎯",
  csharp: "💜",
  default: "📄",
};

export function EditorTabs() {
  const { tabs, activeTabId, setActiveTab, closeTab, saveFile } = useEditorStore();

  if (tabs.length === 0) return null;

  return (
    <div className="editor-tabs">
      <div className="tabs-scroll">
        {tabs.map((tab) => {
          const isActive = tab.id === activeTabId;
          const icon = LANGUAGE_ICONS[tab.language] || LANGUAGE_ICONS.default;

          return (
            <div
              key={tab.id}
              className={`tab ${isActive ? "tab-active" : ""}`}
              onClick={() => setActiveTab(tab.id)}
              onAuxClick={(e) => {
                if (e.button === 1) closeTab(tab.id); // Middle click closes
              }}
            >
              <span className="tab-icon">{icon}</span>
              <span className="tab-name">{tab.fileName}</span>
              {tab.isDirty && (
                <span className="tab-dirty" title="Unsaved changes">
                  <Circle size={8} fill="currentColor" />
                </span>
              )}
              <button
                className="tab-close"
                onClick={(e) => {
                  e.stopPropagation();
                  if (tab.isDirty) {
                    if (confirm(`Save "${tab.fileName}" before closing?`)) {
                      saveFile(tab.id).then(() => closeTab(tab.id));
                    } else {
                      closeTab(tab.id);
                    }
                  } else {
                    closeTab(tab.id);
                  }
                }}
              >
                <X size={12} />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
