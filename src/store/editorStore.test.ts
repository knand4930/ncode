import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const markCodebaseChanged = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

vi.mock("./aiStore", () => ({
  useAIStore: {
    getState: () => ({
      markCodebaseChanged,
    }),
  },
}));

import { invoke } from "@tauri-apps/api/core";
import { useEditorStore } from "./editorStore";

const invokeMock = vi.mocked(invoke);

function resetEditorState() {
  useEditorStore.setState({
    tabs: [],
    activeTabId: null,
    openFolder: null,
    recentFiles: [],
    aiChangeHistory: [],
    snapshots: [],
  });
}

describe("editorStore tracked history", () => {
  beforeEach(() => {
    resetEditorState();
    markCodebaseChanged.mockReset();
    invokeMock.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("records user saves in the tracked history with dependency links", async () => {
    const filePath = "/tmp/example.ts";

    useEditorStore.setState({
      tabs: [
        {
          id: "tab-1",
          filePath,
          fileName: "example.ts",
          content: "after",
          isDirty: true,
          language: "typescript",
          cursorPosition: { line: 1, column: 1 },
        },
      ],
      aiChangeHistory: [
        {
          id: "change-base",
          filePath,
          fileName: "example.ts",
          previousContent: "older",
          newContent: "before",
          existedBefore: true,
          summary: "AI edit",
          timestamp: 1,
          dependsOn: [],
          rolledBack: false,
          source: "ai",
        },
      ],
    });

    invokeMock.mockImplementation(async (cmd) => {
      if (cmd === "read_file") return "before";
      if (cmd === "write_file") return "";
      if (cmd === "delete_file") return "";
      throw new Error(`Unexpected invoke: ${String(cmd)}`);
    });

    await useEditorStore.getState().saveFile("tab-1");

    const history = useEditorStore.getState().aiChangeHistory;
    expect(history[0].source).toBe("user");
    expect(history[0].previousContent).toBe("before");
    expect(history[0].newContent).toBe("after");
    expect(history[0].dependsOn).toContain("change-base");
    expect(markCodebaseChanged).toHaveBeenCalledWith(filePath);
  });

  it("returns change ids and rolls back dependent AI changes together", async () => {
    const filePath = "/tmp/example.ts";

    useEditorStore.setState({
      tabs: [
        {
          id: "tab-1",
          filePath,
          fileName: "example.ts",
          content: "base-content",
          isDirty: false,
          language: "typescript",
          cursorPosition: { line: 1, column: 1 },
        },
      ],
      aiChangeHistory: [
        {
          id: "base-change",
          filePath,
          fileName: "example.ts",
          previousContent: "before-base",
          newContent: "base-content",
          existedBefore: true,
          summary: "Base AI change",
          timestamp: 1,
          dependsOn: [],
          rolledBack: false,
          source: "ai",
        },
      ],
    });

    invokeMock.mockImplementation(async (cmd) => {
      if (cmd === "write_file") return "";
      if (cmd === "delete_file") return "";
      if (cmd === "read_file") return "unused";
      throw new Error(`Unexpected invoke: ${String(cmd)}`);
    });

    const changeId = await useEditorStore
      .getState()
      .applyAIChangeToFile(filePath, "next-content", "Follow-up", ["task-dep"]);

    expect(changeId).toEqual(expect.any(String));
    const newest = useEditorStore.getState().aiChangeHistory[0];
    expect(newest.dependsOn).toEqual(expect.arrayContaining(["task-dep", "base-change"]));

    await useEditorStore.getState().rollbackChangeById("base-change");

    const state = useEditorStore.getState();
    expect(state.aiChangeHistory.find((e) => e.id === changeId)?.rolledBack).toBe(true);
    expect(state.aiChangeHistory.find((e) => e.id === "base-change")?.rolledBack).toBe(true);
    expect(state.tabs.find((t) => t.id === "tab-1")?.content).toBe("before-base");
  });
});
