import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { useAIStore } from "./aiStore";
import { detectProjectContext } from "../utils/projectScanner";

export interface EditorTab {
  id: string;
  filePath: string;
  fileName: string;
  content: string;
  isDirty: boolean;
  language: string;
  cursorPosition: { line: number; column: number };
}

interface AIChangeEntry {
  id: string;
  filePath: string;
  fileName: string;
  previousContent: string;
  newContent: string;
  existedBefore: boolean;
  summary: string;
  timestamp: number;
}

interface EditorStore {
  tabs: EditorTab[];
  activeTabId: string | null;
  openFolder: string | null;
  recentFiles: string[];
  aiChangeHistory: AIChangeEntry[];

  openFile: (filePath: string) => Promise<string | null>;
  openFileAt: (filePath: string, line: number, column?: number) => Promise<void>;
  closeTab: (tabId: string) => void;
  setActiveTab: (tabId: string) => void;
  updateContent: (tabId: string, content: string) => void;
  saveFile: (tabId: string) => Promise<void>;
  saveAllFiles: () => Promise<void>;
  setCursorPosition: (tabId: string, line: number, column: number) => void;
  setOpenFolder: (path: string) => void;
  applyAIChangeToTab: (tabId: string, newContent: string, summary?: string) => Promise<boolean>;
  applyAIChangeToFile: (filePath: string, newContent: string, summary?: string) => Promise<boolean>;
  rollbackLastAIChange: () => Promise<boolean>;
}

function detectLanguage(filePath: string): string {
  const ext = filePath.split(".").pop()?.toLowerCase() || "";
  const map: Record<string, string> = {
    ts: "typescript", tsx: "typescript", js: "javascript", jsx: "javascript",
    py: "python", rs: "rust", go: "go", java: "java", cpp: "cpp", c: "c",
    cs: "csharp", rb: "ruby", php: "php", swift: "swift", kt: "kotlin",
    html: "html", css: "css", scss: "scss", less: "less",
    json: "json", yaml: "yaml", yml: "yaml", toml: "toml",
    md: "markdown", sh: "shell", bash: "shell", zsh: "shell",
    sql: "sql", graphql: "graphql", vue: "html", svelte: "html",
    dart: "dart", lua: "lua", r: "r", m: "objective-c",
    xml: "xml", dockerfile: "dockerfile", makefile: "makefile",
  };
  return map[ext] || "plaintext";
}

