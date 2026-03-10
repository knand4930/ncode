import { create } from "zustand";

type TerminalCommandPayload = {
  command: string;
  timestamp: number;
};

interface TerminalStore {
  queuedCommand: TerminalCommandPayload | null;
  runCommandInTerminal: (command: string) => void;
  clearQueuedCommand: () => void;
}

export const useTerminalStore = create<TerminalStore>((set) => ({
  queuedCommand: null,
  runCommandInTerminal: (command: string) => {
    set({ queuedCommand: { command, timestamp: Date.now() } });
  },
  clearQueuedCommand: () => {
    set({ queuedCommand: null });
  },
}));
