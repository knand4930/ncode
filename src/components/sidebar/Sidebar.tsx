// src/components/sidebar/Sidebar.tsx
import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import {
  ChevronRight, ChevronDown, File, Folder, FolderOpen,
  RefreshCw, FolderPlus, Trash2, FileType2, Image, FileJson,
  FileCode2, FileText, Database, Settings
} from "lucide-react";
import { useEditorStore } from "../../store/editorStore";
import { useUIStore } from "../../store/uiStore";
import { useAIStore } from "../../store/aiStore";
import { SearchPanel } from "./SearchPanel";
import { SearchReplacePanel } from "./SearchReplacePanel";
import { SymbolSearchPanel } from "./SymbolSearchPanel";
import { KeyBindingsPanel } from "./KeyBindingsPanel";
import { ExtensionsPanel } from "../extensions/ExtensionsPanel";
import { GitPanel } from "./GitPanel";
import { TaskPanel } from "./TaskPanel";
import { AIReviewPanel } from "./AIReviewPanel";
import { CodeGraphPanel } from "./CodeGraphPanel";

interface FileEntry {
  name: string;
  path: string;
  is_dir: boolean;
  size: number;
  extension?: string;
  children?: FileEntry[];
}

function getFileIcon(name: string, iconTheme: string) {
  const ext = name.split('.').pop()?.toLowerCase() || '';
  const lowerName = name.toLowerCase();

  const isSimple = iconTheme === 'simple';
  const defaultColor = isSimple ? "var(--text-secondary)" : undefined;

  // Special files
  if (['package.json', 'tsconfig.json', 'biome.json'].includes(lowerName)) return <FileJson size={14} color={defaultColor || "#cb3837"} />;
  if ( lowerName === 'dockerfile' || lowerName.startsWith('docker-compose') ) return <Settings size={14} color={defaultColor || "#2496ed"} />;
  if ( lowerName.startsWith('.env') ) return <Settings size={14} color={defaultColor || "#f4db00"} />;

  // Extensions
  switch (ext) {
    case 'ts':
    case 'tsx':
      return <FileCode2 size={14} color={defaultColor || "#3178c6"} />;
    case 'js':
    case 'jsx':
      return <FileCode2 size={14} color={defaultColor || "#f7df1e"} />;
    case 'py':
      return <FileCode2 size={14} color={defaultColor || "#3776ab"} />;
    case 'rs':
      return <FileCode2 size={14} color={defaultColor || "#dea584"} />;
    case 'go':
      return <FileCode2 size={14} color={defaultColor || "#00add8"} />;
    case 'html':
      return <FileCode2 size={14} color={defaultColor || "#e34f26"} />;
    case 'css':
    case 'scss':
      return <FileCode2 size={14} color={defaultColor || "#1572b6"} />;
    case 'json':
      return <FileJson size={14} color={defaultColor || "#cb3837"} />;
    case 'md':
      return <FileText size={14} color={defaultColor || "#083fa1"} />;
    case 'png':
    case 'jpg':
    case 'jpeg':
    case 'gif':
    case 'svg':
    case 'ico':
      return <Image size={14} color={defaultColor || "#a074c4"} />;
    case 'sql':
    case 'db':
    case 'sqlite':
      return <Database size={14} color={defaultColor || "#e38c00"} />;
    default:
      return <File size={14} color="var(--text-secondary)" />;
  }
}

function getFolderIcon(name: string, isOpen: boolean, iconTheme: string) {
  const lowerName = name.toLowerCase();
  
  const isSimple = iconTheme === 'simple';
  const defaultColor = isSimple ? "var(--text-secondary)" : undefined;

  if (['node_modules', '.git', 'dist', 'build', '.idea', '.vscode'].includes(lowerName)) {
    return isOpen ? <FolderOpen size={14} color={defaultColor || "#888"} /> : <Folder size={14} color={defaultColor || "#888"} />;
  }
  if (['src', 'source', 'app'].includes(lowerName)) {
    return isOpen ? <FolderOpen size={14} color={defaultColor || "#1572b6"} /> : <Folder size={14} color={defaultColor || "#1572b6"} />;
  }
  if (['components', 'views', 'pages', 'ui'].includes(lowerName)) {
    return isOpen ? <FolderOpen size={14} color={defaultColor || "#4fc1ff"} /> : <Folder size={14} color={defaultColor || "#4fc1ff"} />;
  }
  
  return isOpen ? <FolderOpen size={14} color={defaultColor || "#dcb67a"} /> : <Folder size={14} color={defaultColor || "#dcb67a"} />;
}

