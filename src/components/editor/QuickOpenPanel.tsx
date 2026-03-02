// src/components/editor/QuickOpenPanel.tsx
import { useState, useEffect, useMemo, useRef } from "react";
import { Search, ChevronRight } from "lucide-react";
import { useEditorStore } from "../../store/editorStore";
import { useUIStore } from "../../store/uiStore";
import { invoke } from "@tauri-apps/api/core";
import Fuse from "fuse.js";

interface FileItem {
  name: string;
  path: string;
  type: "file";
  source?: "open" | "recent" | "project";
}

interface DirEntry {
  name: string;
  path: string;
  is_dir: boolean;
  children?: DirEntry[];
}

export function QuickOpenPanel() {
  const { tabs, openFile, openFolder, recentFiles } = useEditorStore();
  const { toggleQuickOpen } = useUIStore();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<FileItem[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [projectFiles, setProjectFiles] = useState<FileItem[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!openFolder) {
      setProjectFiles([]);
      return;
    }

    const flatten = (entries: DirEntry[]): FileItem[] => {
      const out: FileItem[] = [];
      for (const e of entries) {
        if (e.is_dir) {
          if (e.children?.length) out.push(...flatten(e.children));
        } else {
          out.push({
            name: e.name,
            path: e.path,
            type: "file",
            source: "project",
          });
        }
      }
      return out;
    };

    invoke<DirEntry[]>("read_dir_recursive", { path: openFolder, depth: 8 })
      .then((entries) => setProjectFiles(flatten(entries)))
      .catch(() => setProjectFiles([]));
  }, [openFolder]);

  // Convert tabs to searchable files
  const files: FileItem[] = useMemo(
    () =>
      tabs.map((t) => ({
        name: t.fileName,
        path: t.filePath,
        type: "file",
        source: "open",
      })),
    [tabs]
  );

  const recentItems = useMemo<FileItem[]>(
    () =>
      recentFiles
        .filter((p) => !tabs.some((t) => t.filePath === p))
        .map((p) => ({
          name: p.split(/[\\/]/).pop() || p,
          path: p,
          type: "file",
          source: "recent",
        })),
    [recentFiles, tabs]
  );

  const allFiles = useMemo<FileItem[]>(() => {
    const merged = [...files, ...recentItems, ...projectFiles];
    const seen = new Set<string>();
    return merged.filter((f) => {
      if (seen.has(f.path)) return false;
      seen.add(f.path);
      return true;
    });
  }, [files, projectFiles, recentItems]);

  const fuse = useMemo(
    () =>
      new Fuse(allFiles, {
        keys: ["name", "path"],
        threshold: 0.3,
        minMatchCharLength: 1,
      }),
    [allFiles]
  );

  useEffect(() => {
    if (!query.trim()) {
      const openItems = allFiles.filter((f) => f.source === "open");
      const recent = allFiles.filter((f) => f.source === "recent");
      const project = allFiles.filter((f) => f.source === "project");
      setResults([...openItems, ...recent, ...project].slice(0, 30));
    } else {
      const searchResults = fuse.search(query).map((r) => r.item);
      setResults(searchResults.slice(0, 20));
    }
    setSelectedIndex(0);
  }, [allFiles, query, fuse]);

  useEffect(() => {
    inputRef.current?.focus();
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") toggleQuickOpen();
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((i) => Math.min(i + 1, results.length - 1));
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((i) => Math.max(i - 1, 0));
      }
      if (e.key === "Enter" && results.length > 0) {
        e.preventDefault();
        openFile(results[selectedIndex].path);
        toggleQuickOpen();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [toggleQuickOpen, results, selectedIndex, openFile]);

  return (
    <div className="command-palette-overlay" onClick={toggleQuickOpen}>
      <div className="command-palette" onClick={(e) => e.stopPropagation()}>
        <div className="quick-open-header">
          <Search size={16} />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Open file (Ctrl+P)..."
            className="command-input"
          />
        </div>
        <div className="quick-open-results">
          {results.length > 0 ? (
            results.map((file, idx) => (
              <button
                key={file.path}
                className={`quick-open-item ${idx === selectedIndex ? "selected" : ""}`}
                onClick={() => {
                  openFile(file.path);
                  toggleQuickOpen();
                }}
              >
                <span className="quick-open-icon">📄</span>
                <div className="quick-open-info">
                  <div className="quick-open-name">
                    {file.name}
                    {file.source === "recent" ? " • recent" : file.source === "open" ? " • open" : ""}
                  </div>
                  <div className="quick-open-path">{file.path}</div>
                </div>
                <ChevronRight size={14} />
              </button>
            ))
          ) : (
            <div className="quick-open-empty">No files found</div>
          )}
        </div>
      </div>
    </div>
  );
}
