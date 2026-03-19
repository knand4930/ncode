// src/components/ai/AIPanel.tsx
import { useState, useRef, useEffect } from "react";
import {
  Send, Trash2, Database, Zap, ChevronDown, ExternalLink,
  Eye, EyeOff, Undo2, Check, X, StopCircle, Cpu, RefreshCw,
  Terminal, FileCode, Sparkles, Plus, MessageSquare, ChevronLeft,
} from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { useAIStore } from "../../store/aiStore";
import { useEditorStore } from "../../store/editorStore";
import { useUIStore } from "../../store/uiStore";
import { useTerminalStore } from "../../store/terminalStore";
import { readTextFile } from "@tauri-apps/plugin-fs";
import { DiffModal } from "./DiffModal";
import { marked } from "marked";
import DOMPurify from "dompurify";

type FileSuggestion = { path: string; content: string; language: string };

const fileExistsCache = new Map<string, boolean>();
async function checkFileExistsCached(path: string): Promise<boolean> {
  if (!path) return false;
  if (fileExistsCache.has(path)) return fileExistsCache.get(path)!;
  try {
    const exists = await invoke<boolean>("check_file_exists", { path });
    fileExistsCache.set(path, exists);
    return exists;
  } catch { return false; }
}

function extractFirstCodeBlock(md: string): string | null {
  const m = md.match(/```(?:[\w.+-]+)?\n([\s\S]*?)```/);
  return m ? m[1].trimEnd() : null;
}

function extractShellCommands(md: string): string[] {
  const cmds: string[] = [];
  const re = /```(bash|sh|shell|zsh)\n([\s\S]*?)```/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(md)) !== null) {
    const block = m[2].trim();
    if (!block) continue;
    if ((block.startsWith("{") && block.endsWith("}")) || (block.startsWith("[") && block.endsWith("]"))) continue;
    const lines = block.split("\n").map(l => l.trim()).filter(l => l && !l.startsWith("#"));
    if (!lines.length) continue;
    const allDollar = lines.every(l => l.startsWith("$"));
    if (allDollar) { cmds.push(...lines.map(l => l.replace(/^\$\s*/, ""))); continue; }
    const isComplex = lines.some(l => l.endsWith("\\") || l.includes("{") || l.includes("}") || l.startsWith("if ") || l.startsWith("for "));
    if (isComplex) cmds.push(block);
    else cmds.push(...lines.map(l => l.replace(/^\$\s*/, "")));
  }
  return cmds.slice(0, 6);
}