export const useEditorStore = create<EditorStore>((set, get) => ({
  tabs: [],
  activeTabId: null,
  openFolder: null,
  recentFiles: [],
  aiChangeHistory: [],

  openFile: async (filePath: string) => {
    const { tabs } = get();

    // Check if already open
    const existing = tabs.find((t) => t.filePath === filePath);
    if (existing) {
      set((s) => ({
        activeTabId: existing.id,
        recentFiles: [filePath, ...s.recentFiles.filter((p) => p !== filePath)].slice(0, 50),
      }));
      return existing.id;
    }

    try {
      const content = await invoke<string>("read_file", { path: filePath });
      const fileName = filePath.split(/[\\/]/).pop() || filePath;
      const tab: EditorTab = {
        id: `tab-${Date.now()}`,
        filePath,
        fileName,
        content,
        isDirty: false,
        language: detectLanguage(filePath),
        cursorPosition: { line: 1, column: 1 },
      };
      set((s) => {
        const recent = [filePath, ...s.recentFiles.filter((p) => p !== filePath)].slice(0, 50);
        return { tabs: [...s.tabs, tab], activeTabId: tab.id, recentFiles: recent };
      });
      return tab.id;
    } catch (e) {
      console.error("Failed to open file:", e);
      return null;
    }
  },

  openFileAt: async (filePath, line, column = 1) => {
    const tabId = await get().openFile(filePath);
    if (!tabId) return;
    set((s) => ({
      tabs: s.tabs.map((t) =>
        t.id === tabId
          ? {
            ...t,
            cursorPosition: {
              line: Math.max(1, line),
              column: Math.max(1, column),
            },
          }
          : t
      ),
      activeTabId: tabId,
    }));
  },

  closeTab: (tabId: string) => {
    const { tabs, activeTabId } = get();
    const idx = tabs.findIndex((t) => t.id === tabId);
    const newTabs = tabs.filter((t) => t.id !== tabId);

    let newActive = activeTabId;
    if (activeTabId === tabId) {
      newActive = newTabs[idx]?.id || newTabs[idx - 1]?.id || null;
    }

    set({ tabs: newTabs, activeTabId: newActive });
  },

  setActiveTab: (tabId: string) => set({ activeTabId: tabId }),

  updateContent: (tabId: string, content: string) => {
    set((s) => ({
      tabs: s.tabs.map((t) =>
        t.id === tabId ? { ...t, content, isDirty: true } : t
      ),
    }));
  },

  saveFile: async (tabId: string) => {
    const tab = get().tabs.find((t) => t.id === tabId);
    if (!tab) return;
    await invoke("write_file", { path: tab.filePath, content: tab.content });
    useAIStore.getState().markCodebaseChanged(tab.filePath);
    set((s) => ({
      tabs: s.tabs.map((t) => (t.id === tabId ? { ...t, isDirty: false } : t)),
    }));
  },

  saveAllFiles: async () => {
    const { tabs } = get();
    const dirtyTabs = tabs.filter((t) => t.isDirty);
    for (const tab of dirtyTabs) {
      await get().saveFile(tab.id);
    }
  },

  setCursorPosition: (tabId, line, column) => {
    set((s) => ({
      tabs: s.tabs.map((t) =>
        t.id === tabId ? { ...t, cursorPosition: { line, column } } : t
      ),
    }));
  },

  setOpenFolder: async (path: string) => {
    set({ openFolder: path });
    // Run background project scan to detect frameworks for AI context
    detectProjectContext(path).then((ctx) => {
      useAIStore.getState().setProjectContext(ctx);
    });
  },

  applyAIChangeToTab: async (tabId, newContent, summary = "AI suggested update") => {
    const tab = get().tabs.find((t) => t.id === tabId);
    if (!tab) return false;
    if (tab.content === newContent) return false;

    await invoke("write_file", { path: tab.filePath, content: newContent });
    useAIStore.getState().markCodebaseChanged(tab.filePath);

    const entry: AIChangeEntry = {
      id: `ai-change-${Date.now()}`,
      filePath: tab.filePath,
      fileName: tab.fileName,
      previousContent: tab.content,
      newContent,
      existedBefore: true,
      summary,
      timestamp: Date.now(),
    };

    set((s) => ({
      aiChangeHistory: [entry, ...s.aiChangeHistory].slice(0, 100),
      tabs: s.tabs.map((t) =>
        t.id === tabId ? { ...t, content: newContent, isDirty: false } : t
      ),
    }));
    return true;
  },

  applyAIChangeToFile: async (filePath, newContent, summary = "AI suggested file update") => {
    const existingTab = get().tabs.find((t) => t.filePath === filePath);
    let previousContent = "";
    let existedBefore = true;

    if (existingTab) {
      previousContent = existingTab.content;
    } else {
      try {
        previousContent = await invoke<string>("read_file", { path: filePath });
      } catch {
        existedBefore = false;
      }
    }

    if (existedBefore && previousContent === newContent) return false;

    await invoke("write_file", { path: filePath, content: newContent });
    useAIStore.getState().markCodebaseChanged(filePath);

    if (!existingTab) {
      await get().openFile(filePath);
    }

    const fileName = filePath.split(/[\\/]/).pop() || filePath;
    const entry: AIChangeEntry = {
      id: `ai-change-${Date.now()}`,
      filePath,
      fileName,
      previousContent,
      newContent,
      existedBefore,
      summary,
      timestamp: Date.now(),
    };

    set((s) => ({
      aiChangeHistory: [entry, ...s.aiChangeHistory].slice(0, 100),
      tabs: s.tabs.map((t) =>
        t.filePath === filePath ? { ...t, content: newContent, isDirty: false } : t
      ),
    }));
    return true;
  },

  rollbackLastAIChange: async () => {
    const last = get().aiChangeHistory[0];
    if (!last) return false;

    if (last.existedBefore) {
      await invoke("write_file", { path: last.filePath, content: last.previousContent });
    } else {
      await invoke("delete_file", { path: last.filePath });
    }
    useAIStore.getState().markCodebaseChanged(last.filePath);

    set((s) => {
      const remainingTabs = last.existedBefore
        ? s.tabs.map((t) =>
          t.filePath === last.filePath ? { ...t, content: last.previousContent, isDirty: false } : t
        )
        : s.tabs.filter((t) => t.filePath !== last.filePath);
      const activeTabStillExists = remainingTabs.some((t) => t.id === s.activeTabId);
      return {
        aiChangeHistory: s.aiChangeHistory.slice(1),
        tabs: remainingTabs,
        activeTabId: activeTabStillExists ? s.activeTabId : (remainingTabs[0]?.id || null),
      };
    });
    return true;
  },
}));
