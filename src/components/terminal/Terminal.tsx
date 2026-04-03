// src/components/terminal/Terminal.tsx — JetBrains-style terminal panel
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  AlertCircle,
  AlertTriangle,
  Bug,
  ChevronDown,
  ChevronUp,
  Download,
  Eraser,
  ExternalLink,
  Info,
  Lightbulb,
  Package,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  SplitSquareVertical,
  Square,
  SquarePen,
  Trash2,
  X,
} from "lucide-react";
import { useEditorStore } from "../../store/editorStore";
import { useUIStore } from "../../store/uiStore";
import { useAIStore } from "../../store/aiStore";
import { getRunCommand } from "../../utils/languageRunner";
import {
  parseTerminalErrors,
  categoryIcon,
  type DetectedError,
  type ErrorSeverity,
} from "../../utils/errorParser";
import { ProblemsPanel } from "../sidebar/ProblemsPanel";
import { type TerminalPanelTab, useTerminalStore } from "../../store/terminalStore";
import "@xterm/xterm/css/xterm.css";

interface TerminalLaunchInfo {
  shellName: string;
  cwd: string;
}

interface TerminalSession {
  id: string;
  title: string;
  shellName: string;
  cwd: string;
  groupId: string;
  ready: boolean;
  xterm: XTerm;
  fitAddon: FitAddon;
  domEl: HTMLDivElement;
  lastError?: string | null;
  detectedErrors: DetectedError[];
}

type PaneRect = {
  left: number;
  top: number;
  width: number;
  height: number;
};

interface RunRecord {
  id: string;
  cmd: string;
  output: string;
  exitCode: number | null;
  startedAt: number;
  duration: number;
  running: boolean;
  source: "manual" | "ai";
  analyzeWithAI: boolean;
  requestKey?: string;
}

interface CommandFinishedPayload {
  runId: string;
  command: string;
  exitCode: number;
  output: string;
}

const SEV_ICON: Record<ErrorSeverity, React.ReactNode> = {
  error:   <AlertCircle  size={12} />,
  warning: <AlertTriangle size={12} />,
  info:    <Info         size={12} />,
  hint:    <Lightbulb   size={12} />,
};

function nextTerminalTitle(shellName: string, sessions: TerminalSession[]) {
  const count = sessions.filter((s) => s.shellName === shellName).length;
  return count === 0 ? shellName : `${shellName} ${count + 1}`;
}

function paneRectsForCount(count: number, stackVertically = false): PaneRect[] {
  if (count <= 1) return [{ left: 0, top: 0, width: 100, height: 100 }];
  if (stackVertically) {
    const paneHeight = 100 / count;
    return Array.from({ length: count }, (_, i) => ({
      left: 0,
      top: i * paneHeight,
      width: 100,
      height: paneHeight,
    }));
  }
  if (count === 2) return [
    { left: 0, top: 0, width: 50, height: 100 },
    { left: 50, top: 0, width: 50, height: 100 },
  ];
  if (count === 3) return [
    { left: 0, top: 0, width: 50, height: 50 },
    { left: 50, top: 0, width: 50, height: 50 },
    { left: 0, top: 50, width: 100, height: 50 },
  ];
  const rows = Math.ceil(count / 2);
  const rowHeight = 100 / rows;
  return Array.from({ length: count }, (_, i) => {
    const row = Math.floor(i / 2);
    const isLastOdd = count % 2 === 1 && i === count - 1;
    if (isLastOdd) return { left: 0, top: row * rowHeight, width: 100, height: rowHeight };
    return { left: (i % 2) * 50, top: row * rowHeight, width: 50, height: rowHeight };
  });
}

