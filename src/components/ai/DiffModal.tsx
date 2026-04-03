import React, { useEffect } from "react";
import { DiffEditor } from "@monaco-editor/react";
import { ArrowRightLeft, Check, X } from "lucide-react";
import { inferLanguageFromPath } from "../../utils/aiSuggestionParser";

interface DiffReviewPaneProps {
  title: string;
  description?: string;
  sourcePath: string;
  originalContent: string;
  modifiedContent: string;
  onClose: () => void;
  onAccept?: () => void;
  onReject?: () => void;
  isAccepting?: boolean;
  acceptLabel?: string;
  rejectLabel?: string;
  note?: string;
}

export const DiffReviewPane: React.FC<DiffReviewPaneProps> = ({
  title,
  description,
  sourcePath,
  originalContent,
  modifiedContent,
  onClose,
  onAccept,
  onReject,
  isAccepting = false,
  acceptLabel = "Accept Changes",
  rejectLabel = "Reject Changes",
  note = "Accepted changes are tracked in Change History for full rollback.",
}) => {
  const language = inferLanguageFromPath(sourcePath);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      if ((event.ctrlKey || event.metaKey) && event.key === "Enter" && onAccept && !isAccepting) {
        event.preventDefault();
        onAccept();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [isAccepting, onAccept, onClose]);

  return (
    <div className="diff-review-pane">
      <div className="diff-review-header">
        <div className="diff-review-header-main">
          <div className="diff-review-title-row">
            <div className="diff-review-badge">
              <ArrowRightLeft size={14} />
              <span>Diff Review</span>
            </div>
            <h3 className="diff-review-title">{title}</h3>
          </div>
          <p className="diff-review-path" title={sourcePath}>{sourcePath}</p>
          {description && <p className="diff-review-description">{description}</p>}
        </div>

        <div className="diff-review-toolbar">
          <button
            onClick={onClose}
            className="diff-review-btn ghost"
            disabled={isAccepting}
            title="Close review"
          >
            <X size={16} />
            Close
          </button>
          {onReject && (
            <button
              onClick={onReject}
              className="diff-review-btn ghost danger"
              disabled={isAccepting}
            >
              <X size={16} />
              {rejectLabel}
            </button>
          )}
          {onAccept && (
            <button
              onClick={onAccept}
              disabled={isAccepting}
              className="diff-review-btn primary"
            >
              <Check size={16} />
              {isAccepting ? "Applying..." : acceptLabel}
            </button>
          )}
        </div>
      </div>

      <div className="diff-review-body">
        <DiffEditor
          original={originalContent}
          modified={modifiedContent}
          language={language}
          originalLanguage={language}
          modifiedLanguage={language}
          originalModelPath={sourcePath}
          modifiedModelPath={`${sourcePath}.review`}
          theme="vs-dark"
          height="100%"
          width="100%"
          options={{
            renderSideBySide: true,
            useInlineViewWhenSpaceIsLimited: true,
            readOnly: true,
            minimap: { enabled: false },
            wordWrap: "on",
            scrollBeyondLastLine: false,
            hideCursorInOverviewRuler: true,
            renderOverviewRuler: false,
            diffWordWrap: "on",
            automaticLayout: true,
          }}
        />
      </div>

      <div className="diff-review-footer">
        <span className="diff-review-meta">{note}</span>
        {onAccept && (
          <span className="diff-review-shortcut">
            <kbd>Ctrl/Cmd+Enter</kbd> to apply
          </span>
        )}
      </div>
    </div>
  );
};
