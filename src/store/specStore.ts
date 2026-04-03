// src/store/specStore.ts — Advanced Kiro/Codex-style spec-driven development
import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { useAIStore } from "./aiStore";
import { useEditorStore } from "./editorStore";
import { useTerminalStore } from "./terminalStore";
import { detectProjectContext } from "../utils/projectScanner";

// ── Types ─────────────────────────────────────────────────────────────────────

export type SpecPhase =
  | "idle"
  | "analyzing"
  | "requirements"
  | "design"
  | "tasks"
  | "executing"
  | "complete";

export type SpecStartTarget = "requirements" | "design" | "tasks" | "executing";

export type TaskStatus = "pending" | "in_progress" | "review" | "done" | "failed" | "skipped";

export interface TaskFileChangePreview {
  path: string;
  fullPath: string;
  directory: string;
  content: string;
  existedBefore: boolean;
  addedLines: number;
  removedLines: number;
  diffPreview: string;
}

export interface TaskExecutionPreview {
  taskId: string;
  summary: string;
  fileChanges: TaskFileChangePreview[];
  commands: string[];
  folderChanges: string[];
  rawResponse: string;
  generatedAt: number;
}

export interface SpecTask {
  id: string;
  title: string;
  description: string;
  rationale: string;          // why this task exists
  acceptanceCriteria: string[]; // how to verify it's done
  status: TaskStatus;
  approved: boolean;
  retries: number;
  maxRetries: number;
  error?: string;
  output?: string;
  appliedFiles: string[];     // files actually written
  appliedChangeIds: string[]; // history entry IDs for rollback dependencies
  commands: string[];
  filePaths: string[];
  dependsOn: string[];        // task ids this depends on
  estimatedMinutes: number;
}

export interface ProjectAnalysis {
  summary: string;
  languages: string[];
  frameworks: string[];
  packageManager: string;
  existingFiles: string[];
  entryPoints: string[];
  testFramework: string;
  buildTool: string;
  conventions: string;        // detected code style/conventions
  relevantFiles: string[];    // files relevant to the feature
}

export interface SpecDoc {
  requirements: string;
  design: string;
  tasks: SpecTask[];
  analysis: ProjectAnalysis | null;
  featureName: string;
  featureQuery: string;
  createdAt: number;
  updatedAt: number;
}

interface SpecStore {
  phase: SpecPhase;
  query: string;              // user's natural language request
  startTarget: SpecStartTarget;
  doc: SpecDoc;
  taskPreviews: Record<string, TaskExecutionPreview>;
  activeTaskId: string | null;
  isGenerating: boolean;
  generatingLabel: string;
  error: string | null;
  executionLog: Array<{ ts: number; level: "info" | "ok" | "warn" | "error" | "cmd"; text: string }>;
  pendingApproval: "requirements" | "design" | "tasks" | null;
  autoApprove: boolean;       // skip approval gates

  // Actions
  setQuery: (q: string) => void;
  setAutoApprove: (v: boolean) => void;
  setStartTarget: (target: SpecStartTarget) => void;
  startFromQuery: (query: string, target?: SpecStartTarget) => Promise<void>;
  approveAndContinue: () => Promise<void>;
  rejectAndRegenerate: (feedback?: string) => Promise<void>;
  approveTask: (taskId: string) => void;
  approveAllTasks: () => void;
  approveTaskPreview: (taskId: string) => Promise<void>;
  rejectTaskPreview: (taskId: string, feedback?: string) => Promise<void>;
  executeApprovedTasks: () => Promise<void>;
  executeTask: (taskId: string) => Promise<void>;
  retryTask: (taskId: string) => Promise<void>;
  skipTask: (taskId: string) => void;
  resetSpec: () => void;
  updateRequirements: (content: string) => void;
  updateDesign: (content: string) => void;
  updateTask: (taskId: string, patch: Partial<SpecTask>) => void;
  log: (level: SpecStore["executionLog"][0]["level"], text: string) => void;
}

// ── Project analysis ──────────────────────────────────────────────────────────

