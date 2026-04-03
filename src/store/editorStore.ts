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

// ── Full change history entry ─────────────────────────────────────────────────

export type ChangeSource = "ai" | "user";

export interface AIChangeEntry {
  id: string;
  filePath: string;
  fileName: string;
  previousContent: string;
  newContent: string;
  existedBefore: boolean;
  summary: string;
  timestamp: number;
  /** IDs of other entries this change depends on (applied before this one) */
  dependsOn: string[];
  /** Whether this entry has been rolled back */
  rolledBack: boolean;
  /** What produced this change */
  source: ChangeSource;
}

export interface ChangeSnapshot {
  /** Map of filePath → content at this point in time */
  files: Record<string, string>;
  timestamp: number;
  label: string;
  rootPath: string | null;
}

interface EditorStore {
  tabs: EditorTab[];
  activeTabId: string | null;
  openFolder: string | null;
  recentFiles: string[];
  /** Full ordered history — newest first */
  aiChangeHistory: AIChangeEntry[];
  /** Named snapshots for full project-level restore */
  snapshots: ChangeSnapshot[];

  createUntitledTab: () => string;
  openFile: (filePath: string) => Promise<string | null>;
  openFileAt: (filePath: string, line: number, column?: number) => Promise<void>;
  closeTab: (tabId: string) => void;
  closeAllTabs: () => void;
  setActiveTab: (tabId: string) => void;
  updateContent: (tabId: string, content: string) => void;
  saveFile: (tabId: string) => Promise<void>;
  saveFileAs: (tabId: string, newPath: string) => Promise<void>;
  saveAllFiles: () => Promise<void>;
  revertFile: (tabId: string) => Promise<void>;
  setCursorPosition: (tabId: string, line: number, column: number) => void;
  setOpenFolder: (path: string | null) => void;

  // ── Change application ──────────────────────────────────────────────────
  applyAIChangeToTab: (tabId: string, newContent: string, summary?: string, dependsOn?: string[]) => Promise<string | null>;
  applyAIChangeToFile: (filePath: string, newContent: string, summary?: string, dependsOn?: string[]) => Promise<string | null>;

  // ── Rollback ────────────────────────────────────────────────────────────
  /** Roll back the single most recent change */
  rollbackLastAIChange: () => Promise<boolean>;
  /** Roll back a specific change by ID (and all changes that depend on it) */
  rollbackChangeById: (changeId: string) => Promise<boolean>;
  /** Roll back ALL changes since a given timestamp */
  rollbackToTimestamp: (timestamp: number) => Promise<boolean>;
  /** Roll back ALL AI changes — restore every file to its pre-AI state */
  rollbackAllAIChanges: () => Promise<void>;
  /** Restore a named snapshot */
  restoreSnapshot: (snapshot: ChangeSnapshot) => Promise<void>;
  /** Take a named snapshot of all open files */
  takeSnapshot: (label: string) => Promise<void>;

