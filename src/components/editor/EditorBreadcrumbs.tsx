import { useEditorStore } from "../../store/editorStore";

export function EditorBreadcrumbs() {
  const { tabs, activeTabId, openFolder } = useEditorStore();
  const activeTab = tabs.find((t) => t.id === activeTabId);

  if (!activeTab) return null;

  const normalizedPath = activeTab.filePath.replace(/\\/g, "/");
  const relativePath = openFolder
    ? normalizedPath.replace(openFolder.replace(/\\/g, "/"), "").replace(/^\/+/, "")
    : normalizedPath;
  const parts = relativePath.split("/").filter(Boolean);

  return (
    <div className="editor-breadcrumbs" title={activeTab.filePath}>
      {parts.length === 0 ? (
        <span>{activeTab.fileName}</span>
      ) : (
        parts.map((part, idx) => (
          <span key={`${part}-${idx}`} className="editor-breadcrumb-part">
            {idx > 0 && <span className="editor-breadcrumb-sep">/</span>}
            <span>{part}</span>
          </span>
        ))
      )}
    </div>
  );
}
