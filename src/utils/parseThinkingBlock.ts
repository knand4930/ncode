/**
 * parseThinkingBlock
 *
 * Splits a raw LLM response that may contain a <thinking>...</thinking> block
 * into two parts:
 *   - thinkingContent: the inner text of the first <thinking> block (trimmed)
 *   - content: the text outside the block (trimmed)
 *
 * If no <thinking> block is present, thinkingContent is undefined and content
 * is the original string unchanged.
 *
 * Validates: Requirements 4.2 / Property 5
 */
export function parseThinkingBlock(raw: string): {
  thinkingContent: string | undefined;
  content: string;
} {
  const match = raw.match(/<thinking>([\s\S]*?)<\/thinking>/);
  if (!match) {
    return { thinkingContent: undefined, content: raw };
  }

  const thinkingContent = match[1].trim();
  // Remove the entire <thinking>...</thinking> block from the content
  const content = raw.replace(/<thinking>[\s\S]*?<\/thinking>/, "").trim();

  return { thinkingContent, content };
}

/**
 * Count reasoning steps in thinking content.
 * A "step" is a non-empty line or a numbered/bulleted item.
 */
export function countThinkingSteps(thinkingContent: string): number {
  const lines = thinkingContent
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  return lines.length;
}