  reorderTabs: (startIndex: number, endIndex: number) => void;
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

// ── Helper: collect all change IDs that depend (transitively) on a given ID ──

function collectDependents(changeId: string, history: AIChangeEntry[]): Set<string> {
  const result = new Set<string>();
  const queue = [changeId];
  while (queue.length > 0) {
    const id = queue.shift()!;
    for (const entry of history) {
      if (entry.dependsOn.includes(id) && !result.has(entry.id)) {
        result.add(entry.id);
        queue.push(entry.id);
      }
    }
  }
  return result;
}

function latestActiveEntryForFile(history: AIChangeEntry[], filePath: string): AIChangeEntry | undefined {
  return history.find((entry) => entry.filePath === filePath && !entry.rolledBack);
}

function createHistoryEntry(
  history: AIChangeEntry[],
  filePath: string,
  fileName: string,
  previousContent: string,
  newContent: string,
  existedBefore: boolean,
  summary: string,
  source: ChangeSource,
  dependsOn: string[] = []
): AIChangeEntry {
  const dependencySet = new Set(dependsOn.filter(Boolean));
  const latest = latestActiveEntryForFile(history, filePath);
  if (latest) dependencySet.add(latest.id);

  return {
    id: `change-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    filePath,
    fileName,
    previousContent,
    newContent,
    existedBefore,
    summary,
    timestamp: Date.now(),
    dependsOn: Array.from(dependencySet),
    rolledBack: false,
    source,
  };
}

async function readFileState(filePath: string): Promise<{ content: string; existedBefore: boolean }> {
  try {
    return { content: await invoke<string>("read_file", { path: filePath }), existedBefore: true };
  } catch {
    return { content: "", existedBefore: false };
  }
}

interface DirEntry {
  name: string;
  path: string;
  is_dir: boolean;
  children?: DirEntry[];
}

function flattenFileEntries(entries: DirEntry[]): string[] {
  const files: string[] = [];
  const walk = (items: DirEntry[]) => {
    for (const entry of items) {
      if (entry.is_dir) {
        walk(entry.children ?? []);
      } else {
        files.push(entry.path);
      }
    }
  };
  walk(entries);
  return files;
}

async function readWorkspaceFiles(rootPath: string): Promise<Record<string, string>> {
  const files: Record<string, string> = {};
  const entries = await invoke<DirEntry[]>("read_dir_recursive", { path: rootPath, depth: 32 });
  const filePaths = flattenFileEntries(entries);
  for (const filePath of filePaths) {
    try {
      files[filePath] = await invoke<string>("read_file", { path: filePath });
    } catch {
      // Ignore transient read issues so snapshot/restore can continue.
    }
  }
  return files;
}

// ── Helper: apply a file write + update tabs ──────────────────────────────────

async function writeAndUpdateTab(
  filePath: string,
  content: string,
  existed: boolean,
  tabs: EditorTab[],
  set: (fn: (s: { tabs: EditorTab[]; activeTabId: string | null }) => Partial<{ tabs: EditorTab[]; activeTabId: string | null }>) => void,
  openFileFn: (path: string) => Promise<string | null>
) {
  if (existed) {
    await invoke("write_file", { path: filePath, content });
    set((s) => ({
      tabs: s.tabs.map((t) =>
        t.filePath === filePath ? { ...t, content, isDirty: false } : t
      ),
    }));
  } else {
    // File didn't exist before — delete it
    try { await invoke("delete_file", { path: filePath }); } catch { /* already gone */ }
    set((s) => {
      const remaining = s.tabs.filter((t) => t.filePath !== filePath);
      const activeStillExists = remaining.some((t) => t.id === s.activeTabId);
      return {
        tabs: remaining,
        activeTabId: activeStillExists ? s.activeTabId : (remaining[0]?.id ?? null),
      };
    });
  }
  useAIStore.getState().markCodebaseChanged(filePath);
}

export const useEditorStore = create<EditorStore>((set, get) => ({
  tabs: [],
  activeTabId: null,
  openFolder: null,
  recentFiles: [],
  aiChangeHistory: [],
  snapshots: [],

  // ── Tab management ────────────────────────────────────────────────────────

  createUntitledTab: () => {
    const untitledTabs = get().tabs.filter((tab) => tab.filePath.startsWith("untitled:"));
    const existingNames = new Set(untitledTabs.map((tab) => tab.fileName));
    let index = 1;
    let fileName = `Untitled-${index}`;
    while (existingNames.has(fileName)) { index += 1; fileName = `Untitled-${index}`; }
    const tab: EditorTab = {
      id: `tab-${Date.now()}`, filePath: `untitled:${fileName}`, fileName,
      content: "", isDirty: false, language: "plaintext",
      cursorPosition: { line: 1, column: 1 },
    };
    set((state) => ({ tabs: [...state.tabs, tab], activeTabId: tab.id }));
    return tab.id;
  },

  openFile: async (filePath: string) => {
    const { tabs } = get();
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
        id: `tab-${Date.now()}`, filePath, fileName, content,
        isDirty: false, language: detectLanguage(filePath),
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
          ? { ...t, cursorPosition: { line: Math.max(1, line), column: Math.max(1, column) } }
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

  closeAllTabs: () => set({ tabs: [], activeTabId: null }),
  setActiveTab: (tabId: string) => set({ activeTabId: tabId }),

  updateContent: (tabId: string, content: string) => {
    set((s) => ({
      tabs: s.tabs.map((t) => t.id === tabId ? { ...t, content, isDirty: true } : t),
    }));
  },

  saveFile: async (tabId: string) => {
    const tab = get().tabs.find((t) => t.id === tabId);
    if (!tab || tab.filePath.startsWith("untitled:")) return;
    const disk = await readFileState(tab.filePath);
    if (disk.existedBefore && disk.content === tab.content) {
      set((s) => ({ tabs: s.tabs.map((t) => t.id === tabId ? { ...t, isDirty: false } : t) }));
      return;
    }

    await invoke("write_file", { path: tab.filePath, content: tab.content });
    useAIStore.getState().markCodebaseChanged(tab.filePath);
    const entry = createHistoryEntry(
      get().aiChangeHistory,
      tab.filePath,
      tab.fileName,
      disk.content,
      tab.content,
      disk.existedBefore,
      "User saved file",
      "user"
    );
    set((s) => ({
      aiChangeHistory: [entry, ...s.aiChangeHistory],
      tabs: s.tabs.map((t) => t.id === tabId ? { ...t, isDirty: false } : t),
    }));
  },

  saveFileAs: async (tabId: string, newPath: string) => {
    const tab = get().tabs.find((t) => t.id === tabId);
    if (!tab) return;
    const fileName = newPath.split(/[\\/]/).pop() || newPath;
    const disk = await readFileState(newPath);
    const pathChanged = tab.filePath !== newPath;
    const shouldRecord = pathChanged || !disk.existedBefore || disk.content !== tab.content;

    await invoke("write_file", { path: newPath, content: tab.content });
    useAIStore.getState().markCodebaseChanged(newPath);

    if (shouldRecord) {
      const entry = createHistoryEntry(
        get().aiChangeHistory,
        newPath,
        fileName,
        disk.content,
        tab.content,
        disk.existedBefore,
        pathChanged ? `User saved as ${fileName}` : "User saved file",
        "user"
      );
      set((s) => ({
        aiChangeHistory: [entry, ...s.aiChangeHistory],
        recentFiles: [newPath, ...s.recentFiles.filter((p) => p !== newPath)].slice(0, 50),
        tabs: s.tabs.map((t) =>
          t.id === tabId ? { ...t, filePath: newPath, fileName, language: detectLanguage(newPath), isDirty: false } : t
        ),
      }));
      return;
    }

    set((s) => ({
      recentFiles: [newPath, ...s.recentFiles.filter((p) => p !== newPath)].slice(0, 50),
      tabs: s.tabs.map((t) =>
        t.id === tabId ? { ...t, filePath: newPath, fileName, language: detectLanguage(newPath), isDirty: false } : t
      ),
    }));
  },

  saveAllFiles: async () => {
    const { tabs } = get();
    for (const tab of tabs.filter((t) => t.isDirty)) {
      await get().saveFile(tab.id);
    }
  },

  revertFile: async (tabId: string) => {
    const tab = get().tabs.find((t) => t.id === tabId);
    if (!tab || tab.filePath.startsWith("untitled:")) return;
    const content = await invoke<string>("read_file", { path: tab.filePath });
    set((s) => ({
      tabs: s.tabs.map((t) => t.id === tabId ? { ...t, content, isDirty: false } : t),
    }));
  },

  setCursorPosition: (tabId, line, column) => {
    set((s) => ({
      tabs: s.tabs.map((t) => t.id === tabId ? { ...t, cursorPosition: { line, column } } : t),
    }));
  },

  setOpenFolder: async (path: string | null) => {
    set({ openFolder: path });
    if (!path) { useAIStore.getState().setOpenFolder(null); return; }
    detectProjectContext(path).then((ctx) => { useAIStore.getState().setProjectContext(ctx); });
  },

  // ── Change application ────────────────────────────────────────────────────

  applyAIChangeToTab: async (tabId, newContent, summary = "AI suggested update", dependsOn = []) => {
    const tab = get().tabs.find((t) => t.id === tabId);
    if (!tab || tab.content === newContent) return null;
    await invoke("write_file", { path: tab.filePath, content: newContent });
    useAIStore.getState().markCodebaseChanged(tab.filePath);
    const entry = createHistoryEntry(
      get().aiChangeHistory,
      tab.filePath,
      tab.fileName,
      tab.content,
      newContent,
      true,
      summary,
      "ai",
      dependsOn
    );
    set((s) => ({
      aiChangeHistory: [entry, ...s.aiChangeHistory],
      tabs: s.tabs.map((t) => t.id === tabId ? { ...t, content: newContent, isDirty: false } : t),
    }));
    return entry.id;
  },

  applyAIChangeToFile: async (filePath, newContent, summary = "AI suggested file update", dependsOn = []) => {
    const existingTab = get().tabs.find((t) => t.filePath === filePath);
    let previousContent = "";
    let existedBefore = true;
    if (existingTab) {
      previousContent = existingTab.content;
    } else {
      const disk = await readFileState(filePath);
      previousContent = disk.content;
      existedBefore = disk.existedBefore;
    }
    if (existedBefore && previousContent === newContent) return null;
    await invoke("write_file", { path: filePath, content: newContent });
    useAIStore.getState().markCodebaseChanged(filePath);
    if (!existingTab) await get().openFile(filePath);
    const fileName = filePath.split(/[\\/]/).pop() || filePath;
    const entry = createHistoryEntry(
      get().aiChangeHistory,
      filePath,
      fileName,
      previousContent,
      newContent,
      existedBefore,
      summary,
      "ai",
      dependsOn
    );
    set((s) => ({
      aiChangeHistory: [entry, ...s.aiChangeHistory],
      tabs: s.tabs.map((t) =>
        t.filePath === filePath ? { ...t, content: newContent, isDirty: false } : t
      ),
    }));
    return entry.id;
  },

  // ── Rollback: single most recent tracked change ───────────────────────────

  rollbackLastAIChange: async () => {
    const { aiChangeHistory } = get();
    const last = aiChangeHistory.find((e) => !e.rolledBack);
    if (!last) return false;
    await writeAndUpdateTab(last.filePath, last.previousContent, last.existedBefore, get().tabs, set as any, get().openFile);
    set((s) => ({
      aiChangeHistory: s.aiChangeHistory.map((e) =>
        e.id === last.id ? { ...e, rolledBack: true } : e
      ),
    }));
    return true;
  },

  // ── Rollback: specific change + all dependents ────────────────────────────

  rollbackChangeById: async (changeId: string) => {
    const { aiChangeHistory } = get();
    const target = aiChangeHistory.find((e) => e.id === changeId);
    if (!target || target.rolledBack) return false;

    // Collect all changes that depend on this one (transitively)
    const dependentIds = collectDependents(changeId, aiChangeHistory);
    const toRollback = [changeId, ...Array.from(dependentIds)];

    // Sort by timestamp descending (roll back newest first)
    const entries = aiChangeHistory
      .filter((e) => toRollback.includes(e.id) && !e.rolledBack)
      .sort((a, b) => b.timestamp - a.timestamp);

    for (const entry of entries) {
      await writeAndUpdateTab(entry.filePath, entry.previousContent, entry.existedBefore, get().tabs, set as any, get().openFile);
    }

    set((s) => ({
      aiChangeHistory: s.aiChangeHistory.map((e) =>
        toRollback.includes(e.id) ? { ...e, rolledBack: true } : e
      ),
    }));
    return true;
  },

  // ── Rollback: all changes since a timestamp ───────────────────────────────

  rollbackToTimestamp: async (timestamp: number) => {
    const { aiChangeHistory } = get();
    // All non-rolled-back entries newer than the timestamp
    const toRollback = aiChangeHistory
      .filter((e) => !e.rolledBack && e.timestamp > timestamp)
      .sort((a, b) => b.timestamp - a.timestamp); // newest first

    if (toRollback.length === 0) return false;

    // For each affected file, find the state it should be in at `timestamp`
    const affectedFiles = new Set(toRollback.map((e) => e.filePath));

    for (const filePath of affectedFiles) {
      // Find the most recent entry for this file AT OR BEFORE the timestamp
      const stateAtTime = aiChangeHistory
        .filter((e) => e.filePath === filePath && e.timestamp <= timestamp && !e.rolledBack)
        .sort((a, b) => b.timestamp - a.timestamp)[0];

      if (stateAtTime) {
        // Restore to the newContent of that entry (the state after that change)
        await invoke("write_file", { path: filePath, content: stateAtTime.newContent });
        useAIStore.getState().markCodebaseChanged(filePath);
        set((s) => ({
          tabs: s.tabs.map((t) =>
            t.filePath === filePath ? { ...t, content: stateAtTime.newContent, isDirty: false } : t
          ),
        }));
      } else {
        // No entry at or before timestamp — file didn't exist, delete it
        const firstEntry = aiChangeHistory
          .filter((e) => e.filePath === filePath)
          .sort((a, b) => a.timestamp - b.timestamp)[0];
        if (firstEntry && !firstEntry.existedBefore) {
          try { await invoke("delete_file", { path: filePath }); } catch { /* ok */ }
          useAIStore.getState().markCodebaseChanged(filePath);
          set((s) => {
            const remaining = s.tabs.filter((t) => t.filePath !== filePath);
            return {
              tabs: remaining,
              activeTabId: remaining.some((t) => t.id === s.activeTabId) ? s.activeTabId : (remaining[0]?.id ?? null),
            };
          });
        }
      }
    }

    set((s) => ({
      aiChangeHistory: s.aiChangeHistory.map((e) =>
        toRollback.some((r) => r.id === e.id) ? { ...e, rolledBack: true } : e
      ),
    }));
    return true;
  },

  // ── Rollback: ALL tracked changes ──────────────────────────────────────────

  rollbackAllAIChanges: async () => {
    const { aiChangeHistory } = get();
    const active = aiChangeHistory.filter((e) => !e.rolledBack);
    if (active.length === 0) return;

    // Group by file, find the original state (earliest previousContent)
    const fileOriginals = new Map<string, { content: string; existedBefore: boolean }>();
    for (const entry of active.sort((a, b) => a.timestamp - b.timestamp)) {
      if (!fileOriginals.has(entry.filePath)) {
        fileOriginals.set(entry.filePath, {
          content: entry.previousContent,
          existedBefore: entry.existedBefore,
        });
      }
    }

    for (const [filePath, { content, existedBefore }] of fileOriginals) {
      await writeAndUpdateTab(filePath, content, existedBefore, get().tabs, set as any, get().openFile);
    }

    set((s) => ({
      aiChangeHistory: s.aiChangeHistory.map((e) => ({ ...e, rolledBack: true })),
    }));
  },

  // ── Snapshots ─────────────────────────────────────────────────────────────

  takeSnapshot: async (label: string) => {
    const { tabs, openFolder } = get();
    let files: Record<string, string> = {};

    if (openFolder) {
      try {
        files = await readWorkspaceFiles(openFolder);
      } catch (error) {
        console.error("Failed to capture full workspace snapshot:", error);
      }
    }

    if (!openFolder || Object.keys(files).length === 0) {
      files = {};
      for (const tab of tabs) {
        if (!tab.filePath.startsWith("untitled:")) {
          files[tab.filePath] = tab.content;
        }
      }
    }

    const snapshot: ChangeSnapshot = { files, timestamp: Date.now(), label, rootPath: openFolder };
    set((s) => ({ snapshots: [snapshot, ...s.snapshots] }));
  },

  restoreSnapshot: async (snapshot: ChangeSnapshot) => {
    const rootPath = snapshot.rootPath ?? get().openFolder;

    if (rootPath) {
      try {
        const currentFiles = Object.keys(await readWorkspaceFiles(rootPath));
        const snapshotFiles = new Set(Object.keys(snapshot.files));
        const toDelete = currentFiles.filter((filePath) => !snapshotFiles.has(filePath));

        for (const filePath of toDelete) {
          try {
            await invoke("delete_file", { path: filePath });
            useAIStore.getState().markCodebaseChanged(filePath);
          } catch {
            // Ignore delete failures to continue best-effort restore.
          }
        }

        if (toDelete.length > 0) {
          set((s) => {
            const remaining = s.tabs.filter((tab) => !toDelete.includes(tab.filePath));
            return {
              tabs: remaining,
              activeTabId: remaining.some((tab) => tab.id === s.activeTabId) ? s.activeTabId : (remaining[0]?.id ?? null),
            };
          });
        }
      } catch (error) {
        console.error("Failed to prepare snapshot restore cleanup:", error);
      }
    }

    for (const [filePath, content] of Object.entries(snapshot.files)) {
      await invoke("write_file", { path: filePath, content });
      useAIStore.getState().markCodebaseChanged(filePath);
      const existingTab = get().tabs.find((t) => t.filePath === filePath);
      if (existingTab) {
        set((s) => ({
          tabs: s.tabs.map((t) =>
            t.filePath === filePath ? { ...t, content, isDirty: false } : t
          ),
        }));
      }
    }
  },

  reorderTabs: (startIndex: number, endIndex: number) => {
    set((s) => {
      const result = Array.from(s.tabs);
      const [removed] = result.splice(startIndex, 1);
      result.splice(endIndex, 0, removed);
      return { tabs: result };
    });
  },
}));
