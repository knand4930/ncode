// src/components/ai/AIPanel.tsx
import { useState, useRef, useEffect, useMemo } from "react";
import { Send, Trash2, Database, Zap, ChevronDown, ExternalLink, Eye, EyeOff, Undo2, Check, X } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { useAIStore, RECOMMENDED_MODELS } from "../../store/aiStore";
import { useEditorStore } from "../../store/editorStore";
import { useUIStore } from "../../store/uiStore";
import { useTerminalStore } from "../../store/terminalStore";
import { readTextFile } from "@tauri-apps/plugin-fs";
import { DiffModal } from "./DiffModal";
import { marked } from "marked";
import DOMPurify from "dompurify";

type FileSuggestion = {
  path: string;
  content: string;
  language: string;
};

// Simple global cache to prevent excessive Tauri invoke calls per message render
const fileExistsCache = new Map<string, boolean>();

async function checkFileExistsCached(path: string): Promise<boolean> {
  if (!path) return false;
  if (fileExistsCache.has(path)) return fileExistsCache.get(path)!;
  try {
    const exists = await invoke<boolean>("check_file_exists", { path });
    fileExistsCache.set(path, exists);
    return exists;
  } catch {
    return false;
  }
}

function extractFirstCodeBlock(markdown: string): string | null {
  const m = markdown.match(/```(?:[\w.+-]+)?\n([\s\S]*?)```/);
  return m ? m[1].trimEnd() : null;
}

function extractShellCommands(markdown: string): string[] {
  const commands: string[] = [];
  const re = /```(bash|sh|shell|zsh)\n([\s\S]*?)```/gi;
  let m: RegExpExecArray | null = null;
  while ((m = re.exec(markdown)) !== null) {
    const block = m[2].trim();
    if (!block) continue;

    // Ignore obvious JSON blocks formatted as sh
    if ((block.startsWith("{") && block.endsWith("}")) || (block.startsWith("[") && block.endsWith("]"))) {
      continue;
    }

    const lines = block
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#"));

    if (lines.length === 0) continue;

    // If every line starts with $, extract them individually
    const allStartWithDollar = lines.every(l => l.startsWith("$"));
    if (allStartWithDollar) {
      commands.push(...lines.map(l => l.replace(/^\$\s*/, "")));
      continue;
    }

    // If it looks like a complex script (loops, if statements, multiline strings)
    const isComplex = lines.some(l =>
      l.endsWith("\\") || l.includes("{") || l.includes("}") || l.startsWith("if ") || l.startsWith("for ")
    );

    if (isComplex) {
      commands.push(block);
    } else {
      // For simple sequences of commands, yield each line separately
      commands.push(...lines.map(l => l.replace(/^\$\s*/, "")));
    }
  }
  return commands.slice(0, 6);
}

