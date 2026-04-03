// src/components/sidebar/ProblemsPanel.tsx — PyCharm-style diagnostics panel
import { useMemo, useState, useEffect } from "react";
import {
  AlertCircle, AlertTriangle, Info, X, ChevronDown, ChevronRight,
  FileCode, Copy, ExternalLink, Lightbulb, RefreshCw, Search,
  HelpCircle, Sparkles, CheckCircle2, Wrench, MessageSquareText, Play,
} from "lucide-react";
import { useTerminalStore } from "../../store/terminalStore";
import { useEditorStore } from "../../store/editorStore";
import { useUIStore } from "../../store/uiStore";
import { useAIStore } from "../../store/aiStore";
import {
  categoryIcon, severityOrder, analyzeFileContent,
} from "../../utils/errorParser";
import type { DetectedError, ErrorSeverity } from "../../utils/errorParser";

interface ProblemsPanelProps { onClose: () => void; }

type FilterSev = "all" | "error" | "warning" | "info" | "hint";

interface ProblemExplanation {
  understanding: string;
  verifySteps: string[];
  fixSteps: string[];
}

interface ProblemGuide {
  understanding: string;
  verify: string[];
  fix: string[];
}

const DEFAULT_PROBLEM_GUIDE: ProblemGuide = {
  understanding: "the code or command result does not match what the runtime or tooling expects",
  verify: [
    "Re-run the same command to confirm the issue is reproducible.",
    "Check the exact file and line referenced by the issue.",
  ],
  fix: [
    "Apply the smallest safe code change that resolves the reported mismatch.",
    "Re-run lint/build/tests to confirm the issue is resolved and no regressions are introduced.",
  ],
};

const CATEGORY_GUIDES: Partial<Record<DetectedError["category"], ProblemGuide>> = {
  missing_package: {
    understanding: "a required dependency is missing from your project environment",
    verify: [
      "Check dependency files (`package.json`, `requirements.txt`, `Cargo.toml`) for the package entry.",
      "Confirm the package name and version are valid.",
    ],
    fix: [
      "Install the missing package and regenerate lockfiles if needed.",
      "Restart tooling/server after install so module resolution refreshes.",
    ],
  },
  import_error: {
    understanding: "the import path or exported symbol cannot be resolved",
    verify: [
      "Verify the target file exists and path casing is correct.",
      "Check whether the symbol is exported from the target module.",
    ],
    fix: [
      "Correct the import path or switch to a valid exported symbol.",
      "Keep import style aligned with the project module system (ESM/CommonJS).",
    ],
  },
  syntax_error: {
    understanding: "the parser encountered invalid language syntax",
    verify: [
      "Inspect nearby brackets/quotes/commas around the flagged line.",
      "Run formatter/linter to locate the exact broken token.",
    ],
    fix: [
      "Fix the syntax first before addressing downstream errors.",
      "Re-run lint/build after syntax repair to uncover remaining issues.",
    ],
  },
  type_error: {
    understanding: "the value types do not match function or variable expectations",
    verify: [
      "Inspect the reported type and the expected type side by side.",
      "Trace where the value is created or transformed before usage.",
    ],
    fix: [
      "Adjust types or conversion logic to match the expected contract.",
      "Prefer narrowing/guards over unsafe casts when possible.",
    ],
  },
  runtime_error: {
    understanding: "execution reached a state the runtime cannot safely handle",
    verify: [
      "Check inputs and runtime assumptions leading to this code path.",
      "Confirm environment values and dependency availability at runtime.",
    ],
    fix: [
      "Add defensive checks for null/undefined/invalid states.",
      "Handle failure paths explicitly and return safe fallbacks when possible.",
    ],
  },
  null_safety: {
    understanding: "a value may be null or undefined before it is accessed",
    verify: [
      "Identify where the value can become null/undefined.",
      "Review control flow to ensure guards run before property access.",
    ],
    fix: [
      "Add null checks, optional chaining, or defaults before access.",
      "Improve upstream typing so nullable states are explicit.",
    ],
  },
  version_conflict: {
    understanding: "dependency versions are incompatible with each other",
    verify: [
      "Inspect peer dependency warnings and lockfile conflict lines.",
      "Confirm package manager consistency (`npm`, `pnpm`, `yarn`).",
    ],
    fix: [
      "Align conflicting dependency versions and reinstall cleanly.",
      "Commit lockfile updates with the dependency change.",
    ],
  },
  code_smell: {
    understanding: "this pattern is legal but risky for maintainability or production reliability",
    verify: [
      "Confirm whether the pattern is intentional or leftover debug code.",
      "Check project lint rules for enforcement expectations.",
    ],
    fix: [
      "Refactor to the project-approved pattern or abstraction.",
      "Replace temporary/debug constructs with production-safe equivalents.",
    ],
  },
  unused_variable: {
    understanding: "a declared value is never read, which adds noise and confusion",
    verify: [
      "Check whether the variable should be removed or actually used.",
      "If intentional, verify project convention for intentionally unused values.",
    ],
    fix: [
      "Remove the unused variable/import, or rename using underscore convention.",
      "Re-run lint to ensure no similar leftovers remain.",
    ],
  },
  unused_import: {
    understanding: "an import exists but is never used in the file",
    verify: [
      "Confirm the import is not needed by current logic.",
      "Check tree-shaking/build warnings for related dead code.",
    ],
    fix: [
      "Remove unused imports and keep dependency boundaries clean.",
      "Run lint autofix if available.",
    ],
  },
  permission_error: {
    understanding: "the process lacks permission to access a file or command",
    verify: [
      "Check file ownership and executable permissions.",
      "Confirm the command is run from the correct environment/user.",
    ],
    fix: [
      "Adjust permissions safely (`chmod`, ownership, access policy).",
      "Avoid broad permission grants; apply only what is required.",
    ],
  },
};