async function analyzeProject(rootPath: string): Promise<ProjectAnalysis> {
  const ctx = await detectProjectContext(rootPath);

  // Scan top-level files for conventions
  let existingFiles: string[] = [];
  let entryPoints: string[] = [];
  let testFramework = "unknown";
  let buildTool = "unknown";
  let conventions = "";

  try {
    type DirEntry = { name: string; path: string; is_dir: boolean; children?: DirEntry[] };
    const entries = await invoke<DirEntry[]>("read_dir_recursive", { path: rootPath, depth: 2 });

    const flatten = (items: DirEntry[], depth = 0): string[] =>
      items.flatMap(e => e.is_dir && depth < 2
        ? flatten(e.children ?? [], depth + 1)
        : [e.path.replace(rootPath + "/", "").replace(rootPath + "\\", "")]);

    existingFiles = flatten(entries).filter(f =>
      !f.includes("node_modules") && !f.includes(".git") &&
      !f.includes("dist") && !f.includes("target") && !f.includes(".next")
    ).slice(0, 80);

    // Detect entry points
    const entryNames = ["main.ts", "main.tsx", "index.ts", "index.tsx", "app.ts", "app.tsx",
      "main.py", "app.py", "main.rs", "main.go", "Main.java"];
    entryPoints = existingFiles.filter(f => entryNames.some(e => f.endsWith(e)));

    // Detect test framework
    if (existingFiles.some(f => f.includes("vitest") || f.includes(".test.ts"))) testFramework = "vitest";
    else if (existingFiles.some(f => f.includes("jest") || f.includes(".test.js"))) testFramework = "jest";
    else if (existingFiles.some(f => f.includes("pytest") || f.includes("test_"))) testFramework = "pytest";
    else if (existingFiles.some(f => f.includes("_test.go"))) testFramework = "go test";

    // Detect build tool
    if (existingFiles.some(f => f.endsWith("vite.config.ts") || f.endsWith("vite.config.js"))) buildTool = "vite";
    else if (existingFiles.some(f => f.endsWith("webpack.config.js"))) buildTool = "webpack";
    else if (existingFiles.some(f => f.endsWith("Makefile"))) buildTool = "make";
    else if (ctx.packageManager === "cargo") buildTool = "cargo";

    // Sample a source file for conventions
    const sampleFile = existingFiles.find(f => f.endsWith(".ts") || f.endsWith(".tsx") || f.endsWith(".py"));
    if (sampleFile) {
      try {
        const content = await invoke<string>("read_file", { path: `${rootPath}/${sampleFile}` });
        const lines = content.split("\n").slice(0, 30).join("\n");
        conventions = `Sample from ${sampleFile}:\n${lines}`;
      } catch { /* ignore */ }
    }
  } catch { /* ignore */ }

  return {
    summary: ctx.summary,
    languages: ctx.languages,
    frameworks: ctx.frameworks,
    packageManager: ctx.packageManager ?? "unknown",
    existingFiles,
    entryPoints,
    testFramework,
    buildTool,
    conventions,
    relevantFiles: [],
  };
}

// ── Prompt builders ───────────────────────────────────────────────────────────

function buildAnalysisPrompt(query: string, analysis: ProjectAnalysis): string {
  return `You are an expert software architect analyzing a project to understand a feature request.

## User Request
"${query}"

## Project Analysis
- Stack: ${analysis.summary}
- Languages: ${analysis.languages.join(", ") || "unknown"}
- Frameworks: ${analysis.frameworks.join(", ") || "none detected"}
- Package Manager: ${analysis.packageManager}
- Build Tool: ${analysis.buildTool}
- Test Framework: ${analysis.testFramework}
- Entry Points: ${analysis.entryPoints.join(", ") || "none"}

## Existing Files (sample)
${analysis.existingFiles.slice(0, 40).join("\n")}

${analysis.conventions ? `## Code Conventions (sampled)\n${analysis.conventions.slice(0, 600)}\n` : ""}

Based on the user request and project context:
1. Identify which existing files are most relevant to this feature
2. Suggest a clear, specific feature name (kebab-case, e.g. "user-authentication")
3. Clarify the request into a precise technical goal

Respond in JSON:
\`\`\`json
{
  "featureName": "kebab-case-name",
  "clarifiedGoal": "Precise technical description of what needs to be built",
  "relevantFiles": ["list", "of", "relevant", "existing", "files"],
  "approach": "Brief description of the recommended technical approach"
}
\`\`\``;
}

function buildRequirementsPrompt(
  query: string, featureName: string, clarifiedGoal: string,
  analysis: ProjectAnalysis, approach: string
): string {
  return `You are a senior product engineer writing a requirements document.

## Feature Request
"${query}"

## Clarified Goal
${clarifiedGoal}

## Project Context
- Stack: ${analysis.summary}
- Frameworks: ${analysis.frameworks.join(", ") || "none"}
- Existing patterns: ${analysis.entryPoints.join(", ") || "standard"}

## Recommended Approach
${approach}

Write a comprehensive, human-readable Requirements Document. Be specific to THIS project's stack and conventions.

# Requirements: ${featureName}

## Overview
[2-3 sentences describing what this feature does and why it matters to users]

## User Stories
[Write 3-6 user stories. Format: "As a [specific user type], I want to [specific action], so that [concrete benefit]."]

## Functional Requirements
[Number each FR-1, FR-2, etc. Be specific and testable. Reference the actual tech stack.]

## Non-Functional Requirements
[Performance targets, security requirements, accessibility, browser/platform support]

## Acceptance Criteria
[For each user story, write Given/When/Then scenarios that a QA engineer could execute]

## Technical Constraints
[Constraints imposed by the existing codebase, dependencies, or architecture]

## Out of Scope
[Explicitly list what will NOT be built in this iteration]

Write in clear, professional English. Be specific — avoid vague language like "should work well" or "be fast".`;
}

