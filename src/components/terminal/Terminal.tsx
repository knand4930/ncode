// src/components/terminal/Terminal.tsx
import { useEffect, useRef, useState } from "react";
import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Plus, X } from "lucide-react";
import { useEditorStore } from "../../store/editorStore";
import "@xterm/xterm/css/xterm.css";

interface TerminalSession {
  id: string;
  title: string;
  xterm: XTerm;
  fitAddon: FitAddon;
}

export function Terminal() {
  const [sessions, setSessions] = useState<TerminalSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const unlistenMap = useRef<Record<string, () => void>>({});
  const sessionsRef = useRef<TerminalSession[]>([]);
  const { openFolder } = useEditorStore();

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

      const unlisten = await listen<string>(`terminal-output-${id}`, (event) => {
        xterm.write(event.payload);
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

    const observer = new ResizeObserver(() => session.fitAddon.fit());
    observer.observe(el as Element);

    return () => observer.disconnect();
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
    invoke("kill_terminal", { id }).catch(() => {});

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
      <div className="terminal-body" ref={containerRef as any} />
    </div>
  );
}
