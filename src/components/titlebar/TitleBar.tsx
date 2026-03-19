import { memo } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import {
  Bot,
  ChevronLeft,
  ChevronRight,
  Files,
  FolderOpen,
  PanelLeft,
  Save,
  Search,
  Settings,
  Terminal,
} from "lucide-react";
import { useEditorStore } from "../../store/editorStore";
import { useUIStore } from "../../store/uiStore";
import { useAIStore } from "../../store/aiStore";
import { formatShortcut } from "../../utils/os";
import { MenuBar } from "./MenuBar";

export const TitleBar = memo(function TitleBar() {
  const { openFolder, setOpenFolder, tabs, activeTabId, saveAllFiles, setActiveTab } = useEditorStore();
  const {
    showSidebar,
    showAIPanel,
    showTerminal,
    showCommandCenter,
    showCommandPalette,
    showQuickOpen,
    openView,
    toggleSidebar,
    toggleAIPanel,
    toggleTerminal,
    toggleCommandPalette,
    toggleQuickOpen,
    toggleSettingsPanel,
  } = useUIStore();
  const { setOpenFolder: setAIOpenFolder } = useAIStore();

  const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? null;
  const activeIndex = activeTabId ? tabs.findIndex((tab) => tab.id === activeTabId) : -1;
  const dirtyCount = tabs.filter((tab) => tab.isDirty).length;
  const workspaceName = openFolder?.split(/[\\/]/).pop() || "No Folder Opened";
  const workspaceHint = openFolder || "Open a project folder to browse files, run tasks, and search the workspace.";

  const openFolderDialog = async () => {
    const selected = await open({ directory: true, multiple: false });
    if (typeof selected !== "string") return;

    setOpenFolder(selected);
    setAIOpenFolder(selected);
    openView("explorer");
  };

  const openCommands = () => {
    if (showQuickOpen) toggleQuickOpen();
    if (!showCommandPalette) toggleCommandPalette();
  };

  const openFiles = () => {
    if (showCommandPalette) toggleCommandPalette();
    if (!showQuickOpen) toggleQuickOpen();
  };

  const saveAll = () => {
    saveAllFiles().catch((error) => {
      console.error("Save all failed:", error);
    });
  };

  const goBack = () => {
    if (activeIndex > 0) {
      setActiveTab(tabs[activeIndex - 1].id);
    }
  };

  const goForward = () => {
    if (activeIndex >= 0 && activeIndex < tabs.length - 1) {
      setActiveTab(tabs[activeIndex + 1].id);
    }
  };

  return (
    <header className="titlebar">
      <div className="titlebar-left">
        <button className="titlebar-brand" onClick={() => openView("explorer")} title={workspaceHint}>
          <span className="titlebar-brand-mark">⌘</span>
          <span className="titlebar-brand-copy">
            <strong>NCode</strong>
            <span>{workspaceName}</span>
          </span>
        </button>

        <MenuBar />

        <div className="titlebar-nav" aria-label="Navigation">
          <button
            className="titlebar-nav-button"
            onClick={goBack}
            disabled={activeIndex <= 0}
            title="Back"
          >
            <ChevronLeft size={14} />
          </button>
          <button
            className="titlebar-nav-button"
            onClick={goForward}
            disabled={activeIndex < 0 || activeIndex >= tabs.length - 1}
            title="Forward"
          >
            <ChevronRight size={14} />
          </button>
        </div>

        <div className="titlebar-meta">
          <span className="titlebar-chip">{tabs.length} open</span>
          {dirtyCount > 0 && <span className="titlebar-chip dirty">{dirtyCount} unsaved</span>}
        </div>
      </div>

      {showCommandCenter && (
        <button className="titlebar-command-center" onClick={openCommands} title="Open Command Palette">
          <Search size={14} />
          <span className="titlebar-command-text">
            {activeTab ? `${activeTab.fileName} • Search commands, files, settings` : "Search commands, files, settings"}
          </span>
          <kbd>{formatShortcut("Ctrl+Shift+P")}</kbd>
        </button>
      )}

      <div className="titlebar-actions">
        <button className="titlebar-action" onClick={openFolderDialog} title="Open Folder">
          <FolderOpen size={14} />
          <span>Open</span>
        </button>
        <button
          className={`titlebar-action ${showSidebar ? "active" : ""}`}
          onClick={toggleSidebar}
          title="Toggle Primary Side Bar"
        >
          <PanelLeft size={14} />
          <span>Sidebar</span>
        </button>
        <button className="titlebar-action" onClick={openFiles} title="Quick Open">
          <Files size={14} />
          <span>Files</span>
        </button>
        <button className="titlebar-action" onClick={saveAll} title="Save All">
          <Save size={14} />
          <span>Save</span>
        </button>
        <button
          className={`titlebar-action ${showTerminal ? "active" : ""}`}
          onClick={toggleTerminal}
          title="Toggle Terminal"
        >
          <Terminal size={14} />
        </button>
        <button
          className={`titlebar-action ${showAIPanel ? "active" : ""}`}
          onClick={toggleAIPanel}
          title="Toggle AI Assistant"
        >
          <Bot size={14} />
        </button>
        <button className="titlebar-action" onClick={toggleSettingsPanel} title="Open Settings">
          <Settings size={14} />
        </button>
      </div>
    </header>
  );
});