function problemKey(err: DetectedError) {
  return `${err.file ?? "(no file)"}:${err.line ?? 0}:${err.column ?? 0}:${err.title}:${err.code ?? ""}:${err.source ?? ""}`;
}

function dedupeSteps(items: string[], max = 5): string[] {
  const unique: string[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    const trimmed = item.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(trimmed);
    if (unique.length >= max) break;
  }
  return unique;
}

function buildProblemExplanation(err: DetectedError): ProblemExplanation {
  const guide = CATEGORY_GUIDES[err.category] ?? DEFAULT_PROBLEM_GUIDE;
  const location = err.file
    ? `${err.file}${err.line ? `:${err.line}` : ""}${err.column ? `:${err.column}` : ""}`
    : "the reported location";

  const understandingParts = [
    `This ${err.severity} indicates ${guide.understanding}.`,
    err.detail && err.detail !== err.title ? err.detail : "",
    err.source ? `Reported by ${err.source}${err.code ? ` (${err.code})` : ""}.` : "",
  ].filter(Boolean);

  const verifySteps = dedupeSteps([
    `Inspect ${location} and confirm the exact failing line.`,
    ...guide.verify,
    err.rawLine ? `Compare against terminal/linter output: "${err.rawLine.slice(0, 180)}"` : "",
  ]);

  const fixSteps = dedupeSteps([
    err.suggestion ?? "",
    err.installCommand ? `Run \`${err.installCommand}\` to install required dependencies.` : "",
    err.updateCommand ? `Run \`${err.updateCommand}\` to align versions/types.` : "",
    err.uninstallCommand ? `If needed, remove conflicting dependency: \`${err.uninstallCommand}\`.` : "",
    ...guide.fix,
    err.docsUrl ? "Open the linked docs for exact API and configuration details." : "",
  ]);

  return {
    understanding: understandingParts.join(" "),
    verifySteps,
    fixSteps,
  };
}

function getSuggestedFixCommand(err: DetectedError): string | null {
  return err.installCommand ?? err.updateCommand ?? err.uninstallCommand ?? null;
}

// ── Severity icon ─────────────────────────────────────────────────────────────
function SevIcon({ sev, size = 12 }: { sev: ErrorSeverity; size?: number }) {
  if (sev === "error")   return <AlertCircle  size={size} className="pi-err" />;
  if (sev === "warning") return <AlertTriangle size={size} className="pi-warn" />;
  if (sev === "hint")    return <Lightbulb    size={size} className="pi-hint" />;
  return <Info size={size} className="pi-info" />;
}

// ── Gutter badge (PyCharm-style inline count) ─────────────────────────────────
function GutterBadge({ errors, warnings, hints }: { errors: number; warnings: number; hints: number }) {
  if (errors + warnings + hints === 0) return null;
  return (
    <span className="pi-gutter-badge">
      {errors > 0   && <span className="pi-gb-err"><AlertCircle size={9} />{errors}</span>}
      {warnings > 0 && <span className="pi-gb-warn"><AlertTriangle size={9} />{warnings}</span>}
      {hints > 0    && <span className="pi-gb-hint"><Lightbulb size={9} />{hints}</span>}
    </span>
  );
}

