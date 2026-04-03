import { useEffect, useState } from "react";
import { ShieldAlert, Play, AlertTriangle, AlertCircle, Info, CheckCircle2 } from "lucide-react";
import { useEditorStore } from "../../store/editorStore";
import { useTerminalStore } from "../../store/terminalStore";
import { analyzeFileContent, type DetectedError } from "../../utils/errorParser";

type IssueSeverity = "critical" | "high" | "medium" | "low";

interface CodeIssue {
  type: string;
  severity: IssueSeverity;
  line: number;
  message: string;
  suggestion?: string;
}

interface AnalysisResult {
  file: string;
  language: string;
  total_issues: number;
  issues: CodeIssue[];
}

function matchesFile(error: DetectedError, filePath: string): boolean {
  if (!error.file) return false;
  const normalizedError = error.file.replace(/\\/g, "/");
  const normalizedFile = filePath.replace(/\\/g, "/");
  return (
    normalizedError === normalizedFile ||
    normalizedFile.endsWith(normalizedError) ||
    normalizedError.endsWith(normalizedFile) ||
    normalizedError.endsWith(`/${normalizedFile.split("/").pop() ?? normalizedFile}`)
  );
}

function mapSeverity(error: DetectedError): IssueSeverity {
  if (error.category === "security") return "critical";
  if (error.severity === "error") return "high";
  if (error.severity === "warning") return "medium";
  return "low";
}

function toCodeIssue(error: DetectedError): CodeIssue {
  const parts = [error.title, error.detail].filter(Boolean);
  return {
    type: error.category,
    severity: mapSeverity(error),
    line: error.line ?? 1,
    message: parts.join(parts.length > 1 ? ": " : ""),
    suggestion: error.suggestion ?? error.installCommand ?? error.updateCommand,
  };
}

export function AIReviewPanel() {
  const { tabs, activeTabId } = useEditorStore();
  const { lastErrors } = useTerminalStore();
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const activeTab = tabs.find((t) => t.id === activeTabId);

  useEffect(() => {
    setResult(null);
    setError(null);
  }, [activeTabId]);

  const runAnalysis = async () => {
    if (!activeTab) return;
    setLoading(true);
    setError(null);
    try {
      const staticIssues = analyzeFileContent(activeTab.content, activeTab.language, activeTab.filePath);
      const terminalIssues = lastErrors.filter((issue) => matchesFile(issue, activeTab.filePath));
      const mergedIssues = [...terminalIssues, ...staticIssues]
        .filter((issue, index, all) => {
          const key = `${issue.category}:${issue.title}:${issue.file ?? activeTab.filePath}:${issue.line ?? 0}`;
          return all.findIndex((candidate) => {
            const candidateKey = `${candidate.category}:${candidate.title}:${candidate.file ?? activeTab.filePath}:${candidate.line ?? 0}`;
            return candidateKey === key;
          }) === index;
        })
        .sort((left, right) => {
          const severityRank = { critical: 0, high: 1, medium: 2, low: 3 };
          return (
            severityRank[mapSeverity(left)] - severityRank[mapSeverity(right)] ||
            (left.line ?? 0) - (right.line ?? 0) ||
            left.title.localeCompare(right.title)
          );
        })
        .map(toCodeIssue);

      setResult({
        file: activeTab.filePath,
        language: activeTab.language,
        total_issues: mergedIssues.length,
        issues: mergedIssues,
      });
    } catch (e) {
      setError(`Review scan failed: ${String(e)}`);
    } finally {
      setLoading(false);
    }
  };

  const getSeverityColor = (sev: IssueSeverity) => {
    switch (sev) {
      case "critical": return "text-red-500 bg-red-500/10 border-red-500/20";
      case "high": return "text-orange-500 bg-orange-500/10 border-orange-500/20";
      case "medium": return "text-yellow-500 bg-yellow-500/10 border-yellow-500/20";
      case "low": return "text-blue-400 bg-blue-400/10 border-blue-400/20";
    }
  };

  const getSeverityIcon = (sev: IssueSeverity) => {
    switch (sev) {
      case "critical": return <ShieldAlert size={14} className="text-red-500" />;
      case "high": return <AlertTriangle size={14} className="text-orange-500" />;
      case "medium": return <AlertCircle size={14} className="text-yellow-500" />;
      case "low": return <Info size={14} className="text-blue-400" />;
    }
  };

  if (!activeTab) {
    return (
      <div className="sidebar-panel p-4 flex flex-col items-center justify-center text-center text-gray-400 h-full">
        <ShieldAlert size={32} className="mb-3 opacity-20" />
        <p>Open a file to run AI Security & Performance Analysis</p>
      </div>
    );
  }

  return (
    <div className="sidebar-panel flex flex-col h-full bg-[#1e1e1e] text-gray-200">
      <div className="p-4 border-b border-gray-800 flex items-center justify-between">
        <h2 className="text-sm font-semibold flex items-center gap-2">
          <ShieldAlert size={16} className="text-purple-400" />
          Code Review
        </h2>
        <button
          onClick={runAnalysis}
          disabled={loading}
          className="btn-sm btn-primary flex items-center gap-1"
        >
          {loading ? (
            <div className="animate-spin w-3 h-3 border-2 border-white/20 border-t-white rounded-full" />
          ) : (
            <Play size={12} fill="currentColor" />
          )}
          {loading ? "Scanning..." : "Scan File"}
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-4">
        {error && (
          <div className="p-3 text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded">
            {error}
          </div>
        )}

        {!result && !loading && !error && (
          <div className="text-center text-xs text-gray-500 mt-10">
            Click "Scan File" to analyze <code>{activeTab.fileName}</code> for vulnerabilities, performance regressions, and syntax errors.
          </div>
        )}

        {result && (
          <div className="animate-in fade-in slide-in-from-bottom-2 duration-300">
            <div className="mb-4 flex items-center justify-between text-xs text-gray-400">
              <span>Found {result.total_issues} issue{result.total_issues === 1 ? '' : 's'}</span>
              {result.total_issues === 0 && (
                <span className="flex items-center gap-1 text-green-400">
                  <CheckCircle2 size={12} /> Passed
                </span>
              )}
            </div>

            <div className="flex flex-col gap-3">
              {result.issues.map((issue, idx) => (
                <div 
                  key={idx} 
                  className={`border rounded p-3 text-xs ${getSeverityColor(issue.severity)} flex flex-col gap-2`}
                >
                  <div className="flex items-start gap-2 justify-between">
                    <div className="flex items-center gap-2 font-semibold">
                      {getSeverityIcon(issue.severity)}
                      <span className="capitalize">{issue.type.replace('_', ' ')}</span>
                    </div>
                    <span className="opacity-70 font-mono">Line {issue.line}</span>
                  </div>
                  <p className="text-gray-300 leading-relaxed">{issue.message}</p>
                  {issue.suggestion && (
                    <div className="mt-1 pt-2 border-t border-white/10 text-gray-400">
                      <span className="font-semibold text-gray-300">Suggestion:</span> {issue.suggestion}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
