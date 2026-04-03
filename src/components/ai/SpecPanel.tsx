// src/components/ai/SpecPanel.tsx — Advanced Kiro/Codex-style spec panel
import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import {
  Sparkles, FileText, Layers, ClipboardList, Play, CheckCircle,
  XCircle, Clock, RefreshCw, ChevronDown, ChevronRight, RotateCcw,
  AlertTriangle, Check, Edit3, X, List, SkipForward,
  ThumbsUp, ThumbsDown, Zap, Eye, Copy, FolderOpen, Terminal,
} from "lucide-react";
import { useSpecStore, type SpecTask, type TaskExecutionPreview, type TaskStatus } from "../../store/specStore";
import { useEditorStore } from "../../store/editorStore";
import { marked } from "marked";
import DOMPurify from "dompurify";

// ── Helpers ───────────────────────────────────────────────────────────────────

function md(content: string) {
  return DOMPurify.sanitize(marked.parse(content) as string);
}

function TaskIcon({ status }: { status: TaskStatus }) {
  if (status === "done")        return <CheckCircle size={13} className="spec-ti done" />;
  if (status === "in_progress") return <RefreshCw   size={13} className="spec-ti active spin-icon" />;
  if (status === "review")      return <Eye         size={13} className="spec-ti review" />;
  if (status === "failed")      return <XCircle     size={13} className="spec-ti failed" />;
  if (status === "skipped")     return <SkipForward size={13} className="spec-ti skipped" />;
  return <Clock size={13} className="spec-ti pending" />;
}

