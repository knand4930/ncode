// src/components/settings/SettingsPanel.tsx
import { useEffect, useState } from "react";
import { useUIStore } from "../../store/uiStore";
import { useAIStore } from "../../store/aiStore";
import { Settings, Moon, Sun, Type } from "lucide-react";

export function SettingsPanel() {
  const {
    theme,
    setTheme,
    colorTheme,
    setColorTheme,
    iconTheme,
    setIconTheme,
    fontSize,
    setFontSize,
    tabSize,
    setTabSize,
    wordWrap,
    setWordWrap,
    formatOnSave,
    setFormatOnSave,
    autoSave,
    setAutoSave,
    minimapEnabled,
    setMinimapEnabled,
  } = useUIStore();
  const [selectedTab, setSelectedTab] = useState("editor");

  // ai settings state
  const {
    isOllamaRunning,
    availableModels,
    checkOllama,
    startOllama,
    apiKeys,
    addAPIKey,
    removeAPIKey,
    selectedProvider,
    aiServiceMode,
    selectedApiKeyIndices,
    toggleAPIKey,
    setProvider,
    setAIServiceMode,
    checkGrpcService,
    startGrpcService,
    ollamaBaseUrl,
    setOllamaBaseUrl,
    ollamaModelsLoading,
    ollamaModelsError,
    selectedOllamaModels,
    toggleOllamaModel,
    fetchOllamaModels,
    fetchOpenAIModels,
    fetchAnthropicModels,
    fetchGroqModels,
    apiProviderLoading,
    apiProviderErrors,
    apiProviderModels,
    isGrpcHealthy,
    grpcStatusError,
    grpcStarting,
  } = useAIStore();

  const [newApi, setNewApi] = useState({ provider: "", model: "", apiKey: "" });

  // trigger status check when ai tab is shown
  useEffect(() => {
    if (selectedTab === "ai") {
      if (aiServiceMode === "grpc") {
        checkGrpcService();
      }
      checkOllama();
    }
  }, [selectedTab, aiServiceMode, checkOllama, checkGrpcService]);

  return (
    <div className="settings-panel">
      <div className="settings-header">
        <Settings size={16} />
        <span>Settings</span>
      </div>

      <div className="settings-tabs">
        <button
          className={`settings-tab ${selectedTab === "editor" ? "active" : ""}`}
          onClick={() => setSelectedTab("editor")}
        >
          Editor
        </button>
        <button
          className={`settings-tab ${selectedTab === "theme" ? "active" : ""}`}
          onClick={() => setSelectedTab("theme")}
        >
          Theme
        </button>
        <button
          className={`settings-tab ${selectedTab === "ai" ? "active" : ""}`}
          onClick={() => setSelectedTab("ai")}
        >
          AI / LLM
        </button>
      </div>

      <div className="settings-content">
        {selectedTab === "editor" && (
          <div className="settings-section">
            <h3>Editor Settings</h3>

            <div className="setting-item">
              <label htmlFor="font-size">Font Size</label>
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <Type size={14} />
                <input
                  id="font-size"
                  type="range"
                  min="10"
                  max="24"
                  value={fontSize}
                  onChange={(e) => setFontSize(Number(e.target.value))}
                  style={{ flex: 1 }}
                />
                <span className="setting-value">{fontSize}px</span>
              </div>
            </div>

            <div className="setting-item">
              <label>Tab Size</label>
              <select
                value={tabSize}
                onChange={(e) => setTabSize(Number(e.target.value))}
                className="setting-select"
              >
                <option value="2">2 spaces</option>
                <option value="4">4 spaces</option>
                <option value="8">8 spaces</option>
              </select>
            </div>

            <div className="setting-item">
              <label>
                <input
                  type="checkbox"
                  checked={wordWrap}
                  onChange={(e) => setWordWrap(e.target.checked)}
                />{" "}
                Word Wrap
              </label>
            </div>

            <div className="setting-item">
              <label>
                <input
                  type="checkbox"
                  checked={minimapEnabled}
                  onChange={(e) => setMinimapEnabled(e.target.checked)}
                />{" "}
                Minimap
              </label>
            </div>

            <div className="setting-item">
              <label>
                <input
                  type="checkbox"
                  checked={formatOnSave}
                  onChange={(e) => setFormatOnSave(e.target.checked)}
                />{" "}
                Format on Save
              </label>
            </div>

            <div className="setting-item">
              <label>
                <input
                  type="checkbox"
                  checked={autoSave}
                  onChange={(e) => setAutoSave(e.target.checked)}
                />{" "}
                Auto Save
              </label>
            </div>
          </div>
        )}

        {selectedTab === "theme" && (
          <div className="settings-section">
            <h3>Appearance</h3>

            <div className="setting-item">
              <label>Theme</label>
              <div style={{ display: "flex", gap: "8px" }}>
                <button
                  className={`theme-btn ${theme === "dark" ? "active" : ""}`}
                  onClick={() => setTheme("dark")}
                >
                  <Moon size={14} /> Dark
                </button>
                <button
                  className={`theme-btn ${theme === "light" ? "active" : ""}`}
                  onClick={() => setTheme("light")}
                >
                  <Sun size={14} /> Light
                </button>
              </div>
            </div>

            <div className="setting-item">
              <label>Color Theme</label>
              <select 
                value={colorTheme} 
                onChange={(e) => setColorTheme(e.target.value as any)} 
                className="setting-select"
              >
                <option value="dark">One Dark Pro</option>
                <option value="github">GitHub</option>
                <option value="dracula">Dracula</option>
              </select>
            </div>

            <div className="setting-item">
              <label>Icon Theme</label>
              <select 
                value={iconTheme} 
                onChange={(e) => setIconTheme(e.target.value as any)} 
                className="setting-select"
              >
                <option value="default">Default</option>
                <option value="noto">Noto Icons</option>
                <option value="simple">Simple Icons</option>
              </select>
            </div>
          </div>
        )}
        {selectedTab === "ai" && (
          <div className="settings-section">
            <h3>AI / LLM Configuration</h3>

            {/* Provider Selector */}
            <div className="setting-item">
              <label>Service Route</label>
              <select
                value={aiServiceMode}
                onChange={(e) => {
                  const mode = e.target.value as "direct" | "grpc";
                  setAIServiceMode(mode);
                  if (mode === "grpc") {
                    startGrpcService();
                  } else {
                    checkGrpcService();
                  }
                  checkOllama();
                }}
                className="setting-select"
                style={{ marginBottom: 12, width: "100%" }}
              >
                <option value="direct">Direct (Rust → provider)</option>
                <option value="grpc">gRPC (Rust → Python service)</option>
              </select>
              {aiServiceMode === "grpc" && (
                <>
                  <div style={{ fontSize: 12, marginBottom: 8, color: isGrpcHealthy ? "#4ec9b0" : "#ce9178" }}>
                    gRPC Service: {isGrpcHealthy ? "✓ Healthy" : "✗ Unreachable"}
                    {grpcStatusError ? ` (${grpcStatusError})` : ""}
                  </div>
                  {!isGrpcHealthy && (
                    <button
                      className="btn-primary btn-sm"
                      onClick={startGrpcService}
                      disabled={grpcStarting}
                      style={{ marginBottom: 8 }}
                    >
                      {grpcStarting ? "Starting gRPC..." : "Start gRPC Service"}
                    </button>
                  )}
                </>
              )}
            </div>

            <hr style={{ margin: "16px 0", borderColor: "var(--border)" }} />
            <h4>Local Models (Ollama)</h4>

            <div className="setting-item" style={{ marginTop: 8 }}>
              <label>Ollama Base URL</label>
              <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
                <input
                  type="text"
                  value={ollamaBaseUrl || "http://localhost:11434"}
                  onChange={(e) => setOllamaBaseUrl(e.target.value)}
                  placeholder="http://localhost:11434"
                  style={{ flex: 1 }}
                />
                <button
                  className="btn-primary btn-sm"
                  onClick={async () => {
                    await fetchOllamaModels();
                  }}
                  disabled={ollamaModelsLoading}
                >
                  {ollamaModelsLoading ? "Fetching..." : "Fetch"}
                </button>
              </div>
            </div>

            <div className="setting-item">
              <label>Status</label>
              <div style={{ fontSize: 12, marginBottom: 8, color: isOllamaRunning ? "#4ec9b0" : "#ce9178" }}>
                {isOllamaRunning ? "✓ Running" : "✗ Not running"}
              </div>
              {!isOllamaRunning && (
                <button className="btn-primary btn-sm" onClick={startOllama}>
                  Start Ollama
                </button>
              )}
            </div>

            {/* Ollama Model Selector */}
            {availableModels.length > 0 && (
              <div className="setting-item">
                <label>Available Models ({availableModels.length})</label>
                <div style={{ display: "flex", flexDirection: "column", gap: 4, maxHeight: "150px", overflowY: "auto", background: "var(--bg)", padding: 8, borderRadius: 4, border: "1px solid var(--border)" }}>
                  {availableModels.map((m) => (
                    <label key={m} style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: 12 }}>
                      <input
                        type="checkbox"
                        checked={selectedOllamaModels.includes(m)}
                        onChange={() => toggleOllamaModel(m)}
                      />
                      {m}
                    </label>
                  ))}
                </div>
              </div>
            )}

            {ollamaModelsLoading && (
              <div style={{ color: "var(--text-muted)", fontSize: 12 }}>Fetching models...</div>
            )}
            {ollamaModelsError && (
              <div style={{ color: "#ce9178", fontSize: 12, padding: "8px", backgroundColor: "rgba(206, 145, 120, 0.1)", borderRadius: "4px", marginBottom: "8px" }}>
                Error: {ollamaModelsError}
              </div>
            )}

            <hr style={{ margin: "16px 0", borderColor: "var(--border)" }} />
            <h4>Cloud Models (API)</h4>

            <div className="setting-item" style={{ marginTop: 8 }}>
              <label>Add New API Key</label>
              <select
                value={newApi.provider}
                onChange={(e) => setNewApi({ ...newApi, provider: e.target.value })}
                className="setting-select"
                style={{ marginBottom: 8, width: "100%" }}
              >
                <option value="">-- Select Provider --</option>
                <option value="openai">OpenAI</option>
                <option value="anthropic">Anthropic</option>
                <option value="groq">Groq</option>
                <option value="airllm">AirLLM (local split-model)</option>
                <option value="vllm">vLLM (high-throughput)</option>
              </select>

              <input
                type="password"
                placeholder="API Key"
                value={newApi.apiKey}
                onChange={(e) => setNewApi({ ...newApi, apiKey: e.target.value })}
                style={{ marginBottom: 8, width: "100%" }}
              />
              <input
                placeholder="Model (e.g., gpt-4o)"
                value={newApi.model}
                onChange={(e) => setNewApi({ ...newApi, model: e.target.value })}
                style={{ marginBottom: 8, width: "100%" }}
              />
              <button
                className="btn-primary btn-sm"
                onClick={() => {
                  if (newApi.provider && newApi.apiKey && newApi.model) {
                    addAPIKey({ ...newApi });
                    setNewApi({ provider: "", model: "", apiKey: "" });
                  }
                }}
                style={{ width: "100%" }}
              >
                Add Key
              </button>
            </div>

            {/* Saved API Keys */}
            {apiKeys.length > 0 && (
              <div className="setting-item">
                <label>Saved API Keys (Check to activate)</label>
                {apiKeys.map((k, i) => (
                  <div key={i} style={{ marginBottom: 8 }}>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        padding: 8,
                        background: selectedApiKeyIndices.includes(i) ? "rgba(78, 201, 176, 0.1)" : "var(--bg-input)",
                        borderRadius: 4,
                        cursor: "pointer",
                        border: selectedApiKeyIndices.includes(i) ? "1px solid var(--accent)" : "1px solid transparent",
                      }}
                      onClick={() => toggleAPIKey(i)}
                    >
                      <input
                        type="checkbox"
                        checked={selectedApiKeyIndices.includes(i)}
                        readOnly
                        style={{ cursor: "pointer" }}
                      />
                      <span style={{ flex: 1, fontSize: 12 }}>
                        <strong>{k.provider.toUpperCase()}</strong> • {k.model}
                      </span>
                      <button
                        className="btn-sm"
                        onClick={async (e) => {
                          e.stopPropagation();
                          if (k.provider === "openai") {
                            await fetchOpenAIModels(i);
                          } else if (k.provider === "anthropic") {
                            await fetchAnthropicModels(i);
                          } else if (k.provider === "groq") {
                            await fetchGroqModels(i);
                          }
                        }}
                        disabled={apiProviderLoading[k.provider]}
                      >
                        {apiProviderLoading[k.provider] ? "Fetching..." : "Fetch"}
                      </button>
                      <button
                        className="btn-sm danger"
                        onClick={(e) => {
                          e.stopPropagation();
                          removeAPIKey(i);
                        }}
                      >
                        Remove
                      </button>
                    </div>
                    {apiProviderErrors[k.provider] && (
                      <div style={{ fontSize: 11, color: "#ce9178", padding: "4px 8px", marginTop: "4px" }}>
                        Error: {apiProviderErrors[k.provider]}
                      </div>
                    )}
                    {apiProviderModels[k.provider] && apiProviderModels[k.provider].length > 0 && (
                      <div style={{ fontSize: 10, color: "var(--text-secondary)", padding: "4px 8px", marginTop: "4px" }}>
                        Available: {apiProviderModels[k.provider].slice(0, 3).join(", ")}
                        {apiProviderModels[k.provider].length > 3 && ` +${apiProviderModels[k.provider].length - 3} more`}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            <hr style={{ margin: "16px 0", borderColor: "var(--border)" }} />
            <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
              <p><strong>Service Route:</strong> {aiServiceMode === "grpc" ? "gRPC Python Service" : "Direct Rust Calls"}</p>
              <p><strong>Active Models:</strong> {selectedOllamaModels.length + selectedApiKeyIndices.length} total</p>
              {selectedOllamaModels.length > 0 && (
                <p>• Ollama: {selectedOllamaModels.join(", ")}</p>
              )}
              {selectedApiKeyIndices.length > 0 && (
                <p>• API: {selectedApiKeyIndices.map(i => apiKeys[i]?.model).join(", ")}</p>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
