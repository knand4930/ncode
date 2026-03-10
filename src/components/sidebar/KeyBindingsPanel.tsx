// src/components/sidebar/KeyBindingsPanel.tsx
import { useState } from "react";
import { Keyboard } from "lucide-react";

import { formatShortcut } from "../../utils/os";

const keybindings = [
  { category: "File", commands: [
    { name: "Save", keys: "Ctrl+S" },
    { name: "Save All", keys: "Ctrl+Shift+S" },
    { name: "Close Tab", keys: "Ctrl+W" },
  ]},
  { category: "Editor", commands: [
    { name: "Quick Open", keys: "Ctrl+P" },
    { name: "Command Palette", keys: "Ctrl+Shift+P" },
    { name: "Find & Replace", keys: "Ctrl+H" },
    { name: "Go to Symbol", keys: "Ctrl+T" },
    { name: "Toggle Comment", keys: "Ctrl+/" },
    { name: "Duplicate Line", keys: "Shift+Alt+Down" },
  ]},
  { category: "View", commands: [
    { name: "Explorer", keys: "Ctrl+Shift+E" },
    { name: "Search", keys: "Ctrl+Shift+F" },
    { name: "Source Control", keys: "Ctrl+Shift+G" },
    { name: "Extensions", keys: "Ctrl+Shift+X" },
    { name: "Toggle Sidebar", keys: "Ctrl+B" },
    { name: "Toggle Terminal", keys: "Ctrl+`" },
    { name: "Toggle AI Panel", keys: "Ctrl+Shift+A" },
    { name: "Settings", keys: "Ctrl+," },
  ]},
];

export function KeyBindingsPanel() {
  const [searchQuery, setSearchQuery] = useState("");

  const filteredBindings = keybindings
    .map((section) => ({
      ...section,
      commands: section.commands.filter(
        (cmd) =>
          cmd.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
          cmd.keys.toLowerCase().includes(searchQuery.toLowerCase())
      ),
    }))
    .filter((section) => section.commands.length > 0);

  return (
    <div className="sidebar">
      <div className="sidebar-header">
        <span className="sidebar-title">KEYBOARD SHORTCUTS</span>
      </div>
      <div style={{ padding: "8px 10px" }}>
        <div className="extensions-search" style={{ marginBottom: "12px" }}>
          <Keyboard size={13} />
          <input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search shortcuts..."
          />
        </div>

        <div>
          {filteredBindings.length > 0 ? (
            filteredBindings.map((section, idx) => (
              <div key={idx} style={{ marginBottom: "16px" }}>
                <div style={{ fontSize: "11px", color: "var(--text-muted)", fontWeight: 600, marginBottom: "8px", textTransform: "uppercase" }}>
                  {section.category}
                </div>
                {section.commands.map((cmd, i) => (
                  <div
                    key={i}
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      padding: "6px 8px",
                      fontSize: "12px",
                      borderBottom: "1px solid var(--border)",
                    }}
                  >
                    <span style={{ color: "var(--text-primary)" }}>{cmd.name}</span>
                    <kbd
                      style={{
                        background: "var(--bg-input)",
                        border: "1px solid var(--border)",
                        borderRadius: "3px",
                        padding: "2px 6px",
                        fontSize: "11px",
                        fontFamily: "monospace",
                        color: "var(--text-secondary)",
                      }}
                    >
                      {formatShortcut(cmd.keys)}
                    </kbd>
                  </div>
                ))}
              </div>
            ))
          ) : (
            <div style={{ color: "var(--text-muted)", padding: "16px", textAlign: "center" }}>
              No shortcuts found
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
