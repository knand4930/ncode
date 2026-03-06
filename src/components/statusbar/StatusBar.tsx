// src/components/statusbar/StatusBar.tsx
import { memo, useEffect, useState, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useEditorStore } from "../../store/editorStore";
import { useUIStore } from "../../store/uiStore";
import { useAIStore } from "../../store/aiStore";
import { GitBranch, Terminal, Bot, Settings } from "lucide-react";

export const StatusBar = memo(function StatusBar() {
  const { tabs, activeTabId, openFolder } = useEditorStore();
  const { toggleTerminal, toggleAIPanel, toggleSettingsPanel, setActiveView } = useUIStore();
  const {
    isOllamaRunning,
    selectedProvider,
    selectedOllamaModels,
    selectedApiKeyIndex,
    apiKeys,
  } = useAIStore();

  const activeTab = tabs.find((t) => t.id === activeTabId);
  const [branch, setBranch] = useState("main");

  const [gitCounts, setGitCounts] = useState({ staged: 0, unstaged: 0, total: 0 });

  useEffect(() => {
    if (!openFolder) {
      setBranch("main");
      setGitCounts({ staged: 0, unstaged: 0, total: 0 });
      return;
    }

    const loadGitInfo = async () => {
      try {
        const branchOut = await invoke<string>("run_command", {
          cmd: "git rev-parse --abbrev-ref HEAD",
          cwd: openFolder,
        });
        const name = branchOut.trim();
        if (name) setBranch(name);
      } catch (e) {
        setBranch("(no repo)");
      }

      try {
        const statusOut = await invoke<string>("run_command", {
          cmd: "git status --porcelain",
          cwd: openFolder,
        });
        const lines = statusOut.split('\n').filter(Boolean);
        let staged = 0;
        let unstaged = 0;
        for (const l of lines) {
          const code = l.slice(0, 2);
          if (/[^\s]/.test(code[0] || '')) staged++;
          if (/[^\s]/.test(code[1] || '')) unstaged++;
        }
        setGitCounts({ staged, unstaged, total: lines.length });
      } catch (e) {
        setGitCounts({ staged: 0, unstaged: 0, total: 0 });
      }
    };

    loadGitInfo();
  }, [openFolder, activeTabId]);

  // Memoize AI label to avoid recomputation on every render
  const aiLabel = useMemo(() => {
    if (isOllamaRunning || selectedProvider === "api") {
      if (selectedProvider === "ollama") {
        return selectedOllamaModels.length === 1
          ? selectedOllamaModels[0].split(":")[0]
          : `${selectedOllamaModels.length} models`;
      }
      return apiKeys[selectedApiKeyIndex ?? 0]?.provider || "API";
    }
    return "AI Offline";
  }, [isOllamaRunning, selectedProvider, selectedOllamaModels, selectedApiKeyIndex, apiKeys]);

  return (
    <div className="status-bar">
      <div className="status-left">
        <button
          className="status-item status-branch"
          onClick={() => setActiveView("git")}
          title="Open Source Control"
        >
          <GitBranch size={13} />
          <span>{branch}</span>
        </button>
      </div>

      <div className="status-right">
        {activeTab && (
          <>
            <span className="status-item">
              {activeTab.language}
            </span>
            <span className="status-item">
              Ln {activeTab.cursorPosition.line}, Col {activeTab.cursorPosition.column}
            </span>
            {activeTab.isDirty && (
              <span className="status-item status-dirty">● Unsaved</span>
            )}
          </>
        )}

        <button
          className={`status-item ${isOllamaRunning ? "status-ai-on" : "status-ai-off"}`}
          onClick={toggleAIPanel}
          title="AI Assistant"
        >
          <Bot size={13} />
          <span>{aiLabel}</span>
        </button>

        <button className="status-item" onClick={toggleTerminal} title="Terminal">
          <Terminal size={13} />
        </button>

        <button
          className="status-item"
          onClick={toggleSettingsPanel}
          title="Settings"
        >
          <Settings size={13} />
        </button>
      </div>
    </div>
  );
});
