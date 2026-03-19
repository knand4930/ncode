// src/App.tsx
import { useEffect, useRef } from "react";
import { PanelGroup, Panel, PanelResizeHandle, type ImperativePanelHandle } from "react-resizable-panels";
import { ActivityBar } from "./components/sidebar/ActivityBar";
import { Sidebar } from "./components/sidebar/Sidebar";
import { EditorTabs } from "./components/editor/EditorTabs";
import { EditorBreadcrumbs } from "./components/editor/EditorBreadcrumbs";
import { EditorArea } from "./components/editor/EditorArea";
import { Terminal } from "./components/terminal/Terminal";
import { AIPanel } from "./components/ai/AIPanel";
import { StatusBar } from "./components/statusbar/StatusBar";
import { SettingsPanel } from "./components/settings/SettingsPanel";
import { TitleBar } from "./components/titlebar/TitleBar";
import { CommandPalette } from "./components/editor/CommandPalette";
import { QuickOpenPanel } from "./components/editor/QuickOpenPanel";
import { ToastContainer } from "./components/ui/ToastContainer";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { useEditorStore } from "./store/editorStore";
import { useUIStore } from "./store/uiStore";
import { useAIStore } from "./store/aiStore";
import "./index.css";

export default function App() {
  const terminalPanelRef = useRef<ImperativePanelHandle | null>(null);
  const {
    showActivityBar,
    showSidebar,
    showStatusBar,
    showTerminal,
    showAIPanel,
    showCommandPalette,
    showSettingsPanel,
    showQuickOpen,
    colorTheme,
    iconTheme,
    editorFont,
    uiFont,
  } = useUIStore();
  const { checkOllama } = useAIStore();
  const {
    openView,
    toggleCommandPalette,
    toggleQuickOpen,
    toggleSettingsPanel,
    toggleSidebar,
    toggleTerminal,
    toggleAIPanel,
  } = useUIStore();
  const { activeTabId, closeTab, saveFile, saveAllFiles } = useEditorStore();

  useEffect(() => {
    checkOllama();
  }, [checkOllama]);

  useEffect(() => {
    document.documentElement.style.setProperty("--font-mono", editorFont);
    document.documentElement.style.setProperty("--font-ui", uiFont);
  }, [editorFont, uiFont]);

  useEffect(() => {
    if (!terminalPanelRef.current) return;

    if (showTerminal) {
      terminalPanelRef.current.expand(25);
    } else {
      terminalPanelRef.current.collapse();
    }
  }, [showTerminal]);

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
            openView("explorer");
            return;
          case "f":
            e.preventDefault();
            openView("search");
            return;
          case "g":
            e.preventDefault();
            openView("git");
            return;
          case "x":
            e.preventDefault();
            openView("extensions");
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
          openView("symbols");
          break;
        case "h":
          e.preventDefault();
          openView("search-replace");
          break;
        case "b":
          e.preventDefault();
          toggleSidebar();
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
    openView,
    saveAllFiles,
    saveFile,
    showCommandPalette,
    showQuickOpen,
    toggleAIPanel,
    toggleCommandPalette,
    toggleQuickOpen,
    toggleSettingsPanel,
    toggleSidebar,
    toggleTerminal,
  ]);

  return (
    <div className="app-root" data-color-theme={colorTheme} data-icon-theme={iconTheme}>
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
      <TitleBar />
      <div className="app-body">
        {/* Activity Bar (left icons) */}
        {showActivityBar && <ActivityBar />}

        <PanelGroup direction="horizontal" className="flex-1">
          {/* Sidebar */}
          {showSidebar && (
            <>
              <Panel defaultSize={18} minSize={10} maxSize={40} id="sidebar">
                <Sidebar />
              </Panel>

              <PanelResizeHandle className="resize-handle-vertical" />
            </>
          )}

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
              <>
                <PanelResizeHandle
                  className={`resize-handle-horizontal ${showTerminal ? "" : "resize-handle-hidden"}`}
                />
                <Panel
                  ref={terminalPanelRef}
                  defaultSize={25}
                  minSize={15}
                  maxSize={50}
                  collapsible
                  collapsedSize={0}
                  id="terminal"
                >
                  <ErrorBoundary fallbackLabel="Terminal">
                    <Terminal />
                  </ErrorBoundary>
                </Panel>
              </>
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
      {showStatusBar && <StatusBar />}
      <ToastContainer />
    </div>
  );
}
