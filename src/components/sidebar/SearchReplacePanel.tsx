// src/components/sidebar/SearchReplacePanel.tsx
import { useState } from "react";
import { Search, Replace, ChevronDown } from "lucide-react";
import { useEditorStore } from "../../store/editorStore";

export function SearchReplacePanel() {
  const [searchQuery, setSearchQuery] = useState("");
  const [replaceQuery, setReplaceQuery] = useState("");
  const [isRegex, setIsRegex] = useState(false);
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [results, setResults] = useState<
    Array<{ file: string; filePath: string; line: number; text: string; matches: number }>
  >([]);
  const { tabs, updateContent } = useEditorStore();

  const search = () => {
    if (!searchQuery.trim()) return;

    const found: Record<
      string,
      { file: string; filePath: string; line: number; text: string; matches: number }
    > = {};

    const flags = caseSensitive ? "g" : "gi";
    let regex: RegExp;

    try {
      regex = new RegExp(isRegex ? searchQuery : searchQuery.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), flags);
    } catch {
      alert("Invalid regex pattern");
      return;
    }

    tabs.forEach((tab) => {
      const lines = tab.content.split("\n");
      const key = tab.filePath;

      let totalMatches = 0;
      lines.forEach((line, idx) => {
        const matches = line.match(regex);
        if (matches) {
          totalMatches += matches.length;
          if (!found[key]) {
            found[key] = {
              file: tab.fileName,
              filePath: tab.filePath,
              line: idx + 1,
              text: line.trim(),
              matches: 0,
            };
          }
          found[key].matches += matches.length;
        }
      });
    });

    setResults(Object.values(found));
  };

  const replaceAll = () => {
    if (!searchQuery.trim() || !replaceQuery.trim()) return;

    const flags = caseSensitive ? "g" : "gi";
    let regex: RegExp;

    try {
      regex = new RegExp(isRegex ? searchQuery : searchQuery.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), flags);
    } catch {
      alert("Invalid regex pattern");
      return;
    }

    tabs.forEach((tab) => {
      const newContent = tab.content.replace(regex, replaceQuery);
      if (newContent !== tab.content) {
        updateContent(tab.id, newContent);
      }
    });

    alert(`Replacements completed in ${results.length} file(s)`);
    search();
  };

  return (
    <div className="sidebar">
      <div className="sidebar-header">
        <span className="sidebar-title">SEARCH & REPLACE</span>
      </div>
      <div style={{ padding: "8px 10px" }}>
        {/* Search Box */}
        <div className="extensions-search" style={{ marginBottom: "8px" }}>
          <Search size={13} />
          <input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search..."
            style={{ flex: 1 }}
          />
        </div>

        {/* Replace Box */}
        <div className="extensions-search" style={{ marginBottom: "8px" }}>
          <Replace size={13} />
          <input
            value={replaceQuery}
            onChange={(e) => setReplaceQuery(e.target.value)}
            placeholder="Replace..."
            style={{ flex: 1 }}
          />
        </div>

        {/* Options */}
        <div style={{ display: "flex", gap: "6px", marginBottom: "8px", flexWrap: "wrap" }}>
          <button
            className={`search-option ${isRegex ? "active" : ""}`}
            onClick={() => setIsRegex(!isRegex)}
            title="Use Regular Expression"
          >
            .*
          </button>
          <button
            className={`search-option ${caseSensitive ? "active" : ""}`}
            onClick={() => setCaseSensitive(!caseSensitive)}
            title="Match Case"
          >
            Aa
          </button>
        </div>

        {/* Buttons */}
        <div style={{ display: "flex", gap: "6px", marginBottom: "12px" }}>
          <button className="btn-primary btn-sm" onClick={search} style={{ flex: 1 }}>
            Find All
          </button>
          <button className="btn-primary btn-sm" onClick={replaceAll} style={{ flex: 1 }}>
            Replace All
          </button>
        </div>

        {/* Results */}
        {results.length > 0 && (
          <div>
            <div style={{ fontSize: "12px", color: "var(--text-secondary)", marginBottom: "8px" }}>
              {results.reduce((sum, r) => sum + r.matches, 0)} matches in {results.length} file(s)
            </div>
            {results.map((r, i) => (
              <div
                key={i}
                className="file-entry"
                style={{ paddingLeft: 8, flexDirection: "column", height: "auto", padding: "4px 8px" }}
              >
                <span style={{ color: "var(--accent)", fontSize: 11 }}>
                  {r.file} • {r.matches} matches
                </span>
                <span style={{ fontSize: 12, color: "var(--text-secondary)", fontFamily: "var(--font-mono)" }}>
                  Line {r.line}: {r.text.slice(0, 60)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
