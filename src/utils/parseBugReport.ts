// src/utils/parseBugReport.ts
import { BugReport, BugEntry } from "../store/aiStore";

/**
 * Extracts a structured BugReport from an assistant message that contains
 * a ```json ... ``` fenced block with the bug report schema.
 *
 * Returns undefined if no valid bug report JSON is found.
 */
export function parseBugReport(content: string): BugReport | undefined {
  // Match the first ```json ... ``` block in the response
  const match = content.match(/```json\s*([\s\S]*?)```/);
  if (!match) return undefined;

  try {
    const parsed = JSON.parse(match[1].trim());
    if (!parsed || !Array.isArray(parsed.bugs)) return undefined;

    const validSeverities = new Set(["critical", "high", "medium", "low"]);

    const bugs: BugEntry[] = parsed.bugs
      .filter((b: unknown) => b && typeof b === "object")
      .map((b: Record<string, unknown>) => ({
        filePath: String(b.filePath ?? b.file_path ?? ""),
        line: Number(b.line ?? 0),
        severity: validSeverities.has(String(b.severity))
          ? (String(b.severity) as BugEntry["severity"])
          : "low",
        description: String(b.description ?? ""),
        fix: String(b.fix ?? ""),
      }));

    // Recompute summary from actual bugs (don't trust the model's counts)
    const summary = { critical: 0, high: 0, medium: 0, low: 0 };
    for (const bug of bugs) {
      summary[bug.severity]++;
    }

    return { bugs, summary };
  } catch {
    return undefined;
  }
}
