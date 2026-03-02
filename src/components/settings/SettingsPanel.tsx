// src/components/settings/SettingsPanel.tsx
import { useEffect, useState } from "react";
import { useUIStore } from "../../store/uiStore";
import { useAIStore } from "../../store/aiStore";
import { Settings, Moon, Sun, Type } from "lucide-react";

export function SettingsPanel() {
  const {
    theme,
    setTheme,
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
    selectedApiKeyIndex,
    selectAPIKey,
  } = useAIStore();

  const [newApi, setNewApi] = useState({ provider: "", model: "", apiKey: "" });

  // trigger status check when ai tab is shown
  useEffect(() => {
    if (selectedTab === "ai") {
      checkOllama();
    }
  }, [selectedTab, checkOllama]);

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
              <select defaultValue="dark" className="setting-select">
                <option value="dark">One Dark Pro</option>
                <option value="github">GitHub</option>
                <option value="dracula">Dracula</option>
              </select>
            </div>

            <div className="setting-item">
              <label>Icon Theme</label>
              <select defaultValue="default" className="setting-select">
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
            <div className="setting-item">
              <label>Ollama Status</label>
              <span>{isOllamaRunning ? "Running" : "Not running"}</span>
              <button className="btn-sm" onClick={checkOllama}>
                Refresh
              </button>
              {!isOllamaRunning && (
                <button
                  className="btn-sm"
                  onClick={async () => {
                    await startOllama();
                  }}
                >
                  Start Ollama
                </button>
              )}
            </div>
            <div className="setting-item">
              <label>Installed Ollama Models</label>
              <div style={{ maxHeight: 120, overflowY: "auto" }}>
                {availableModels.length === 0 && <em>none</em>}
                {availableModels.map((m) => (
                  <div key={m} style={{ fontSize: 12 }}>{m}</div>
                ))}
              </div>
            </div>
            <hr />
            <div className="setting-item">
              <label>Add API Key</label>
              <input
                placeholder="Provider (e.g. openai)"
                value={newApi.provider}
                onChange={(e) => setNewApi({ ...newApi, provider: e.target.value })}
                style={{ marginBottom: 4, width: "100%" }}
              />
              <input
                placeholder="Model (e.g. gpt-3.5-turbo)"
                value={newApi.model}
                onChange={(e) => setNewApi({ ...newApi, model: e.target.value })}
                style={{ marginBottom: 4, width: "100%" }}
              />
              <input
                type="password"
                placeholder="API Key"
                value={newApi.apiKey}
                onChange={(e) => setNewApi({ ...newApi, apiKey: e.target.value })}
                style={{ marginBottom: 4, width: "100%" }}
              />
              <button
                className="btn-primary btn-sm"
                onClick={() => {
                  if (newApi.provider && newApi.model && newApi.apiKey) {
                    addAPIKey({ ...newApi });
                    setNewApi({ provider: "", model: "", apiKey: "" });
                  }
                }}
              >
                Add Key
              </button>
            </div>
            <div className="setting-item">
              <label>Saved Keys</label>
              {apiKeys.length === 0 && <em>none</em>}
              {apiKeys.map((k, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: 12 }}>{k.provider}: {k.model}</span>
                  <button className="btn-sm" onClick={() => removeAPIKey(i)}>
                    Remove
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
