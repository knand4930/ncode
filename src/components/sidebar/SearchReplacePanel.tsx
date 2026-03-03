// src/components/sidebar/SearchReplacePanel.tsx
import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Search, Replace } from "lucide-react";
import { useEditorStore } from "../../store/editorStore";

interface DirEntry {
  name: string;
  path: string;
  is_dir: boolean;
  size: number;
  children?: DirEntry[];
}

interface SearchTarget {
  file: string;
  filePath: string;
  content: string;
  tabId?: string;
}

const MAX_FILE_SIZE_BYTES = 300_000;
const MAX_FILES = 1500;
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

export function SearchReplacePanel() {
  const [searchQuery, setSearchQuery] = useState("");
  const [replaceQuery, setReplaceQuery] = useState("");
  const [isRegex, setIsRegex] = useState(false);
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [results, setResults] = useState<
    Array<{ file: string; filePath: string; line: number; text: string; matches: number }>
  >([]);
  const { tabs, openFolder, updateContent, saveFile } = useEditorStore();

  const getTargets = async (): Promise<SearchTarget[]> => {
    if (!openFolder) {
      return tabs.map((tab) => ({
        file: tab.fileName,
        filePath: tab.filePath,
        content: tab.content,
        tabId: tab.id,
      }));
    }

    const entries = await invoke<DirEntry[]>("read_dir_recursive", { path: openFolder, depth: 8 });
    const files = flattenFiles(entries)
      .filter((f) => f.size <= MAX_FILE_SIZE_BYTES && isSearchableFile(f.name))
      .slice(0, MAX_FILES);

    const tabByPath = new Map(
      tabs.map((tab) => [
        tab.filePath,
        { file: tab.fileName, filePath: tab.filePath, content: tab.content, tabId: tab.id } satisfies SearchTarget,
      ])
    );

    const targets: SearchTarget[] = [];
    for (const file of files) {
      const openTab = tabByPath.get(file.path);
      if (openTab) {
        targets.push(openTab);
        continue;
      }
      const content = await invoke<string>("read_file", { path: file.path });
      targets.push({
        file: file.name,
        filePath: file.path,
        content,
      });
    }
    return targets;
  };

  const buildRegex = (): RegExp => {
    const flags = caseSensitive ? "g" : "gi";
    const pattern = isRegex
      ? searchQuery
      : searchQuery.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(pattern, flags);
  };

  const search = async () => {
    if (!searchQuery.trim()) return;
    setLoading(true);
    setError("");

    const found: Record<
      string,
      { file: string; filePath: string; line: number; text: string; matches: number }
    > = {};

    try {
      const targets = await getTargets();
      targets.forEach((target) => {
        const lines = target.content.split("\n");
        const key = target.filePath;

        lines.forEach((line, idx) => {
          const matches = line.match(buildRegex());
          if (matches) {
            if (!found[key]) {
              found[key] = {
                file: target.file,
                filePath: target.filePath,
                line: idx + 1,
                text: line.trim(),
                matches: 0,
              };
            }
            found[key].matches += matches.length;
          }
        });
      });
    } catch (e) {
      setError(`Search failed: ${String(e)}`);
      alert("Invalid regex pattern or failed to scan workspace");
      setLoading(false);
      return;
    }

    setResults(Object.values(found));
    setLoading(false);
  };

  const replaceAll = async () => {
    if (!searchQuery.trim()) return;
    setLoading(true);
    setError("");

    try {
      const targets = await getTargets();
      let replacedFiles = 0;
      let replacedMatches = 0;

      for (const target of targets) {
        const matches = target.content.match(buildRegex());
        const matchCount = matches?.length || 0;
        if (!matchCount) continue;

        const newContent = target.content.replace(buildRegex(), replaceQuery);
        if (target.tabId) {
          updateContent(target.tabId, newContent);
          await saveFile(target.tabId);
        } else {
          await invoke("write_file", { path: target.filePath, content: newContent });
        }

        replacedFiles += 1;
        replacedMatches += matchCount;
      }

      if (replacedFiles > 0) {
        alert(`Replaced ${replacedMatches} match(es) in ${replacedFiles} file(s)`);
      } else {
        alert("No matches found to replace");
      }
    } catch (e) {
      setError(`Replace failed: ${String(e)}`);
      alert("Invalid regex pattern or replace failed");
      setLoading(false);
      return;
    }
    setLoading(false);
    await search();
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
            onKeyDown={(e) => e.key === "Enter" && search()}
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
            onKeyDown={(e) => e.key === "Enter" && replaceAll()}
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

        <div style={{ fontSize: "11px", color: "var(--text-muted)", marginBottom: "8px" }}>
          {openFolder ? "Scope: workspace" : "Scope: open files"}
        </div>
        {loading && (
          <div style={{ color: "var(--text-secondary)", fontSize: 12, marginBottom: 8 }}>
            Working...
          </div>
        )}
        {error && (
          <div style={{ color: "var(--error)", fontSize: 12, marginBottom: 8 }}>
            {error}
          </div>
        )}

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
