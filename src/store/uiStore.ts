// src/store/uiStore.ts
import { create } from "zustand";
import { persist } from "zustand/middleware";

type SidebarView = "explorer" | "search" | "search-replace" | "symbols" | "keybindings" | "git" | "extensions" | "ai" | "tasks" | "review" | "code-graph";
export type ColorTheme = "dark" | "light" | "high-contrast" | "solarized-dark" | "monokai" | "github" | "dracula";
type IconTheme = "default" | "noto" | "simple";

export type EditorFont =
  | "JetBrains Mono"
  | "Fira Code"
  | "Cascadia Code"
  | "Source Code Pro"
  | "Inconsolata"
  | "Consolas, Courier New";

export type UiFont =
  | "Inter"
  | "Segoe UI, system-ui"
  | "-apple-system, SF Pro Display"
  | "Roboto";

export type ToastType = "info" | "success" | "warning" | "error";

export interface Toast {
  id: string;
  message: string;
  type: ToastType;
}

interface UIStore {
  activeView: SidebarView;
  showActivityBar: boolean;
  showSidebar: boolean;
  showStatusBar: boolean;
  showTerminal: boolean;
  showAIPanel: boolean;
  showCommandCenter: boolean;
  showCommandPalette: boolean;
  showSettingsPanel: boolean;
  showQuickOpen: boolean;
  theme: "dark" | "light";
  colorTheme: ColorTheme;
  iconTheme: IconTheme;
  editorFont: EditorFont;
  uiFont: UiFont;
  fontSize: number;
  tabSize: number;
  wordWrap: boolean;
  minimapEnabled: boolean;
  columnSelectionMode: boolean;
  multiCursorModifier: "alt" | "ctrlCmd";
  formatOnSave: boolean;
  autoSave: boolean;
  toasts: Toast[];

  setActiveView: (view: SidebarView) => void;
  toggleActivityBar: () => void;
  openView: (view: SidebarView) => void;
  toggleSidebar: () => void;
  toggleStatusBar: () => void;
  toggleTerminal: () => void;
  toggleAIPanel: () => void;
  toggleCommandCenter: () => void;
  toggleCommandPalette: () => void;
  toggleSettingsPanel: () => void;
  toggleQuickOpen: () => void;
  setTheme: (theme: "dark" | "light") => void;
  setColorTheme: (theme: ColorTheme) => void;
  setIconTheme: (theme: IconTheme) => void;
  setEditorFont: (font: EditorFont) => void;
  setUiFont: (font: UiFont) => void;
  setFontSize: (size: number) => void;
  setTabSize: (size: number) => void;
  setWordWrap: (enabled: boolean) => void;
  setMinimapEnabled: (enabled: boolean) => void;
  toggleColumnSelectionMode: () => void;
  toggleMultiCursorModifier: () => void;
  setFormatOnSave: (enabled: boolean) => void;
  setAutoSave: (enabled: boolean) => void;

  addToast: (message: string, type?: ToastType) => void;
  removeToast: (id: string) => void;
}

export const useUIStore = create<UIStore>()(
  persist(
    (set) => ({
      activeView: "explorer",
      showActivityBar: true,
      showSidebar: true,
      showStatusBar: true,
      showTerminal: false,
      showAIPanel: false,
      showCommandCenter: true,
      showCommandPalette: false,
      showSettingsPanel: false,
      showQuickOpen: false,
      theme: "dark",
      colorTheme: "dark",
      iconTheme: "default",
      editorFont: "JetBrains Mono",
      uiFont: "Inter",
      fontSize: 14,
      tabSize: 2,
      wordWrap: true,
      minimapEnabled: true,
      columnSelectionMode: false,
      multiCursorModifier: "alt",
      formatOnSave: true,
      autoSave: true,
      toasts: [],

      setActiveView: (view) => set({ activeView: view }),
      toggleActivityBar: () => set((s) => ({ showActivityBar: !s.showActivityBar })),
      openView: (view) => set({ activeView: view, showSidebar: true }),
      toggleSidebar: () => set((s) => ({ showSidebar: !s.showSidebar })),
      toggleStatusBar: () => set((s) => ({ showStatusBar: !s.showStatusBar })),
      toggleTerminal: () => set((s) => ({ showTerminal: !s.showTerminal })),
      toggleAIPanel: () => set((s) => ({ showAIPanel: !s.showAIPanel })),
      toggleCommandCenter: () => set((s) => ({ showCommandCenter: !s.showCommandCenter })),
      toggleCommandPalette: () => set((s) => ({ showCommandPalette: !s.showCommandPalette })),
      toggleSettingsPanel: () => set((s) => ({ showSettingsPanel: !s.showSettingsPanel })),
      toggleQuickOpen: () => set((s) => ({ showQuickOpen: !s.showQuickOpen })),
      setTheme: (theme) => set({ theme }),
      setColorTheme: (colorTheme) => set({ colorTheme }),
      setIconTheme: (iconTheme) => set({ iconTheme }),
      setEditorFont: (font) => set({ editorFont: font }),
      setUiFont: (font) => set({ uiFont: font }),
      setFontSize: (fontSize) => set({ fontSize }),
      setTabSize: (tabSize) => set({ tabSize }),
      setWordWrap: (wordWrap) => set({ wordWrap }),
      setMinimapEnabled: (minimapEnabled) => set({ minimapEnabled }),
      toggleColumnSelectionMode: () => set((s) => ({ columnSelectionMode: !s.columnSelectionMode })),
      toggleMultiCursorModifier: () =>
        set((s) => ({ multiCursorModifier: s.multiCursorModifier === "alt" ? "ctrlCmd" : "alt" })),
      setFormatOnSave: (formatOnSave) => set({ formatOnSave }),
      setAutoSave: (autoSave) => set({ autoSave }),

      addToast: (message, type = "info") => {
        const id = Math.random().toString(36).substring(2, 9);
        set((state) => ({ toasts: [...state.toasts, { id, message, type }] }));
      },
      removeToast: (id) => set((state) => ({ toasts: state.toasts.filter(t => t.id !== id) })),
    }),
    {
      name: "ncode-ui-store",
      partialize: (state) => ({
        colorTheme: state.colorTheme,
        editorFont: state.editorFont,
        uiFont: state.uiFont,
        fontSize: state.fontSize,
        tabSize: state.tabSize,
        wordWrap: state.wordWrap,
        minimapEnabled: state.minimapEnabled,
        formatOnSave: state.formatOnSave,
        autoSave: state.autoSave,
      }),
    }
  )
);
