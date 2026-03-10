import React from "react";
import { DiffEditor } from "@monaco-editor/react";
import { X, Check } from "lucide-react";

interface DiffModalProps {
  isOpen: boolean;
  onClose: () => void;
  originalPath: string;
  originalContent: string;
  modifiedContent: string;
  onAccept: () => void;
  onReject: () => void;
  isAccepting?: boolean;
}

export const DiffModal: React.FC<DiffModalProps> = ({
  isOpen,
  onClose,
  originalPath,
  originalContent,
  modifiedContent,
  onAccept,
  onReject,
  isAccepting = false,
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-gray-900 border border-gray-700 shadow-2xl rounded-lg w-11/12 max-w-6xl h-5/6 flex flex-col overflow-hidden">
        
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-800 bg-gray-950">
          <div className="flex flex-col">
            <h3 className="text-lg font-semibold text-gray-200">Review AI Changes</h3>
            <span className="text-xs text-gray-400 font-mono mt-1">{originalPath}</span>
          </div>
          <button
            onClick={onClose}
            className="p-1 hover:bg-gray-800 rounded transition"
            title="Close Preview"
          >
            <X size={20} className="text-gray-400" />
          </button>
        </div>

        {/* Diff Content */}
        <div className="flex-1 bg-gray-950/50 p-2">
          <DiffEditor
            original={originalContent}
            modified={modifiedContent}
            theme="vs-dark"
            options={{
              renderSideBySide: true,
              readOnly: true,
              minimap: { enabled: false },
              wordWrap: "on",
              scrollBeyondLastLine: false,
              hideCursorInOverviewRuler: true,
            }}
          />
        </div>

        {/* Footer Actions */}
        <div className="flex items-center justify-end gap-3 p-4 border-t border-gray-800 bg-gray-950">
          <button
            onClick={onReject}
            className="px-4 py-2 text-sm font-medium text-gray-300 hover:text-white bg-gray-800 hover:bg-gray-700 rounded transition flex items-center gap-2"
          >
            <X size={16} />
            Reject Changes
          </button>
          <button
            onClick={onAccept}
            disabled={isAccepting}
            className={`px-4 py-2 text-sm font-medium rounded transition flex items-center gap-2 ${
              isAccepting 
                ? "bg-blue-600/50 text-blue-200 cursor-not-allowed" 
                : "bg-blue-600 hover:bg-blue-500 text-white"
            }`}
          >
            <Check size={16} />
            {isAccepting ? "Applying..." : "Accept Changes"}
          </button>
        </div>
      </div>
    </div>
  );
};
