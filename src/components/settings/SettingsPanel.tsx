// src/components/settings/SettingsPanel.tsx
import { useEffect, useState } from "react";
import { useUIStore } from "../../store/uiStore";
import type { ColorTheme, EditorFont, UiFont } from "../../store/uiStore";
import { useAIStore } from "../../store/aiStore";
import type { ApiKeyEntry } from "../../store/aiStore";
import {
  Settings, Type, RefreshCw, CheckCircle, XCircle, Trash2,
  ChevronDown, ChevronRight, Eye, EyeOff, Plus, Zap, Download,
  Cpu, Cloud, Activity, AlertTriangle,
} from "lucide-react";

interface ThemePreviewData {
  id: ColorTheme;
  label: string;
  swatches: { bg: string; sidebar: string; accent: string; text: string };
}

const THEME_PREVIEWS: ThemePreviewData[] = [
  { id: "dark",          label: "One Dark Pro",   swatches: { bg: "#1e1e1e", sidebar: "#252526", accent: "#007acc", text: "#cccccc" } },
  { id: "light",         label: "One Light",      swatches: { bg: "#fafafa", sidebar: "#f3f3f3", accent: "#007acc", text: "#383a42" } },
  { id: "high-contrast", label: "High Contrast",  swatches: { bg: "#000000", sidebar: "#0a0a0a", accent: "#ffffff", text: "#ffffff" } },
  { id: "solarized-dark",label: "Solarized Dark", swatches: { bg: "#002b36", sidebar: "#073642", accent: "#268bd2", text: "#839496" } },
  { id: "monokai",       label: "Monokai",        swatches: { bg: "#272822", sidebar: "#1e1f1c", accent: "#a6e22e", text: "#f8f8f2" } },
  { id: "github",        label: "GitHub Dark",    swatches: { bg: "#0d1117", sidebar: "#010409", accent: "#1f6feb", text: "#c9d1d9" } },
  { id: "dracula",       label: "Dracula",        swatches: { bg: "#282a36", sidebar: "#21222c", accent: "#bd93f9", text: "#f8f8f2" } },
];

const EDITOR_FONTS: { value: EditorFont; label: string }[] = [
  { value: "JetBrains Mono",        label: "JetBrains Mono" },
  { value: "Fira Code",             label: "Fira Code" },
  { value: "Cascadia Code",         label: "Cascadia Code" },
  { value: "Source Code Pro",       label: "Source Code Pro" },
  { value: "Inconsolata",           label: "Inconsolata" },
  { value: "Consolas, Courier New", label: "Consolas / Courier New" },
];

const UI_FONTS: { value: UiFont; label: string }[] = [
  { value: "Inter",                         label: "Inter" },
  { value: "Segoe UI, system-ui",           label: "Segoe UI" },
  { value: "-apple-system, SF Pro Display", label: "SF Pro" },
  { value: "Roboto",                        label: "Roboto" },
];

const CLOUD_PROVIDERS = [
  { value: "openai",    label: "OpenAI",    models: ["gpt-4o", "gpt-4o-mini", "gpt-4-turbo", "gpt-3.5-turbo"] },
  { value: "anthropic", label: "Anthropic", models: ["claude-3-5-sonnet-20241022", "claude-3-haiku-20240307", "claude-3-opus-20240229"] },
  { value: "groq",      label: "Groq",      models: ["llama-3.3-70b-versatile", "mixtral-8x7b-32768", "gemma2-9b-it"] },
  { value: "airllm",   label: "AirLLM",    models: [] },
  { value: "vllm",     label: "vLLM",      models: [] },
];

// ── Collapsible section wrapper ──────────────────────────────
function Section({ title, icon, badge, defaultOpen = true, children }: {
  title: string; icon: React.ReactNode; badge?: React.ReactNode;
  defaultOpen?: boolean; children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="llm-section">
      <button className="llm-section-hdr" onClick={() => setOpen(o => !o)}>
        <span className="llm-section-icon">{icon}</span>
        <span className="llm-section-title">{title}</span>
        {badge && <span className="llm-section-badge">{badge}</span>}
        <span className="llm-section-chevron">{open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}</span>
      </button>
      {open && <div className="llm-section-body">{children}</div>}
    </div>
  );
}

// ── Status pill ──────────────────────────────────────────────
function StatusPill({ ok, label }: { ok: boolean | null; label: string }) {
  if (ok === null) return <span className="llm-pill llm-pill-unknown">⋯ {label}</span>;
  return ok
    ? <span className="llm-pill llm-pill-ok"><CheckCircle size={10} /> {label}</span>
    : <span className="llm-pill llm-pill-err"><XCircle size={10} /> {label}</span>;
}

