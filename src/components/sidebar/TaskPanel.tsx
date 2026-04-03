// src/components/sidebar/TaskPanel.tsx
import { useState, useEffect } from "react";
import {
  PlayCircle, CheckCircle, XCircle, Search, FileCode2,
  RefreshCw, Terminal as TerminalIcon, Loader, FolderOpen,
  FlaskConical, Wrench, Zap, Package
} from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { useAIStore } from "../../store/aiStore";
import { useEditorStore } from "../../store/editorStore";
import { useTerminalStore } from "../../store/terminalStore";

interface Task {
  id: string;
  name: string;
  command: string;
  category: "build" | "test" | "lint" | "init" | "run" | "custom";
}

type TaskStatus = "idle" | "running" | "success" | "error";

interface FileMatch {
  path: string;
  name: string;
  relativePath: string;
}

const CATEGORY_META: Record<Task["category"], { icon: React.ReactNode; color: string; label: string }> = {
  build:  { icon: <Wrench size={11} />,       color: "#4ec9b0", label: "Build"  },
  test:   { icon: <FlaskConical size={11} />,  color: "#dcdcaa", label: "Test"   },
  lint:   { icon: <Search size={11} />,        color: "#9cdcfe", label: "Lint"   },
  init:   { icon: <Package size={11} />,       color: "#ce9178", label: "Init"   },
  run:    { icon: <PlayCircle size={11} />,    color: "#4fc1ff", label: "Run"    },
  custom: { icon: <Zap size={11} />,           color: "#c586c0", label: "Custom" },
};

function TaskStatusIcon({ status }: { status: TaskStatus }) {
  if (status === "running") return <Loader size={12} className="spin-icon" style={{ color: "#4fc1ff" }} />;
  if (status === "success") return <CheckCircle size={12} style={{ color: "var(--success)" }} />;
  if (status === "error")   return <XCircle size={12} style={{ color: "var(--error)" }} />;
  return <PlayCircle size={12} style={{ color: "var(--text-muted)" }} />;
}

