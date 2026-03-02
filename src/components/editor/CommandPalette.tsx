// src/components/editor/CommandPalette.tsx
import { useState, useEffect, useRef } from "react";
import { useEditorStore } from "../../store/editorStore";
import { useUIStore } from "../../store/uiStore";

interface Command {
  id: string;
  label: string;
  keybind?: string;
  action: () => void;
}

export function CommandPalette() {
  const {
    toggleCommandPalette,
    toggleTerminal,
    toggleAIPanel,
    setTheme,
    toggleSettingsPanel,
    setActiveView,
    toggleQuickOpen,
  } = useUIStore();
  const { saveAllFiles } = useEditorStore();
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const commands: Command[] = [
    { id: "save-all", label: "File: Save All", keybind: "Ctrl+Shift+S", action: saveAllFiles },
    { id: "quick-open", label: "File: Quick Open", keybind: "Ctrl+P", action: toggleQuickOpen },
    { id: "view-explorer", label: "View: Explorer", keybind: "Ctrl+Shift+E", action: () => setActiveView("explorer") },
    { id: "view-search", label: "View: Search", keybind: "Ctrl+Shift+F", action: () => setActiveView("search") },
    { id: "view-git", label: "View: Source Control", keybind: "Ctrl+Shift+G", action: () => setActiveView("git") },
    { id: "view-ext", label: "View: Extensions", keybind: "Ctrl+Shift+X", action: () => setActiveView("extensions") },
    { id: "toggle-terminal", label: "View: Toggle Terminal", keybind: "Ctrl+`", action: toggleTerminal },
    { id: "toggle-ai", label: "View: Toggle AI Panel", keybind: "Ctrl+Shift+A", action: toggleAIPanel },
    { id: "open-settings", label: "Preferences: Settings", keybind: "Ctrl+,", action: toggleSettingsPanel },
    { id: "theme-dark", label: "Preferences: Dark Theme", action: () => setTheme("dark") },
    { id: "theme-light", label: "Preferences: Light Theme", action: () => setTheme("light") },
  ];

  const filtered = query
    ? commands.filter((c) => c.label.toLowerCase().includes(query.toLowerCase()))
    : commands;

  useEffect(() => {
    inputRef.current?.focus();
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") toggleCommandPalette();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [toggleCommandPalette]);

  return (
    <div className="command-palette-overlay" onClick={toggleCommandPalette}>
      <div className="command-palette" onClick={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="> Type a command..."
          className="command-input"
        />
        <div className="command-list">
          {filtered.map((cmd) => (
            <button
              key={cmd.id}
              className="command-item"
              onClick={() => {
                cmd.action();
                toggleCommandPalette();
              }}
            >
              <span>{cmd.label}</span>
              {cmd.keybind && <kbd>{cmd.keybind}</kbd>}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
