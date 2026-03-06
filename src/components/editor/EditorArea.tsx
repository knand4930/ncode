// src/components/editor/EditorArea.tsx
import { useRef, useEffect } from "react";
import MonacoEditor, { OnMount, OnChange } from "@monaco-editor/react";
import type * as Monaco from "monaco-editor";
import { useEditorStore } from "../../store/editorStore";
import { useUIStore } from "../../store/uiStore";
import { useAIStore } from "../../store/aiStore";

export function EditorArea() {
  const { tabs, activeTabId, updateContent, saveFile, setCursorPosition } = useEditorStore();
  const {
    theme,
    fontSize,
    tabSize,
    wordWrap,
    minimapEnabled,
    formatOnSave,
    autoSave,
  } = useUIStore();
  const { getInlineCompletion, isOllamaRunning } = useAIStore();
  const editorRef = useRef<Monaco.editor.IStandaloneCodeEditor | null>(null);
  const monacoRef = useRef<typeof Monaco | null>(null);
  const completionTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeTabIdRef = useRef<string | null>(activeTabId);
  const formatOnSaveRef = useRef<boolean>(formatOnSave);

  const activeTab = tabs.find((t) => t.id === activeTabId);

  useEffect(() => {
    activeTabIdRef.current = activeTabId;
  }, [activeTabId]);

  useEffect(() => {
    formatOnSaveRef.current = formatOnSave;
  }, [formatOnSave]);

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

    // Register AI inline completion provider
    if (isOllamaRunning) {
      monaco.languages.registerInlineCompletionsProvider("*", {
        provideInlineCompletions: async (model, position) => {
          // Debounce
          if (completionTimeout.current) clearTimeout(completionTimeout.current);

          return new Promise((resolve) => {
            completionTimeout.current = setTimeout(async () => {
              const lineContent = model.getValueInRange({
                startLineNumber: Math.max(1, position.lineNumber - 20),
                startColumn: 1,
                endLineNumber: position.lineNumber,
                endColumn: position.column,
              });

              if (lineContent.trim().length < 5) {
                resolve({ items: [] });
                return;
              }

              const lang = model.getLanguageId() || "plaintext";
              const completion = await getInlineCompletion(lineContent, lang);

              if (completion) {
                resolve({
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
                });
              } else {
                resolve({ items: [] });
              }
            }, 1200);
          });
        },
        freeInlineCompletions: () => { },
      });
    }

    // Track cursor
    editor.onDidChangeCursorPosition((e) => {
      const currentTabId = activeTabIdRef.current;
      if (currentTabId) {
        setCursorPosition(currentTabId, e.position.lineNumber, e.position.column);
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
    if (!autoSave || !activeTabId || !activeTab?.isDirty) return;
    if (saveTimeout.current) clearTimeout(saveTimeout.current);
    saveTimeout.current = setTimeout(() => {
      saveFile(activeTabId).catch((e) => console.error("Auto-save failed:", e));
    }, 900);
    return () => {
      if (saveTimeout.current) clearTimeout(saveTimeout.current);
    };
  }, [autoSave, activeTabId, activeTab?.content, activeTab?.isDirty, saveFile]);

  if (!activeTab) {
    return (
      <div className="editor-empty">
        <div className="editor-empty-content">
          <div className="editor-empty-logo">⌘</div>
          <h2>NCode</h2>
          <p>Open a file from the sidebar or use <kbd>Ctrl+P</kbd> to search</p>
          <div className="editor-shortcuts">
            <div><kbd>Ctrl+P</kbd> Quick Open</div>
            <div><kbd>Ctrl+Shift+P</kbd> Command Palette</div>
            <div><kbd>Ctrl+`</kbd> Terminal</div>
            <div><kbd>Ctrl+Shift+A</kbd> AI Assistant</div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="editor-area">
      <MonacoEditor
        height="100%"
        language={activeTab.language}
        value={activeTab.content}
        theme={theme === "dark" ? "vs-dark" : "vs"}
        onMount={handleMount}
        onChange={handleChange}
        path={`file://${activeTab.filePath}`}
        options={{
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
          lineNumbers: "on",
          renderLineHighlight: "line",
          cursorBlinking: "smooth",
          cursorSmoothCaretAnimation: "on",
          smoothScrolling: true,
          bracketPairColorization: { enabled: true },
          guides: { bracketPairs: true, indentation: true },
          renderWhitespace: "selection",
          inlayHints: { enabled: "on" },
          inlineSuggest: { enabled: true },
          padding: { top: 8 },
        }}
      />
    </div>
  );
}
