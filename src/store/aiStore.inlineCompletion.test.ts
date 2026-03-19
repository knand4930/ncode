/**
 * Property-Based Test: Inline completion debounce prevents excess requests
 *
 * **Validates: Requirements 8.5**
 *
 * Tag: "Feature: ai-agent-chat-improvements, Property 10: inline completion debounce prevents excess requests"
 *
 * Property: For any sequence of keystrokes where inter-keystroke interval < 600ms,
 * at most one getInlineCompletion request must be in-flight at any given time.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fc from "fast-check";

// ---------------------------------------------------------------------------
// Debounce implementation under test
// This mirrors the debounce logic used in EditorArea.tsx's inline completion
// provider. We extract it here so it can be tested in isolation.
// ---------------------------------------------------------------------------

function createDebouncedCompletionProvider(
  requestFn: (code: string, lang: string) => Promise<string>,
  debounceMs: number
) {
  let timer: ReturnType<typeof setTimeout> | null = null;

  return function provideCompletion(code: string, lang: string): Promise<string> {
    if (timer) clearTimeout(timer);
    return new Promise((resolve) => {
      timer = setTimeout(async () => {
        const result = await requestFn(code, lang);
        resolve(result);
      }, debounceMs);
    });
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Inline completion debounce (Property 10)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("fires exactly once after a burst of rapid calls (< 600ms apart)", async () => {
    const requestFn = vi.fn().mockResolvedValue("completion");
    const provider = createDebouncedCompletionProvider(requestFn, 600);

    // Simulate 5 rapid calls — each new call cancels the previous timer
    provider("code1", "ts");
    provider("code2", "ts");
    provider("code3", "ts");
    provider("code4", "ts");
    const lastPromise = provider("code5", "ts");

    // Advance time past the debounce window to flush the last pending call
    await vi.advanceTimersByTimeAsync(700);
    await lastPromise;

    // Only the last call should have triggered the actual request
    expect(requestFn).toHaveBeenCalledTimes(1);
    expect(requestFn).toHaveBeenCalledWith("code5", "ts");
  });

  it("fires once per pause when keystrokes are spaced > 600ms apart", async () => {
    const requestFn = vi.fn().mockResolvedValue("completion");
    const provider = createDebouncedCompletionProvider(requestFn, 600);

    // First burst
    provider("code1", "ts");
    await vi.advanceTimersByTimeAsync(700);

    // Second burst (after debounce window)
    provider("code2", "ts");
    await vi.advanceTimersByTimeAsync(700);

    expect(requestFn).toHaveBeenCalledTimes(2);
  });

  // ---------------------------------------------------------------------------
  // Property-based test: for any keystroke sequence with intervals < 600ms,
  // at most one request is in-flight at any given time.
  // ---------------------------------------------------------------------------
  it("property: rapid keystrokes (< 600ms apart) result in at most 1 in-flight request", async () => {
    await fc.assert(
      fc.asyncProperty(
        // Generate 2–10 keystrokes with inter-keystroke intervals between 10ms and 599ms
        fc.array(
          fc.record({
            code: fc.string({ minLength: 5, maxLength: 20 }),
            interval: fc.integer({ min: 10, max: 599 }),
          }),
          { minLength: 2, maxLength: 10 }
        ),
        async (keystrokes) => {
          let inFlightCount = 0;
          let maxInFlight = 0;

          const requestFn = vi.fn().mockImplementation(async () => {
            inFlightCount++;
            maxInFlight = Math.max(maxInFlight, inFlightCount);
            // Simulate async work
            await Promise.resolve();
            inFlightCount--;
            return "completion";
          });

          const provider = createDebouncedCompletionProvider(requestFn, 600);

          // Fire keystrokes with their intervals
          let elapsed = 0;
          for (const { code, interval } of keystrokes) {
            provider(code, "ts");
            elapsed += interval;
            await vi.advanceTimersByTimeAsync(interval);
          }

          // Advance past the final debounce window to flush the last pending call
          await vi.advanceTimersByTimeAsync(700);

          // At most one request should have been in-flight at any given time
          expect(maxInFlight).toBeLessThanOrEqual(1);
        }
      ),
      { numRuns: 100 }
    );
  });

  it("property: total requests fired <= ceil(totalDuration / 600ms)", async () => {
    await fc.assert(
      fc.asyncProperty(
        // Generate keystroke sequences with varying intervals (some < 600ms, some >= 600ms)
        fc.array(
          fc.record({
            code: fc.string({ minLength: 5, maxLength: 20 }),
            interval: fc.integer({ min: 50, max: 1200 }),
          }),
          { minLength: 1, maxLength: 15 }
        ),
        async (keystrokes) => {
          const requestFn = vi.fn().mockResolvedValue("completion");
          const provider = createDebouncedCompletionProvider(requestFn, 600);

          let totalDuration = 0;
          for (const { code, interval } of keystrokes) {
            provider(code, "ts");
            totalDuration += interval;
            await vi.advanceTimersByTimeAsync(interval);
          }

          // Flush the last pending debounce
          await vi.advanceTimersByTimeAsync(700);
          totalDuration += 700;

          const maxExpectedRequests = Math.ceil(totalDuration / 600);
          expect(requestFn.mock.calls.length).toBeLessThanOrEqual(maxExpectedRequests);
        }
      ),
      { numRuns: 100 }
    );
  });
});