function cleanPath(raw: string): string {
  return raw
    .trim()
    .replace(/^[-*]\s*/, "")
    .replace(/^###\s*/i, "")
    .replace(/^`|`$/g, "")
    .replace(/^\*\*|\*\*$/g, "")
    .replace(/^["']|["']$/g, "")
    .replace(/^\.\//, "")
    .replace(/\s+\(.*\)$/, "");
}

function inferLanguageFromPath(path: string): string {
  const normalized = cleanPath(path).toLowerCase();
  const ext = normalized.split(".").pop() || "";
  const map: Record<string, string> = {
    ts: "typescript",
    tsx: "tsx",
    js: "javascript",
    jsx: "jsx",
    py: "python",
    rs: "rust",
    go: "go",
    java: "java",
    cpp: "cpp",
    c: "c",
    cs: "csharp",
    rb: "ruby",
    php: "php",
    swift: "swift",
    kt: "kotlin",
    html: "html",
    css: "css",
    scss: "scss",
    less: "less",
    json: "json",
    yaml: "yaml",
    yml: "yaml",
    toml: "toml",
    md: "markdown",
    sh: "bash",
    bash: "bash",
    zsh: "zsh",
    sql: "sql",
    graphql: "graphql",
    vue: "vue",
    svelte: "svelte",
    xml: "xml",
  };
  return map[ext] || "text";
}

function looksLikePath(value: string): boolean {
  const v = cleanPath(value);
  if (!v) return false;
  if (v.includes(" ") && !v.includes("/")) return false;
  return /[\\/]/.test(v) || /\.[A-Za-z0-9_-]{1,12}$/.test(v);
}

function findPathNearCodeBlock(markdown: string, startIndex: number): string | null {
  const before = markdown.slice(Math.max(0, startIndex - 360), startIndex);
  const patterns = [
    /(?:^|\n)\s*(?:#{1,6}\s*)?(?:file|path)\s*:\s*`?([^\n`]+)`?\s*$/gi,
    /(?:^|\n)\s*(?:[-*]\s*)?`([^`\n]+\.[A-Za-z0-9._/-]+)`\s*:?\s*$/gi,
    /(?:^|\n)\s*(?:[-*]\s*)?\*\*([^*\n]+\.[A-Za-z0-9._/-]+)\*\*\s*:?\s*$/gi,
    /(?:^|\n)\s*(?:[-*]\s*)?([A-Za-z0-9_./\\-]+\.[A-Za-z0-9_.-]+)\s*:?\s*$/gi,
  ];
  for (const re of patterns) {
    let m: RegExpExecArray | null = null;
    let last: string | null = null;
    while ((m = re.exec(before)) !== null) {
      last = m[1];
    }
    if (last && looksLikePath(last)) return cleanPath(last);
  }
  return null;
}

function extractFileSuggestions(markdown: string): FileSuggestion[] {
  const out: FileSuggestion[] = [];
  const seen = new Set<string>();
  const push = (path: string, content: string, language?: string) => {
    const cleaned = cleanPath(path);
    if (!cleaned || !content.trim()) return;
    const key = cleaned.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ path: cleaned, content: content.trimEnd(), language: (language || "").trim() || "text" });
  };

  const fileHeadingVariants = [
    /(?:^|\n)(?:#{1,6}\s*)?file\s*:\s*`?([^\n`]+?)`?\s*\n```([\w.+-]*)\n([\s\S]*?)```/gi,
    /(?:^|\n)(?:#{1,6}\s*)?path\s*:\s*`?([^\n`]+?)`?\s*\n```([\w.+-]*)\n([\s\S]*?)```/gi,
    /(?:^|\n)#{1,6}\s*`?([^\n`]+\.[\w.-]+)`?\s*\n```([\w.+-]*)\n([\s\S]*?)```/gi,
  ];
  let m: RegExpExecArray | null = null;
  for (const re of fileHeadingVariants) {
    while ((m = re.exec(markdown)) !== null) {
      push(m[1], m[3], m[2]);
    }
  }

  const fileLabelBlockRe =
    /(?:^|\n)(?:#{1,6}\s*)?(?:file|path)\s*:\s*`?([^\n`]+?)`?\s*\n```([\w.+-]*)\n([\s\S]*?)```/gi;
  while ((m = fileLabelBlockRe.exec(markdown)) !== null) {
    push(m[1], m[3], m[2]);
  }

  const headingBlockRe =
    /(?:^|\n)#{1,6}\s*`?([^\n`]+\.[\w.-]+)`?\s*\n```([\w.+-]*)\n([\s\S]*?)```/gi;
  while ((m = headingBlockRe.exec(markdown)) !== null) {
    push(m[1], m[3], m[2]);
  }

  const infoPathBlockRe = /```([\w.+-]+)\s+([^\n`]+\.[\w.-]+)\n([\s\S]*?)```/gi;
  while ((m = infoPathBlockRe.exec(markdown)) !== null) {
    push(m[2], m[3], m[1]);
  }

  const infoOnlyPathRe = /```([^\n`\s]+\.[A-Za-z0-9_.-]+)\n([\s\S]*?)```/gi;
  while ((m = infoOnlyPathRe.exec(markdown)) !== null) {
    if (looksLikePath(m[1])) {
      push(m[1], m[2], inferLanguageFromPath(m[1]));
    }
  }

  const genericCodeBlockRe = /```([\w.+-]*)\n([\s\S]*?)```/gi;
  while ((m = genericCodeBlockRe.exec(markdown)) !== null) {
    const explicitInfo = (m[1] || "").trim();
    let path: string | null = null;
    let language = explicitInfo;

    if (explicitInfo && looksLikePath(explicitInfo)) {
      path = explicitInfo;
      language = inferLanguageFromPath(explicitInfo);
    } else {
      path = findPathNearCodeBlock(markdown, m.index);
      if (path && !language) language = inferLanguageFromPath(path);
    }

    if (path) {
      push(path, m[2], language);
    }
  }

  return out.slice(0, 12);
}

function isAbsolutePath(path: string): boolean {
  return path.startsWith("/") || /^[A-Za-z]:[\\/]/.test(path);
}

function resolveSuggestionPath(path: string, openFolder: string | null): string | null {
  const normalized = cleanPath(path).replace(/\\/g, "/");
  if (!normalized) return null;
  if (isAbsolutePath(normalized)) return normalized;
  if (!openFolder) return null;
  const base = openFolder.replace(/[\\/]+$/, "");
  const rel = normalized.replace(/^\.?\//, "");
  return `${base}/${rel}`;
}

export function AIPanel() {
  const [applyingMessageId, setApplyingMessageId] = useState<string | null>(null);
  const [applyingFileSuggestionKey, setApplyingFileSuggestionKey] = useState<string | null>(null);
  const [fileExistenceMap, setFileExistenceMap] = useState<Record<string, boolean>>({});

  const aiContentRef = useRef<HTMLDivElement>(null);

  const {
    chatHistory,
    isThinking,
    isOllamaRunning,
    // ollama models
    availableModels,
    selectedOllamaModels,
    toggleOllamaModel,
    // api keys
    apiKeys,
    selectedProvider,
    aiServiceMode,
    selectedApiKeyIndex,
    selectAPIKey,
    setProvider,

    useRAG,
    aiMode,
    agentLiveOutput,
    agentEvents,
    showThinking,
    indexedChunks,
    isIndexing,
    sendMessage,
    clearChat,
    toggleRAG,
    setAIMode,
    setShowThinking,
    indexCodebase,
    checkOllama,
    startOllama,
    setOpenFolder,
  } = useAIStore();
  const { openFolder, tabs, activeTabId, openFile, applyAIChangeToTab, applyAIChangeToFile, rollbackLastAIChange, aiChangeHistory } =
    useEditorStore();
  const { toggleSettingsPanel } = useUIStore();

  const [input, setInput] = useState("");
  const [showModelSelect, setShowModelSelect] = useState(false);
  const [rejectedSuggestionIds, setRejectedSuggestionIds] = useState<Set<string>>(new Set());
  const [rejectedFileSuggestionKeys, setRejectedFileSuggestionKeys] = useState<Set<string>>(new Set());
  const [rejectedCommandKeys, setRejectedCommandKeys] = useState<Set<string>>(new Set());
  const [runningCommandKey, setRunningCommandKey] = useState<string | null>(null);
  const [rollingBack, setRollingBack] = useState(false);
  
  // Diff Modal State
  const [diffModalData, setDiffModalData] = useState<{
    isOpen: boolean;
    suggestionKey: string;
    originalPath: string;
    originalContent: string;
    modifiedContent: string;
    onAccept: () => void;
  }>({
    isOpen: false,
    suggestionKey: "",
    originalPath: "",
    originalContent: "",
    modifiedContent: "",
    onAccept: () => {}
  });

  const modelSelectorRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const activeTab = tabs.find((t) => t.id === activeTabId);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatHistory, agentLiveOutput, agentEvents, isThinking]);

  const handleSend = async () => {
    const text = input.trim();
    if (!text || isThinking) return;

    // Allow inserting current file context
    let content = text;
    if (text.includes("@file") && activeTabId && activeTab) {
      if (activeTab) {
        content = text.replace(
          "@file",
          `\n\`\`\`${activeTab.language}\n// ${activeTab.fileName}\n${activeTab.content.slice(0, 3000)}\n\`\`\``
        );
      }
    }

    setInput("");
    await sendMessage(content);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // build active display label depending on provider
  let activeLabel = "";
  let activeRam = 0;
  if (selectedProvider === "ollama") {
    if (selectedOllamaModels.length === 0) activeLabel = "(no model)";
    else if (selectedOllamaModels.length === 1) {
      const m = selectedOllamaModels[0];
      const rec = RECOMMENDED_MODELS.find((x) => x.name === m);
      if (rec) {
        activeLabel = rec.label;
        activeRam = rec.ramGB;
      } else {
        activeLabel = m;
      }
    } else {
      activeLabel = `${selectedOllamaModels.length} models`;
    }
  } else if (selectedProvider === "api") {
    const entry = apiKeys[selectedApiKeyIndex ?? 0];
    if (entry) {
      activeLabel = `${entry.provider} ${entry.model}`;
    } else {
      activeLabel = "(no API key)";
    }
  }
  const requiresLocalOllama = aiMode === "agent" || useRAG || selectedProvider === "ollama";
  const usesLocalRagAgentPath = aiServiceMode === "grpc" && (useRAG || aiMode === "agent");
  const showOllamaWarning = requiresLocalOllama && !isOllamaRunning;
  const localStatusOnline = !requiresLocalOllama || isOllamaRunning;

  // close dropdown when clicking outside
  useEffect(() => {
    const listener = (e: MouseEvent) => {
      if (
        showModelSelect &&
        modelSelectorRef.current &&
        !modelSelectorRef.current.contains(e.target as Node)
      ) {
        setShowModelSelect(false);
      }
    };
    document.addEventListener("mousedown", listener);
    return () => document.removeEventListener("mousedown", listener);
  }, [showModelSelect]);

  // initial status check so offline warnings can show local models
  useEffect(() => {
    checkOllama();
  }, [checkOllama]);

  // refresh ollama status/models whenever dropdown opens
  useEffect(() => {
    if (showModelSelect) {
      checkOllama();
    }
  }, [showModelSelect, checkOllama]);

  // keep AI store folder in sync with currently opened project folder
  useEffect(() => {
    setOpenFolder(openFolder ?? null);
  }, [openFolder, setOpenFolder]);

  // optionally auto-index when RAG is enabled for a selected folder
  useEffect(() => {
    if (useRAG && openFolder && indexedChunks === 0 && !isIndexing) {
      indexCodebase(openFolder);
    }
  }, [useRAG, openFolder, indexedChunks, isIndexing, indexCodebase]);

  return (
    <div className="ai-panel">
      {/* Header */}
      <div className="ai-header">
        <div className="ai-header-left">
          <span className="ai-title">✦ AI Assistant</span>
          <div
            className={`ai-status-dot ${localStatusOnline ? "online" : "offline"}`}
            title={
              requiresLocalOllama
                ? isOllamaRunning
                  ? "Ollama connected"
                  : "Ollama not running"
                : "Cloud/API route active"
            }
          />
        </div>
        <div className="ai-header-right">
          <button
            className={`ai-mode-btn ${aiMode === "think" ? "active" : ""}`}
            onClick={() => setAIMode("think")}
            title="Think mode: step-by-step reasoning"
          >
            Think
          </button>
          <button
            className={`ai-mode-btn ${aiMode === "agent" ? "active" : ""}`}
            onClick={() => setAIMode("agent")}
            title="Agent mode: plan + file-level actions"
          >
            Agent
          </button>
          <button
            className={`ai-mode-btn ${aiMode === "bug_hunt" ? "active" : ""}`}
            onClick={() => setAIMode("bug_hunt")}
            title="Bug Hunt: find bugs, vulnerabilities, flaws"
          >
            🐛 Bugs
          </button>
          <button
            className={`ai-mode-btn ${aiMode === "architect" ? "active" : ""}`}
            onClick={() => setAIMode("architect")}
            title="Architect: design review & improvements"
          >
            🏗️ Arch
          </button>
          <button
            className={`ai-mode-btn ${aiMode === "chat" ? "active" : ""}`}
            onClick={() => setAIMode("chat")}
            title="Chat mode: direct answers"
          >
            Chat
          </button>
          <button
            className={`ai-rag-btn ${useRAG ? "active" : ""}`}
            onClick={toggleRAG}
            title={useRAG ? `RAG ON: ${indexedChunks} chunks indexed` : "Enable codebase RAG"}
          >
            <Database size={13} />
            {useRAG ? `RAG (${indexedChunks})` : "RAG"}
          </button>
          <button
            onClick={async () => {
              setRollingBack(true);
              try {
                const ok = await rollbackLastAIChange();
                if (!ok) {
                  window.alert("No accepted AI changes to rollback.");
                }
              } finally {
                setRollingBack(false);
              }
            }}
            disabled={rollingBack || aiChangeHistory.length === 0}
            title={aiChangeHistory.length > 0 ? "Rollback last accepted AI change" : "No AI changes to rollback"}
          >
            <Undo2 size={13} />
          </button>
          <button onClick={clearChat} title="Clear chat">
            <Trash2 size={13} />
          </button>
        </div>
      </div>

      {usesLocalRagAgentPath && (
        <div className="ai-warning">
          <Zap size={14} />
          <div>
            <strong>RAG/Agent still use local Ollama path</strong>
            <p>
              gRPC mode is active for standard chat/completions. RAG and Agent mode currently execute through local
              Rust+Ollama flow.
            </p>
          </div>
        </div>
      )}

      {/* Not running warning */}
      {showOllamaWarning && (
        <div className="ai-warning">
          <Zap size={14} />
          <div>
            <strong>Ollama not running</strong>
            <p>Install <a href="https://ollama.ai" target="_blank">ollama.ai</a> then run:</p>
            <code>ollama serve<br />ollama pull deepseek-coder:1.3b</code>
            {availableModels.length > 0 && (
              <p style={{ marginTop: 6, fontSize: 12 }}>
                &bull; {availableModels.length} model(s) present locally. Start the server to use.
              </p>
            )}
            <button className="btn-sm" style={{ marginTop: 6 }} onClick={startOllama}>
              Start Ollama
            </button>
          </div>
        </div>
      )}

      {/* RAG indexing prompt */}
      {useRAG && indexedChunks === 0 && openFolder && (
        <div className="ai-rag-prompt">
          <Database size={14} />
          <div>
            <strong>Index codebase for RAG</strong>
            <p>Lets AI reference your actual code</p>
            <button
              className="btn-primary btn-sm"
              onClick={() => indexCodebase(openFolder)}
              disabled={isIndexing}
            >
              {isIndexing ? "Indexing..." : "Index Now"}
            </button>
          </div>
        </div>
      )}

      {/* Model selector */}
      <div className="ai-model-selector" ref={modelSelectorRef}>
        <button
          className="ai-model-btn"
          onClick={() => setShowModelSelect((s) => !s)}
        >
          <span>{activeLabel}</span>
          {selectedProvider === "ollama" && activeRam > 0 && (
            <span className="ai-model-ram">{activeRam}GB</span>
          )}
          <ChevronDown size={12} />
        </button>

        {showModelSelect && (
          <div className="ai-model-dropdown">
            {/* ollama section */}
            <div className="ai-model-dropdown-header">Ollama Models</div>
            {(!isOllamaRunning || availableModels.length === 0) && (
              <div style={{ fontSize: 12, color: "var(--text-secondary)", padding: "4px 12px" }}>
                {isOllamaRunning ? "No models installed" : "Ollama not running"}
              </div>
            )}
            {availableModels.map((m) => (
              <button
                key={m}
                className={`ai-model-option ${selectedOllamaModels.includes(m) ? "selected" : ""}`}
                onClick={() => {
                  toggleOllamaModel(m);
                }}
              >
                <input
                  type="radio"
                  checked={selectedOllamaModels[0] === m}
                  readOnly
                  style={{ marginRight: 6 }}
                />
                <span>{m}</span>
              </button>
            ))}

            {/* api keys section */}
            {apiKeys.length > 0 && (
              <>
                <div className="ai-model-dropdown-header">API Keys</div>
                {apiKeys.map((k, i) => (
                  <button
                    key={i}
                    className={`ai-model-option ${selectedProvider === "api" && selectedApiKeyIndex === i ? "selected" : ""
                      }`}
                    onClick={() => {
                      setProvider("api");
                      selectAPIKey(i);
                      setShowModelSelect(false);
                    }}
                  >
                    <span>
                      {k.provider}: {k.model}
                    </span>
                  </button>
                ))}
              </>
            )}

            <div className="ai-model-dropdown-footer">
              <button onClick={() => setShowModelSelect(false)} className="btn-sm">
                Close
              </button>
              <button
                onClick={() => {
                  setShowModelSelect(false);
                  // open settings so user can manage API keys
                  toggleSettingsPanel();
                }}
                className="btn-sm"
              >
                Manage
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Messages */}
      <div className="ai-messages">
        {chatHistory.length === 0 ? (
          <div className="ai-welcome">
            <div className="ai-welcome-icon">✦</div>
            <h3>AI Code Assistant</h3>
            <p>Ask anything about code. Use <code>@file</code> to include current file.</p>
            <div className="ai-suggestions">
              {[
                "Explain this function",
                "Find bugs in @file",
                "Refactor @file for performance",
                "Write tests for this code",
                "How does this codebase work?",
              ].map((s) => (
                <button key={s} onClick={() => setInput(s)}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          chatHistory.map((msg) => {
            const codeSuggestion =
              msg.role === "assistant" ? extractFirstCodeBlock(msg.content) : null;
            const fileSuggestions =
              msg.role === "assistant" ? extractFileSuggestions(msg.content) : [];
            const shellCommands = msg.role === "assistant" ? extractShellCommands(msg.content) : [];
            const canApproveSuggestion =
              !!codeSuggestion &&
              !!activeTabId &&
              !!activeTab &&
              msg.role === "assistant" &&
              fileSuggestions.length === 0 &&
              !rejectedSuggestionIds.has(msg.id);
            return (
              <div key={msg.id} className={`ai-message ai-message-${msg.role}`}>
                <div className="ai-message-header">
                  <span>
                    {msg.role === "user" ? "You" : "AI"}
                    {msg.role === "assistant" && msg.model && (
                      <span style={{ fontSize: "0.85em", color: "var(--text-secondary)", marginLeft: "6px" }}>
                        ({msg.provider === "ollama" ? "Local" : "API"}: {msg.model})
                      </span>
                    )}
                  </span>
                  <span className="ai-message-time">
                    {new Date(msg.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                  </span>
                </div>
                <div
                  className="ai-message-content"
                  dangerouslySetInnerHTML={{
                    __html: DOMPurify.sanitize(
                      marked.parse(msg.content.replace(/<execute>[\s\S]*?<\/execute>/g, '<div class="ai-agent-action">⚙️ Executed Command</div>')) as string
                    )
                  }}
                />
                {canApproveSuggestion && (
                  <div className="ai-change-actions">
                    <button
                      className="btn-sm btn-primary"
                      disabled={applyingMessageId === msg.id}
                      onClick={async () => {
                        if (!activeTabId || !codeSuggestion || !activeTab) return;
                        const confirmed = window.confirm(
                          `Apply AI suggestion to ${activeTab.fileName}? You can rollback later.`
                        );
                        if (!confirmed) return;
                        setApplyingMessageId(msg.id);
                        try {
                          await applyAIChangeToTab(
                            activeTabId,
                            codeSuggestion,
                            `Accepted from AI message at ${new Date(msg.timestamp).toLocaleTimeString()}`
                          );
                        } finally {
                          setApplyingMessageId(null);
                        }
                      }}
                      title="Apply suggestion to active file"
                    >
                      <Check size={12} />
                      Accept
                    </button>
                    <button
                      className="btn-sm"
                      onClick={() =>
                        setRejectedSuggestionIds((s) => {
                          const n = new Set(s);
                          n.add(msg.id);
                          return n;
                        })
                      }
                      title="Reject this suggestion"
                    >
                      <X size={12} />
                      Reject
                    </button>
                  </div>
                )}
                {fileSuggestions.length > 0 && (
                  <div className="ai-command-actions">
                    {fileSuggestions.map((s, idx) => {
                      const key = `${msg.id}-file-${idx}-${s.path}`;
                      if (rejectedFileSuggestionKeys.has(key)) return null;
                      const resolvedPath = resolveSuggestionPath(s.path, openFolder ?? null);
                      const disabled = applyingFileSuggestionKey === key || !resolvedPath;
                      return (
                        <div key={key} className="ai-command-row flex-wrap gap-2">
                          <code className="w-full mb-1">{s.path}</code>
                          <div className="flex gap-2 w-full justify-end">
                            <button
                              className="btn-sm bg-gray-700 hover:bg-gray-600"
                              disabled={disabled}
                              onClick={async () => {
                                if (!resolvedPath) {
                                  window.alert("Open a project folder first to view diffs.");
                                  return;
                                }
                                let originalContent = "";
                                if (fileExistenceMap[resolvedPath]) {
                                  try {
                                    originalContent = await readTextFile(resolvedPath);
                                  } catch (e) {
                                    console.error("Failed to read original file for diff", e);
                                  }
                                }
                                setDiffModalData({
                                  isOpen: true,
                                  suggestionKey: key,
                                  originalPath: resolvedPath,
                                  originalContent,
                                  modifiedContent: s.content,
                                  onAccept: async () => {
                                    setApplyingFileSuggestionKey(key);
                                    try {
                                      await applyAIChangeToFile(
                                        resolvedPath,
                                        s.content,
                                        `Accepted AI file suggestion at ${new Date(msg.timestamp).toLocaleTimeString()}`
                                      );
                                      setFileExistenceMap(prev => ({ ...prev, [resolvedPath]: true }));
                                      fileExistsCache.set(resolvedPath, true);
                                      
                                      setTimeout(() => {
                                        useAIStore.getState().sendMessage(
                                          `I have reviewed and accepted the proposed modifications to \`${s.path}\`. Please proceed to the next step, or output \`<task_complete>\` if all objectives are finished.`
                                        );
                                      }, 500);
                                      
                                      setDiffModalData(prev => ({ ...prev, isOpen: false }));
                                    } finally {
                                      setApplyingFileSuggestionKey(null);
                                    }
                                  }
                                });
                              }}
                              title="Preview changes in Diff Editor"
                            >
                              <Eye size={12} />
                              View Diff
                            </button>
                            <button
                              className="btn-sm btn-primary"
                              disabled={disabled}
                              onClick={async () => {
                                if (!resolvedPath) {
                                  window.alert("Open a project folder first for relative file paths.");
                                  return;
                                }
                                const existing = fileExistenceMap[resolvedPath];
                                const confirmed = window.confirm(
                                  `Apply AI suggestion to file?\n\n${resolvedPath}\n\nThis will ${existing ? 'UPDATE' : 'CREATE'} the file.`
                                );
                                if (!confirmed) return;
                                setApplyingFileSuggestionKey(key);
                                try {
                                  await applyAIChangeToFile(
                                    resolvedPath,
                                    s.content,
                                    `Accepted AI file suggestion at ${new Date(msg.timestamp).toLocaleTimeString()}`
                                  );
                                  setFileExistenceMap(prev => ({ ...prev, [resolvedPath]: true }));
                                  fileExistsCache.set(resolvedPath, true);
                                  
                                  setTimeout(() => {
                                    useAIStore.getState().sendMessage(
                                      `I have reviewed and accepted the proposed modifications to \`${s.path}\`. Please proceed to the next step in your plan, or output \`<task_complete>\` if all objectives are finished.`
                                    );
                                  }, 500);
                                } finally {
                                  setApplyingFileSuggestionKey(null);
                                }
                              }}
                              title={resolvedPath ? `Create/Update ${resolvedPath}` : "Open folder to apply relative path"}
                            >
                              <Check size={12} />
                              {resolvedPath && fileExistenceMap[resolvedPath] ? 'Update' : 'Create'}
                            </button>
                            <button
                              className="btn-sm"
                              onClick={() =>
                                setRejectedFileSuggestionKeys((prev) => {
                                  const next = new Set(prev);
                                  next.add(key);
                                  return next;
                                })
                              }
                              title="Reject this file suggestion"
                            >
                              <X size={12} />
                              Reject
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
                {shellCommands.length > 0 && (
                  <div className="ai-command-actions">
                    {shellCommands.map((cmd, idx) => {
                      const key = `${msg.id}-${idx}`;
                      if (rejectedCommandKeys.has(key)) return null;
                      return (
                        <div key={key} className="ai-command-row" style={{ alignItems: "flex-start" }}>
                          <code style={{ whiteSpace: "pre-wrap", wordBreak: "break-all", flex: 1, maxHeight: "150px", overflowY: "auto" }}>
                            {cmd}
                          </code>
                          <div style={{ display: "flex", gap: "4px", flexShrink: 0 }}>
                            <button
                              className="btn-sm btn-primary"
                              onClick={() => {
                                const confirmed = window.confirm(
                                  `Run this command in the terminal?\n\n${cmd}`
                                );
                                if (!confirmed) return;
                                useTerminalStore.getState().runCommandInTerminal(cmd);
                              }}
                              title="Run this command in active terminal session"
                            >
                              <Check size={12} />
                              Run in Terminal
                            </button>
                            <button
                              className="btn-sm"
                              onClick={() =>
                                setRejectedCommandKeys((s) => {
                                  const n = new Set(s);
                                  n.add(key);
                                  return n;
                                })
                              }
                              title="Reject this command"
                            >
                              <X size={12} />
                              Skip
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
                {msg.sources && msg.sources.length > 0 && (
                  <div className="ai-sources">
                    <span>Sources:</span>
                    {msg.sources.map((src, i) => (
                      <button
                        key={i}
                        className="ai-source-btn"
                        onClick={() => {
                          openFile(src.filePath);
                        }}
                        title={`${src.filePath}:${src.startLine}`}
                      >
                        <ExternalLink size={10} />
                        {src.filePath.split(/[\\/]/).pop()}:{src.startLine}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )
          })
        )}
        {(aiMode === "agent" || agentLiveOutput || agentEvents.length > 0) && (isThinking || agentLiveOutput || agentEvents.length > 0) && (
          <div className="ai-agent-stream">
            <div className="ai-agent-stream-header">
              <span>Realtime agent trace</span>
              <button className="btn-sm" onClick={() => setShowThinking(!showThinking)}>
                {showThinking ? <EyeOff size={12} /> : <Eye size={12} />}
                {showThinking ? "Hide Thinking" : "Show Thinking"}
              </button>
            </div>
            {agentEvents.length > 0 && (
              <div className="ai-agent-events">
                {agentEvents.map((evt, i) => (
                  <div key={`${evt.ts}-${i}`} className={`ai-agent-event ai-agent-event-${evt.kind}`}>
                    <span className="ai-agent-event-kind">{evt.kind.toUpperCase()}</span>
                    <span className="ai-agent-event-msg">{evt.message}</span>
                  </div>
                ))}
              </div>
            )}
            {showThinking && agentLiveOutput && (
              <div
                className="ai-agent-thinking ai-message-content"
                dangerouslySetInnerHTML={{ __html: marked(agentLiveOutput) as string }}
              />
            )}
          </div>
        )}
        {isThinking && aiMode !== "agent" && (
          <div className="ai-message ai-message-assistant">
            <div className="ai-thinking">
              <span />
              <span />
              <span />
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>


      {/* Input */}
      <div className="ai-input-area">
        <textarea
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={
            useRAG
              ? `Ask about your codebase... (${aiMode.toUpperCase()} + RAG)`
              : `Ask AI... (${aiMode.toUpperCase()}, Shift+Enter for newline, @file for context)`
          }
          rows={3}
          disabled={(requiresLocalOllama && !isOllamaRunning) || isThinking}
        />
        <button
          className="ai-send-btn"
          onClick={handleSend}
          disabled={(requiresLocalOllama && !isOllamaRunning) || isThinking || !input.trim()}
        >
          <Send size={14} />
        </button>
      </div>
    </div>
  );
}
