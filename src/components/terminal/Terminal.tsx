// src/components/terminal/Terminal.tsx
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
  Package,
  Play,
  Plus,
  RefreshCw,
  SplitSquareVertical,
  SquarePen,
  Trash2,
  X,
} from "lucide-react";
import { useEditorStore } from "../../store/editorStore";
import { useUIStore } from "../../store/uiStore";
import { useAIStore } from "../../store/aiStore";
import { useTerminalStore } from "../../store/terminalStore";
import { getRunCommand } from "../../utils/languageRunner";
import {
  parseTerminalErrors,
  categoryIcon,
  type DetectedError,
  type ErrorSeverity,
} from "../../utils/errorParser";
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

const SEV_ICON: Record<ErrorSeverity, React.ReactNode> = {
  error: <AlertCircle size={12} />,
  warning: <AlertTriangle size={12} />,
  info: <Info size={12} />,
};

function nextTerminalTitle(shellName: string, sessions: TerminalSession[]) {
  const count = sessions.filter((session) => session.shellName === shellName).length;
  return count === 0 ? shellName : `${shellName} ${count + 1}`;
}

function paneRectsForCount(count: number): PaneRect[] {
  if (count <= 1) {
    return [{ left: 0, top: 0, width: 100, height: 100 }];
  }

  if (count === 2) {
    return [
      { left: 0, top: 0, width: 50, height: 100 },
      { left: 50, top: 0, width: 50, height: 100 },
    ];
  }

  if (count === 3) {
    return [
      { left: 0, top: 0, width: 50, height: 50 },
      { left: 50, top: 0, width: 50, height: 50 },
      { left: 0, top: 50, width: 100, height: 50 },
    ];
  }

  const rows = Math.ceil(count / 2);
  const rowHeight = 100 / rows;
  return Array.from({ length: count }, (_, index) => {
    const row = Math.floor(index / 2);
    const isLastOdd = count % 2 === 1 && index === count - 1;
    if (isLastOdd) {
      return { left: 0, top: row * rowHeight, width: 100, height: rowHeight };
    }

    return {
      left: (index % 2) * 50,
      top: row * rowHeight,
      width: 50,
      height: rowHeight,
    };
  });
}

