import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fc from "fast-check";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(),
}));

import {
  createInlineCompletionDebouncer,
  INLINE_COMPLETION_DEBOUNCE_MS,
} from "./aiStore";

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  return { promise, resolve, reject };
}

describe("Inline completion debounce", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    window.localStorage.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("fires exactly once after a burst of rapid calls (< 600ms apart)", async () => {
    const requestFn = vi.fn().mockResolvedValue("completion");
    const provider = createInlineCompletionDebouncer(requestFn, INLINE_COMPLETION_DEBOUNCE_MS);

    provider("code1", "ts");
    provider("code2", "ts");
    provider("code3", "ts");
    provider("code4", "ts");
    const lastPromise = provider("code5", "ts");

    await vi.advanceTimersByTimeAsync(INLINE_COMPLETION_DEBOUNCE_MS + 100);

    await expect(lastPromise).resolves.toBe("completion");
    expect(requestFn).toHaveBeenCalledTimes(1);
    expect(requestFn).toHaveBeenCalledWith("code5", "ts");
  });

  it("resolves superseded pending requests to an empty string", async () => {
    const requestFn = vi.fn().mockResolvedValue("completion");
    const provider = createInlineCompletionDebouncer(requestFn, INLINE_COMPLETION_DEBOUNCE_MS);

    const firstPromise = provider("code1", "ts");
    const secondPromise = provider("code2", "ts");

    await expect(firstPromise).resolves.toBe("");

    await vi.advanceTimersByTimeAsync(INLINE_COMPLETION_DEBOUNCE_MS + 100);

    await expect(secondPromise).resolves.toBe("completion");
    expect(requestFn).toHaveBeenCalledTimes(1);
    expect(requestFn).toHaveBeenCalledWith("code2", "ts");
  });

  it("drops stale in-flight responses when a newer request wins", async () => {
    const first = createDeferred<string>();
    const second = createDeferred<string>();
    const requestFn = vi
      .fn()
      .mockImplementationOnce((_code: string, _lang: string) => first.promise)
      .mockImplementationOnce((_code: string, _lang: string) => second.promise);
    const provider = createInlineCompletionDebouncer(requestFn, INLINE_COMPLETION_DEBOUNCE_MS);

    const firstPromise = provider("code1", "ts");
    await vi.advanceTimersByTimeAsync(INLINE_COMPLETION_DEBOUNCE_MS);

    const secondPromise = provider("code2", "ts");
    await vi.advanceTimersByTimeAsync(INLINE_COMPLETION_DEBOUNCE_MS);

    first.resolve("stale");
    await expect(firstPromise).resolves.toBe("");

    second.resolve("fresh");
    await expect(secondPromise).resolves.toBe("fresh");
    expect(requestFn).toHaveBeenCalledTimes(2);
  });

  it("returns an empty string when the backend request fails", async () => {
    const requestFn = vi.fn().mockRejectedValue(new Error("boom"));
    const provider = createInlineCompletionDebouncer(requestFn, INLINE_COMPLETION_DEBOUNCE_MS);

    const promise = provider("code", "ts");
    await vi.advanceTimersByTimeAsync(INLINE_COMPLETION_DEBOUNCE_MS + 100);

    await expect(promise).resolves.toBe("");
  });

  it("property: rapid keystrokes (< 600ms apart) result in at most 1 in-flight request", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.record({
            code: fc.string({ minLength: 5, maxLength: 20 }),
            interval: fc.integer({ min: 10, max: INLINE_COMPLETION_DEBOUNCE_MS - 1 }),
          }),
          { minLength: 2, maxLength: 10 }
        ),
        async (keystrokes) => {
          let inFlightCount = 0;
          let maxInFlight = 0;

          const requestFn = vi.fn().mockImplementation(async () => {
            inFlightCount += 1;
            maxInFlight = Math.max(maxInFlight, inFlightCount);
            await Promise.resolve();
            inFlightCount -= 1;
            return "completion";
          });

          const provider = createInlineCompletionDebouncer(requestFn, INLINE_COMPLETION_DEBOUNCE_MS);

          for (const { code, interval } of keystrokes) {
            provider(code, "ts");
            await vi.advanceTimersByTimeAsync(interval);
          }

          await vi.advanceTimersByTimeAsync(INLINE_COMPLETION_DEBOUNCE_MS + 100);

          expect(maxInFlight).toBeLessThanOrEqual(1);
        }
      ),
      { numRuns: 100 }
    );
  });

  it("property: total requests fired stay bounded by debounce windows", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.record({
            code: fc.string({ minLength: 5, maxLength: 20 }),
            interval: fc.integer({ min: 50, max: 1200 }),
          }),
          { minLength: 1, maxLength: 15 }
        ),
        async (keystrokes) => {
          const requestFn = vi.fn().mockResolvedValue("completion");
          const provider = createInlineCompletionDebouncer(requestFn, INLINE_COMPLETION_DEBOUNCE_MS);

          let totalDuration = 0;
          for (const { code, interval } of keystrokes) {
            provider(code, "ts");
            totalDuration += interval;
            await vi.advanceTimersByTimeAsync(interval);
          }

          await vi.advanceTimersByTimeAsync(INLINE_COMPLETION_DEBOUNCE_MS + 100);
          totalDuration += INLINE_COMPLETION_DEBOUNCE_MS + 100;

          const maxExpectedRequests = Math.ceil(totalDuration / INLINE_COMPLETION_DEBOUNCE_MS);
          expect(requestFn.mock.calls.length).toBeLessThanOrEqual(maxExpectedRequests);
        }
      ),
      { numRuns: 100 }
    );
  });
});