function buildDesignPrompt(
  featureName: string, requirements: string, analysis: ProjectAnalysis, feedback?: string
): string {
  return `You are a senior software architect writing a technical design document.

## Feature: ${featureName}

## Requirements
${requirements.slice(0, 4000)}

## Project Context
- Stack: ${analysis.summary}
- Languages: ${analysis.languages.join(", ")}
- Frameworks: ${analysis.frameworks.join(", ") || "none"}
- Package Manager: ${analysis.packageManager}
- Test Framework: ${analysis.testFramework}
- Existing entry points: ${analysis.entryPoints.join(", ") || "none"}
- Relevant existing files: ${analysis.relevantFiles.slice(0, 15).join(", ") || "none identified"}

${analysis.conventions ? `## Existing Code Style\n${analysis.conventions.slice(0, 500)}\n` : ""}

${feedback ? `## Revision Feedback\n${feedback}\n` : ""}

Write a detailed Technical Design Document that a developer can implement directly.

# Technical Design: ${featureName}

## Architecture Overview
[Describe how this feature fits into the existing architecture. Include a simple ASCII diagram if helpful.]

## Data Models & Types
[Define all new interfaces, types, schemas. Use the project's actual language syntax.]

## Component / Module Design
[For each new file or significant change:
- File path (relative to project root)
- Purpose
- Key exports/interfaces
- Implementation approach]

## State Management
[How state is managed — store changes, context, local state]

## API / Interface Design
[New functions, endpoints, events, or commands with their signatures]

## File Changes
[Exact list of files to CREATE or MODIFY with brief description of each change]

## Error Handling Strategy
[How errors are caught, reported, and recovered from]

## Testing Plan
[Specific test cases to write, using the project's test framework: ${analysis.testFramework}]

## Migration / Compatibility Notes
[Any breaking changes, migration steps, or backward compatibility considerations]

Be precise. Every decision should be implementable without ambiguity.`;
}

function buildTasksPrompt(
  featureName: string, requirements: string, design: string, analysis: ProjectAnalysis
): string {
  return `You are a senior engineer breaking down a feature into atomic implementation tasks.

## Feature: ${featureName}

## Requirements Summary
${requirements.slice(0, 2000)}

## Design Summary
${design.slice(0, 3000)}

## Project Context
- Stack: ${analysis.summary}
- Package Manager: ${analysis.packageManager}
- Test Framework: ${analysis.testFramework}
- Relevant files: ${analysis.relevantFiles.slice(0, 10).join(", ") || "none"}

Generate an ordered implementation task list. Each task must be:
- Atomic: one clear deliverable
- Verifiable: has specific acceptance criteria
- Ordered: dependencies come first
- Specific: references exact file paths from the design

Output ONLY valid JSON:
\`\`\`json
[
  {
    "id": "task-1",
    "title": "Concise action title (verb + noun)",
    "description": "Detailed implementation instructions. What exactly to write, where, and how. Reference specific functions, components, and patterns from the design.",
    "rationale": "Why this task is needed and what requirement it satisfies",
    "acceptanceCriteria": [
      "Specific, testable criterion 1",
      "Specific, testable criterion 2"
    ],
    "filePaths": ["exact/relative/path/to/file.ts"],
    "commands": ["npm install package-name"],
    "dependsOn": [],
    "estimatedMinutes": 15
  }
]
\`\`\`

Rules:
- Order tasks by dependency (setup → types → logic → UI → tests)
- First task: install any new dependencies
- Last task: write tests and verify the feature works end-to-end
- 5-20 tasks total
- filePaths must be relative to project root
- dependsOn lists task ids that must complete first`;
}

function buildTaskExecutionPrompt(
  task: SpecTask, featureName: string, requirements: string, design: string,
  completedSummary: string, analysis: ProjectAnalysis,
  existingFileContents: Record<string, string>, retryError?: string
): string {
  const fileContext = Object.entries(existingFileContents)
    .map(([path, content]) => `### ${path}\n\`\`\`\n${content.slice(0, 1500)}\n\`\`\``)
    .join("\n\n");

  return `You are an expert software engineer implementing a specific task. Write production-quality code.

## Feature: ${featureName}

## Task ${task.id}: ${task.title}
${task.description}

### Why this task exists
${task.rationale}

### Acceptance Criteria
${task.acceptanceCriteria.map(c => `- ${c}`).join("\n")}

### Files to work on
${task.filePaths.map(f => `- ${f}`).join("\n") || "- Determine from design"}

### Commands to run
${task.commands.map(c => `- \`${c}\``).join("\n") || "- None"}

## Project Context
- Stack: ${analysis.summary}
- Package Manager: ${analysis.packageManager}
- Test Framework: ${analysis.testFramework}

## Design Reference
${design.slice(0, 2500)}

## Requirements Reference
${requirements.slice(0, 1500)}

${completedSummary ? `## Completed Tasks (context)\n${completedSummary}\n` : ""}

${fileContext ? `## Existing File Contents\n${fileContext}\n` : ""}

${retryError ? `## ⚠ Previous Attempt Failed\nError: ${retryError}\n\nAnalyze the error carefully and fix the root cause.\n` : ""}

## Output Format

For each file to create or modify, output the COMPLETE file content:
\`\`\`typescript path/to/file.ts
// complete file content — no truncation, no placeholders
\`\`\`

For shell commands:
<execute>command here</execute>

When all changes are done:
<task_complete>Brief summary of what was implemented</task_complete>

If the task genuinely cannot be completed:
<task_failed>Specific reason why it failed</task_failed>

IMPORTANT:
- Output COMPLETE file contents — never use "// ... rest of file" or similar
- Match the existing code style exactly
- Handle all edge cases
- Do not create files that already exist unless modifying them`;
}

// ── Task parser ───────────────────────────────────────────────────────────────

function parseTasksFromResponse(response: string): SpecTask[] {
  const jsonMatch = response.match(/```(?:json)?\s*([\s\S]*?)```/);
  const jsonStr = jsonMatch ? jsonMatch[1].trim() : response.trim();

  try {
    const parsed = JSON.parse(jsonStr) as Array<{
      id?: string; title: string; description: string; rationale?: string;
      acceptanceCriteria?: string[]; filePaths?: string[]; commands?: string[];
      dependsOn?: string[]; estimatedMinutes?: number;
    }>;

    return parsed.map((t, i) => ({
      id: t.id ?? `task-${i + 1}`,
      title: t.title,
      description: t.description,
      rationale: t.rationale ?? "",
      acceptanceCriteria: t.acceptanceCriteria ?? [],
      status: "pending" as TaskStatus,
      approved: false,
      retries: 0,
      maxRetries: 3,
      commands: t.commands ?? [],
      filePaths: t.filePaths ?? [],
      dependsOn: t.dependsOn ?? [],
      estimatedMinutes: t.estimatedMinutes ?? 15,
      appliedFiles: [],
      appliedChangeIds: [],
    }));
  } catch {
    return [];
  }
}

