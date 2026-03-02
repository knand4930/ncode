import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { GitBranch, RefreshCw } from "lucide-react";
import { useEditorStore } from "../../store/editorStore";

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
  const [branch, setBranch] = useState<string>("(no repo)");
  const [status, setStatus] = useState<GitStatusEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>("");

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
            <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 6 }}>
              {status.length === 0 ? "No changes" : `${status.length} changed file(s)`}
            </div>
            {status.map((entry) => (
              <div
                key={`${entry.code}-${entry.path}`}
                className="file-entry"
                style={{ paddingLeft: 6, fontSize: 12 }}
                title={entry.path}
              >
                <span style={{ width: 28, color: "var(--text-accent)", fontFamily: "var(--font-mono)" }}>
                  {entry.code}
                </span>
                <span className="file-entry-name">{entry.path}</span>
              </div>
            ))}
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
