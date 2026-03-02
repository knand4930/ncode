// src/components/sidebar/SymbolSearchPanel.tsx
import { useState, useEffect, useRef } from "react";
import { Search } from "lucide-react";
import { useEditorStore } from "../../store/editorStore";

interface Symbol {
  name: string;
  type: "function" | "class" | "variable" | "constant";
  line: number;
  filePath: string;
}

export function SymbolSearchPanel() {
  const [query, setQuery] = useState("");
  const [symbols, setSymbols] = useState<Symbol[]>([]);
  const { tabs, openFile, setCursorPosition, activeTabId } = useEditorStore();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const extractSymbols = (): Symbol[] => {
    const extracted: Symbol[] = [];

    tabs.forEach((tab) => {
      const lines = tab.content.split("\n");
      
      lines.forEach((line, idx) => {
        // Function patterns
        const funcMatch = line.match(
          /(?:async\s+)?(?:function|const|let|var)\s+(\w+)\s*(?:\(|=\s*\()/
        );
        if (funcMatch) {
          extracted.push({
            name: funcMatch[1],
            type: "function",
            line: idx + 1,
            filePath: tab.filePath,
          });
        }

        // Class patterns
        const classMatch = line.match(/class\s+(\w+)/);
        if (classMatch) {
          extracted.push({
            name: classMatch[1],
            type: "class",
            line: idx + 1,
            filePath: tab.filePath,
          });
        }

        // Const patterns
        const constMatch = line.match(/const\s+(\w+)\s*=/);
        if (constMatch && !funcMatch) {
          extracted.push({
            name: constMatch[1],
            type: "constant",
            line: idx + 1,
            filePath: tab.filePath,
          });
        }
      });
    });

    return extracted;
  };

  useEffect(() => {
    const allSymbols = extractSymbols();

    if (!query.trim()) {
      setSymbols(allSymbols);
    } else {
      const filtered = allSymbols.filter((s) =>
        s.name.toLowerCase().includes(query.toLowerCase())
      );
      setSymbols(filtered);
    }
  }, [query, tabs]);

  const handleSelectSymbol = (symbol: Symbol) => {
    openFile(symbol.filePath);
    if (activeTabId) {
      setCursorPosition(activeTabId, symbol.line, 1);
    }
  };

  const typeIcons: Record<string, string> = {
    function: "ƒ",
    class: "C",
    variable: "v",
    constant: "k",
  };

  return (
    <div className="sidebar">
      <div className="sidebar-header">
        <span className="sidebar-title">SYMBOLS</span>
      </div>
      <div style={{ padding: "8px 10px" }}>
        <div className="extensions-search">
          <Search size={13} />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search symbols (Ctrl+T)..."
          />
        </div>
        <div style={{ marginTop: "8px" }}>
          {symbols.length > 0 ? (
            symbols.map((symbol, i) => (
              <div
                key={`${symbol.filePath}-${symbol.line}`}
                className="file-entry"
                style={{
                  paddingLeft: 8,
                  flexDirection: "column",
                  height: "auto",
                  padding: "6px 8px",
                  cursor: "pointer",
                }}
                onClick={() => handleSelectSymbol(symbol)}
              >
                <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                  <span
                    style={{
                      background: "#569cd6",
                      color: "white",
                      width: "20px",
                      height: "20px",
                      borderRadius: "3px",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: "10px",
                      fontWeight: "bold",
                    }}
                  >
                    {typeIcons[symbol.type]}
                  </span>
                  <span style={{ color: "var(--text-primary)", fontWeight: 500 }}>
                    {symbol.name}
                  </span>
                  <span style={{ color: "var(--text-muted)", fontSize: "11px", marginLeft: "auto" }}>
                    {symbol.type}
                  </span>
                </div>
                <span style={{ fontSize: 11, color: "var(--text-secondary)", marginTop: "3px" }}>
                  {symbol.filePath.split(/[\\/]/).pop()}:{symbol.line}
                </span>
              </div>
            ))
          ) : (
            <div style={{ color: "var(--text-muted)", padding: "8px", textAlign: "center" }}>
              No symbols found
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