// ── File change extractor ─────────────────────────────────────────────────────

interface FileChange { path: string; content: string; }

function extractFileChanges(response: string): FileChange[] {
  const changes: FileChange[] = [];
  const seen = new Set<string>();
  // Match: ```lang path/to/file.ext\n...content...```
  const re = /```(?:[\w.+-]+\s+)?([^\s`\n]+\.[a-zA-Z0-9]{1,10})\n([\s\S]*?)```/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(response)) !== null) {
    const path = m[1].trim().replace(/^\//, "");
    if (seen.has(path)) continue;
    if (!path.includes("/") && !/\.[a-z]{1,6}$/.test(path)) continue;
    seen.add(path);
    changes.push({ path, content: m[2] });
  }
  return changes;
}

function dirname(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  const idx = normalized.lastIndexOf("/");
  return idx <= 0 ? "" : normalized.slice(0, idx);
}

function buildQuickPatch(previousContent: string, newContent: string, maxLines = 120): string {
  if (previousContent === newContent) return "No textual changes.";

  const before = previousContent.split("\n");
  const after = newContent.split("\n");

  let start = 0;
  while (start < before.length && start < after.length && before[start] === after[start]) start += 1;

  let endBefore = before.length - 1;
  let endAfter = after.length - 1;
  while (endBefore >= start && endAfter >= start && before[endBefore] === after[endAfter]) {
    endBefore -= 1;
    endAfter -= 1;
  }

  const context = 2;
  const contextStart = Math.max(0, start - context);
  const contextEndBefore = Math.min(before.length - 1, endBefore + context);
  const lines: string[] = [];
  lines.push(`@@ line ${start + 1} @@`);

  for (let i = contextStart; i < start && lines.length < maxLines; i += 1) lines.push(` ${before[i]}`);
  for (let i = start; i <= endBefore && lines.length < maxLines; i += 1) lines.push(`-${before[i]}`);
  for (let i = start; i <= endAfter && lines.length < maxLines; i += 1) lines.push(`+${after[i]}`);
  for (let i = endBefore + 1; i <= contextEndBefore && lines.length < maxLines; i += 1) lines.push(` ${before[i]}`);

  if (lines.length >= maxLines) lines.push("...diff preview truncated...");
  return lines.join("\n");
}

function countLineDelta(previousContent: string, newContent: string): { added: number; removed: number } {
  if (previousContent === newContent) return { added: 0, removed: 0 };

  const before = previousContent.split("\n");
  const after = newContent.split("\n");

  let start = 0;
  while (start < before.length && start < after.length && before[start] === after[start]) start += 1;

  let endBefore = before.length - 1;
  let endAfter = after.length - 1;
  while (endBefore >= start && endAfter >= start && before[endBefore] === after[endAfter]) {
    endBefore -= 1;
    endAfter -= 1;
  }

  return {
    removed: Math.max(0, endBefore - start + 1),
    added: Math.max(0, endAfter - start + 1),
  };
}

// ── AI caller ─────────────────────────────────────────────────────────────────

async function callAI(prompt: string): Promise<string> {
  const store = useAIStore.getState();
  const {
    selectedProvider, selectedOllamaModels, apiKeys, selectedApiKeyIndices,
    aiServiceMode, ollamaBaseUrl, hfApiKey, hfBaseUrl, hfSelectedModel,
    selectedLocalModel, localModels,
  } = store;

  const messages = [{ role: "user", content: prompt }];

  if (selectedProvider === "ollama") {
    const model = selectedOllamaModels[0];
    if (!model) throw new Error("No Ollama model selected. Configure one in Settings.");
    return invoke<string>("ollama_chat", { model, messages, context: "", baseUrl: ollamaBaseUrl });
  }

  if (selectedProvider === "huggingface") {
    if (!hfApiKey) throw new Error("HuggingFace API key not set.");
    if (aiServiceMode === "grpc") {
      return invoke<string>("grpc_ai_chat", {
        provider: "huggingface", apiKey: hfApiKey, model: hfSelectedModel,
        messages, temperature: 0.3, maxTokens: 32000, baseUrl: hfBaseUrl,
      });
    }
    return invoke<string>("api_chat", {
      provider: "huggingface", apiKey: hfApiKey, model: hfSelectedModel, messages, context: "",
    });
  }

  if (selectedProvider === "local") {
    const info = localModels.find(m => m.modelId === selectedLocalModel);
    const localPath = info ? (info.quantizedPath ?? info.localPath) : selectedLocalModel ?? "";
    if (!localPath) throw new Error("No local model selected.");
    return invoke<string>("grpc_ai_chat", {
      provider: "local", apiKey: null, model: localPath, messages, temperature: 0.3, maxTokens: 32000,
    });
  }

  const keyEntry = apiKeys[selectedApiKeyIndices[0]];
  if (!keyEntry) throw new Error("No API key configured. Add one in Settings → AI/LLM.");

  if (aiServiceMode === "grpc") {
    return invoke<string>("grpc_ai_chat", {
      provider: keyEntry.provider, apiKey: keyEntry.apiKey, model: keyEntry.model,
      messages, temperature: 0.3, maxTokens: 32000,
      ...(keyEntry.baseUrl ? { baseUrl: keyEntry.baseUrl } : {}),
    });
  }

  return invoke<string>("api_chat", {
    provider: keyEntry.provider, apiKey: keyEntry.apiKey, model: keyEntry.model, messages, context: "",
  });
}

// ── Initial state ─────────────────────────────────────────────────────────────

const EMPTY_DOC: SpecDoc = {
  requirements: "", design: "", tasks: [], analysis: null,
  featureName: "", featureQuery: "", createdAt: 0, updatedAt: 0,
};

// ── Store ─────────────────────────────────────────────────────────────────────

export const useSpecStore = create<SpecStore>((set, get) => ({
  phase: "idle",
  query: "",
  startTarget: "requirements",
  doc: EMPTY_DOC,
  taskPreviews: {},
  activeTaskId: null,
  isGenerating: false,
  generatingLabel: "",
  error: null,
  executionLog: [],
  pendingApproval: null,
  autoApprove: false,

  setQuery: (q) => set({ query: q }),
  setAutoApprove: (v) => set({ autoApprove: v }),
  setStartTarget: (target) => set({ startTarget: target }),

  log: (level, text) => set(s => ({
    executionLog: [...s.executionLog, { ts: Date.now(), level, text }],
  })),

  updateRequirements: (content) => set(s => ({
    doc: { ...s.doc, requirements: content, updatedAt: Date.now() },
  })),

  updateDesign: (content) => set(s => ({
    doc: { ...s.doc, design: content, updatedAt: Date.now() },
  })),

  updateTask: (taskId, patch) => set(s => ({
    doc: {
      ...s.doc,
      tasks: s.doc.tasks.map(t => t.id === taskId ? { ...t, ...patch } : t),
    },
  })),

  approveTask: (taskId) => set(s => ({
    doc: {
      ...s.doc,
      tasks: s.doc.tasks.map(t => t.id === taskId ? { ...t, approved: true } : t),
    },
  })),

  approveAllTasks: () => set(s => ({
    doc: {
      ...s.doc,
      tasks: s.doc.tasks.map(t => ({ ...t, approved: true })),
    },
  })),

  approveTaskPreview: async (taskId: string) => {
    const preview = get().taskPreviews[taskId];
    const task = get().doc.tasks.find(t => t.id === taskId);
    if (!preview || !task) return;

    set(s => ({
      activeTaskId: taskId,
      doc: {
        ...s.doc,
        tasks: s.doc.tasks.map(t =>
          t.id === taskId ? { ...t, status: "in_progress" as TaskStatus, error: undefined } : t
        ),
      },
    }));
    get().log("info", `Applying preview for [${task.id}] ${task.title}…`);

    try {
      const appliedFiles: string[] = [];
      const appliedChangeIds: string[] = [];

      for (const change of preview.fileChanges) {
        try {
          const changeId = await useEditorStore.getState().applyAIChangeToFile(
            change.fullPath,
            change.content,
            `[Spec: ${task.title}] ${change.path}`,
            task.dependsOn.flatMap(depId => {
              const depTask = get().doc.tasks.find(t => t.id === depId);
              return depTask?.appliedChangeIds ?? [];
            })
          );
          if (changeId) appliedChangeIds.push(changeId);
          appliedFiles.push(change.path);
          get().log("ok", `  Written: ${change.path}`);
        } catch (e) {
          get().log("warn", `  Could not write ${change.path}: ${String(e)}`);
        }
      }

      for (const cmd of preview.commands) {
        get().log("cmd", `  $ ${cmd}`);
        useTerminalStore.getState().showAndRunCommand(cmd);
        await new Promise(r => setTimeout(r, 800));
      }

      set(s => {
        const nextPreviews = { ...s.taskPreviews };
        delete nextPreviews[taskId];
        return {
          activeTaskId: null,
          taskPreviews: nextPreviews,
          doc: {
            ...s.doc,
            tasks: s.doc.tasks.map(t =>
              t.id === taskId
                ? { ...t, status: "done" as TaskStatus, output: preview.summary, appliedFiles, appliedChangeIds, error: undefined }
                : t
            ),
            updatedAt: Date.now(),
          },
        };
      });
      get().log("ok", `✓ Done: ${task.title} (${appliedFiles.length} files)`);

      const state = get();
      const pendingApproved = state.doc.tasks.filter(t => t.approved && t.status === "pending");
      const allApprovedDone = state.doc.tasks
        .filter(t => t.approved)
        .every(t => t.status === "done" || t.status === "skipped");

      if (allApprovedDone && state.doc.tasks.some(t => t.approved)) {
        set({ phase: "complete" });
        get().log("ok", "🎉 All tasks completed! Feature implementation is done.");
        return;
      }

      if (pendingApproved.length > 0) {
        await get().executeApprovedTasks();
      } else {
        set({ phase: "tasks" });
      }
    } catch (e) {
      set(s => ({
        activeTaskId: null,
        taskPreviews: Object.fromEntries(Object.entries(s.taskPreviews).filter(([id]) => id !== taskId)),
        doc: {
          ...s.doc,
          tasks: s.doc.tasks.map(t =>
            t.id === taskId
              ? { ...t, status: "failed" as TaskStatus, error: String(e) }
              : t
          ),
        },
      }));
      get().log("error", `Failed to apply preview: ${String(e)}`);
    }
  },

  rejectTaskPreview: async (taskId: string, feedback?: string) => {
    const task = get().doc.tasks.find(t => t.id === taskId);
    if (!task) return;
    const note = feedback?.trim() ? `Preview rejected: ${feedback.trim()}` : "Preview rejected by user";

    set(s => {
      const nextPreviews = { ...s.taskPreviews };
      delete nextPreviews[taskId];
      return {
        activeTaskId: null,
        taskPreviews: nextPreviews,
        doc: {
          ...s.doc,
          tasks: s.doc.tasks.map(t =>
            t.id === taskId
              ? {
                  ...t,
                  status: "pending" as TaskStatus,
                  retries: Math.min(t.maxRetries, t.retries + 1),
                  error: note,
                  approved: true,
                  appliedFiles: [],
                  appliedChangeIds: [],
                }
              : t
          ),
        },
      };
    });

    get().log("warn", `${task.title}: ${note}`);
    if (feedback?.trim()) {
      await get().executeTask(taskId);
    }
  },

  skipTask: (taskId) => set(s => ({
    taskPreviews: Object.fromEntries(Object.entries(s.taskPreviews).filter(([id]) => id !== taskId)),
    doc: {
      ...s.doc,
      tasks: s.doc.tasks.map(t => t.id === taskId ? { ...t, status: "skipped" as TaskStatus } : t),
    },
  })),

  resetSpec: () => set({
    phase: "idle", query: "", doc: EMPTY_DOC, activeTaskId: null,
    isGenerating: false, generatingLabel: "", error: null,
    executionLog: [], pendingApproval: null, taskPreviews: {},
  }),

  // ── Main entry point: analyze project + generate everything ──────────────

  startFromQuery: async (query: string, target?: SpecStartTarget) => {
    if (!query.trim()) { set({ error: "Please describe what you want to build." }); return; }
    const runTarget = target ?? get().startTarget;

    set({
      query, startTarget: runTarget, phase: "analyzing", isGenerating: true,
      generatingLabel: "Analyzing project…", error: null,
      executionLog: [], taskPreviews: {}, doc: { ...EMPTY_DOC, featureQuery: query, createdAt: Date.now() },
    });
    get().log("info", `Starting spec for: "${query}"`);

    try {
      // Step 1: Analyze project
      let analysis: ProjectAnalysis = {
        summary: "Unknown project", languages: [], frameworks: [],
        packageManager: "unknown", existingFiles: [], entryPoints: [],
        testFramework: "unknown", buildTool: "unknown", conventions: "", relevantFiles: [],
      };

      const openFolder = useEditorStore.getState().openFolder;

      if (openFolder) {
        get().log("info", `Scanning project at ${openFolder}…`);
        analysis = await analyzeProject(openFolder);
        get().log("ok", `Project: ${analysis.summary}`);
      } else {
        get().log("warn", "No project folder open — generating without project context");
      }

      // Step 2: AI clarification + relevant file detection
      set({ generatingLabel: "Understanding your request…" });
      const analysisResponse = await callAI(buildAnalysisPrompt(query, analysis));

      let featureName = query.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "").slice(0, 40);
      let clarifiedGoal = query;
      let approach = "";

      try {
        const jsonMatch = analysisResponse.match(/```(?:json)?\s*([\s\S]*?)```/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[1]) as {
            featureName?: string; clarifiedGoal?: string;
            relevantFiles?: string[]; approach?: string;
          };
          if (parsed.featureName) featureName = parsed.featureName;
          if (parsed.clarifiedGoal) clarifiedGoal = parsed.clarifiedGoal;
          if (parsed.relevantFiles) analysis.relevantFiles = parsed.relevantFiles;
          if (parsed.approach) approach = parsed.approach;
        }
      } catch { /* use defaults */ }

      get().log("ok", `Feature: "${featureName}" — ${clarifiedGoal.slice(0, 80)}`);

      set(s => ({ doc: { ...s.doc, featureName, analysis } }));

      // Step 3: Requirements
      set({ phase: "requirements", generatingLabel: "Writing requirements…" });
      get().log("info", "Generating requirements document…");

      const reqsResponse = await callAI(
        buildRequirementsPrompt(query, featureName, clarifiedGoal, analysis, approach)
      );

      set(s => ({
        doc: { ...s.doc, requirements: reqsResponse, updatedAt: Date.now() },
        isGenerating: false,
        generatingLabel: "",
        pendingApproval: "requirements",
      }));
      get().log("ok", "Requirements ready — review and approve to continue");

      if (get().autoApprove) await get().approveAndContinue();

    } catch (e) {
      set({ isGenerating: false, generatingLabel: "", error: String(e), phase: "idle" });
      get().log("error", `Failed: ${String(e)}`);
    }
  },

  // ── Approve current phase and advance ────────────────────────────────────

  approveAndContinue: async () => {
    const { pendingApproval, doc } = get();

    if (pendingApproval === "requirements") {
      set({ isGenerating: true, generatingLabel: "Writing technical design…", pendingApproval: null, phase: "design" });
      get().log("info", "Generating technical design…");

      try {
        const response = await callAI(
          buildDesignPrompt(doc.featureName, doc.requirements, doc.analysis!)
        );
        set(s => ({
          doc: { ...s.doc, design: response, updatedAt: Date.now() },
          isGenerating: false, generatingLabel: "",
          pendingApproval: "design",
        }));
        get().log("ok", "Design ready — review and approve to generate tasks");
        if (get().autoApprove) {
          await get().approveAndContinue();
        }
      } catch (e) {
        set({ isGenerating: false, generatingLabel: "", error: String(e) });
        get().log("error", `Design failed: ${String(e)}`);
      }
      return;
    }

    if (pendingApproval === "design") {
      set({ isGenerating: true, generatingLabel: "Creating implementation tasks…", pendingApproval: null, phase: "tasks" });
      get().log("info", "Generating task list…");

      try {
        const response = await callAI(
          buildTasksPrompt(doc.featureName, doc.requirements, doc.design, doc.analysis!)
        );
        const tasks = parseTasksFromResponse(response);
        if (tasks.length === 0) throw new Error("Could not parse tasks — AI response was not valid JSON");

        set(s => ({
          doc: { ...s.doc, tasks, updatedAt: Date.now() },
          isGenerating: false, generatingLabel: "",
          pendingApproval: "tasks",
        }));
        get().log("ok", `${tasks.length} tasks generated — review and approve to execute`);
        if (get().autoApprove) {
          get().approveAllTasks();
          await get().executeApprovedTasks();
        }
      } catch (e) {
        set({ isGenerating: false, generatingLabel: "", error: String(e) });
        get().log("error", `Task generation failed: ${String(e)}`);
      }
      return;
    }

    if (pendingApproval === "tasks") {
      get().approveAllTasks();
      set({ pendingApproval: null });
      await get().executeApprovedTasks();
    }
  },

  // ── Reject and regenerate with feedback ──────────────────────────────────

  rejectAndRegenerate: async (feedback?: string) => {
    const { pendingApproval, doc } = get();

    if (pendingApproval === "requirements") {
      set({ isGenerating: true, generatingLabel: "Regenerating requirements…", pendingApproval: null });
      get().log("info", `Regenerating requirements${feedback ? ` with feedback: ${feedback}` : ""}…`);
      try {
        const prompt = buildRequirementsPrompt(
          doc.featureQuery, doc.featureName,
          feedback ?? doc.featureQuery, doc.analysis!,
          feedback ?? ""
        );
        const response = await callAI(prompt);
        set(s => ({
          doc: { ...s.doc, requirements: response, updatedAt: Date.now() },
          isGenerating: false, generatingLabel: "", pendingApproval: "requirements",
        }));
        get().log("ok", "Requirements regenerated");
      } catch (e) {
        set({ isGenerating: false, generatingLabel: "", error: String(e) });
      }
      return;
    }

    if (pendingApproval === "design") {
      set({ isGenerating: true, generatingLabel: "Regenerating design…", pendingApproval: null });
      get().log("info", `Regenerating design${feedback ? ` with feedback: ${feedback}` : ""}…`);
      try {
        const response = await callAI(
          buildDesignPrompt(doc.featureName, doc.requirements, doc.analysis!, feedback)
        );
        set(s => ({
          doc: { ...s.doc, design: response, updatedAt: Date.now() },
          isGenerating: false, generatingLabel: "", pendingApproval: "design",
        }));
        get().log("ok", "Design regenerated");
      } catch (e) {
        set({ isGenerating: false, generatingLabel: "", error: String(e) });
      }
      return;
    }

    if (pendingApproval === "tasks") {
      set({ isGenerating: true, generatingLabel: "Regenerating tasks…", pendingApproval: null });
      get().log("info", "Regenerating tasks…");
      try {
        const response = await callAI(
          buildTasksPrompt(doc.featureName, doc.requirements, doc.design, doc.analysis!)
        );
        const tasks = parseTasksFromResponse(response);
        set(s => ({
          doc: { ...s.doc, tasks, updatedAt: Date.now() },
          isGenerating: false, generatingLabel: "", pendingApproval: "tasks",
        }));
        get().log("ok", `${tasks.length} tasks regenerated`);
      } catch (e) {
        set({ isGenerating: false, generatingLabel: "", error: String(e) });
      }
    }
  },

  // ── Execute all approved tasks sequentially ───────────────────────────────

  executeApprovedTasks: async () => {
    const { doc, taskPreviews } = get();
    const pendingPreviewTask = Object.keys(taskPreviews)[0];
    if (pendingPreviewTask) {
      get().log("warn", "Approve or reject the pending task preview before running more tasks.");
      set({ phase: "tasks" });
      return;
    }

    const toRun = doc.tasks.filter(t => t.approved && t.status === "pending");
    if (toRun.length === 0) {
      get().log("warn", "No approved tasks to execute. Approve tasks first.");
      return;
    }

    set({ phase: "executing", pendingApproval: null, error: null });
    get().log("info", `Executing ${toRun.length} approved tasks…`);

    for (const task of toRun) {
      // Check dependencies
      const { doc: currentDoc } = get();
      const depsOk = task.dependsOn.every(depId => {
        const dep = currentDoc.tasks.find(t => t.id === depId);
        return dep?.status === "done" || dep?.status === "skipped";
      });

      if (!depsOk) {
        get().log("warn", `Skipping "${task.title}" — dependencies not met`);
        continue;
      }

      await get().executeTask(task.id);

      const afterTask = get().doc.tasks.find(t => t.id === task.id);
      if (afterTask?.status === "review") {
        get().log("info", `Awaiting approval for generated changes in "${task.title}"`);
        set({ phase: "tasks" });
        return;
      }
      if (afterTask?.status === "failed") {
        get().log("error", `Stopped at "${task.title}" — fix the error and retry`);
        set({ phase: "tasks" });
        return;
      }
    }

    const allDone = get().doc.tasks.filter(t => t.approved).every(
      t => t.status === "done" || t.status === "skipped"
    );

    if (allDone) {
      set({ phase: "complete" });
      get().log("ok", "🎉 All tasks completed! Feature implementation is done.");
    } else {
      set({ phase: "tasks" });
    }
  },

  // ── Execute a single task ─────────────────────────────────────────────────

  executeTask: async (taskId: string) => {
    const { doc } = get();
    const task = doc.tasks.find(t => t.id === taskId);
    if (!task) return;

    set(s => ({
      activeTaskId: taskId,
      doc: {
        ...s.doc,
        tasks: s.doc.tasks.map(t =>
          t.id === taskId
            ? { ...t, status: "in_progress" as TaskStatus, error: undefined, appliedFiles: [], appliedChangeIds: [] }
            : t
        ),
      },
    }));
    get().log("info", `▶ [${task.id}] ${task.title}`);

    try {
      const openFolder = useEditorStore.getState().openFolder;

      // Read existing file contents for context
      const existingFileContents: Record<string, string> = {};
      for (const fp of task.filePaths.slice(0, 5)) {
        if (openFolder) {
          try {
            const content = await invoke<string>("read_file", { path: `${openFolder}/${fp}` });
            existingFileContents[fp] = content;
          } catch { /* file doesn't exist yet */ }
        }
      }

      // Build completed task summary
      const completedSummary = doc.tasks
        .filter(t => t.status === "done")
        .map(t => `✓ ${t.title}${t.appliedFiles.length ? ` → ${t.appliedFiles.join(", ")}` : ""}`)
        .join("\n");

      const retryError = task.retries > 0 ? task.error : undefined;

      const prompt = buildTaskExecutionPrompt(
        task, doc.featureName, doc.requirements, doc.design,
        completedSummary, doc.analysis!, existingFileContents, retryError
      );

      const response = await callAI(prompt);

      // Check for explicit failure
      const failedMatch = response.match(/<task_failed>([\s\S]*?)<\/task_failed>/);
      if (failedMatch) throw new Error(failedMatch[1].trim());

      // Generate change preview first (approval gate before applying)
      const fileChanges = extractFileChanges(response);
      const previewChanges: TaskFileChangePreview[] = [];
      for (const { path, content } of fileChanges) {
        const fullPath = openFolder ? `${openFolder}/${path}` : path;
        let previousContent = "";
        let existedBefore = false;
        try {
          previousContent = await invoke<string>("read_file", { path: fullPath });
          existedBefore = true;
        } catch {
          existedBefore = false;
        }
        const delta = countLineDelta(previousContent, content);
        previewChanges.push({
          path,
          fullPath,
          content,
          existedBefore,
          directory: dirname(path),
          addedLines: delta.added,
          removedLines: delta.removed,
          diffPreview: buildQuickPatch(previousContent, content),
        });
      }

      const execMatches = Array.from(response.matchAll(/<execute>([\s\S]*?)<\/execute>/g));
      const commands = execMatches
        .map(match => match[1].trim())
        .filter(cmd => cmd.length > 0);

      // Extract completion summary
      const completeMatch = response.match(/<task_complete>([\s\S]*?)<\/task_complete>/);
      const summary = completeMatch ? completeMatch[1].trim() : `${fileChanges.length} files prepared`;
      const folderChanges = Array.from(new Set(previewChanges
        .filter(change => !change.existedBefore && change.directory)
        .map(change => change.directory)));

      set(s => ({
        activeTaskId: null,
        taskPreviews: {
          ...s.taskPreviews,
          [taskId]: {
            taskId,
            summary,
            fileChanges: previewChanges,
            commands,
            folderChanges,
            rawResponse: response,
            generatedAt: Date.now(),
          },
        },
        doc: {
          ...s.doc,
          tasks: s.doc.tasks.map(t =>
            t.id === taskId
              ? { ...t, status: "review" as TaskStatus, output: summary, error: undefined }
              : t
          ),
          updatedAt: Date.now(),
        },
      }));

      get().log("ok", `Preview ready: ${task.title} (${previewChanges.length} files, ${commands.length} commands)`);
      if (get().autoApprove) {
        await get().approveTaskPreview(taskId);
      }

    } catch (e) {
      const errorMsg = String(e);
      const newRetries = task.retries + 1;
      const exhausted = newRetries >= task.maxRetries;

      set(s => ({
        activeTaskId: null,
        doc: {
          ...s.doc,
          tasks: s.doc.tasks.map(t =>
            t.id === taskId
              ? { ...t, status: "failed" as TaskStatus, retries: newRetries, error: errorMsg }
              : t
          ),
        },
        error: exhausted ? `"${task.title}" failed after ${newRetries} attempts` : null,
      }));
      get().log("error", `✗ Failed (${newRetries}/${task.maxRetries}): ${errorMsg.slice(0, 120)}`);
    }
  },

  // ── Retry a failed task ───────────────────────────────────────────────────

  retryTask: async (taskId: string) => {
    set(s => ({
      taskPreviews: Object.fromEntries(Object.entries(s.taskPreviews).filter(([id]) => id !== taskId)),
      doc: {
        ...s.doc,
        tasks: s.doc.tasks.map(t =>
          t.id === taskId ? { ...t, status: "pending" as TaskStatus, approved: true } : t
        ),
      },
      error: null,
    }));
    get().log("info", `Retrying task ${taskId}…`);
    await get().executeTask(taskId);
  },
}));