function PhaseBar({
  activeTab,
  onSelectTab,
}: {
  activeTab: "requirements" | "design" | "tasks" | "log";
  onSelectTab: (tab: "requirements" | "design" | "tasks" | "log") => void;
}) {
  const { phase, doc, executionLog } = useSpecStore();
  const steps = [
    {
      id: "requirements",
      label: "Requirements",
      icon: <FileText size={10} />,
      tab: "requirements" as const,
      available: !!doc.requirements,
    },
    {
      id: "design",
      label: "Design",
      icon: <Layers size={10} />,
      tab: "design" as const,
      available: !!doc.design,
    },
    {
      id: "tasks",
      label: "Tasks",
      icon: <ClipboardList size={10} />,
      tab: "tasks" as const,
      available: doc.tasks.length > 0,
    },
    {
      id: "executing",
      label: "Execute",
      icon: <Play size={10} />,
      tab: executionLog.length > 0 ? ("log" as const) : ("tasks" as const),
      available: doc.tasks.length > 0 || executionLog.length > 0,
    },
  ];

  const phaseOrder = ["idle", "analyzing", "requirements", "design", "tasks", "executing", "complete"];
  const currentIdx = phaseOrder.indexOf(phase);
  const visibleSteps = steps.filter(step => step.available || phase === step.id);
  if (visibleSteps.length === 0) visibleSteps.push(steps[0]);

  return (
    <div className="spec-phasebar">
      {visibleSteps.map((step, i) => {
        const stepIdx = phaseOrder.indexOf(step.id);
        const isDone = currentIdx > stepIdx || phase === "complete";
        const isActive =
          phase === step.id ||
          (step.id === "tasks" && phase === "executing") ||
          (step.id === "executing" && activeTab === "log") ||
          (step.id === "requirements" && activeTab === "requirements") ||
          (step.id === "design" && activeTab === "design") ||
          (step.id === "tasks" && activeTab === "tasks");
        return (
          <div key={step.id} className="spec-phasebar-item">
            <button
              type="button"
              className={`spec-phasebar-step ${isDone ? "done" : ""} ${isActive ? "active" : ""} ${step.available ? "available" : ""}`}
              onClick={() => {
                if (step.available) onSelectTab(step.tab);
              }}
              disabled={!step.available}
              title={step.available ? `Open ${step.label}` : `${step.label} will unlock in the workflow`}
            >
              <div className={`spec-phasebar-dot ${isDone ? "done" : isActive ? "active" : ""}`}>
                {isDone ? <Check size={9} /> : step.icon}
              </div>
              <span className={`spec-phasebar-label ${isActive ? "active" : isDone ? "done" : ""}`}>
                {step.label}
              </span>
            </button>
            {i < visibleSteps.length - 1 && (
              <div className={`spec-phasebar-line ${isDone ? "done" : ""}`} />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Approval gate ─────────────────────────────────────────────────────────────

function ApprovalGate({
  label, onApprove, onReject, isGenerating,
}: { label: string; onApprove: () => void; onReject: (fb?: string) => void; isGenerating: boolean }) {
  const [showFeedback, setShowFeedback] = useState(false);
  const [feedback, setFeedback] = useState("");

  return (
    <div className="spec-approval-gate">
      <div className="spec-approval-label">
        <Sparkles size={12} />
        <span>{label}</span>
      </div>
      {!showFeedback ? (
        <div className="spec-approval-btns">
          <button type="button" className="spec-btn spec-btn-approve" onClick={onApprove} disabled={isGenerating}>
            <ThumbsUp size={12} /> Approve & Continue
          </button>
          <button type="button" className="spec-btn spec-btn-reject" onClick={() => setShowFeedback(true)} disabled={isGenerating}>
            <ThumbsDown size={12} /> Revise
          </button>
        </div>
      ) : (
        <div className="spec-feedback-form">
          <textarea
            className="spec-feedback-input"
            placeholder="What should be changed? (optional — leave blank to regenerate)"
            value={feedback}
            onChange={e => setFeedback(e.target.value)}
            rows={3}
          />
          <div className="spec-approval-btns">
            <button type="button" className="spec-btn spec-btn-reject" onClick={() => { onReject(feedback || undefined); setShowFeedback(false); setFeedback(""); }} disabled={isGenerating}>
              <RefreshCw size={12} /> Regenerate
            </button>
            <button type="button" className="spec-btn" onClick={() => setShowFeedback(false)}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main panel ────────────────────────────────────────────────────────────────

export function SpecPanel() {
  const store = useSpecStore();
  const {
    phase, query, doc, taskPreviews, activeTaskId, isGenerating, generatingLabel,
    error, executionLog, pendingApproval, autoApprove,
    setQuery, setAutoApprove, startFromQuery,
    approveAndContinue, rejectAndRegenerate,
    approveTask, approveAllTasks, approveTaskPreview, rejectTaskPreview, executeApprovedTasks,
    executeTask, retryTask, skipTask, resetSpec,
    updateRequirements, updateDesign,
  } = store;

  const { openFolder } = useEditorStore();
  const [activeTab, setActiveTab] = useState<"requirements" | "design" | "tasks" | "log">("requirements");
  const [editingReqs, setEditingReqs] = useState(false);
  const [editingDesign, setEditingDesign] = useState(false);
  const [expandedTask, setExpandedTask] = useState<string | null>(null);
  const [localQuery, setLocalQuery] = useState(query);
  const logEndRef = useRef<HTMLDivElement>(null);
  const queryRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    setLocalQuery(query);
  }, [query]);

  // Auto-switch tab when phase advances
  useEffect(() => {
    if (phase === "design") setActiveTab("design");
    else if (phase === "tasks" || phase === "executing" || phase === "complete") setActiveTab("tasks");
  }, [phase]);

  // Auto-scroll log
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [executionLog]);

  const doneCount = doc.tasks.filter(t => t.status === "done").length;
  const approvedCount = doc.tasks.filter(t => t.approved).length;
  const totalCount = doc.tasks.length;
  const progress = totalCount > 0 ? Math.round((doneCount / totalCount) * 100) : 0;
  const hasFailures = doc.tasks.some(t => t.status === "failed");
  const isComplete = phase === "complete";
  const previewEntries = useMemo(
    () => Object.values(taskPreviews).sort((a, b) => a.generatedAt - b.generatedAt),
    [taskPreviews]
  );
  const pendingPreview = previewEntries[0] ?? null;
  const hasPendingPreview = !!pendingPreview;

  const handleStart = useCallback(() => {
    const q = localQuery.trim();
    if (!q) return;
    setQuery(q);
    void startFromQuery(q, "requirements");
  }, [localQuery, setQuery, startFromQuery]);

  // ── Idle screen ──────────────────────────────────────────────────────────

  if (phase === "idle") {
    return (
      <div className="spec-panel">
        <div className="spec-idle">
          <div className="spec-idle-hero">
            <div className="spec-idle-icon"><Sparkles size={32} /></div>
            <h3 className="spec-idle-title">AI Spec Agent</h3>
            <p className="spec-idle-sub">
              Describe what you want to build. The agent will analyze your project,
              write requirements, design the solution, create tasks, and implement them — one by one.
            </p>
          </div>

          <div className="spec-idle-flow">
            <div className="spec-flow-chip">
              <FolderOpen size={11} />
              <span>Analyze Project</span>
            </div>
          </div>

          <div className="spec-start-hint">
            <strong>Sequential agent workflow</strong>
            <span>Stages remain hidden until reached: Requirements → Design → Tasks → Execute.</span>
          </div>

          {openFolder ? (
            <div className="spec-project-badge">
              <FolderOpen size={11} />
              <span>{openFolder.split(/[\\/]/).pop()}</span>
              <span className="spec-project-badge-sub">project will be analyzed automatically</span>
            </div>
          ) : (
            <div className="spec-no-folder-hint">
              <AlertTriangle size={11} />
              <span>Open a project folder for best results (Ctrl+Shift+E)</span>
            </div>
          )}

          <div className="spec-idle-form">
            <textarea
              ref={queryRef}
              className="spec-query-input"
              placeholder={`Describe what you want to build…\n\nExamples:\n• Add user authentication with JWT and a profile page\n• Create a dark mode toggle that persists to localStorage\n• Build a REST API endpoint for file uploads with validation`}
              value={localQuery}
              onChange={e => setLocalQuery(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) handleStart(); }}
              rows={6}
            />
            <div className="spec-idle-options">
              <label className="spec-toggle-label">
                <input type="checkbox" checked={autoApprove} onChange={e => setAutoApprove(e.target.checked)} />
                <span>Auto-approve all phases</span>
              </label>
              <span className="spec-hint-text">Ctrl+Enter to start</span>
            </div>
            {error && (
              <div className="spec-idle-error" role="alert">
                <AlertTriangle size={12} />
                <span>{error}</span>
              </div>
            )}
            <button
              type="button"
              className="spec-start-btn"
              onClick={() => handleStart()}
              disabled={!localQuery.trim()}
              aria-busy={isGenerating}
            >
              <Sparkles size={14} />
              {isGenerating ? "Starting…" : "Draft Requirements"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Active workflow ──────────────────────────────────────────────────────

  return (
    <div className="spec-panel">
      {/* Header */}
      <div className="spec-header">
        <div className="spec-header-row">
          <div className="spec-header-title">
            <Sparkles size={12} />
            <span title={doc.featureQuery}>{doc.featureName || doc.featureQuery.slice(0, 35)}</span>
          </div>
          <div className="spec-header-actions">
            <label className="spec-auto-toggle" title="Auto-approve all phases">
              <input type="checkbox" checked={autoApprove} onChange={e => setAutoApprove(e.target.checked)} />
              <Zap size={11} />
            </label>
            <button type="button" className="spec-icon-btn" onClick={resetSpec} title="Start over">
              <RotateCcw size={12} />
            </button>
          </div>
        </div>

        <PhaseBar activeTab={activeTab} onSelectTab={setActiveTab} />

        {/* Progress */}
        {totalCount > 0 && (
          <div className="spec-progress-row">
            <div className="spec-progress-track">
              <div className="spec-progress-fill" style={{ width: `${progress}%` }} />
            </div>
            <span className="spec-progress-text">{doneCount}/{totalCount}</span>
            {isComplete && <span className="spec-complete-badge">✓ Done</span>}
          </div>
        )}

        {/* Generating indicator */}
        {isGenerating && (
          <div className="spec-generating-bar">
            <RefreshCw size={11} className="spin-icon" />
            <span>{generatingLabel}</span>
          </div>
        )}
      </div>

      {/* Error */}
      {error && (
        <div className="spec-error-bar">
          <AlertTriangle size={12} />
          <span>{error}</span>
          <button type="button" className="spec-icon-btn" onClick={() => useSpecStore.setState({ error: null })}>
            <X size={11} />
          </button>
        </div>
      )}

      {/* Tabs */}
      <div className="spec-tabs">
        {[
          { id: "requirements", label: "Requirements", avail: !!doc.requirements },
          { id: "design",       label: "Design",       avail: !!doc.design },
          { id: "tasks",        label: `Tasks${totalCount ? ` (${totalCount})` : ""}`, avail: totalCount > 0 },
          { id: "log",          label: "Log",          avail: executionLog.length > 0 },
        ].map(tab => (
          <button
            key={tab.id}
            type="button"
            className={`spec-tab ${activeTab === tab.id ? "active" : ""} ${!tab.avail ? "dim" : ""}`}
            onClick={() => tab.avail && setActiveTab(tab.id as typeof activeTab)}
            disabled={!tab.avail}
          >
            {tab.label}
            {tab.id === "tasks" && hasFailures && <span className="spec-tab-dot fail" />}
            {tab.id === "tasks" && isComplete && <span className="spec-tab-dot ok" />}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="spec-body">

        {/* ── Requirements ── */}
        {activeTab === "requirements" && (
          <div className="spec-doc-view">
            {!doc.requirements && (
              <div className="spec-empty-state">
                <FileText size={22} />
                <p>Requirements will appear here</p>
              </div>
            )}
            {doc.requirements && (
              <>
                <div className="spec-doc-toolbar">
                  <button type="button" className="spec-icon-btn" onClick={() => setEditingReqs(v => !v)} title={editingReqs ? "Preview" : "Edit"}>
                    {editingReqs ? <Eye size={12} /> : <Edit3 size={12} />}
                  </button>
                  <button type="button" className="spec-icon-btn" title="Copy" onClick={() => navigator.clipboard.writeText(doc.requirements)}>
                    <Copy size={12} />
                  </button>
                </div>
                {editingReqs
                  ? <textarea className="spec-doc-editor" value={doc.requirements} onChange={e => updateRequirements(e.target.value)} />
                  : <div className="spec-doc-preview" dangerouslySetInnerHTML={{ __html: md(doc.requirements) }} />
                }
                {pendingApproval === "requirements" && (
                  <ApprovalGate
                    label="Requirements look good?"
                    onApprove={approveAndContinue}
                    onReject={rejectAndRegenerate}
                    isGenerating={isGenerating}
                  />
                )}
              </>
            )}
          </div>
        )}

        {/* ── Design ── */}
        {activeTab === "design" && (
          <div className="spec-doc-view">
            {!doc.design && (
              <div className="spec-empty-state">
                <Layers size={22} />
                <p>Technical design will appear here</p>
              </div>
            )}
            {doc.design && (
              <>
                <div className="spec-doc-toolbar">
                  <button type="button" className="spec-icon-btn" onClick={() => setEditingDesign(v => !v)} title={editingDesign ? "Preview" : "Edit"}>
                    {editingDesign ? <Eye size={12} /> : <Edit3 size={12} />}
                  </button>
                  <button type="button" className="spec-icon-btn" title="Copy" onClick={() => navigator.clipboard.writeText(doc.design)}>
                    <Copy size={12} />
                  </button>
                </div>
                {editingDesign
                  ? <textarea className="spec-doc-editor" value={doc.design} onChange={e => updateDesign(e.target.value)} />
                  : <div className="spec-doc-preview" dangerouslySetInnerHTML={{ __html: md(doc.design) }} />
                }
                {pendingApproval === "design" && (
                  <ApprovalGate
                    label="Technical design looks good?"
                    onApprove={approveAndContinue}
                    onReject={rejectAndRegenerate}
                    isGenerating={isGenerating}
                  />
                )}
              </>
            )}
          </div>
        )}

        {/* ── Tasks ── */}
        {activeTab === "tasks" && (
          <div className="spec-tasks-view">
            {totalCount === 0 && (
              <div className="spec-empty-state">
                <ClipboardList size={22} />
                <p>Tasks will appear here after design is approved</p>
              </div>
            )}

            {totalCount > 0 && (
              <>
                {pendingPreview && (
                  <TaskPreviewGate
                    preview={pendingPreview}
                    taskTitle={doc.tasks.find(t => t.id === pendingPreview.taskId)?.title ?? pendingPreview.taskId}
                    onApprove={() => approveTaskPreview(pendingPreview.taskId)}
                    onReject={(feedback?: string) => rejectTaskPreview(pendingPreview.taskId, feedback)}
                    isApplying={isGenerating || phase === "executing"}
                  />
                )}

                {/* Toolbar */}
                <div className="spec-tasks-bar">
                  {pendingApproval === "tasks" && (
                    <div className="spec-tasks-approval">
                      <span className="spec-tasks-approval-label">
                        Review {totalCount} tasks — approve to execute
                      </span>
                      <button type="button" className="spec-btn spec-btn-sm" onClick={approveAllTasks}>
                        <Check size={11} /> Approve All
                      </button>
                      <button type="button" className="spec-btn spec-btn-sm spec-btn-primary" onClick={approveAndContinue} disabled={isGenerating}>
                        <Play size={11} /> Approve & Execute
                      </button>
                      <button type="button" className="spec-btn spec-btn-sm spec-btn-reject" onClick={() => rejectAndRegenerate()} disabled={isGenerating}>
                        <RefreshCw size={11} /> Regenerate
                      </button>
                    </div>
                  )}

                  {pendingApproval !== "tasks" && !isComplete && (
                    <div className="spec-tasks-run-bar">
                      {approvedCount < totalCount && (
                        <button type="button" className="spec-btn spec-btn-sm" onClick={approveAllTasks}>
                          <Check size={11} /> Approve All ({totalCount - approvedCount} pending)
                        </button>
                      )}
                      <button
                        type="button"
                        className="spec-btn spec-btn-sm spec-btn-primary"
                        onClick={executeApprovedTasks}
                        disabled={phase === "executing" || isGenerating || approvedCount === 0 || hasPendingPreview}
                      >
                        {phase === "executing"
                          ? <><RefreshCw size={11} className="spin-icon" /> Running…</>
                          : hasPendingPreview
                            ? <><Eye size={11} /> Approve Preview First</>
                            : <><Play size={11} /> Run {approvedCount} Approved</>
                        }
                      </button>
                      {hasFailures && (
                        <button
                          type="button"
                          className="spec-btn spec-btn-sm spec-btn-warn"
                          onClick={() => doc.tasks.filter(t => t.status === "failed").forEach(t => retryTask(t.id))}
                          disabled={phase === "executing"}
                        >
                          <RefreshCw size={11} /> Retry Failed
                        </button>
                      )}
                    </div>
                  )}

                  {isComplete && (
                    <div className="spec-complete-bar">
                      <CheckCircle size={14} />
                      <span>All {doneCount} tasks completed — feature is implemented!</span>
                    </div>
                  )}
                </div>

                {/* Task list */}
                <div className="spec-task-list">
                  {doc.tasks.map((task, idx) => (
                    <TaskCard
                      key={task.id}
                      task={task}
                      index={idx + 1}
                      isActive={activeTaskId === task.id}
                      isExpanded={expandedTask === task.id}
                      onToggle={() => setExpandedTask(expandedTask === task.id ? null : task.id)}
                      onApprove={() => approveTask(task.id)}
                      onExecute={() => executeTask(task.id)}
                      onRetry={() => retryTask(task.id)}
                      onSkip={() => skipTask(task.id)}
                      canRun={phase !== "executing" && !isGenerating && !hasPendingPreview}
                    />
                  ))}
                </div>
              </>
            )}
          </div>
        )}

        {/* ── Log ── */}
        {activeTab === "log" && (
          <div className="spec-log-view">
            {executionLog.length === 0
              ? <div className="spec-empty-state"><List size={22} /><p>Execution log</p></div>
              : (
                <div className="spec-log">
                  {executionLog.map((entry, i) => (
                    <div key={i} className={`spec-log-entry ${entry.level}`}>
                      <span className="spec-log-ts">{new Date(entry.ts).toLocaleTimeString()}</span>
                      <span className="spec-log-text">{entry.text}</span>
                    </div>
                  ))}
                  <div ref={logEndRef} />
                </div>
              )
            }
          </div>
        )}
      </div>
    </div>
  );
}

function TaskPreviewGate({
  preview,
  taskTitle,
  onApprove,
  onReject,
  isApplying,
}: {
  preview: TaskExecutionPreview;
  taskTitle: string;
  onApprove: () => void;
  onReject: (feedback?: string) => void;
  isApplying: boolean;
}) {
  const [feedback, setFeedback] = useState("");

  return (
    <div className="spec-preview-gate">
      <div className="spec-preview-head">
        <div className="spec-preview-title">
          <Eye size={12} />
          <span>Change Preview · {taskTitle}</span>
        </div>
        <span className="spec-preview-meta">
          {preview.fileChanges.length} file{preview.fileChanges.length === 1 ? "" : "s"} · {preview.commands.length} command{preview.commands.length === 1 ? "" : "s"}
        </span>
      </div>

      <p className="spec-preview-summary">{preview.summary}</p>

      {preview.folderChanges.length > 0 && (
        <div className="spec-preview-block">
          <span className="spec-preview-label">Folder changes</span>
          <div className="spec-preview-tags">
            {preview.folderChanges.map(folder => <code key={folder} className="spec-preview-tag">{folder}</code>)}
          </div>
        </div>
      )}

      {preview.commands.length > 0 && (
        <div className="spec-preview-block">
          <span className="spec-preview-label">Commands</span>
          <div className="spec-preview-cmds">
            {preview.commands.map((command, idx) => (
              <code key={`${command}-${idx}`} className="spec-preview-cmd">
                <Terminal size={10} /> {command}
              </code>
            ))}
          </div>
        </div>
      )}

      <div className="spec-preview-files">
        {preview.fileChanges.map(change => (
          <details key={change.path} className="spec-preview-file">
            <summary>
              <span className={`spec-preview-file-badge ${change.existedBefore ? "update" : "create"}`}>
                {change.existedBefore ? "UPDATE" : "CREATE"}
              </span>
              <code className="spec-preview-file-path">{change.path}</code>
              <span className="spec-preview-delta">
                +{change.addedLines} / -{change.removedLines}
              </span>
            </summary>
            <pre className="spec-preview-diff">{change.diffPreview}</pre>
          </details>
        ))}
      </div>

      <textarea
        className="spec-feedback-input"
        placeholder="Optional feedback for regeneration..."
        value={feedback}
        onChange={event => setFeedback(event.target.value)}
        rows={2}
      />

      <div className="spec-approval-btns">
        <button type="button" className="spec-btn spec-btn-approve" onClick={onApprove} disabled={isApplying}>
          <Check size={12} /> Approve & Apply
        </button>
        <button
          type="button"
          className="spec-btn spec-btn-reject"
          onClick={() => {
            onReject(feedback || undefined);
            setFeedback("");
          }}
          disabled={isApplying}
        >
          <RefreshCw size={12} /> Reject & Regenerate
        </button>
      </div>
    </div>
  );
}

// ── Task card ─────────────────────────────────────────────────────────────────

function TaskCard({
  task, index, isActive, isExpanded, onToggle,
  onApprove, onExecute, onRetry, onSkip, canRun,
}: {
  task: SpecTask; index: number; isActive: boolean; isExpanded: boolean;
  onToggle: () => void; onApprove: () => void; onExecute: () => void;
  onRetry: () => void; onSkip: () => void; canRun: boolean;
}) {
  return (
    <div className={`spec-task ${task.status} ${isActive ? "is-active" : ""} ${task.approved ? "is-approved" : ""}`}>
      <div className="spec-task-row" onClick={onToggle}>
        <span className="spec-task-idx">{index}</span>
        <TaskIcon status={task.status} />
        <div className="spec-task-info">
          <span className="spec-task-name">{task.title}</span>
          {task.estimatedMinutes > 0 && task.status === "pending" && (
            <span className="spec-task-eta">~{task.estimatedMinutes}m</span>
          )}
          {task.appliedFiles.length > 0 && (
            <span className="spec-task-files-badge">{task.appliedFiles.length} files</span>
          )}
        </div>
        <div className="spec-task-btns" onClick={e => e.stopPropagation()}>
          {!task.approved && task.status === "pending" && (
            <button type="button" className="spec-task-btn approve" onClick={onApprove} title="Approve task">
              <Check size={10} />
            </button>
          )}
          {task.approved && task.status === "pending" && canRun && (
            <button type="button" className="spec-task-btn run" onClick={onExecute} title="Run now">
              <Play size={10} />
            </button>
          )}
          {task.status === "failed" && (
            <button type="button" className="spec-task-btn retry" onClick={onRetry} disabled={!canRun} title={`Retry (${task.retries}/${task.maxRetries})`}>
              <RefreshCw size={10} />
            </button>
          )}
          {task.status === "pending" && (
            <button type="button" className="spec-task-btn skip" onClick={onSkip} title="Skip task">
              <SkipForward size={10} />
            </button>
          )}
        </div>
        <span className="spec-task-chevron">{isExpanded ? <ChevronDown size={11} /> : <ChevronRight size={11} />}</span>
      </div>

      {isExpanded && (
        <div className="spec-task-detail">
          <p className="spec-task-desc">{task.description}</p>

          {task.rationale && (
            <div className="spec-task-section">
              <span className="spec-task-section-label">Why</span>
              <p className="spec-task-section-text">{task.rationale}</p>
            </div>
          )}

          {task.acceptanceCriteria.length > 0 && (
            <div className="spec-task-section">
              <span className="spec-task-section-label">Acceptance Criteria</span>
              <ul className="spec-task-criteria">
                {task.acceptanceCriteria.map((c, i) => <li key={i}>{c}</li>)}
              </ul>
            </div>
          )}

          {task.filePaths.length > 0 && (
            <div className="spec-task-section">
              <span className="spec-task-section-label">Files</span>
              <div className="spec-task-file-list">
                {task.filePaths.map(f => (
                  <code key={f} className={`spec-task-file ${task.appliedFiles.includes(f) ? "written" : ""}`}>
                    {task.appliedFiles.includes(f) ? "✓ " : ""}{f}
                  </code>
                ))}
              </div>
            </div>
          )}

          {task.commands.length > 0 && (
            <div className="spec-task-section">
              <span className="spec-task-section-label">Commands</span>
              <div className="spec-task-cmd-list">
                {task.commands.map((c, i) => (
                  <code key={i} className="spec-task-cmd"><Terminal size={9} /> {c}</code>
                ))}
              </div>
            </div>
          )}

          {task.error && (
            <div className="spec-task-error-box">
              <AlertTriangle size={11} />
              <div>
                <div className="spec-task-error-title">Error (attempt {task.retries}/{task.maxRetries})</div>
                <div className="spec-task-error-msg">{task.error}</div>
              </div>
            </div>
          )}

          {task.status === "done" && task.output && (
            <div className="spec-task-section">
              <span className="spec-task-section-label">Result</span>
              <p className="spec-task-section-text spec-task-output">{task.output}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