function cleanPath(raw: string): string {
  return raw.trim()
    .replace(/^[-*]\s*/, "").replace(/^###\s*/i, "")
    .replace(/^`|`$/g, "").replace(/^\*\*|\*\*$/g, "")
    .replace(/^["']|["']$/g, "").replace(/^\.\//, "")
    .replace(/\s+\(.*\)$/, "");
}

function inferLang(path: string): string {
  const ext = cleanPath(path).toLowerCase().split(".").pop() || "";
  const map: Record<string, string> = {
    ts:"typescript",tsx:"tsx",js:"javascript",jsx:"jsx",py:"python",rs:"rust",
    go:"go",java:"java",cpp:"cpp",c:"c",cs:"csharp",rb:"ruby",php:"php",
    swift:"swift",kt:"kotlin",html:"html",css:"css",scss:"scss",json:"json",
    yaml:"yaml",yml:"yaml",toml:"toml",md:"markdown",sh:"bash",bash:"bash",
    sql:"sql",vue:"vue",svelte:"svelte",xml:"xml",
  };
  return map[ext] || "text";
}

function looksLikePath(v: string): boolean {
  const c = cleanPath(v);
  if (!c) return false;
  if (c.includes(" ") && !c.includes("/")) return false;
  return /[\\/]/.test(c) || /\.[A-Za-z0-9_-]{1,12}$/.test(c);
}

function findPathNear(md: string, idx: number): string | null {
  const before = md.slice(Math.max(0, idx - 360), idx);
  const patterns = [
    /(?:^|\n)\s*(?:#{1,6}\s*)?(?:file|path)\s*:\s*`?([^\n`]+)`?\s*$/gi,
    /(?:^|\n)\s*(?:[-*]\s*)?`([^`\n]+\.[A-Za-z0-9._/-]+)`\s*:?\s*$/gi,
    /(?:^|\n)\s*(?:[-*]\s*)?\*\*([^*\n]+\.[A-Za-z0-9._/-]+)\*\*\s*:?\s*$/gi,
    /(?:^|\n)\s*(?:[-*]\s*)?([A-Za-z0-9_./\\-]+\.[A-Za-z0-9_.-]+)\s*:?\s*$/gi,
  ];
  for (const re of patterns) {
    let m: RegExpExecArray | null, last: string | null = null;
    while ((m = re.exec(before)) !== null) last = m[1];
    if (last && looksLikePath(last)) return cleanPath(last);
  }
  return null;
}

function extractFileSuggestions(md: string): FileSuggestion[] {
  const out: FileSuggestion[] = [];
  const seen = new Set<string>();
  const push = (path: string, content: string, language?: string) => {
    const c = cleanPath(path);
    if (!c || !content.trim()) return;
    const key = c.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ path: c, content: content.trimEnd(), language: (language || "").trim() || "text" });
  };
  let m: RegExpExecArray | null;
  const variants = [
    /(?:^|\n)(?:#{1,6}\s*)?file\s*:\s*`?([^\n`]+?)`?\s*\n```([\w.+-]*)\n([\s\S]*?)```/gi,
    /(?:^|\n)(?:#{1,6}\s*)?path\s*:\s*`?([^\n`]+?)`?\s*\n```([\w.+-]*)\n([\s\S]*?)```/gi,
    /(?:^|\n)#{1,6}\s*`?([^\n`]+\.[\w.-]+)`?\s*\n```([\w.+-]*)\n([\s\S]*?)```/gi,
  ];
  for (const re of variants) while ((m = re.exec(md)) !== null) push(m[1], m[3], m[2]);
  const infoPath = /```([\w.+-]+)\s+([^\n`]+\.[\w.-]+)\n([\s\S]*?)```/gi;
  while ((m = infoPath.exec(md)) !== null) push(m[2], m[3], m[1]);
  const infoOnly = /```([^\n`\s]+\.[A-Za-z0-9_.-]+)\n([\s\S]*?)```/gi;
  while ((m = infoOnly.exec(md)) !== null) if (looksLikePath(m[1])) push(m[1], m[2], inferLang(m[1]));
  const generic = /```([\w.+-]*)\n([\s\S]*?)```/gi;
  while ((m = generic.exec(md)) !== null) {
    const info = (m[1] || "").trim();
    let path: string | null = null, lang = info;
    if (info && looksLikePath(info)) { path = info; lang = inferLang(info); }
    else { path = findPathNear(md, m.index); if (path && !lang) lang = inferLang(path); }
    if (path) push(path, m[2], lang);
  }
  return out.slice(0, 12);
}

function isAbsPath(p: string) { return p.startsWith("/") || /^[A-Za-z]:[\\/]/.test(p); }
function resolvePath(path: string, folder: string | null): string | null {
  const n = cleanPath(path).replace(/\\/g, "/");
  if (!n) return null;
  if (isAbsPath(n)) return n;
  if (!folder) return null;
  return `${folder.replace(/[\\/]+$/, "")}/${n.replace(/^\.?\//, "")}`;
}

// ── Mode config ──────────────────────────────────────────────
const MODES = [
  { id: "chat",      label: "Chat",    emoji: null,  title: "Direct answers" },
  { id: "think",     label: "Think",   emoji: null,  title: "Step-by-step reasoning" },
  { id: "agent",     label: "Agent",   emoji: null,  title: "Plan + file-level actions" },
  { id: "bug_hunt",  label: "Bugs",    emoji: "🐛",  title: "Find bugs & vulnerabilities" },
  { id: "architect", label: "Arch",    emoji: "🏗️", title: "Architecture review" },
] as const;

export function AIPanel() {
  const [applyingMessageId, setApplyingMessageId] = useState<string | null>(null);
  const [applyingFileKey, setApplyingFileKey] = useState<string | null>(null);
  const [fileExistenceMap, setFileExistenceMap] = useState<Record<string, boolean>>({});
  const [rejectedMsgIds, setRejectedMsgIds] = useState<Set<string>>(new Set());
  const [rejectedFileKeys, setRejectedFileKeys] = useState<Set<string>>(new Set());
  const [rejectedCmdKeys, setRejectedCmdKeys] = useState<Set<string>>(new Set());
  const [rollingBack, setRollingBack] = useState(false);
  const [input, setInput] = useState("");
  const [showModelSelect, setShowModelSelect] = useState(false);
  const [diffModalData, setDiffModalData] = useState<{
    isOpen: boolean; suggestionKey: string; originalPath: string;
    originalContent: string; modifiedContent: string; onAccept: () => void;
  }>({ isOpen: false, suggestionKey: "", originalPath: "", originalContent: "", modifiedContent: "", onAccept: () => {} });


  const modelSelectorRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const {
    chatHistory, isThinking, isOllamaRunning,
    availableModels, selectedOllamaModels, toggleOllamaModel,
    apiKeys, selectedApiKeyIndices, toggleAPIKey,
    useRAG, aiMode, agentLiveOutput, agentEvents, showThinking,
    indexedChunks, isIndexing, sendMessage, clearChat, toggleRAG,
    setAIMode, setShowThinking, indexCodebase, checkOllama, startOllama, setOpenFolder,
    sessions, activeSessionId, showSessionList,
    newChat, switchSession, deleteSession, toggleSessionList,
  } = useAIStore();

  const {
    openFolder, tabs, activeTabId, openFile,
    applyAIChangeToTab, applyAIChangeToFile, rollbackLastAIChange, aiChangeHistory,
  } = useEditorStore();
  const { toggleSettingsPanel, addToast } = useUIStore();

  const activeTab = tabs.find(t => t.id === activeTabId);

  // Scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatHistory, agentLiveOutput, agentEvents, isThinking]);

  // Close dropdown on outside click
  useEffect(() => {
    const fn = (e: MouseEvent) => {
      if (showModelSelect && modelSelectorRef.current && !modelSelectorRef.current.contains(e.target as Node))
        setShowModelSelect(false);
    };
    document.addEventListener("mousedown", fn);
    return () => document.removeEventListener("mousedown", fn);
  }, [showModelSelect]);

  useEffect(() => { checkOllama(); }, [checkOllama]);
  useEffect(() => { if (showModelSelect) checkOllama(); }, [showModelSelect, checkOllama]);
  useEffect(() => { setOpenFolder(openFolder ?? null); }, [openFolder, setOpenFolder]);
  useEffect(() => {
    if (useRAG && openFolder && indexedChunks === 0 && !isIndexing) indexCodebase(openFolder);
  }, [useRAG, openFolder, indexedChunks, isIndexing, indexCodebase]);

  // Check file existence for suggestions
  useEffect(() => {
    const allPaths = chatHistory.flatMap(msg =>
      msg.role === "assistant" ? extractFileSuggestions(msg.content).map(s => resolvePath(s.path, openFolder ?? null)).filter(Boolean) as string[] : []
    );
    const unchecked = allPaths.filter(p => !(p in fileExistenceMap));
    if (!unchecked.length) return;
    Promise.all(unchecked.map(async p => ({ p, exists: await checkFileExistsCached(p) }))).then(results => {
      setFileExistenceMap(prev => {
        const next = { ...prev };
        results.forEach(({ p, exists }) => { next[p] = exists; });
        return next;
      });
    });
  }, [chatHistory, openFolder]);

  const handleSend = async () => {
    const text = input.trim();
    if (!text || isThinking) return;
    let content = text;
    let activeFileContext: string | undefined;
    if (activeTabId && activeTab) {
      const fileCode = `\`\`\`${activeTab.language}\n// ${activeTab.fileName}\n${activeTab.content.slice(0, 4000)}\n\`\`\``;
      if (text.includes("@file")) content = text.replace("@file", `\n${fileCode}\n`);
      else activeFileContext = fileCode;
    }
    setInput("");
    await sendMessage(content, activeFileContext);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); }
  };

  // Model label
  const totalSelected = selectedOllamaModels.length + selectedApiKeyIndices.length;
  let modelLabel = "Select Model";
  if (totalSelected === 1) {
    if (selectedOllamaModels.length === 1) modelLabel = selectedOllamaModels[0];
    else { const e = apiKeys[selectedApiKeyIndices[0]]; modelLabel = e ? `${e.provider}: ${e.model}` : "API"; }
  } else if (totalSelected > 1) {
    modelLabel = `${totalSelected} models`;
  }

  const needsOllama = aiMode === "agent" || useRAG || selectedOllamaModels.length > 0;
  const showOllamaWarn = selectedOllamaModels.length > 0 && !isOllamaRunning;
  const isOnline = !showOllamaWarn;
  const canSend = !((needsOllama && !isOllamaRunning) || isThinking || !input.trim());

  const renderMarkdown = (content: string) =>
    DOMPurify.sanitize(
      marked.parse(content.replace(/<execute>[\s\S]*?<\/execute>/g, '<div class="ai-exec-badge">⚙ Executed</div>')) as string
    );

  return (
    <div className="ai-panel">
      {/* ── Session list overlay ── */}
      {showSessionList && (
        <div className="aip-session-list">
          <div className="aip-session-list-hdr">
            <span>Chat History</span>
            <button className="aip-icon-btn" onClick={toggleSessionList} title="Close"><X size={13} /></button>
          </div>
          <button className="aip-session-new-btn" onClick={() => { newChat(); toggleSessionList(); }}>
            <Plus size={12} /> New Chat
          </button>
          <div className="aip-session-items">
            {sessions.length === 0 && <div className="aip-session-empty">No saved chats yet</div>}
            {sessions.map(s => (
              <div key={s.id} className={`aip-session-item ${s.id === activeSessionId ? "active" : ""}`}>
                <button className="aip-session-item-btn" onClick={() => { switchSession(s.id); toggleSessionList(); }}>
                  <MessageSquare size={11} />
                  <div className="aip-session-item-info">
                    <span className="aip-session-item-title">{s.title}</span>
                    <span className="aip-session-item-meta">
                      {s.messages.length} msgs · {new Date(s.updatedAt).toLocaleDateString()}
                    </span>
                  </div>
                </button>
                <button className="aip-session-del" onClick={() => deleteSession(s.id)} title="Delete">
                  <X size={10} />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Header ── */}
      <div className="aip-header">
        <div className="aip-title-row">
          <button className="aip-icon-btn" onClick={toggleSessionList} title="Chat history">
            <ChevronLeft size={13} />
          </button>
          <span className="aip-logo">✦</span>
          <span className="aip-title">AI Assistant</span>
          <span className={`aip-dot ${isOnline ? "on" : "off"}`} title={isOnline ? "Ollama connected" : "Ollama offline"} />
          <div className="aip-header-actions">
            <button className="aip-icon-btn" onClick={newChat} title="New chat">
              <Plus size={13} />
            </button>
            <button
              className={`aip-icon-btn ${useRAG ? "active-rag" : ""}`}
              onClick={toggleRAG}
              title={useRAG ? `RAG ON — ${indexedChunks} chunks` : "Enable RAG"}
            >
              <Database size={13} />
              {useRAG && <span className="aip-rag-count">{indexedChunks}</span>}
            </button>
            <button
              className="aip-icon-btn"
              onClick={async () => {
                setRollingBack(true);
                try {
                  const ok = await rollbackLastAIChange();
                  if (!ok) addToast("Nothing to rollback.", "warning");
                } finally { setRollingBack(false); }
              }}
              disabled={rollingBack || aiChangeHistory.length === 0}
              title="Rollback last AI change"
            >
              <Undo2 size={13} />
            </button>
            <button className="aip-icon-btn" onClick={clearChat} title="Clear chat">
              <Trash2 size={13} />
            </button>
          </div>
        </div>

        {/* Mode pills */}
        <div className="aip-modes">
          {MODES.map(m => (
            <button
              key={m.id}
              className={`aip-mode-pill ${aiMode === m.id ? "active" : ""}`}
              onClick={() => setAIMode(m.id as any)}
              title={m.title}
            >
              {m.emoji && <span>{m.emoji}</span>}
              {m.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Ollama warning ── */}
      {showOllamaWarn && (
        <div className="aip-banner aip-banner-warn">
          <Zap size={13} />
          <div className="aip-banner-body">
            <strong>Ollama not running</strong>
            <span>Run <code>ollama serve</code> to start it</span>
            <button className="aip-btn-sm" onClick={startOllama}>Start</button>
          </div>
        </div>
      )}

      {/* ── RAG index prompt ── */}
      {useRAG && indexedChunks === 0 && openFolder && (
        <div className="aip-banner aip-banner-info">
          <Database size={13} />
          <div className="aip-banner-body">
            <strong>Index codebase for RAG</strong>
            <button className="aip-btn-sm aip-btn-primary" onClick={() => indexCodebase(openFolder)} disabled={isIndexing}>
              {isIndexing ? <><RefreshCw size={11} className="spin-icon" /> Indexing…</> : "Index Now"}
            </button>
          </div>
        </div>
      )}

      {/* ── Model selector ── */}
      <div className="aip-model-bar" ref={modelSelectorRef}>
        <button className="aip-model-btn" onClick={() => setShowModelSelect(s => !s)}>
          <Cpu size={12} />
          <span className="aip-model-label">{modelLabel}</span>
          <ChevronDown size={11} className={showModelSelect ? "rotated" : ""} />
        </button>

        {showModelSelect && (
          <div className="aip-model-dropdown">
            <div className="aip-dropdown-section">Ollama Models</div>
            {availableModels.length === 0 && (
              <div className="aip-dropdown-empty">{isOllamaRunning ? "No models installed" : "Ollama not running"}</div>
            )}
            {availableModels.map(m => (
              <button key={m} className={`aip-model-opt ${selectedOllamaModels.includes(m) ? "sel" : ""}`} onClick={() => toggleOllamaModel(m)}>
                <span className={`aip-check ${selectedOllamaModels.includes(m) ? "checked" : ""}`} />
                <span className="aip-model-name">{m}</span>
              </button>
            ))}
            {selectedOllamaModels.filter(m => !availableModels.includes(m)).map(m => (
              <button key={`stale-${m}`} className="aip-model-opt sel stale" onClick={() => toggleOllamaModel(m)} title="Not installed — click to remove">
                <span className="aip-check checked" />
                <span className="aip-model-name">{m}</span>
                <span className="aip-stale-badge">⚠ missing</span>
              </button>
            ))}
            {apiKeys.length > 0 && (
              <>
                <div className="aip-dropdown-section" style={{ marginTop: 4 }}>API Keys</div>
                {apiKeys.map((k, i) => (
                  <button key={i} className={`aip-model-opt ${selectedApiKeyIndices.includes(i) ? "sel" : ""}`} onClick={() => toggleAPIKey(i)}>
                    <span className={`aip-check ${selectedApiKeyIndices.includes(i) ? "checked" : ""}`} />
                    <span className="aip-model-name">{k.provider}: {k.model}</span>
                  </button>
                ))}
              </>
            )}
            <div className="aip-dropdown-footer">
              <button className="aip-btn-sm" onClick={() => setShowModelSelect(false)}>Close</button>
              <button className="aip-btn-sm" onClick={() => { setShowModelSelect(false); toggleSettingsPanel(); }}>Manage</button>
            </div>
          </div>
        )}
      </div>

      {/* ── Messages ── */}
      <div className="aip-messages">
        {chatHistory.length === 0 ? (
          <div className="aip-welcome">
            <div className="aip-welcome-icon">✦</div>
            <p className="aip-welcome-title">AI Code Assistant</p>
            <p className="aip-welcome-sub">Ask anything. Use <code>@file</code> to attach the current file.</p>
            <div className="aip-chips">
              {["Explain this function", "Find bugs in @file", "Refactor @file", "Write tests", "How does this work?"].map(s => (
                <button key={s} className="aip-chip" onClick={() => setInput(s)}>{s}</button>
              ))}
            </div>
          </div>
        ) : (
          chatHistory.map(msg => {
            const codeSuggestion = msg.role === "assistant" ? extractFirstCodeBlock(msg.content) : null;
            const fileSuggestions = msg.role === "assistant" ? extractFileSuggestions(msg.content) : [];
            const shellCmds = msg.role === "assistant" ? extractShellCommands(msg.content) : [];
            const canApprove = !!codeSuggestion && !!activeTabId && !!activeTab && msg.role === "assistant" && fileSuggestions.length === 0 && !rejectedMsgIds.has(msg.id);

            return (
              <div key={msg.id} className={`aip-msg aip-msg-${msg.role}`}>
                <div className="aip-msg-meta">
                  <span className="aip-msg-role">
                    {msg.role === "user" ? "You" : "AI"}
                    {msg.role === "assistant" && msg.model && (
                      <span className="aip-msg-model"> · {msg.model}</span>
                    )}
                  </span>
                  <span className="aip-msg-time">
                    {new Date(msg.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                  </span>
                </div>
                <div className="aip-msg-body" dangerouslySetInnerHTML={{ __html: renderMarkdown(msg.content) }} />

                {/* Accept/Reject inline code suggestion */}
                {canApprove && (
                  <div className="aip-actions">
                    <button className="aip-action-btn primary" disabled={applyingMessageId === msg.id}
                      onClick={async () => {
                        if (!activeTabId || !codeSuggestion || !activeTab) return;
                        if (!window.confirm(`Apply to ${activeTab.fileName}?`)) return;
                        setApplyingMessageId(msg.id);
                        try { await applyAIChangeToTab(activeTabId, codeSuggestion, `AI suggestion ${new Date(msg.timestamp).toLocaleTimeString()}`); }
                        finally { setApplyingMessageId(null); }
                      }}>
                      <Check size={11} /> Accept
                    </button>
                    <button className="aip-action-btn" onClick={() => setRejectedMsgIds(s => { const n = new Set(s); n.add(msg.id); return n; })}>
                      <X size={11} /> Reject
                    </button>
                  </div>
                )}

                {/* File suggestions */}
                {fileSuggestions.length > 0 && (
                  <div className="aip-file-suggestions">
                    {fileSuggestions.map((s, idx) => {
                      const key = `${msg.id}-f${idx}-${s.path}`;
                      if (rejectedFileKeys.has(key)) return null;
                      const rp = resolvePath(s.path, openFolder ?? null);
                      const disabled = applyingFileKey === key || !rp;
                      const exists = rp ? fileExistenceMap[rp] : false;
                      return (
                        <div key={key} className="aip-file-row">
                          <div className="aip-file-info">
                            <FileCode size={11} />
                            <code className="aip-file-path">{s.path}</code>
                            <span className={`aip-file-badge ${exists ? "update" : "create"}`}>{exists ? "UPDATE" : "CREATE"}</span>
                          </div>
                          <div className="aip-actions">
                            <button className="aip-action-btn" disabled={disabled}
                              onClick={async () => {
                                if (!rp) { addToast("Open a project folder first.", "warning"); return; }
                                let orig = "";
                                if (exists) { try { orig = await readTextFile(rp); } catch {} }
                                setDiffModalData({
                                  isOpen: true, suggestionKey: key, originalPath: rp,
                                  originalContent: orig, modifiedContent: s.content,
                                  onAccept: async () => {
                                    setApplyingFileKey(key);
                                    try {
                                      await applyAIChangeToFile(rp, s.content, `AI file suggestion`);
                                      setFileExistenceMap(p => ({ ...p, [rp]: true }));
                                      fileExistsCache.set(rp, true);
                                      setTimeout(() => useAIStore.getState().sendMessage(`Accepted \`${s.path}\`. Proceed or output \`<task_complete>\`.`), 500);
                                      setDiffModalData(p => ({ ...p, isOpen: false }));
                                    } finally { setApplyingFileKey(null); }
                                  }
                                });
                              }}>
                              <Eye size={11} /> Diff
                            </button>
                            <button className="aip-action-btn primary" disabled={disabled}
                              onClick={async () => {
                                if (!rp) { addToast("Open a project folder first.", "warning"); return; }
                                if (!window.confirm(`${exists ? "Update" : "Create"} ${rp}?`)) return;
                                setApplyingFileKey(key);
                                try {
                                  await applyAIChangeToFile(rp, s.content, `AI file suggestion`);
                                  setFileExistenceMap(p => ({ ...p, [rp]: true }));
                                  fileExistsCache.set(rp, true);
                                  setTimeout(() => useAIStore.getState().sendMessage(`Accepted \`${s.path}\`. Proceed or output \`<task_complete>\`.`), 500);
                                } finally { setApplyingFileKey(null); }
                              }}>
                              <Check size={11} /> {exists ? "Update" : "Create"}
                            </button>
                            <button className="aip-action-btn" onClick={() => setRejectedFileKeys(p => { const n = new Set(p); n.add(key); return n; })}>
                              <X size={11} />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Shell commands */}
                {shellCmds.length > 0 && (
                  <div className="aip-cmd-list">
                    {shellCmds.map((cmd, idx) => {
                      const key = `${msg.id}-c${idx}`;
                      if (rejectedCmdKeys.has(key)) return null;
                      return (
                        <div key={key} className="aip-cmd-row">
                          <Terminal size={11} className="aip-cmd-icon" />
                          <code className="aip-cmd-code">{cmd}</code>
                          <div className="aip-actions">
                            <button className="aip-action-btn primary"
                              onClick={() => {
                                useTerminalStore.getState().runCommandInTerminal(cmd);
                                addToast("Running in terminal…", "info");
                                setRejectedCmdKeys(s => { const n = new Set(s); n.add(key); return n; });
                              }}>
                              <Check size={11} /> Run
                            </button>
                            <button className="aip-action-btn" onClick={() => setRejectedCmdKeys(s => { const n = new Set(s); n.add(key); return n; })}>
                              <X size={11} />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Sources */}
                {msg.sources && msg.sources.length > 0 && (
                  <div className="aip-sources">
                    {msg.sources.map((src, i) => (
                      <button key={i} className="aip-source" onClick={() => openFile(src.filePath)} title={`${src.filePath}:${src.startLine}`}>
                        <ExternalLink size={9} />
                        {src.filePath.split(/[\\/]/).pop()}:{src.startLine}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          })
        )}

        {/* Agent live stream */}
        {(agentLiveOutput || agentEvents.length > 0) && (isThinking || agentLiveOutput) && (
          <div className="aip-agent-stream">
            <div className="aip-agent-stream-hdr">
              <span>Agent trace</span>
              <button className="aip-icon-btn" onClick={() => setShowThinking(!showThinking)}>
                {showThinking ? <EyeOff size={11} /> : <Eye size={11} />}
              </button>
            </div>
            {agentEvents.slice(-8).map((evt, i) => (
              <div key={`${evt.ts}-${i}`} className={`aip-agent-evt aip-agent-evt-${evt.kind}`}>
                <span className="aip-agent-evt-kind">{evt.kind}</span>
                <span>{evt.message}</span>
              </div>
            ))}
            {showThinking && agentLiveOutput && (
              <div className="aip-agent-thinking aip-msg-body" dangerouslySetInnerHTML={{ __html: marked(agentLiveOutput) as string }} />
            )}
          </div>
        )}

        {/* Thinking dots */}
        {isThinking && aiMode !== "agent" && (
          <div className="aip-msg aip-msg-assistant">
            <div className="aip-thinking"><span /><span /><span /></div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* ── Agent control bar ── */}
      {aiMode === "agent" && isThinking && (
        <div className="aip-agent-bar">
          <div className="aip-agent-bar-left">
            <Sparkles size={12} />
            <span>Agent running</span>
            {agentEvents.length > 0 && <span className="aip-agent-step-count">{agentEvents.length} steps</span>}
          </div>
          <button className="aip-stop-btn" onClick={() => setInput("")} title="Stop agent">
            <StopCircle size={12} /> Stop
          </button>
        </div>
      )}

      {/* ── Input ── */}
      <div className="aip-input-wrap">
        {activeTab && (
          <div className="aip-context-pill">
            <FileCode size={10} />
            <span>{activeTab.fileName}</span>
          </div>
        )}
        <div className="aip-input-row">
          <textarea
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={`Ask AI… (${aiMode}${useRAG ? " + RAG" : ""})`}
            rows={3}
            disabled={(needsOllama && !isOllamaRunning) || isThinking}
            className="aip-textarea"
          />
          <button className="aip-send" onClick={handleSend} disabled={!canSend} title="Send (Enter)">
            <Send size={14} />
          </button>
        </div>
      </div>

      {/* Diff modal */}
      {diffModalData.isOpen && (
        <DiffModal
          isOpen={diffModalData.isOpen}
          originalPath={diffModalData.originalPath}
          originalContent={diffModalData.originalContent}
          modifiedContent={diffModalData.modifiedContent}
          onAccept={diffModalData.onAccept}
          onReject={() => setDiffModalData(p => ({ ...p, isOpen: false }))}
          onClose={() => setDiffModalData(p => ({ ...p, isOpen: false }))}
        />
      )}
    </div>
  );
}
