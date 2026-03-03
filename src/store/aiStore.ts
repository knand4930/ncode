// src/store/aiStore.ts
import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  sources?: Array<{ filePath: string; startLine: number; endLine: number }>;
  timestamp: number;
  model?: string;
  provider?: "ollama" | "openai" | "anthropic" | "groq";
  isStreaming?: boolean;
  tokens?: number;
}

export type AIMode = "chat" | "think" | "agent";
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
  { name: "deepseek-coder:1.3b", label: "DeepSeek 1.3B", ramGB: 1, description: "Fastest, 1GB RAM" },
  { name: "codellama:7b-code-q4_0", label: "CodeLlama 7B Q4", ramGB: 4, description: "Best quality, 4GB RAM" },
  { name: "deepseek-coder:6.7b-instruct-q4_K_M", label: "DeepSeek 6.7B", ramGB: 4, description: "Balanced, 4GB RAM" },
  { name: "qwen2.5-coder:1.5b", label: "Qwen2.5 1.5B", ramGB: 1, description: "Lightweight, 1-2GB RAM" },
  { name: "starcoder2:3b", label: "StarCoder2 3B", ramGB: 2, description: "Good for completions, 2GB RAM" },
];

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
  selectedOllamaModel: string | null;
  selectedApiKeyIndex: number | null;
  useRAG: boolean;
  aiMode: AIMode;
  showThinking: boolean;
};

const AI_SETTINGS_KEY = "NCode.ai.settings.v1";
const AI_CHAT_HISTORY_KEY = "NCode.ai.chatHistory.v1";

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

function loadChatHistory(): ChatMessage[] {
  try {
    if (typeof window === "undefined") return [];
    const raw = window.localStorage.getItem(AI_CHAT_HISTORY_KEY);
    if (!raw) return [];
    const messages = JSON.parse(raw) as ChatMessage[];
    return Array.isArray(messages) ? messages : [];
  } catch (e) {
    console.error("Failed to load chat history:", e);
    return [];
  }
}

function saveChatHistory(messages: ChatMessage[]) {
  try {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(AI_CHAT_HISTORY_KEY, JSON.stringify(messages));
  } catch (e) {
    console.error("Failed to save chat history:", e);
  }
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
  selectedApiKeyIndex: number | null;
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

  checkOllama: () => Promise<void>;
  startOllama: () => Promise<void>;
  toggleOllamaModel: (model: string) => void;
  addAPIKey: (entry: ApiKeyEntry) => void;
  removeAPIKey: (index: number) => void;
  selectAPIKey: (index: number) => void;
  setProvider: (provider: "ollama" | "api") => void;
  setAIServiceMode: (mode: AIServiceMode) => void;
  checkGrpcService: () => Promise<void>;
  startGrpcService: () => Promise<void>;
  setOllamaBaseUrl: (url: string) => void;
  fetchOllamaModels: () => Promise<void>;
  fetchOpenAIModels: (index?: number) => Promise<void>;
  fetchAnthropicModels: (index?: number) => Promise<void>;
  fetchGroqModels: (index?: number) => Promise<void>;
  sendMessage: (content: string) => Promise<void>;
  clearChat: () => void;
  addStreamToken: (messageId: string, token: string) => void;
  updateMessage: (id: string, content: string, metadata?: Partial<ChatMessage>) => void;
  indexCodebase: (path: string) => Promise<void>;
  toggleRAG: () => void;
  setAIMode: (mode: AIMode) => void;
  setShowThinking: (show: boolean) => void;
  persistSettings: () => void;
  getInlineCompletion: (code: string, language: string) => Promise<string>;
  setOpenFolder: (path: string | null) => void;
  markCodebaseChanged: (filePath?: string) => void;
}

