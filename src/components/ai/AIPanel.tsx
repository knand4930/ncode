// src/components/ai/AIPanel.tsx
import { useState, useRef, useEffect } from "react";
import { Send, Trash2, Database, Zap, ChevronDown, ExternalLink, Eye, EyeOff, Undo2, Check, X } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { useAIStore, RECOMMENDED_MODELS } from "../../store/aiStore";
import { useEditorStore } from "../../store/editorStore";
import { useUIStore } from "../../store/uiStore";
import { marked } from "marked";

function extractFirstCodeBlock(markdown: string): string | null {
  const m = markdown.match(/```(?:[\w.+-]+)?\n([\s\S]*?)```/);
  return m ? m[1].trimEnd() : null;
}

function extractShellCommands(markdown: string): string[] {
  const commands: string[] = [];
  const re = /```(bash|sh|shell|zsh)\n([\s\S]*?)```/gi;
  let m: RegExpExecArray | null = null;
  while ((m = re.exec(markdown)) !== null) {
    const block = m[2];
    const lines = block
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#"))
      .map((line) => (line.startsWith("$ ") ? line.slice(2) : line));
    commands.push(...lines);
  }
  return commands.slice(0, 6);
}

export function AIPanel() {
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
  const { openFolder, tabs, activeTabId, openFile, applyAIChangeToTab, rollbackLastAIChange, aiChangeHistory } =
    useEditorStore();
  const { toggleSettingsPanel } = useUIStore();

  const [input, setInput] = useState("");
  const [showModelSelect, setShowModelSelect] = useState(false);
  const [rejectedSuggestionIds, setRejectedSuggestionIds] = useState<Set<string>>(new Set());
  const [rejectedCommandKeys, setRejectedCommandKeys] = useState<Set<string>>(new Set());
  const [applyingMessageId, setApplyingMessageId] = useState<string | null>(null);
  const [runningCommandKey, setRunningCommandKey] = useState<string | null>(null);
  const [rollingBack, setRollingBack] = useState(false);
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
            className={`ai-status-dot ${isOllamaRunning ? "online" : "offline"}`}
            title={isOllamaRunning ? "Ollama connected" : "Ollama not running"}
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

      {/* Not running warning */}
      {!isOllamaRunning && (
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
                    className={`ai-model-option ${
                      selectedProvider === "api" && selectedApiKeyIndex === i ? "selected" : ""
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
            const shellCommands = msg.role === "assistant" ? extractShellCommands(msg.content) : [];
            const canApproveSuggestion =
              !!codeSuggestion &&
              !!activeTabId &&
              !!activeTab &&
              msg.role === "assistant" &&
              !rejectedSuggestionIds.has(msg.id);
            return (
            <div key={msg.id} className={`ai-message ai-message-${msg.role}`}>
              <div className="ai-message-header">
                <span>{msg.role === "user" ? "You" : "AI"}</span>
                <span className="ai-message-time">
                  {new Date(msg.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                </span>
              </div>
              <div
                className="ai-message-content"
                dangerouslySetInnerHTML={{ __html: marked(msg.content) as string }}
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
              {shellCommands.length > 0 && (
                <div className="ai-command-actions">
                  {shellCommands.map((cmd, idx) => {
                    const key = `${msg.id}-${idx}`;
                    if (rejectedCommandKeys.has(key)) return null;
                    return (
                      <div key={key} className="ai-command-row">
                        <code>{cmd}</code>
                        <button
                          className="btn-sm btn-primary"
                          disabled={runningCommandKey === key}
                          onClick={async () => {
                            if (!openFolder) {
                              window.alert("Open a project folder before running commands.");
                              return;
                            }
                            const confirmed = window.confirm(
                              `Run this command in ${openFolder}?\n\n${cmd}`
                            );
                            if (!confirmed) return;
                            setRunningCommandKey(key);
                            try {
                              const out = await invoke<string>("run_command", {
                                cmd,
                                cwd: openFolder,
                              });
                              const preview = out.length > 1500 ? `${out.slice(0, 1500)}\n...[truncated]` : out;
                              window.alert(`Command succeeded:\n\n${preview || "(no output)"}`);
                            } catch (e) {
                              window.alert(`Command failed:\n\n${String(e)}`);
                            } finally {
                              setRunningCommandKey(null);
                            }
                          }}
                          title="Run this command"
                        >
                          <Check size={12} />
                          Run
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
          )})
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
