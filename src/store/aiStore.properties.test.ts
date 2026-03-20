import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fc from "fast-check";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockResolvedValue(() => {}),
}));

import { invoke } from "@tauri-apps/api/core";

import {
  createInlineCompletionDebouncer,
  INLINE_COMPLETION_DEBOUNCE_MS,
  estimateMessagesTokenCount,
  estimateTokenCount,
  shouldTriggerContextSummarization,
  serializeSessions,
  deserializeSessions,
  useAIStore,
  type ChatMessage,
  type ChatSession,
  type AgentFileChange,
} from "./aiStore";
import { parseThinkingBlock } from "../utils/parseThinkingBlock";
import {
  MAX_PROMPT_TEMPLATE_CHARS,
  validatePromptTemplateContent,
} from "../utils/promptTemplateValidation";

const invokeMock = vi.mocked(invoke);

function resetStoreState() {
  useAIStore.setState({
    chatHistory: [],
    isThinking: false,
    isStreaming: false,
    streamingMessageId: null,
    selectedProvider: "ollama",
    aiServiceMode: "direct",
    selectedOllamaModels: ["test-model"],
    availableModels: ["test-model"],
    selectedApiKeyIndices: [],
    apiKeys: [],
    useRAG: false,
    aiMode: "chat",
    openFolder: null,
    sessions: [],
    activeSessionId: null,
    mentionedFiles: [],
    aiChangeHistory: [],
    agentEvents: [],
    agentLiveOutput: "",
    abortController: null,
    indexDirty: false,
    indexedChunks: 0,
    isIndexing: false,
  });
}

function safeTokenArb() {
  return fc
    .string({ minLength: 0, maxLength: 8 })
    .filter((s) => !s.includes("<thinking>") && !s.includes("</thinking>"));
}

const chatRoleArb = fc.constantFrom<ChatMessage["role"]>("user", "assistant", "system");
const aiModeArb = fc.constantFrom<NonNullable<ChatMessage["mode"]>>(
  "chat",
  "think",
  "agent",
  "bug_hunt",
  "architect"
);
const providerArb = fc.constantFrom<NonNullable<ChatMessage["provider"]>>(
  "ollama",
  "openai",
  "anthropic",
  "groq",
  "airllm",
  "vllm"
);

const fullChatMessageArb: fc.Arbitrary<ChatMessage> = fc.record({
  id: fc.string({ minLength: 1, maxLength: 24 }),
  role: chatRoleArb,
  content: fc.string({ maxLength: 120 }),
  mode: aiModeArb,
  thinkingContent: fc.string({ maxLength: 100 }),
  timestamp: fc.integer({ min: 1, max: Number.MAX_SAFE_INTEGER }),
  model: fc.string({ maxLength: 40 }),
  provider: providerArb,
  isStreaming: fc.boolean(),
  tokens: fc.integer({ min: 0, max: 20000 }),
  isError: fc.boolean(),
  isIncomplete: fc.boolean(),
  retryContent: fc.string({ maxLength: 120 }),
});

const sessionArb: fc.Arbitrary<ChatSession> = fc.record({
  id: fc.string({ minLength: 1, maxLength: 24 }),
  title: fc.string({ maxLength: 60 }),
  createdAt: fc.integer({ min: 1, max: Number.MAX_SAFE_INTEGER }),
  updatedAt: fc.integer({ min: 1, max: Number.MAX_SAFE_INTEGER }),
  messages: fc.array(fullChatMessageArb, { minLength: 0, maxLength: 10 }),
});

const fileChangeArb: fc.Arbitrary<AgentFileChange> = fc.record({
  path: fc.string({ minLength: 1, maxLength: 80 }),
  originalContent: fc.string({ maxLength: 200 }),
  action: fc.constantFrom("write", "create", "delete"),
});

