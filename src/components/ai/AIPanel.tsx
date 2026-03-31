// src/components/ai/AIPanel.tsx
import { useState, useRef, useEffect, useMemo } from "react";
import {
  Send, Trash2, Database, Zap, ChevronDown, ExternalLink,
  Eye, EyeOff, Undo2, Check, X, StopCircle, Cpu, RefreshCw,
  Terminal, FileCode, Sparkles, Plus, MessageSquare, ChevronLeft,
  Bug, AlertTriangle, AlertCircle, Info, FileText, AtSign, Folder,
  Search, Download,
} from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { listen, emit } from "@tauri-apps/api/event";
import { useAIStore, CONTEXT_LIMITS, estimateMessagesTokenCount } from "../../store/aiStore";
import type { BugReport, BugEntry } from "../../store/aiStore";
import { useEditorStore } from "../../store/editorStore";
import { useUIStore } from "../../store/uiStore";
import { useTerminalStore } from "../../store/terminalStore";
import { readTextFile } from "@tauri-apps/plugin-fs";
import { DiffModal } from "./DiffModal";
import { marked } from "marked";
import DOMPurify from "dompurify";
import { countThinkingSteps } from "../../utils/parseThinkingBlock";
import { validatePromptTemplateContent } from "../../utils/promptTemplateValidation";

type FileSuggestion = { path: string; content: string; language: string };
type ArchitectureSectionKey = "Structure" | "Metrics" | "Risks" | "Improvements";

const ARCHITECTURE_SECTION_ORDER: ArchitectureSectionKey[] = [
  "Structure",
  "Metrics",
  "Risks",
  "Improvements",
];

interface AgentStepEvent {
  step: number;
  tool: string;
  args: Record<string, unknown>;
  result: string;
  ts: number;
}

const fileExistsCache = new Map<string, boolean>();
async function checkFileExistsCached(path: string): Promise<boolean> {
  if (!path) return false;
  if (fileExistsCache.has(path)) return fileExistsCache.get(path)!;
  try {
    const exists = await invoke<boolean>("check_file_exists", { path });
    fileExistsCache.set(path, exists);
    return exists;
  } catch { return false; }
}

function extractFirstCodeBlock(md: string): string | null {
  const m = md.match(/```(?:[\w.+-]+)?\n([\s\S]*?)```/);
  return m ? m[1].trimEnd() : null;
}

function extractShellCommands(md: string): string[] {
  const cmds: string[] = [];
  const re = /```(bash|sh|shell|zsh)\n([\s\S]*?)```/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(md)) !== null) {
    const block = m[2].trim();
    if (!block) continue;
    if ((block.startsWith("{") && block.endsWith("}")) || (block.startsWith("[") && block.endsWith("]"))) continue;
    const lines = block.split("\n").map(l => l.trim()).filter(l => l && !l.startsWith("#"));
    if (!lines.length) continue;
    const allDollar = lines.every(l => l.startsWith("$"));
    if (allDollar) { cmds.push(...lines.map(l => l.replace(/^\$\s*/, ""))); continue; }
    const isComplex = lines.some(l => l.endsWith("\\") || l.includes("{") || l.includes("}") || l.startsWith("if ") || l.startsWith("for "));
    if (isComplex) cmds.push(block);
    else cmds.push(...lines.map(l => l.replace(/^\$\s*/, "")));
  }
  return cmds.slice(0, 6);
}