// ── API Key row ──────────────────────────────────────────────
function ApiKeyRow({ entry, index, active, onToggle, onRemove, onFetch, loading, error, models }: {
  entry: ApiKeyEntry; index: number; active: boolean;
  onToggle: () => void; onRemove: () => void; onFetch: () => void;
  loading: boolean; error?: string; models?: string[];
}) {
  const [showKey, setShowKey] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const providerInfo = CLOUD_PROVIDERS.find(p => p.value === entry.provider);

  return (
    <div className={`llm-key-row ${active ? "active" : ""}`}>
      <div className="llm-key-row-main" onClick={onToggle}>
        <input type="checkbox" checked={active} readOnly className="llm-key-check" />
        <div className="llm-key-info">
          <span className="llm-key-provider">{providerInfo?.label ?? entry.provider.toUpperCase()}</span>
          <span className="llm-key-model">{entry.model}</span>
          {entry.label && <span className="llm-key-label">{entry.label}</span>}
        </div>
        <div className="llm-key-actions" onClick={e => e.stopPropagation()}>
          <button className="llm-icon-btn" onClick={() => setExpanded(o => !o)} title="Details">
            {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          </button>
          <button className="llm-icon-btn" onClick={onFetch} disabled={loading} title="Fetch available models">
            <RefreshCw size={12} className={loading ? "spin-icon" : ""} />
          </button>
          <button className="llm-icon-btn danger" onClick={onRemove} title="Remove">
            <Trash2 size={12} />
          </button>
        </div>
      </div>

      {expanded && (
        <div className="llm-key-detail">
          <div className="llm-field-row">
            <span className="llm-field-label">API Key</span>
            <div className="llm-field-value-row">
              <input
                type={showKey ? "text" : "password"}
                value={entry.apiKey}
                readOnly
                className="llm-input llm-input-sm"
              />
              <button className="llm-icon-btn" onClick={() => setShowKey(v => !v)}>
                {showKey ? <EyeOff size={11} /> : <Eye size={11} />}
              </button>
            </div>
          </div>
          {entry.baseUrl && (
            <div className="llm-field-row">
              <span className="llm-field-label">Base URL</span>
              <span className="llm-field-value">{entry.baseUrl}</span>
            </div>
          )}
          {error && <div className="llm-error-text">{error}</div>}
          {models && models.length > 0 && (
            <div className="llm-field-row">
              <span className="llm-field-label">Models</span>
              <span className="llm-field-value">{models.slice(0, 5).join(", ")}{models.length > 5 ? ` +${models.length - 5}` : ""}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Add API Key form ─────────────────────────────────────────
function AddApiKeyForm({ onAdd }: { onAdd: (entry: ApiKeyEntry) => void }) {
  const [provider, setProvider] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("");
  const [label, setLabel] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [error, setError] = useState("");

  const providerInfo = CLOUD_PROVIDERS.find(p => p.value === provider);
  const needsBaseUrl = provider === "openai_compat" || provider === "vllm" || provider === "airllm";

  const handleAdd = () => {
    if (!provider) { setError("Select a provider"); return; }
    if (!apiKey && provider !== "airllm" && provider !== "vllm") { setError("API key is required"); return; }
    if (!model) { setError("Model name is required"); return; }
    if (needsBaseUrl && !baseUrl) { setError("Base URL is required for this provider"); return; }
    if (baseUrl && !baseUrl.startsWith("http://") && !baseUrl.startsWith("https://")) {
      setError("Base URL must start with http:// or https://"); return;
    }
    onAdd({ provider, apiKey, model, label: label || undefined, baseUrl: baseUrl || undefined });
    setProvider(""); setApiKey(""); setModel(""); setLabel(""); setBaseUrl(""); setError("");
  };

  return (
    <div className="llm-add-form">
      <div className="llm-field-row">
        <span className="llm-field-label">Provider</span>
        <select className="llm-select" value={provider} onChange={e => { setProvider(e.target.value); setModel(""); setError(""); }}>
          <option value="">— Select —</option>
          {CLOUD_PROVIDERS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
          <option value="openai_compat">OpenAI-Compatible (custom)</option>
          <option value="huggingface">HuggingFace Inference API</option>
        </select>
      </div>

      {provider && (
        <>
          <div className="llm-field-row">
            <span className="llm-field-label">API Key</span>
            <div className="llm-field-value-row">
              <input
                type={showKey ? "text" : "password"}
                className="llm-input"
                placeholder={provider === "airllm" ? "Not required" : "sk-..."}
                value={apiKey}
                onChange={e => { setApiKey(e.target.value); setError(""); }}
              />
              <button className="llm-icon-btn" onClick={() => setShowKey(v => !v)}>
                {showKey ? <EyeOff size={11} /> : <Eye size={11} />}
              </button>
            </div>
          </div>

          <div className="llm-field-row">
            <span className="llm-field-label">Model</span>
            {providerInfo && providerInfo.models.length > 0 ? (
              <select className="llm-select" value={model} onChange={e => { setModel(e.target.value); setError(""); }}>
                <option value="">— Select model —</option>
                {providerInfo.models.map(m => <option key={m} value={m}>{m}</option>)}
                <option value="__custom__">Custom…</option>
              </select>
            ) : (
              <input
                type="text"
                className="llm-input"
                placeholder="e.g. gpt-4o, claude-3-5-sonnet-20241022"
                value={model}
                onChange={e => { setModel(e.target.value); setError(""); }}
              />
            )}
          </div>

          {(model === "__custom__" || (providerInfo && providerInfo.models.length > 0 && !providerInfo.models.includes(model) && model !== "__custom__" && model !== "")) && (
            <div className="llm-field-row">
              <span className="llm-field-label">Custom Model</span>
              <input type="text" className="llm-input" placeholder="model-name" value={model === "__custom__" ? "" : model}
                onChange={e => { setModel(e.target.value); setError(""); }} />
            </div>
          )}

          {(needsBaseUrl || provider === "openai_compat") && (
            <div className="llm-field-row">
              <span className="llm-field-label">Base URL</span>
              <input type="text" className="llm-input" placeholder="https://my-server.example.com/v1"
                value={baseUrl} onChange={e => { setBaseUrl(e.target.value); setError(""); }} />
            </div>
          )}

          <div className="llm-field-row">
            <span className="llm-field-label">Label <span className="llm-optional">(optional)</span></span>
            <input type="text" className="llm-input" placeholder="My work key"
              value={label} onChange={e => setLabel(e.target.value)} />
          </div>
        </>
      )}

      {error && <div className="llm-error-text">{error}</div>}

      <button className="llm-btn llm-btn-primary" onClick={handleAdd} disabled={!provider}>
        <Plus size={12} /> Add Provider
      </button>
    </div>
  );
}

// ── Main SettingsPanel ───────────────────────────────────────
export function SettingsPanel() {
  const {
    colorTheme, setColorTheme, iconTheme, setIconTheme,
    editorFont, setEditorFont, uiFont, setUiFont,
    fontSize, setFontSize, tabSize, setTabSize,
    wordWrap, setWordWrap, formatOnSave, setFormatOnSave,
    autoSave, setAutoSave, minimapEnabled, setMinimapEnabled,
    inlineCompletionsEnabled, setInlineCompletionsEnabled,
  } = useUIStore();

  const {
    isOllamaRunning, availableModels, checkOllama, startOllama,
    apiKeys, addAPIKey, removeAPIKey,
    selectedProvider, aiServiceMode, selectedApiKeyIndices,
    toggleAPIKey, setProvider, setAIServiceMode,
    checkGrpcService, startGrpcService,
    ollamaBaseUrl, setOllamaBaseUrl,
    ollamaModelsLoading, ollamaModelsError,
    selectedOllamaModels, toggleOllamaModel, fetchOllamaModels,
    fetchOpenAIModels, fetchAnthropicModels, fetchGroqModels,
    apiProviderLoading, apiProviderErrors, apiProviderModels,
    isGrpcHealthy, grpcStatusError, grpcStarting,
    hfApiKey, hfBaseUrl, hfSelectedModel, hfModels,
    setHFApiKey, setHFBaseUrl, setHFModel, fetchHFModels,
    localModels, listLocalModels, deleteLocalModel,
    selectedLocalModel, setSelectedLocalModel,
    hfLocalToken, setHFLocalToken,
    hfSearchResults, hfSearchLoading, hfSearchError,
    downloadQueue, searchHFModels, downloadModel, cancelDownload,
    turboQuantStatus, turboQuantProgress, turboQuantStage, turboQuantError,
    quantizedModels, startTurboQuant, cancelTurboQuant, listQuantizedModels, deleteQuantizedModel,
  } = useAIStore();

  const [selectedTab, setSelectedTab] = useState("editor");
  const [hfKeyVisible, setHfKeyVisible] = useState(false);
  const [localTokenVisible, setLocalTokenVisible] = useState(false);

  // TurboQuant form state
  const [tqModelId, setTqModelId] = useState("");
  const [tqMethod, setTqMethod] = useState<"GGUF" | "GPTQ" | "AWQ">("GGUF");
  const [tqBits, setTqBits] = useState<4 | 8>(4);

  // HF Hub search state
  const [hfSearchQuery, setHfSearchQuery] = useState("");
  const [hfSearchTask, setHfSearchTask] = useState("text-generation");
  const [hfSearchMaxSize, setHfSearchMaxSize] = useState("");
  const [hfSearchDebounce, setHfSearchDebounce] = useState<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (selectedTab === "ai") {
      checkOllama();
      if (aiServiceMode === "grpc") checkGrpcService();
      listLocalModels();
      listQuantizedModels();
    }
  }, [selectedTab, aiServiceMode]);

  const totalActive = selectedOllamaModels.length + selectedApiKeyIndices.length +
    (selectedProvider === "huggingface" && hfApiKey ? 1 : 0) +
    (selectedProvider === "local" && selectedLocalModel ? 1 : 0);

  return (
    <div className="settings-panel">
      <div className="settings-header">
        <Settings size={16} />
        <span>Settings</span>
      </div>

      <div className="settings-tabs">
        {[
          { id: "editor", label: "Editor" },
          { id: "theme",  label: "Appearance" },
          { id: "ai",     label: "AI / LLM" },
        ].map(t => (
          <button key={t.id} className={`settings-tab ${selectedTab === t.id ? "active" : ""}`}
            onClick={() => setSelectedTab(t.id)}>
            {t.label}
            {t.id === "ai" && totalActive > 0 && (
              <span className="llm-tab-badge">{totalActive}</span>
            )}
          </button>
        ))}
      </div>

      <div className="settings-content">
        {/* ── Editor tab ── */}
        {selectedTab === "editor" && (
          <div className="settings-section">
            <h3>Editor Settings</h3>
            <div className="setting-item">
              <label htmlFor="font-size">Font Size</label>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <Type size={14} />
                <input id="font-size" type="range" min="10" max="24" value={fontSize}
                  onChange={e => setFontSize(Number(e.target.value))} style={{ flex: 1 }} />
                <span className="setting-value">{fontSize}px</span>
              </div>
            </div>
            <div className="setting-item">
              <label>Tab Size</label>
              <select value={tabSize} onChange={e => setTabSize(Number(e.target.value))} className="setting-select">
                <option value="2">2 spaces</option>
                <option value="4">4 spaces</option>
                <option value="8">8 spaces</option>
              </select>
            </div>
            {[
              { label: "Word Wrap", val: wordWrap, set: setWordWrap },
              { label: "Minimap", val: minimapEnabled, set: setMinimapEnabled },
              { label: "Format on Save", val: formatOnSave, set: setFormatOnSave },
              { label: "Auto Save", val: autoSave, set: setAutoSave },
              { label: "Inline AI Completions", val: inlineCompletionsEnabled, set: setInlineCompletionsEnabled },
            ].map(({ label, val, set }) => (
              <div key={label} className="setting-item">
                <label><input type="checkbox" checked={val} onChange={e => set(e.target.checked)} /> {label}</label>
              </div>
            ))}
          </div>
        )}

        {/* ── Appearance tab ── */}
        {selectedTab === "theme" && (
          <div className="settings-section">
            <h3>Appearance</h3>
            <h4 style={{ margin: "0 0 8px", fontSize: 12, color: "var(--text-secondary)" }}>Color Theme</h4>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(2,1fr)", gap: 8, marginBottom: 16 }}>
              {THEME_PREVIEWS.map(theme => (
                <button key={theme.id} onClick={() => setColorTheme(theme.id)} style={{
                  background: "var(--bg-input)", border: `2px solid ${colorTheme === theme.id ? "var(--accent)" : "var(--border)"}`,
                  borderRadius: 6, padding: 8, cursor: "pointer", textAlign: "left", color: "var(--text-primary)",
                }}>
                  <div style={{ fontSize: 11, marginBottom: 6, fontWeight: colorTheme === theme.id ? 600 : 400 }}>{theme.label}</div>
                  <div style={{ display: "flex", gap: 4 }}>
                    {(["bg","sidebar","accent","text"] as const).map(k => (
                      <div key={k} style={{ width: 14, height: 14, borderRadius: 2, backgroundColor: theme.swatches[k], border: "1px solid rgba(255,255,255,0.1)" }} />
                    ))}
                  </div>
                </button>
              ))}
            </div>
            <h4 style={{ margin: "0 0 8px", fontSize: 12, color: "var(--text-secondary)" }}>Fonts</h4>
            <div className="setting-item">
              <label>Editor Font</label>
              <select value={editorFont} onChange={e => setEditorFont(e.target.value as EditorFont)} className="setting-select">
                {EDITOR_FONTS.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
              </select>
            </div>
            <div className="setting-item">
              <label>UI Font</label>
              <select value={uiFont} onChange={e => setUiFont(e.target.value as UiFont)} className="setting-select">
                {UI_FONTS.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
              </select>
            </div>
            <div className="setting-item">
              <label>Icon Theme</label>
              <select value={iconTheme} onChange={e => setIconTheme(e.target.value as any)} className="setting-select">
                <option value="default">Default</option>
                <option value="noto">Noto Icons</option>
                <option value="simple">Simple Icons</option>
              </select>
            </div>
          </div>
        )}

        {/* ── AI / LLM tab ── */}
        {selectedTab === "ai" && (
          <div className="settings-section llm-manager">

            {/* ── Active Configuration Summary ── */}
            <div className="llm-summary-bar">
              <div className="llm-summary-title">
                <Activity size={13} />
                Active Configuration
              </div>
              <div className="llm-summary-pills">
                <StatusPill ok={isGrpcHealthy} label={aiServiceMode === "grpc" ? "gRPC" : "Direct"} />
                <StatusPill ok={isOllamaRunning} label="Ollama" />
                {selectedProvider === "huggingface" && hfApiKey && (
                  <StatusPill ok={true} label="HuggingFace API" />
                )}
                {selectedProvider === "local" && selectedLocalModel && (
                  <StatusPill ok={true} label={`Local: ${selectedLocalModel.split("/").pop()}`} />
                )}
              </div>
              {totalActive > 0 && (
                <div className="llm-summary-active">
                  {selectedOllamaModels.length > 0 && (
                    <span className="llm-active-chip ollama">
                      <Cpu size={9} /> {selectedOllamaModels.join(", ")}
                    </span>
                  )}
                  {selectedApiKeyIndices.map(i => apiKeys[i]).filter(Boolean).map((k, i) => (
                    <span key={i} className="llm-active-chip api">
                      <Cloud size={9} /> {k.provider}: {k.model}
                    </span>
                  ))}
                  {selectedProvider === "local" && selectedLocalModel && (
                    <span className="llm-active-chip local">
                      <Download size={9} /> {selectedLocalModel}
                    </span>
                  )}
                </div>
              )}
            </div>

            {/* ── Service Route ── */}
            <Section title="Service Route" icon={<Zap size={14} />}
              badge={<StatusPill ok={aiServiceMode === "grpc" ? isGrpcHealthy : true} label={aiServiceMode === "grpc" ? "gRPC" : "Direct"} />}>
              <div className="llm-field-row">
                <span className="llm-field-label">Route</span>
                <select className="llm-select" value={aiServiceMode} onChange={e => {
                  const mode = e.target.value as "direct" | "grpc";
                  setAIServiceMode(mode);
                  if (mode === "grpc") startGrpcService(); else checkGrpcService();
                }}>
                  <option value="direct">Direct — Rust → provider APIs</option>
                  <option value="grpc">gRPC — Rust → Python AI service (port 50051)</option>
                </select>
              </div>
              {aiServiceMode === "grpc" && (
                <div className="llm-grpc-status">
                  <div className={`llm-status-row ${isGrpcHealthy ? "ok" : "err"}`}>
                    {isGrpcHealthy ? <CheckCircle size={12} /> : <XCircle size={12} />}
                    <span>{isGrpcHealthy ? "Python AI service is healthy" : "Python AI service unreachable"}</span>
                    {grpcStatusError && <span className="llm-error-text">{grpcStatusError}</span>}
                  </div>
                  <div className="llm-btn-row">
                    <button className="llm-btn llm-btn-primary" onClick={startGrpcService} disabled={grpcStarting}>
                      <RefreshCw size={11} className={grpcStarting ? "spin-icon" : ""} />
                      {grpcStarting ? "Starting…" : "Start Service"}
                    </button>
                    <button className="llm-btn" onClick={checkGrpcService}>
                      <Activity size={11} /> Check Health
                    </button>
                  </div>
                  <div className="llm-hint">Run <code>cd python-ai-service && python3 main.py</code> to start the service.</div>
                </div>
              )}
            </Section>

            {/* ── Ollama ── */}
            <Section title="Ollama (Local)" icon={<Cpu size={14} />}
              badge={<StatusPill ok={isOllamaRunning} label={isOllamaRunning ? "Running" : "Offline"} />}>
              <div className="llm-field-row">
                <span className="llm-field-label">Base URL</span>
                <div className="llm-field-value-row">
                  <input type="text" className="llm-input" value={ollamaBaseUrl || "http://localhost:11434"}
                    onChange={e => setOllamaBaseUrl(e.target.value)} placeholder="http://localhost:11434" />
                  <button className="llm-btn llm-btn-primary" onClick={fetchOllamaModels} disabled={ollamaModelsLoading}>
                    <RefreshCw size={11} className={ollamaModelsLoading ? "spin-icon" : ""} />
                    {ollamaModelsLoading ? "Fetching…" : "Fetch"}
                  </button>
                </div>
              </div>

              {ollamaModelsError && (
                <div className="llm-error-banner">
                  <AlertTriangle size={11} /> {ollamaModelsError}
                </div>
              )}

              {!isOllamaRunning && (
                <div className="llm-btn-row">
                  <button className="llm-btn llm-btn-primary" onClick={startOllama}>Start Ollama</button>
                  <span className="llm-hint">Or run <code>ollama serve</code> in your terminal.</span>
                </div>
              )}

              {availableModels.length > 0 && (
                <div className="llm-model-grid">
                  <div className="llm-field-label" style={{ marginBottom: 6 }}>
                    Available Models ({availableModels.length}) — check to activate
                  </div>
                  {availableModels.map(m => (
                    <label key={m} className={`llm-model-chip ${selectedOllamaModels.includes(m) ? "active" : ""}`}>
                      <input type="checkbox" checked={selectedOllamaModels.includes(m)} onChange={() => toggleOllamaModel(m)} />
                      <Cpu size={10} />
                      <span>{m}</span>
                    </label>
                  ))}
                </div>
              )}

              {availableModels.length === 0 && isOllamaRunning && (
                <div className="llm-hint">No models installed. Run <code>ollama pull qwen2.5-coder</code> to get started.</div>
              )}
            </Section>

            {/* ── HuggingFace Inference API ── */}
            <Section title="HuggingFace Inference API" icon={<Cloud size={14} />} defaultOpen={false}>
              <div className="llm-field-row">
                <span className="llm-field-label">API Token</span>
                <div className="llm-field-value-row">
                  <input type={hfKeyVisible ? "text" : "password"} className="llm-input"
                    placeholder="hf_..." value={hfApiKey} onChange={e => setHFApiKey(e.target.value)} />
                  <button className="llm-icon-btn" onClick={() => setHfKeyVisible(v => !v)}>
                    {hfKeyVisible ? <EyeOff size={11} /> : <Eye size={11} />}
                  </button>
                </div>
              </div>
              <div className="llm-field-row">
                <span className="llm-field-label">Model ID</span>
                <div className="llm-field-value-row">
                  <input type="text" className="llm-input" placeholder="e.g. mistralai/Mistral-7B-Instruct-v0.2"
                    value={hfSelectedModel} onChange={e => setHFModel(e.target.value)} />
                  <button className="llm-btn" onClick={fetchHFModels} disabled={!hfApiKey}>
                    <RefreshCw size={11} /> Fetch
                  </button>
                </div>
              </div>
              {hfModels.length > 0 && (
                <div className="llm-field-row">
                  <span className="llm-field-label">Available</span>
                  <select className="llm-select" value={hfSelectedModel} onChange={e => setHFModel(e.target.value)}>
                    <option value="">— Select model —</option>
                    {hfModels.map(m => <option key={m} value={m}>{m}</option>)}
                  </select>
                </div>
              )}
              <div className="llm-field-row">
                <span className="llm-field-label">Base URL</span>
                <input type="text" className="llm-input" placeholder="https://api-inference.huggingface.co"
                  value={hfBaseUrl} onChange={e => setHFBaseUrl(e.target.value)} />
              </div>
              <div className="llm-btn-row">
                <button
                  className={`llm-btn ${selectedProvider === "huggingface" ? "llm-btn-active" : "llm-btn-primary"}`}
                  onClick={() => setProvider("huggingface")}
                  disabled={!hfApiKey || !hfSelectedModel}
                >
                  {selectedProvider === "huggingface" ? "✓ Active" : "Use HuggingFace API"}
                </button>
              </div>
            </Section>

            {/* ── Cloud API Keys ── */}
            <Section title="Cloud API Keys" icon={<Cloud size={14} />}
              badge={apiKeys.length > 0 ? <span className="llm-count-badge">{apiKeys.length}</span> : undefined}>
              {apiKeys.length > 0 && (
                <div className="llm-key-list">
                  {apiKeys.map((k, i) => (
                    <ApiKeyRow key={i} entry={k} index={i}
                      active={selectedApiKeyIndices.includes(i)}
                      onToggle={() => toggleAPIKey(i)}
                      onRemove={() => removeAPIKey(i)}
                      onFetch={() => {
                        if (k.provider === "openai") fetchOpenAIModels(i);
                        else if (k.provider === "anthropic") fetchAnthropicModels(i);
                        else if (k.provider === "groq") fetchGroqModels(i);
                      }}
                      loading={!!apiProviderLoading[k.provider]}
                      error={apiProviderErrors[k.provider]}
                      models={apiProviderModels[k.provider]}
                    />
                  ))}
                </div>
              )}
              <AddApiKeyForm onAdd={entry => { addAPIKey(entry); }} />
            </Section>

            {/* ── Local HF Models ── */}
            <Section title="Local HF Models" icon={<Download size={14} />}
              badge={localModels.length > 0 ? <span className="llm-count-badge">{localModels.length}</span> : undefined}
              defaultOpen={false}>
              <div className="llm-field-row">
                <span className="llm-field-label">HF Token <span className="llm-optional">(read scope, for gated models)</span></span>
                <div className="llm-field-value-row">
                  <input type={localTokenVisible ? "text" : "password"} className="llm-input"
                    placeholder="hf_..." value={hfLocalToken} onChange={e => setHFLocalToken(e.target.value)} />
                  <button className="llm-icon-btn" onClick={() => setLocalTokenVisible(v => !v)}>
                    {localTokenVisible ? <EyeOff size={11} /> : <Eye size={11} />}
                  </button>
                </div>
              </div>

              {/* Search */}
              <div className="llm-field-row">
                <span className="llm-field-label">Search HuggingFace Hub</span>
                <input type="text" className="llm-input" placeholder="e.g. mistral, phi, llama..."
                  value={hfSearchQuery}
                  onChange={e => {
                    const q = e.target.value;
                    setHfSearchQuery(q);
                    if (hfSearchDebounce) clearTimeout(hfSearchDebounce);
                    const t = setTimeout(() => searchHFModels(q, hfSearchTask, hfSearchMaxSize ? parseFloat(hfSearchMaxSize) : undefined), 400);
                    setHfSearchDebounce(t);
                  }}
                />
              </div>
              <div className="llm-field-value-row" style={{ gap: 6 }}>
                <select className="llm-select" value={hfSearchTask}
                  onChange={e => { setHfSearchTask(e.target.value); searchHFModels(hfSearchQuery, e.target.value, hfSearchMaxSize ? parseFloat(hfSearchMaxSize) : undefined); }}>
                  <option value="text-generation">text-generation</option>
                  <option value="text2text-generation">text2text-generation</option>
                  <option value="fill-mask">fill-mask</option>
                  <option value="question-answering">question-answering</option>
                  <option value="summarization">summarization</option>
                  <option value="translation">translation</option>
                </select>
                <input type="number" className="llm-input" placeholder="Max GB" min={0} step={0.5}
                  value={hfSearchMaxSize} onChange={e => setHfSearchMaxSize(e.target.value)} style={{ width: 80 }} />
              </div>

              {hfSearchError && <div className="llm-error-text">{hfSearchError}</div>}
              {hfSearchLoading && <div className="llm-hint" style={{ display: "flex", alignItems: "center", gap: 6 }}><RefreshCw size={11} className="spin-icon" /> Searching…</div>}

              {/* Search results */}
              {!hfSearchLoading && hfSearchResults.length > 0 && (
                <div className="llm-search-results">
                  <span className="llm-field-label">Results ({hfSearchResults.length})</span>
                  {hfSearchResults.map(card => {
                    const inQueue = downloadQueue.some(e => e.modelId === card.modelId && (e.status === "queued" || e.status === "downloading"));
                    const downloaded = localModels.some(m => m.modelId === card.modelId);
                    const gatedNoToken = card.gated && !hfLocalToken;
                    const queueEntry = downloadQueue.find(e => e.modelId === card.modelId);
                    const pct = queueEntry && queueEntry.bytesTotal > 0 ? Math.round((queueEntry.bytesDone / queueEntry.bytesTotal) * 100) : 0;
                    return (
                      <div key={card.modelId} className="llm-search-card">
                        <div className="llm-search-card-top">
                          <div className="llm-local-model-info">
                            <span className="llm-local-model-id">{card.modelId}</span>
                            <span className="llm-local-model-meta">
                              ↓{card.downloads.toLocaleString()}
                              {card.sizeBytes > 0 && ` · ${(card.sizeBytes / 1e9).toFixed(1)} GB`}
                              {card.license && ` · ${card.license}`}
                              {card.gated && <span className="llm-quant-badge" style={{ background: "rgba(244,71,71,0.12)", color: "#f44747", borderColor: "rgba(244,71,71,0.3)" }}>🔒 gated</span>}
                            </span>
                          </div>
                          <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
                            {downloaded ? (
                              <span className="llm-pill llm-pill-ok" style={{ fontSize: 10 }}>✓ Downloaded</span>
                            ) : inQueue ? (
                              <button className="llm-btn" onClick={() => cancelDownload(card.modelId)} style={{ fontSize: 10 }}>
                                <RefreshCw size={10} className="spin-icon" /> Cancel
                              </button>
                            ) : (
                              <button className="llm-btn llm-btn-primary" disabled={gatedNoToken}
                                title={gatedNoToken ? "Add an HF token above to download gated models" : "Download"}
                                onClick={() => downloadModel(card.modelId)} style={{ fontSize: 10 }}>
                                <Download size={10} /> Download
                              </button>
                            )}
                          </div>
                        </div>
                        {gatedNoToken && <div className="llm-error-text" style={{ fontSize: 10 }}>Requires a HuggingFace token. Add one above.</div>}
                        {inQueue && queueEntry && (
                          <div style={{ marginTop: 4 }}>
                            <div className="llm-progress-bar"><div className="llm-progress-fill" style={{ width: `${pct}%` }} /></div>
                            <div className="llm-hint" style={{ marginTop: 2 }}>{queueEntry.status === "queued" ? "Queued…" : `${pct}% · ${(queueEntry.speedBps / 1e6).toFixed(1)} MB/s`}</div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Active downloads */}
              {downloadQueue.filter(e => e.status === "downloading" || e.status === "queued").length > 0 && (
                <div className="llm-field-row">
                  <span className="llm-field-label">Active Downloads</span>
                  {downloadQueue.filter(e => e.status === "downloading" || e.status === "queued").map(entry => {
                    const pct = entry.bytesTotal > 0 ? Math.round((entry.bytesDone / entry.bytesTotal) * 100) : 0;
                    return (
                      <div key={entry.modelId} className="llm-search-card">
                        <div className="llm-search-card-top">
                          <span className="llm-local-model-id" style={{ fontSize: 11 }}>{entry.modelId}</span>
                          <button className="llm-icon-btn danger" onClick={() => cancelDownload(entry.modelId)} title="Cancel"><Trash2 size={11} /></button>
                        </div>
                        <div className="llm-progress-bar"><div className="llm-progress-fill" style={{ width: `${pct}%` }} /></div>
                        <div className="llm-hint">{pct}% · {(entry.speedBps / 1e6).toFixed(1)} MB/s</div>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Downloaded models */}
              {localModels.length === 0 && hfSearchResults.length === 0 ? (
                <div className="llm-empty-state">
                  <Download size={20} />
                  <p>No local models downloaded yet.</p>
                  <p className="llm-hint">Search above to find and download models from HuggingFace Hub.</p>
                </div>
              ) : localModels.length > 0 && (
                <div className="llm-field-row">
                  <span className="llm-field-label">Downloaded Models ({localModels.length})</span>
                  <div className="llm-local-model-list">
                    {localModels.map(m => (
                      <div key={m.modelId} className={`llm-local-model-row ${selectedLocalModel === m.modelId ? "active" : ""}`}>
                        <div className="llm-local-model-info">
                          <span className="llm-local-model-id">{m.modelId}</span>
                          <span className="llm-local-model-meta">
                            {m.sizeBytes > 0 ? `${(m.sizeBytes / 1e9).toFixed(1)} GB` : "size unknown"}
                            {" · "}{new Date(m.downloadedAt).toLocaleDateString()}
                            {m.quantizedPath && <span className="llm-quant-badge">⚡ {m.quantizedMethod} {m.quantizedBits}bit</span>}
                          </span>
                        </div>
                        <div className="llm-local-model-actions">
                          <button className={`llm-btn ${selectedLocalModel === m.modelId ? "llm-btn-active" : "llm-btn-primary"}`}
                            onClick={() => { setSelectedLocalModel(m.modelId); setProvider("local" as any); }} style={{ fontSize: 10 }}>
                            {selectedLocalModel === m.modelId ? "✓ Active" : "Use"}
                          </button>
                          {m.quantizedPath && (
                            <button className="llm-btn llm-btn-primary"
                              onClick={() => { setSelectedLocalModel(m.modelId); setProvider("local" as any); }}
                              title="Use quantized version" style={{ fontSize: 10 }}>⚡ Use (Q)</button>
                          )}
                          <button className="llm-btn"
                            onClick={() => { setTqModelId(m.modelId); setTqMethod("GGUF"); setTqBits(4); }}
                            title="Quantize with TurboQuant" style={{ fontSize: 10 }}>⚡ Quantize</button>
                          <button className="llm-icon-btn danger" onClick={() => { if (window.confirm(`Delete ${m.modelId}?`)) deleteLocalModel(m.modelId); }} title="Delete">
                            <Trash2 size={11} />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </Section>

            {/* ── TurboQuant ── */}
            <Section title="TurboQuant — Model Quantization" icon={<Zap size={14} />}
              badge={quantizedModels.length > 0 ? <span className="llm-count-badge">{quantizedModels.length}</span> : undefined}
              defaultOpen={false}>
              <div className="llm-hint" style={{ marginBottom: 4 }}>
                Quantize a HuggingFace model to GGUF/GPTQ/AWQ to reduce RAM usage. Requires the Python gRPC service.
              </div>
              <div className="llm-field-row">
                <span className="llm-field-label">Model ID</span>
                <input type="text" className="llm-input" placeholder="e.g. mistralai/Mistral-7B-v0.1"
                  value={tqModelId} onChange={e => setTqModelId(e.target.value)} />
              </div>
              <div className="llm-field-value-row" style={{ gap: 6 }}>
                <div style={{ flex: 1 }}>
                  <div className="llm-field-label" style={{ marginBottom: 4 }}>Method</div>
                  <select className="llm-select" value={tqMethod} onChange={e => setTqMethod(e.target.value as any)}>
                    <option value="GGUF">GGUF (CPU-friendly)</option>
                    <option value="GPTQ">GPTQ (GPU)</option>
                    <option value="AWQ">AWQ (GPU, best quality)</option>
                  </select>
                </div>
                <div style={{ width: 100 }}>
                  <div className="llm-field-label" style={{ marginBottom: 4 }}>Bits</div>
                  <select className="llm-select" value={tqBits} onChange={e => setTqBits(Number(e.target.value) as 4 | 8)}>
                    <option value={4}>4-bit</option>
                    <option value={8}>8-bit</option>
                  </select>
                </div>
              </div>
              {(turboQuantStatus === "downloading" || turboQuantStatus === "quantizing") && (
                <div className="llm-tq-progress">
                  <div className="llm-field-label">{turboQuantStage}</div>
                  <div className="llm-progress-bar"><div className="llm-progress-fill" style={{ width: `${turboQuantProgress}%` }} /></div>
                  <div className="llm-hint">{turboQuantProgress}%</div>
                  <button className="llm-btn" onClick={cancelTurboQuant}>Cancel</button>
                </div>
              )}
              {turboQuantStatus === "done" && <div className="llm-pill llm-pill-ok" style={{ alignSelf: "flex-start" }}>✓ Quantization complete</div>}
              {turboQuantStatus === "error" && turboQuantError && (
                <div className="llm-error-banner"><AlertTriangle size={11} /> {turboQuantError}</div>
              )}
              <div className="llm-btn-row">
                <button className="llm-btn llm-btn-primary"
                  disabled={!tqModelId.trim() || turboQuantStatus === "downloading" || turboQuantStatus === "quantizing"}
                  onClick={() => startTurboQuant(tqModelId.trim(), tqMethod, tqBits)}>
                  <Zap size={11} /> Start Quantization
                </button>
                <button className="llm-btn" onClick={listQuantizedModels}><RefreshCw size={11} /> Refresh</button>
              </div>
              {quantizedModels.length > 0 && (
                <div className="llm-field-row" style={{ marginTop: 8 }}>
                  <span className="llm-field-label">Quantized Models</span>
                  <div className="llm-local-model-list">
                    {quantizedModels.map((qm, i) => (
                      <div key={i} className="llm-local-model-row">
                        <div className="llm-local-model-info">
                          <span className="llm-local-model-id">{qm.modelId}</span>
                          <span className="llm-local-model-meta">
                            {qm.method} · {qm.bits}-bit · {qm.sizeMb} MB
                            {qm.ollamaName && <span className="llm-quant-badge">ollama: {qm.ollamaName}</span>}
                          </span>
                        </div>
                        <div className="llm-local-model-actions">
                          <button className="llm-btn llm-btn-primary"
                            onClick={() => { setSelectedLocalModel(qm.modelId); setProvider("local" as any); }} style={{ fontSize: 10 }}>Use</button>
                          <button className="llm-icon-btn danger" onClick={() => deleteQuantizedModel(qm.modelId, qm.method, qm.bits)} title="Delete">
                            <Trash2 size={11} />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </Section>

          </div>
        )}
      </div>
    </div>
  );
}
