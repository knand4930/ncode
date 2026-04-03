import { create } from "zustand";
import type { DetectedError } from "../utils/errorParser";
import { useUIStore } from "./uiStore";

type TerminalCommandPayload = {
  command: string;
  timestamp: number;
  tracked?: boolean;
  source?: "manual" | "ai";
  analyzeWithAI?: boolean;
  requestKey?: string;
};

export type TerminalPanelTab = "terminal" | "problems" | "run" | "output";
export type CommandRunStatus = "queued" | "running" | "success" | "error" | "stopped";

export interface CommandRunState {
  requestKey: string;
  runId?: string;
  command: string;
  source: "manual" | "ai";
  analyzeWithAI: boolean;
  status: CommandRunStatus;
  exitCode: number | null;
  updatedAt: number;
}

interface TerminalStore {
  queuedCommand: TerminalCommandPayload | null;
  newTerminalRequest: number;
  splitTerminalRequest: number;
  clearTerminalRequest: number;
  closeActiveTerminalRequest: number;
  lastErrors: DetectedError[];
  panelTab: TerminalPanelTab;
  commandRunStates: Record<string, CommandRunState>;

  /** Queue a command to run in the active terminal session */
  runCommandInTerminal: (command: string) => void;
  /**
   * Ensure the terminal is visible and run a command.
   * Adds a small delay so the panel has time to expand before the command fires.
   */
  showAndRunCommand: (command: string) => void;
  /**
   * Ensure the terminal is visible, switch to the Run tab, and execute a tracked command.
   * Tracked commands stream output into the Run panel and can optionally be reviewed by AI.
   */
  showAndTrackCommand: (
    command: string,
    options?: {
      source?: "manual" | "ai";
      analyzeWithAI?: boolean;
      requestKey?: string;
    }
  ) => void;
  /** Ensure the terminal pane is visible and switch to a specific tab. */
  showTerminalTab: (tab?: TerminalPanelTab) => void;
  requestNewTerminal: () => void;
  requestSplitTerminal: () => void;
  requestClearTerminal: () => void;
  requestCloseActiveTerminal: () => void;
  clearQueuedCommand: () => void;
  setLastErrors: (errors: DetectedError[]) => void;
  clearLastErrors: () => void;
  setPanelTab: (tab: TerminalPanelTab) => void;
  setCommandRunState: (requestKey: string, state: Omit<CommandRunState, "requestKey" | "updatedAt">) => void;
  clearCommandRunState: (requestKey: string) => void;
}

export const useTerminalStore = create<TerminalStore>((set, get) => ({
  queuedCommand: null,
  newTerminalRequest: 0,
  splitTerminalRequest: 0,
  clearTerminalRequest: 0,
  closeActiveTerminalRequest: 0,
  lastErrors: [],
  panelTab: "terminal",
  commandRunStates: {},

  runCommandInTerminal: (command: string) => {
    set({ queuedCommand: { command, timestamp: Date.now() } });
  },

  showAndRunCommand: (command: string) => {
    const { showTerminal, toggleTerminal } = useUIStore.getState();
    set({ panelTab: "terminal" });
    if (!showTerminal) {
      toggleTerminal();
      // Wait for the panel animation to complete before queuing the command
      setTimeout(() => {
        set({ queuedCommand: { command, timestamp: Date.now() } });
      }, 350);
    } else {
      set({ queuedCommand: { command, timestamp: Date.now() } });
    }
  },

  showAndTrackCommand: (command: string, options = {}) => {
    const payload: TerminalCommandPayload = {
      command,
      timestamp: Date.now(),
      tracked: true,
      source: options.source ?? "manual",
      analyzeWithAI: options.analyzeWithAI ?? false,
      requestKey: options.requestKey,
    };
    if (options.requestKey) {
      get().setCommandRunState(options.requestKey, {
        command,
        source: options.source ?? "manual",
        analyzeWithAI: options.analyzeWithAI ?? false,
        status: "queued",
        exitCode: null,
      });
    }
    const { showTerminal, toggleTerminal } = useUIStore.getState();
    set({ panelTab: "run" });
    if (!showTerminal) {
      toggleTerminal();
      setTimeout(() => {
        set({ queuedCommand: payload });
      }, 350);
    } else {
      set({ queuedCommand: payload });
    }
  },

  showTerminalTab: (tab: TerminalPanelTab = "terminal") => {
    set({ panelTab: tab });
    const { showTerminal, toggleTerminal } = useUIStore.getState();
    if (!showTerminal) {
      toggleTerminal();
    }
  },

  requestNewTerminal: () => {
    set((state) => ({ newTerminalRequest: state.newTerminalRequest + 1 }));
  },
  requestSplitTerminal: () => {
    set((state) => ({ splitTerminalRequest: state.splitTerminalRequest + 1 }));
  },
  requestClearTerminal: () => {
    set((state) => ({ clearTerminalRequest: state.clearTerminalRequest + 1 }));
  },
  requestCloseActiveTerminal: () => {
    set((state) => ({ closeActiveTerminalRequest: state.closeActiveTerminalRequest + 1 }));
  },
  clearQueuedCommand: () => {
    set({ queuedCommand: null });
  },
  setLastErrors: (errors) => set({ lastErrors: errors }),
  clearLastErrors: () => set({ lastErrors: [] }),
  setPanelTab: (tab) => set({ panelTab: tab }),
  setCommandRunState: (requestKey, state) =>
    set((current) => ({
      commandRunStates: {
        ...current.commandRunStates,
        [requestKey]: {
          requestKey,
          ...state,
          updatedAt: Date.now(),
        },
      },
    })),
  clearCommandRunState: (requestKey) =>
    set((current) => {
      const next = { ...current.commandRunStates };
      delete next[requestKey];
      return { commandRunStates: next };
    }),
}));
