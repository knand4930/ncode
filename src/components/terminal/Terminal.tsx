// src/components/terminal/Terminal.tsx
import { useEffect, useRef, useState } from "react";
import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Plus, X, Bug } from "lucide-react";
import { useEditorStore } from "../../store/editorStore";
import { useUIStore } from "../../store/uiStore";
import { useAIStore } from "../../store/aiStore";
import "@xterm/xterm/css/xterm.css";

interface TerminalSession {
  id: string;
  title: string;
  xterm: XTerm;
  fitAddon: FitAddon;
  lastError?: string | null;
}

export function Terminal() {
  const [sessions, setSessions] = useState<TerminalSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const unlistenMap = useRef<Record<string, () => void>>({});
  const sessionsRef = useRef<TerminalSession[]>([]);
  const { openFolder, tabs, activeTabId } = useEditorStore();
  const { setActiveView, toggleAIPanel, showAIPanel } = useUIStore();
  const { setAIMode, sendMessage } = useAIStore();

  useEffect(() => {
    sessionsRef.current = sessions;
  }, [sessions]);

  const createSession = async () => {
    const id = `term-${Date.now()}`;

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
    });

    const fitAddon = new FitAddon();
    const webLinksAddon = new WebLinksAddon();
    xterm.loadAddon(fitAddon);
    xterm.loadAddon(webLinksAddon);

    const session: TerminalSession = {
      id,
      title: `bash`,
      xterm,
      fitAddon,
    };

    setSessions((s) => [...s, session]);
    setActiveSessionId(id);

    // Create backend PTY
    try {
      await invoke("create_terminal", {
        id,
        cwd: openFolder || process.env.HOME || "/",
      });

      const buffer: string[] = [];
      let currentLine = "";

      const unlisten = await listen<string>(`terminal-output-${id}`, (event) => {
        xterm.write(event.payload);

        // Strip ANSI escape codes for cleaner error detection
        const raw = event.payload.replace(/\x1b\[[0-9;]*m/g, "");
        for (let i = 0; i < raw.length; i++) {
          if (raw[i] === '\n' || raw[i] === '\r') {
            if (currentLine.trim()) {
              buffer.push(currentLine);
              if (buffer.length > 50) buffer.shift(); // Keep last 50 lines for context

              // Basic heuristic for common error patterns
              const isError = /error[ :]|exception|traceback|fail|panic/i.test(currentLine);
              const isIgnored = /debug|info|warn|notice/i.test(currentLine);

              if (isError && !isIgnored) {
                // Throttle updates to avoid state thrashing on giant error dumps
                setTimeout(() => {
                  setSessions((prev) => prev.map(s =>
                    s.id === id ? { ...s, lastError: buffer.join("\n") } : s
                  ));
                }, 100);
              }
            }
            currentLine = "";
          } else {
            currentLine += raw[i];
          }
        }
      });
      unlistenMap.current[id] = unlisten;
    } catch (e) {
      xterm.writeln("\r\n\x1b[31mFailed to create terminal session\x1b[0m");
      xterm.writeln("Tauri terminal plugin required");
    }

    // Send input to backend
    xterm.onData((data) => {
      invoke("write_to_terminal", { id, data });
    });
  };

  // Mount terminal when active changes
  useEffect(() => {
    const session = sessions.find((s) => s.id === activeSessionId);
    if (!session || !containerRef.current) return;

    const el = containerRef.current.querySelector(".terminal-body");
    if (!el) return;

    session.xterm.open(el as HTMLElement);
    session.fitAddon.fit();

    // Throttle resize with rAF to prevent layout thrashing
    let rafId: number | null = null;
    const observer = new ResizeObserver(() => {
      if (rafId !== null) cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        session.fitAddon.fit();
        rafId = null;
      });
    });
    observer.observe(el as Element);

    return () => {
      observer.disconnect();
      if (rafId !== null) cancelAnimationFrame(rafId);
    };
  }, [activeSessionId, sessions]);

  // Start with one session
  useEffect(() => {
    createSession();
    return () => {
      Object.values(unlistenMap.current).forEach((fn) => fn());
      unlistenMap.current = {};
      sessionsRef.current.forEach((s) => s.xterm.dispose());
    };
  }, []);

  const closeSession = (id: string) => {
    invoke("kill_terminal", { id }).catch(() => { });

    if (unlistenMap.current[id]) {
      unlistenMap.current[id]();
      delete unlistenMap.current[id];
    }

    setSessions((prev) => {
      const removed = prev.find((s) => s.id === id);
      removed?.xterm.dispose();
      const remaining = prev.filter((t) => t.id !== id);
      setActiveSessionId((current) => {
        if (current !== id) return current;
        return remaining[remaining.length - 1]?.id || null;
      });
      return remaining;
    });
  };

  const handleDebugClick = (errorStr: string) => {
    setActiveView("ai");
    if (!showAIPanel) toggleAIPanel();
    setAIMode("bug_hunt");

    const activeTab = tabs.find(t => t.id === activeTabId);
    const fileContext = activeTab ? `\n\n\`\`\`${activeTab.language}\n// ${activeTab.fileName}\n${activeTab.content.slice(0, 3000)}\n\`\`\`` : "";

    // Clear the error so the button disappears after clicking
    setSessions(s => s.map(session => session.id === activeSessionId ? { ...session, lastError: null } : session));

    setTimeout(() => {
      sendMessage(`I encountered the following error in the terminal. Please help me fix it:${fileContext}\n\nTerminal Output:\n\`\`\`\n${errorStr.slice(-2000)}\n\`\`\``);
    }, 100);
  };

  const activeSession = sessions.find(s => s.id === activeSessionId);

  return (
    <div className="terminal-container">
      <div className="terminal-header">
        <div className="terminal-tabs">
          {sessions.map((s) => (
            <div
              key={s.id}
              className={`terminal-tab ${activeSessionId === s.id ? "active" : ""}`}
              onClick={() => setActiveSessionId(s.id)}
            >
              <span>⌨ {s.title}</span>
              <button onClick={(e) => { e.stopPropagation(); closeSession(s.id); }}>
                <X size={10} />
              </button>
            </div>
          ))}
          <button className="terminal-new" onClick={createSession} title="New terminal">
            <Plus size={13} />
          </button>
        </div>
      </div>
      <div className="terminal-body-container" style={{ position: "relative", flex: 1, height: "100%", overflow: "hidden" }}>
        <div className="terminal-body" ref={containerRef as any} style={{ height: "100%" }} />

        {activeSession?.lastError && (
          <div style={{
            position: "absolute",
            bottom: "20px",
            right: "20px",
            zIndex: 10,
            animation: "slideInRight 0.3s cubic-bezier(0.16, 1, 0.3, 1)"
          }}>
            <button
              className="btn-primary"
              style={{ display: "flex", alignItems: "center", gap: "6px", boxShadow: "0 4px 12px rgba(0,0,0,0.5)" }}
              onClick={() => handleDebugClick(activeSession.lastError!)}
            >
              <Bug size={14} />
              Debug with AI
            </button>
            <button
              style={{
                position: "absolute", top: "-8px", right: "-8px", background: "var(--bg-panel)",
                border: "1px solid var(--border)", borderRadius: "50%", padding: "2px",
                color: "var(--text-muted)", cursor: "pointer"
              }}
              onClick={() => setSessions(s => s.map(session => session.id === activeSessionId ? { ...session, lastError: null } : session))}
            >
              <X size={10} />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
