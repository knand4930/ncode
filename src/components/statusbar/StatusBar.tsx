// src/components/statusbar/StatusBar.tsx
import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useEditorStore } from "../../store/editorStore";
import { useUIStore } from "../../store/uiStore";
import { useAIStore } from "../../store/aiStore";
import { GitBranch, Terminal, Bot, Settings } from "lucide-react";

export function StatusBar() {
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

  useEffect(() => {
    if (!openFolder) {
      setBranch("main");
      return;
    }
    invoke<string>("run_command", {
      cmd: "git rev-parse --abbrev-ref HEAD",
      cwd: openFolder,
    })
      .then((out) => {
        const name = out.trim();
        if (name) setBranch(name);
      })
      .catch(() => {});
  }, [openFolder, activeTabId]);

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
          <span>
            {isOllamaRunning || selectedProvider === "api" ? (
              selectedProvider === "ollama" ? (
                selectedOllamaModels.length === 1 ? (
                  selectedOllamaModels[0].split(":")[0]
                ) : (
                  `${selectedOllamaModels.length} models`
                )
              ) : (
                apiKeys[selectedApiKeyIndex ?? 0]?.provider || "API"
              )
            ) : (
              "AI Offline"
            )}
          </span>
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
}
