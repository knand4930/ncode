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
}

export type AIMode = "chat" | "think" | "agent";

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
  selectedOllamaModel: string | null;
  selectedApiKeyIndex: number | null;
  useRAG: boolean;
  aiMode: AIMode;
  showThinking: boolean;
};

const AI_SETTINGS_KEY = "NCode.ai.settings.v1";

function loadAISettings(): PersistedAISettings | null {
  try {
    if (typeof window === "undefined") return null;
    const raw = window.localStorage.getItem(AI_SETTINGS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PersistedAISettings;
    if (!parsed || (parsed.selectedProvider !== "ollama" && parsed.selectedProvider !== "api")) {
      return null;
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

const persisted = loadAISettings();

interface AIStore {
  isOllamaRunning: boolean;
  availableModels: string[];

  // single active Ollama model selected by user
  selectedOllamaModels: string[];

  apiKeys: ApiKeyEntry[];
  selectedProvider: "ollama" | "api";
  selectedApiKeyIndex: number | null;

  chatHistory: ChatMessage[];
  isThinking: boolean;
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
  sendMessage: (content: string) => Promise<void>;
  clearChat: () => void;
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
  selectedOllamaModels: persisted?.selectedOllamaModel ? [persisted.selectedOllamaModel] : [],

  apiKeys: [],
  selectedProvider: persisted?.selectedProvider || "ollama",
  selectedApiKeyIndex: persisted?.selectedApiKeyIndex ?? null,

  chatHistory: [],
  isThinking: false,
  isIndexing: false,
  indexedChunks: 0,
  indexDirty: false,
  useRAG: persisted?.useRAG ?? false,
  aiMode: persisted?.aiMode ?? "chat",
  openFolder: null,
  agentLiveOutput: "",
  agentEvents: [],
  showThinking: persisted?.showThinking ?? true,

  checkOllama: async () => {
    try {
      const models = await invoke<string[]>("check_ollama_status");
      set({ isOllamaRunning: true, availableModels: models });
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

  persistSettings: () => {
    const s = get();
    saveAISettings({
      selectedProvider: s.selectedProvider,
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
    const shouldUseAgenticReview = aiMode === "agent" || autoProjectReviewIntent;

    set((s) => ({ chatHistory: [...s.chatHistory, userMsg], isThinking: true }));

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
        response = await invoke<string>("ollama_chat", {
          model,
          messages,
          context: modeContext,
        });
      } else if (selectedProvider === "api" && selectedApiKeyIndex !== null) {
        const keyEntry = apiKeys[selectedApiKeyIndex];
        const messages = chatHistory
          .filter((m) => m.role !== "system")
          .map((m) => ({ role: m.role, content: m.content }));
        messages.push({ role: "user", content });
        response = await invoke<string>("api_chat", {
          provider: keyEntry.provider,
          apiKey: keyEntry.apiKey,
          model: keyEntry.model,
          messages,
          context: modeContext,
        });
      } else {
        response = "Error: no model/provider selected";
      }

      const assistantMsg: ChatMessage = {
        id: `msg-${Date.now()}`,
        role: "assistant",
        content: response,
        sources,
        timestamp: Date.now(),
      };

      set((s) => ({ chatHistory: [...s.chatHistory, assistantMsg], isThinking: false }));
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
      };
      set((s) => ({ chatHistory: [...s.chatHistory, errMsg], isThinking: false }));
    }
  },

  clearChat: () => set({ chatHistory: [], agentLiveOutput: "", agentEvents: [] }),

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
    const { selectedProvider, selectedOllamaModels, selectedApiKeyIndex, apiKeys, isOllamaRunning } = get();
    if (selectedProvider === "ollama" && !isOllamaRunning) return "";

    try {
      const prompt = `Complete this ${language} code (output only the completion, no explanation):\n\`\`\`${language}\n${code}`;
      if (selectedProvider === "ollama") {
        const model = selectedOllamaModels[0] || "";
        const result = await invoke<string>("ollama_complete", {
          model,
          prompt,
          maxTokens: 100,
        });
        return result.trim();
      } else if (selectedProvider === "api" && selectedApiKeyIndex !== null) {
        const keyEntry = apiKeys[selectedApiKeyIndex];
        const result = await invoke<string>("api_complete", {
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

  setOpenFolder: (path) => set({ openFolder: path, indexedChunks: 0, indexDirty: false, agentLiveOutput: "", agentEvents: [] }),

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