function FileTree({
  entries,
  depth = 0,
  iconTheme,
  onRefresh,
}: {
  entries: FileEntry[];
  depth?: number;
  iconTheme: string;
  onRefresh: () => Promise<void> | void;
}) {
  const { openFile } = useEditorStore();
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; entry: FileEntry } | null>(null);

  const toggle = (path: string) => {
    setExpanded((s) => {
      const n = new Set(s);
      n.has(path) ? n.delete(path) : n.add(path);
      return n;
    });
  };

  return (
    <div>
      {entries.map((entry) => {
        const isOpen = expanded.has(entry.path);
        return (
          <div key={entry.path}>
            <div
              className="file-entry"
              style={{ paddingLeft: `${depth * 12 + 8}px` }}
              onClick={() => {
                if (entry.is_dir) toggle(entry.path);
                else openFile(entry.path);
              }}
              onContextMenu={(e) => {
                e.preventDefault();
                setContextMenu({ x: e.clientX, y: e.clientY, entry });
              }}
            >
              <span className="file-entry-chevron">
                {entry.is_dir ? isOpen ? <ChevronDown size={10} /> : <ChevronRight size={10} /> : <span style={{ width: 10 }}></span>}
              </span>
              <span className="file-entry-icon" style={{ display: 'flex', alignItems: 'center' }}>
                {entry.is_dir ? getFolderIcon(entry.name, isOpen, iconTheme) : getFileIcon(entry.name, iconTheme)}
              </span>
              <span className="file-entry-name" style={{ marginLeft: 4 }}>{entry.name}</span>
            </div>
            {entry.is_dir && isOpen && entry.children && (
              <FileTree entries={entry.children} depth={depth + 1} iconTheme={iconTheme} onRefresh={onRefresh} />
            )}
          </div>
        );
      })}

      {/* Context Menu */}
      {contextMenu && (
        <>
          <div className="context-menu-overlay" onClick={() => setContextMenu(null)} />
          <div className="context-menu" style={{ top: contextMenu.y, left: contextMenu.x }}>
            {contextMenu.entry.is_dir && (
              <>
                <button onClick={() => {
                  // New file in dir
                  const name = prompt("File name:");
                  if (name) {
                    invoke("create_file", { path: `${contextMenu.entry.path}/${name}`, isDir: false })
                      .then(() => onRefresh())
                      .catch((e) => console.error("Create file failed:", e));
                  }
                  setContextMenu(null);
                }}>New File</button>
                <button onClick={() => {
                  const name = prompt("Folder name:");
                  if (name) {
                    invoke("create_file", { path: `${contextMenu.entry.path}/${name}`, isDir: true })
                      .then(() => onRefresh())
                      .catch((e) => console.error("Create folder failed:", e));
                  }
                  setContextMenu(null);
                }}>New Folder</button>
              </>
            )}
            <button onClick={() => {
              const newName = prompt("Rename to:", contextMenu.entry.name);
              if (newName) {
                const sep = contextMenu.entry.path.includes("\\") ? "\\" : "/";
                const parent = contextMenu.entry.path.replace(/[\\/][^\\/]+$/, "");
                const newPath = `${parent}${sep}${newName}`;
                invoke("rename_file", { oldPath: contextMenu.entry.path, newPath })
                  .then(() => onRefresh())
                  .catch((e) => console.error("Rename failed:", e));
              }
              setContextMenu(null);
            }}>Rename</button>
            <button className="danger" onClick={() => {
              if (confirm(`Delete "${contextMenu.entry.name}"?`)) {
                invoke("delete_file", { path: contextMenu.entry.path })
                  .then(() => onRefresh())
                  .catch((e) => console.error("Delete failed:", e));
              }
              setContextMenu(null);
            }}><Trash2 size={12} /> Delete</button>
          </div>
        </>
      )}
    </div>
  );
}

