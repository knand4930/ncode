// src/components/sidebar/SearchPanel.tsx
import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Search } from "lucide-react";
import { useEditorStore } from "../../store/editorStore";

interface SearchResult {
  filePath: string;
  fileName: string;
  line: number;
  text: string;
}

interface DirEntry {
  name: string;
  path: string;
  is_dir: boolean;
  size: number;
  children?: DirEntry[];
}

const MAX_FILE_SIZE_BYTES = 300_000;
const MAX_FILES = 1500;
const MAX_RESULTS = 500;
const SEARCHABLE_EXTENSIONS = new Set([
  "ts", "tsx", "js", "jsx", "mjs", "cjs", "json", "md", "css", "scss", "less",
  "html", "xml", "yaml", "yml", "toml", "ini", "conf", "env", "txt", "sql",
  "py", "rs", "go", "java", "kt", "swift", "c", "cc", "cpp", "h", "hpp",
  "sh", "bash", "zsh", "ps1", "rb", "php", "vue", "svelte", "graphql",
]);

function isSearchableFile(name: string): boolean {
  const normalized = name.toLowerCase();
  if (normalized === "dockerfile" || normalized === "makefile") return true;
  const ext = normalized.split(".").pop() || "";
  return SEARCHABLE_EXTENSIONS.has(ext);
}

function flattenFiles(entries: DirEntry[], out: DirEntry[] = []): DirEntry[] {
  for (const entry of entries) {
    if (entry.is_dir) {
      if (entry.children?.length) flattenFiles(entry.children, out);
      continue;
    }
    out.push(entry);
  }
  return out;
}

export function SearchPanel() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const { tabs, openFolder, openFileAt } = useEditorStore();

  const search = async () => {
    if (!query.trim()) return;
    setLoading(true);
    setError("");
    const found: SearchResult[] = [];
    const lowered = query.toLowerCase();

    const findMatches = (filePath: string, fileName: string, content: string) => {
      const lines = content.split("\n");
      for (let idx = 0; idx < lines.length; idx += 1) {
        const line = lines[idx];
        if (line.toLowerCase().includes(lowered)) {
          found.push({
            filePath,
            fileName,
            line: idx + 1,
            text: line.trim(),
          });
          if (found.length >= MAX_RESULTS) return;
        }
      }
    };

    try {
      if (!openFolder) {
        tabs.forEach((tab) => {
          if (found.length >= MAX_RESULTS) return;
          findMatches(tab.filePath, tab.fileName, tab.content);
        });
      } else {
        const entries = await invoke<DirEntry[]>("read_dir_recursive", { path: openFolder, depth: 8 });
        const files = flattenFiles(entries)
          .filter((f) => f.size <= MAX_FILE_SIZE_BYTES && isSearchableFile(f.name))
          .slice(0, MAX_FILES);

        const tabContent = new Map(tabs.map((tab) => [tab.filePath, tab.content]));
        for (const file of files) {
          if (found.length >= MAX_RESULTS) break;
          const content = tabContent.has(file.path)
            ? tabContent.get(file.path)!
            : await invoke<string>("read_file", { path: file.path });
          findMatches(file.path, file.name, content);
        }
      }
    } catch (e) {
      console.error("Search failed:", e);
      setError(`Search failed: ${String(e)}`);
    }

    setResults(found);
    setLoading(false);
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
            placeholder={openFolder ? "Search in workspace..." : "Search in open files..."}
          />
        </div>
        <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 8 }}>
          {openFolder ? "Workspace search" : "Open files only"}
        </div>
        {loading && (
          <div style={{ color: "var(--text-secondary)", fontSize: 12, marginBottom: 8 }}>
            Searching...
          </div>
        )}
        {error && (
          <div style={{ color: "var(--error)", fontSize: 12, marginBottom: 8 }}>
            {error}
          </div>
        )}
        {!loading && query.trim() && (
          <div style={{ color: "var(--text-muted)", fontSize: 11, marginBottom: 8 }}>
            {results.length} result(s)
          </div>
        )}
        {results.length > 0 && (
          <div>
            {results.map((r, i) => (
              <div
                key={i}
                className="file-entry"
                style={{ paddingLeft: 8, flexDirection: "column", height: "auto", padding: "4px 8px" }}
                onClick={() => openFileAt(r.filePath, r.line, 1)}
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
