import { describe, expect, it } from "vitest";

import {
  extractFileSuggestions,
  extractShellCommands,
  resolveSuggestionPath,
} from "./aiSuggestionParser";

describe("aiSuggestionParser", () => {
  it("normalizes and deduplicates file suggestions for the same file", () => {
    const markdown = `
app/Login/AuthPage.tsx
\`\`\`tsx
export const First = () => null;
\`\`\`

File: app/login/AuthPage.tsx
\`\`\`tsx
export const Second = () => null;
\`\`\`

\`\`\`tsx /tmp/project/app/login/AuthPage.tsx
export const Third = () => null;
\`\`\`
`;

    const suggestions = extractFileSuggestions(markdown, "/tmp/project");

    expect(suggestions).toHaveLength(1);
    expect(suggestions[0].path.startsWith("File:")).toBe(false);
    expect(resolveSuggestionPath(suggestions[0].path, "/tmp/project")?.toLowerCase()).toBe(
      "/tmp/project/app/login/authpage.tsx"
    );
  });

  it("strips prompt text and preserves cd context for later commands", () => {
    const markdown = `
\`\`\`bash
~ cd /tmp/project
$ ls -la app/login/
ubuntu@host:~/tmp/project$ npm test
❯ pnpm lint
\`\`\`
`;

    const commands = extractShellCommands(markdown);

    expect(commands).toEqual([
      { display: "cd /tmp/project", command: "cd /tmp/project" },
      {
        display: "ls -la app/login/",
        command: "cd /tmp/project && ls -la app/login/",
        context: "cd /tmp/project",
      },
      {
        display: "npm test",
        command: "cd /tmp/project && npm test",
        context: "cd /tmp/project",
      },
      {
        display: "pnpm lint",
        command: "cd /tmp/project && pnpm lint",
        context: "cd /tmp/project",
      },
    ]);
  });
});
