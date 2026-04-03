import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let showTerminal = true;
const toggleTerminal = vi.fn(() => {
  showTerminal = true;
});

vi.mock("./uiStore", () => ({
  useUIStore: {
    getState: () => ({
      showTerminal,
      toggleTerminal,
    }),
  },
}));

import { useTerminalStore } from "./terminalStore";

describe("terminalStore show helpers", () => {
  beforeEach(() => {
    showTerminal = true;
    toggleTerminal.mockReset();
    useTerminalStore.setState({
      queuedCommand: null,
      newTerminalRequest: 0,
      splitTerminalRequest: 0,
      clearTerminalRequest: 0,
      closeActiveTerminalRequest: 0,
      lastErrors: [],
      panelTab: "output",
      commandRunStates: {},
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("switches back to the terminal tab when a command is shown", async () => {
    useTerminalStore.getState().showAndRunCommand("echo hello");

    expect(useTerminalStore.getState().panelTab).toBe("terminal");
    expect(useTerminalStore.getState().queuedCommand?.command).toBe("echo hello");
    expect(toggleTerminal).not.toHaveBeenCalled();
  });

  it("can open the run tab with a tracked AI command", async () => {
    useTerminalStore.getState().showAndTrackCommand("npm run lint", {
      source: "ai",
      analyzeWithAI: true,
      requestKey: "msg-1-c0",
    });

    expect(useTerminalStore.getState().panelTab).toBe("run");
    expect(useTerminalStore.getState().queuedCommand).toMatchObject({
      command: "npm run lint",
      tracked: true,
      source: "ai",
      analyzeWithAI: true,
      requestKey: "msg-1-c0",
    });
    expect(useTerminalStore.getState().commandRunStates["msg-1-c0"]).toMatchObject({
      requestKey: "msg-1-c0",
      command: "npm run lint",
      source: "ai",
      analyzeWithAI: true,
      status: "queued",
      exitCode: null,
    });
    expect(toggleTerminal).not.toHaveBeenCalled();
  });

  it("can switch the visible panel tab without queuing a command", async () => {
    useTerminalStore.getState().showTerminalTab("output");

    expect(useTerminalStore.getState().panelTab).toBe("output");
    expect(toggleTerminal).not.toHaveBeenCalled();
  });
});