export function Terminal() {
  const [sessions, setSessions] = useState<TerminalSession[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [diagOpen, setDiagOpen] = useState(false);
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);

  const bodyRef = useRef<HTMLDivElement>(null);
  const unlistenMap = useRef<Record<string, () => void>>({});
  const sessionsRef = useRef<TerminalSession[]>([]);
  const activeIdRef = useRef<string | null>(null);
  const creatingSessionRef = useRef(false);

  const { openFolder, tabs, activeTabId } = useEditorStore();
  const { setActiveView, toggleAIPanel, showAIPanel } = useUIStore();
  const { setAIMode, sendMessage } = useAIStore();
  const {
    queuedCommand,
    newTerminalRequest,
    splitTerminalRequest,
    clearTerminalRequest,
    closeActiveTerminalRequest,
    clearQueuedCommand,
    setLastErrors,
  } = useTerminalStore();

  useEffect(() => {
    sessionsRef.current = sessions;
  }, [sessions]);

  useEffect(() => {
    activeIdRef.current = activeId;
  }, [activeId]);

  const syncTerminalSize = useCallback((session: TerminalSession) => {
    if (!session.ready) return;

    requestAnimationFrame(() => {
      try {
        session.fitAddon.fit();
      } catch {
        return;
      }

      if (session.xterm.cols > 0 && session.xterm.rows > 0) {
        invoke("resize_terminal", {
          id: session.id,
          cols: session.xterm.cols,
          rows: session.xterm.rows,
        }).catch((error) => {
          console.error("Terminal resize failed:", error);
        });
      }
    });
  }, []);

  const layoutSessions = useCallback(() => {
    const activeSession = sessionsRef.current.find((session) => session.id === activeIdRef.current) ?? null;
    const visibleSessions = activeSession
      ? sessionsRef.current.filter((session) => session.groupId === activeSession.groupId)
      : [];
    const rects = paneRectsForCount(visibleSessions.length || 1);

    sessionsRef.current.forEach((session) => {
      session.domEl.style.display = "none";
    });

    visibleSessions.forEach((session, index) => {
      const rect = rects[index] ?? rects[0];
      const inset = visibleSessions.length > 1 ? 4 : 0;
      const isActive = session.id === activeIdRef.current;

      session.domEl.style.display = "block";
      session.domEl.style.position = "absolute";
      session.domEl.style.left = `calc(${rect.left}% + ${inset}px)`;
      session.domEl.style.top = `calc(${rect.top}% + ${inset}px)`;
      session.domEl.style.width = `calc(${rect.width}% - ${inset * 2}px)`;
      session.domEl.style.height = `calc(${rect.height}% - ${inset * 2}px)`;
      session.domEl.style.border =
        visibleSessions.length > 1
          ? `1px solid ${isActive ? "rgba(0, 122, 204, 0.45)" : "rgba(255, 255, 255, 0.08)"}`
          : "none";
      session.domEl.style.borderRadius = visibleSessions.length > 1 ? "6px" : "0";
      session.domEl.style.background = "#1e1e1e";
      session.domEl.style.boxShadow = isActive && visibleSessions.length > 1 ? "0 0 0 1px rgba(0, 122, 204, 0.08)" : "none";

      syncTerminalSize(session);
    });
  }, [syncTerminalSize]);

  const focusSession = useCallback((id: string) => {
    requestAnimationFrame(() => {
      sessionsRef.current.find((session) => session.id === id)?.xterm.focus();
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
      ? existingSessions.find((session) => session.id === options.splitFromId) ?? null
      : null;

    const id = `term-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const groupId = splitSource?.groupId ?? id;
    const requestedCwd = splitSource?.cwd || openFolder || (typeof process !== "undefined" ? process.env.HOME : "") || "/";

    const xterm = new XTerm({
      theme: {
        background: "#1e1e1e",
        foreground: "#d4d4d4",
        cursor: "#aeafad",
        black: "#000000",
        red: "#cd3131",
        green: "#0dbc79",
        yellow: "#e5e510",
        blue: "#2472c8",
        magenta: "#bc3fbc",
        cyan: "#11a8cd",
        white: "#e5e5e5",
        brightBlack: "#666666",
        brightRed: "#f14c4c",
        brightGreen: "#23d18b",
        brightYellow: "#f5f543",
        brightBlue: "#3b8eea",
        brightMagenta: "#d670d6",
        brightCyan: "#29b8db",
        brightWhite: "#e5e5e5",
      },
      fontFamily: "'JetBrains Mono', 'Fira Code', Consolas, monospace",
      fontSize: 13,
      lineHeight: 1.4,
      cursorBlink: true,
      convertEol: true,
      scrollback: 5000,
    });
    const fitAddon = new FitAddon();
    xterm.loadAddon(fitAddon);
    xterm.loadAddon(new WebLinksAddon());

    const domEl = document.createElement("div");
    domEl.className = "terminal-pane-host";
    domEl.style.cssText =
      "position:absolute;display:none;overflow:hidden;background:#1e1e1e;outline:none;";
    domEl.addEventListener("mousedown", () => {
      activateSession(id);
    });
    if (bodyRef.current) {
      bodyRef.current.appendChild(domEl);
    }
    xterm.open(domEl);

    const provisionalSession: TerminalSession = {
      id,
      title: "Starting...",
      shellName: "shell",
      cwd: requestedCwd,
      groupId,
      ready: false,
      xterm,
      fitAddon,
      domEl,
      detectedErrors: [],
      lastError: null,
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
                  (tab) => tab.id === useEditorStore.getState().activeTabId
                );
                const errors = parseTerminalErrors(rollingLines.join("\n"), activeTab?.language);
                if (errors.length > 0) {
                  setTimeout(() => {
                    setSessions((prev) =>
                      prev.map((session) =>
                        session.id === id ? { ...session, lastError: snapshot, detectedErrors: errors } : session
                      )
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

      const launchInfo = await invoke<TerminalLaunchInfo>("create_terminal", {
        id,
        cwd: requestedCwd,
      });

      const shellName = launchInfo.shellName || "shell";
      const title = nextTerminalTitle(shellName, existingSessions);

      xterm.onData((data) => {
        invoke("write_to_terminal", { id, data }).catch((error) => {
          console.error("Terminal write failed:", error);
        });
      });

      setSessions((prev) =>
        prev.map((session) =>
          session.id === id
            ? {
                ...session,
                ready: true,
                shellName,
                title,
                cwd: launchInfo.cwd,
              }
            : session
        )
      );
    } catch (error) {
      setSessions((prev) =>
        prev.map((session) =>
          session.id === id ? { ...session, title: "unavailable", lastError: String(error) } : session
        )
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
    const target = currentSessions.find((session) => session.id === id);
    if (!target) return;

    invoke("kill_terminal", { id }).catch(() => {});

    const remaining = currentSessions.filter((session) => session.id !== id);
    const siblings = remaining.filter((session) => session.groupId === target.groupId);
    const nextActive =
      activeIdRef.current !== id
        ? activeIdRef.current
        : siblings[0]?.id ?? remaining[remaining.length - 1]?.id ?? null;

    disposeSessionResources(target);

    sessionsRef.current = remaining;
    activeIdRef.current = nextActive;
    setSessions(remaining);
    setActiveId(nextActive);
    setExpandedIdx(null);

    if (!nextActive) {
      setDiagOpen(false);
      setLastErrors([]);
    } else {
      focusSession(nextActive);
    }
  }, [disposeSessionResources, focusSession, setLastErrors]);

  const renameSession = useCallback((id: string) => {
    const session = sessionsRef.current.find((item) => item.id === id);
    if (!session) return;

    const nextTitle = prompt("Rename terminal", session.title);
    if (!nextTitle?.trim()) return;

    setSessions((prev) =>
      prev.map((item) => (item.id === id ? { ...item, title: nextTitle.trim() } : item))
    );
  }, []);

  const clearSession = useCallback((id: string) => {
    const session = sessionsRef.current.find((item) => item.id === id);
    if (!session) return;

    session.xterm.clear();
    invoke("write_to_terminal", { id, data: "\u000c" }).catch((error) => {
      console.error("Terminal clear failed:", error);
    });

    setSessions((prev) =>
      prev.map((item) =>
        item.id === id ? { ...item, lastError: null, detectedErrors: [] } : item
      )
    );

    if (activeIdRef.current === id) {
      setDiagOpen(false);
      setExpandedIdx(null);
      setLastErrors([]);
    }
  }, [setLastErrors]);

  useEffect(() => {
    createSession();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    return () => {
      Object.values(unlistenMap.current).forEach((fn) => fn());
      unlistenMap.current = {};
      sessionsRef.current.forEach((session) => {
        invoke("kill_terminal", { id: session.id }).catch(() => {});
        session.xterm.dispose();
        session.domEl.remove();
      });
    };
  }, []);

  useEffect(() => {
    layoutSessions();
  }, [layoutSessions, sessions, activeId]);

  useEffect(() => {
    if (!bodyRef.current) return;

    const observer = new ResizeObserver(() => {
      layoutSessions();
    });
    observer.observe(bodyRef.current);
    return () => observer.disconnect();
  }, [layoutSessions]);

  useEffect(() => {
    if (newTerminalRequest === 0) return;
    createSession();
  }, [createSession, newTerminalRequest]);

  useEffect(() => {
    if (splitTerminalRequest === 0) return;
    const sourceId = activeIdRef.current;
    createSession(sourceId ? { splitFromId: sourceId } : undefined);
  }, [createSession, splitTerminalRequest]);

  useEffect(() => {
    if (clearTerminalRequest === 0) return;
    if (activeIdRef.current) clearSession(activeIdRef.current);
  }, [clearSession, clearTerminalRequest]);

  useEffect(() => {
    if (closeActiveTerminalRequest === 0) return;
    if (activeIdRef.current) closeSession(activeIdRef.current);
  }, [closeActiveTerminalRequest, closeSession]);

  useEffect(() => {
    if (!queuedCommand) return;

    const writeQueuedCommand = async () => {
      let targetId = activeIdRef.current;
      if (!targetId) {
        targetId = await createSession();
      }
      if (!targetId) return;

      const targetSession = sessionsRef.current.find((session) => session.id === targetId);
      if (!targetSession?.ready) return;

      invoke("write_to_terminal", { id: targetId, data: `${queuedCommand.command}\r` })
        .catch((error) => {
          console.error("Queued terminal command failed:", error);
        })
        .finally(() => {
          clearQueuedCommand();
          focusSession(targetId!);
        });
    };

    writeQueuedCommand();
  }, [clearQueuedCommand, createSession, focusSession, queuedCommand, sessions]);

  const handleDebugClick = (errorStr: string) => {
    setActiveView("ai");
    if (!showAIPanel) toggleAIPanel();
    setAIMode("bug_hunt");
    const activeTab = tabs.find((tab) => tab.id === activeTabId);
    const fileCtx = activeTab
      ? `\n\n\`\`\`${activeTab.language}\n// ${activeTab.fileName}\n${activeTab.content.slice(0, 3000)}\n\`\`\``
      : "";
    setSessions((prev) =>
      prev.map((session) => (session.id === activeId ? { ...session, lastError: null } : session))
    );
    setTimeout(() => {
      sendMessage(
        `I encountered the following error in the terminal. Please help me fix it:${fileCtx}\n\nTerminal Output:\n\`\`\`\n${errorStr.slice(-2000)}\n\`\`\``
      );
    }, 100);
  };

  const runInTerminal = useCallback(async (cmd: string) => {
    let targetId = activeIdRef.current;
    if (!targetId) {
      targetId = await createSession();
    }
    if (!targetId) return;

    invoke("write_to_terminal", { id: targetId, data: `${cmd}\r` }).catch((error) => {
      console.error("Terminal run failed:", error);
    });
    focusSession(targetId);
  }, [createSession, focusSession]);

  const dismissDiag = () => {
    setDiagOpen(false);
    setSessions((prev) =>
      prev.map((session) =>
        session.id === activeId ? { ...session, detectedErrors: [], lastError: null } : session
      )
    );
    setLastErrors([]);
  };

  const activeEditorTab = tabs.find((tab) => tab.id === activeTabId);
  const runCmd = activeEditorTab
    ? getRunCommand(activeEditorTab.language, activeEditorTab.filePath, activeEditorTab.fileName)
    : null;

  const activeSession = sessions.find((session) => session.id === activeId) ?? null;
  const activeGroupSessions = activeSession
    ? sessions.filter((session) => session.groupId === activeSession.groupId)
    : [];
  const groupSizes = useMemo(
    () =>
      sessions.reduce<Record<string, number>>((acc, session) => {
        acc[session.groupId] = (acc[session.groupId] ?? 0) + 1;
        return acc;
      }, {}),
    [sessions]
  );

  const errors = activeSession?.detectedErrors ?? [];
  const errorCount = errors.filter((error) => error.severity === "error").length;
  const warnCount = errors.filter((error) => error.severity === "warning").length;
  const infoCount = errors.filter((error) => error.severity === "info").length;

  useEffect(() => {
    setLastErrors(activeSession?.detectedErrors ?? []);
    if (!activeSession?.detectedErrors.length) {
      setExpandedIdx(null);
    }
  }, [activeSession, setLastErrors]);

  return (
    <div className="terminal-container">
      <div className="terminal-header">
        <div className="terminal-tabs">
          {sessions.map((session) => {
            const groupSize = groupSizes[session.groupId] ?? 1;
            return (
              <div
                key={session.id}
                className={`terminal-tab ${activeId === session.id ? "active" : ""}`}
                onClick={() => activateSession(session.id)}
                onDoubleClick={() => renameSession(session.id)}
                title={`${session.title} — ${session.cwd}`}
              >
                <span className="terminal-tab-label">{session.title}</span>
                {groupSize > 1 && <span className="terminal-tab-badge">{groupSize} split</span>}
                {!session.ready && <span className="terminal-tab-status">…</span>}
                <button
                  onClick={(event) => {
                    event.stopPropagation();
                    closeSession(session.id);
                  }}
                  title="Kill terminal"
                >
                  <X size={10} />
                </button>
              </div>
            );
          })}
        </div>

        <div className="terminal-toolbar">
          <button className="terminal-toolbar-btn" onClick={() => createSession()} title="New terminal">
            <Plus size={12} />
          </button>
          <button
            className="terminal-toolbar-btn"
            onClick={() => createSession(activeId ? { splitFromId: activeId } : undefined)}
            title="Split terminal"
          >
            <SplitSquareVertical size={12} />
          </button>
          <button
            className="terminal-toolbar-btn"
            onClick={() => activeId && renameSession(activeId)}
            disabled={!activeId}
            title="Rename active terminal"
          >
            <SquarePen size={12} />
          </button>
          <button
            className="terminal-toolbar-btn"
            onClick={() => activeId && clearSession(activeId)}
            disabled={!activeId}
            title="Clear active terminal"
          >
            <Eraser size={12} />
          </button>
        </div>

        <div className="terminal-header-right">
          {activeGroupSessions.length > 1 && (
            <span className="terminal-split-summary">
              {activeGroupSessions.length} panes
            </span>
          )}
          {errors.length > 0 && (
            <button
              className={`terminal-diag-toggle ${diagOpen ? "active" : ""}`}
              onClick={() => setDiagOpen((open) => !open)}
              title="Toggle diagnostics panel"
            >
              {errorCount > 0 && (
                <span className="diag-badge error">
                  <AlertCircle size={10} />
                  {errorCount}
                </span>
              )}
              {warnCount > 0 && (
                <span className="diag-badge warn">
                  <AlertTriangle size={10} />
                  {warnCount}
                </span>
              )}
              {infoCount > 0 && (
                <span className="diag-badge info">
                  <Info size={10} />
                  {infoCount}
                </span>
              )}
              {diagOpen ? <ChevronDown size={11} /> : <ChevronUp size={11} />}
            </button>
          )}
          {runCmd && activeEditorTab && (
            <button
              className="terminal-run-file-btn"
              onClick={() => runInTerminal(runCmd)}
              title={`Run: ${runCmd}`}
            >
              <Play size={11} />
              <span>{activeEditorTab.fileName}</span>
            </button>
          )}
        </div>
      </div>

      {diagOpen && errors.length > 0 && (
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
                  <span className={`terminal-diag-sev-icon sev-${error.severity}`}>
                    {SEV_ICON[error.severity]}
                  </span>
                  <span className="terminal-diag-cat-icon" title={error.category}>
                    {categoryIcon(error.category)}
                  </span>
                  <span className="terminal-diag-lang">{error.language}</span>
                  <span className="terminal-diag-title-text">{error.title}</span>
                  {error.file && (
                    <span className="terminal-diag-loc">
                      {error.file.split("/").pop()}
                      {error.line ? `:${error.line}` : ""}
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
                        <button
                          className="terminal-diag-action-btn install"
                          onClick={() => runInTerminal(error.installCommand!)}
                          title={error.installCommand}
                        >
                          <Download size={11} />
                          <span>Install</span>
                          <code>{error.installCommand}</code>
                        </button>
                      )}
                      {error.updateCommand && (
                        <button
                          className="terminal-diag-action-btn update"
                          onClick={() => runInTerminal(error.updateCommand!)}
                          title={error.updateCommand}
                        >
                          <RefreshCw size={11} />
                          <span>Update</span>
                          <code>{error.updateCommand}</code>
                        </button>
                      )}
                      {error.uninstallCommand && (
                        <button
                          className="terminal-diag-action-btn uninstall"
                          onClick={() => runInTerminal(error.uninstallCommand!)}
                          title={error.uninstallCommand}
                        >
                          <Trash2 size={11} />
                          <span>Remove</span>
                          <code>{error.uninstallCommand}</code>
                        </button>
                      )}
                      {error.docsUrl && (
                        <a
                          className="terminal-diag-action-btn docs"
                          href={error.docsUrl}
                          target="_blank"
                          rel="noreferrer"
                          title="Open docs"
                        >
                          <ExternalLink size={11} />
                          <span>Docs</span>
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

      <div className="terminal-workbench">
        <div ref={bodyRef} className="terminal-body-host" />

        {sessions.length === 0 && (
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

        {activeSession?.lastError && !diagOpen && (
          <div className="terminal-debug-overlay">
            <button
              className="btn-primary terminal-debug-btn"
              onClick={() => handleDebugClick(activeSession.lastError!)}
            >
              <Bug size={13} /> Debug with AI
            </button>
            <button
              className="terminal-debug-dismiss"
              onClick={() =>
                setSessions((prev) =>
                  prev.map((session) =>
                    session.id === activeId ? { ...session, lastError: null } : session
                  )
                )
              }
              title="Dismiss"
            >
              <X size={10} />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