export function ProblemsPanel({ onClose }: ProblemsPanelProps) {
  const { lastErrors, clearLastErrors, showAndTrackCommand, showTerminalTab } = useTerminalStore();
  const { tabs, activeTabId, openFileAt } = useEditorStore();
  const { addToast, setActiveView, toggleAIPanel, showAIPanel } = useUIStore();
  const sendMessage = useAIStore((s) => s.sendMessage);
  const setAIMode = useAIStore((s) => s.setAIMode);

  const [filterSev, setFilterSev] = useState<FilterSev>("all");
  const [search, setSearch] = useState("");
  const [collapsedFiles, setCollapsedFiles] = useState<Set<string>>(new Set());
  const [staticErrors, setStaticErrors] = useState<DetectedError[]>([]);
  const [openExplanationKey, setOpenExplanationKey] = useState<string | null>(null);

  // Run static analysis on open tabs
  useEffect(() => {
    const results: DetectedError[] = [];
    for (const tab of tabs) {
      if (!tab.content || tab.filePath.startsWith("untitled:")) continue;
      const analyzed = analyzeFileContent(tab.content, tab.language, tab.filePath);
      results.push(...analyzed);
    }
    setStaticErrors(results);
  }, [tabs]);

  // Merge terminal errors + static analysis
  const allErrors = useMemo(() => {
    const merged = [...lastErrors, ...staticErrors];
    // Deduplicate by file+line+title
    const seen = new Set<string>();
    return merged.filter(e => {
      const key = `${e.file ?? ""}:${e.line ?? ""}:${e.title}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [lastErrors, staticErrors]);

  const counts = useMemo(() => ({
    error:   allErrors.filter(e => e.severity === "error").length,
    warning: allErrors.filter(e => e.severity === "warning").length,
    info:    allErrors.filter(e => e.severity === "info").length,
    hint:    allErrors.filter(e => e.severity === "hint").length,
  }), [allErrors]);

  // Filter + search
  const filtered = useMemo(() => {
    let list = allErrors;
    if (filterSev !== "all") list = list.filter(e => e.severity === filterSev);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(e =>
        e.title.toLowerCase().includes(q) ||
        e.detail.toLowerCase().includes(q) ||
        (e.file ?? "").toLowerCase().includes(q) ||
        (e.source ?? "").toLowerCase().includes(q)
      );
    }
    return list;
  }, [allErrors, filterSev, search]);

  // Group by file
  const byFile = useMemo(() => {
    const map = new Map<string, DetectedError[]>();
    for (const e of filtered) {
      const key = e.file ?? "(no file)";
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(e);
    }
    // Sort within each file by line number
    for (const [, errs] of map) {
      errs.sort((a, b) => (a.line ?? 0) - (b.line ?? 0) || severityOrder(a.severity) - severityOrder(b.severity));
    }
    // Sort files: files with errors first
    return [...map.entries()].sort(([, a], [, b]) => {
      const aErr = a.filter(e => e.severity === "error").length;
      const bErr = b.filter(e => e.severity === "error").length;
      return bErr - aErr || a.length - b.length;
    });
  }, [filtered]);

  const toggleFile = (file: string) => {
    setCollapsedFiles(prev => {
      const next = new Set(prev);
      if (next.has(file)) next.delete(file); else next.add(file);
      return next;
    });
  };

  const handleNavigate = async (err: DetectedError) => {
    if (!err.file) return;
    try {
      await openFileAt(err.file, err.line ?? 1, err.column ?? 1);
    } catch {
      addToast(`Could not open ${err.file}`, "warning");
    }
  };

  const handleCopy = (err: DetectedError) => {
    const text = `[${err.severity.toUpperCase()}] ${err.title}\n${err.detail}${err.file ? `\n${err.file}${err.line ? `:${err.line}` : ""}` : ""}`;
    navigator.clipboard.writeText(text).then(() => addToast("Copied", "success")).catch(() => {});
  };

  const handleCopyFix = (cmd: string) => {
    navigator.clipboard.writeText(cmd).then(() => addToast("Fix command copied", "success")).catch(() => {});
  };

  const handleRunFix = (err: DetectedError) => {
    const cmd = getSuggestedFixCommand(err);
    if (!cmd) return;
    const requestKey = `problem-fix-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    showAndTrackCommand(cmd, {
      source: "manual",
      analyzeWithAI: true,
      requestKey,
    });
    showTerminalTab("run");
    addToast("Running suggested fix command in terminal…", "info");
  };

  const handleAskAI = (err: DetectedError) => {
    const location = err.file
      ? `${err.file}${err.line ? `:${err.line}` : ""}${err.column ? `:${err.column}` : ""}`
      : "unknown location";
    const prompt = [
      "Explain this detected issue and propose a safe minimal fix.",
      "",
      `[Issue]`,
      `Severity: ${err.severity}`,
      `Category: ${err.category}`,
      `Title: ${err.title}`,
      `Detail: ${err.detail || "(no additional detail)"}`,
      `Location: ${location}`,
      err.source ? `Source: ${err.source}` : "",
      err.code ? `Code: ${err.code}` : "",
      err.rawLine ? `Raw output: ${err.rawLine}` : "",
      "",
      "Please respond with:",
      "1) Understanding the problem",
      "2) Root-cause candidates",
      "3) Verification checklist",
      "4) Minimal fix plan",
      "5) Regression checks",
    ].filter(Boolean).join("\n");

    setAIMode("think");
    setActiveView("ai");
    if (!showAIPanel) toggleAIPanel();
    addToast("Asking AI Assistant to explain this issue…", "info");
    void sendMessage(prompt).catch(() => {
      addToast("Could not send this issue to AI Assistant.", "warning");
    });
  };

  const activeFile = tabs.find(t => t.id === activeTabId)?.filePath;

  return (
    <div className="pi-panel">
      {/* Header */}
      <div className="pi-header">
        <div className="pi-header-left">
          <AlertCircle size={13} className="pi-err" />
          <span className="pi-header-title">Problems</span>
          {allErrors.length > 0 && <span className="pi-total">{allErrors.length}</span>}
        </div>
        <div className="pi-header-right">
          <button className="pi-icon-btn" onClick={clearLastErrors} title="Clear terminal errors">
            <RefreshCw size={11} />
          </button>
          <button className="pi-icon-btn" onClick={onClose} title="Close">
            <X size={12} />
          </button>
        </div>
      </div>

      {/* Filter bar */}
      <div className="pi-filterbar">
        <div className="pi-sev-tabs">
          {([
            { id: "all",     label: "All",      count: allErrors.length },
            { id: "error",   label: "Errors",   count: counts.error,   cls: "err" },
            { id: "warning", label: "Warnings", count: counts.warning, cls: "warn" },
            { id: "info",    label: "Info",     count: counts.info,    cls: "info" },
            { id: "hint",    label: "Hints",    count: counts.hint,    cls: "hint" },
          ] as { id: FilterSev; label: string; count: number; cls?: string }[]).map(tab => (
            <button
              key={tab.id}
              className={`pi-sev-tab ${filterSev === tab.id ? "active" : ""} ${tab.cls ?? ""}`}
              onClick={() => setFilterSev(tab.id)}
            >
              {tab.id === "error"   && <AlertCircle  size={10} />}
              {tab.id === "warning" && <AlertTriangle size={10} />}
              {tab.id === "hint"    && <Lightbulb    size={10} />}
              {tab.id === "info"    && <Info         size={10} />}
              <span>{tab.label}</span>
              {tab.count > 0 && <span className="pi-sev-count">{tab.count}</span>}
            </button>
          ))}
        </div>
        <div className="pi-search-row">
          <Search size={11} className="pi-search-icon" />
          <input
            className="pi-search"
            placeholder="Filter problems…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          {search && <button className="pi-icon-btn" onClick={() => setSearch("")}><X size={10} /></button>}
        </div>
      </div>

      {/* Problem list */}
      <div className="pi-list">
        {allErrors.length === 0 ? (
          <div className="pi-empty">
            <AlertCircle size={24} style={{ opacity: 0.15 }} />
            <p>No problems detected</p>
            <p className="pi-empty-sub">Run your code in the terminal to detect errors, or open files for static analysis</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="pi-empty"><p>No matching problems</p></div>
        ) : (
          byFile.map(([file, errs]) => {
            const isCollapsed = collapsedFiles.has(file);
            const fileErrors   = errs.filter(e => e.severity === "error").length;
            const fileWarnings = errs.filter(e => e.severity === "warning").length;
            const fileHints    = errs.filter(e => e.severity === "hint" || e.severity === "info").length;
            const shortName = file === "(no file)" ? "(no file)" : file.split(/[\\/]/).pop() ?? file;
            const dirName = file === "(no file)" ? "" : file.split(/[\\/]/).slice(0, -1).join("/");
            const isActive = file === activeFile;

            return (
              <div key={file} className={`pi-file-group ${isActive ? "pi-file-active" : ""}`}>
                {/* File header */}
                <button className="pi-file-header" onClick={() => toggleFile(file)}>
                  {isCollapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
                  <FileCode size={12} className="pi-file-icon" />
                  <span className="pi-file-name">{shortName}</span>
                  {dirName && <span className="pi-file-dir">{dirName}</span>}
                  <span className="pi-file-count">{errs.length}</span>
                  <GutterBadge errors={fileErrors} warnings={fileWarnings} hints={fileHints} />
                </button>

                {/* Problem rows */}
                {!isCollapsed && errs.map((err, i) => {
                  const id = `${problemKey(err)}:${i}`;
                  const explainOpen = openExplanationKey === id;
                  const explanation = buildProblemExplanation(err);
                  const suggestedFixCommand = getSuggestedFixCommand(err);

                  return (
                  <div key={id} className={`pi-item pi-item-${err.severity}`}>
                    <div className="pi-item-main">
                      <SevIcon sev={err.severity} />
                      <div className="pi-item-body">
                        <div className="pi-item-title-row">
                          <span className="pi-item-cat">{categoryIcon(err.category)}</span>
                          <span className="pi-item-title">{err.title}</span>
                          {err.source && <span className="pi-item-source">{err.source}</span>}
                          {err.code && <span className="pi-item-code">{err.code}</span>}
                        </div>
                        {err.detail && err.detail !== err.title && (
                          <div className="pi-item-detail">{err.detail}</div>
                        )}
                        {err.suggestion && (
                          <div className="pi-item-suggestion">
                            <Lightbulb size={9} /> {err.suggestion}
                          </div>
                        )}
                        <div className="pi-item-meta-row">
                          <button
                            className={`pi-ai-trigger ${explainOpen ? "active" : ""}`}
                            onClick={() => setOpenExplanationKey(prev => prev === id ? null : id)}
                            title="Understand this issue"
                          >
                            <HelpCircle size={9} /> Understand this issue
                          </button>
                          {err.file && (
                            <button className="pi-item-loc" onClick={() => handleNavigate(err)} title="Jump to location">
                              <FileCode size={9} />
                              {shortName}{err.line ? `:${err.line}` : ""}{err.column ? `:${err.column}` : ""}
                              <ExternalLink size={8} />
                            </button>
                          )}
                          {err.installCommand && (
                            <button className="pi-fix-btn" onClick={() => handleCopyFix(err.installCommand!)} title="Copy fix command">
                              <Copy size={9} /> {err.installCommand}
                            </button>
                          )}
                          {err.docsUrl && (
                            <a className="pi-docs-link" href={err.docsUrl} target="_blank" rel="noreferrer">
                              <ExternalLink size={9} /> Docs
                            </a>
                          )}
                        </div>
                        {explainOpen && (
                          <div className="pi-ai-explainer">
                            <div className="pi-ai-explainer-head">
                              <span className="pi-ai-explainer-badge">
                                <Sparkles size={10} /> Explanation
                              </span>
                              {err.source && (
                                <span className="pi-ai-explainer-source">
                                  {err.source}{err.code ? ` · ${err.code}` : ""}
                                </span>
                              )}
                            </div>

                            <div className="pi-ai-section">
                              <div className="pi-ai-section-title">
                                <HelpCircle size={10} /> Understanding the problem
                              </div>
                              <p>{explanation.understanding}</p>
                            </div>

                            <div className="pi-ai-section">
                              <div className="pi-ai-section-title">
                                <CheckCircle2 size={10} /> How to verify
                              </div>
                              <ul className="pi-ai-list">
                                {explanation.verifySteps.map((step, stepIdx) => (
                                  <li key={`${id}-verify-${stepIdx}`}>{step}</li>
                                ))}
                              </ul>
                            </div>

                            <div className="pi-ai-section">
                              <div className="pi-ai-section-title">
                                <Wrench size={10} /> Suggested fix path
                              </div>
                              <ul className="pi-ai-list">
                                {explanation.fixSteps.map((step, stepIdx) => (
                                  <li key={`${id}-fix-${stepIdx}`}>{step}</li>
                                ))}
                              </ul>
                            </div>

                            <div className="pi-ai-actions">
                              <button className="pi-ai-action-btn" onClick={() => handleAskAI(err)}>
                                <MessageSquareText size={10} /> Ask AI Assistant
                              </button>
                              {suggestedFixCommand && (
                                <button
                                  className="pi-ai-action-btn run"
                                  onClick={() => handleRunFix(err)}
                                  title={suggestedFixCommand}
                                >
                                  <Play size={10} /> Run suggested command
                                </button>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                      <button className="pi-copy-btn" onClick={() => handleCopy(err)} title="Copy">
                        <Copy size={10} />
                      </button>
                    </div>
                  </div>
                )})}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
