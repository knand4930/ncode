// src/components/sidebar/TaskPanel.tsx
import { PlayCircle } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { useAIStore } from "../../store/aiStore";
import { useEditorStore } from "../../store/editorStore";
import { useUIStore } from "../../store/uiStore";

interface Task {
    id: string;
    name: string;
    command: string;
    category: "build" | "test" | "lint" | "init" | "run";
}

export function TaskPanel() {
    const { projectContext } = useAIStore();
    const { openFolder } = useEditorStore();
    const { toggleTerminal } = useUIStore();

    const getTasks = (): Task[] => {
        if (!projectContext) return [];
        const tasks: Task[] = [];
        const pm = projectContext.packageManager;

        if (pm === "npm" || pm === "yarn" || pm === "pnpm") {
            tasks.push({ id: "npm-install", name: "Install Dependencies", command: `${pm} install`, category: "init" });
            tasks.push({ id: "npm-dev", name: "Start Dev Server", command: `${pm} run dev`, category: "run" });
            tasks.push({ id: "npm-build", name: "Build Project", command: `${pm} run build`, category: "build" });
            tasks.push({ id: "npm-test", name: "Run Tests", command: `${pm} test`, category: "test" });
            tasks.push({ id: "npm-lint", name: "Run Linter", command: `${pm} run lint`, category: "lint" });
        } else if (pm === "cargo") {
            tasks.push({ id: "cargo-build", name: "Cargo Build", command: "cargo build", category: "build" });
            tasks.push({ id: "cargo-run", name: "Cargo Run", command: "cargo run", category: "run" });
            tasks.push({ id: "cargo-test", name: "Cargo Test", command: "cargo test", category: "test" });
            tasks.push({ id: "cargo-clippy", name: "Cargo Clippy", command: "cargo clippy", category: "lint" });
        } else if (pm === "pip") {
            tasks.push({ id: "pip-install", name: "Install Requirements", command: "pip install -r requirements.txt", category: "init" });
            tasks.push({ id: "pytest", name: "Run Pytest", command: "python -m pytest", category: "test" });
            tasks.push({ id: "flake8", name: "Run Flake8", command: "python -m flake8", category: "lint" });
        } else if (pm === "go") {
            tasks.push({ id: "go-tidy", name: "Go Mod Tidy", command: "go mod tidy", category: "init" });
            tasks.push({ id: "go-build", name: "Go Build", command: "go build", category: "build" });
            tasks.push({ id: "go-test", name: "Go Test", command: "go test ./...", category: "test" });
        }

        // Generic fallbacks if no package manager detected but we know languages
        if (tasks.length === 0) {
            if (projectContext.languages.includes("Python")) {
                tasks.push({ id: "py-run", name: "Run Main", command: "python3 main.py", category: "run" });
            }
            if (projectContext.languages.includes("C/C++")) {
                tasks.push({ id: "make", name: "Make", command: "make", category: "build" });
            }
        }

        return tasks;
    };

    const tasks = getTasks();

    const runTask = async (task: Task) => {
        if (!openFolder) {
            alert("Open a project folder first to run tasks.");
            return;
        }

        // Switch to terminal view
        toggleTerminal(); // This currently just toggles, we might want to ensure it's open

        // We execute it in the backend and show an alert here, OR we could pipe it to the actual terminal
        // Since we want this to act like a real task runner, running it in the background via run_command
        // and showing an alert is simplest for now.
        try {
            alert(`Running Task: ${task.name}\n\n$ ${task.command}`);
            const output = await invoke<string>("run_command", { cmd: task.command, cwd: openFolder });
            const preview = output.length > 2000 ? `${output.slice(0, 2000)}\n…[truncated]` : output;
            alert(`✓ Task [${task.name}] Completed:\n\n${preview || "(no output)"}`);
        } catch (e) {
            alert(`✗ Task [${task.name}] Failed:\n\n${String(e)}`);
        }
    };

    return (
        <div className="sidebar">
            <div className="sidebar-header">
                <span className="sidebar-title">PROJECT TASKS</span>
            </div>
            <div className="sidebar-content" style={{ padding: "8px 10px" }}>
                {projectContext ? (
                    <div style={{ marginBottom: "16px", padding: "8px", background: "var(--bg-modifier-hover)", borderRadius: "4px" }}>
                        <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: "4px", textTransform: "uppercase" }}>
                            Detected Environment
                        </div>
                        <div style={{ fontSize: 13, fontWeight: 500, color: "var(--text-normal)" }}>
                            {projectContext.summary}
                        </div>
                    </div>
                ) : (
                    <div style={{ fontSize: 12, color: "var(--text-secondary)", marginBottom: "16px" }}>
                        No project context detected. Open a folder to scan for tasks.
                    </div>
                )}

                {tasks.length > 0 ? (
                    <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                        {tasks.map(task => (
                            <button
                                key={task.id}
                                className="btn-secondary"
                                style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "6px 10px", width: "100%", height: "auto" }}
                                onClick={() => runTask(task)}
                                title={task.command}
                            >
                                <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start" }}>
                                    <span style={{ fontSize: 12, fontWeight: 500 }}>{task.name}</span>
                                    <span style={{ fontSize: 10, color: "var(--text-muted)", fontFamily: "var(--font-mono)", marginTop: "2px" }}>
                                        {task.command}
                                    </span>
                                </div>
                                <PlayCircle size={14} style={{ color: "var(--accent)" }} />
                            </button>
                        ))}
                    </div>
                ) : (
                    <div style={{ fontSize: 12, color: "var(--text-muted)", fontStyle: "italic" }}>
                        No auto-detectable tasks found for this project structure.
                    </div>
                )}
            </div>
        </div>
    );
}
