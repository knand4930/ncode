// src/components/editor/EditorTabs.tsx
import { memo, useMemo } from "react";
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

export const EditorTabs = memo(function EditorTabs() {
  const { tabs, activeTabId, setActiveTab, closeTab, saveFile } = useEditorStore();

  // Memoize the tab rendering data to avoid unnecessary object allocations
  const tabData = useMemo(
    () =>
      tabs.map((tab) => ({
        ...tab,
        icon: LANGUAGE_ICONS[tab.language] || LANGUAGE_ICONS.default,
        isActive: tab.id === activeTabId,
      })),
    [tabs, activeTabId]
  );

  if (tabs.length === 0) return null;

  return (
    <div className="editor-tabs">
      <div className="tabs-scroll">
        {tabData.map((tab) => (
          <div
            key={tab.id}
            className={`tab ${tab.isActive ? "tab-active" : ""}`}
            onClick={() => setActiveTab(tab.id)}
            onAuxClick={(e) => {
              if (e.button === 1) closeTab(tab.id); // Middle click closes
            }}
          >
            <span className="tab-icon">{tab.icon}</span>
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
        ))}
      </div>
    </div>
  );
});
