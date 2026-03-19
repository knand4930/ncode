// src/store/aiStore.ts
import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { type ProjectContext } from "../utils/projectScanner";
import { formatErrorsForAI } from "../utils/errorParser";
import { parseThinkingBlock } from "../utils/parseThinkingBlock";
import { parseBugReport } from "../utils/parseBugReport";
import { useTerminalStore } from "./terminalStore";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  thinkingContent?: string;
  bugReport?: BugReport;
  sources?: Array<{ filePath: string; startLine: number; endLine: number }>;
  timestamp: number;
  model?: string;
  provider?: "ollama" | "openai" | "anthropic" | "groq" | "airllm" | "vllm";
  isStreaming?: boolean;
  tokens?: number;
  isError?: boolean;        // marks error/timeout messages
  isIncomplete?: boolean;   // stream was cut off
  retryContent?: string;    // original user message to re-send on retry
}

export interface BugReport {
  bugs: BugEntry[];
  summary: { critical: number; high: number; medium: number; low: number };
}

export interface BugEntry {
  filePath: string;
  line: number;
  severity: 'critical' | 'high' | 'medium' | 'low';
  description: string;
  fix: string;
}

export interface AgentFileChange {
  path: string;
  originalContent?: string;
  action: string;
}

export interface MentionedFile {
  path: string;
  content: string;
  truncated: boolean;
}

const MENTION_FILE_LIMIT = 5;
const MENTION_CHAR_LIMIT = 6000;

export type AIMode = "chat" | "think" | "agent" | "bug_hunt" | "architect";
export type AIServiceMode = "direct" | "grpc";

export type AgentEvent = {
  kind: "stage" | "token" | "done" | "error";
  message: string;
  ts: number;
};

export type AIModel = {
  name: string;
  label: string;
  ramGB: number;
  description: string;
};

export const RECOMMENDED_MODELS: AIModel[] = [
  { name: "deepseek-coder", label: "DeepSeek Coder", ramGB: 4, description: "Balanced, 4GB RAM" },
  { name: "codellama", label: "CodeLlama", ramGB: 4, description: "Best quality, 4GB RAM" },
  { name: "qwen2.5-coder", label: "Qwen2.5 Coder", ramGB: 4, description: "Lightweight, 4GB RAM" },
  { name: "mistral", label: "Mistral", ramGB: 4, description: "General purpose, 4GB RAM" },
  { name: "starcoder2", label: "StarCoder2", ramGB: 2, description: "Good for completions, 2GB RAM" },
];

/**
 * Validate selectedOllamaModels against the actual available models list.
 * Removes any stale/non-existent model names from the selection.
 */
function validateSelectedModels(selected: string[], available: string[]): string[] {
  if (available.length === 0) return selected; // can't validate yet, keep as-is
  return selected.filter((m) => available.includes(m));
}

// describes an external LLM provider configuration saved by user
export interface ApiKeyEntry {
  provider: string;   // e.g. "openai"
  apiKey: string;
  model: string;      // model identifier the key should be used with
  label?: string;
}

type PersistedAISettings = {
  selectedProvider: "ollama" | "api";
  aiServiceMode: AIServiceMode;
  ollamaBaseUrl?: string;
  selectedOllamaModels: string[];
  selectedApiKeyIndices?: number[];
  useRAG: boolean;
  aiMode: AIMode;
  showThinking: boolean;
};

const AI_SETTINGS_KEY = "NCode.ai.settings.v1";
const AI_CHAT_HISTORY_KEY = "NCode.ai.chatHistory.v1";
const AI_SESSIONS_KEY = "NCode.ai.sessions.v1";

// ── Chat session types ────────────────────────────────────────
export interface ChatSession {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: ChatMessage[];
}