export function TaskPanel() {
  const { projectContext } = useAIStore();
  const { openFolder, openFile } = useEditorStore();
  const { showAndTrackCommand, showTerminalTab, commandRunStates } = useTerminalStore();

  const [taskStatuses, setTaskStatuses]   = useState<Record<string, TaskStatus>>({});
  const [taskDurations, setTaskDurations] = useState<Record<string, number>>({});
  const [taskRunRequests, setTaskRunRequests] = useState<Record<string, { requestKey: string; startedAt: number }>>({});
  const [activeTab, setActiveTab]         = useState<"tasks" | "files">("tasks");
  const [fileQuery, setFileQuery]         = useState("");
  const [fileResults, setFileResults]     = useState<FileMatch[]>([]);
  const [customCommand, setCustomCommand] = useState("");
  const [allFiles, setAllFiles]           = useState<FileMatch[]>([]);
  const [loadingFiles, setLoadingFiles]   = useState(false);

  // ── load file tree ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!openFolder) { setAllFiles([]); return; }
    loadAllFiles(openFolder);
  }, [openFolder]);

  useEffect(() => {
    const updates: Record<string, TaskStatus> = {};
    const durations: Record<string, number> = {};
    let nextRequests: Record<string, { requestKey: string; startedAt: number }> | null = null;

    for (const [taskId, runMeta] of Object.entries(taskRunRequests)) {
      const runState = commandRunStates[runMeta.requestKey];
      if (!runState) continue;

      if (runState.status === "queued" || runState.status === "running") {
        updates[taskId] = "running";
        continue;
      }

      updates[taskId] = runState.status === "success" ? "success" : "error";
      durations[taskId] = Date.now() - runMeta.startedAt;
      nextRequests ??= { ...taskRunRequests };
      delete nextRequests[taskId];

      setTimeout(() => {
        setTaskStatuses((prev) => {
          const next = { ...prev };
          if (next[taskId] !== "running") delete next[taskId];
          return next;
        });
      }, 5000);
    }

    if (Object.keys(updates).length > 0) {
      setTaskStatuses((prev) => ({ ...prev, ...updates }));
    }
    if (Object.keys(durations).length > 0) {
      setTaskDurations((prev) => ({ ...prev, ...durations }));
    }
    if (nextRequests) {
      setTaskRunRequests(nextRequests);
    }
  }, [commandRunStates, taskRunRequests]);

  const loadAllFiles = async (folder: string) => {
    setLoadingFiles(true);
    try {
      const entries = await invoke<any[]>("read_dir_recursive", { path: folder, depth: 6 });
      const flat: FileMatch[] = [];
      const flatten = (items: any[]) => {
        for (const item of items) {
          if (!item.is_dir) {
            const sep = folder.includes("\\") ? "\\" : "/";
            const rel = item.path.startsWith(folder)
              ? item.path.slice(folder.length).replace(/^[/\\]/, "")
              : item.path;
            flat.push({ path: item.path, name: item.name, relativePath: rel });
          }
          if (item.children) flatten(item.children);
        }
      };
      flatten(entries);
      setAllFiles(flat);
      setFileResults(flat.slice(0, 40));
    } catch { /* ignore */ }
    setLoadingFiles(false);
  };

  // ── fuzzy search ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!fileQuery.trim()) {
      setFileResults(allFiles.slice(0, 40));
      return;
    }
    const q = fileQuery.toLowerCase();
    const scored = allFiles
      .map(f => {
        const name = f.name.toLowerCase();
        const rel  = f.relativePath.toLowerCase();
        let score = 0;
        if (name === q)           score = 100;
        else if (name.startsWith(q)) score = 80;
        else if (name.includes(q))   score = 60;
        else if (rel.includes(q))    score = 30;
        return { ...f, score };
      })
      .filter(f => f.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 60);
    setFileResults(scored);
  }, [fileQuery, allFiles]);

  // ── task generation ─────────────────────────────────────────────────────────
  const getTasks = (): Task[] => {
    if (!projectContext) return [];
    const pm = projectContext.packageManager;
    const tasks: Task[] = [];

    if (pm === "npm" || pm === "yarn" || pm === "pnpm") {
      tasks.push({ id: "install", name: "Install",    command: `${pm} install`,      category: "init"  });
      tasks.push({ id: "dev",     name: "Dev Server", command: `${pm} run dev`,      category: "run"   });
      tasks.push({ id: "build",   name: "Build",      command: `${pm} run build`,    category: "build" });
      tasks.push({ id: "test",    name: "Test",       command: `${pm} test`,         category: "test"  });
      tasks.push({ id: "lint",    name: "Lint",       command: `${pm} run lint`,     category: "lint"  });
    } else if (pm === "cargo") {
      tasks.push({ id: "cargo-build",  name: "Build",   command: "cargo build",   category: "build" });
      tasks.push({ id: "cargo-run",    name: "Run",     command: "cargo run",     category: "run"   });
      tasks.push({ id: "cargo-test",   name: "Test",    command: "cargo test",    category: "test"  });
      tasks.push({ id: "cargo-clippy", name: "Clippy",  command: "cargo clippy",  category: "lint"  });
      tasks.push({ id: "cargo-fmt",    name: "Format",  command: "cargo fmt",     category: "lint"  });
    } else if (pm === "pip") {
      tasks.push({ id: "pip-install", name: "Install",  command: "pip install -r requirements.txt", category: "init" });
      tasks.push({ id: "pytest",      name: "Pytest",   command: "python -m pytest -v",             category: "test" });
      tasks.push({ id: "flake8",      name: "Flake8",   command: "python -m flake8",                category: "lint" });
      tasks.push({ id: "py-run",      name: "Run Main", command: "python3 main.py",                 category: "run"  });
    } else if (pm === "go") {
      tasks.push({ id: "go-tidy",  name: "Mod Tidy", command: "go mod tidy",   category: "init"  });
      tasks.push({ id: "go-build", name: "Build",    command: "go build",      category: "build" });
      tasks.push({ id: "go-test",  name: "Test",     command: "go test ./...", category: "test"  });
      tasks.push({ id: "go-run",   name: "Run",      command: "go run .",      category: "run"   });
    }

    if (tasks.length === 0) {
      if (projectContext.languages?.includes("Python"))
        tasks.push({ id: "py-run", name: "Run Main", command: "python3 main.py", category: "run" });
      if (projectContext.languages?.includes("C/C++"))
        tasks.push({ id: "make", name: "Make", command: "make", category: "build" });
    }
    return tasks;
  };

  const tasks = getTasks();

  // ── run task ────────────────────────────────────────────────────────────────
  const runTask = (task: Task) => {
    if (!openFolder) return;
    const startedAt = Date.now();
    const requestKey = `task-${task.id}-${startedAt}`;
    setTaskStatuses((s) => ({ ...s, [task.id]: "running" }));
    setTaskDurations((d) => {
      const next = { ...d };
      delete next[task.id];
      return next;
    });
    setTaskRunRequests((prev) => ({ ...prev, [task.id]: { requestKey, startedAt } }));
    showAndTrackCommand(task.command, {
      source: "manual",
      analyzeWithAI: false,
      requestKey,
    });
    showTerminalTab("terminal");
  };

  const runCustom = () => {
    const cmd = customCommand.trim();
    if (!cmd || !openFolder) return;
    showAndTrackCommand(cmd, { source: "manual", analyzeWithAI: false });
    showTerminalTab("terminal");
    setCustomCommand("");
  };

  const runTestFile = (file: FileMatch) => {
    if (!openFolder) return;
    const pm  = projectContext?.packageManager;
    const ext = file.name.split(".").pop()?.toLowerCase() || "";
    let cmd = "";
    if (pm === "npm" || pm === "yarn" || pm === "pnpm")
      cmd = `${pm} test -- --testPathPattern="${file.relativePath}"`;
    else if (pm === "cargo")
      cmd = `cargo test`;
    else if (pm === "pip" || ext === "py")
      cmd = `python -m pytest "${file.relativePath}" -v`;
    else if (pm === "go")
      cmd = `go test ./${file.relativePath.replace(/\/[^/]+$/, "")}/...`;
    else
      cmd = `echo "No test runner detected for: ${file.relativePath}"`;
    showAndTrackCommand(cmd, { source: "manual", analyzeWithAI: false });
    showTerminalTab("terminal");
  };

  const isTestFile = (name: string) =>
    /\.(test|spec)\.(ts|tsx|js|jsx|py|go|rs)$/.test(name) ||
    /^test_/.test(name) ||
    /_test\.(go|rs|py)$/.test(name);

  // ── group tasks by category ─────────────────────────────────────────────────
  const grouped = tasks.reduce<Record<string, Task[]>>((acc, t) => {
    if (!acc[t.category]) acc[t.category] = [];
    acc[t.category].push(t);
    return acc;
  }, {});

  // ── render ──────────────────────────────────────────────────────────────────
  return (
    <div className="sidebar task-panel">
      {/* Header */}
      <div className="sidebar-header">
        <span className="sidebar-title">TASKS & FILES</span>
        {openFolder && (
          <div className="sidebar-actions">
            <button title="Refresh file list" onClick={() => openFolder && loadAllFiles(openFolder)}>
              <RefreshCw size={13} />
            </button>
          </div>
        )}
      </div>

      {/* Tab bar */}
      <div className="task-tabs">
        <button
          className={`task-tab-btn ${activeTab === "tasks" ? "active" : ""}`}
          onClick={() => setActiveTab("tasks")}
        >
          <TerminalIcon size={12} />
          Tasks
        </button>
        <button
          className={`task-tab-btn ${activeTab === "files" ? "active" : ""}`}
          onClick={() => setActiveTab("files")}
        >
          <FileCode2 size={12} />
          Find File
        </button>
      </div>

      {/* ── TASKS TAB ── */}
      {activeTab === "tasks" && (
        <div className="sidebar-content task-scroll">

          {/* Env badge */}
          {projectContext ? (
            <div className="task-env-badge">
              <span className="task-env-label">ENV</span>
              <span className="task-env-summary">{projectContext.summary}</span>
            </div>
          ) : (
            <div className="task-empty-hint">
              <FolderOpen size={28} style={{ opacity: 0.2 }} />
              <span>Open a folder to detect tasks</span>
            </div>
          )}

          {!openFolder && (
            <div className="task-warning">⚠ Open a project folder first</div>
          )}

          {/* Task groups */}
          {Object.entries(grouped).map(([cat, catTasks]) => {
            const meta = CATEGORY_META[cat as Task["category"]];
            return (
              <div key={cat} className="task-group">
                <div className="task-group-label" style={{ color: meta.color }}>
                  {meta.icon}
                  <span>{meta.label}</span>
                </div>
                {catTasks.map(task => {
                  const status = taskStatuses[task.id] ?? "idle";
                  const dur    = taskDurations[task.id];
                  return (
                    <button
                      key={task.id}
                      className={`task-item ${status}`}
                      onClick={() => runTask(task)}
                      disabled={!openFolder || status === "running"}
                      title={`$ ${task.command}`}
                    >
                      <div className="task-item-left">
                        <span className="task-item-name">{task.name}</span>
                        <span className="task-item-cmd">$ {task.command}</span>
                      </div>
                      <div className="task-item-right">
                        {dur && status !== "running" && (
                          <span className="task-duration">{(dur / 1000).toFixed(1)}s</span>
                        )}
                        <TaskStatusIcon status={status} />
                      </div>
                    </button>
                  );
                })}
              </div>
            );
          })}

          {tasks.length === 0 && projectContext && (
            <p className="task-no-tasks">No auto-detectable tasks for this project.</p>
          )}

          {/* Custom command */}
          <div className="task-group task-custom">
            <div className="task-group-label" style={{ color: "#c586c0" }}>
              <Zap size={11} />
              <span>Custom</span>
            </div>
            <div className="task-custom-input">
              <span className="task-custom-prompt">$</span>
              <input
                type="text"
                placeholder="Enter any command…"
                value={customCommand}
                onChange={e => setCustomCommand(e.target.value)}
                onKeyDown={e => e.key === "Enter" && runCustom()}
                disabled={!openFolder}
              />
              <button
                className="task-custom-run"
                onClick={runCustom}
                disabled={!customCommand.trim() || !openFolder}
                title="Run in terminal (Enter)"
              >
                <PlayCircle size={14} />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── FILES TAB ── */}
      {activeTab === "files" && (
        <div className="sidebar-content task-scroll">
          <div className="task-file-search">
            <Search size={13} style={{ color: "var(--text-muted)", flexShrink: 0 }} />
            <input
              type="text"
              placeholder="Search files…"
              value={fileQuery}
              onChange={e => setFileQuery(e.target.value)}
              autoFocus
            />
            {fileQuery && (
              <button
                onClick={() => setFileQuery("")}
                style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", padding: "0 2px", fontSize: 14, lineHeight: 1 }}
                title="Clear"
              >×</button>
            )}
          </div>

          {!openFolder ? (
            <div className="task-empty-hint">
              <FolderOpen size={28} style={{ opacity: 0.2 }} />
              <span>Open a folder to search files</span>
            </div>
          ) : loadingFiles ? (
            <div className="task-empty-hint">
              <Loader size={18} className="spin-icon" />
              <span>Scanning…</span>
            </div>
          ) : (
            <div className="task-file-list">
              {fileResults.length === 0 && fileQuery && (
                <p style={{ fontSize: 12, color: "var(--text-muted)", textAlign: "center", padding: "16px 0" }}>
                  No files matching "{fileQuery}"
                </p>
              )}
              {fileResults.map(file => {
                const isTest = isTestFile(file.name);
                return (
                  <div key={file.path} className="task-file-item">
                    <button
                      className="task-file-open"
                      onClick={() => openFile(file.path)}
                      title={file.relativePath}
                    >
                      <FileCode2
                        size={12}
                        style={{ flexShrink: 0, color: isTest ? "#dcdcaa" : "var(--text-muted)" }}
                      />
                      <div className="task-file-info">
                        <span className="task-file-name">
                          {file.name}
                          {isTest && <span className="task-test-badge">test</span>}
                        </span>
                        <span className="task-file-path">{file.relativePath}</span>
                      </div>
                    </button>
                    {isTest && (
                      <button
                        className="task-run-test-btn"
                        onClick={() => runTestFile(file)}
                        title={`Run: ${file.name}`}
                        disabled={!openFolder}
                      >
                        <PlayCircle size={11} />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
