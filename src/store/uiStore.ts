// src/store/uiStore.ts
import { create } from "zustand";

type SidebarView = "explorer" | "search" | "search-replace" | "symbols" | "keybindings" | "git" | "extensions" | "ai" | "tasks";

interface UIStore {
  activeView: SidebarView;
  showTerminal: boolean;
  showAIPanel: boolean;
  showCommandPalette: boolean;
  showSettingsPanel: boolean;
  showQuickOpen: boolean;
  theme: "dark" | "light";
  fontSize: number;
  tabSize: number;
  wordWrap: boolean;
  minimapEnabled: boolean;
  formatOnSave: boolean;
  autoSave: boolean;

  setActiveView: (view: SidebarView) => void;
  toggleTerminal: () => void;
  toggleAIPanel: () => void;
  toggleCommandPalette: () => void;
  toggleSettingsPanel: () => void;
  toggleQuickOpen: () => void;
  setTheme: (theme: "dark" | "light") => void;
  setFontSize: (size: number) => void;
  setTabSize: (size: number) => void;
  setWordWrap: (enabled: boolean) => void;
  setMinimapEnabled: (enabled: boolean) => void;
  setFormatOnSave: (enabled: boolean) => void;
  setAutoSave: (enabled: boolean) => void;
}

export const useUIStore = create<UIStore>((set) => ({
  activeView: "explorer",
  showTerminal: false,
  showAIPanel: false,
  showCommandPalette: false,
  showSettingsPanel: false,
  showQuickOpen: false,
  theme: "dark",
  fontSize: 14,
  tabSize: 2,
  wordWrap: true,
  minimapEnabled: true,
  formatOnSave: true,
  autoSave: true,

  setActiveView: (view) => set({ activeView: view }),
  toggleTerminal: () => set((s) => ({ showTerminal: !s.showTerminal })),
  toggleAIPanel: () => set((s) => ({ showAIPanel: !s.showAIPanel })),
  toggleCommandPalette: () => set((s) => ({ showCommandPalette: !s.showCommandPalette })),
  toggleSettingsPanel: () => set((s) => ({ showSettingsPanel: !s.showSettingsPanel })),
  toggleQuickOpen: () => set((s) => ({ showQuickOpen: !s.showQuickOpen })),
  setTheme: (theme) => set({ theme }),
  setFontSize: (fontSize) => set({ fontSize }),
  setTabSize: (tabSize) => set({ tabSize }),
  setWordWrap: (wordWrap) => set({ wordWrap }),
  setMinimapEnabled: (minimapEnabled) => set({ minimapEnabled }),
  setFormatOnSave: (formatOnSave) => set({ formatOnSave }),
  setAutoSave: (autoSave) => set({ autoSave }),
}));
