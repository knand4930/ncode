import { memo } from "react";
import { useEditorStore } from "../../store/editorStore";
import { useReviewStore } from "../../store/reviewStore";

export const EditorBreadcrumbs = memo(function EditorBreadcrumbs() {
  const { tabs, activeTabId, openFolder } = useEditorStore();
  const { activeDiffReview } = useReviewStore();
  const activeTab = tabs.find((t) => t.id === activeTabId);

  if (activeDiffReview) {
    const normalizedPath = activeDiffReview.sourcePath.replace(/\\/g, "/");
    const relativePath = openFolder
      ? normalizedPath.replace(openFolder.replace(/\\/g, "/"), "").replace(/^\/+/, "")
      : normalizedPath;
    const parts = relativePath.split("/").filter(Boolean);

    return (
      <div className="editor-breadcrumbs" title={activeDiffReview.sourcePath}>
        <span className="editor-breadcrumb-badge">{activeDiffReview.title}</span>
        {parts.map((part, idx) => (
          <span key={`${part}-${idx}`} className="editor-breadcrumb-part">
            <span className="editor-breadcrumb-sep">/</span>
            <span>{part}</span>
          </span>
        ))}
      </div>
    );
  }

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
});
