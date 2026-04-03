// src/components/editor/EditorArea.tsx
import { useRef, useEffect } from "react";
import MonacoEditor, { OnMount, OnChange } from "@monaco-editor/react";
import type * as Monaco from "monaco-editor";
import { open } from "@tauri-apps/plugin-dialog";
import { useEditorStore } from "../../store/editorStore";
import { useUIStore } from "../../store/uiStore";
import { useAIStore } from "../../store/aiStore";
import { useTerminalStore } from "../../store/terminalStore";
import { useReviewStore } from "../../store/reviewStore";
import { formatShortcut } from "../../utils/os";
import { getRunCommand, getTestCommand, getLintCommand } from "../../utils/languageRunner";
import { EDITOR_WORKBENCH_EVENT, type EditorWorkbenchAction } from "../../utils/workbenchActions";
import { analyzeFileContent } from "../../utils/errorParser";
import { DiffReviewPane } from "../ai/DiffModal";

export function EditorArea() {
  const {
    tabs,
    activeTabId,
    recentFiles,
    updateContent,
    openFile,
    saveFile,
    setCursorPosition,
    setOpenFolder,
  } = useEditorStore();
  const {
    colorTheme,
    fontSize,
    tabSize,
    wordWrap,
    minimapEnabled,
    columnSelectionMode,
    multiCursorModifier,
    formatOnSave,
    autoSave,
    showTerminal,
    toggleTerminal,
    toggleQuickOpen,
    toggleCommandPalette,
    inlineCompletionsEnabled,
  } = useUIStore();
  const { setOpenFolder: setAIOpenFolder } = useAIStore();
  const { runCommandInTerminal, lastErrors } = useTerminalStore();
  const {
    activeDiffReview,
    closeDiffReview,
    acceptDiffReview,
    rejectDiffReview,
    isApplyingDiffReview,
  } = useReviewStore();
  
  const editorRef = useRef<Monaco.editor.IStandaloneCodeEditor | null>(null);
  const monacoRef = useRef<typeof Monaco | null>(null);
  const inlineCompletionProviderRef = useRef<Monaco.IDisposable | null>(null);
  const saveTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeTabIdRef = useRef<string | null>(activeTabId);
  const activeTabRef = useRef<typeof activeTab>(undefined);
  const formatOnSaveRef = useRef<boolean>(formatOnSave);
  const terminalStoreRef = useRef({ runCommandInTerminal, showTerminal, toggleTerminal });

  const activeTab = tabs.find((t) => t.id === activeTabId);

  useEffect(() => {
    activeTabIdRef.current = activeTabId;
    activeTabRef.current = activeTab;
  }, [activeTabId, activeTab]);

  useEffect(() => {
    formatOnSaveRef.current = formatOnSave;
  }, [formatOnSave]);
  
  useEffect(() => {
    terminalStoreRef.current = { runCommandInTerminal, showTerminal, toggleTerminal };
  }, [runCommandInTerminal, showTerminal, toggleTerminal]);

  useEffect(() => {
    return () => {
      inlineCompletionProviderRef.current?.dispose();
      inlineCompletionProviderRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (inlineCompletionsEnabled || !editorRef.current) return;
    void editorRef.current.getAction("editor.action.inlineSuggest.hide")?.run();
  }, [inlineCompletionsEnabled]);

  // ── Sync terminal errors → Monaco markers ───────────────────────────────
  useEffect(() => {
    if (!editorRef.current || !monacoRef.current || !activeTab) return;
    const monaco = monacoRef.current;
    const model = editorRef.current.getModel();
    if (!model) return;

    // ── Terminal error markers ────────────────────────────────────────────
    const terminalMarkers: Monaco.editor.IMarkerData[] = lastErrors
      .filter(e => {
        if (!e.line) return false;
        if (!e.file) return true;
        const normFile = e.file.replace(/\\/g, "/");
        const normActive = activeTab.filePath.replace(/\\/g, "/");
        return normActive.endsWith(normFile) || normFile.endsWith(normActive.split("/").pop() ?? "");
      })
      .map(e => ({
        severity: e.severity === "warning"
          ? monaco.MarkerSeverity.Warning
          : e.severity === "info" || e.severity === "hint"
            ? monaco.MarkerSeverity.Info
            : monaco.MarkerSeverity.Error,
        startLineNumber: e.line ?? 1,
        startColumn: e.column ?? 1,
        endLineNumber: e.endLine ?? e.line ?? 1,
        endColumn: e.endColumn ?? (e.column ?? 1) + 30,
        message: e.suggestion
          ? `${e.title}\n${e.detail}\n💡 ${e.suggestion}`
          : e.installCommand
            ? `${e.title}\n${e.detail}\n🔧 Run: ${e.installCommand}`
            : e.detail ? `${e.title}\n${e.detail}` : e.title,
        source: e.source ?? "Terminal",
        code: e.code,
      }));

    // ── Static analysis markers (run on current file content) ─────────────
    const staticDiags = analyzeFileContent(activeTab.content, activeTab.language, activeTab.filePath);
    const staticMarkers: Monaco.editor.IMarkerData[] = staticDiags
      .filter(e => e.line)
      .map(e => ({
        severity: e.severity === "error"
          ? monaco.MarkerSeverity.Error
          : e.severity === "warning"
            ? monaco.MarkerSeverity.Warning
            : monaco.MarkerSeverity.Hint,
        startLineNumber: e.line!,
        startColumn: e.column ?? 1,
        endLineNumber: e.endLine ?? e.line!,
        endColumn: e.endColumn ?? (e.column ?? 1) + 20,
        message: e.suggestion
          ? `${e.title}\n${e.detail}\n💡 ${e.suggestion}`
          : e.detail ? `${e.title}\n${e.detail}` : e.title,
        source: e.source ?? "Inspection",
        code: e.code,
      }));

    monaco.editor.setModelMarkers(model, "terminal-errors", terminalMarkers);
    monaco.editor.setModelMarkers(model, "static-analysis", staticMarkers);
  }, [lastErrors, activeTab?.filePath, activeTab?.content, activeTab?.language]);

  const handleMount: OnMount = (editor, monaco) => {
    editorRef.current = editor;
    monacoRef.current = monaco;

    // VS Code-like keybindings
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, async () => {
      const currentTabId = activeTabIdRef.current;
      if (!currentTabId) return;
      if (formatOnSaveRef.current) {
        await editor.getAction("editor.action.formatDocument")?.run();
      }
      await saveFile(currentTabId);
    });

    // find / replace commands
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyF, () => {
      // open inline find widget
      editor.getAction("actions.find")?.run();
    });
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyH, () => {
      // open find & replace widget
      editor.getAction("editor.action.startFindReplaceAction")?.run();
    });
    editor.addCommand(monaco.KeyCode.F3, () => {
      editor.getAction("editor.action.nextMatchFindAction")?.run();
    });
    editor.addCommand(monaco.KeyMod.Shift | monaco.KeyCode.F3, () => {
      editor.getAction("editor.action.previousMatchFindAction")?.run();
    });

    // Custom Context Menu Actions for Language Runner
    editor.addAction({
      id: "ncode.runFile",
      label: "▶ Run File",
      contextMenuGroupId: "navigation",
      contextMenuOrder: 1,
      run: () => {
        const tab = activeTabRef.current;
        if (!tab) return;
        const cmd = getRunCommand(tab.language, tab.filePath, tab.fileName);
        if (cmd) useTerminalStore.getState().showAndRunCommand(cmd);
      }
    });

    editor.addAction({
      id: "ncode.testFile",
      label: "🧪 Test File",
      contextMenuGroupId: "navigation",
      contextMenuOrder: 2,
      run: () => {
        const tab = activeTabRef.current;
        if (!tab) return;
        const cmd = getTestCommand(tab.language, tab.filePath, tab.fileName);
        if (cmd) useTerminalStore.getState().showAndRunCommand(cmd);
      }
    });

    editor.addAction({
      id: "ncode.lintFile",
      label: "🔍 Lint File",
      contextMenuGroupId: "navigation",
      contextMenuOrder: 3,
      run: () => {
        const tab = activeTabRef.current;
        if (!tab) return;
        const cmd = getLintCommand(tab.language, tab.filePath, tab.fileName);
        if (cmd) useTerminalStore.getState().showAndRunCommand(cmd);
      }
    });

    // Navigation actions
    editor.addAction({
      id: "ncode.goToDefinition",
      label: "Go to Definition",
      keybindings: [monaco.KeyCode.F12],
      contextMenuGroupId: "navigation",
      contextMenuOrder: 0.5,
      run: () => editor.getAction("editor.action.revealDefinition")?.run(),
    });

    editor.addAction({
      id: "ncode.peekDefinition",
      label: "Peek Definition",
      keybindings: [monaco.KeyMod.Alt | monaco.KeyCode.F12],
      contextMenuGroupId: "navigation",
      contextMenuOrder: 0.6,
      run: () => editor.getAction("editor.action.peekDefinition")?.run(),
    });

    editor.addAction({
      id: "ncode.changeAllOccurrences",
      label: "Change All Occurrences",
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.F2],
      contextMenuGroupId: "3_slot1",
      contextMenuOrder: 1,
      run: () => editor.getAction("editor.action.changeAll")?.run(),
    });

    editor.addAction({
      id: "ncode.refactor",
      label: "Refactor...",
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyR],
      contextMenuGroupId: "1_modification",
      contextMenuOrder: 2,
      run: () => editor.getAction("editor.action.refactor")?.run(),
    });

    editor.addAction({
      id: "ncode.commandPalette",
      label: "Command Palette...",
      contextMenuGroupId: "z_commands",
      contextMenuOrder: 1,
      run: () => editor.getAction("editor.action.quickCommand")?.run(),
    });

    // Register AI inline completion provider (Req 8.1)
    // Always register the provider; it checks inlineCompletionsEnabled at call time
    inlineCompletionProviderRef.current?.dispose();
    inlineCompletionProviderRef.current = monaco.languages.registerInlineCompletionsProvider("*", {
      provideInlineCompletions: async (model, position, _context, token) => {
        if (!useUIStore.getState().inlineCompletionsEnabled) {
          return { items: [] };
        }

        const lineContent = model.getValueInRange({
          startLineNumber: Math.max(1, position.lineNumber - 20),
          startColumn: 1,
          endLineNumber: position.lineNumber,
          endColumn: position.column,
        });

        if (lineContent.trim().length < 5) {
          return { items: [] };
        }

        const lang = model.getLanguageId() || "plaintext";
        const completion = await useAIStore.getState().getInlineCompletion(lineContent, lang);

        if (token.isCancellationRequested || !completion) {
          return { items: [] };
        }

        return {
          items: [
            {
              insertText: completion,
              range: {
                startLineNumber: position.lineNumber,
                startColumn: position.column,
                endLineNumber: position.lineNumber,
                endColumn: position.column,
              },
            },
          ],
          enableForwardStability: false,
        };
      },
      freeInlineCompletions: () => { },
    });

    // Track cursor
    editor.onDidChangeCursorPosition((e) => {
      const currentTabId = activeTabIdRef.current;
      if (currentTabId) {
        setCursorPosition(currentTabId, e.position.lineNumber, e.position.column);
      }
    });

    editor.onDidChangeModelContent((event) => {
      if (!useUIStore.getState().inlineCompletionsEnabled) return;
      if (!event.changes.some((change) => change.text.length > 0 || change.rangeLength > 0)) return;
      void editor.getAction("editor.action.inlineSuggest.hide")?.run();
    });

    // CodeLens Provider for AI Changes
    monaco.languages.registerCodeLensProvider("*", {
      provideCodeLenses: function (model, _token) {
        const lenses: Monaco.languages.CodeLens[] = [];
        const aiHistory = useEditorStore.getState().aiChangeHistory;
        const uriString = model.uri.toString();
        const activePath = uriString.replace("file://", "");
        // Only show lens for files with active AI-driven changes
        const recentChange = aiHistory.find(
          (h) => h.filePath === activePath && h.source === "ai" && !h.rolledBack
        );
        if (recentChange) {
          lenses.push({
            range: { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 1 },
            id: "ai-accept",
            command: { id: "ncode.ai.accept", title: "✅ Accept AI Change" }
          });
          lenses.push({
            range: { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 1 },
            id: "ai-reject",
            command: { id: "ncode.ai.reject", title: "❌ Reject AI Change" }
          });
        }
        return { lenses, dispose: () => {} };
      },
      resolveCodeLens: function (_model, codeLens, _token) { return codeLens; }
    });

    // Accept: mark all changes for this file as rolled-back (accepted = no longer pending)
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyMod.Alt | monaco.KeyCode.Enter, () => {
      const activePath = activeTabRef.current?.filePath;
        if (activePath) {
          useEditorStore.setState((s) => ({
            aiChangeHistory: s.aiChangeHistory.map((h) =>
              h.filePath === activePath && h.source === "ai" ? { ...h, rolledBack: true } : h
            ),
          }));
        }
      });

    monaco.editor.addCommand({
      id: "ncode.ai.accept",
      run: () => {
        const activePath = activeTabRef.current?.filePath;
          if (activePath) {
            // Mark all changes for this file as accepted (rolledBack = true means "resolved")
            useEditorStore.setState((s) => ({
              aiChangeHistory: s.aiChangeHistory.map((h) =>
                h.filePath === activePath && h.source === "ai" ? { ...h, rolledBack: true } : h
              ),
            }));
            useUIStore.getState().addToast("AI changes accepted", "success");
          }
      }
    });

    monaco.editor.addCommand({
      id: "ncode.ai.reject",
      run: async () => {
        const activePath = activeTabRef.current?.filePath;
        if (!activePath) return;
        const store = useEditorStore.getState();
        // Find the most recent active change for this file and roll it back
        const entry = store.aiChangeHistory.find(
          (h) => h.filePath === activePath && h.source === "ai" && !h.rolledBack
        );
        if (entry) {
          await store.rollbackChangeById(entry.id);
          useUIStore.getState().addToast("AI changes rejected & reverted", "info");
        }
      }
    });

  };

  const handleChange: OnChange = (value) => {
    if (activeTabId && value !== undefined) {
      updateContent(activeTabId, value);
    }
  };

  // Switch editor model when active tab changes
  useEffect(() => {
    if (editorRef.current && monacoRef.current && activeTab) {
      const model = editorRef.current.getModel();
      if (model && model.getValue() !== activeTab.content) {
        // Preserve undo history per file
        const existingModel = monacoRef.current.editor.getModels().find(
          (m) => m.uri.toString() === `file://${activeTab.filePath}`
        );
        if (existingModel) {
          editorRef.current.setModel(existingModel);
        }
      }
    }
  }, [activeTabId, activeTab])

  useEffect(() => {
    if (!editorRef.current || !activeTab) return;
    const current = editorRef.current.getPosition();
    const target = {
      lineNumber: activeTab.cursorPosition.line,
      column: activeTab.cursorPosition.column,
    };
    if (!current || current.lineNumber !== target.lineNumber || current.column !== target.column) {
      editorRef.current.setPosition(target);
      editorRef.current.revealLineInCenterIfOutsideViewport(target.lineNumber);
    }
  }, [activeTab?.id, activeTab?.cursorPosition.line, activeTab?.cursorPosition.column]);

  useEffect(() => {
    const runEditorAction = async (action: EditorWorkbenchAction) => {
      const editor = editorRef.current;
      if (!editor) return;

      const runMonacoAction = async (actionId: string) => {
        const actionRunner = editor.getAction(actionId);
        if (actionRunner) {
          await actionRunner.run();
          return true;
        }
        return false;
      };

      const triggerEditor = async (handlerId: string, fallbackActionId?: string) => {
        editor.focus();
        if (fallbackActionId) {
          const handled = await runMonacoAction(fallbackActionId);
          if (handled) return;
        }
        editor.trigger("ncode-menu", handlerId, null);
      };

      switch (action) {
        case "undo":
          await triggerEditor("undo");
          return;
        case "redo":
          await triggerEditor("redo");
          return;
        case "cut":
          if (!(await runMonacoAction("editor.action.clipboardCutAction"))) {
            document.execCommand("cut");
          }
          return;
        case "copy":
          if (!(await runMonacoAction("editor.action.clipboardCopyAction"))) {
            document.execCommand("copy");
          }
          return;
        case "paste":
          if (!(await runMonacoAction("editor.action.clipboardPasteAction"))) {
            document.execCommand("paste");
          }
          return;
        case "find":
          await runMonacoAction("actions.find");
          return;
        case "replace":
          await runMonacoAction("editor.action.startFindReplaceAction");
          return;
        case "selectAll":
          await runMonacoAction("editor.action.selectAll");
          return;
        case "expandSelection":
          await runMonacoAction("editor.action.smartSelect.expand");
          return;
        case "shrinkSelection":
          await runMonacoAction("editor.action.smartSelect.shrink");
          return;
        case "copyLineUp":
          await runMonacoAction("editor.action.copyLinesUpAction");
          return;
        case "copyLineDown":
          await runMonacoAction("editor.action.copyLinesDownAction");
          return;
        case "moveLineUp":
          await runMonacoAction("editor.action.moveLinesUpAction");
          return;
        case "moveLineDown":
          await runMonacoAction("editor.action.moveLinesDownAction");
          return;
        case "addCursorAbove":
          await runMonacoAction("editor.action.insertCursorAbove");
          return;
        case "addCursorBelow":
          await runMonacoAction("editor.action.insertCursorBelow");
          return;
        case "addCursorsToLineEnds":
          await runMonacoAction("editor.action.insertCursorAtEndOfEachLineSelected");
          return;
        case "addNextOccurrence":
          await runMonacoAction("editor.action.addSelectionToNextFindMatch");
          return;
        case "addPreviousOccurrence":
          await runMonacoAction("editor.action.addSelectionToPreviousFindMatch");
          return;
        case "selectAllOccurrences":
          await runMonacoAction("editor.action.selectHighlights");
          return;
        case "toggleLineComment":
          await runMonacoAction("editor.action.commentLine");
          return;
        case "toggleBlockComment":
          await runMonacoAction("editor.action.blockComment");
          return;
        case "emmetExpand":
          await runMonacoAction("editor.emmet.action.expandAbbreviation");
          return;
        case "quickOutline":
          await runMonacoAction("editor.action.quickOutline");
          return;
        case "goToDefinition":
          await runMonacoAction("editor.action.revealDefinition");
          return;
        case "goToDeclaration":
          await runMonacoAction("editor.action.revealDeclaration");
          return;
        case "goToTypeDefinition":
          await runMonacoAction("editor.action.goToTypeDefinition");
          return;
        case "goToImplementation":
          await runMonacoAction("editor.action.goToImplementation");
          return;
        case "goToReferences":
          await runMonacoAction("editor.action.goToReferences");
          return;
        case "goToLine":
          await runMonacoAction("editor.action.gotoLine");
          return;
        case "goToBracket":
          await runMonacoAction("editor.action.jumpToBracket");
          return;
        case "nextProblem":
          await runMonacoAction("editor.action.marker.next");
          return;
        case "previousProblem":
          await runMonacoAction("editor.action.marker.prev");
          return;
        case "formatDocument":
          await runMonacoAction("editor.action.formatDocument");
          return;
      }
    };

    const handler = (event: Event) => {
      const customEvent = event as CustomEvent<EditorWorkbenchAction>;
      runEditorAction(customEvent.detail).catch((error) => {
        console.error("Failed to run editor workbench action:", error);
      });
    };

    window.addEventListener(EDITOR_WORKBENCH_EVENT, handler as EventListener);
    return () => {
      window.removeEventListener(EDITOR_WORKBENCH_EVENT, handler as EventListener);
    };
  }, []);

  useEffect(() => {
    if (!autoSave || !activeTabId || !activeTab?.isDirty) return;
    if (saveTimeout.current) clearTimeout(saveTimeout.current);
    saveTimeout.current = setTimeout(() => {
      saveFile(activeTabId).catch((e) => console.error("Auto-save failed:", e));
    }, 900);
    return () => {
      if (saveTimeout.current) clearTimeout(saveTimeout.current);
    };
  }, [autoSave, activeTabId, activeTab?.content, activeTab?.isDirty, saveFile]);

  const openFolderDialog = async () => {
    const selected = await open({ directory: true, multiple: false });
    if (typeof selected !== "string") return;

    setOpenFolder(selected);
    setAIOpenFolder(selected);
  };

  if (activeDiffReview) {
    return (
      <div className="editor-area">
        <DiffReviewPane
          title={activeDiffReview.title}
          description={activeDiffReview.description}
          sourcePath={activeDiffReview.sourcePath}
          originalContent={activeDiffReview.originalContent}
          modifiedContent={activeDiffReview.modifiedContent}
          onClose={closeDiffReview}
          onAccept={activeDiffReview.onAccept ? () => { void acceptDiffReview(); } : undefined}
          onReject={activeDiffReview.onReject ? () => { void rejectDiffReview(); } : undefined}
          isAccepting={isApplyingDiffReview}
          acceptLabel={activeDiffReview.acceptLabel}
          rejectLabel={activeDiffReview.rejectLabel}
          note={activeDiffReview.note}
        />
      </div>
    );
  }

  if (!activeTab) {
    return (
      <div className="editor-empty">
        <div className="editor-empty-content">
          <div className="editor-empty-logo">⌘</div>
          <h2>NCode</h2>
          <p>Open a file from the sidebar or use <kbd>{formatShortcut("Ctrl+P")}</kbd> to search</p>
          <div className="editor-empty-actions">
            <button className="editor-empty-btn primary" onClick={openFolderDialog}>
              Open Folder
            </button>
            <button className="editor-empty-btn" onClick={toggleQuickOpen}>
              Quick Open
            </button>
            <button className="editor-empty-btn" onClick={toggleCommandPalette}>
              Show All Commands
            </button>
            <button className="editor-empty-btn" onClick={toggleTerminal}>
              Toggle Terminal
            </button>
          </div>
          {recentFiles.length > 0 && (
            <div className="editor-empty-recent">
              <div className="editor-empty-recent-title">Recent</div>
              <div className="editor-empty-recent-list">
                {recentFiles.slice(0, 5).map((filePath) => (
                  <button
                    key={filePath}
                    className="editor-empty-recent-item"
                    onClick={() => {
                      openFile(filePath).catch((error) => {
                        console.error("Failed to reopen file:", error);
                      });
                    }}
                    title={filePath}
                  >
                    {filePath.split(/[\\/]/).pop() || filePath}
                  </button>
                ))}
              </div>
            </div>
          )}
          <div className="editor-shortcuts">
            <div className="editor-shortcut-item">
              <span>Quick Open</span>
              <kbd>{formatShortcut("Ctrl+P")}</kbd>
            </div>
            <div className="editor-shortcut-item">
              <span>Command Palette</span>
              <kbd>{formatShortcut("Ctrl+Shift+P")}</kbd>
            </div>
            <div className="editor-shortcut-item">
              <span>Terminal</span>
              <kbd>{formatShortcut("Ctrl+`")}</kbd>
            </div>
            <div className="editor-shortcut-item">
              <span>AI Assistant</span>
              <kbd>{formatShortcut("Ctrl+Shift+A")}</kbd>
            </div>
            <div className="editor-shortcut-item">
              <span>Find File</span>
              <kbd>{formatShortcut("Ctrl+P")}</kbd>
            </div>
            <div className="editor-shortcut-item">
              <span>Tasks</span>
              <kbd>Tasks Panel</kbd>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Map our color themes to standard monaco themes
  const monacoTheme = colorTheme === "github" ? "vs-dark" : (colorTheme === "dracula" ? "vs-dark" : "vs-dark"); // Custom monaco themes can be defined later if requested

  return (
    <div className="editor-area">
      <MonacoEditor
        height="100%"
        language={activeTab.language}
        value={activeTab.content}
        theme={monacoTheme}
        onMount={handleMount}
        onChange={handleChange}
        path={`file://${activeTab.filePath}`}
        options={{
          automaticLayout: true,
          fontSize,
          fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', Consolas, monospace",
          fontLigatures: true,
          minimap: { enabled: minimapEnabled },
          scrollBeyondLastLine: false,
          wordWrap: wordWrap ? "on" : "off",
          tabSize,
          insertSpaces: true,
          autoIndent: "full",
          formatOnPaste: true,
          formatOnType: true,
          suggestOnTriggerCharacters: true,
          quickSuggestions: { other: true, comments: false, strings: true },
          parameterHints: { enabled: true },
          hover: { enabled: true },
          columnSelection: columnSelectionMode,
          multiCursorModifier,
          lineNumbers: "on",
          renderLineHighlight: "line",
          cursorBlinking: "smooth",
          cursorSmoothCaretAnimation: "on",
          smoothScrolling: true,
          bracketPairColorization: { enabled: true },
          guides: { bracketPairs: true, indentation: true },
          renderWhitespace: "selection",
          inlayHints: { enabled: "on" },
          inlineSuggest: { enabled: inlineCompletionsEnabled },
          padding: { top: 8 },
        }}
      />
    </div>
  );
}