function cleanPath(raw: string): string {
  return raw.trim()
    .replace(/^[-*]\s*/, "").replace(/^###\s*/i, "")
    .replace(/^`|`$/g, "").replace(/^\*\*|\*\*$/g, "")
    .replace(/^["']|["']$/g, "").replace(/^\.\//, "")
    .replace(/\s+\(.*\)$/, "");
}

function inferLang(path: string): string {
  const ext = cleanPath(path).toLowerCase().split(".").pop() || "";
  const map: Record<string, string> = {
    ts:"typescript",tsx:"tsx",js:"javascript",jsx:"jsx",py:"python",rs:"rust",
    go:"go",java:"java",cpp:"cpp",c:"c",cs:"csharp",rb:"ruby",php:"php",
    swift:"swift",kt:"kotlin",html:"html",css:"css",scss:"scss",json:"json",
    yaml:"yaml",yml:"yaml",toml:"toml",md:"markdown",sh:"bash",bash:"bash",
    sql:"sql",vue:"vue",svelte:"svelte",xml:"xml",
  };
  return map[ext] || "text";
}

function looksLikePath(v: string): boolean {
  const c = cleanPath(v);
  if (!c) return false;
  if (c.includes(" ") && !c.includes("/")) return false;
  return /[\\/]/.test(c) || /\.[A-Za-z0-9_-]{1,12}$/.test(c);
}

function findPathNear(md: string, idx: number): string | null {
  const before = md.slice(Math.max(0, idx - 360), idx);
  const patterns = [
    /(?:^|\n)\s*(?:#{1,6}\s*)?(?:file|path)\s*:\s*`?([^\n`]+)`?\s*$/gi,
    /(?:^|\n)\s*(?:[-*]\s*)?`([^`\n]+\.[A-Za-z0-9._/-]+)`\s*:?\s*$/gi,
    /(?:^|\n)\s*(?:[-*]\s*)?\*\*([^*\n]+\.[A-Za-z0-9._/-]+)\*\*\s*:?\s*$/gi,
    /(?:^|\n)\s*(?:[-*]\s*)?([A-Za-z0-9_./\\-]+\.[A-Za-z0-9_.-]+)\s*:?\s*$/gi,
  ];
  for (const re of patterns) {
    let m: RegExpExecArray | null, last: string | null = null;
    while ((m = re.exec(before)) !== null) last = m[1];
    if (last && looksLikePath(last)) return cleanPath(last);
  }
  return null;
}

function extractFileSuggestions(md: string): FileSuggestion[] {
  const out: FileSuggestion[] = [];
  const seen = new Set<string>();
  const push = (path: string, content: string, language?: string) => {
    const c = cleanPath(path);
    if (!c || !content.trim()) return;
    const key = c.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ path: c, content: content.trimEnd(), language: (language || "").trim() || "text" });
  };
  let m: RegExpExecArray | null;
  const variants = [
    /(?:^|\n)(?:#{1,6}\s*)?file\s*:\s*`?([^\n`]+?)`?\s*\n```([\w.+-]*)\n([\s\S]*?)```/gi,
    /(?:^|\n)(?:#{1,6}\s*)?path\s*:\s*`?([^\n`]+?)`?\s*\n```([\w.+-]*)\n([\s\S]*?)```/gi,
    /(?:^|\n)#{1,6}\s*`?([^\n`]+\.[\w.-]+)`?\s*\n```([\w.+-]*)\n([\s\S]*?)```/gi,
  ];
  for (const re of variants) while ((m = re.exec(md)) !== null) push(m[1], m[3], m[2]);
  const infoPath = /```([\w.+-]+)\s+([^\n`]+\.[\w.-]+)\n([\s\S]*?)```/gi;
  while ((m = infoPath.exec(md)) !== null) push(m[2], m[3], m[1]);
  const infoOnly = /```([^\n`\s]+\.[A-Za-z0-9_.-]+)\n([\s\S]*?)```/gi;
  while ((m = infoOnly.exec(md)) !== null) if (looksLikePath(m[1])) push(m[1], m[2], inferLang(m[1]));
  const generic = /```([\w.+-]*)\n([\s\S]*?)```/gi;
  while ((m = generic.exec(md)) !== null) {
    const info = (m[1] || "").trim();
    let path: string | null = null, lang = info;
    if (info && looksLikePath(info)) { path = info; lang = inferLang(info); }
    else { path = findPathNear(md, m.index); if (path && !lang) lang = inferLang(path); }
    if (path) push(path, m[2], lang);
  }
  return out.slice(0, 12);
}

function detectArchitectureHeading(line: string): { key: ArchitectureSectionKey; trailing: string } | null {
  const cleaned = line
    .trim()
    .replace(/^[-*]\s*/, "")
    .replace(/^\d+\.\s*/, "")
    .replace(/^#{1,6}\s*/, "")
    .replace(/\*\*/g, "")
    .replace(/`/g, "")
    .replace(/^[^A-Za-z0-9]+/, "");

  const match = cleaned.match(/^(structure|metrics?|risks?|improvements?)\s*[:\-]?\s*(.*)$/i);
  if (!match) return null;

  const raw = match[1].toLowerCase();
  const trailing = (match[2] || "").trim();
  const key: ArchitectureSectionKey =
    raw.startsWith("structure")
      ? "Structure"
      : raw.startsWith("metric")
        ? "Metrics"
        : raw.startsWith("risk")
          ? "Risks"
          : "Improvements";

  return { key, trailing };
}

function extractArchitectureSections(
  markdown: string,
  forceForArchitectMode = false
): { sections: Record<ArchitectureSectionKey, string>; remainder: string } | null {
  const buckets: Record<ArchitectureSectionKey, string[]> = {
    Structure: [],
    Metrics: [],
    Risks: [],
    Improvements: [],
  };
  const remainder: string[] = [];
  let active: ArchitectureSectionKey | null = null;
  let foundHeading = false;

  for (const line of markdown.split("\n")) {
    const heading = detectArchitectureHeading(line);
    if (heading) {
      active = heading.key;
      foundHeading = true;
      if (heading.trailing) buckets[heading.key].push(heading.trailing);
      continue;
    }

    if (active) buckets[active].push(line);
    else remainder.push(line);
  }

  if (!foundHeading && !forceForArchitectMode) return null;

  const sections = ARCHITECTURE_SECTION_ORDER.reduce((acc, key) => {
    const joined = buckets[key].join("\n").trim();
    if (joined) acc[key] = joined;
    else if (forceForArchitectMode && key === "Structure") acc[key] = markdown.trim();
    else acc[key] = "_No explicit details provided._";
    return acc;
  }, {} as Record<ArchitectureSectionKey, string>);

  const cleanedRemainder = remainder.join("\n").trim();
  const hideRemainder = forceForArchitectMode && cleanedRemainder === markdown.trim();

  return {
    sections,
    remainder: hideRemainder ? "" : cleanedRemainder,
  };
}

function isAbsPath(p: string) { return p.startsWith("/") || /^[A-Za-z]:[\\/]/.test(p); }
function resolvePath(path: string, folder: string | null): string | null {
  const n = cleanPath(path).replace(/\\/g, "/");
  if (!n) return null;
  if (isAbsPath(n)) return n;
  if (!folder) return null;
  return `${folder.replace(/[\\/]+$/, "")}/${n.replace(/^\.?\//, "")}`;
}

// ── Architecture section icons ───────────────────────────────
const ARCHITECTURE_SECTION_ICONS: Record<ArchitectureSectionKey, React.ReactNode> = {
  Structure: <span aria-hidden="true">🏗️</span>,
  Metrics: <span aria-hidden="true">📊</span>,
  Risks: <span aria-hidden="true">⚠️</span>,
  Improvements: <span aria-hidden="true">💡</span>,
};

interface ArchitectureSectionsViewProps {
  sections: Record<ArchitectureSectionKey, string>;
  remainder: string;
  renderMarkdown: (content: string) => string;
}

function ArchitectureSectionsView({ sections, remainder, renderMarkdown }: ArchitectureSectionsViewProps) {
  return (
    <div className="aip-architecture">
      {ARCHITECTURE_SECTION_ORDER.map((section) => (
        <details key={section} className="aip-arch-section">
          <summary className="aip-arch-toggle">
            {ARCHITECTURE_SECTION_ICONS[section]} {section}
          </summary>
          <div
            className="aip-arch-body"
            dangerouslySetInnerHTML={{ __html: renderMarkdown(sections[section]) }}
          />
        </details>
      ))}
      {remainder && (
        <div
          className="aip-msg-body"
          dangerouslySetInnerHTML={{ __html: renderMarkdown(remainder) }}
        />
      )}
    </div>
  );
}

// ── Dependency graph helpers ─────────────────────────────────

interface DependencyMap {
  dependency_map: Record<string, string[]>;
  circular_dependencies: string[][];
  import_count?: number;
  internal_edge_count?: number;
}

function parseDependencyMap(content: string): DependencyMap | null {
  // Look for ```json blocks containing dependency_map key
  const jsonBlockRe = /```json\s*([\s\S]*?)```/gi;
  let m: RegExpExecArray | null;
  while ((m = jsonBlockRe.exec(content)) !== null) {
    try {
      const parsed = JSON.parse(m[1]) as unknown;
      if (
        parsed &&
        typeof parsed === "object" &&
        "dependency_map" in (parsed as object) &&
        "circular_dependencies" in (parsed as object)
      ) {
        return parsed as DependencyMap;
      }
    } catch { /* not valid JSON */ }
  }
  return null;
}

interface DependencyGraphViewProps {
  depMap: DependencyMap;
}

function DependencyGraphView({ depMap }: DependencyGraphViewProps) {
  const { dependency_map, circular_dependencies } = depMap;

  // Build a set of files involved in circular deps for quick lookup
  const circularFiles = new Set<string>();
  for (const cycle of circular_dependencies) {
    for (const f of cycle) circularFiles.add(f);
  }

  const files = Object.keys(dependency_map).sort();

  return (
    <details className="aip-dep-graph">
      <summary className="aip-dep-graph-toggle">
        <span aria-hidden="true">🔗</span> Dependency Graph
        {circular_dependencies.length > 0 && (
          <span className="aip-dep-circular-badge" title="Circular dependencies detected">
            ⚠ {circular_dependencies.length} circular
          </span>
        )}
      </summary>
      <div className="aip-dep-graph-body">
        {files.length === 0 ? (
          <div className="aip-dep-empty">No dependency data available.</div>
        ) : (
          <div className="aip-dep-tree">
            {files.map((file) => {
              const deps = dependency_map[file] || [];
              const isCircular = circularFiles.has(file);
              return (
                <div key={file} className={`aip-dep-node ${isCircular ? "aip-dep-circular" : ""}`}>
                  <span className="aip-dep-file" title={isCircular ? "Involved in circular dependency" : undefined}>
                    {isCircular && <span aria-hidden="true">⚠ </span>}
                    {file}
                  </span>
                  {deps.length > 0 && (
                    <div className="aip-dep-children">
                      {deps.map((dep) => (
                        <div key={dep} className={`aip-dep-child ${circularFiles.has(dep) ? "aip-dep-circular" : ""}`}>
                          └─ {dep}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
        {circular_dependencies.length > 0 && (
          <div className="aip-dep-cycles">
            <strong>Circular Dependencies:</strong>
            {circular_dependencies.map((cycle, i) => (
              <div key={i} className="aip-dep-cycle">
                ⚠ {cycle.join(" → ")}
              </div>
            ))}
          </div>
        )}
      </div>
    </details>
  );
}

// ── Bug report helpers ───────────────────────────────────────
const SEVERITY_ORDER: Record<BugEntry["severity"], number> = {
  critical: 0, high: 1, medium: 2, low: 3,
};

const SEVERITY_ICON: Record<BugEntry["severity"], React.ReactNode> = {
  critical: <AlertCircle size={11} />,
  high: <AlertTriangle size={11} />,
  medium: <AlertTriangle size={11} />,
  low: <Info size={11} />,
};

interface BugReportViewProps {
  report: BugReport;
  openFolder: string | null;
  onShowFix: (bug: BugEntry) => void;
}

function BugReportView({ report, openFolder, onShowFix }: BugReportViewProps) {
  const sorted = [...report.bugs].sort(
    (a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]
  );
  const { summary } = report;
  const total = summary.critical + summary.high + summary.medium + summary.low;

  return (
    <div className="bug-report">
      {/* Summary bar (Req 5.5) */}
      <div className="bug-report-summary">
        {total === 0 ? (
          <span className="bug-report-none">✓ No issues found</span>
        ) : (
          <>
            <span className="bug-report-total">{total} issue{total !== 1 ? "s" : ""}</span>
            {summary.critical > 0 && <span className="bug-badge critical">{summary.critical} critical</span>}
            {summary.high > 0 && <span className="bug-badge high">{summary.high} high</span>}
            {summary.medium > 0 && <span className="bug-badge medium">{summary.medium} medium</span>}
            {summary.low > 0 && <span className="bug-badge low">{summary.low} low</span>}
          </>
        )}
      </div>

      {/* Bug cards sorted by severity (Req 5.3) */}
      {sorted.map((bug, i) => (
        <div key={i} className={`bug-card bug-card-${bug.severity}`}>
          <div className="bug-card-header">
            <span className={`bug-badge ${bug.severity}`}>
              {SEVERITY_ICON[bug.severity]} {bug.severity}
            </span>
            <span className="bug-card-location">
              <FileCode size={10} />
              {bug.filePath}{bug.line > 0 ? `:${bug.line}` : ""}
            </span>
          </div>
          <p className="bug-card-desc">{bug.description}</p>
          {bug.fix && (
            <div className="bug-card-actions">
              {/* Show Fix wires to DiffModal (Req 5.4) */}
              <button
                className="aip-action-btn"
                onClick={() => onShowFix(bug)}
                title="View suggested fix"
              >
                <Eye size={11} /> Show Fix
              </button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ── Local Models helpers ─────────────────────────────────────
function formatBytes(bytes: number): string {
  if (bytes === 0) return "unknown";
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`;
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(0)} MB`;
  return `${(bytes / 1e3).toFixed(0)} KB`;
}

// ── Mode config ──────────────────────────────────────────────
const MODES = [  { id: "chat",      label: "Chat",    emoji: null,  title: "Direct answers" },
  { id: "think",     label: "Think",   emoji: null,  title: "Step-by-step reasoning" },
  { id: "agent",     label: "Agent",   emoji: null,  title: "Plan + file-level actions" },
  { id: "bug_hunt",  label: "Bugs",    emoji: "🐛",  title: "Find bugs & vulnerabilities" },
  { id: "architect", label: "Arch",    emoji: "🏗️", title: "Architecture review" },
] as const;

export function AIPanel() {
  const [applyingMessageId, setApplyingMessageId] = useState<string | null>(null);
  const [applyingFileKey, setApplyingFileKey] = useState<string | null>(null);
  const [fileExistenceMap, setFileExistenceMap] = useState<Record<string, boolean>>({});
  const [rejectedMsgIds, setRejectedMsgIds] = useState<Set<string>>(new Set());
  const [rejectedFileKeys, setRejectedFileKeys] = useState<Set<string>>(new Set());
  const [rejectedCmdKeys, setRejectedCmdKeys] = useState<Set<string>>(new Set());
  const [rollingBack, setRollingBack] = useState(false);
  const [input, setInput] = useState("");
  const [showModelSelect, setShowModelSelect] = useState(false);
  const [agentSteps, setAgentSteps] = useState<AgentStepEvent[]>([]);
  const [sessionSearch, setSessionSearch] = useState("");
  const [confirmPending, setConfirmPending] = useState<{
    confirmId: string;
    path: string;
    diff: string;
    tool: string;
  } | null>(null);
  const [diffModalData, setDiffModalData] = useState<{
    isOpen: boolean; suggestionKey: string; originalPath: string;
    originalContent: string; modifiedContent: string; onAccept: () => void;
  }>({ isOpen: false, suggestionKey: "", originalPath: "", originalContent: "", modifiedContent: "", onAccept: () => {} });

  // @-mention autocomplete state (Task 7.1)
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionDropdown, setMentionDropdown] = useState<string[]>([]);
  const [mentionDropdownIdx, setMentionDropdownIdx] = useState(0);
  const [mentionWarning, setMentionWarning] = useState<string | null>(null);
  const mentionDropdownRef = useRef<HTMLDivElement>(null);

  // Prompts panel state (Task 6.7)
  const [showPromptsPanel, setShowPromptsPanel] = useState(false);
  const [promptTemplates, setPromptTemplates] = useState<Array<{ name: string; content: string }>>([]);
  const [selectedPromptName, setSelectedPromptName] = useState<string | null>(null);
  const [promptEditorContent, setPromptEditorContent] = useState("");
  const [newPromptName, setNewPromptName] = useState("");
  const [savingPrompt, setSavingPrompt] = useState(false);

  // HuggingFace inline error state (Task 10.1)
  const [hfTokenError, setHfTokenError] = useState(false);

  // Custom provider form state (Task 11.1)
  const [customProviderName, setCustomProviderName] = useState("");
  const [customProviderBaseUrl, setCustomProviderBaseUrl] = useState("");
  const [customProviderApiKey, setCustomProviderApiKey] = useState("");
  const [customProviderModel, setCustomProviderModel] = useState("");
  const [customProviderUrlError, setCustomProviderUrlError] = useState("");
  const [customProviderSuccess, setCustomProviderSuccess] = useState(false);

  // TurboQuant panel state (Task 12.1)
  const [showTurboQuant, setShowTurboQuant] = useState(false);
  const [tqModelId, setTqModelId] = useState("");
  const [tqMethod, setTqMethod] = useState<"GGUF" | "GPTQ" | "AWQ">("GGUF");
  const [tqBits, setTqBits] = useState<4 | 8>(4);

  // Local Models tab state
  const [showLocalModels, setShowLocalModels] = useState(false);
  const [localHfTokenVisible, setLocalHfTokenVisible] = useState(false);
  const [localSearchQuery, setLocalSearchQuery] = useState("");
  const [localSearchTask, setLocalSearchTask] = useState("text-generation");
  const [localSearchMaxSize, setLocalSearchMaxSize] = useState("");
  const [localSearchDebounceTimer, setLocalSearchDebounceTimer] = useState<ReturnType<typeof setTimeout> | null>(null);

  // Show Fix handler for bug report cards (Req 5.4)
  const handleShowFix = async (bug: BugEntry) => {
    const rp = resolvePath(bug.filePath, openFolder ?? null);
    let originalContent = "";
    if (rp) {
      try { originalContent = await readTextFile(rp); } catch { /* file may not exist */ }
    }
    setDiffModalData({
      isOpen: true,
      suggestionKey: `bug-fix-${bug.filePath}-${bug.line}`,
      originalPath: rp ?? bug.filePath,
      originalContent,
      modifiedContent: bug.fix,
      onAccept: async () => {
        if (!rp) { addToast("Open a project folder first.", "warning"); return; }
        try {
          await applyAIChangeToFile(rp, bug.fix, `Bug fix: ${bug.description}`);
          addToast("Fix applied.", "success");
        } catch (e) {
          addToast(`Failed to apply fix: ${String(e)}`, "error");
        }
        setDiffModalData(p => ({ ...p, isOpen: false }));
      },
    });
  };

  // Prompts panel handlers (Task 6.7)
  const loadPromptTemplates = async () => {
    if (!openFolder) return;
    try {
      const templates = await invoke<Array<{ name: string; content: string }>>("list_prompt_templates", { projectRoot: openFolder });
      setPromptTemplates(templates);
    } catch (e) {
      addToast(`Failed to load templates: ${String(e)}`, "error");
    }
  };

  const handleOpenPromptsPanel = async () => {
    setShowPromptsPanel(true);
    await loadPromptTemplates();
  };

  const handleSelectPrompt = (name: string, content: string) => {
    setSelectedPromptName(name);
    setPromptEditorContent(content);
    setNewPromptName("");
  };

  const handleSavePrompt = async () => {
    if (!openFolder) { addToast("Open a project folder first.", "warning"); return; }
    const name = newPromptName.trim() || selectedPromptName;
    if (!name) { addToast("Enter a template name.", "warning"); return; }
    const validationError = validatePromptTemplateContent(promptEditorContent);
    if (validationError) { addToast(validationError, "error"); return; }
    setSavingPrompt(true);
    try {
      await invoke("save_prompt_template", { projectRoot: openFolder, name, content: promptEditorContent });
      addToast(`Template "${name}" saved.`, "success");
      setSelectedPromptName(name);
      setNewPromptName("");
      await loadPromptTemplates();
    } catch (e) {
      addToast(`Failed to save template: ${String(e)}`, "error");
    } finally {
      setSavingPrompt(false);
    }
  };

  const handleNewTemplate = () => {
    setSelectedPromptName(null);
    setPromptEditorContent("");
    setNewPromptName("");
  };

  // ── @-mention helpers (Task 7.1, 7.4, 7.5) ──────────────────────────────
  const buildMentionSuggestions = async (query: string): Promise<string[]> => {
    const special = ["@folder", "@errors"];
    const suggestions: string[] = [];

    // Special keywords
    for (const s of special) {
      if (s.startsWith(`@${query}`) || query === "") suggestions.push(s);
    }

    // Open tabs
    for (const tab of tabs) {
      const name = tab.fileName || tab.id;
      if (!query || name.toLowerCase().includes(query.toLowerCase())) {
        suggestions.push(tab.filePath || tab.fileName || tab.id);
      }
    }

    // Project files from open folder
    if (openFolder) {
      try {
        type FileEntry = { name: string; path: string; is_dir: boolean; children?: FileEntry[] };
        const entries = await invoke<FileEntry[]>("read_dir_recursive", { path: openFolder, depth: 3 });
        const flatten = (items: FileEntry[]): string[] =>
          items.flatMap(e => e.is_dir ? flatten(e.children ?? []) : [e.path]);
        const paths = flatten(entries);
        for (const p of paths) {
          const name = p.split(/[\\/]/).pop() || p;
          if (!query || name.toLowerCase().includes(query.toLowerCase()) || p.toLowerCase().includes(query.toLowerCase())) {
            if (!suggestions.includes(p)) suggestions.push(p);
          }
        }
      } catch { /* ignore */ }
    }

    return suggestions.slice(0, 20);
  };

  const handleMentionSelect = async (value: string) => {
    const { lastErrors } = useTerminalStore.getState();

    if (value === "@errors") {
      // Inject terminal errors (Req 7.6)
      if (lastErrors.length === 0) {
        setMentionWarning("No terminal errors detected.");
      } else {
        const errText = lastErrors
          .map((e) => `${e.file ?? "unknown"}:${e.line ?? 0} — ${e.title}: ${e.detail}`)
          .join("\n");
        // Add as a pseudo-file mention
        useAIStore.getState().addMentionedFile("@errors").catch(() => {});
        // Override with actual error content
        useAIStore.setState(s => ({
          mentionedFiles: [
            ...s.mentionedFiles.filter(f => f.path !== "@errors"),
            { path: "@errors", content: errText, truncated: false },
          ],
        }));
      }
    } else if (value === "@folder") {
      // Inject directory listing (Req 7.4)
      if (!openFolder) {
        setMentionWarning("No project folder open.");
      } else {
        try {
          type FileEntry = { name: string; path: string; is_dir: boolean; children?: FileEntry[] };
          const entries = await invoke<FileEntry[]>("read_dir_recursive", { path: openFolder, depth: 2 });
          const lines: string[] = [];
          const walk = (items: FileEntry[], indent = "") => {
            for (const e of items) {
              lines.push(`${indent}${e.is_dir ? "📁" : "📄"} ${e.name}`);
              if (e.is_dir && e.children) walk(e.children, indent + "  ");
            }
          };
          walk(entries);
          const listing = lines.join("\n");
          useAIStore.setState(s => ({
            mentionedFiles: [
              ...s.mentionedFiles.filter(f => f.path !== "@folder"),
              { path: "@folder", content: listing, truncated: listing.length > 6000 },
            ],
          }));
        } catch (e) {
          setMentionWarning(`Could not read folder: ${String(e)}`);
        }
      }
    } else {
      // Regular file mention (Req 7.2, 7.3)
      const result = await addMentionedFile(value);
      if (!result.ok) {
        setMentionWarning(result.reason ?? "Could not add file.");
      }
    }

    // Replace the @query in the input with nothing (pill handles display)
    setInput(prev => prev.replace(/@[\w./\\-]*$/, ""));
    setMentionQuery(null);
    setMentionDropdown([]);
    inputRef.current?.focus();
  };

  const handleInputChange = async (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setInput(val);
    setMentionWarning(null);

    // Detect @-trigger: look for @ followed by optional word chars at end of text
    const match = val.match(/@([\w./\\-]*)$/);
    if (match) {
      const query = match[1];
      setMentionQuery(query);
      setMentionDropdownIdx(0);
      const suggestions = await buildMentionSuggestions(query);
      setMentionDropdown(suggestions);
    } else {
      setMentionQuery(null);
      setMentionDropdown([]);
    }
  };

  const handleInputKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (mentionQuery !== null && mentionDropdown.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setMentionDropdownIdx(i => Math.min(i + 1, mentionDropdown.length - 1));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setMentionDropdownIdx(i => Math.max(i - 1, 0));
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        handleMentionSelect(mentionDropdown[mentionDropdownIdx]);
        return;
      }
      if (e.key === "Escape") {
        setMentionQuery(null);
        setMentionDropdown([]);
        return;
      }
    }
    handleKeyDown(e);
  };

  const modelSelectorRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const {
    chatHistory, isThinking, isOllamaRunning,
    availableModels, selectedOllamaModels, toggleOllamaModel,
    apiKeys, selectedApiKeyIndices, toggleAPIKey, addAPIKey,
    useRAG, aiMode, agentLiveOutput, agentEvents, showThinking,
    indexedChunks, isIndexing, sendMessage, clearChat, toggleRAG,
    setAIMode, setShowThinking, indexCodebase, checkOllama, startOllama, setOpenFolder,
    sessions, activeSessionId, showSessionList,
    newChat, switchSession, deleteSession, exportSession, toggleSessionList,
    abortRequest, retryLastMessage, isStreaming, streamingMessageId,
    mentionedFiles, addMentionedFile, removeMentionedFile, clearMentionedFiles,
    estimatedTokens, contextLimitWarning, summarizeOldMessages,
    isGrpcHealthy, grpcStatusError, grpcStarting, startGrpcService, aiServiceMode, checkGrpcService,
    ollamaReconnectFailed, startOllamaReconnect, reconnectAttempts,
    hfApiKey, hfBaseUrl, hfSelectedModel, hfModels, setHFApiKey, setHFBaseUrl, setHFModel, fetchHFModels,
    selectedProvider, setProvider,
    turboQuantStatus, turboQuantProgress, turboQuantStage, turboQuantError,
    quantizedModels, startTurboQuant, cancelTurboQuant, listQuantizedModels, deleteQuantizedModel,
    hfSearchResults, hfSearchLoading, hfSearchError,
    downloadQueue, activeDownloads, localModels, localModelsLoading,
    selectedLocalModel, hfLocalToken,
    searchHFModels, downloadModel, cancelDownload,
    listLocalModels, deleteLocalModel, setSelectedLocalModel, setHFLocalToken,
  } = useAIStore();

  const {
    openFolder, tabs, activeTabId, openFile,
    applyAIChangeToTab, applyAIChangeToFile, rollbackLastAIChange, aiChangeHistory,
  } = useEditorStore();
  const { toggleSettingsPanel, addToast } = useUIStore();

  const activeTab = tabs.find(t => t.id === activeTabId);

  // Scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatHistory, agentLiveOutput, agentEvents, isThinking]);

  // Close dropdown on outside click
  useEffect(() => {
    const fn = (e: MouseEvent) => {
      if (showModelSelect && modelSelectorRef.current && !modelSelectorRef.current.contains(e.target as Node))
        setShowModelSelect(false);
    };
    document.addEventListener("mousedown", fn);
    return () => document.removeEventListener("mousedown", fn);
  }, [showModelSelect]);

  useEffect(() => { checkOllama(); }, [checkOllama]);
  useEffect(() => { if (showModelSelect) checkOllama(); }, [showModelSelect, checkOllama]);
  useEffect(() => { if (aiServiceMode === "grpc") checkGrpcService(); }, [aiServiceMode, checkGrpcService]);
  useEffect(() => {
    if (showLocalModels) listLocalModels();
  }, [showLocalModels]);
  useEffect(() => { setOpenFolder(openFolder ?? null); }, [openFolder, setOpenFolder]);
  useEffect(() => {
    if (useRAG && openFolder && indexedChunks === 0 && !isIndexing) indexCodebase(openFolder);
  }, [useRAG, openFolder, indexedChunks, isIndexing, indexCodebase]);

  // Agent event listeners (Task 3.7, 3.8)
  useEffect(() => {
    if (aiMode !== 'agent') return;

    const unlistenStep = listen<AgentStepEvent>('ai-agent-event', (event) => {
      setAgentSteps(prev => [...prev, event.payload]);
    });

    const unlistenConfirm = listen<{ confirmId: string; path: string; diff: string; tool: string }>(
      'ai-agent-confirm-required',
      (event) => {
        setConfirmPending(event.payload);
      }
    );

    return () => {
      unlistenStep.then(fn => fn());
      unlistenConfirm.then(fn => fn());
    };
  }, [aiMode]);

  // Check file existence for suggestions
  useEffect(() => {
    const allPaths = chatHistory.flatMap(msg =>
      msg.role === "assistant" ? extractFileSuggestions(msg.content).map(s => resolvePath(s.path, openFolder ?? null)).filter(Boolean) as string[] : []
    );
    const unchecked = allPaths.filter(p => !(p in fileExistenceMap));
    if (!unchecked.length) return;
    Promise.all(unchecked.map(async p => ({ p, exists: await checkFileExistsCached(p) }))).then(results => {
      setFileExistenceMap(prev => {
        const next = { ...prev };
        results.forEach(({ p, exists }) => { next[p] = exists; });
        return next;
      });
    });
  }, [chatHistory, openFolder]);

  const handleSend = async () => {
    const text = input.trim();
    if (!text || isThinking) return;
    if (selectedProvider === "huggingface" && !hfApiKey) {
      setHfTokenError(true);
      return;
    }
    if (noModelConfigured) {
      // Inline error — do not send (1.5)
      return;
    }
    // Clear agent steps when starting a new task
    if (aiMode === 'agent') {
      setAgentSteps([]);
    }
    let content = text;
    let activeFileContext: string | undefined;
    if (activeTabId && activeTab) {
      const fileCode = `\`\`\`${activeTab.language}\n// ${activeTab.fileName}\n${activeTab.content.slice(0, 4000)}\n\`\`\``;
      if (text.includes("@file")) content = text.replace("@file", `\n${fileCode}\n`);
      else activeFileContext = fileCode;
    }
    setInput("");
    setMentionQuery(null);
    setMentionDropdown([]);
    await sendMessage(content, activeFileContext);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); }
  };

  // Model label
  const totalSelected = selectedOllamaModels.length + selectedApiKeyIndices.length;
  const hfReady = selectedProvider === "huggingface" && !!hfApiKey;

  // No model configured at all (1.5)
  const noModelConfigured = selectedOllamaModels.length === 0 && selectedApiKeyIndices.length === 0 && !hfReady;

  let modelLabel = "Select Model";
  if (selectedProvider === "huggingface" && hfApiKey) {
    modelLabel = `HuggingFace: ${hfSelectedModel || "no model"}`;
  } else if (totalSelected === 1) {
    if (selectedOllamaModels.length === 1) modelLabel = selectedOllamaModels[0];
    else { const e = apiKeys[selectedApiKeyIndices[0]]; modelLabel = e ? `${e.provider}: ${e.model}` : "API"; }
  } else if (totalSelected > 1) {
    modelLabel = `${totalSelected} models`;
  }

  const needsOllama = aiMode === "agent" || useRAG || selectedOllamaModels.length > 0;
  const showOllamaWarn = selectedOllamaModels.length > 0 && !isOllamaRunning;
  const isOnline = !showOllamaWarn;
  const canSend = !isThinking && !!input.trim() && (hfReady || (!needsOllama || isOllamaRunning) && !noModelConfigured);

  const filteredSessions = useMemo(() => {
    const q = sessionSearch.trim().toLowerCase();
    if (!q) return sessions;
    return sessions.filter((s) =>
      s.title.toLowerCase().includes(q) ||
      s.messages.some((m) => m.content.toLowerCase().includes(q))
    );
  }, [sessions, sessionSearch]);

  const renderMarkdown = (content: string) =>
    DOMPurify.sanitize(
      marked.parse(content.replace(/<execute>[\s\S]*?<\/execute>/g, '<div class="ai-exec-badge">⚙ Executed</div>')) as string
    );

  const handleExportSession = async (sessionId: string, title: string) => {
    try {
      const path = await exportSession(sessionId);
      addToast(`Exported "${title}" to ${path}`, "success");
    } catch (e) {
      addToast(`Failed to export "${title}": ${String(e)}`, "error");
    }
  };

  return (
    <div className="ai-panel">
      {/* ── Session list overlay ── */}
      {showSessionList && (
        <div className="aip-session-list">
          <div className="aip-session-list-hdr">
            <span>Chat History</span>
            <button className="aip-icon-btn" onClick={toggleSessionList} title="Close"><X size={13} /></button>
          </div>
          <button className="aip-session-new-btn" onClick={() => { newChat(); toggleSessionList(); }}>
            <Plus size={12} /> New Chat
          </button>
          <div className="aip-session-search-wrap">
            <Search size={12} />
            <input
              className="aip-session-search"
              placeholder="Search chats..."
              value={sessionSearch}
              onChange={(e) => setSessionSearch(e.target.value)}
            />
          </div>
          <div className="aip-session-items">
            {sessions.length === 0 && <div className="aip-session-empty">No saved chats yet</div>}
            {sessions.length > 0 && filteredSessions.length === 0 && (
              <div className="aip-session-empty">No matching chats</div>
            )}
            {filteredSessions.map(s => (
              <div key={s.id} className={`aip-session-item ${s.id === activeSessionId ? "active" : ""}`}>
                <button className="aip-session-item-btn" onClick={() => { switchSession(s.id); toggleSessionList(); }}>
                  <MessageSquare size={11} />
                  <div className="aip-session-item-info">
                    <span className="aip-session-item-title">{s.title}</span>
                    <span className="aip-session-item-meta">
                      {s.messages.length} msgs · {new Date(s.createdAt).toLocaleDateString()}
                    </span>
                  </div>
                </button>
                <div className="aip-session-item-actions">
                  <button
                    className="aip-session-export"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleExportSession(s.id, s.title || "New Chat");
                    }}
                    title="Export session markdown"
                  >
                    <Download size={10} />
                  </button>
                  <button className="aip-session-del" onClick={() => deleteSession(s.id)} title="Delete">
                    <X size={10} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Prompts panel overlay (Task 6.7) ── */}
      {showPromptsPanel && (
        <div className="aip-session-list">
          <div className="aip-session-list-hdr">
            <span>Prompt Templates</span>
            <button className="aip-icon-btn" onClick={() => setShowPromptsPanel(false)} title="Close"><X size={13} /></button>
          </div>
          <div className="aip-prompts-toolbar">
            <button className="aip-session-new-btn" onClick={handleNewTemplate}>
              <Plus size={12} /> New Template
            </button>
          </div>
          <div className="aip-session-items">
            {promptTemplates.length === 0 && (
              <div className="aip-session-empty">No templates yet. Create one below.</div>
            )}
            {promptTemplates.map(t => (
              <div
                key={t.name}
                className={`aip-session-item ${selectedPromptName === t.name ? "active" : ""}`}
                onClick={() => handleSelectPrompt(t.name, t.content)}
                style={{ cursor: "pointer" }}
              >
                <div className="aip-session-item-info" style={{ padding: "4px 8px" }}>
                  <span className="aip-session-item-title">{t.name}.md</span>
                  <span className="aip-session-item-meta">{t.content.length} chars</span>
                </div>
              </div>
            ))}
          </div>
          <div className="aip-prompts-editor">
            {(selectedPromptName !== null || newPromptName !== undefined) && (
              <>
                <div className="aip-prompts-name-row">
                  <input
                    className="aip-prompts-name-input"
                    placeholder={selectedPromptName ?? "template-name"}
                    value={newPromptName}
                    onChange={e => setNewPromptName(e.target.value)}
                  />
                  <span className="aip-prompts-name-ext">.md</span>
                </div>
                <textarea
                  className="aip-prompts-textarea"
                  value={promptEditorContent}
                  onChange={e => setPromptEditorContent(e.target.value)}
                  placeholder="Enter system prompt content (max 8000 chars)…"
                  rows={8}
                />
                <div className="aip-prompts-footer">
                  <span className="aip-prompts-charcount">{promptEditorContent.length}/8000</span>
                  <button
                    className="aip-btn-sm aip-btn-primary"
                    onClick={handleSavePrompt}
                    disabled={savingPrompt || (!selectedPromptName && !newPromptName.trim())}
                  >
                    {savingPrompt ? "Saving…" : "Save"}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* ── Header ── */}
      <div className="aip-header">
        <div className="aip-title-row">
          <button className="aip-icon-btn" onClick={toggleSessionList} title="Chat history">
            <ChevronLeft size={13} />
          </button>
          <span className="aip-logo">✦</span>
          <span className="aip-title">AI Assistant</span>
          <span className={`aip-dot ${isOnline ? "on" : "off"}`} title={isOnline ? "Ollama connected" : "Ollama offline"} />
          {estimatedTokens > 0 && (
            <span className="aip-token-counter" title="Estimated token usage">
              ~{estimatedTokens >= 1000 ? `${(estimatedTokens / 1000).toFixed(1)}k` : estimatedTokens} tokens
            </span>
          )}
          <div className="aip-header-actions">
            <button className="aip-icon-btn" onClick={newChat} title="New chat">
              <Plus size={13} />
            </button>
            <button
              className={`aip-icon-btn ${useRAG ? "active-rag" : ""}`}
              onClick={toggleRAG}
              title={useRAG ? `RAG ON — ${indexedChunks} chunks` : "Enable RAG"}
            >
              <Database size={13} />
              {useRAG && <span className="aip-rag-count">{indexedChunks}</span>}
            </button>
            <button
              className="aip-icon-btn"
              onClick={async () => {
                setRollingBack(true);
                try {
                  const ok = await rollbackLastAIChange();
                  if (!ok) addToast("Nothing to rollback.", "warning");
                } finally { setRollingBack(false); }
              }}
              disabled={rollingBack || aiChangeHistory.length === 0}
              title="Rollback last AI change"
            >
              <Undo2 size={13} />
            </button>
            <button className="aip-icon-btn" onClick={clearChat} title="Clear chat">
              <Trash2 size={13} />
            </button>
            <button className="aip-icon-btn" onClick={handleOpenPromptsPanel} title="Prompt templates">
              <FileText size={13} />
            </button>
          </div>
        </div>

        {/* Mode pills */}
        <div className="aip-modes">
          {MODES.map(m => (
            <button
              key={m.id}
              className={`aip-mode-pill ${aiMode === m.id ? "active" : ""}`}
              onClick={() => setAIMode(m.id as any)}
              title={m.title}
            >
              {m.emoji && <span>{m.emoji}</span>}
              {m.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Ollama warning ── */}
      {showOllamaWarn && !ollamaReconnectFailed && (
        <div className="aip-banner aip-banner-warn">
          <Zap size={13} />
          <div className="aip-banner-body">
            <strong>Ollama not running</strong>
            <span>Run <code>ollama serve</code> to start it</span>
            <button className="aip-btn-sm" onClick={startOllama}>Start</button>
            <button className="aip-btn-sm" onClick={startOllamaReconnect}>
              <RefreshCw size={11} /> Reconnect{reconnectAttempts > 0 ? ` (${reconnectAttempts}/3)` : ""}
            </button>
          </div>
        </div>
      )}

      {/* ── Ollama permanent error after failed reconnects ── */}
      {ollamaReconnectFailed && (
        <div className="aip-banner aip-banner-error">
          <AlertCircle size={13} />
          <div className="aip-banner-body">
            <strong>Ollama is not responding after 3 reconnect attempts. Please start Ollama manually.</strong>
            <button className="aip-btn-sm aip-btn-primary" onClick={startOllamaReconnect}>Try Again</button>
          </div>
        </div>
      )}

      {/* ── gRPC unavailable banner (Task 12.1) ── */}
      {aiServiceMode === "grpc" && isGrpcHealthy === false && (
        <div className="aip-banner aip-banner-error">
          <AlertCircle size={13} />
          <div className="aip-banner-body">
            <strong>gRPC AI service unavailable</strong>
            <span>{grpcStatusError || "Could not connect to the AI service."}</span>
            <button
              className="aip-btn-sm aip-btn-primary"
              onClick={() => startGrpcService()}
              disabled={grpcStarting}
            >
              {grpcStarting ? "Starting…" : "Start Service"}
            </button>
            <a
              className="aip-btn-sm"
              href="#"
              onClick={(e) => { e.preventDefault(); invoke("open_file", { path: "SETUP_GRPC.md" }).catch(() => {}); }}
            >
              Setup Docs
            </a>
          </div>
        </div>
      )}

      {/* Context window warning (Task 9.4) */}
      {contextLimitWarning === 'yellow' && (
        <div className="aip-banner aip-banner-warn">
          <AlertTriangle size={13} />
          <div className="aip-banner-body">
            <strong>Conversation is getting long</strong>
            <span>Consider starting a new chat or summarizing.</span>
            <button className="aip-btn-sm" onClick={summarizeOldMessages}>Summarize</button>
            <button className="aip-btn-sm" onClick={newChat}>New Chat</button>
          </div>
        </div>
      )}

      {/* ── RAG index prompt ── */}
      {useRAG && indexedChunks === 0 && openFolder && (
        <div className="aip-banner aip-banner-info">
          <Database size={13} />
          <div className="aip-banner-body">
            <strong>Index codebase for RAG</strong>
            <button className="aip-btn-sm aip-btn-primary" onClick={() => indexCodebase(openFolder)} disabled={isIndexing}>
              {isIndexing ? <><RefreshCw size={11} className="spin-icon" /> Indexing…</> : "Index Now"}
            </button>
          </div>
        </div>
      )}

      {/* ── No model configured inline error (Req 1.1 / 1.5) ── */}
      {noModelConfigured && (
        <div className="aip-banner aip-banner-warn">
          <Zap size={13} />
          <div className="aip-banner-body">
            <strong>No model configured</strong>
            <span>Select a model to start chatting.</span>
            <button className="aip-btn-sm" onClick={() => { toggleSettingsPanel(); }}>Open Settings</button>
          </div>
        </div>
      )}

      {/* ── Model selector ── */}
      <div className="aip-model-bar" ref={modelSelectorRef}>
        <button className="aip-model-btn" onClick={() => setShowModelSelect(s => !s)}>
          <Cpu size={12} />
          <span className="aip-model-label">{modelLabel}</span>
          <ChevronDown size={11} className={showModelSelect ? "rotated" : ""} />
        </button>

        <button
          className={`aip-model-btn aip-turbo-btn ${turboQuantStatus === "downloading" || turboQuantStatus === "quantizing" ? "active" : ""}`}
          onClick={() => {
            setShowTurboQuant(s => {
              if (!s) listQuantizedModels();
              return !s;
            });
          }}
          title="TurboQuant — quantize models"
        >
          ⚡ TurboQuant
        </button>

        <button
          className={`aip-model-btn ${showLocalModels ? "active" : ""}`}
          onClick={() => setShowLocalModels(s => !s)}
          title="Browse and manage local HuggingFace models"
        >
          <Download size={12} /> Local Models
        </button>

        {showModelSelect && (
          <div className="aip-model-dropdown" id="aip-model-dropdown">
            <div className="aip-dropdown-section">Ollama Models</div>
            {availableModels.length === 0 && (
              <div className="aip-dropdown-empty">{isOllamaRunning ? "No models installed" : "Ollama not running"}</div>
            )}
            {availableModels.map(m => (
              <button key={m} className={`aip-model-opt ${selectedOllamaModels.includes(m) ? "sel" : ""}`} onClick={() => toggleOllamaModel(m)}>
                <span className={`aip-check ${selectedOllamaModels.includes(m) ? "checked" : ""}`} />
                <span className="aip-model-name">{m}</span>
              </button>
            ))}
            {selectedOllamaModels.filter(m => !availableModels.includes(m)).map(m => (
              <button key={`stale-${m}`} className="aip-model-opt sel stale" onClick={() => toggleOllamaModel(m)} title="Not installed — click to remove">
                <span className="aip-check checked" />
                <span className="aip-model-name">{m}</span>
                <span className="aip-stale-badge">⚠ missing</span>
              </button>
            ))}
            {apiKeys.length > 0 && (
              <>
                <div className="aip-dropdown-section" style={{ marginTop: 4 }}>API Keys</div>
                {apiKeys.map((k, i) => (
                  <button key={i} className={`aip-model-opt ${selectedApiKeyIndices.includes(i) ? "sel" : ""}`} onClick={() => toggleAPIKey(i)}>
                    <span className={`aip-check ${selectedApiKeyIndices.includes(i) ? "checked" : ""}`} />
                    <span className="aip-model-name">{k.provider}: {k.model}</span>
                  </button>
                ))}
              </>
            )}

            {/* HuggingFace section (Task 10.1) */}
            <div className="aip-dropdown-section" style={{ marginTop: 4 }}>
              HuggingFace
              {selectedProvider === "huggingface" && <span className="aip-provider-active"> ✓ active</span>}
            </div>
            <div className="aip-dropdown-hf">
              <label className="aip-dropdown-label">HF_Token</label>
              <input
                type="password"
                className={`aip-dropdown-input ${hfTokenError && !hfApiKey ? "aip-input-error" : ""}`}
                placeholder="hf_..."
                value={hfApiKey}
                onChange={e => { setHFApiKey(e.target.value); setHfTokenError(false); }}
              />
              {hfTokenError && !hfApiKey && (
                <div className="aip-inline-error">HF_Token is required</div>
              )}
              <label className="aip-dropdown-label">Model</label>
              {hfModels.length > 0 ? (
                <select
                  className="aip-dropdown-input"
                  value={hfSelectedModel}
                  onChange={e => setHFModel(e.target.value)}
                >
                  <option value="">Select model…</option>
                  {hfModels.map(m => <option key={m} value={m}>{m}</option>)}
                </select>
              ) : (
                <input
                  type="text"
                  className="aip-dropdown-input"
                  placeholder="e.g. mistralai/Mistral-7B-v0.1"
                  value={hfSelectedModel}
                  onChange={e => setHFModel(e.target.value)}
                />
              )}
              <label className="aip-dropdown-label">Base URL (optional)</label>
              <input
                type="text"
                className="aip-dropdown-input"
                placeholder="https://api-inference.huggingface.co"
                value={hfBaseUrl}
                onChange={e => setHFBaseUrl(e.target.value)}
              />
              <button
                className={`aip-btn-sm aip-btn-primary ${selectedProvider === "huggingface" ? "aip-provider-selected" : ""}`}
                style={{ marginTop: 6 }}
                onClick={() => { setProvider("huggingface"); fetchHFModels(); }}
              >
                {selectedProvider === "huggingface" ? "✓ Using HuggingFace" : "Use HuggingFace"}
              </button>
            </div>

            {/* Add Custom Provider section (Task 11.1) */}
            <div className="aip-dropdown-section" style={{ marginTop: 4 }}>Add Custom Provider</div>
            <div className="aip-dropdown-hf">
              <label className="aip-dropdown-label">Name (label)</label>
              <input
                type="text"
                className="aip-dropdown-input"
                placeholder="My OpenAI-compat server"
                value={customProviderName}
                onChange={e => { setCustomProviderName(e.target.value); setCustomProviderSuccess(false); }}
              />
              <label className="aip-dropdown-label">Base URL</label>
              <input
                type="text"
                className={`aip-dropdown-input ${customProviderUrlError ? "aip-input-error" : ""}`}
                placeholder="https://my-server.example.com/v1"
                value={customProviderBaseUrl}
                onChange={e => { setCustomProviderBaseUrl(e.target.value); setCustomProviderUrlError(""); setCustomProviderSuccess(false); }}
              />
              {customProviderUrlError && (
                <div className="aip-inline-error">{customProviderUrlError}</div>
              )}
              <label className="aip-dropdown-label">API Key</label>
              <input
                type="password"
                className="aip-dropdown-input"
                placeholder="sk-..."
                value={customProviderApiKey}
                onChange={e => { setCustomProviderApiKey(e.target.value); setCustomProviderSuccess(false); }}
              />
              <label className="aip-dropdown-label">Model</label>
              <input
                type="text"
                className="aip-dropdown-input"
                placeholder="gpt-3.5-turbo"
                value={customProviderModel}
                onChange={e => { setCustomProviderModel(e.target.value); setCustomProviderSuccess(false); }}
              />
              {customProviderSuccess && (
                <div className="aip-inline-success">Provider added successfully!</div>
              )}
              <button
                className="aip-btn-sm aip-btn-primary"
                style={{ marginTop: 6 }}
                onClick={() => {
                  const url = customProviderBaseUrl.trim();
                  if (!url.startsWith("http://") && !url.startsWith("https://")) {
                    setCustomProviderUrlError("Base URL must start with http:// or https://");
                    return;
                  }
                  addAPIKey({
                    provider: "openai_compat",
                    apiKey: customProviderApiKey,
                    model: customProviderModel,
                    label: customProviderName,
                    baseUrl: url,
                  });
                  setCustomProviderName("");
                  setCustomProviderBaseUrl("");
                  setCustomProviderApiKey("");
                  setCustomProviderModel("");
                  setCustomProviderUrlError("");
                  setCustomProviderSuccess(true);
                }}
              >
                Add Provider
              </button>
            </div>

            <div className="aip-dropdown-footer">
              <button className="aip-btn-sm" onClick={() => setShowModelSelect(false)}>Close</button>
              <button className="aip-btn-sm" onClick={() => { setShowModelSelect(false); toggleSettingsPanel(); }}>Manage</button>
            </div>
          </div>
        )}

        {/* TurboQuant panel (Task 12.1) */}
        {showTurboQuant && (
          <div className="aip-session-list aip-turbo-panel">
            <div className="aip-session-list-hdr">
              <span>⚡ TurboQuant</span>
              <button className="aip-icon-btn" onClick={() => setShowTurboQuant(false)} title="Close"><X size={13} /></button>
            </div>

            {/* Quantize form */}
            <div className="aip-dropdown-hf" style={{ padding: "8px 12px" }}>
              <label className="aip-dropdown-label">Model ID</label>
              <input
                type="text"
                className="aip-dropdown-input"
                placeholder="e.g. mistralai/Mistral-7B-v0.1"
                value={tqModelId}
                onChange={e => setTqModelId(e.target.value)}
              />
              <label className="aip-dropdown-label">Method</label>
              <select
                className="aip-dropdown-input"
                value={tqMethod}
                onChange={e => setTqMethod(e.target.value as "GGUF" | "GPTQ" | "AWQ")}
              >
                <option value="GGUF">GGUF</option>
                <option value="GPTQ">GPTQ</option>
                <option value="AWQ">AWQ</option>
              </select>
              <label className="aip-dropdown-label">Bits</label>
              <select
                className="aip-dropdown-input"
                value={tqBits}
                onChange={e => setTqBits(Number(e.target.value) as 4 | 8)}
              >
                <option value={4}>4-bit</option>
                <option value={8}>8-bit</option>
              </select>
              <button
                className="aip-btn-sm aip-btn-primary"
                style={{ marginTop: 6 }}
                disabled={!tqModelId.trim() || turboQuantStatus === "downloading" || turboQuantStatus === "quantizing"}
                onClick={() => {
                  startTurboQuant(tqModelId.trim(), tqMethod, tqBits);
                  setShowTurboQuant(false);
                }}
              >
                Start
              </button>
            </div>

            {/* Progress */}
            {(turboQuantStatus === "downloading" || turboQuantStatus === "quantizing") && (
              <div className="aip-turbo-progress">
                <div className="aip-turbo-stage">{turboQuantStage}</div>
                <div className="aip-progress-bar">
                  <div className="aip-progress-fill" style={{ width: `${turboQuantProgress}%` }} />
                </div>
                <div className="aip-turbo-pct">{turboQuantProgress}%</div>
                <button className="aip-btn-sm" onClick={cancelTurboQuant}>Cancel</button>
              </div>
            )}

            {/* Done */}
            {turboQuantStatus === "done" && (
              <div className="aip-inline-success" style={{ margin: "8px 12px" }}>✓ Quantization complete!</div>
            )}

            {/* Error */}
            {turboQuantStatus === "error" && turboQuantError && (
              <div className="aip-turbo-error" style={{ margin: "8px 12px" }}>
                <div className="aip-inline-error">{turboQuantError}</div>
                {turboQuantError.includes("MISSING_DEPENDENCY:") && (
                  <button
                    className="aip-btn-sm"
                    style={{ marginTop: 4 }}
                    onClick={() => {
                      const match = turboQuantError!.match(/MISSING_DEPENDENCY:\s*(.+)/);
                      const cmd = match ? match[1].trim() : turboQuantError!;
                      navigator.clipboard.writeText(cmd).then(() => addToast("Install command copied!", "success")).catch(() => {});
                    }}
                  >
                    Copy install command
                  </button>
                )}
              </div>
            )}

            {/* Quantized models list */}
            {quantizedModels.length > 0 && (
              <div className="aip-turbo-models">
                <div className="aip-dropdown-section">Quantized Models</div>
                {quantizedModels.map((qm, i) => (
                  <div key={i} className="aip-turbo-model-row">
                    <div className="aip-turbo-model-info">
                      <span className="aip-turbo-model-id">{qm.modelId}</span>
                      <span className="aip-turbo-model-meta">{qm.method} · {qm.bits}-bit · {qm.sizeMb}MB</span>
                    </div>
                    <button
                      className="aip-session-del"
                      onClick={() => deleteQuantizedModel(qm.modelId, qm.method, qm.bits)}
                      title="Delete"
                    >
                      <X size={10} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Local Models panel (Req 9.1–9.9, 10.2, 10.3) */}
        {showLocalModels && (
          <div className="aip-session-list aip-local-models-panel">
            <div className="aip-session-list-hdr">
              <span>🤗 Local Models</span>
              <button className="aip-icon-btn" onClick={() => setShowLocalModels(false)} title="Close"><X size={13} /></button>
            </div>

            {/* HF Token input (Req 10.2, 10.3) */}
            <div className="aip-dropdown-hf" style={{ padding: "8px 12px", borderBottom: "1px solid var(--border)" }}>
              <label className="aip-dropdown-label" style={{ display: "flex", alignItems: "center", gap: 4 }}>
                HuggingFace Token
                <span title="Only a read scope token is required" style={{ cursor: "help", opacity: 0.6 }}>ⓘ</span>
              </label>
              <div style={{ display: "flex", gap: 4 }}>
                <input
                  type={localHfTokenVisible ? "text" : "password"}
                  className="aip-dropdown-input"
                  placeholder="hf_..."
                  value={hfLocalToken}
                  onChange={e => setHFLocalToken(e.target.value)}
                  style={{ flex: 1 }}
                />
                <button
                  className="aip-icon-btn"
                  onClick={() => setLocalHfTokenVisible(v => !v)}
                  title={localHfTokenVisible ? "Hide token" : "Show token"}
                >
                  {localHfTokenVisible ? <EyeOff size={12} /> : <Eye size={12} />}
                </button>
              </div>
              {hfLocalToken && !localHfTokenVisible && (
                <div style={{ fontSize: 11, opacity: 0.5, marginTop: 2 }}>
                  hf_{"*".repeat(Math.min(hfLocalToken.length - 3, 8))}
                </div>
              )}
            </div>

            {/* Search bar (Req 9.2, 9.8) */}
            <div className="aip-dropdown-hf" style={{ padding: "8px 12px", borderBottom: "1px solid var(--border)" }}>
              <label className="aip-dropdown-label">Search HuggingFace Hub</label>
              <input
                type="text"
                className="aip-dropdown-input"
                placeholder="e.g. mistral, llama, phi..."
                value={localSearchQuery}
                onChange={e => {
                  const q = e.target.value;
                  setLocalSearchQuery(q);
                  // Req 9.8: 400ms debounce
                  if (localSearchDebounceTimer) clearTimeout(localSearchDebounceTimer);
                  const timer = setTimeout(() => {
                    searchHFModels(q, localSearchTask, localSearchMaxSize ? parseFloat(localSearchMaxSize) : undefined);
                  }, 400);
                  setLocalSearchDebounceTimer(timer);
                }}
              />
              <div style={{ display: "flex", gap: 4, marginTop: 4 }}>
                <select
                  className="aip-dropdown-input"
                  value={localSearchTask}
                  onChange={e => {
                    setLocalSearchTask(e.target.value);
                    searchHFModels(localSearchQuery, e.target.value, localSearchMaxSize ? parseFloat(localSearchMaxSize) : undefined);
                  }}
                  style={{ flex: 1 }}
                >
                  <option value="text-generation">text-generation</option>
                  <option value="text2text-generation">text2text-generation</option>
                  <option value="fill-mask">fill-mask</option>
                  <option value="question-answering">question-answering</option>
                  <option value="summarization">summarization</option>
                  <option value="translation">translation</option>
                </select>
                <input
                  type="number"
                  className="aip-dropdown-input"
                  placeholder="Max GB"
                  value={localSearchMaxSize}
                  onChange={e => setLocalSearchMaxSize(e.target.value)}
                  style={{ width: 70 }}
                  min={0}
                  step={0.5}
                />
              </div>
            </div>

            {/* Search error */}
            {hfSearchError && (
              <div className="aip-inline-error" style={{ margin: "6px 12px" }}>{hfSearchError}</div>
            )}

            {/* Search results (Req 9.3, 9.6) */}
            {hfSearchLoading && (
              <div style={{ padding: "8px 12px", opacity: 0.6, fontSize: 12 }}>
                <RefreshCw size={11} className="spin-icon" /> Searching…
              </div>
            )}
            {!hfSearchLoading && hfSearchResults.length > 0 && (
              <div className="aip-turbo-models">
                <div className="aip-dropdown-section">Search Results</div>
                {hfSearchResults.map((card) => {
                  const isQueued = downloadQueue.some(e => e.modelId === card.modelId && (e.status === "queued" || e.status === "downloading"));
                  const isDone = downloadQueue.some(e => e.modelId === card.modelId && e.status === "done") ||
                    localModels.some(m => m.modelId === card.modelId);
                  const isGatedNoToken = card.gated && !hfLocalToken;
                  return (
                    <div key={card.modelId} className="aip-turbo-model-row" style={{ flexDirection: "column", alignItems: "flex-start", gap: 2 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", width: "100%", alignItems: "center" }}>
                        <div className="aip-turbo-model-info">
                          <span className="aip-turbo-model-id" style={{ fontSize: 11 }}>{card.modelId}</span>
                          <span className="aip-turbo-model-meta">
                            ↓{card.downloads.toLocaleString()} · {formatBytes(card.sizeBytes)} · {card.license || "unknown"}
                            {card.gated && <span className="aip-stale-badge" style={{ marginLeft: 4 }}>🔒 gated</span>}
                          </span>
                        </div>
                        <button
                          className="aip-btn-sm aip-btn-primary"
                          disabled={isQueued || isDone || isGatedNoToken}
                          title={isGatedNoToken ? "This model requires a HuggingFace token. Add your token above." : isDone ? "Already downloaded" : isQueued ? "Downloading…" : "Download"}
                          onClick={() => downloadModel(card.modelId)}
                          style={{ flexShrink: 0 }}
                        >
                          {isDone ? "✓" : isQueued ? <RefreshCw size={10} className="spin-icon" /> : <Download size={10} />}
                        </button>
                      </div>
                      {/* Req 9.6: inline message for gated model without token */}
                      {isGatedNoToken && (
                        <div style={{ fontSize: 10, color: "var(--warning, #f59e0b)", paddingLeft: 2 }}>
                          This model requires a HuggingFace token. Add your token in the Local Models settings.
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {/* Download queue (Req 9.4) */}
            {downloadQueue.length > 0 && (
              <div className="aip-turbo-models">
                <div className="aip-dropdown-section">Downloads</div>
                {downloadQueue.map((entry) => {
                  const pct = entry.bytesTotal > 0 ? Math.round((entry.bytesDone / entry.bytesTotal) * 100) : 0;
                  const speedMBs = (entry.speedBps / 1e6).toFixed(1);
                  return (
                    <div key={entry.modelId} className="aip-turbo-model-row" style={{ flexDirection: "column", alignItems: "flex-start", gap: 4 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", width: "100%", alignItems: "center" }}>
                        <span className="aip-turbo-model-id" style={{ fontSize: 11 }}>{entry.modelId}</span>
                        <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                          <span style={{ fontSize: 10, opacity: 0.7 }}>{entry.status}</span>
                          {(entry.status === "queued" || entry.status === "downloading") && (
                            <button className="aip-session-del" onClick={() => cancelDownload(entry.modelId)} title="Cancel">
                              <X size={10} />
                            </button>
                          )}
                        </div>
                      </div>
                      {entry.status === "downloading" && (
                        <>
                          <div className="aip-progress-bar" style={{ width: "100%" }}>
                            <div className="aip-progress-fill" style={{ width: `${pct}%` }} />
                          </div>
                          <div style={{ fontSize: 10, opacity: 0.6 }}>
                            {formatBytes(entry.bytesDone)} / {formatBytes(entry.bytesTotal)} · {speedMBs} MB/s
                          </div>
                        </>
                      )}
                      {entry.status === "error" && entry.error && (
                        <div className="aip-inline-error" style={{ fontSize: 10 }}>{entry.error}</div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {/* Local models list (Req 9.5) */}
            <div className="aip-turbo-models">
              <div className="aip-dropdown-section">
                Downloaded Models
                {localModelsLoading && <RefreshCw size={10} className="spin-icon" style={{ marginLeft: 4 }} />}
              </div>
              {localModels.length === 0 && !localModelsLoading && (
                <div style={{ padding: "6px 12px", fontSize: 11, opacity: 0.5 }}>No local models yet. Search and download above.</div>
              )}
              {localModels.map((model) => (
                <div key={model.modelId} className="aip-turbo-model-row" style={{ flexDirection: "column", alignItems: "flex-start", gap: 4 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", width: "100%", alignItems: "center" }}>
                    <div className="aip-turbo-model-info">
                      <span className="aip-turbo-model-id" style={{ fontSize: 11 }}>{model.modelId}</span>
                      <span className="aip-turbo-model-meta">
                        {formatBytes(model.sizeBytes)} · {new Date(model.downloadedAt).toLocaleDateString()}
                        {model.quantizedPath && (
                          <span className="aip-stale-badge" style={{ marginLeft: 4, background: "var(--accent, #6366f1)", color: "#fff" }}>
                            ⚡ {model.quantizedMethod} {model.quantizedBits}bit
                          </span>
                        )}
                      </span>
                    </div>
                    <div style={{ display: "flex", gap: 4 }}>
                      {/* Run (Quantized) button if quantized path exists (Req 7.4) */}
                      {model.quantizedPath && (
                        <button
                          className="aip-btn-sm aip-btn-primary"
                          title="Run quantized model"
                          onClick={() => {
                            setSelectedLocalModel(model.modelId);
                            setProvider("local" as any);
                            setShowLocalModels(false);
                          }}
                        >
                          ▶ Run (Q)
                        </button>
                      )}
                      {/* Run button */}
                      <button
                        className={`aip-btn-sm ${selectedLocalModel === model.modelId && !model.quantizedPath ? "aip-btn-primary" : ""}`}
                        title="Use this model for chat"
                        onClick={() => {
                          setSelectedLocalModel(model.modelId);
                          setProvider("local" as any);
                          setShowLocalModels(false);
                        }}
                      >
                        ▶ Run
                      </button>
                      {/* Quantize button (Req 7.5) */}
                      <button
                        className="aip-btn-sm"
                        title="Quantize with TurboQuant"
                        onClick={() => {
                          setTqModelId(model.modelId);
                          setTqMethod("GGUF");
                          setTqBits(4);
                          setShowLocalModels(false);
                          setShowTurboQuant(true);
                        }}
                      >
                        ⚡
                      </button>
                      {/* Delete button */}
                      <button
                        className="aip-session-del"
                        title="Delete model"
                        onClick={() => {
                          if (window.confirm(`Delete ${model.modelId}? This will remove all downloaded files.`)) {
                            deleteLocalModel(model.modelId);
                          }
                        }}
                      >
                        <X size={10} />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* ── Messages ── */}      <div className="aip-messages">
        {chatHistory.length === 0 ? (
          noModelConfigured ? (
            /* First-run setup checklist (Req 12.5) */
            <div className="aip-setup-checklist">
              <div className="aip-welcome-icon">✦</div>
              <p className="aip-welcome-title">Get Started with AI</p>
              <p className="aip-welcome-sub">Complete these steps to start chatting:</p>
              <ol className="aip-checklist">
                <li className={`aip-checklist-item ${isOllamaRunning ? "done" : ""}`}>
                  <span className="aip-checklist-num">{isOllamaRunning ? "✓" : "1"}</span>
                  <div className="aip-checklist-body">
                    <strong>Install Ollama</strong>
                    <span>Download and install Ollama from <a href="#" onClick={(e) => { e.preventDefault(); invoke("open_url", { url: "https://ollama.ai" }).catch(() => {}); }}>ollama.ai</a></span>
                  </div>
                </li>
                <li className={`aip-checklist-item ${availableModels.length > 0 ? "done" : ""}`}>
                  <span className="aip-checklist-num">{availableModels.length > 0 ? "✓" : "2"}</span>
                  <div className="aip-checklist-body">
                    <strong>Pull a model</strong>
                    <span>Run <code>ollama pull deepseek-coder</code> in your terminal</span>
                  </div>
                </li>
                <li className="aip-checklist-item">
                  <span className="aip-checklist-num">3</span>
                  <div className="aip-checklist-body">
                    <strong>Select a model</strong>
                    <span>Click the model selector above and choose a model</span>
                    <button className="aip-btn-sm aip-btn-primary" style={{ marginTop: 4 }} onClick={() => setShowModelSelect(true)}>
                      Select Model
                    </button>
                  </div>
                </li>
              </ol>
            </div>
          ) : (
            /* Normal welcome screen */
            <div className="aip-welcome">
              <div className="aip-welcome-icon">✦</div>
              <p className="aip-welcome-title">AI Code Assistant</p>
              <p className="aip-welcome-sub">Ask anything. Use <code>@file</code> to attach the current file.</p>
              <div className="aip-chips">
                {["Explain this function", "Find bugs in @file", "Refactor @file", "Write tests", "How does this work?"].map(s => (
                  <button key={s} className="aip-chip" onClick={() => setInput(s)}>{s}</button>
                ))}
              </div>
            </div>
          )
        ) : (
          chatHistory.map(msg => {
            const codeSuggestion = msg.role === "assistant" ? extractFirstCodeBlock(msg.content) : null;
            const fileSuggestions = msg.role === "assistant" ? extractFileSuggestions(msg.content) : [];
            const shellCmds = msg.role === "assistant" ? extractShellCommands(msg.content) : [];
            const architectureSections =
              msg.role === "assistant"
                ? extractArchitectureSections(msg.content, msg.mode === "architect")
                : null;
            const dependencyMap =
              msg.role === "assistant" && msg.mode === "architect"
                ? parseDependencyMap(msg.content)
                : null;
            const canApprove = !!codeSuggestion && !!activeTabId && !!activeTab && msg.role === "assistant" && fileSuggestions.length === 0 && !rejectedMsgIds.has(msg.id);

            return (
              <div key={msg.id} className={`aip-msg aip-msg-${msg.role}`}>
                <div className="aip-msg-meta">
                  <span className="aip-msg-role">
                    {msg.role === "user" ? "You" : "AI"}
                    {msg.role === "assistant" && msg.model && (
                      <span className="aip-msg-model"> · {msg.model}</span>
                    )}
                  </span>
                  <span className="aip-msg-time">
                    {new Date(msg.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                  </span>
                </div>

                {/* Collapsible Reasoning section (Req 4.3, 4.4, 4.5, 4.6) */}
                {msg.role === "assistant" && (msg.thinkingContent !== undefined) && (
                  <details className="aip-reasoning">
                    <summary className="aip-reasoning-toggle">
                      Reasoning · {countThinkingSteps(msg.thinkingContent)} steps
                      {isStreaming && streamingMessageId === msg.id && (
                        <span className="aip-streaming-cursor" aria-hidden="true" />
                      )}
                    </summary>
                    <div
                      className="aip-reasoning-body"
                      dangerouslySetInnerHTML={{ __html: renderMarkdown(msg.thinkingContent) }}
                    />
                  </details>
                )}

                {architectureSections ? (
                  <ArchitectureSectionsView
                    sections={architectureSections.sections}
                    remainder={architectureSections.remainder}
                    renderMarkdown={renderMarkdown}
                  />
                ) : (
                  <div className="aip-msg-body" dangerouslySetInnerHTML={{ __html: renderMarkdown(msg.content) }} />
                )}

                {/* Dependency graph view for architect mode (Req 10.4, 10.5) */}
                {dependencyMap && <DependencyGraphView depMap={dependencyMap} />}

                {/* Bug report cards (Req 5.3, 5.4, 5.5) */}
                {msg.role === "assistant" && msg.bugReport && (
                  <BugReportView
                    report={msg.bugReport}
                    openFolder={openFolder ?? null}
                    onShowFix={handleShowFix}
                  />
                )}                {/* Blinking cursor for streaming message */}
                {isStreaming && streamingMessageId === msg.id && (
                  <span className="aip-streaming-cursor" aria-hidden="true" />
                )}
                {/* Incomplete stream indicator */}
                {msg.isIncomplete && !msg.isError && (
                  <div className="aip-incomplete-notice">⚠ Response was cut off</div>
                )}

                {/* Retry button on error messages (Req 1.5) */}
                {msg.isError && msg.retryContent && (
                  <div className="aip-actions">
                    <button
                      className="aip-action-btn primary"
                      disabled={isThinking}
                      onClick={() => retryLastMessage()}
                    >
                      <RefreshCw size={11} /> Retry
                    </button>
                  </div>
                )}

                {/* OOM error — show Quantize Now shortcut (Req 7.5) */}
                {msg.isError && msg.content.includes("OUT_OF_MEMORY:") && (
                  <div className="aip-actions">
                    <button
                      className="aip-action-btn primary"
                      onClick={() => {
                        if (selectedLocalModel) setTqModelId(selectedLocalModel);
                        setTqMethod("GGUF");
                        setTqBits(4);
                        setShowTurboQuant(true);
                      }}
                    >
                      ⚡ Quantize Now
                    </button>
                  </div>
                )}

                {/* Auth error — prompt to update API key (Req 12.3) */}
                {msg.isError && msg.isAuthError && (
                  <div className="aip-auth-error-prompt">
                    <AlertCircle size={11} />
                    <span>API key is invalid or expired.</span>
                    <button
                      className="aip-action-btn primary"
                      onClick={() => toggleSettingsPanel()}
                    >
                      Update Key in Settings
                    </button>
                  </div>
                )}

                {/* Accept/Reject inline code suggestion */}
                {canApprove && (
                  <div className="aip-actions">
                    <button className="aip-action-btn primary" disabled={applyingMessageId === msg.id}
                      onClick={async () => {
                        if (!activeTabId || !codeSuggestion || !activeTab) return;
                        if (!window.confirm(`Apply to ${activeTab.fileName}?`)) return;
                        setApplyingMessageId(msg.id);
                        try { await applyAIChangeToTab(activeTabId, codeSuggestion, `AI suggestion ${new Date(msg.timestamp).toLocaleTimeString()}`); }
                        finally { setApplyingMessageId(null); }
                      }}>
                      <Check size={11} /> Accept
                    </button>
                    <button className="aip-action-btn" onClick={() => setRejectedMsgIds(s => { const n = new Set(s); n.add(msg.id); return n; })}>
                      <X size={11} /> Reject
                    </button>
                  </div>
                )}

                {/* File suggestions */}
                {fileSuggestions.length > 0 && (
                  <div className="aip-file-suggestions">
                    {fileSuggestions.map((s, idx) => {
                      const key = `${msg.id}-f${idx}-${s.path}`;
                      if (rejectedFileKeys.has(key)) return null;
                      const rp = resolvePath(s.path, openFolder ?? null);
                      const disabled = applyingFileKey === key || !rp;
                      const exists = rp ? fileExistenceMap[rp] : false;
                      return (
                        <div key={key} className="aip-file-row">
                          <div className="aip-file-info">
                            <FileCode size={11} />
                            <code className="aip-file-path">{s.path}</code>
                            <span className={`aip-file-badge ${exists ? "update" : "create"}`}>{exists ? "UPDATE" : "CREATE"}</span>
                          </div>
                          <div className="aip-actions">
                            <button className="aip-action-btn" disabled={disabled}
                              onClick={async () => {
                                if (!rp) { addToast("Open a project folder first.", "warning"); return; }
                                let orig = "";
                                if (exists) { try { orig = await readTextFile(rp); } catch {} }
                                setDiffModalData({
                                  isOpen: true, suggestionKey: key, originalPath: rp,
                                  originalContent: orig, modifiedContent: s.content,
                                  onAccept: async () => {
                                    setApplyingFileKey(key);
                                    try {
                                      await applyAIChangeToFile(rp, s.content, `AI file suggestion`);
                                      setFileExistenceMap(p => ({ ...p, [rp]: true }));
                                      fileExistsCache.set(rp, true);
                                      setTimeout(() => useAIStore.getState().sendMessage(`Accepted \`${s.path}\`. Proceed or output \`<task_complete>\`.`), 500);
                                      setDiffModalData(p => ({ ...p, isOpen: false }));
                                    } finally { setApplyingFileKey(null); }
                                  }
                                });
                              }}>
                              <Eye size={11} /> Diff
                            </button>
                            <button className="aip-action-btn primary" disabled={disabled}
                              onClick={async () => {
                                if (!rp) { addToast("Open a project folder first.", "warning"); return; }
                                if (!window.confirm(`${exists ? "Update" : "Create"} ${rp}?`)) return;
                                setApplyingFileKey(key);
                                try {
                                  await applyAIChangeToFile(rp, s.content, `AI file suggestion`);
                                  setFileExistenceMap(p => ({ ...p, [rp]: true }));
                                  fileExistsCache.set(rp, true);
                                  setTimeout(() => useAIStore.getState().sendMessage(`Accepted \`${s.path}\`. Proceed or output \`<task_complete>\`.`), 500);
                                } finally { setApplyingFileKey(null); }
                              }}>
                              <Check size={11} /> {exists ? "Update" : "Create"}
                            </button>
                            <button className="aip-action-btn" onClick={() => setRejectedFileKeys(p => { const n = new Set(p); n.add(key); return n; })}>
                              <X size={11} />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Shell commands */}
                {shellCmds.length > 0 && (
                  <div className="aip-cmd-list">
                    {shellCmds.map((cmd, idx) => {
                      const key = `${msg.id}-c${idx}`;
                      if (rejectedCmdKeys.has(key)) return null;
                      return (
                        <div key={key} className="aip-cmd-row">
                          <Terminal size={11} className="aip-cmd-icon" />
                          <code className="aip-cmd-code">{cmd}</code>
                          <div className="aip-actions">
                            <button className="aip-action-btn primary"
                              onClick={() => {
                                useTerminalStore.getState().runCommandInTerminal(cmd);
                                addToast("Running in terminal…", "info");
                                setRejectedCmdKeys(s => { const n = new Set(s); n.add(key); return n; });
                              }}>
                              <Check size={11} /> Run
                            </button>
                            <button className="aip-action-btn" onClick={() => setRejectedCmdKeys(s => { const n = new Set(s); n.add(key); return n; })}>
                              <X size={11} />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Sources */}
                {msg.sources && msg.sources.length > 0 && (
                  <div className="aip-sources">
                    {msg.sources.map((src, i) => (
                      <button key={i} className="aip-source" onClick={() => openFile(src.filePath)} title={`${src.filePath}:${src.startLine}`}>
                        <ExternalLink size={9} />
                        {src.filePath.split(/[\\/]/).pop()}:{src.startLine}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          })
        )}

        {/* Agent live stream */}
        {(agentLiveOutput || agentEvents.length > 0) && (isThinking || agentLiveOutput) && (
          <div className="aip-agent-stream">
            <div className="aip-agent-stream-hdr">
              <span>Agent trace</span>
              <button className="aip-icon-btn" onClick={() => setShowThinking(!showThinking)}>
                {showThinking ? <EyeOff size={11} /> : <Eye size={11} />}
              </button>
            </div>
            {agentEvents.slice(-8).map((evt, i) => (
              <div key={`${evt.ts}-${i}`} className={`aip-agent-evt aip-agent-evt-${evt.kind}`}>
                <span className="aip-agent-evt-kind">{evt.kind}</span>
                <span>{evt.message}</span>
              </div>
            ))}
            {showThinking && agentLiveOutput && (
              <div className="aip-agent-thinking aip-msg-body" dangerouslySetInnerHTML={{ __html: marked(agentLiveOutput) as string }} />
            )}
          </div>
        )}

        {/* Agent tool-call trace panel (Task 3.7) */}
        {aiMode === 'agent' && agentSteps.length > 0 && (
          <div className="agent-trace-panel">
            <div className="agent-trace-header">Agent Steps ({agentSteps.length})</div>
            {agentSteps.map((step, i) => (
              <details key={i} className="agent-step-row">
                <summary>
                  <span className="agent-step-tool">{step.tool}</span>
                  <span className="agent-step-num">Step {step.step}</span>
                </summary>
                <div className="agent-step-args">
                  <strong>Args:</strong> {JSON.stringify(step.args).slice(0, 100)}
                </div>
                <div className="agent-step-result">
                  <strong>Result:</strong> {step.result.slice(0, 200)}
                </div>
              </details>
            ))}
          </div>
        )}

        {/* Thinking dots / Loading model spinner */}
        {isThinking && aiMode !== "agent" && (
          <div className="aip-msg aip-msg-assistant">
            {selectedProvider === "local" ? (
              <div className="aip-thinking-local">
                <RefreshCw size={12} className="spin-icon" />
                <span style={{ fontSize: 12, opacity: 0.7 }}>Loading model…</span>
              </div>
            ) : (
              <div className="aip-thinking"><span /><span /><span /></div>
            )}
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* ── Agent control bar ── */}
      {aiMode === "agent" && isThinking && (
        <div className="aip-agent-bar">
          <div className="aip-agent-bar-left">
            <Sparkles size={12} />
            <span>Agent running</span>
            {agentEvents.length > 0 && <span className="aip-agent-step-count">{agentEvents.length} steps</span>}
          </div>
          <button className="aip-stop-btn" onClick={() => abortRequest()} title="Stop agent">
            <StopCircle size={12} /> Stop
          </button>
        </div>
      )}

      {/* ── Input ── */}
      <div className="aip-input-wrap">
        {activeTab && (
          <div className="aip-context-pill">
            <FileCode size={10} />
            <span>{activeTab.fileName}</span>
          </div>
        )}
        {/* @-mention pill badges (Task 7.6) */}
        {mentionedFiles.length > 0 && (
          <div className="aip-mention-pills">
            {mentionedFiles.map(f => (
              <span key={f.path} className="aip-mention-pill">
                {f.path.startsWith("@") ? (
                  <AtSign size={9} />
                ) : f.path === "@folder" ? (
                  <Folder size={9} />
                ) : (
                  <FileCode size={9} />
                )}
                <span className="aip-mention-pill-name">
                  {f.path.startsWith("@") ? f.path : f.path.split(/[\\/]/).pop()}
                </span>
                {f.truncated && <span className="aip-mention-truncated" title="Truncated at 6000 chars">…</span>}
                <button
                  className="aip-mention-remove"
                  onClick={() => removeMentionedFile(f.path)}
                  title="Remove"
                  aria-label={`Remove ${f.path}`}
                >
                  <X size={9} />
                </button>
              </span>
            ))}
          </div>
        )}
        {/* @-mention warning (Task 7.3) */}
        {mentionWarning && (
          <div className="aip-mention-warning">
            <AlertTriangle size={11} /> {mentionWarning}
          </div>
        )}
        <div className="aip-input-row" style={{ position: "relative" }}>
          {/* @-mention autocomplete dropdown (Task 7.1) */}
          {mentionQuery !== null && mentionDropdown.length > 0 && (
            <div className="aip-mention-dropdown" ref={mentionDropdownRef}>
              {mentionDropdown.map((item, idx) => (
                <button
                  key={item}
                  className={`aip-mention-option ${idx === mentionDropdownIdx ? "active" : ""}`}
                  onMouseDown={e => { e.preventDefault(); handleMentionSelect(item); }}
                >
                  {item === "@errors" ? (
                    <><Terminal size={10} /> @errors</>
                  ) : item === "@folder" ? (
                    <><Folder size={10} /> @folder</>
                  ) : (
                    <><FileCode size={10} /> {item.split(/[\\/]/).pop()}<span className="aip-mention-path">{item}</span></>
                  )}
                </button>
              ))}
            </div>
          )}
          <textarea
            ref={inputRef}
            value={input}
            onChange={handleInputChange}
            onKeyDown={handleInputKeyDown}
            placeholder={`Ask AI… (${aiMode}${useRAG ? " + RAG" : ""}) — type @ to mention files`}
            rows={3}
            disabled={(needsOllama && !isOllamaRunning) || isThinking}
            className="aip-textarea"
          />
          <button className="aip-send" onClick={handleSend} disabled={!canSend} title="Send (Enter)">
            <Send size={14} />
          </button>
        </div>
      </div>

      {/* Diff modal */}
      {diffModalData.isOpen && (
        <DiffModal
          isOpen={diffModalData.isOpen}
          originalPath={diffModalData.originalPath}
          originalContent={diffModalData.originalContent}
          modifiedContent={diffModalData.modifiedContent}
          onAccept={diffModalData.onAccept}
          onReject={() => setDiffModalData(p => ({ ...p, isOpen: false }))}
          onClose={() => setDiffModalData(p => ({ ...p, isOpen: false }))}
        />
      )}

      {/* Agent confirmation dialog (Task 3.8) */}
      {confirmPending && (
        <div className="agent-confirm-overlay">
          <div className="agent-confirm-dialog">
            <h3>Confirm {confirmPending.tool === 'delete_file' ? 'Delete' : 'Write'} File</h3>
            <p className="agent-confirm-path">{confirmPending.path}</p>
            <pre className="agent-confirm-diff">{confirmPending.diff}</pre>
            <div className="agent-confirm-actions">
              <button
                className="agent-confirm-approve"
                onClick={() => {
                  emit(`ai-agent-confirm-${confirmPending.confirmId}`, { confirmed: true });
                  setConfirmPending(null);
                }}
              >
                Approve
              </button>
              <button
                className="agent-confirm-deny"
                onClick={() => {
                  emit(`ai-agent-confirm-${confirmPending.confirmId}`, { confirmed: false });
                  setConfirmPending(null);
                }}
              >
                Deny
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