function loadSessions(): ChatSession[] {
  try {
    if (typeof window === "undefined") return [];
    const raw = window.localStorage.getItem(AI_SESSIONS_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as ChatSession[];
  } catch { return []; }
}

function saveSessions(sessions: ChatSession[]) {
  try {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(AI_SESSIONS_KEY, JSON.stringify(sessions));
  } catch { /* ignore */ }
}

function sessionTitle(messages: ChatMessage[]): string {
  const first = messages.find(m => m.role === "user");
  if (!first) return "New Chat";
  return first.content.slice(0, 40) + (first.content.length > 40 ? "…" : "");
}

function loadAISettings(): PersistedAISettings | null {
  try {
    if (typeof window === "undefined") return null;
    const raw = window.localStorage.getItem(AI_SETTINGS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PersistedAISettings;
    if (!parsed || (parsed.selectedProvider !== "ollama" && parsed.selectedProvider !== "api")) {
      return null;
    }
    if (parsed.aiServiceMode !== "direct" && parsed.aiServiceMode !== "grpc") {
      parsed.aiServiceMode = "direct";
    }
    // Migration: remove known stale model names from old hardcoded list
    // These will be re-validated against actual available models on first checkOllama()
    const knownStaleModels = [
      "deepseek-coder:1.3b",
      "codellama:7b-code-q4_0",
      "qwen2.5-coder:1.5b",
      "starcoder2:3b",
    ];
    if (parsed.selectedOllamaModels) {
      const cleaned = parsed.selectedOllamaModels.filter((m) => !knownStaleModels.includes(m));
      if (cleaned.length !== parsed.selectedOllamaModels.length) {
        parsed.selectedOllamaModels = cleaned;
        // Persist the cleaned version immediately
        try {
          window.localStorage.setItem(AI_SETTINGS_KEY, JSON.stringify(parsed));
        } catch { /* ignore */ }
      }
    }
    return parsed;
  } catch {
    return null;
  }
}

function saveAISettings(settings: PersistedAISettings) {
  try {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(AI_SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // ignore persistence failures
  }
}

function deduplicateMessages(messages: ChatMessage[]): ChatMessage[] {
  const seen = new Set<string>();
  const out: ChatMessage[] = [];
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    const key = m.role + ":" + m.content;
    if (!seen.has(key)) {
      seen.add(key);
      out.unshift(m);
    }
  }
  return out;
}

function loadChatHistory(): ChatMessage[] {
  try {
    if (typeof window === "undefined") return [];
    const raw = window.localStorage.getItem(AI_CHAT_HISTORY_KEY);
    if (!raw) return [];
    const messages = JSON.parse(raw) as ChatMessage[];
    return Array.isArray(messages) ? deduplicateMessages(messages) : [];
  } catch (e) {
    console.error("Failed to load chat history:", e);
    return [];
  }
}

function saveChatHistory(messages: ChatMessage[]) {
  try {
    if (typeof window === "undefined") return;
    const deduped = deduplicateMessages(messages);
    window.localStorage.setItem(AI_CHAT_HISTORY_KEY, JSON.stringify(deduped));
  } catch (e) {
    console.error("Failed to save chat history:", e);
  }
}

// Debounced version to avoid excessive localStorage writes during streaming
let _saveChatHistoryTimer: ReturnType<typeof setTimeout> | null = null;
function debouncedSaveChatHistory(messages: ChatMessage[]) {
  if (_saveChatHistoryTimer) clearTimeout(_saveChatHistoryTimer);
  _saveChatHistoryTimer = setTimeout(() => {
    saveChatHistory(messages);
    _saveChatHistoryTimer = null;
  }, 300);
}

// Structured error logging (Req 12.6)
function logAIError(errorType: string, message: string) {
  const ts = new Date().toISOString();
  console.error(`[AI_Store] ${ts} ${errorType}: ${message}`);
}

const persisted = loadAISettings();

interface AIStore {
  isOllamaRunning: boolean;
  availableModels: string[];
  ollamaBaseUrl: string;
  ollamaModelsLoading: boolean;
  ollamaModelsError: string | null;

  // single active Ollama model selected by user
  selectedOllamaModels: string[];

  apiKeys: ApiKeyEntry[];
  selectedProvider: "ollama" | "api";
  aiServiceMode: AIServiceMode;
  selectedApiKeyIndices: number[];
  apiProviderModels: Record<string, string[]>; // cache of models per provider
  apiProviderLoading: Record<string, boolean>; // loading state per provider
  apiProviderErrors: Record<string, string>; // error messages per provider
  isGrpcHealthy: boolean | null;
  grpcStatusError: string | null;
  grpcStarting: boolean;

  chatHistory: ChatMessage[];
  isThinking: boolean;
  isStreaming: boolean;
  streamingMessageId: string | null;
  isIndexing: boolean;
  indexedChunks: number;
  indexDirty: boolean;
  useRAG: boolean;
  aiMode: AIMode;
  openFolder: string | null;
  agentLiveOutput: string;
  agentEvents: AgentEvent[];
  showThinking: boolean;

  // Multi-session chat
  sessions: ChatSession[];
  activeSessionId: string | null;
  showSessionList: boolean;

  // Abort controller for in-flight requests (Task 1.1)
  abortController: AbortController | null;
  // Reconnect state (Task 1.2 / 12.2)
  reconnectAttempts: number;

  // Agent change history for rollback (Task 3.6)
  aiChangeHistory: AgentFileChange[];

  // @-mention context (Task 7)
  mentionedFiles: MentionedFile[];

  checkOllama: () => Promise<void>;
  startOllama: () => Promise<void>;
  toggleOllamaModel: (model: string) => void;
  addAPIKey: (entry: ApiKeyEntry) => void;
  removeAPIKey: (index: number) => void;
  toggleAPIKey: (index: number) => void;
  setProvider: (provider: "ollama" | "api") => void;
  setAIServiceMode: (mode: AIServiceMode) => void;
  checkGrpcService: () => Promise<void>;
  startGrpcService: () => Promise<void>;
  setOllamaBaseUrl: (url: string) => void;
  fetchOllamaModels: () => Promise<void>;
  fetchOpenAIModels: (index?: number) => Promise<void>;
  fetchAnthropicModels: (index?: number) => Promise<void>;
  fetchGroqModels: (index?: number) => Promise<void>;
  sendMessage: (content: string, activeFileContext?: string) => Promise<void>;
  abortRequest: () => void;
  retryLastMessage: () => Promise<void>;
  recordAgentChanges: (changes: AgentFileChange[]) => void;
  rollbackAgentChanges: () => Promise<void>;
  runAgentTask: (content: string) => Promise<void>;
  // @-mention actions (Task 7)
  addMentionedFile: (path: string) => Promise<{ ok: boolean; reason?: string }>;
  removeMentionedFile: (path: string) => void;
  clearMentionedFiles: () => void;
  clearChat: () => void;
  newChat: () => void;
  switchSession: (id: string) => void;
  deleteSession: (id: string) => void;
  toggleSessionList: () => void;
  addStreamToken: (messageId: string, token: string) => void;
  initStreamingMessage: (messageId: string, model?: string) => void;
  updateMessage: (id: string, content: string, metadata?: Partial<ChatMessage>) => void;
  indexCodebase: (path: string) => Promise<void>;
  toggleRAG: () => void;
  setAIMode: (mode: AIMode) => void;
  setShowThinking: (show: boolean) => void;
  persistSettings: () => void;
  getInlineCompletion: (code: string, language: string) => Promise<string>;
  setOpenFolder: (path: string | null) => void;
  markCodebaseChanged: (filePath?: string) => void;
  projectContext: ProjectContext | null;
  setProjectContext: (ctx: ProjectContext | null) => void;
  _syncSessionMessages: (messages: ChatMessage[]) => void;
}

export const useAIStore = create<AIStore>((set, get) => ({
  isOllamaRunning: false,
  availableModels: [],
  ollamaBaseUrl: persisted?.ollamaBaseUrl || "http://localhost:11434",
  ollamaModelsLoading: false,
  ollamaModelsError: null,
  selectedOllamaModels: persisted?.selectedOllamaModels || [],

  apiKeys: [],
  selectedProvider: persisted?.selectedProvider || "ollama",
  aiServiceMode: persisted?.aiServiceMode || "direct",
  selectedApiKeyIndices: persisted?.selectedApiKeyIndices || (persisted && 'selectedApiKeyIndex' in persisted && (persisted as any).selectedApiKeyIndex != null ? [(persisted as any).selectedApiKeyIndex] : []),
  apiProviderModels: {},
  apiProviderLoading: {},
  apiProviderErrors: {},
  isGrpcHealthy: null,
  grpcStatusError: null,
  grpcStarting: false,

  chatHistory: loadChatHistory(),
  isThinking: false,
  isStreaming: false,
  streamingMessageId: null,
  isIndexing: false,
  indexedChunks: 0,
  indexDirty: false,
  useRAG: persisted?.useRAG ?? false,
  aiMode: persisted?.aiMode ?? "chat",
  openFolder: null,
  agentLiveOutput: "",
  agentEvents: [],
  showThinking: persisted?.showThinking ?? true,
  projectContext: null,

  sessions: loadSessions(),
  activeSessionId: loadSessions()[0]?.id ?? null,
  showSessionList: false,

  abortController: null,
  reconnectAttempts: 0,

  aiChangeHistory: [],
  mentionedFiles: [],

  setProjectContext: (ctx) => set({ projectContext: ctx }),

  setOllamaBaseUrl: (url) => {
    set({ ollamaBaseUrl: url });
    get().persistSettings();
  },

  fetchOllamaModels: async () => {
    const { ollamaBaseUrl, aiServiceMode } = get();
    set({ ollamaModelsLoading: true, ollamaModelsError: null });
    try {
      if (aiServiceMode === "grpc") {
        const healthy = await invoke<boolean>("grpc_health_check");
        const models = await invoke<string[]>("grpc_fetch_models", {
          provider: "ollama",
          baseUrl: ollamaBaseUrl,
        });
        set({
          availableModels: models,
          isOllamaRunning: models.length > 0,
          isGrpcHealthy: healthy,
          grpcStatusError: null,
          ollamaModelsError: null,
        });
      } else {
        const models = await invoke<string[]>("fetch_ollama_models", { baseUrl: ollamaBaseUrl });
        set({ availableModels: models, isOllamaRunning: true, ollamaModelsError: null });
        // Validate and clean stale selections
        const validSelected = validateSelectedModels(get().selectedOllamaModels, models);
        if (validSelected.length !== get().selectedOllamaModels.length) {
          set({ selectedOllamaModels: validSelected });
          get().persistSettings();
        }
        if (models.length > 0 && get().selectedOllamaModels.length === 0) {
          set({ selectedOllamaModels: [models[0]] });
          get().persistSettings();
        }
      }
    } catch (e) {
      const errorMsg = String(e);
      console.error("Failed to fetch Ollama models:", e);
      let localModels: string[] = [];
      try {
        localModels = await invoke<string[]>("check_ollama_status");
      } catch {
        try {
          localModels = await invoke<string[]>("ollama_list_local");
        } catch {
          localModels = [];
        }
      }
      set({
        isOllamaRunning: localModels.length > 0,
        availableModels: localModels,
        ollamaModelsError: errorMsg,
        ...(aiServiceMode === "grpc" ? { isGrpcHealthy: false, grpcStatusError: errorMsg } : {}),
      });
    } finally {
      set({ ollamaModelsLoading: false });
    }
  },

  fetchOpenAIModels: async (index) => {
    const { apiKeys, selectedApiKeyIndices, aiServiceMode } = get();
    let targetIndex: number | null | undefined = index;
    if (targetIndex === undefined) {
      targetIndex = selectedApiKeyIndices.length > 0 ? selectedApiKeyIndices[0] : null;
    }
    if (targetIndex === null || targetIndex === undefined || !apiKeys[targetIndex]) return;
    const key = apiKeys[targetIndex];
    if (key.provider !== "openai") return;

    set((s) => ({ apiProviderLoading: { ...s.apiProviderLoading, openai: true }, apiProviderErrors: { ...s.apiProviderErrors, openai: "" } }));
    try {
      const models =
        aiServiceMode === "grpc"
          ? await invoke<string[]>("grpc_fetch_models", {
            provider: "openai",
            apiKey: key.apiKey,
          })
          : await invoke<string[]>("fetch_openai_models", { apiKey: key.apiKey });
      set((s) => ({ apiProviderModels: { ...s.apiProviderModels, openai: models }, apiProviderErrors: { ...s.apiProviderErrors, openai: "" } }));
    } catch (e) {
      const errorMsg = String(e);
      console.error("Failed to fetch OpenAI models:", e);
      set((s) => ({ apiProviderErrors: { ...s.apiProviderErrors, openai: errorMsg } }));
    } finally {
      set((s) => ({ apiProviderLoading: { ...s.apiProviderLoading, openai: false } }));
    }
  },

  fetchAnthropicModels: async (index) => {
    const { apiKeys, selectedApiKeyIndices, aiServiceMode } = get();
    let targetIndex: number | null | undefined = index;
    if (targetIndex === undefined) {
      targetIndex = selectedApiKeyIndices.length > 0 ? selectedApiKeyIndices[0] : null;
    }
    if (targetIndex === null || targetIndex === undefined || !apiKeys[targetIndex]) return;
    const key = apiKeys[targetIndex];
    if (key.provider !== "anthropic") return;

    set((s) => ({ apiProviderLoading: { ...s.apiProviderLoading, anthropic: true }, apiProviderErrors: { ...s.apiProviderErrors, anthropic: "" } }));
    try {
      const models =
        aiServiceMode === "grpc"
          ? await invoke<string[]>("grpc_fetch_models", {
            provider: "anthropic",
            apiKey: key.apiKey,
          })
          : await invoke<string[]>("fetch_anthropic_models", { apiKey: key.apiKey });
      set((s) => ({ apiProviderModels: { ...s.apiProviderModels, anthropic: models }, apiProviderErrors: { ...s.apiProviderErrors, anthropic: "" } }));
    } catch (e) {
      const errorMsg = String(e);
      console.error("Failed to fetch Anthropic models:", e);
      set((s) => ({ apiProviderErrors: { ...s.apiProviderErrors, anthropic: errorMsg } }));
    } finally {
      set((s) => ({ apiProviderLoading: { ...s.apiProviderLoading, anthropic: false } }));
    }
  },

  fetchGroqModels: async (index) => {
    const { apiKeys, selectedApiKeyIndices, aiServiceMode } = get();
    let targetIndex: number | null | undefined = index;
    if (targetIndex === undefined) {
      targetIndex = selectedApiKeyIndices.length > 0 ? selectedApiKeyIndices[0] : null;
    }
    if (targetIndex === null || targetIndex === undefined || !apiKeys[targetIndex]) return;
    const key = apiKeys[targetIndex];
    if (key.provider !== "groq") return;

    set((s) => ({ apiProviderLoading: { ...s.apiProviderLoading, groq: true }, apiProviderErrors: { ...s.apiProviderErrors, groq: "" } }));
    try {
      const models =
        aiServiceMode === "grpc"
          ? await invoke<string[]>("grpc_fetch_models", {
            provider: "groq",
            apiKey: key.apiKey,
          })
          : await invoke<string[]>("fetch_groq_models", { apiKey: key.apiKey });
      set((s) => ({ apiProviderModels: { ...s.apiProviderModels, groq: models }, apiProviderErrors: { ...s.apiProviderErrors, groq: "" } }));
    } catch (e) {
      const errorMsg = String(e);
      console.error("Failed to fetch Groq models:", e);
      set((s) => ({ apiProviderErrors: { ...s.apiProviderErrors, groq: errorMsg } }));
    } finally {
      set((s) => ({ apiProviderLoading: { ...s.apiProviderLoading, groq: false } }));
    }
  },

  checkOllama: async () => {
    const { aiServiceMode, ollamaBaseUrl } = get();
    if (aiServiceMode === "grpc") {
      try {
        const healthy = await invoke<boolean>("grpc_health_check");
        const models = await invoke<string[]>("grpc_fetch_models", {
          provider: "ollama",
          baseUrl: ollamaBaseUrl,
        });
        set({
          isGrpcHealthy: healthy,
          grpcStatusError: null,
          isOllamaRunning: models.length > 0,
          availableModels: models,
        });
        // Validate and clean stale model selections
        const currentSelected = get().selectedOllamaModels;
        const validSelected = validateSelectedModels(currentSelected, models);
        if (validSelected.length !== currentSelected.length) {
          set({ selectedOllamaModels: validSelected });
          get().persistSettings();
        }
        if (models.length > 0 && get().selectedOllamaModels.length === 0) {
          set({ selectedOllamaModels: [models[0]] });
          get().persistSettings();
        }
      } catch (e) {
        const errorMsg = String(e);
        let localModels: string[] = [];
        try {
          localModels = await invoke<string[]>("fetch_ollama_models", { baseUrl: ollamaBaseUrl });
        } catch {
          try {
            localModels = await invoke<string[]>("check_ollama_status");
          } catch {
            try {
              localModels = await invoke<string[]>("ollama_list_local");
            } catch {
              localModels = [];
            }
          }
        }
        set({
          isGrpcHealthy: false,
          grpcStatusError: errorMsg,
          isOllamaRunning: localModels.length > 0,
          availableModels: localModels,
        });
      }
      return;
    }

    try {
      const models = await invoke<string[]>("fetch_ollama_models", { baseUrl: ollamaBaseUrl });
      set({ isOllamaRunning: true, availableModels: models, grpcStatusError: null });

      // Validate and clean stale model selections against actual available models
      const currentSelected = get().selectedOllamaModels;
      const validSelected = validateSelectedModels(currentSelected, models);
      if (validSelected.length !== currentSelected.length) {
        // Some selected models no longer exist — remove them
        set({ selectedOllamaModels: validSelected });
        get().persistSettings();
      }

      // Auto-select a model if nothing valid is chosen
      if (get().selectedOllamaModels.length === 0 && models.length > 0) {
        // Pick the first available model that matches a preferred base name
        const preferredBases = ["qwen2.5-coder", "deepseek-coder", "codellama", "mistral", "starcoder2"];
        let chosen = models[0];
        for (const base of preferredBases) {
          const found = models.find((m) => m.toLowerCase().startsWith(base));
          if (found) {
            chosen = found;
            break;
          }
        }
        set({ selectedOllamaModels: [chosen] });
        get().persistSettings();
      }
    } catch {
      // HTTP failure; try list fallback
      try {
        const localModels = await invoke<string[]>("check_ollama_status");
        set({ isOllamaRunning: localModels.length > 0, availableModels: localModels });
        const validSelected = validateSelectedModels(get().selectedOllamaModels, localModels);
        if (validSelected.length !== get().selectedOllamaModels.length) {
          set({ selectedOllamaModels: validSelected });
          get().persistSettings();
        }
        if (localModels.length > 0 && get().selectedOllamaModels.length === 0) {
          set({ selectedOllamaModels: [localModels[0]] });
          get().persistSettings();
        }
      } catch {
        try {
          const localModels = await invoke<string[]>("ollama_list_local");
          set({ isOllamaRunning: false, availableModels: localModels });
        } catch {
          set({ isOllamaRunning: false, availableModels: [] });
        }
      }
    }
  },

  toggleOllamaModel: (model) => {
    set((s) => {
      const isSelected = s.selectedOllamaModels.includes(model);
      const arr = isSelected
        ? s.selectedOllamaModels.filter((m) => m !== model)
        : [...s.selectedOllamaModels, model];
      return {
        selectedOllamaModels: arr,
        selectedProvider: "ollama",
      };
    });
    get().persistSettings();
  },

  addAPIKey: (entry) =>
    set((s) => ({ apiKeys: [...s.apiKeys, entry] })),

  startOllama: async () => {
    try {
      await invoke("start_ollama");
      setTimeout(() => get().checkOllama(), 2000);
    } catch (e) {
      console.error("startOllama failed", e);
    }
  },

  removeAPIKey: (index) => {
    set((s) => {
      const keys = [...s.apiKeys];
      keys.splice(index, 1);
      // adjust selected indices
      const newIndices = s.selectedApiKeyIndices
        .filter((i) => i !== index)
        .map((i) => (i > index ? i - 1 : i));
      return { apiKeys: keys, selectedApiKeyIndices: newIndices };
    });
    get().persistSettings();
  },

  toggleAPIKey: (index) => {
    set((s) => {
      const isSelected = s.selectedApiKeyIndices.includes(index);
      const arr = isSelected
        ? s.selectedApiKeyIndices.filter((i) => i !== index)
        : [...s.selectedApiKeyIndices, index];
      return {
        selectedApiKeyIndices: arr,
        selectedProvider: "api",
      };
    });
    get().persistSettings();
  },

  setProvider: (provider) => {
    set({ selectedProvider: provider });
    get().persistSettings();
  },

  setAIServiceMode: (mode) => {
    set({ aiServiceMode: mode });
    get().persistSettings();
  },

  checkGrpcService: async () => {
    try {
      const healthy = await invoke<boolean>("grpc_health_check");
      set({ isGrpcHealthy: healthy, grpcStatusError: null });
    } catch (e) {
      set({ isGrpcHealthy: false, grpcStatusError: String(e) });
    }
  },

  startGrpcService: async () => {
    set({ grpcStarting: true });
    try {
      await invoke<string>("start_grpc_service");
      await get().checkGrpcService();
      await get().checkOllama();
    } catch (e) {
      set({ isGrpcHealthy: false, grpcStatusError: String(e) });
    } finally {
      set({ grpcStarting: false });
    }
  },

  persistSettings: () => {
    const s = get();
    saveAISettings({
      selectedProvider: s.selectedProvider,
      aiServiceMode: s.aiServiceMode,
      ollamaBaseUrl: s.ollamaBaseUrl,
      selectedOllamaModels: s.selectedOllamaModels,
      selectedApiKeyIndices: s.selectedApiKeyIndices,
      useRAG: s.useRAG,
      aiMode: s.aiMode,
      showThinking: s.showThinking,
    });
  },

  sendMessage: async (content: string, activeFileContext?: string) => {
    const {
      chatHistory,
      selectedProvider,
      aiServiceMode,
      selectedOllamaModels,
      selectedApiKeyIndices,
      apiKeys,
      useRAG,
      aiMode,
      openFolder,
      indexedChunks,
      indexDirty,
      isOllamaRunning,
      ollamaBaseUrl,
    } = get();

    const userMsg: ChatMessage = {
      id: `msg-${Date.now()}`,
      role: "user",
      content,
      timestamp: Date.now(),
    };
    const autoProjectReviewIntent =
      selectedProvider === "ollama" &&
      !!openFolder &&
      /\b(project|projects|codebase|repo|repository|review|analy[sz]e|audit|architecture|one by one|each file|all files)\b/i.test(content);
    const autoProjectActionIntent =
      selectedProvider === "ollama" &&
      !!openFolder &&
      /\b(generate|create|add|update|implement|build|scaffold)\b/i.test(content);
    const shouldUseAgenticReview = aiMode === "agent" || autoProjectReviewIntent || autoProjectActionIntent;

    set((s) => {
      const isDuplicate = s.chatHistory.some(m => m.role === userMsg.role && m.content === userMsg.content && (Date.now() - m.timestamp < 2000));
      const updated = isDuplicate ? s.chatHistory : [...s.chatHistory, userMsg];
      if (!isDuplicate) {
        saveChatHistory(updated);
        get()._syncSessionMessages(updated);
      }
      return { chatHistory: updated, isThinking: true };
    });

    // ── 90-second watchdog timer (Req 12.4) ──────────────────────────────
    const watchdogTimer = setTimeout(() => {
      const state = get();
      if (state.isThinking) {
        logAIError("WATCHDOG_TIMEOUT", "isThinking stuck for 90s — auto-resetting");
        const timeoutMsg: ChatMessage = {
          id: `msg-${Date.now()}-watchdog`,
          role: "assistant",
          content: "Request timed out after 90 seconds. The AI service may be unresponsive. Please try again.",
          timestamp: Date.now(),
          isError: true,
          retryContent: content,
        };
        set((s) => {
          const updated = [...s.chatHistory, timeoutMsg];
          saveChatHistory(updated);
          get()._syncSessionMessages(updated);
          return { chatHistory: updated, isThinking: false, abortController: null };
        });
      }
    }, 90_000);

    // ── AbortController for in-flight requests (Req 1.7) ─────────────────
    const controller = new AbortController();
    set({ abortController: controller });

    try {
      let response: string | undefined;
      let sources: ChatMessage["sources"] = undefined;
      const { projectContext } = get();
      let ctxString = projectContext
        ? `\n[PROJECT CONTEXT]\nLanguages: ${projectContext.languages.join(", ")}\nFrameworks: ${projectContext.frameworks.join(", ")}\nManager: ${projectContext.packageManager || "N/A"}\nEnsure code aligns with these frameworks.`
        : "";

      if (activeFileContext) {
        ctxString += `\n[ACTIVE EDITING CONTEXT]\nThe user is currently looking at this open file:\n${activeFileContext}\nProvide exactly relevant suggestions.`;
      }

      // Inject any terminal-detected errors into AI context
      const { lastErrors } = useTerminalStore.getState();
      if (lastErrors && lastErrors.length > 0) {
        ctxString += `\n\n${formatErrorsForAI(lastErrors)}`;
      }

      // Inject @-mentioned files into context (Req 7.2, 7.4, 7.5)
      const { mentionedFiles } = get();
      if (mentionedFiles.length > 0) {
        const fileBlocks = mentionedFiles.map(f => {
          const ext = f.path.split(".").pop() || "text";
          const truncNote = f.truncated ? "\n// [truncated at 6000 chars]" : "";
          return `\`\`\`${ext}\n// ${f.path}${truncNote}\n${f.content}\n\`\`\``;
        }).join("\n\n");
        ctxString += `\n\n[MENTIONED FILES]\n${fileBlocks}`;
      }

      const modeContext =
        aiMode === "think"
          ? "THINK MODE: reason through the task first, then provide a concise practical answer with steps."
          : aiMode === "agent"
            ? "AGENT MODE: provide a structured execution plan, exact file-level changes, and validation commands."
            : aiMode === "bug_hunt"
              ? "BUG HUNT MODE: act as senior QA engineer. Systematically analyze the code for bugs, edge cases, race conditions, security vulnerabilities, memory leaks, type errors, and logic flaws. For each bug found, explain: (1) the bug and its root cause, (2) severity (critical/high/medium/low), (3) exact fix with code diff."
              : aiMode === "architect"
                ? "ARCHITECT MODE: act as senior software architect. Analyze the codebase architecture, identify design patterns used, suggest improvements for scalability/maintainability/testability, propose refactoring strategies, and recommend best practices. Provide actionable architectural diagrams or descriptions."
                : null;

      const fullContextStr = modeContext ? `${modeContext}\n${ctxString}` : ctxString;

      // 1. Gather active models — validate Ollama models against availableModels
      const { availableModels } = get();
      const validOllamaModels = selectedOllamaModels.filter((m) =>
        availableModels.length === 0 || availableModels.includes(m)
      );
      const invalidOllamaModels = selectedOllamaModels.filter((m) => !validOllamaModels.includes(m));

      if (invalidOllamaModels.length > 0) {
        // Remove stale models from selection silently
        set({ selectedOllamaModels: validOllamaModels });
        get().persistSettings();
      }

      const activeModels: { isApi: boolean; provider: string; model: string; apiKey?: string }[] = [
        ...validOllamaModels.map((m) => ({ isApi: false, provider: "ollama", model: m })),
        ...selectedApiKeyIndices
          .map((i) => {
            const entry = apiKeys[i];
            if (!entry) return null;
            return { isApi: true, provider: entry.provider, model: entry.model, apiKey: entry.apiKey };
          })
          .filter(Boolean) as { isApi: boolean; provider: string; model: string; apiKey: string }[],
      ];

      if (activeModels.length === 0) {
        const hint = invalidOllamaModels.length > 0
          ? `Previously selected model(s) [${invalidOllamaModels.join(", ")}] are not installed. Available: ${availableModels.join(", ") || "none — is Ollama running?"}`
          : "No AI models selected. Please configure a model in Settings.";
        logAIError("NO_MODEL", hint);
        set((s) => ({
          chatHistory: [
            ...s.chatHistory,
            {
              id: `msg-${Date.now()}-error`,
              role: "assistant",
              content: hint,
              timestamp: Date.now(),
              isError: true,
              retryContent: content,
            },
          ],
          isThinking: false,
          abortController: null,
        }));
        clearTimeout(watchdogTimer);
        return;
      }

      // 2. Build RAG indexes and fetch RAG context if needed
      let ragContextSources: any[] = [];
      let finalFullContextStr = fullContextStr;
      
      const requiresRag = useRAG || shouldUseAgenticReview;
      if (requiresRag && openFolder) {
        if (indexedChunks === 0 || indexDirty || autoProjectReviewIntent) {
          set({ isIndexing: true });
          try {
            const count = await invoke<number>("index_codebase", { rootPath: openFolder });
            set({ indexedChunks: count, isIndexing: false, openFolder, indexDirty: false });
          } catch (e) {
            set({ isIndexing: false });
            throw new Error(`RAG index failed: ${String(e)}`);
          }
        }

        try {
          // Fetch the combined codebase context from Rust
          const ragData = await invoke<{ answer: string; sources: any[] }>("get_rag_context", {
            rootPath: openFolder,
            query: content,
          });
          
          if (ragData.answer) {
             finalFullContextStr += `\n\n[RETRIEVED CODEBASE CONTEXT]\n${ragData.answer}`;
          }
          ragContextSources = ragData.sources;
        } catch (e) {
          console.warn("RAG Context fetch failed", e);
        }
      }

      // 3. Prepare queries based on Mode
      let baseMessages = chatHistory
          .filter((m) => m.role !== "system")
          .map((m) => ({ role: m.role, content: m.content }));
      
      let finalQueryContent = content;
      
      if (shouldUseAgenticReview) {
        set({ agentLiveOutput: "", agentEvents: [] });
        // Keep the user-visible query clean — inject instructions into context only
        finalQueryContent = content;
        const agentSystemHint =
          autoProjectReviewIntent && aiMode !== "agent"
            ? `PROJECT REVIEW MODE: Review the codebase one by one. Identify bugs, risky patterns, missing dependencies, and concrete fixes. Prefer file-level findings with clear reasoning. IMPORTANT: Do not output suggestions to create a file if it already exists, instead propose modifications to the existing file path.`
            : autoProjectActionIntent && aiMode !== "agent"
              ? `PROJECT CHANGE PROPOSAL MODE: Analyze the whole project and propose exact create/update actions. Requirements: Provide concrete file paths for each change. OUTPUT MODIFICATIONS TO EXISTING FILES if you are changing an existing component. Do NOT propose to create a file that already exists. Output terminal commands using the exact syntax: '<execute>command here</execute>'. When your entire overall objective is finished, you MUST output exactly: '<task_complete>'. Do NOT claim files are already changed; this is proposal-only until user approval.`
              : `IMPORTANT: When suggesting code changes, if a file already exists, provide the updated code for that specific existing file path, do NOT propose creating a duplicate file.`;
        // Append agent hint to context (system side), not to the user message
        finalFullContextStr = agentSystemHint + (finalFullContextStr ? `\n${finalFullContextStr}` : "");
        baseMessages.push({ role: "user", content: finalQueryContent });
      } else {
        baseMessages.push({ role: "user", content: finalQueryContent });
      }

      // 4. Dispatch — RACE MODE: first model to respond wins, others are cancelled
      const runId = `req-${Date.now()}`;
      
      // We'll set up the listener for agent mode live streams
      let unlisten: (() => void) | undefined;
      if (shouldUseAgenticReview) {
        unlisten = await listen<{kind: string; message: string}>(`ai-agent-${runId}`, (event) => {
          const payload = event.payload;
          if (payload.kind === "token") {
            set((s) => ({ agentLiveOutput: s.agentLiveOutput + payload.message }));
          } else {
            set((s) => ({ agentEvents: [...s.agentEvents, payload] as any }));
          }
        });
      }

      try {
        // Build per-model promise factory
        const makeModelPromise = async (am: typeof activeModels[0]) => {
          let res = "";
          let sourcesToAttach = requiresRag ? ragContextSources.map((s: any) => ({
              filePath: s.file_path,
              startLine: s.start_line,
              endLine: s.end_line,
          })) : undefined;

          if (am.isApi) {
            if (aiServiceMode === "grpc") {
              const grpcMessages = finalFullContextStr ? [{ role: "system", content: finalFullContextStr }, ...baseMessages] : baseMessages;
              try {
                res = await invoke<string>("grpc_ai_chat", {
                  provider: am.provider, apiKey: am.apiKey, model: am.model,
                  messages: grpcMessages, temperature: 0.7, maxTokens: 4000,
                });
              } catch (err) {
                res = await invoke<string>("api_chat", {
                  provider: am.provider, apiKey: am.apiKey, model: am.model,
                  messages: baseMessages, context: finalFullContextStr,
                });
              }
            } else {
              res = await invoke<string>("api_chat", {
                provider: am.provider, apiKey: am.apiKey, model: am.model,
                messages: baseMessages, context: finalFullContextStr,
              });
            }
          } else {
            if (shouldUseAgenticReview) {
              const result = await invoke<{ answer: string; sources: any[] }>("agentic_rag_chat", {
                runId, rootPath: openFolder, query: finalQueryContent,
                model: am.model, baseUrl: ollamaBaseUrl, context: finalFullContextStr || null,
              });
              res = result.answer;
              sourcesToAttach = result.sources.map((s: any) => ({
                filePath: s.file_path, startLine: s.start_line, endLine: s.end_line,
              }));
            } else {
              res = await invoke<string>("ollama_chat", {
                model: am.model, messages: baseMessages,
                context: finalFullContextStr, baseUrl: ollamaBaseUrl,
              });
            }
          }
          return { res, sourcesToAttach, am };
        };

        // Race: fastest model wins; also race against 60-second timeout (Req 1.4)
        const timeoutPromise = new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("REQUEST_TIMEOUT")), 60_000)
        );
        const { res, sourcesToAttach, am: winner } = await Promise.race([
          ...activeModels.map(makeModelPromise),
          timeoutPromise,
        ]);
        response = res;

        // Parse <thinking> block for think mode (Req 4.2 / Property 5)
        const { thinkingContent, content: parsedContent } = aiMode === "think"
          ? parseThinkingBlock(res)
          : { thinkingContent: undefined, content: res };

        // Parse structured bug report for bug_hunt mode (Req 5.2)
        const bugReport = aiMode === "bug_hunt" ? parseBugReport(res) : undefined;

        const assistantMsg: ChatMessage = {
          id: `msg-${Date.now()}-${winner.model}`,
          role: "assistant",
          content: parsedContent,
          thinkingContent,
          bugReport,
          sources: sourcesToAttach,
          timestamp: Date.now(),
          model: winner.model,
          provider: winner.provider as any,
          isStreaming: false,
        };

        set((s) => {
          const isDuplicate = s.chatHistory.some(m => m.role === assistantMsg.role && m.content === assistantMsg.content && (Date.now() - m.timestamp < 3000));
          const updated = isDuplicate ? s.chatHistory : [...s.chatHistory, assistantMsg];
          if (!isDuplicate) {
            saveChatHistory(updated);
            // Persist to active session
            get()._syncSessionMessages(updated);
          }
          return { chatHistory: updated };
        });

      } finally {
        if (unlisten) unlisten();
      }

      clearTimeout(watchdogTimer);
      set({ isThinking: false, abortController: null });
      // Clear @-mentions after successful send
      set({ mentionedFiles: [] });

      // Autonomous Agent Loop logic: only take action for single model responses (for now) or update differently if needed.
      // Currently, it gets tricky to run agent loops automatically when multiple models might try to execute the same command concurrently.
      // Let's rely on user acceptance for multi-model output initially or run the loop for the first model's output if standard single run.
      if (aiMode === "agent" && openFolder && response && !response.includes("<task_complete>")) {
        const executeMatches = Array.from(response.matchAll(/<execute>([\s\S]*?)<\/execute>/g));
        if (executeMatches.length > 0) {
          const firstCmd = executeMatches[0][1].trim();
          if (firstCmd) {
            // Delay slightly to let the UI settle, then run it
            setTimeout(async () => {
              try {
                // Let the UI system know agent is busy executing
                set((s) => ({
                  agentEvents: [
                    ...s.agentEvents,
                    { kind: "stage", message: `Executing command: ${firstCmd} `, ts: Date.now() },
                  ],
                }));

                const out = await invoke<string>("run_command", { cmd: firstCmd, cwd: openFolder });

                set((s) => ({
                  agentEvents: [
                    ...s.agentEvents,
                    { kind: "done", message: `Command finished`, ts: Date.now() },
                  ],
                }));

                const preview = out.length > 2000 ? `${out.slice(0, 2000)} \n…[truncated]` : out;
                const nextPrompt = `[SYSTEM] Command execution result for \`${firstCmd}\`:\n\`\`\`\n${preview || "(no output)"}\n\`\`\`\nAnalyze this output. If the command failed, fix the code and rerun. If it succeeded, continue with your plan. If your entire overarching task is completely finished, you MUST output exactly \`<task_complete>\`.`;

                // Recursively send the next prompt to continue the agent loop
                get().sendMessage(nextPrompt);

              } catch (err) {
                const nextPrompt = `[SYSTEM] Command execution failed for \`${firstCmd}\`:\n\`\`\`\n${String(err)}\n\`\`\`\nAnalyze the error, fix the underlying issue in the code, and try again. If you are stuck, output \`<task_complete>\`.`;
                get().sendMessage(nextPrompt);
              }
            }, 500);
          }
        }
      }

    } catch (e: any) {
      clearTimeout(watchdogTimer);
      // Abort any in-flight request
      controller.abort();

      const isTimeout = e?.message === "REQUEST_TIMEOUT";
      const isAborted = e?.name === "AbortError" || controller.signal.aborted;

      if (isAborted && !isTimeout) {
        // User manually aborted — just reset state, no error message
        set({ isThinking: false, abortController: null });
        return;
      }

      const errorType = isTimeout ? "REQUEST_TIMEOUT" : "SEND_ERROR";
      logAIError(errorType, String(e));

      if (shouldUseAgenticReview) {
        set((s) => ({
          agentEvents: [
            ...s.agentEvents,
            { kind: "error", message: String(e), ts: Date.now() },
          ],
        }));
      }

      const errorContent = isTimeout
        ? "Request timed out after 60 seconds. The AI service did not respond in time."
        : `Error: ${e.toString()}. Make sure your LLM service is configured correctly.`;

      const errMsg: ChatMessage = {
        id: `msg-${Date.now()}`,
        role: "assistant",
        content: errorContent,
        timestamp: Date.now(),
        isError: true,
        retryContent: content,
        provider: selectedProvider === "ollama" ? "ollama" : (apiKeys[selectedApiKeyIndices[0]]?.provider as "openai" | "anthropic" | "groq" | "airllm" | "vllm" | undefined) || "openai",
        model: selectedProvider === "ollama" ? selectedOllamaModels[0] : apiKeys[selectedApiKeyIndices[0]]?.model,
      };
      set((s) => {
        const isDuplicate = s.chatHistory.some(m => m.role === errMsg.role && m.content === errMsg.content && (Date.now() - m.timestamp < 3000));
        const updated = isDuplicate ? s.chatHistory : [...s.chatHistory, errMsg];
        if (!isDuplicate) saveChatHistory(updated);
        return { chatHistory: updated, isThinking: false, abortController: null };
      });
    }
  },

  // Abort in-flight request (Req 1.7) — must complete within 200ms
  abortRequest: () => {
    const { abortController } = get();
    if (abortController) {
      abortController.abort();
    }
    set({ isThinking: false, abortController: null });
  },

  // Re-send the last user message from an error message's retryContent (Req 1.5)
  retryLastMessage: async () => {
    const { chatHistory } = get();
    // Find the last error message with retryContent
    for (let i = chatHistory.length - 1; i >= 0; i--) {
      const msg = chatHistory[i];
      if (msg.isError && msg.retryContent) {
        // Remove the error message before retrying
        const withoutError = chatHistory.filter((_, idx) => idx !== i);
        // Also remove the user message that preceded it if it matches
        const cleaned = withoutError.filter(
          (m, idx) => !(m.role === "user" && m.content === msg.retryContent && idx === withoutError.length - 1)
        );
        set({ chatHistory: cleaned });
        saveChatHistory(cleaned);
        await get().sendMessage(msg.retryContent);
        return;
      }
    }
  },

  addStreamToken: (messageId: string, token: string) => {
    set((s) => {
      const updated = s.chatHistory.map((m) => {
        if (m.id !== messageId) return m;

        // If we're in think mode, route tokens to thinkingContent while inside
        // the <thinking> block, then to content once the block closes.
        const combined = (m.thinkingContent !== undefined ? `<thinking>${m.thinkingContent}</thinking>` : "") + m.content + token;
        const inThinkingBlock = combined.includes("<thinking>") && !combined.includes("</thinking>");

        if (inThinkingBlock) {
          // Still accumulating thinking content — strip the opening tag
          const inner = combined.replace(/^<thinking>/, "");
          return { ...m, thinkingContent: inner };
        }

        if (combined.includes("<thinking>") && combined.includes("</thinking>")) {
          // Block is now closed — parse it properly
          const { thinkingContent, content } = parseThinkingBlock(combined);
          return { ...m, thinkingContent, content };
        }

        // No thinking block — just append to content
        return { ...m, content: m.content + token };
      });
      debouncedSaveChatHistory(updated);
      return { chatHistory: updated };
    });
  },

  initStreamingMessage: (messageId: string, model?: string) => {
    const placeholder: ChatMessage = {
      id: messageId,
      role: "assistant",
      content: "",
      timestamp: Date.now(),
      isStreaming: true,
      model,
    };
    set((s) => {
      const updated = [...s.chatHistory, placeholder];
      debouncedSaveChatHistory(updated);
      get()._syncSessionMessages(updated);
      return { chatHistory: updated, isStreaming: true, streamingMessageId: messageId };
    });
  },

  updateMessage: (id: string, content: string, metadata?: Partial<ChatMessage>) => {
    set((s) => {
      const updated = s.chatHistory.map((m) =>
        m.id === id ? { ...m, content, ...metadata } : m
      );
      saveChatHistory(updated);
      return { chatHistory: updated };
    });
  },

  clearChat: () => {
    saveChatHistory([]);
    // Update active session
    const { sessions, activeSessionId } = get();
    if (activeSessionId) {
      const updated = sessions.map(s => s.id === activeSessionId ? { ...s, messages: [], updatedAt: Date.now() } : s);
      saveSessions(updated);
      set({ sessions: updated });
    }
    set({ chatHistory: [], agentLiveOutput: "", agentEvents: [] });
  },

  newChat: () => {
    // Save current chat to session first
    const { chatHistory, sessions, activeSessionId } = get();
    let updatedSessions = [...sessions];
    if (activeSessionId && chatHistory.length > 0) {
      updatedSessions = updatedSessions.map(s =>
        s.id === activeSessionId ? { ...s, messages: chatHistory, title: sessionTitle(chatHistory), updatedAt: Date.now() } : s
      );
    }
    // Create new session
    const newId = `session-${Date.now()}`;
    const newSession: ChatSession = { id: newId, title: "New Chat", createdAt: Date.now(), updatedAt: Date.now(), messages: [] };
    updatedSessions = [newSession, ...updatedSessions];
    saveSessions(updatedSessions);
    saveChatHistory([]);
    set({ sessions: updatedSessions, activeSessionId: newId, chatHistory: [], agentLiveOutput: "", agentEvents: [] });
  },

  switchSession: (id: string) => {
    const { chatHistory, sessions, activeSessionId } = get();
    // Save current session
    let updatedSessions = [...sessions];
    if (activeSessionId && chatHistory.length > 0) {
      updatedSessions = updatedSessions.map(s =>
        s.id === activeSessionId ? { ...s, messages: chatHistory, title: sessionTitle(chatHistory), updatedAt: Date.now() } : s
      );
    }
    const target = updatedSessions.find(s => s.id === id);
    if (!target) return;
    saveSessions(updatedSessions);
    saveChatHistory(target.messages);
    set({ sessions: updatedSessions, activeSessionId: id, chatHistory: target.messages, agentLiveOutput: "", agentEvents: [] });
  },

  deleteSession: (id: string) => {
    const { sessions, activeSessionId } = get();
    const updated = sessions.filter(s => s.id !== id);
    saveSessions(updated);
    if (activeSessionId === id) {
      const next = updated[0];
      saveChatHistory(next?.messages ?? []);
      set({ sessions: updated, activeSessionId: next?.id ?? null, chatHistory: next?.messages ?? [] });
    } else {
      set({ sessions: updated });
    }
  },

  toggleSessionList: () => set(s => ({ showSessionList: !s.showSessionList })),

  // Internal: sync current chatHistory into the active session
  _syncSessionMessages: (messages: ChatMessage[]) => {
    const { sessions, activeSessionId } = get();
    if (!activeSessionId) {
      // Auto-create first session
      const newId = `session-${Date.now()}`;
      const newSession: ChatSession = { id: newId, title: sessionTitle(messages), createdAt: Date.now(), updatedAt: Date.now(), messages };
      const updated = [newSession, ...sessions];
      saveSessions(updated);
      set({ sessions: updated, activeSessionId: newId });
      return;
    }
    const updated = sessions.map(s =>
      s.id === activeSessionId ? { ...s, messages, title: sessionTitle(messages), updatedAt: Date.now() } : s
    );
    saveSessions(updated);
    set({ sessions: updated });
  },

  indexCodebase: async (path: string) => {
    set({ isIndexing: true });
    try {
      const count = await invoke<number>("index_codebase", { rootPath: path });
      set({ indexedChunks: count, isIndexing: false, openFolder: path, indexDirty: false });
    } catch (e) {
      console.error("Indexing failed:", e);
      set({ isIndexing: false });
    }
  },

  toggleRAG: () => {
    set((s) => ({ useRAG: !s.useRAG }));
    get().persistSettings();
  },
  setAIMode: (aiMode) => {
    set({ aiMode });
    get().persistSettings();
  },
  setShowThinking: (showThinking) => {
    set({ showThinking });
    get().persistSettings();
  },

  getInlineCompletion: async (code: string, language: string): Promise<string> => {
    const { selectedProvider, aiServiceMode, selectedOllamaModels, selectedApiKeyIndices, apiKeys, isOllamaRunning, ollamaBaseUrl } = get();
    if (selectedProvider === "ollama" && !isOllamaRunning) return "";

    try {
      const prompt = `Complete this ${language} code (output only the completion, no explanation):\n\`\`\`${language}\n${code}`;

      // 3-second timeout — silently dismiss on failure (Req 8.7)
      const timeoutPromise = new Promise<string>((_, reject) =>
        setTimeout(() => reject(new Error("INLINE_COMPLETION_TIMEOUT")), 3000)
      );

      const completionPromise = (async (): Promise<string> => {
        if (selectedProvider === "ollama") {
          const model = selectedOllamaModels[0] || "";
          const result = await invoke<string>("ollama_complete", {
            model,
            prompt,
            maxTokens: 100,
            baseUrl: ollamaBaseUrl,
          });
          return result.trim();
        } else if (selectedProvider === "api" && selectedApiKeyIndices.length > 0) {
          const keyEntry = apiKeys[selectedApiKeyIndices[0]];
          const result =
            aiServiceMode === "grpc"
              ? await invoke<string>("grpc_ai_chat", {
                provider: keyEntry.provider,
                apiKey: keyEntry.apiKey,
                model: keyEntry.model,
                messages: [{ role: "user", content: prompt }],
                temperature: 0.1,
                maxTokens: 120,
              })
              : await invoke<string>("api_complete", {
                provider: keyEntry.provider,
                apiKey: keyEntry.apiKey,
                model: keyEntry.model,
                prompt,
                maxTokens: 100,
              });
          return result.trim();
        }
        return "";
      })();

      return await Promise.race([completionPromise, timeoutPromise]);
    } catch {
      // Silently dismiss on timeout or any error (Req 8.7)
      return "";
    }
  },

  setOpenFolder: (path) => {
    set({ openFolder: path, indexedChunks: 0, indexDirty: false, agentLiveOutput: "", agentEvents: [] });
  },

  markCodebaseChanged: (filePath) =>
    set((s) => {
      if (!s.openFolder) return {};
      if (!filePath) return { indexDirty: true };
      const normalize = (p: string) => p.replace(/\\/g, "/");
      const root = normalize(s.openFolder);
      const target = normalize(filePath);
      if (!target.startsWith(root)) return {};
      return { indexDirty: true };
    }),

  recordAgentChanges: (changes) => {
    set((s) => ({ aiChangeHistory: [...s.aiChangeHistory, ...changes] }));
  },

  rollbackAgentChanges: async () => {
    const { aiChangeHistory } = get();
    for (const change of [...aiChangeHistory].reverse()) {
      try {
        if (change.action === 'delete' && change.originalContent !== undefined) {
          await invoke('write_file', { path: change.path, content: change.originalContent });
        } else if (change.action === 'create') {
          await invoke('delete_file', { path: change.path });
        } else if (change.action === 'write' && change.originalContent !== undefined) {
          await invoke('write_file', { path: change.path, content: change.originalContent });
        }
      } catch (e) {
        logAIError('ROLLBACK_ERROR', String(e));
      }
    }
    set({ aiChangeHistory: [] });
  },

  // @-mention: add a file to the mention context (Property 6 — truncate at 6000 chars)
  addMentionedFile: async (path: string) => {
    const { mentionedFiles } = get();
    // Enforce 5-file limit (Req 7.3)
    if (mentionedFiles.length >= MENTION_FILE_LIMIT) {
      return { ok: false, reason: `Limit of ${MENTION_FILE_LIMIT} file mentions reached.` };
    }
    // Avoid duplicates
    if (mentionedFiles.some(f => f.path === path)) {
      return { ok: true };
    }
    try {
      const raw: string = await invoke("read_file", { path });
      const truncated = raw.length > MENTION_CHAR_LIMIT;
      const content = truncated ? raw.slice(0, MENTION_CHAR_LIMIT) : raw;
      set(s => ({ mentionedFiles: [...s.mentionedFiles, { path, content, truncated }] }));
      return { ok: true };
    } catch (e) {
      logAIError("MENTION_FILE_READ", String(e));
      return { ok: false, reason: `Could not read file: ${String(e)}` };
    }
  },

  removeMentionedFile: (path: string) => {
    set(s => ({ mentionedFiles: s.mentionedFiles.filter(f => f.path !== path) }));
  },

  clearMentionedFiles: () => {
    set({ mentionedFiles: [] });
  },

  runAgentTask: async (content) => {
    const { selectedOllamaModels, openFolder, chatHistory } = get();
    const model = selectedOllamaModels[0] || '';
    if (!model || !openFolder) return;

    const userMsg: ChatMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content,
      timestamp: Date.now(),
    };
    set((s) => ({ chatHistory: [...s.chatHistory, userMsg], isThinking: true }));

    try {
      const messages = [...chatHistory, userMsg].map(m => ({ role: m.role, content: m.content }));
      const resultJson = await invoke<string>('run_agent_task', {
        model,
        messages,
        projectRoot: openFolder,
        maxSteps: 20,
      });
      const result = JSON.parse(resultJson) as { summary: string; changes: AgentFileChange[] };
      get().recordAgentChanges(result.changes);
      const assistantMsg: ChatMessage = {
        id: `assistant-${Date.now()}`,
        role: 'assistant',
        content: result.summary,
        timestamp: Date.now(),
        model,
      };
      set((s) => ({ chatHistory: [...s.chatHistory, assistantMsg], isThinking: false }));
    } catch (e) {
      logAIError('AGENT_ERROR', String(e));
      const errMsg: ChatMessage = {
        id: `error-${Date.now()}`,
        role: 'assistant',
        content: `Agent error: ${String(e)}`,
        timestamp: Date.now(),
        isError: true,
      };
      set((s) => ({ chatHistory: [...s.chatHistory, errMsg], isThinking: false }));
    }
  },

}));

