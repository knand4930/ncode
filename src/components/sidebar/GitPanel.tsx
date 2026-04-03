import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { GitBranch, RefreshCw } from "lucide-react";
import { useEditorStore } from "../../store/editorStore";
import { useUIStore } from "../../store/uiStore";
import { useReviewStore } from "../../store/reviewStore";

type GitStatusEntry = {
  code: string;
  path: string;
};

function parseGitStatus(output: string): GitStatusEntry[] {
  return output
    .split("\n")
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .map((line) => ({
      code: line.slice(0, 2).trim() || "??",
      path: line.slice(3).trim(),
    }));
}

export function GitPanel() {
  const { openFolder } = useEditorStore();
  const { addToast } = useUIStore();
  const { openDiffReview } = useReviewStore();
  const [branch, setBranch] = useState<string>("(no repo)");
  const [status, setStatus] = useState<GitStatusEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>("");
  const [commitMsg, setCommitMsg] = useState("");

  const loadGit = async () => {
    if (!openFolder) {
      setBranch("(no folder)");
      setStatus([]);
      setError("Open a folder to use Source Control.");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const branchOut = await invoke<string>("run_command", {
        cmd: "git rev-parse --abbrev-ref HEAD",
        cwd: openFolder,
      });
      const statusOut = await invoke<string>("run_command", {
        cmd: "git status --short",
        cwd: openFolder,
      });
      setBranch(branchOut.trim() || "(detached)");
      setStatus(parseGitStatus(statusOut));
    } catch (e: any) {
      setBranch("(no repo)");
      setStatus([]);
      setError(String(e || "Not a git repository"));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadGit();
  }, [openFolder]);

  const handleCommit = async () => {
    if (!commitMsg.trim() || !openFolder) return;
    setLoading(true);
    try {
      await invoke("run_command", {
        cmd: `git commit -m "${commitMsg.replace(/"/g, '\\"')}"`,
        cwd: openFolder,
      });
      setCommitMsg("");
      addToast("Successfully committed changes", "success");
      await loadGit();
    } catch (e: any) {
      addToast(`Commit failed: ${String(e)}`, "error");
    } finally {
      setLoading(false);
    }
  };

  const grouped = useMemo(() => {
    const staged = status.filter((s) => /^[AMDRC]/.test(s.code[0] || ""));
    const unstaged = status.filter((s) => /^[AMDRC?]/.test(s.code[1] || s.code[0] || ""));
    return { staged, unstaged };
  }, [status]);

  return (
    <div className="sidebar">
      <div className="sidebar-header">
        <span className="sidebar-title">SOURCE CONTROL</span>
        <div className="sidebar-actions">
          <button title="Refresh Git" onClick={loadGit} disabled={loading}>
            <RefreshCw size={14} />
          </button>
        </div>
      </div>
      <div className="sidebar-content" style={{ padding: "8px 10px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
          <GitBranch size={13} />
          <strong style={{ fontSize: 12 }}>{branch}</strong>
        </div>

        {error ? (
          <div style={{ color: "var(--text-secondary)", fontSize: 12 }}>{error}</div>
        ) : (
          <>
            <div style={{ display: "flex", flexDirection: "column", gap: "6px", marginBottom: "12px" }}>
              <input
                value={commitMsg}
                onChange={(e) => setCommitMsg(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleCommit()}
                placeholder="Commit message..."
                disabled={grouped.staged.length === 0 || loading}
                style={{ width: "100%", padding: "6px 8px" }}
              />
              <button
                className="btn-primary"
                disabled={grouped.staged.length === 0 || !commitMsg.trim() || loading}
                onClick={handleCommit}
                style={{ width: "100%", justifyContent: "center" }}
              >
                Commit Staged
              </button>
            </div>

            <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 6 }}>
              {status.length === 0 ? "No changes" : `${status.length} changed file(s)`}
            </div>
            {status.length > 0 ? status.map((entry) => {
              const stagedCode = entry.code[0] || "";
              const unstagedCode = entry.code[1] || "";
              const isStaged = stagedCode !== "" && stagedCode !== "?";
              return (
                <div
                  key={`${entry.code}-${entry.path}`}
                  className="file-entry"
                  style={{ paddingLeft: 6, fontSize: 12, display: 'flex', alignItems: 'center', gap: 8 }}
                  title={entry.path}
                >
                  <span style={{ width: 48, color: "var(--text-accent)", fontFamily: "var(--font-mono)" }}>
                    {entry.code}
                  </span>
                  <span className="file-entry-name" style={{ flex: 1 }}>{entry.path}</span>
                  <div style={{ display: 'flex', gap: 6 }}>
                    {isStaged ? (
                      <button className="btn-sm" onClick={async () => { 
                        try { await invoke('run_command', { cmd: `git restore --staged -- "${entry.path}"`, cwd: openFolder }); } catch(e){}
                        await loadGit();
                      }}>Unstage</button>
                    ) : (
                      <button className="btn-sm" onClick={async () => { 
                        try { await invoke('run_command', { cmd: `git add -- "${entry.path}"`, cwd: openFolder }); } catch(e){}
                        await loadGit();
                      }}>Stage</button>
                    )}
                    <button className="btn-sm" onClick={async () => { 
                      try {
                        let original = "";
                        let modified = "";
                        
                        if (isStaged) {
                           original = await invoke<string>('run_command', { cmd: `git show HEAD:"${entry.path}"`, cwd: openFolder }).catch(() => "");
                           modified = await invoke<string>('run_command', { cmd: `git show :"${entry.path}"`, cwd: openFolder }).catch(() => "");
                        } else {
                           original = await invoke<string>('run_command', { cmd: `git show :"${entry.path}"`, cwd: openFolder }).catch(() => "");
                           modified = await invoke<string>('read_file', { path: `${openFolder}/${entry.path}` }).catch(() => "");
                        }
                        
                        openDiffReview({
                          title: "Git Diff Review",
                          description: isStaged
                            ? "Comparing HEAD with the staged version of this file."
                            : "Comparing the staged version with your current working tree changes.",
                          sourcePath: entry.path,
                          originalContent: original,
                          modifiedContent: modified,
                          note: "This is a read-only review of your Git diff.",
                        });
                      } catch(e:any){ addToast(String(e), "error"); }
                    }}>Diff</button>
                    <button className="btn-sm danger" onClick={async () => { 
                      if (!confirm(`Discard changes to ${entry.path}? This cannot be undone for unstaged changes.`)) return;
                      try {
                        await invoke('run_command', { cmd: `git checkout -- "${entry.path}"`, cwd: openFolder });
                      } catch(e){}
                      await loadGit();
                    }}>Discard</button>
                  </div>
                </div>
              );
            }) : (
              <div style={{ color: "var(--text-muted)", padding: "8px 0" }}>No changes</div>
            )}
            {grouped.staged.length > 0 || grouped.unstaged.length > 0 ? (
              <div style={{ marginTop: 8, fontSize: 11, color: "var(--text-secondary)" }}>
                Staged: {grouped.staged.length} | Unstaged: {grouped.unstaged.length}
              </div>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