function fmtDuration(ms: number) {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export function Terminal() {
  const [sessions, setSessions] = useState<TerminalSession[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [diagOpen, setDiagOpen] = useState(false);
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);
  const [runHistory, setRunHistory] = useState<RunRecord[]>([]);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  // Output log: use ref to avoid re-render on every char; flush to state periodically
  const outputLogRef = useRef<string[]>([]);
  const [outputLogVersion, setOutputLogVersion] = useState(0);
  const outputFlushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const bodyRef = useRef<HTMLDivElement>(null);
  const unlistenMap = useRef<Record<string, () => void>>({});
  const runListenerMap = useRef<Record<string, () => void>>({});
  const sessionsRef = useRef<TerminalSession[]>([]);
  const activeIdRef = useRef<string | null>(null);
  const creatingSessionRef = useRef(false);

  const { openFolder, tabs, activeTabId } = useEditorStore();
  const { setActiveView, toggleAIPanel, showAIPanel, addToast } = useUIStore();
  const { setAIMode, sendMessage } = useAIStore();
  const {
    queuedCommand,
    newTerminalRequest,
    splitTerminalRequest,
    clearTerminalRequest,
    closeActiveTerminalRequest,
    clearQueuedCommand,
    setLastErrors,
    panelTab,
    setPanelTab,
    setCommandRunState,
  } = useTerminalStore();

  useEffect(() => { sessionsRef.current = sessions; }, [sessions]);
  useEffect(() => { activeIdRef.current = activeId; }, [activeId]);

  const syncTerminalSize = useCallback((session: TerminalSession) => {
    if (!session.ready) return;
    requestAnimationFrame(() => {
      try { session.fitAddon.fit(); } catch { return; }
      if (session.xterm.cols > 0 && session.xterm.rows > 0) {
        invoke("resize_terminal", { id: session.id, cols: session.xterm.cols, rows: session.xterm.rows })
          .catch((e) => console.error("Terminal resize failed:", e));
      }
    });
  }, []);

  const layoutSessions = useCallback(() => {
    const activeSession = sessionsRef.current.find((s) => s.id === activeIdRef.current) ?? null;
    const visibleSessions = activeSession
      ? sessionsRef.current.filter((s) => s.groupId === activeSession.groupId)
      : [];
    const shouldStackPanes = (bodyRef.current?.clientWidth ?? window.innerWidth) < 820;
    const rects = paneRectsForCount(visibleSessions.length || 1, shouldStackPanes);

    sessionsRef.current.forEach((s) => { s.domEl.style.display = "none"; });

    visibleSessions.forEach((session, i) => {
      const rect = rects[i] ?? rects[0];
      const inset = visibleSessions.length > 1 ? (shouldStackPanes ? 3 : 4) : 0;
      const isActive = session.id === activeIdRef.current;
      session.domEl.style.display = "block";
      session.domEl.style.position = "absolute";
      session.domEl.style.left = `calc(${rect.left}% + ${inset}px)`;
      session.domEl.style.top = `calc(${rect.top}% + ${inset}px)`;
      session.domEl.style.width = `calc(${rect.width}% - ${inset * 2}px)`;
      session.domEl.style.height = `calc(${rect.height}% - ${inset * 2}px)`;
      session.domEl.style.border = visibleSessions.length > 1
        ? `1px solid ${isActive ? "rgba(0,122,204,0.45)" : "rgba(255,255,255,0.08)"}`
        : "none";
      session.domEl.style.borderRadius = visibleSessions.length > 1 ? "6px" : "0";
      session.domEl.style.background = "#1e1e1e";
      session.domEl.style.boxShadow = isActive && visibleSessions.length > 1 ? "0 0 0 1px rgba(0,122,204,0.08)" : "none";
      syncTerminalSize(session);
    });
  }, [syncTerminalSize]);

  const focusSession = useCallback((id: string) => {
    requestAnimationFrame(() => {
      sessionsRef.current.find((s) => s.id === id)?.xterm.focus();
    });
  }, []);

  const activateSession = useCallback((id: string) => {
    setActiveId(id);
    activeIdRef.current = id;
    setExpandedIdx(null);
    focusSession(id);
  }, [focusSession]);

  const disposeSessionResources = useCallback((session: TerminalSession) => {
    if (unlistenMap.current[session.id]) {
      unlistenMap.current[session.id]();
      delete unlistenMap.current[session.id];
    }
    session.xterm.dispose();
    session.domEl.remove();
  }, []);

  const createSession = useCallback(async (options?: { splitFromId?: string }) => {
    if (creatingSessionRef.current) return null;
    creatingSessionRef.current = true;

    const existingSessions = sessionsRef.current;
    const splitSource = options?.splitFromId
      ? existingSessions.find((s) => s.id === options.splitFromId) ?? null
      : null;

    const id = `term-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const groupId = splitSource?.groupId ?? id;
    const requestedCwd = splitSource?.cwd || openFolder || (typeof process !== "undefined" ? process.env.HOME : "") || "/";

    const xterm = new XTerm({
      theme: {
        background: "#1e1e1e", foreground: "#d4d4d4", cursor: "#aeafad",
        black: "#000000", red: "#cd3131", green: "#0dbc79", yellow: "#e5e510",
        blue: "#2472c8", magenta: "#bc3fbc", cyan: "#11a8cd", white: "#e5e5e5",
        brightBlack: "#666666", brightRed: "#f14c4c", brightGreen: "#23d18b",
        brightYellow: "#f5f543", brightBlue: "#3b8eea", brightMagenta: "#d670d6",
        brightCyan: "#29b8db", brightWhite: "#e5e5e5",
      },
      fontFamily: "'JetBrains Mono', 'Fira Code', Consolas, monospace",
      fontSize: 13, lineHeight: 1.4, cursorBlink: true, convertEol: true,
      // Reduced scrollback: 1000 lines per session instead of 5000 — saves ~4MB per session
      scrollback: 1000,
    });
    const fitAddon = new FitAddon();
    xterm.loadAddon(fitAddon);
    xterm.loadAddon(new WebLinksAddon());

    const domEl = document.createElement("div");
    domEl.className = "terminal-pane-host";
    domEl.style.cssText = "position:absolute;display:none;overflow:hidden;background:#1e1e1e;outline:none;";
    domEl.addEventListener("mousedown", () => activateSession(id));
    if (bodyRef.current) bodyRef.current.appendChild(domEl);
    xterm.open(domEl);

    const provisionalSession: TerminalSession = {
      id, title: "Starting...", shellName: "shell", cwd: requestedCwd,
      groupId, ready: false, xterm, fitAddon, domEl, detectedErrors: [], lastError: null,
    };

    const nextSessions = [...existingSessions, provisionalSession];
    sessionsRef.current = nextSessions;
    setSessions(nextSessions);
    setActiveId(id);
    activeIdRef.current = id;

    const outputBuf: string[] = [];
    let curLine = "";
    const rollingLines: string[] = [];

    try {
      const unlisten = await listen<string>(`terminal-output-${id}`, (event) => {
        xterm.write(event.payload);
        const raw = event.payload.replace(/\x1b\[[0-9;]*[mGKHF]/g, "");
        // Accumulate for Output tab — use ref to avoid per-char re-renders
        outputLogRef.current.push(raw);
        if (outputLogRef.current.length > 200) outputLogRef.current = outputLogRef.current.slice(-200);
        // Flush to trigger re-render at most every 500ms
        if (!outputFlushTimer.current) {
          outputFlushTimer.current = setTimeout(() => {
            outputFlushTimer.current = null;
            setOutputLogVersion(v => v + 1);
          }, 500);
        }
        for (const ch of raw) {
          if (ch === "\n" || ch === "\r") {
            if (curLine.trim()) {
              outputBuf.push(curLine);
              rollingLines.push(curLine);
              if (outputBuf.length > 80) outputBuf.shift();
              if (rollingLines.length > 120) rollingLines.shift();
              const looksLikeError =
                /error[ :]|exception|traceback|fail|panic|cannot find|no module|not found|undefined|unresolved/i.test(curLine) &&
                !/debug|info|warn|notice|successfully/i.test(curLine);
              if (looksLikeError) {
                const snapshot = outputBuf.join("\n");
                const activeTab = useEditorStore.getState().tabs.find(
                  (t) => t.id === useEditorStore.getState().activeTabId
                );
                const errors = parseTerminalErrors(rollingLines.join("\n"), activeTab?.language);
                if (errors.length > 0) {
                  setTimeout(() => {
                    setSessions((prev) =>
                      prev.map((s) => s.id === id ? { ...s, lastError: snapshot, detectedErrors: errors } : s)
                    );
                    if (activeIdRef.current === id) {
                      setLastErrors(errors);
                      setDiagOpen(true);
                      setExpandedIdx(null);
                    }
                  }, 120);
                }
              }
            }
            curLine = "";
          } else {
            curLine += ch;
          }
        }
      });
      unlistenMap.current[id] = unlisten;

      const launchInfo = await invoke<TerminalLaunchInfo>("create_terminal", { id, cwd: requestedCwd });
      const shellName = launchInfo.shellName || "shell";
      const title = nextTerminalTitle(shellName, existingSessions);

      xterm.onData((data) => {
        invoke("write_to_terminal", { id, data }).catch((e) => console.error("Terminal write failed:", e));
      });

      setSessions((prev) =>
        prev.map((s) => s.id === id ? { ...s, ready: true, shellName, title, cwd: launchInfo.cwd } : s)
      );
    } catch (error) {
      setSessions((prev) =>
        prev.map((s) => s.id === id ? { ...s, title: "unavailable", lastError: String(error) } : s)
      );
      xterm.writeln(`\r\n\x1b[31mTerminal error: ${error}\x1b[0m`);
      xterm.writeln("\r\nCheck shell availability and terminal permissions, then open a new session.");
    } finally {
      creatingSessionRef.current = false;
      layoutSessions();
      focusSession(id);
    }
    return id;
  }, [activateSession, focusSession, layoutSessions, openFolder, setLastErrors]);

  const closeSession = useCallback((id: string) => {
    const currentSessions = sessionsRef.current;
    const target = currentSessions.find((s) => s.id === id);
    if (!target) return;
    invoke("kill_terminal", { id }).catch(() => {});
    const remaining = currentSessions.filter((s) => s.id !== id);
    const siblings = remaining.filter((s) => s.groupId === target.groupId);
    const nextActive = activeIdRef.current !== id
      ? activeIdRef.current
      : siblings[0]?.id ?? remaining[remaining.length - 1]?.id ?? null;
    disposeSessionResources(target);
    sessionsRef.current = remaining;
    activeIdRef.current = nextActive;
    setSessions(remaining);
    setActiveId(nextActive);
    setExpandedIdx(null);
    if (!nextActive) { setDiagOpen(false); setLastErrors([]); }
    else focusSession(nextActive);
  }, [disposeSessionResources, focusSession, setLastErrors]);

  const renameSession = useCallback((id: string) => {
    const session = sessionsRef.current.find((s) => s.id === id);
    if (!session) return;
    const nextTitle = prompt("Rename terminal", session.title);
    if (!nextTitle?.trim()) return;
    setSessions((prev) => prev.map((s) => s.id === id ? { ...s, title: nextTitle.trim() } : s));
  }, []);

  const clearSession = useCallback((id: string) => {
    const session = sessionsRef.current.find((s) => s.id === id);
    if (!session) return;
    session.xterm.clear();
    invoke("write_to_terminal", { id, data: "\u000c" }).catch((e) => console.error("Terminal clear failed:", e));
    setSessions((prev) => prev.map((s) => s.id === id ? { ...s, lastError: null, detectedErrors: [] } : s));
    if (activeIdRef.current === id) { setDiagOpen(false); setExpandedIdx(null); setLastErrors([]); }
  }, [setLastErrors]);

  const runInTerminal = useCallback(async (cmd: string) => {
    let targetId = activeIdRef.current;
    if (!targetId) targetId = await createSession();
    if (!targetId) return;
    invoke("write_to_terminal", { id: targetId, data: `${cmd}\r` })
      .catch((e) => console.error("Terminal run failed:", e));
    focusSession(targetId);
  }, [createSession, focusSession]);

  const cleanupRunListeners = useCallback((runId: string) => {
    const dispose = runListenerMap.current[runId];
    if (!dispose) return;
    dispose();
    delete runListenerMap.current[runId];
  }, []);

  const reviewRunWithAI = useCallback((run: RunRecord, automatic = false) => {
    const preview = run.output.trim();
    const clipped = preview.length > 4000 ? `${preview.slice(0, 4000)}\n…[truncated]` : preview;
    const statusText =
      run.exitCode === 0
        ? "completed successfully"
        : `finished with exit code ${run.exitCode ?? -1}`;

    setActiveView("ai");
    if (!showAIPanel) toggleAIPanel();

    if (automatic) {
      addToast("Command finished. Asking AI to review the result…", "info");
    }

    setTimeout(() => {
      sendMessage(
        `[SYSTEM] Review this terminal command result.\nCommand: \`${run.cmd}\`\nStatus: ${statusText}\nOutput:\n\`\`\`\n${clipped || "(no output)"}\n\`\`\`\nExplain what happened, whether anything failed, and what the next safe step should be.`
      );
    }, 120);
  }, [addToast, sendMessage, setActiveView, showAIPanel, toggleAIPanel]);

  // Run panel: run a command and capture real output
  const runCommand = useCallback(async (
    cmd: string,
    options: {
      source?: "manual" | "ai";
      analyzeWithAI?: boolean;
      requestKey?: string;
    } = {}
  ) => {
    let targetId = activeIdRef.current;
    if (!targetId) targetId = await createSession();
    if (!targetId) return;

    const targetSession = sessionsRef.current.find((s) => s.id === targetId);
    const runId = `run-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const startedAt = Date.now();
    const record: RunRecord = {
      id: runId,
      cmd,
      output: "",
      exitCode: null,
      startedAt,
      duration: 0,
      running: true,
      source: options.source ?? "manual",
      analyzeWithAI: options.analyzeWithAI ?? false,
      requestKey: options.requestKey,
    };

    setRunHistory((prev) => [record, ...prev].slice(0, 12));
    setActiveRunId(runId);
    setPanelTab("run");
    focusSession(targetId);
    if (options.requestKey) {
      setCommandRunState(options.requestKey, {
        runId,
        command: cmd,
        source: options.source ?? "manual",
        analyzeWithAI: options.analyzeWithAI ?? false,
        status: "running",
        exitCode: null,
      });
    }

    const unlistenOutput = await listen<string>(`command-output-${runId}`, (event) => {
      setRunHistory((prev) =>
        prev.map((run) =>
          run.id === runId
            ? { ...run, output: `${run.output}${event.payload}`.slice(-120_000) }
            : run
        )
      );
    });

    const unlistenFinished = await listen<CommandFinishedPayload>(`command-finished-${runId}`, (event) => {
      cleanupRunListeners(runId);
      let completedRun: RunRecord | undefined;
      setRunHistory((prev) =>
        prev.map((run) => {
          if (run.id !== runId) return run;
          const updatedRun: RunRecord = {
            ...run,
            running: false,
            exitCode: event.payload.exitCode,
            duration: Date.now() - run.startedAt,
            output: event.payload.output || run.output,
          };
          completedRun = updatedRun;
          return updatedRun;
        })
      );
      const finalizedRun = completedRun;
      if (finalizedRun?.requestKey) {
        const existingStatus = useTerminalStore.getState().commandRunStates[finalizedRun.requestKey]?.status;
        const finalStatus =
          existingStatus === "stopped"
            ? "stopped"
            : event.payload.exitCode === 0
              ? "success"
              : "error";
        setCommandRunState(finalizedRun.requestKey, {
          runId,
          command: finalizedRun.cmd,
          source: finalizedRun.source,
          analyzeWithAI: finalizedRun.analyzeWithAI,
          status: finalStatus,
          exitCode: existingStatus === "stopped" ? -1 : event.payload.exitCode,
        });
      }
      if (
        finalizedRun?.analyzeWithAI &&
        (!finalizedRun.requestKey ||
          useTerminalStore.getState().commandRunStates[finalizedRun.requestKey]?.status !== "stopped")
      ) {
        reviewRunWithAI(finalizedRun, true);
      }
    });

    runListenerMap.current[runId] = () => {
      unlistenOutput();
      unlistenFinished();
    };

    try {
      await invoke("run_command_stream", {
        runId,
        cmd,
        cwd: targetSession?.cwd ?? openFolder ?? ".",
        terminalId: targetId,
      });
    } catch (error) {
      cleanupRunListeners(runId);
      const message = String(error);
      setRunHistory((prev) =>
        prev.map((run) =>
          run.id === runId
            ? {
                ...run,
                running: false,
                exitCode: -1,
                duration: Date.now() - run.startedAt,
                output: message,
              }
            : run
        )
      );
      if (options.requestKey) {
        setCommandRunState(options.requestKey, {
          runId,
          command: cmd,
          source: options.source ?? "manual",
          analyzeWithAI: options.analyzeWithAI ?? false,
          status: "error",
          exitCode: -1,
        });
      }
      addToast(`Failed to run command: ${message}`, "error");
    }
  }, [addToast, cleanupRunListeners, createSession, focusSession, openFolder, reviewRunWithAI, setCommandRunState, setPanelTab]);

  const stopRun = useCallback(async (targetRun: RunRecord) => {
    try {
      await invoke("kill_command_run", { runId: targetRun.id });
      setRunHistory((prev) =>
        prev.map((run) =>
          run.id === targetRun.id
            ? { ...run, running: false, exitCode: -1, duration: Date.now() - run.startedAt }
            : run
        )
      );
      if (targetRun.requestKey) {
        setCommandRunState(targetRun.requestKey, {
          runId: targetRun.id,
          command: targetRun.cmd,
          source: targetRun.source,
          analyzeWithAI: targetRun.analyzeWithAI,
          status: "stopped",
          exitCode: -1,
        });
      }
    } catch (error) {
      addToast(`Could not stop command: ${String(error)}`, "warning");
    }
  }, [addToast, setCommandRunState]);

  // Effects
  useEffect(() => { createSession(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  useEffect(() => {
    return () => {
      Object.values(unlistenMap.current).forEach((fn) => fn());
      unlistenMap.current = {};
      Object.values(runListenerMap.current).forEach((fn) => fn());
      runListenerMap.current = {};
      sessionsRef.current.forEach((s) => {
        invoke("kill_terminal", { id: s.id }).catch(() => {});
        s.xterm.dispose();
        s.domEl.remove();
      });
    };
  }, []);

  useEffect(() => {
    const timer = setInterval(() => {
      setRunHistory((prev) => {
        if (!prev.some((run) => run.running)) return prev;
        return prev.map((run) =>
          run.running ? { ...run, duration: Date.now() - run.startedAt } : run
        );
      });
    }, 250);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => { layoutSessions(); }, [layoutSessions, sessions, activeId]);

  useEffect(() => {
    if (!bodyRef.current) return;
    const observer = new ResizeObserver(() => layoutSessions());
    observer.observe(bodyRef.current);
    return () => observer.disconnect();
  }, [layoutSessions]);

  useEffect(() => { if (newTerminalRequest === 0) return; createSession(); }, [createSession, newTerminalRequest]);
  useEffect(() => {
    if (splitTerminalRequest === 0) return;
    const sourceId = activeIdRef.current;
    createSession(sourceId ? { splitFromId: sourceId } : undefined);
  }, [createSession, splitTerminalRequest]);

  useEffect(() => {
    const handler = () => setPanelTab("problems");
    window.addEventListener("ncode:open-problems", handler);
    return () => window.removeEventListener("ncode:open-problems", handler);
  }, []);

  useEffect(() => { if (clearTerminalRequest === 0) return; if (activeIdRef.current) clearSession(activeIdRef.current); }, [clearSession, clearTerminalRequest]);
  useEffect(() => { if (closeActiveTerminalRequest === 0) return; if (activeIdRef.current) closeSession(activeIdRef.current); }, [closeActiveTerminalRequest, closeSession]);

  useEffect(() => {
    if (!queuedCommand) return;
    const dispatchQueuedCommand = async () => {
      if (queuedCommand.tracked) {
        await runCommand(queuedCommand.command, {
          source: queuedCommand.source ?? "manual",
          analyzeWithAI: queuedCommand.analyzeWithAI ?? false,
          requestKey: queuedCommand.requestKey,
        });
        clearQueuedCommand();
        return;
      }

      let targetId = activeIdRef.current;
      if (!targetId) targetId = await createSession();
      if (!targetId) return;
      const targetSession = sessionsRef.current.find((s) => s.id === targetId);
      if (!targetSession?.ready) return;
      invoke("write_to_terminal", { id: targetId, data: `${queuedCommand.command}\r` })
        .catch((e) => console.error("Queued terminal command failed:", e))
        .finally(() => { clearQueuedCommand(); focusSession(targetId!); });
    };
    dispatchQueuedCommand();
  }, [clearQueuedCommand, createSession, focusSession, queuedCommand, runCommand, sessions]);

  const handleDebugClick = (errorStr: string) => {
    setActiveView("ai");
    if (!showAIPanel) toggleAIPanel();
    setAIMode("bug_hunt");
    const activeTab = tabs.find((t) => t.id === activeTabId);
    const fileCtx = activeTab
      ? `\n\n\`\`\`${activeTab.language}\n// ${activeTab.fileName}\n${activeTab.content.slice(0, 3000)}\n\`\`\``
      : "";
    setSessions((prev) => prev.map((s) => s.id === activeId ? { ...s, lastError: null } : s));
    setTimeout(() => {
      sendMessage(
        `I encountered the following error in the terminal. Please help me fix it:${fileCtx}\n\nTerminal Output:\n\`\`\`\n${errorStr.slice(-2000)}\n\`\`\``
      );
    }, 100);
  };

  const dismissDiag = () => {
    setDiagOpen(false);
    setSessions((prev) => prev.map((s) => s.id === activeId ? { ...s, detectedErrors: [], lastError: null } : s));
    setLastErrors([]);
  };

  const activeEditorTab = tabs.find((t) => t.id === activeTabId);
  const runCmd = activeEditorTab
    ? getRunCommand(activeEditorTab.language, activeEditorTab.filePath, activeEditorTab.fileName)
    : null;

  const activeSession = sessions.find((s) => s.id === activeId) ?? null;

  // Must be after activeSession declaration
  useEffect(() => {
    setLastErrors(activeSession?.detectedErrors ?? []);
    if (!activeSession?.detectedErrors.length) setExpandedIdx(null);
  }, [activeSession, setLastErrors]);
  const activeGroupSessions = activeSession
    ? sessions.filter((s) => s.groupId === activeSession.groupId)
    : [];
  const groupSizes = useMemo(
    () => sessions.reduce<Record<string, number>>((acc, s) => {
      acc[s.groupId] = (acc[s.groupId] ?? 0) + 1;
      return acc;
    }, {}),
    [sessions]
  );

  const errors = activeSession?.detectedErrors ?? [];
  const errorCount = errors.filter((e) => e.severity === "error").length;
  const warnCount  = errors.filter((e) => e.severity === "warning").length;
  const infoCount  = errors.filter((e) => e.severity === "info").length;

  // Total errors across ALL sessions for status bar
  const totalErrors   = sessions.reduce((n, s) => n + s.detectedErrors.filter((e) => e.severity === "error").length, 0);
  const totalWarnings = sessions.reduce((n, s) => n + s.detectedErrors.filter((e) => e.severity === "warning").length, 0);

  const activeRun = runHistory.find((r) => r.id === activeRunId) ?? runHistory[0] ?? null;

  const isTerminalVisible = panelTab === "terminal";

  return (
    <div className="jb-terminal">
      {/* ── Top panel tabs + toolbar ── */}
      <div className="jb-header">
        {/* Left: panel tabs */}
        <div className="jb-panel-tabs">
          {(["terminal", "problems", "run", "output"] as TerminalPanelTab[]).map((tab) => (
            <button
              key={tab}
              className={`jb-panel-tab ${panelTab === tab ? "active" : ""}`}
              onClick={() => setPanelTab(tab)}
            >
              {tab === "terminal" && "Terminal"}
              {tab === "problems" && (
                <>
                  Problems
                  {(totalErrors + totalWarnings) > 0 && (
                    <span className={`jb-panel-tab-badge ${totalErrors > 0 ? "err" : "warn"}`}>
                      {totalErrors + totalWarnings}
                    </span>
                  )}
                </>
              )}
              {tab === "run" && "Run"}
              {tab === "output" && "Output"}
            </button>
          ))}
        </div>

        {/* Middle: session sub-tabs (only when Terminal tab active) */}
        {panelTab === "terminal" && (
          <div className="jb-session-tabs">
            {sessions.map((session) => {
              const groupSize = groupSizes[session.groupId] ?? 1;
              const hasErrors = session.detectedErrors.some((e) => e.severity === "error");
              const hasWarns  = !hasErrors && session.detectedErrors.some((e) => e.severity === "warning");
              return (
                <div
                  key={session.id}
                  className={`jb-session-tab ${activeId === session.id ? "active" : ""}`}
                  onClick={() => activateSession(session.id)}
                  onDoubleClick={() => renameSession(session.id)}
                  title={`${session.title} — ${session.cwd}`}
                >
                  {hasErrors && (
                    <span className="jb-session-tab-dot err" title="Errors detected"
                      onClick={(e) => { e.stopPropagation(); setPanelTab("problems"); }} />
                  )}
                  {hasWarns && (
                    <span className="jb-session-tab-dot warn" title="Warnings detected"
                      onClick={(e) => { e.stopPropagation(); setPanelTab("problems"); }} />
                  )}
                  <span className="jb-session-tab-label">{session.title}</span>
                  {groupSize > 1 && <span className="jb-session-tab-split">{groupSize}</span>}
                  {!session.ready && <span className="jb-session-tab-spin">…</span>}
                  <button
                    className="jb-session-tab-close"
                    onClick={(e) => { e.stopPropagation(); closeSession(session.id); }}
                    title="Close"
                  >
                    <X size={10} />
                  </button>
                </div>
              );
            })}
            <button className="jb-session-tab-new" onClick={() => createSession()} title="New terminal">
              <Plus size={12} />
            </button>
          </div>
        )}

        {/* Right: toolbar */}
        <div className="jb-toolbar">
          {runCmd && activeEditorTab && (
            <button
              className="jb-toolbar-btn run-btn"
              onClick={() => runCommand(runCmd)}
              title={`Run: ${runCmd}`}
            >
              <Play size={13} />
            </button>
          )}
          <button className="jb-toolbar-btn" onClick={() => createSession()} title="New Terminal">
            <Plus size={13} />
          </button>
          <button
            className="jb-toolbar-btn"
            onClick={() => createSession(activeId ? { splitFromId: activeId } : undefined)}
            title="Split Terminal"
          >
            <SplitSquareVertical size={13} />
          </button>
          <button
            className="jb-toolbar-btn"
            onClick={() => activeId && renameSession(activeId)}
            disabled={!activeId}
            title="Rename"
          >
            <SquarePen size={13} />
          </button>
          <button
            className="jb-toolbar-btn"
            onClick={() => activeId && clearSession(activeId)}
            disabled={!activeId}
            title="Clear"
          >
            <Eraser size={13} />
          </button>
          <button
            className="jb-toolbar-btn"
            onClick={() => activeId && closeSession(activeId)}
            disabled={!activeId}
            title="Close Session"
          >
            <X size={13} />
          </button>
          {/* Status bar: total error/warning count */}
          {(totalErrors + totalWarnings) > 0 && (
            <button
              className="jb-toolbar-status"
              onClick={() => setPanelTab("problems")}
              title="Open Problems"
            >
              {totalErrors > 0 && <><AlertCircle size={11} /><span>{totalErrors}</span></>}
              {totalWarnings > 0 && <><AlertTriangle size={11} /><span>{totalWarnings}</span></>}
            </button>
          )}
          {activeGroupSessions.length > 1 && (
            <span className="jb-toolbar-split-info">{activeGroupSessions.length} panes</span>
          )}
        </div>
      </div>

      {/* ── Diagnostics panel (shown when terminal tab active) ── */}
      {panelTab === "terminal" && diagOpen && errors.length > 0 && (
        <div className="terminal-diag-panel">
          <div className="terminal-diag-header">
            <span className="terminal-diag-title">
              <Package size={12} /> Diagnostics — {errors.length} issue{errors.length !== 1 ? "s" : ""}
            </span>
            <div className="terminal-diag-header-actions">
              {activeSession?.lastError && (
                <button
                  className="terminal-diag-ai-btn"
                  onClick={() => handleDebugClick(activeSession.lastError!)}
                  title="Debug all with AI"
                >
                  <Bug size={11} /> Debug with AI
                </button>
              )}
              <button className="terminal-diag-close" onClick={dismissDiag} title="Dismiss all">
                <X size={11} />
              </button>
            </div>
          </div>
          <div className="terminal-diag-list">
            {errors.map((error, index) => (
              <div
                key={index}
                className={`terminal-diag-item sev-${error.severity} ${expandedIdx === index ? "expanded" : ""}`}
              >
                <div
                  className="terminal-diag-row"
                  onClick={() => setExpandedIdx(expandedIdx === index ? null : index)}
                >
                  <span className={`terminal-diag-sev-icon sev-${error.severity}`}>{SEV_ICON[error.severity]}</span>
                  <span className="terminal-diag-cat-icon" title={error.category}>{categoryIcon(error.category)}</span>
                  <span className="terminal-diag-lang">{error.language}</span>
                  <span className="terminal-diag-title-text">{error.title}</span>
                  {error.file && (
                    <span className="terminal-diag-loc">
                      {error.file.split("/").pop()}{error.line ? `:${error.line}` : ""}
                    </span>
                  )}
                  <span className="terminal-diag-chevron">
                    {expandedIdx === index ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
                  </span>
                </div>
                {expandedIdx === index && (
                  <div className="terminal-diag-detail">
                    {error.detail && <p className="terminal-diag-detail-text">{error.detail}</p>}
                    {error.rawLine && (
                      <div className="terminal-diag-raw">
                        <span className="terminal-diag-raw-label">Output:</span>
                        <code>{error.rawLine}</code>
                      </div>
                    )}
                    <div className="terminal-diag-actions">
                      {error.installCommand && (
                        <button className="terminal-diag-action-btn install" onClick={() => runInTerminal(error.installCommand!)} title={error.installCommand}>
                          <Download size={11} /><span>Install</span><code>{error.installCommand}</code>
                        </button>
                      )}
                      {error.updateCommand && (
                        <button className="terminal-diag-action-btn update" onClick={() => runInTerminal(error.updateCommand!)} title={error.updateCommand}>
                          <RefreshCw size={11} /><span>Update</span><code>{error.updateCommand}</code>
                        </button>
                      )}
                      {error.uninstallCommand && (
                        <button className="terminal-diag-action-btn uninstall" onClick={() => runInTerminal(error.uninstallCommand!)} title={error.uninstallCommand}>
                          <Trash2 size={11} /><span>Remove</span><code>{error.uninstallCommand}</code>
                        </button>
                      )}
                      {error.docsUrl && (
                        <a className="terminal-diag-action-btn docs" href={error.docsUrl} target="_blank" rel="noreferrer" title="Open docs">
                          <ExternalLink size={11} /><span>Docs</span>
                        </a>
                      )}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Main workbench area ── */}
      <div className="terminal-workbench">
        {/* Problems panel */}
        {panelTab === "problems" && (
          <ProblemsPanel onClose={() => setPanelTab("terminal")} />
        )}

        {/* Run panel */}
        {panelTab === "run" && (
          <div className="jb-run-panel">
            {!activeRun ? (
              <div className="jb-run-empty">
                <Play size={24} style={{ opacity: 0.15 }} />
                <p>No runs yet. Use the ▶ button to run the active file.</p>
              </div>
            ) : (
              <>
                <div className="jb-run-header">
                  <Play size={12} />
                  <span className="jb-run-cmd">{activeRun.cmd}</span>
                  {activeRun.source === "ai" && (
                    <span className="jb-run-origin">AI</span>
                  )}
                  {activeRun.analyzeWithAI && (
                    <span className="jb-run-ai-check">Auto-check</span>
                  )}
                  {activeRun.running ? (
                    <>
                      <span className="jb-run-timing">{fmtDuration(activeRun.duration)}</span>
                      <button
                        className="jb-toolbar-btn"
                        onClick={() => setPanelTab("terminal")}
                        title="Show live output in terminal"
                      >
                        <ExternalLink size={11} />
                      </button>
                      <button className="jb-toolbar-btn" onClick={() => stopRun(activeRun)} title="Stop">
                        <Square size={11} />
                      </button>
                    </>
                  ) : (
                    <>
                      <span className="jb-run-timing">{fmtDuration(activeRun.duration)}</span>
                      <button
                        className="jb-toolbar-btn"
                        onClick={() => setPanelTab("terminal")}
                        title="Open terminal tab"
                      >
                        <ExternalLink size={11} />
                      </button>
                      {activeRun.exitCode === 0
                        ? <span className="jb-run-exit-ok">✓ 0</span>
                        : <span className="jb-run-exit-err">✗ {activeRun.exitCode ?? "?"}</span>
                      }
                      <button
                        className="jb-toolbar-btn"
                        onClick={() => reviewRunWithAI(activeRun)}
                        title="Check this run with AI"
                      >
                        <Bug size={11} />
                      </button>
                      <button
                        className="jb-toolbar-btn"
                        onClick={() =>
                          runCommand(activeRun.cmd, {
                            source: activeRun.source,
                            analyzeWithAI: activeRun.analyzeWithAI,
                            requestKey: activeRun.requestKey,
                          })
                        }
                        title="Re-run"
                      >
                        <RotateCcw size={11} />
                      </button>
                    </>
                  )}
                </div>
                {runHistory.length > 1 && (
                  <div className="jb-run-history">
                    {runHistory.slice(1).map((r) => (
                      <button
                        key={r.id}
                        className={`jb-run-history-item ${r.id === activeRunId ? "active" : ""}`}
                        onClick={() => setActiveRunId(r.id)}
                      >
                        <span className="jb-run-history-cmd">{r.cmd}</span>
                        {r.source === "ai" && <span className="jb-run-history-origin">AI</span>}
                        {r.exitCode === 0
                          ? <span className="jb-run-exit-ok">✓</span>
                          : <span className="jb-run-exit-err">✗</span>
                        }
                        <span className="jb-run-timing">{fmtDuration(r.duration)}</span>
                      </button>
                    ))}
                  </div>
                )}
                <div className="jb-run-output">
                  {activeRun.output.trim().length > 0 ? (
                    activeRun.output
                  ) : activeRun.running ? (
                    <em style={{ opacity: 0.45, fontSize: 11 }}>Waiting for command output…</em>
                  ) : (
                    <em style={{ opacity: 0.4, fontSize: 11 }}>Command completed with no output.</em>
                  )}
                </div>
              </>
            )}
          </div>
        )}

        {/* Output tab */}
        {panelTab === "output" && (
          <div className="jb-run-panel">
            <div className="jb-run-header">
              <span>Output Log</span>
              <button className="jb-toolbar-btn" onClick={() => { outputLogRef.current = []; setOutputLogVersion(v => v + 1); }} title="Clear output">
                <Eraser size={11} />
              </button>
            </div>
            <pre className="jb-run-output">
              {outputLogRef.current.length === 0
                ? <em style={{ opacity: 0.4 }}>No output yet.</em>
                : outputLogRef.current.join("")}
            </pre>
          </div>
        )}

        {/* Terminal body */}
        <div
          ref={bodyRef}
          className="terminal-body-host"
          style={{ display: isTerminalVisible ? undefined : "none" }}
        />

        {/* Empty state */}
        {isTerminalVisible && sessions.length === 0 && (
          <div className="terminal-empty-state">
            <strong>No terminals running</strong>
            <p>Create a terminal to run commands, debug files, or keep multiple split sessions open.</p>
            <div className="terminal-empty-actions">
              <button className="btn-primary" onClick={() => createSession()}>
                <Plus size={13} /> New Terminal
              </button>
              {runCmd && (
                <button className="terminal-empty-secondary" onClick={() => runInTerminal(runCmd)}>
                  <Play size={12} /> Run Active File
                </button>
              )}
            </div>
          </div>
        )}

        {/* Debug overlay */}
        {isTerminalVisible && activeSession?.lastError && !diagOpen && (
          <div className="terminal-debug-overlay">
            <button
              className="btn-primary terminal-debug-btn"
              onClick={() => handleDebugClick(activeSession.lastError!)}
            >
              <Bug size={13} /> Debug with AI
            </button>
            <button
              className="terminal-debug-dismiss"
              onClick={() => setSessions((prev) =>
                prev.map((s) => s.id === activeId ? { ...s, lastError: null } : s)
              )}
              title="Dismiss"
            >
              <X size={10} />
            </button>
          </div>
        )}

        {/* Diag toggle button (terminal tab only) */}
        {isTerminalVisible && errors.length > 0 && (
          <button
            className={`jb-diag-toggle ${diagOpen ? "active" : ""}`}
            onClick={() => setDiagOpen((o) => !o)}
            title="Toggle diagnostics"
          >
            {errorCount > 0 && <span className="diag-badge error"><AlertCircle size={10} />{errorCount}</span>}
            {warnCount > 0 && <span className="diag-badge warn"><AlertTriangle size={10} />{warnCount}</span>}
            {infoCount > 0 && <span className="diag-badge info"><Info size={10} />{infoCount}</span>}
            {diagOpen ? <ChevronDown size={11} /> : <ChevronUp size={11} />}
          </button>
        )}
      </div>
    </div>
  );
}