describe("Property-Based Invariants", () => {
  beforeEach(() => {
    window.localStorage.clear();
    invokeMock.mockReset();
    resetStoreState();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("Property 1: error responses always terminate thinking state", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1, maxLength: 120 }),
        fc.string({ minLength: 1, maxLength: 80 }),
        async (prompt, errText) => {
          resetStoreState();
          invokeMock.mockImplementation(async (cmd) => {
            if (cmd === "ollama_chat") throw new Error(errText);
            throw new Error(`Unexpected invoke: ${String(cmd)}`);
          });

          await useAIStore.getState().sendMessage(prompt);

          const state = useAIStore.getState();
          expect(state.isThinking).toBe(false);
          const last = state.chatHistory[state.chatHistory.length - 1];
          expect(last?.role).toBe("assistant");
          expect(last?.isError).toBe(true);
        }
      ),
      { numRuns: 30 }
    );
  });

  it("Property 2: stream tokens accumulate exactly in order", async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(safeTokenArb(), { minLength: 1, maxLength: 50 }), async (tokens) => {
        resetStoreState();
        useAIStore.setState({
          chatHistory: [
            {
              id: "stream-msg",
              role: "assistant",
              content: "",
              timestamp: Date.now(),
            },
          ],
        });

        for (const token of tokens) {
          useAIStore.getState().addStreamToken("stream-msg", token);
        }

        const msg = useAIStore.getState().chatHistory.find((m) => m.id === "stream-msg");
        expect(msg?.content).toBe(tokens.join(""));
        expect(msg?.thinkingContent).toBeUndefined();
      }),
      { numRuns: 60 }
    );
  });

  it("Property 3: agent step limit is always enforced at 20 maxSteps from frontend", async () => {
    await fc.assert(
      fc.asyncProperty(fc.string({ minLength: 1, maxLength: 120 }), async (prompt) => {
        resetStoreState();
        useAIStore.setState({
          openFolder: "/tmp/project",
          selectedOllamaModels: ["test-model"],
          chatHistory: [],
        });

        invokeMock.mockImplementation(async (cmd) => {
          if (cmd === "run_agent_task") {
            return JSON.stringify({ summary: "ok", changes: [] });
          }
          throw new Error(`Unexpected invoke: ${String(cmd)}`);
        });

        await useAIStore.getState().runAgentTask(prompt);

        const call = invokeMock.mock.calls.find(([cmd]) => cmd === "run_agent_task");
        expect(call).toBeDefined();
        const payload = call?.[1] as { maxSteps?: number };
        expect(payload.maxSteps).toBe(20);
      }),
      { numRuns: 40 }
    );
  });

  it("Property 4: agent file changes are recorded atomically as ordered append", async () => {
    await fc.assert(
      fc.property(
        fc.array(fileChangeArb, { minLength: 0, maxLength: 20 }),
        fc.array(fileChangeArb, { minLength: 0, maxLength: 20 }),
        (initial, incoming) => {
          resetStoreState();
          useAIStore.setState({ aiChangeHistory: initial });

          useAIStore.getState().recordAgentChanges(incoming);

          const history = useAIStore.getState().aiChangeHistory;
          expect(history).toEqual([...initial, ...incoming]);
          expect(history.slice(initial.length)).toEqual(incoming);
        }
      ),
      { numRuns: 80 }
    );
  });

  it("Property 5: thinking content is parsed and stored separately", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ maxLength: 80 }).filter((s) => !s.includes("<thinking>") && !s.includes("</thinking>")),
        fc.string({ maxLength: 80 }).filter((s) => !s.includes("<thinking>") && !s.includes("</thinking>")),
        fc.string({ maxLength: 80 }).filter((s) => !s.includes("<thinking>") && !s.includes("</thinking>")),
        async (prefix, thought, suffix) => {
          const raw = `${prefix}<thinking>${thought}</thinking>${suffix}`;
          const parsed = parseThinkingBlock(raw);
          expect(parsed.thinkingContent).toBe(thought.trim());
          expect(parsed.content).toBe(`${prefix}${suffix}`.trim());

          resetStoreState();
          useAIStore.setState({
            chatHistory: [
              { id: "think-msg", role: "assistant", content: "", timestamp: Date.now() },
            ],
          });
          useAIStore.getState().addStreamToken("think-msg", raw);
          const msg = useAIStore.getState().chatHistory.find((m) => m.id === "think-msg");
          expect(msg?.thinkingContent).toBe(thought.trim());
          expect(msg?.content).toBe(`${prefix}${suffix}`.trim());
        }
      ),
      { numRuns: 60 }
    );
  });

  it("Property 6: @-mention file injection truncates at 6000 chars", async () => {
    await fc.assert(
      fc.asyncProperty(fc.string({ minLength: 0, maxLength: 12000 }), async (fileContent) => {
        resetStoreState();
        invokeMock.mockImplementation(async (cmd) => {
          if (cmd === "read_file") return fileContent;
          throw new Error(`Unexpected invoke: ${String(cmd)}`);
        });

        const result = await useAIStore.getState().addMentionedFile("src/example.ts");
        expect(result.ok).toBe(true);

        const mention = useAIStore.getState().mentionedFiles.find((m) => m.path === "src/example.ts");
        expect(mention).toBeDefined();
        const expectedLen = Math.min(fileContent.length, 6000);
        expect(mention?.content.length).toBe(expectedLen);
        expect(mention?.truncated).toBe(fileContent.length > 6000);
      }),
      { numRuns: 50 }
    );
  });

  it("Property 7: token estimation is monotonically non-decreasing", async () => {
    await fc.assert(
      fc.property(fc.string({ maxLength: 500 }), fc.string({ maxLength: 500 }), (base, suffix) => {
        expect(estimateTokenCount(base + suffix)).toBeGreaterThanOrEqual(estimateTokenCount(base));

        const messagesA = [{ content: base }];
        const messagesB = [{ content: base }, { content: suffix }];
        expect(estimateMessagesTokenCount(messagesB)).toBeGreaterThanOrEqual(
          estimateMessagesTokenCount(messagesA)
        );
      }),
      { numRuns: 120 }
    );
  });

  it("Property 8: session round-trip preserves all message data", async () => {
    await fc.assert(
      fc.property(fc.array(sessionArb, { minLength: 0, maxLength: 12 }), (sessions) => {
        const encoded = serializeSessions(sessions);
        const decoded = deserializeSessions(encoded);
        expect(decoded).toEqual(sessions);
      }),
      { numRuns: 80 }
    );
  });

  it("Property 9: prompt template validation rejects oversized files", async () => {
    await fc.assert(
      fc.property(fc.integer({ min: 0, max: 16000 }), (len) => {
        const content = "a".repeat(len);
        const validation = validatePromptTemplateContent(content);
        if (len > MAX_PROMPT_TEMPLATE_CHARS) {
          expect(validation).toBeTruthy();
        } else {
          expect(validation).toBeNull();
        }
      }),
      { numRuns: 120 }
    );
  });

  it("Property 10: inline completion debounce prevents excess backend requests", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.record({
            code: fc.string({ minLength: 1, maxLength: 30 }),
            gap: fc.integer({ min: 1, max: INLINE_COMPLETION_DEBOUNCE_MS - 1 }),
          }),
          { minLength: 2, maxLength: 12 }
        ),
        async (events) => {
          vi.useFakeTimers();
          const requestFn = vi.fn().mockResolvedValue("ok");
          const provider = createInlineCompletionDebouncer(requestFn, INLINE_COMPLETION_DEBOUNCE_MS);

          for (const evt of events) {
            provider(evt.code, "ts");
            await vi.advanceTimersByTimeAsync(evt.gap);
          }

          await vi.advanceTimersByTimeAsync(INLINE_COMPLETION_DEBOUNCE_MS + 5);
          expect(requestFn).toHaveBeenCalledTimes(1);
        }
      ),
      { numRuns: 60 }
    );
  });

  it("Property 11: context summarization triggers at >= 90% threshold", async () => {
    await fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 1_000_000 }),
        fc.integer({ min: 0, max: 2_000_000 }),
        (maxTokens, usedTokens) => {
          const expected = usedTokens / maxTokens >= 0.9;
          expect(shouldTriggerContextSummarization(usedTokens, maxTokens)).toBe(expected);

          const higher = usedTokens + 1;
          if (shouldTriggerContextSummarization(usedTokens, maxTokens)) {
            expect(shouldTriggerContextSummarization(higher, maxTokens)).toBe(true);
          }
        }
      ),
      { numRuns: 120 }
    );
  });
});
