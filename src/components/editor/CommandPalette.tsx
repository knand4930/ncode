// src/components/editor/CommandPalette.tsx
import { useState, useEffect, useRef } from "react";
import { useEditorStore } from "../../store/editorStore";
import { useUIStore } from "../../store/uiStore";
import { useAIStore } from "../../store/aiStore";
import { useTerminalStore } from "../../store/terminalStore";
import {
  getRunCommand,
  getTestCommand,
  getLintCommand,
  getFormatCommand,
  getInitCommand,
  getBuildCommand,
} from "../../utils/languageRunner";

interface Command {
  id: string;
  label: string;
  category: string;
  keybind?: string;
  action: () => void;
}

function runInTerminal(
  cmd: string,
  cwd: string | null,
  addToast: (msg: string, type: "info" | "success" | "error" | "warning") => void
) {
  if (!cwd) {
    addToast("Open a project folder first.", "warning");
    return;
  }

  const safeCwd = cwd.replace(/"/g, '\\"');
  const terminalCommand = `cd "${safeCwd}" && ${cmd}`;
  useTerminalStore.getState().showAndTrackCommand(terminalCommand, {
    source: "manual",
    analyzeWithAI: false,
  });
  useTerminalStore.getState().showTerminalTab("terminal");
  addToast(`Queued in terminal: ${cmd}`, "info");
}

export function CommandPalette() {
  const {
    toggleCommandPalette,
    toggleTerminal,
    toggleAIPanel,
    setTheme,
    toggleSettingsPanel,
    openView,
    showSidebar,
    toggleSidebar,
    toggleQuickOpen,
    addToast,
  } = useUIStore();
  const { saveAllFiles, activeTabId, tabs, openFolder } = useEditorStore();
  const { setAIMode, toggleRAG, sendMessage } = useAIStore();
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const activeTab = tabs.find((t) => t.id === activeTabId);
  const lang = activeTab?.language || "";
  const filePath = activeTab?.filePath || "";
  const fileName = activeTab?.fileName || "";

  const ensureAIPanelOpen = () => {
    const { showAIPanel, toggleAIPanel } = useUIStore.getState();
    if (!showAIPanel) toggleAIPanel();
  };

  const commands: Command[] = [
    // ── File ──
    { id: "save-all", category: "File", label: "File: Save All", keybind: "Ctrl+Shift+S", action: saveAllFiles },
    { id: "quick-open", category: "File", label: "File: Quick Open", keybind: "Ctrl+P", action: toggleQuickOpen },

    // ── View ──
    { id: "view-explorer", category: "View", label: "View: Explorer", keybind: "Ctrl+Shift+E", action: () => openView("explorer") },
    { id: "view-search", category: "View", label: "View: Search", keybind: "Ctrl+Shift+F", action: () => openView("search") },
    { id: "view-search-replace", category: "View", label: "View: Search & Replace", keybind: "Ctrl+H", action: () => openView("search-replace") },
    { id: "view-git", category: "View", label: "View: Source Control", keybind: "Ctrl+Shift+G", action: () => openView("git") },
    { id: "view-ext", category: "View", label: "View: Extensions", keybind: "Ctrl+Shift+X", action: () => openView("extensions") },
    { id: "view-keybindings", category: "View", label: "View: Keybindings", action: () => openView("keybindings") },
    {
      id: "view-toggle-sidebar",
      category: "View",
      label: showSidebar ? "View: Hide Primary Side Bar" : "View: Show Primary Side Bar",
      keybind: "Ctrl+B",
      action: toggleSidebar,
    },
    { id: "toggle-terminal", category: "View", label: "View: Toggle Terminal", keybind: "Ctrl+`", action: toggleTerminal },
    { id: "toggle-ai", category: "View", label: "View: Toggle AI Panel", keybind: "Ctrl+Shift+A", action: toggleAIPanel },

    // ── Preferences ──
    { id: "open-settings", category: "Preferences", label: "Preferences: Settings", keybind: "Ctrl+,", action: toggleSettingsPanel },
    { id: "theme-dark", category: "Preferences", label: "Preferences: Dark Theme", action: () => setTheme("dark") },
    { id: "theme-light", category: "Preferences", label: "Preferences: Light Theme", action: () => setTheme("light") },

    // ── Run ──
    ...(getRunCommand(lang, filePath, fileName)
      ? [{
        id: "run-file",
        category: "Run",
        label: `Run: Run ${fileName || "File"} (${lang})`,
        keybind: "F5",
        action: () => runInTerminal(getRunCommand(lang, filePath, fileName)!, openFolder, addToast),
      }]
      : []),
    ...(getBuildCommand(lang, filePath, fileName)
      ? [{
        id: "run-build",
        category: "Run",
        label: `Run: Build (${lang})`,
        keybind: "Ctrl+Shift+B",
        action: () => runInTerminal(getBuildCommand(lang, filePath, fileName)!, openFolder, addToast),
      }]
      : []),

    // ── Test ──
    ...(getTestCommand(lang, filePath, fileName)
      ? [{
        id: "test-run",
        category: "Test",
        label: `Test: Run Tests (${lang})`,
        action: () => runInTerminal(getTestCommand(lang, filePath, fileName)!, openFolder, addToast),
      }]
      : []),

    // ── Lint / Format ──
    ...(getLintCommand(lang, filePath, fileName)
      ? [{
        id: "lint-file",
        category: "Lint",
        label: `Lint: Check ${fileName || "File"} (${lang})`,
        action: () => runInTerminal(getLintCommand(lang, filePath, fileName)!, openFolder, addToast),
      }]
      : []),
    ...(getFormatCommand(lang, filePath, fileName)
      ? [{
        id: "format-file",
        category: "Format",
        label: `Format: Format ${fileName || "File"} (${lang})`,
        action: () => runInTerminal(getFormatCommand(lang, filePath, fileName)!, openFolder, addToast),
      }]
      : []),

    // ── Project ──
    ...(getInitCommand(lang, filePath, fileName)
      ? [{
        id: "project-init",
        category: "Project",
        label: `Project: Install Dependencies (${lang})`,
        action: () => runInTerminal(getInitCommand(lang, filePath, fileName)!, openFolder, addToast),
      }]
      : []),

    // ── Git ──
    {
      id: "git-commit",
      category: "Git",
      label: "Git: Commit All Changes",
      action: async () => {
        const msg = prompt("Commit message:");
        if (msg && openFolder) {
          await runInTerminal(`git add -A && git commit -m "${msg.replace(/"/g, '\\"')}"`, openFolder, addToast);
        }
      },
    },
    {
      id: "git-push",
      category: "Git",
      label: "Git: Push",
      action: () => runInTerminal("git push", openFolder, addToast),
    },
    {
      id: "git-pull",
      category: "Git",
      label: "Git: Pull",
      action: () => runInTerminal("git pull", openFolder, addToast),
    },
    {
      id: "git-status",
      category: "Git",
      label: "Git: Status",
      action: () => runInTerminal("git status", openFolder, addToast),
    },

    // ── AI Modes ──
    { id: "ai-chat", category: "AI", label: "AI: Chat Mode", action: () => setAIMode("chat") },
    { id: "ai-think", category: "AI", label: "AI: Think Mode (step-by-step reasoning)", action: () => setAIMode("think") },
    { id: "ai-agent", category: "AI", label: "AI: Agent Mode (autonomous)", action: () => setAIMode("agent") },
    { id: "ai-bughunt", category: "AI", label: "AI: Bug Hunt Mode 🐛", action: () => setAIMode("bug_hunt") },
    { id: "ai-architect", category: "AI", label: "AI: Architect Mode 🏗️", action: () => setAIMode("architect") },
    { id: "ai-rag-toggle", category: "AI", label: "AI: Toggle RAG", action: toggleRAG },
    {
      id: "ai-review-file",
      category: "AI",
      label: "AI: Review Current File",
      action: () => {
        if (activeTab) {
          ensureAIPanelOpen();
          sendMessage(`Review this code for bugs, performance, and best practices:\n\n\`\`\`${activeTab.language}\n// ${activeTab.fileName}\n${activeTab.content.slice(0, 4000)}\n\`\`\``);
        }
      },
    },
    {
      id: "ai-debug-file",
      category: "AI",
      label: "AI: Debug Current File 🐛",
      action: () => {
        if (activeTab) {
          ensureAIPanelOpen();
          setAIMode("bug_hunt");
          sendMessage(`Find all bugs in this file:\n\n\`\`\`${activeTab.language}\n// ${activeTab.fileName}\n${activeTab.content.slice(0, 4000)}\n\`\`\``);
        }
      },
    },
    {
      id: "ai-explain-file",
      category: "AI",
      label: "AI: Explain Current File",
      action: () => {
        if (activeTab) {
          ensureAIPanelOpen();
          sendMessage(`Explain this code in detail:\n\n\`\`\`${activeTab.language}\n// ${activeTab.fileName}\n${activeTab.content.slice(0, 4000)}\n\`\`\``);
        }
      },
    },
    {
      id: "ai-write-tests",
      category: "AI",
      label: "AI: Write Tests for Current File",
      action: () => {
        if (activeTab) {
          ensureAIPanelOpen();
          sendMessage(`Write comprehensive unit tests for this code:\n\n\`\`\`${activeTab.language}\n// ${activeTab.fileName}\n${activeTab.content.slice(0, 4000)}\n\`\`\``);
        }
      },
    },
  ];

  const filtered = query
    ? commands.filter((c) =>
      c.label.toLowerCase().includes(query.toLowerCase()) ||
      c.category.toLowerCase().includes(query.toLowerCase())
    )
    : commands;

  useEffect(() => {
    inputRef.current?.focus();
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") toggleCommandPalette();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [toggleCommandPalette]);

  return (
    <div className="command-palette-overlay" onClick={toggleCommandPalette}>
      <div className="command-palette" onClick={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="> Type a command..."
          className="command-input"
        />
        <div className="command-list">
          {filtered.length === 0 && (
            <div style={{ padding: "12px 16px", color: "#6b6b6b", fontSize: 12 }}>
              No matching commands
            </div>
          )}
          {filtered.map((cmd) => (
            <button
              key={cmd.id}
              className="command-item"
              onClick={() => {
                cmd.action();
                toggleCommandPalette();
              }}
            >
              <span>
                <span style={{ color: "#6b6b6b", fontSize: 11, marginRight: 8 }}>{cmd.category}</span>
                {cmd.label.replace(`${cmd.category}: `, "")}
              </span>
              {cmd.keybind && <kbd>{cmd.keybind}</kbd>}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