// Set up Tauri event listeners for real-time token streaming
// These run once at module load time and wire the store to Tauri events
(async () => {
  try {
    await listen<{ messageId: string; token: string }>("ai-stream-token", (event) => {
      const { messageId, token } = event.payload;
      useAIStore.getState().addStreamToken(messageId, token);
    });

    await listen<{ messageId: string }>("ai-stream-done", (event) => {
      const { messageId } = event.payload;
      useAIStore.setState((s) => {
        const updated = s.chatHistory.map((m) =>
          m.id === messageId ? { ...m, isStreaming: false } : m
        );
        saveChatHistory(updated);
        return {
          chatHistory: updated,
          isStreaming: false,
          streamingMessageId: null,
          isThinking: false,
        };
      });
    });

    await listen<{ messageId: string; error: string }>("ai-stream-error", (event) => {
      const { messageId, error } = event.payload;
      useAIStore.setState((s) => {
        const updated = s.chatHistory.map((m) =>
          m.id === messageId
            ? { ...m, isStreaming: false, isIncomplete: true, isError: true }
            : m
        );
        // If no message with that id exists yet, add an error message
        const found = updated.some((m) => m.id === messageId);
        const final = found
          ? updated
          : [
              ...updated,
              {
                id: messageId,
                role: "assistant" as const,
                content: `Stream error: ${error}`,
                timestamp: Date.now(),
                isError: true,
                isIncomplete: true,
              },
            ];
        saveChatHistory(final);
        return {
          chatHistory: final,
          isStreaming: false,
          streamingMessageId: null,
          isThinking: false,
        };
      });
    });
  } catch {
    // Tauri event listeners may fail in non-Tauri environments (e.g. tests)
  }
})();