export function Sidebar() {
  const { activeView, iconTheme } = useUIStore();
  const { openFolder, setOpenFolder } = useEditorStore();
  const { indexCodebase, isIndexing, setOpenFolder: setAIOpenFolder } = useAIStore();
  const [fileTree, setFileTree] = useState<FileEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>("");

  const loadFolder = async (path: string) => {
    setLoading(true);
    setError("");
    try {
      const entries = await invoke<FileEntry[]>("read_dir_recursive", { path, depth: 4 });
      setFileTree(entries);
    } catch (e) {
      console.error(e);
      setError(`Failed to open folder: ${String(e)}`);
    }
    setLoading(false);
  };

  const openFolderByPath = async (path: string) => {
    if (!path.trim()) return;
    setOpenFolder(path);
    setAIOpenFolder(path);
    await loadFolder(path);
  };

  const openFolderDialog = async () => {
    setError("");
    try {
      const selected = await open({ directory: true, multiple: false });
      if (!selected) return;

      if (typeof selected === "string") {
        await openFolderByPath(selected);
      }
    } catch (e) {
      console.error("Open folder dialog failed:", e);
      setError(`Folder picker failed: ${String(e)}`);
    }
  };

  const openFolderManual = async () => {
    const typed = prompt("Enter full folder path:");
    if (!typed) return;
    await openFolderByPath(typed);
  };

  useEffect(() => {
    if (openFolder) loadFolder(openFolder);
  }, [openFolder]);

  if (activeView === "search") return <SearchPanel />;
  if (activeView === "search-replace") return <SearchReplacePanel />;
  if (activeView === "symbols") return <SymbolSearchPanel />;
  if (activeView === "code-graph") return <CodeGraphPanel />;
  if (activeView === "keybindings") return <KeyBindingsPanel />;
  if (activeView === "git") return <GitPanel />;
  if (activeView === "extensions") return <ExtensionsPanel />;
  if (activeView === "tasks") return <TaskPanel />;
  if (activeView === "review") return <AIReviewPanel />;

  return (
    <div className="sidebar">
      <div className="sidebar-header">
        <span className="sidebar-title">
          {openFolder ? openFolder.split(/[\\/]/).pop()?.toUpperCase() : "EXPLORER"}
        </span>
        <div className="sidebar-actions">
          <button title="Open Folder" onClick={openFolderDialog}>
            <FolderPlus size={14} />
          </button>
          <button title="Open Folder By Path" onClick={openFolderManual}>
            <FolderOpen size={14} />
          </button>
          <button title="Refresh" onClick={() => openFolder && loadFolder(openFolder)}>
            <RefreshCw size={14} />
          </button>
          {openFolder && (
            <button
              title={isIndexing ? "Indexing..." : "Index for AI"}
              onClick={() => openFolder && indexCodebase(openFolder)}
              disabled={isIndexing}
            >
              {isIndexing ? <RefreshCw size={14} className="spin-icon" /> : <Database size={14} />}
            </button>
          )}
        </div>
      </div>

      <div className="sidebar-content">
        {error && (
          <div style={{ color: "var(--error)", fontSize: 12, padding: "8px 10px" }}>
            {error}
          </div>
        )}
        {!openFolder ? (
          <div className="sidebar-empty">
            <button className="btn-primary" onClick={openFolderDialog}>
              Open Folder
            </button>
            <button className="btn-sm" onClick={openFolderManual}>
              Open By Path
            </button>
            <p>or drag a folder here</p>
          </div>
        ) : loading ? (
          <div className="sidebar-loading">Loading...</div>
        ) : (
          <FileTree
            entries={fileTree}
            iconTheme={iconTheme}
            onRefresh={() => {
              if (openFolder) return loadFolder(openFolder);
            }}
          />
        )}
      </div>
    </div>
  );
}
