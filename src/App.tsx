// src/App.tsx
import { useEffect } from "react";
import { PanelGroup, Panel, PanelResizeHandle } from "react-resizable-panels";
import { ActivityBar } from "./components/sidebar/ActivityBar";
import { Sidebar } from "./components/sidebar/Sidebar";
import { EditorTabs } from "./components/editor/EditorTabs";
import { EditorBreadcrumbs } from "./components/editor/EditorBreadcrumbs";
import { EditorArea } from "./components/editor/EditorArea";
import { Terminal } from "./components/terminal/Terminal";
import { AIPanel } from "./components/ai/AIPanel";
import { StatusBar } from "./components/statusbar/StatusBar";
import { SettingsPanel } from "./components/settings/SettingsPanel";
import { CommandPalette } from "./components/editor/CommandPalette";
import { QuickOpenPanel } from "./components/editor/QuickOpenPanel";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { useEditorStore } from "./store/editorStore";
import { useUIStore } from "./store/uiStore";
import { useAIStore } from "./store/aiStore";
import "./index.css";

export default function App() {
  const {
    showTerminal,
    showAIPanel,
    showCommandPalette,
    showSettingsPanel,
    showQuickOpen,
  } = useUIStore();
  const { checkOllama } = useAIStore();
  const {
    setActiveView,
    toggleCommandPalette,
    toggleQuickOpen,
    toggleSettingsPanel,
    toggleTerminal,
    toggleAIPanel,
  } = useUIStore();
  const { activeTabId, closeTab, saveFile, saveAllFiles } = useEditorStore();

  useEffect(() => {
    checkOllama();
  }, [checkOllama]);

  // Global keyboard shortcuts
  useEffect(() => {
    const isTypingTarget = (target: EventTarget | null) => {
      const el = target as HTMLElement | null;
      if (!el) return false;
      const tag = el.tagName;
      return tag === "INPUT" || tag === "TEXTAREA" || el.isContentEditable;
    };

    const handler = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      if (isTypingTarget(e.target)) return;

      const key = e.key.toLowerCase();
      if (e.shiftKey) {
        switch (key) {
          case "p":
            e.preventDefault();
            if (!showCommandPalette) toggleCommandPalette();
            if (showQuickOpen) toggleQuickOpen();
            return;
          case "a":
            e.preventDefault();
            toggleAIPanel();
            return;
          case "e":
            e.preventDefault();
            setActiveView("explorer");
            return;
          case "f":
            e.preventDefault();
            setActiveView("search");
            return;
          case "g":
            e.preventDefault();
            setActiveView("git");
            return;
          case "x":
            e.preventDefault();
            setActiveView("extensions");
            return;
          case "s":
            e.preventDefault();
            saveAllFiles();
            return;
        }
      }

      switch (key) {
        case "p":
          e.preventDefault();
          if (!showQuickOpen) toggleQuickOpen();
          if (showCommandPalette) toggleCommandPalette();
          break;
        case "s":
          e.preventDefault();
          if (activeTabId) saveFile(activeTabId);
          break;
        case "w":
          e.preventDefault();
          if (activeTabId) closeTab(activeTabId);
          break;
        case "t":
          e.preventDefault();
          setActiveView("symbols");
          break;
        case "h":
          e.preventDefault();
          setActiveView("search-replace");
          break;
        case "b":
          e.preventDefault();
          // VS Code standard is to toggle sidebar visibility, but since we rely on views,
          // falling back to opening 'explorer' view for Ctrl+B
          setActiveView("explorer");
          break;
        case "/":
          // The Monaco editor handles Ctrl+/ internally for Toggle Comment
          break;
        case "`":
          e.preventDefault();
          toggleTerminal();
          break;
        case ",":
          e.preventDefault();
          toggleSettingsPanel();
          break;
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [
    activeTabId,
    closeTab,
    saveAllFiles,
    saveFile,
    setActiveView,
    showCommandPalette,
    showQuickOpen,
    toggleAIPanel,
    toggleCommandPalette,
    toggleQuickOpen,
    toggleSettingsPanel,
    toggleTerminal,
  ]);

  return (
    <div className="app-root">
      {showQuickOpen && <QuickOpenPanel />}
      {/* Command Palette */}
      {showCommandPalette && <CommandPalette />}

      {/* Settings Panel Modal */}
      {showSettingsPanel && (
        <>
          <div className="modal-overlay" onClick={toggleSettingsPanel} />
          <div className="settings-modal">
            <SettingsPanel />
          </div>
        </>
      )}

      {/* Main layout */}
      <div className="app-body">
        {/* Activity Bar (left icons) */}
        <ActivityBar />

        <PanelGroup direction="horizontal" className="flex-1">
          {/* Sidebar */}
          <Panel defaultSize={18} minSize={10} maxSize={40} id="sidebar">
            <Sidebar />
          </Panel>

          <PanelResizeHandle className="resize-handle-vertical" />

          {/* Editor + Terminal */}
          <Panel id="main">
            <PanelGroup direction="vertical">
              {/* Editor */}
              <Panel id="editor" minSize={30}>
                <div className="editor-container">
                  <EditorTabs />
                  <EditorBreadcrumbs />
                  <ErrorBoundary fallbackLabel="Editor">
                    <EditorArea />
                  </ErrorBoundary>
                </div>
              </Panel>

              {/* Terminal (toggleable) */}
              {showTerminal && (
                <>
                  <PanelResizeHandle className="resize-handle-horizontal" />
                  <Panel defaultSize={25} minSize={15} maxSize={50} id="terminal">
                    <ErrorBoundary fallbackLabel="Terminal">
                      <Terminal />
                    </ErrorBoundary>
                  </Panel>
                </>
              )}
            </PanelGroup>
          </Panel>

          {/* AI Panel (Cursor-like) */}
          {showAIPanel && (
            <>
              <PanelResizeHandle className="resize-handle-vertical" />
              <Panel defaultSize={28} minSize={20} maxSize={50} id="ai">
                <ErrorBoundary fallbackLabel="AI Panel">
                  <AIPanel />
                </ErrorBoundary>
              </Panel>
            </>
          )}
        </PanelGroup>
      </div>

      {/* Status Bar */}
      <StatusBar />
    </div>
  );
}
