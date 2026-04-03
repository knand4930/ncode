export type FileSuggestion = { path: string; content: string; language: string };

export type ShellCommandSuggestion = {
  display: string;
  command: string;
  context?: string;
};

function normalizePathComparisonKey(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\.?\//, "").replace(/\/{2,}/g, "/").toLowerCase();
}

function stripMarkdownLabel(raw: string): string {
  return raw
    .trim()
    .replace(/^[-*+]\s*/, "")
    .replace(/^\d+\.\s*/, "")
    .replace(/^#{1,6}\s*/i, "")
    .replace(/^`|`$/g, "")
    .replace(/^\*\*|\*\*$/g, "")
    .replace(/^["']|["']$/g, "");
}

export function cleanSuggestedPath(raw: string): string {
  return stripMarkdownLabel(raw)
    .replace(/^(?:file|path)\s*:\s*/i, "")
    .replace(/^(?:file|path)\s+/i, "")
    .replace(/^\.\//, "")
    .replace(/\s+\(.*\)$/, "")
    .replace(/\\/g, "/")
    .replace(/\/{2,}/g, "/")
    .trim();
}

export function inferLanguageFromPath(path: string): string {
  const ext = cleanSuggestedPath(path).toLowerCase().split(".").pop() || "";
  const map: Record<string, string> = {
    ts: "typescript",
    tsx: "tsx",
    js: "javascript",
    jsx: "jsx",
    py: "python",
    rs: "rust",
    go: "go",
    java: "java",
    cpp: "cpp",
    c: "c",
    cs: "csharp",
    rb: "ruby",
    php: "php",
    swift: "swift",
    kt: "kotlin",
    html: "html",
    css: "css",
    scss: "scss",
    json: "json",
    yaml: "yaml",
    yml: "yaml",
    toml: "toml",
    md: "markdown",
    sh: "bash",
    bash: "bash",
    sql: "sql",
    vue: "vue",
    svelte: "svelte",
    xml: "xml",
  };
  return map[ext] || "text";
}

function looksLikePath(value: string): boolean {
  const candidate = cleanSuggestedPath(value);
  if (!candidate) return false;
  if (candidate.includes(" ") && !candidate.includes("/")) return false;
  return /[\\/]/.test(candidate) || /\.[A-Za-z0-9_-]{1,12}$/.test(candidate);
}

function findPathNear(markdown: string, index: number): string | null {
  const before = markdown.slice(Math.max(0, index - 360), index);
  const patterns = [
    /(?:^|\n)\s*(?:#{1,6}\s*)?(?:file|path)\s*:\s*`?([^\n`]+)`?\s*$/gi,
    /(?:^|\n)\s*(?:[-*]\s*)?`([^`\n]+\.[A-Za-z0-9._/-]+)`\s*:?\s*$/gi,
    /(?:^|\n)\s*(?:[-*]\s*)?\*\*([^*\n]+\.[A-Za-z0-9._/-]+)\*\*\s*:?\s*$/gi,
    /(?:^|\n)\s*(?:[-*]\s*)?([A-Za-z0-9_./\\-]+\.[A-Za-z0-9_.-]+)\s*:?\s*$/gi,
  ];

  for (const pattern of patterns) {
    let match: RegExpExecArray | null;
    let lastPath: string | null = null;
    while ((match = pattern.exec(before)) !== null) lastPath = match[1];
    if (lastPath && looksLikePath(lastPath)) return cleanSuggestedPath(lastPath);
  }

  return null;
}

function isAbsolutePath(path: string): boolean {
  return path.startsWith("/") || /^[A-Za-z]:[\\/]/.test(path);
}

export function resolveSuggestionPath(path: string, folder: string | null): string | null {
  const normalized = cleanSuggestedPath(path);
  if (!normalized) return null;
  if (isAbsolutePath(normalized)) return normalized;
  if (!folder) return null;
  return `${folder.replace(/[\\/]+$/, "")}/${normalized.replace(/^\.?\//, "")}`;
}

export function extractFileSuggestions(markdown: string, folder: string | null = null): FileSuggestion[] {
  const suggestions: FileSuggestion[] = [];
  const seen = new Set<string>();

  const push = (path: string, content: string, language?: string) => {
    const cleanedPath = cleanSuggestedPath(path);
    if (!cleanedPath || !content.trim()) return;

    const resolved = resolveSuggestionPath(cleanedPath, folder);
    const comparisonKey = normalizePathComparisonKey(resolved ?? cleanedPath);
    if (seen.has(comparisonKey)) return;

    seen.add(comparisonKey);
    suggestions.push({
      path: cleanedPath,
      content: content.trimEnd(),
      language: (language || "").trim() || inferLanguageFromPath(cleanedPath),
    });
  };

  let match: RegExpExecArray | null;
  const variants = [
    /(?:^|\n)(?:#{1,6}\s*)?file\s*:\s*`?([^\n`]+?)`?\s*\n```([\w.+-]*)\n([\s\S]*?)```/gi,
    /(?:^|\n)(?:#{1,6}\s*)?path\s*:\s*`?([^\n`]+?)`?\s*\n```([\w.+-]*)\n([\s\S]*?)```/gi,
    /(?:^|\n)#{1,6}\s*`?([^\n`]+\.[\w.-]+)`?\s*\n```([\w.+-]*)\n([\s\S]*?)```/gi,
  ];

  for (const pattern of variants) {
    while ((match = pattern.exec(markdown)) !== null) push(match[1], match[3], match[2]);
  }

  const infoPath = /```([\w.+-]+)\s+([^\n`]+\.[\w.-]+)\n([\s\S]*?)```/gi;
  while ((match = infoPath.exec(markdown)) !== null) push(match[2], match[3], match[1]);

  const infoOnly = /```([^\n`\s]+\.[A-Za-z0-9_.-]+)\n([\s\S]*?)```/gi;
  while ((match = infoOnly.exec(markdown)) !== null) {
    if (looksLikePath(match[1])) push(match[1], match[2], inferLanguageFromPath(match[1]));
  }

  const generic = /```([\w.+-]*)\n([\s\S]*?)```/gi;
  while ((match = generic.exec(markdown)) !== null) {
    const info = (match[1] || "").trim();
    let path: string | null = null;
    let language = info;

    if (info && looksLikePath(info)) {
      path = info;
      language = inferLanguageFromPath(info);
    } else {
      path = findPathNear(markdown, match.index);
      if (path && !language) language = inferLanguageFromPath(path);
    }

    if (path) push(path, match[2], language);
  }

  return suggestions.slice(0, 12);
}

function stripPromptPrefix(line: string): string {
  let normalized = stripMarkdownLabel(line);

  normalized = normalized.replace(
    /^(?:\[[^\]]+\]\s*)?(?:\([^)]+\)\s*)?(?:[\w.~:/@-]+)?[$#%>]\s+/,
    ""
  );
  normalized = normalized.replace(/^(?:~\.?|❯|➜|>>?|[%$#])\s+/, "");
  normalized = normalized.replace(/^`|`$/g, "");

  return normalized.trim();
}

function looksLikeComplexShellBlock(lines: string[]): boolean {
  return lines.some((line) =>
    line.endsWith("\\") ||
    line.includes("{") ||
    line.includes("}") ||
    line.startsWith("if ") ||
    line.startsWith("for ") ||
    line.startsWith("while ") ||
    line.startsWith("case ") ||
    line.startsWith("function ")
  );
}

export function extractShellCommands(markdown: string): ShellCommandSuggestion[] {
  const suggestions: ShellCommandSuggestion[] = [];
  const seen = new Set<string>();
  const pattern = /```(bash|sh|shell|zsh)\n([\s\S]*?)```/gi;
  let match: RegExpExecArray | null;

  const push = (display: string, command: string, context?: string) => {
    const trimmedDisplay = display.trim();
    const trimmedCommand = command.trim();
    if (!trimmedDisplay || !trimmedCommand) return;

    const key = `${trimmedDisplay}\n${trimmedCommand}`;
    if (seen.has(key)) return;
    seen.add(key);
    suggestions.push({ display: trimmedDisplay, command: trimmedCommand, context });
  };

  while ((match = pattern.exec(markdown)) !== null) {
    const block = match[2].trim();
    if (!block) continue;
    if ((block.startsWith("{") && block.endsWith("}")) || (block.startsWith("[") && block.endsWith("]"))) continue;

    const normalizedLines = block
      .split("\n")
      .map((line) => stripPromptPrefix(line))
      .filter((line) => line && !line.startsWith("#"));

    if (!normalizedLines.length) continue;

    if (looksLikeComplexShellBlock(normalizedLines)) {
      const command = normalizedLines.join("\n").trim();
      push(command, command);
      continue;
    }

    let contextPrefix = "";
    for (const line of normalizedLines) {
      if (/^cd\s+/.test(line)) {
        contextPrefix = contextPrefix ? `${contextPrefix} && ${line}` : line;
        push(line, contextPrefix);
        continue;
      }

      const command = contextPrefix ? `${contextPrefix} && ${line}` : line;
      push(line, command, contextPrefix || undefined);
    }
  }

  return suggestions.slice(0, 6);
}
