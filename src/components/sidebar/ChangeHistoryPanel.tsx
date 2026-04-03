// src/components/sidebar/ChangeHistoryPanel.tsx — Full change history & rollback
import { useState, useMemo } from "react";
import {
  History, RotateCcw, ChevronDown, ChevronRight, Camera,
  Trash2, AlertTriangle, CheckCircle, Clock, FileCode,
  RefreshCw, X, SkipBack,
} from "lucide-react";
import { useEditorStore, type AIChangeEntry, type ChangeSnapshot } from "../../store/editorStore";
import { useUIStore } from "../../store/uiStore";

function relativeTime(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return new Date(ts).toLocaleDateString();
}

function diffStats(prev: string, next: string): { added: number; removed: number } {
  const prevLines = prev.split("\n");
  const nextLines = next.split("\n");
  const prevSet = new Set(prevLines);
  const nextSet = new Set(nextLines);
  const added = nextLines.filter(l => !prevSet.has(l)).length;
  const removed = prevLines.filter(l => !nextSet.has(l)).length;
  return { added, removed };
}

export function ChangeHistoryPanel() {
  const {
    aiChangeHistory, snapshots,
    rollbackLastAIChange, rollbackChangeById,
    rollbackToTimestamp, rollbackAllAIChanges,
    restoreSnapshot, takeSnapshot,
  } = useEditorStore();
  const { addToast } = useUIStore();

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [snapshotLabel, setSnapshotLabel] = useState("");
  const [showSnapshots, setShowSnapshots] = useState(false);
  const [confirmRollbackAll, setConfirmRollbackAll] = useState(false);
  const [rolling, setRolling] = useState(false);

  const activeHistory = useMemo(
    () => aiChangeHistory.filter(e => !e.rolledBack),
    [aiChangeHistory]
  );

  const rolledBackHistory = useMemo(
    () => aiChangeHistory.filter(e => e.rolledBack),
    [aiChangeHistory]
  );

  // Group active changes by file
  const byFile = useMemo(() => {
    const map = new Map<string, AIChangeEntry[]>();
    for (const entry of activeHistory) {
      const key = entry.filePath;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(entry);
    }
    return map;
  }, [activeHistory]);

  const handleRollbackLast = async () => {
    setRolling(true);
    const ok = await rollbackLastAIChange();
    setRolling(false);
    if (ok) addToast("Rolled back last change", "success");
    else addToast("Nothing to roll back", "info");
  };

  const handleRollbackById = async (id: string, summary: string) => {
    setRolling(true);
    const ok = await rollbackChangeById(id);
    setRolling(false);
    if (ok) addToast(`Rolled back: ${summary.slice(0, 40)}`, "success");
    else addToast("Could not roll back this change", "warning");
  };

  const handleRollbackToPoint = async (ts: number) => {
    setRolling(true);
    const ok = await rollbackToTimestamp(ts);
    setRolling(false);
    if (ok) addToast("Rolled back to selected point", "success");
    else addToast("No changes to roll back", "info");
  };

  const handleRollbackAll = async () => {
    setRolling(true);
    await rollbackAllAIChanges();
    setRolling(false);
    setConfirmRollbackAll(false);
    addToast("All tracked changes reverted", "success");
  };

  const handleTakeSnapshot = async () => {
    const label = snapshotLabel.trim() || `Snapshot ${new Date().toLocaleTimeString()}`;
    await takeSnapshot(label);
    setSnapshotLabel("");
    addToast(`Snapshot saved: ${label}`, "success");
  };

  const handleRestoreSnapshot = async (snap: ChangeSnapshot) => {
    setRolling(true);
    await restoreSnapshot(snap);
    setRolling(false);
    addToast(`Restored: ${snap.label}`, "success");
  };

  return (
    <div className="sidebar ch-panel">
      <div className="sidebar-header">
        <span className="sidebar-title">CHANGE HISTORY</span>
        <div className="sidebar-actions">
          <button
            title="Roll back last change"
            onClick={handleRollbackLast}
            disabled={rolling || activeHistory.length === 0}
          >
            <RotateCcw size={13} />
          </button>
          <button
            title="Take snapshot"
            onClick={handleTakeSnapshot}
          >
            <Camera size={13} />
          </button>
        </div>
      </div>

      <div className="sidebar-content ch-scroll">

        {/* ── Summary bar ── */}
        <div className="ch-summary">
          <div className="ch-summary-stat">
            <span className="ch-stat-num">{activeHistory.length}</span>
            <span className="ch-stat-label">active changes</span>
          </div>
          <div className="ch-summary-stat">
            <span className="ch-stat-num">{byFile.size}</span>
            <span className="ch-stat-label">files affected</span>
          </div>
          <div className="ch-summary-stat">
            <span className="ch-stat-num">{rolledBackHistory.length}</span>
            <span className="ch-stat-label">rolled back</span>
          </div>
        </div>

        {/* ── Rollback all ── */}
        {activeHistory.length > 0 && (
          <div className="ch-section">
            {!confirmRollbackAll ? (
              <button
                className="ch-btn ch-btn-danger"
                onClick={() => setConfirmRollbackAll(true)}
                disabled={rolling}
              >
                <SkipBack size={12} /> Revert All Tracked Changes
              </button>
            ) : (
              <div className="ch-confirm">
                <AlertTriangle size={12} />
                <span>Revert all {activeHistory.length} changes?</span>
                <button className="ch-btn ch-btn-danger-sm" onClick={handleRollbackAll} disabled={rolling}>
                  {rolling ? <RefreshCw size={10} className="spin-icon" /> : "Yes, revert all"}
                </button>
                <button className="ch-btn ch-btn-sm" onClick={() => setConfirmRollbackAll(false)}>
                  Cancel
                </button>
              </div>
            )}
          </div>
        )}

        {/* ── Active changes by file ── */}
        {activeHistory.length === 0 ? (
          <div className="ch-empty">
            <History size={24} style={{ opacity: 0.2 }} />
            <p>No tracked changes yet</p>
            <p className="ch-empty-sub">AI-applied and user-saved changes will appear here for review and rollback</p>
          </div>
        ) : (
          <div className="ch-section">
            <div className="ch-section-label">Active Changes</div>
            {Array.from(byFile.entries()).map(([filePath, entries]) => {
              const fileName = filePath.split(/[\\/]/).pop() ?? filePath;
              const isExpanded = expandedId === filePath;
              return (
                <div key={filePath} className="ch-file-group">
                  <button
                    className="ch-file-header"
                    onClick={() => setExpandedId(isExpanded ? null : filePath)}
                  >
                    {isExpanded ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
                    <FileCode size={11} className="ch-file-icon" />
                    <span className="ch-file-name">{fileName}</span>
                    <span className="ch-file-count">{entries.length}</span>
                    <button
                      className="ch-rollback-file-btn"
                      title={`Roll back all changes to ${fileName}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        // Roll back the oldest entry for this file (which cascades)
                        const oldest = [...entries].sort((a, b) => a.timestamp - b.timestamp)[0];
                        handleRollbackById(oldest.id, `all changes to ${fileName}`);
                      }}
                      disabled={rolling}
                    >
                      <RotateCcw size={10} />
                    </button>
                  </button>

                  {isExpanded && entries.map((entry) => {
                    const stats = diffStats(entry.previousContent, entry.newContent);
                    const sourceLabel = entry.source === "user" ? "User" : "AI";
                    return (
                      <div key={entry.id} className="ch-entry">
                        <div className="ch-entry-main">
                          <div className="ch-entry-info">
                            <span className={`ch-entry-source ${entry.source ?? "ai"}`}>{sourceLabel}</span>
                            <span className="ch-entry-summary">{entry.summary}</span>
                            <span className="ch-entry-time">{relativeTime(entry.timestamp)}</span>
                          </div>
                          <div className="ch-entry-stats">
                            {stats.added > 0 && <span className="ch-stat-add">+{stats.added}</span>}
                            {stats.removed > 0 && <span className="ch-stat-del">-{stats.removed}</span>}
                          </div>
                          <div className="ch-entry-actions">
                            <button
                              className="ch-entry-btn"
                              title="Roll back this change (and dependents)"
                              onClick={() => handleRollbackById(entry.id, entry.summary)}
                              disabled={rolling}
                            >
                              <RotateCcw size={10} />
                            </button>
                            <button
                              className="ch-entry-btn"
                              title="Roll back to this point in time"
                              onClick={() => handleRollbackToPoint(entry.timestamp - 1)}
                              disabled={rolling}
                            >
                              <Clock size={10} />
                            </button>
                          </div>
                        </div>
                        {entry.dependsOn.length > 0 && (
                          <div className="ch-entry-deps">
                            depends on {entry.dependsOn.length} earlier change{entry.dependsOn.length > 1 ? "s" : ""}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        )}

        {/* ── Rolled back history ── */}
        {rolledBackHistory.length > 0 && (
          <div className="ch-section">
            <div className="ch-section-label" style={{ opacity: 0.6 }}>
              Rolled Back ({rolledBackHistory.length})
            </div>
            {rolledBackHistory.slice(0, 10).map((entry) => (
              <div key={entry.id} className="ch-entry ch-entry-rolled">
                <div className="ch-entry-main">
                  <CheckCircle size={10} className="ch-rolled-icon" />
                  <div className="ch-entry-info">
                    <span className={`ch-entry-source ${entry.source ?? "ai"}`}>{entry.source === "user" ? "User" : "AI"}</span>
                    <span className="ch-entry-summary">{entry.summary}</span>
                    <span className="ch-entry-time">{entry.fileName} · {relativeTime(entry.timestamp)}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ── Snapshots ── */}
        <div className="ch-section">
          <button
            className="ch-section-toggle"
            onClick={() => setShowSnapshots(v => !v)}
          >
            {showSnapshots ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
            <Camera size={11} />
            <span>Snapshots ({snapshots.length})</span>
          </button>

          {showSnapshots && (
            <>
              <div className="ch-snapshot-form">
                <input
                  className="ch-snapshot-input"
                  placeholder="Snapshot label…"
                  value={snapshotLabel}
                  onChange={e => setSnapshotLabel(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && handleTakeSnapshot()}
                />
                <button className="ch-btn ch-btn-sm ch-btn-primary" onClick={handleTakeSnapshot}>
                  Save
                </button>
              </div>

              {snapshots.length === 0 ? (
                <p className="ch-empty-sub" style={{ padding: "8px 12px" }}>No snapshots yet</p>
              ) : (
                snapshots.map((snap, i) => (
                  <div key={i} className="ch-snapshot-row">
                    <div className="ch-snapshot-info">
                      <span className="ch-snapshot-label">{snap.label}</span>
                      <span className="ch-snapshot-meta">
                        {Object.keys(snap.files).length} files · {relativeTime(snap.timestamp)}
                      </span>
                    </div>
                    <button
                      className="ch-entry-btn"
                      title="Restore this snapshot"
                      onClick={() => handleRestoreSnapshot(snap)}
                      disabled={rolling}
                    >
                      <RotateCcw size={10} />
                    </button>
                  </div>
                ))
              )}
            </>
          )}
        </div>

      </div>
    </div>
  );
}