export const useAIStore = create<AIStore>((set, get) => ({
  isOllamaRunning: false,
  availableModels: [],
  ollamaBaseUrl: "http://localhost:11434",
  ollamaModelsLoading: false,
  ollamaModelsError: null,
  selectedOllamaModels: persisted?.selectedOllamaModel ? [persisted.selectedOllamaModel] : [],

  apiKeys: [],
  selectedProvider: persisted?.selectedProvider || "ollama",
  aiServiceMode: persisted?.aiServiceMode || "direct",
  selectedApiKeyIndex: persisted?.selectedApiKeyIndex ?? null,
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

  setOllamaBaseUrl: (url) => {
    set({ ollamaBaseUrl: url });
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
    const { apiKeys, selectedApiKeyIndex, aiServiceMode } = get();
    const targetIndex = typeof index === "number" ? index : selectedApiKeyIndex;
    if (targetIndex === null || !apiKeys[targetIndex]) return;
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
    const { apiKeys, selectedApiKeyIndex, aiServiceMode } = get();
    const targetIndex = typeof index === "number" ? index : selectedApiKeyIndex;
    if (targetIndex === null || !apiKeys[targetIndex]) return;
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
    const { apiKeys, selectedApiKeyIndex, aiServiceMode } = get();
    const targetIndex = typeof index === "number" ? index : selectedApiKeyIndex;
    if (targetIndex === null || !apiKeys[targetIndex]) return;
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
        if (models.length > 0 && get().selectedOllamaModels.length === 0) {
          set({ selectedOllamaModels: [models[0]] });
          get().persistSettings();
        }
      } catch (e) {
        const errorMsg = String(e);
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
          isGrpcHealthy: false,
          grpcStatusError: errorMsg,
          isOllamaRunning: localModels.length > 0,
          availableModels: localModels,
        });
      }
      return;
    }

    try {
      const models = await invoke<string[]>("check_ollama_status");
      set({ isOllamaRunning: true, availableModels: models, grpcStatusError: null });
      // auto-select default if nothing chosen yet
      const state = get();
      if (state.selectedOllamaModels.length === 0 && models.length > 0) {
        const preferred = ["deepseek-coder:1.3b", "qwen2.5-coder:1.5b", "codellama:7b-code-q4_0"];
        let chosen = models[0];
        for (const m of preferred) {
          const found = models.find((am) => am.startsWith(m.split(":")[0]));
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
        const localModels = await invoke<string[]>("ollama_list_local");
        set({ isOllamaRunning: false, availableModels: localModels });
        if (localModels.length > 0 && get().selectedOllamaModels.length === 0) {
          set({ selectedOllamaModels: [localModels[0]] });
          get().persistSettings();
        }
      } catch {
        set({ isOllamaRunning: false, availableModels: [] });
      }
    }
  },

  toggleOllamaModel: (model) => {
    set((s) => {
      // single active local model: selecting one replaces previous selection
      const arr = s.selectedOllamaModels[0] === model ? [model] : [model];
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
      // adjust selected index if necessary
      let sel = s.selectedApiKeyIndex;
      if (sel !== null) {
        if (sel === index) sel = null;
        else if (sel > index) sel = sel - 1;
      }
      return { apiKeys: keys, selectedApiKeyIndex: sel };
    });
    get().persistSettings();
  },

  selectAPIKey: (index) => {
    set({ selectedProvider: "api", selectedApiKeyIndex: index });
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
      selectedOllamaModel: s.selectedOllamaModels[0] || null,
      selectedApiKeyIndex: s.selectedApiKeyIndex,
      useRAG: s.useRAG,
      aiMode: s.aiMode,
      showThinking: s.showThinking,
    });
  },

  sendMessage: async (content: string) => {
    const {
      chatHistory,
      selectedProvider,
      aiServiceMode,
      selectedOllamaModels,
      selectedApiKeyIndex,
      apiKeys,
      useRAG,
      aiMode,
      openFolder,
      indexedChunks,
      indexDirty,
      isOllamaRunning,
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
      const updated = [...s.chatHistory, userMsg];
      saveChatHistory(updated);
      return { chatHistory: updated, isThinking: true };
    });

    try {
      let response: string;
      let sources: ChatMessage["sources"] = undefined;
      const modeContext =
        aiMode === "think"
          ? "THINK MODE: reason through the task first, then provide a concise practical answer with steps."
          : aiMode === "agent"
          ? "AGENT MODE: provide a structured execution plan, exact file-level changes, and validation commands."
          : null;

      if (shouldUseAgenticReview) {
        if (!isOllamaRunning) {
          throw new Error("Agent mode requires local Ollama to be running");
        }
        const runId = `agent-${Date.now()}`;
        const ragModel = selectedOllamaModels[0] || "deepseek-coder:1.3b";
        set({ agentLiveOutput: "", agentEvents: [] });

        if (openFolder && (indexedChunks === 0 || indexDirty || autoProjectReviewIntent)) {
          set({ isIndexing: true });
          try {
            const count = await invoke<number>("index_codebase", { rootPath: openFolder });
            set({ indexedChunks: count, isIndexing: false, openFolder, indexDirty: false });
          } catch (e) {
            set({ isIndexing: false });
            throw new Error(`RAG index failed: ${String(e)}`);
          }
        }

        const unlisten = await listen<AgentEvent>(`ai-agent-${runId}`, (event) => {
          const payload = event.payload;
          if (payload.kind === "token") {
            set((s) => ({ agentLiveOutput: s.agentLiveOutput + payload.message }));
          } else {
            set((s) => ({ agentEvents: [...s.agentEvents, payload] }));
          }
        });

        try {
          const agentQuery =
            autoProjectReviewIntent && aiMode !== "agent"
              ? `PROJECT REVIEW MODE: Review the codebase one by one. Identify bugs, risky patterns, missing dependencies, and concrete fixes. Prefer file-level findings with clear reasoning.\n\nUser request:\n${content}`
              : autoProjectActionIntent && aiMode !== "agent"
              ? `PROJECT CHANGE PROPOSAL MODE: Analyze the whole project and propose exact create/update actions.\n\
                 Requirements:\n\
                 - Provide concrete file paths for each change.\n\
                 - Include terminal commands if needed.\n\
                 - Do NOT claim files are already changed; this is proposal-only until user approval.\n\
                 - Include validation commands.\n\n\
                 User request:\n${content}`
              : content;
          const result = await invoke<{ answer: string; sources: any[] }>("agentic_rag_chat", {
            runId,
            rootPath: openFolder,
            query: agentQuery,
            model: ragModel,
          });
          response = result.answer;
          sources = result.sources.map((s: any) => ({
            filePath: s.file_path,
            startLine: s.start_line,
            endLine: s.end_line,
          }));
        } finally {
          unlisten();
        }
      } else if (useRAG && openFolder) {
        if (!isOllamaRunning) {
          throw new Error("RAG requires local Ollama to be running");
        }
        const ragModel = selectedOllamaModels[0] || "deepseek-coder:1.3b";

        // Build index on-demand the first time RAG is used for this folder.
        if (indexedChunks === 0 || indexDirty) {
          set({ isIndexing: true });
          try {
            const count = await invoke<number>("index_codebase", { rootPath: openFolder });
            set({ indexedChunks: count, isIndexing: false, openFolder, indexDirty: false });
          } catch (e) {
            set({ isIndexing: false });
            throw new Error(`RAG index failed: ${String(e)}`);
          }
        }

        // RAG currently uses local Ollama chat for grounded answers.
        const ragQuery =
          aiMode === "chat"
            ? content
            : `${content}\n\n[${aiMode.toUpperCase()} MODE]\n${modeContext}`;
        const result = await invoke<{ answer: string; sources: any[] }>("rag_query", {
          rootPath: openFolder,
          query: ragQuery,
          model: ragModel,
        });
        response = result.answer;
        sources = result.sources.map((s: any) => ({
          filePath: s.file_path,
          startLine: s.start_line,
          endLine: s.end_line,
        }));
      } else if (selectedProvider === "ollama") {
        const model = selectedOllamaModels[0] || "";
        const messages = chatHistory
          .filter((m) => m.role !== "system")
          .map((m) => ({ role: m.role, content: m.content }));
        messages.push({ role: "user", content });
        if (aiServiceMode === "grpc") {
          if (modeContext) {
            messages.unshift({ role: "system", content: modeContext });
          }
          response = await invoke<string>("grpc_ai_chat", {
            model,
            messages,
            provider: "ollama",
            temperature: 0.7,
            maxTokens: 2000,
          });
        } else {
          response = await invoke<string>("ollama_chat", {
            model,
            messages,
            context: modeContext,
          });
        }
      } else if (selectedProvider === "api" && selectedApiKeyIndex !== null) {
        const keyEntry = apiKeys[selectedApiKeyIndex];
        const messages = chatHistory
          .filter((m) => m.role !== "system")
          .map((m) => ({ role: m.role, content: m.content }));
        messages.push({ role: "user", content });
        if (aiServiceMode === "grpc") {
          if (modeContext) {
            messages.unshift({ role: "system", content: modeContext });
          }
          response = await invoke<string>("grpc_ai_chat", {
            provider: keyEntry.provider,
            apiKey: keyEntry.apiKey,
            model: keyEntry.model,
            messages,
            temperature: 0.7,
            maxTokens: 2000,
          });
        } else {
          response = await invoke<string>("api_chat", {
            provider: keyEntry.provider,
            apiKey: keyEntry.apiKey,
            model: keyEntry.model,
            messages,
            context: modeContext,
          });
        }
      } else {
        response = "Error: no model/provider selected";
      }

      const assistantMsg: ChatMessage = {
        id: `msg-${Date.now()}`,
        role: "assistant",
        content: response,
        sources,
        timestamp: Date.now(),
        model: selectedProvider === "ollama" ? selectedOllamaModels[0] : apiKeys[selectedApiKeyIndex!]?.model,
        provider: selectedProvider === "ollama" ? "ollama" : (apiKeys[selectedApiKeyIndex!]?.provider as "openai" | "anthropic" | "groq" | undefined) || "openai",
        isStreaming: false,
      };

      set((s) => {
        const updated = [...s.chatHistory, assistantMsg];
        saveChatHistory(updated);
        return { chatHistory: updated, isThinking: false };
      });
    } catch (e: any) {
      if (shouldUseAgenticReview) {
        set((s) => ({
          agentEvents: [
            ...s.agentEvents,
            { kind: "error", message: String(e), ts: Date.now() },
          ],
        }));
      }
      const errMsg: ChatMessage = {
        id: `msg-${Date.now()}`,
        role: "assistant",
        content: `Error: ${e.toString()}. Make sure your LLM service is configured correctly.`,
        timestamp: Date.now(),
        provider: selectedProvider === "ollama" ? "ollama" : (apiKeys[selectedApiKeyIndex!]?.provider as "openai" | "anthropic" | "groq" | undefined) || "openai",
        model: selectedProvider === "ollama" ? selectedOllamaModels[0] : apiKeys[selectedApiKeyIndex!]?.model,
      };
      set((s) => {
        const updated = [...s.chatHistory, errMsg];
        saveChatHistory(updated);
        return { chatHistory: updated, isThinking: false };
      });
    }
  },

  addStreamToken: (messageId: string, token: string) => {
    set((s) => {
      const updated = s.chatHistory.map((m) =>
        m.id === messageId ? { ...m, content: m.content + token } : m
      );
      saveChatHistory(updated);
      return { chatHistory: updated };
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
    set({ chatHistory: [], agentLiveOutput: "", agentEvents: [] });
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
    const { selectedProvider, aiServiceMode, selectedOllamaModels, selectedApiKeyIndex, apiKeys, isOllamaRunning } = get();
    if (selectedProvider === "ollama" && !isOllamaRunning) return "";

    try {
      const prompt = `Complete this ${language} code (output only the completion, no explanation):\n\`\`\`${language}\n${code}`;
      if (selectedProvider === "ollama") {
        const model = selectedOllamaModels[0] || "";
        const result =
          aiServiceMode === "grpc"
            ? await invoke<string>("grpc_ai_chat", {
                model,
                provider: "ollama",
                messages: [{ role: "user", content: prompt }],
                temperature: 0.1,
                maxTokens: 120,
              })
            : await invoke<string>("ollama_complete", {
                model,
                prompt,
                maxTokens: 100,
              });
        return result.trim();
      } else if (selectedProvider === "api" && selectedApiKeyIndex !== null) {
        const keyEntry = apiKeys[selectedApiKeyIndex];
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
    } catch {
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

}));
