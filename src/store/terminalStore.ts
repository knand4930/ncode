import { create } from "zustand";
import type { DetectedError } from "../utils/errorParser";

type TerminalCommandPayload = {
  command: string;
  timestamp: number;
};

interface TerminalStore {
  queuedCommand: TerminalCommandPayload | null;
  newTerminalRequest: number;
  splitTerminalRequest: number;
  clearTerminalRequest: number;
  closeActiveTerminalRequest: number;
  lastErrors: DetectedError[];
  runCommandInTerminal: (command: string) => void;
  requestNewTerminal: () => void;
  requestSplitTerminal: () => void;
  requestClearTerminal: () => void;
  requestCloseActiveTerminal: () => void;
  clearQueuedCommand: () => void;
  setLastErrors: (errors: DetectedError[]) => void;
  clearLastErrors: () => void;
}

export const useTerminalStore = create<TerminalStore>((set) => ({
  queuedCommand: null,
  newTerminalRequest: 0,
  splitTerminalRequest: 0,
  clearTerminalRequest: 0,
  closeActiveTerminalRequest: 0,
  lastErrors: [],
  runCommandInTerminal: (command: string) => {
    set({ queuedCommand: { command, timestamp: Date.now() } });
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
}));
