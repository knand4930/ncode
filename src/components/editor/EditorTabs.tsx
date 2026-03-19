// src/components/editor/EditorTabs.tsx
import { memo, useMemo } from "react";
import { save } from "@tauri-apps/plugin-dialog";
import { X, Circle, Play, TestTube2 } from "lucide-react";
import { useEditorStore } from "../../store/editorStore";
import { useTerminalStore } from "../../store/terminalStore";
import { useUIStore } from "../../store/uiStore";
import { hasRunSupport, getRunCommand, hasTestSupport, getTestCommand } from "../../utils/languageRunner";

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
  const { tabs, activeTabId, setActiveTab, closeTab, saveFile, saveFileAs, reorderTabs } = useEditorStore();
  const { runCommandInTerminal } = useTerminalStore();
  const { showTerminal, toggleTerminal } = useUIStore();

  const activeTab = useMemo(() => tabs.find(t => t.id === activeTabId), [tabs, activeTabId]);

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

  const handleRun = () => {
    if (!activeTab) return;
    const cmd = getRunCommand(activeTab.language, activeTab.filePath, activeTab.fileName);
    if (!cmd) return;
    if (!showTerminal) toggleTerminal();
    runCommandInTerminal(cmd);
  };

  const handleTest = () => {
    if (!activeTab) return;
    const cmd = getTestCommand(activeTab.language, activeTab.filePath, activeTab.fileName);
    if (!cmd) return;
    if (!showTerminal) toggleTerminal();
    runCommandInTerminal(cmd);
  };

  // Drag and drop handlers
  const handleDragStart = (e: React.DragEvent<HTMLDivElement>, index: number) => {
    e.dataTransfer.setData("text/plain", index.toString());
    e.dataTransfer.effectAllowed = "move";
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>, dropIndex: number) => {
    e.preventDefault();
    const dragIndex = parseInt(e.dataTransfer.getData("text/plain"), 10);
    if (isNaN(dragIndex) || dragIndex === dropIndex) return;
    
    reorderTabs(dragIndex, dropIndex);
  };

  if (tabs.length === 0) return null;

  return (
    <div className="editor-tabs" style={{ display: 'flex', justifyContent: 'space-between' }}>
      <div className="tabs-scroll" style={{ flex: 1, overflowX: 'auto', display: 'flex' }}>
        {tabData.map((tab, index) => (
          <div
            key={tab.id}
            className={`tab ${tab.isActive ? "tab-active" : ""}`}
            draggable={true}
            onDragStart={(e) => handleDragStart(e, index)}
            onDragOver={handleDragOver}
            onDrop={(e) => handleDrop(e, index)}
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
              onClick={async (e) => {
                e.stopPropagation();
                if (tab.isDirty) {
                  if (confirm(`Save "${tab.fileName}" before closing?`)) {
                    try {
                      if (tab.filePath.startsWith("untitled:")) {
                        const targetPath = await save({ defaultPath: tab.fileName });
                        if (!targetPath) return;
                        await saveFileAs(tab.id, targetPath);
                      } else {
                        await saveFile(tab.id);
                      }
                      closeTab(tab.id);
                    } catch (error) {
                      console.error("Failed to save before closing tab:", error);
                    }
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
      
      {activeTab && (
        <div style={{ display: 'flex', alignItems: 'center', padding: '0 8px', gap: '4px', flexShrink: 0 }}>
          {hasTestSupport(activeTab.language) && (
            <button 
              className="btn-icon" 
              onClick={handleTest}
              title={`Test ${activeTab.fileName}`}
              style={{ padding: '4px 8px', display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: 'var(--text-secondary)', background: 'transparent', border: 'none', cursor: 'pointer', borderRadius: '4px' }}
              onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text-primary)'; e.currentTarget.style.background = 'var(--bg-hover)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-secondary)'; e.currentTarget.style.background = 'transparent'; }}
            >
              <TestTube2 size={14} />
            </button>
          )}
          {hasRunSupport(activeTab.language) && (
            <button 
              className="btn-icon" 
              onClick={handleRun}
              title={`Run ${activeTab.fileName}`}
              style={{ padding: '4px 8px', display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: 'var(--text-secondary)', background: 'transparent', border: 'none', cursor: 'pointer', borderRadius: '4px' }}
              onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--success)'; e.currentTarget.style.background = 'var(--bg-hover)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-secondary)'; e.currentTarget.style.background = 'transparent'; }}
            >
              <Play size={14} />
              <span>Run</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
});
