// src/components/sidebar/SearchPanel.tsx
import { useState } from "react";
import { Search } from "lucide-react";
import { useEditorStore } from "../../store/editorStore";

interface SearchResult {
  filePath: string;
  fileName: string;
  line: number;
  text: string;
}

export function SearchPanel() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const { tabs, openFile } = useEditorStore();

  const search = () => {
    if (!query.trim()) return;
    const found: SearchResult[] = [];
    
    tabs.forEach((tab) => {
      tab.content.split("\n").forEach((line, idx) => {
        if (line.toLowerCase().includes(query.toLowerCase())) {
          found.push({ filePath: tab.filePath, fileName: tab.fileName, line: idx + 1, text: line.trim() });
        }
      });
    });
    
    setResults(found);
  };

  return (
    <div className="sidebar">
      <div className="sidebar-header">
        <span className="sidebar-title">SEARCH</span>
      </div>
      <div style={{ padding: "8px 10px" }}>
        <div className="extensions-search">
          <Search size={13} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && search()}
            placeholder="Search in open files..."
          />
        </div>
        {results.length > 0 && (
          <div>
            {results.map((r, i) => (
              <div
                key={i}
                className="file-entry"
                style={{ paddingLeft: 8, flexDirection: "column", height: "auto", padding: "4px 8px" }}
                onClick={() => openFile(r.filePath)}
              >
                <span style={{ color: "var(--accent)", fontSize: 11 }}>{r.fileName}:{r.line}</span>
                <span style={{ fontSize: 12, color: "var(--text-secondary)", fontFamily: "var(--font-mono)" }}>
                  {r.text.slice(0, 60)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
