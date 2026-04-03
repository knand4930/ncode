// src/components/statusbar/StatusBar.tsx
import { memo, useEffect, useState, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useEditorStore } from "../../store/editorStore";
import { useUIStore } from "../../store/uiStore";
import { useAIStore } from "../../store/aiStore";
import { useTerminalStore } from "../../store/terminalStore";
import { AlertCircle, AlertTriangle, GitBranch, Terminal, Bot, Settings, Play, ListTodo, Info } from "lucide-react";
import { getRunCommand } from "../../utils/languageRunner";

export const StatusBar = memo(function StatusBar() {
  const { tabs, activeTabId, openFolder } = useEditorStore();
  const {
    toggleTerminal,
    toggleAIPanel,
    toggleSettingsPanel,
    openView,
    tabSize,
    colorTheme,
  } = useUIStore();
  const {
    isOllamaRunning,
    selectedProvider,
    selectedOllamaModels,
    selectedApiKeyIndices,
    apiKeys,
  } = useAIStore();
  const { lastErrors } = useTerminalStore();

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
      } catch {
        setBranch("(no repo)");
      }

      try {
        const statusOut = await invoke<string>("run_command", {
          cmd: "git status --porcelain",
          cwd: openFolder,
        });
        const lines = statusOut.split('\n').filter(Boolean);
        let staged = 0, unstaged = 0;
        for (const l of lines) {
          const code = l.slice(0, 2);
          if (/[^\s]/.test(code[0] || '')) staged++;
          if (/[^\s]/.test(code[1] || '')) unstaged++;
        }
        setGitCounts({ staged, unstaged, total: lines.length });
      } catch {
        setGitCounts({ staged: 0, unstaged: 0, total: 0 });
      }
    };

    loadGitInfo();
  }, [openFolder, activeTabId]);

  const aiLabel = useMemo(() => {
    if (isOllamaRunning || selectedProvider === "api") {
      if (selectedProvider === "ollama") {
        return selectedOllamaModels.length === 1
          ? selectedOllamaModels[0].split(":")[0]
          : `${selectedOllamaModels.length} models`;
      }
      return apiKeys[selectedApiKeyIndices[0] ?? 0]?.provider || "API";
    }
    return "AI Offline";
  }, [isOllamaRunning, selectedProvider, selectedOllamaModels, selectedApiKeyIndices, apiKeys]);

  const problemCounts = useMemo(() => {
    return lastErrors.reduce(
      (counts, error) => {
        if (error.severity === "warning") {
          counts.warnings += 1;
        } else if (error.severity === "info") {
          counts.info += 1;
        } else {
          counts.errors += 1;
        }
        return counts;
      },
      { errors: 0, warnings: 0, info: 0 }
    );
  }, [lastErrors]);

  const themeLabel = useMemo(() => {
    switch (colorTheme) {
      case "dark":
        return "One Dark Pro";
      case "light":
        return "One Light";
      case "high-contrast":
        return "High Contrast";
      case "solarized-dark":
        return "Solarized Dark";
      case "monokai":
        return "Monokai";
      case "github":
        return "GitHub Dark";
      case "dracula":
        return "Dracula";
      default:
        return "One Dark Pro";
    }
  }, [colorTheme]);

  const eolLabel = useMemo(() => {
    if (!activeTab) return "LF";
    return activeTab.content.includes("\r\n") ? "CRLF" : "LF";
  }, [activeTab]);

  const runCmd = activeTab ? getRunCommand(activeTab.language, activeTab.filePath, activeTab.fileName) : null;

  const handleRunFile = () => {
    if (!runCmd) return;
    useTerminalStore.getState().showAndRunCommand(runCmd);
  };

  const openProblems = () => {
    useTerminalStore.getState().showTerminalTab("problems");
  };

  return (
    <div className="status-bar">
      <div className="status-left">
        <button
          className="status-item status-branch"
          onClick={() => openView("git")}
          title="Open Source Control"
        >
          <GitBranch size={13} />
          <span>{branch}</span>
          {gitCounts.total > 0 && (
            <span style={{ opacity: 0.7, fontSize: 11 }}>
              {gitCounts.staged > 0 ? ` +${gitCounts.staged}` : ""}
              {gitCounts.unstaged > 0 ? ` ~${gitCounts.unstaged}` : ""}
            </span>
          )}
        </button>

        <button className="status-item status-problems" onClick={openProblems} title="Problems (click to open)">
          <AlertCircle size={13} className={problemCounts.errors > 0 ? "status-err-icon" : ""} />
          <span>{problemCounts.errors}</span>
          {problemCounts.warnings > 0 && (
            <>
              <AlertTriangle size={12} className="status-warn-icon" />
              <span>{problemCounts.warnings}</span>
            </>
          )}
          {problemCounts.info > 0 && (
            <>
              <Info size={11} className="status-info-icon" />
              <span>{problemCounts.info}</span>
            </>
          )}
        </button>

        <button
          className="status-item"
          onClick={() => openView("tasks")}
          title="Tasks"
        >
          <ListTodo size={13} />
          <span>Tasks</span>
        </button>

        {runCmd && (
          <button
            className="status-item"
            onClick={handleRunFile}
            title={`Run: ${runCmd}`}
            style={{ color: "#4fc1ff" }}
          >
            <Play size={11} />
            <span style={{ fontSize: 11 }}>Run</span>
          </button>
        )}
      </div>

      <div className="status-right">
        {activeTab && (
          <>
            <span className="status-item">{activeTab.language}</span>
            <span className="status-item">
              Ln {activeTab.cursorPosition.line}, Col {activeTab.cursorPosition.column}
            </span>
            <span className="status-item status-optional">Spaces: {tabSize}</span>
            <span className="status-item status-optional">UTF-8</span>
            <span className="status-item status-optional">{eolLabel}</span>
            <button
              className="status-item status-optional"
              onClick={toggleSettingsPanel}
              title="Color Theme"
            >
              <span>{themeLabel}</span>
            </button>
            {activeTab.isDirty && (
              <span className="status-item status-dirty">● Unsaved</span>
            )}
          </>
        )}

        <button
          className={`status-item ${isOllamaRunning ? "status-ai-on" : "status-ai-off"}`}
          onClick={toggleAIPanel}
          title="AI Assistant (Ctrl+Shift+A)"
        >
          <Bot size={13} />
          <span>{aiLabel}</span>
        </button>

        <button className="status-item" onClick={toggleTerminal} title="Terminal (Ctrl+`)">
          <Terminal size={13} />
        </button>

        <button className="status-item" onClick={toggleSettingsPanel} title="Settings (Ctrl+,)">
          <Settings size={13} />
        </button>
      </div>
    </div>
  );
});
