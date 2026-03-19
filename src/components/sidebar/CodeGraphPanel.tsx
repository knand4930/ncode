// src/components/sidebar/CodeGraphPanel.tsx
import { useState, useEffect } from "react";
import { Network, RefreshCw, Eye, EyeOff } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { useEditorStore } from "../../store/editorStore";
import { useAIStore } from "../../store/aiStore";

interface CodeNode {
  id: string;
  label: string;
  type: "class" | "function" | "variable" | "method";
  file: string;
  line: number;
}

interface CodeEdge {
  from: string;
  to: string;
  type: "calls" | "inherits" | "uses";
}

export function CodeGraphPanel() {
  const { tabs, activeTabId } = useEditorStore();
  const { selectedProvider, selectedOllamaModels, selectedApiKeyIndices, apiKeys, aiServiceMode } = useAIStore();
  const [graphData, setGraphData] = useState<{ nodes: CodeNode[]; edges: CodeEdge[] } | null>(null);
  const [loading, setLoading] = useState(false);
  const [showGraph, setShowGraph] = useState(true);
  const [mermaidCode, setMermaidCode] = useState("");

  const generateGraph = async () => {
    if (!activeTabId) return;

    setLoading(true);
    try {
      const activeTab = tabs.find(tab => tab.id === activeTabId);
      if (!activeTab) return;

      const code = activeTab.content;
      if (!code) return;

      // Get active model
      const activeModels = [
        ...selectedOllamaModels.map((m) => ({ isApi: false, provider: "ollama" as const, model: m, apiKey: undefined })),
        ...selectedApiKeyIndices
          .map((i) => {
            const entry = apiKeys[i];
            if (!entry) return null;
            return { isApi: true, provider: entry.provider, model: entry.model, apiKey: entry.apiKey };
          })
          .filter((item): item is NonNullable<typeof item> => item !== null),
      ];

      if (activeModels.length === 0) {
        setMermaidCode("No AI models configured. Please set up a model in Settings.");
        return;
      }

      const am = activeModels[0]; // Use first available model

      // Use AI to analyze code and generate graph data
      const prompt = `Analyze this code and generate a Mermaid diagram showing the code structure. Include classes, functions, methods, and their relationships. Focus on call relationships and inheritance.

Code:
${code}

Please respond with a valid Mermaid flowchart or class diagram code only, no explanations.`;

      const messages = [
        { role: "system", content: "You are a code analysis assistant. Generate Mermaid diagrams for code structure visualization." },
        { role: "user", content: prompt }
      ];

      let response: string;
      if (aiServiceMode === "grpc") {
        response = await invoke<string>("grpc_ai_chat", {
          provider: am.provider,
          apiKey: am.apiKey,
          model: am.model,
          messages,
          temperature: 0.1, // Low temperature for consistent output
          maxTokens: 2000,
        });
      } else {
        // Fallback to direct API
        response = await invoke<string>("api_chat", {
          provider: am.provider,
          apiKey: am.apiKey,
          model: am.model,
          messages,
          temperature: 0.1,
          maxTokens: 2000,
        });
      }

      if (response) {
        // Extract Mermaid code from response
        const mermaidMatch = response.match(/```mermaid\n([\s\S]*?)\n```/);
        if (mermaidMatch) {
          setMermaidCode(mermaidMatch[1]);
        } else {
          // If no mermaid block, assume the whole response is mermaid
          setMermaidCode(response);
        }
      }
    } catch (error) {
      console.error("Failed to generate code graph:", error);
      setMermaidCode(`Error generating graph: ${error}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (activeTabId) {
      generateGraph();
    }
  }, [activeTabId]);

  return (
    <div className="sidebar">
      <div className="sidebar-header">
        <span className="sidebar-title">CODE GRAPH</span>
        <div className="sidebar-actions">
          <button
            title="Toggle Graph View"
            onClick={() => setShowGraph(!showGraph)}
          >
            {showGraph ? <Eye size={14} /> : <EyeOff size={14} />}
          </button>
          <button
            title="Refresh Graph"
            onClick={generateGraph}
            disabled={loading}
          >
            {loading ? <RefreshCw size={14} className="spin" /> : <Network size={14} />}
          </button>
        </div>
      </div>

      <div className="sidebar-content">
        {!activeTabId ? (
          <div className="sidebar-empty">
            <p>Open a file to see its code graph</p>
          </div>
        ) : loading ? (
          <div className="sidebar-loading">
            <RefreshCw className="spin" size={24} />
            <p>Analyzing code...</p>
          </div>
        ) : showGraph && mermaidCode ? (
          <div className="code-graph-container">
            <pre className="mermaid-code">
              <code>{mermaidCode}</code>
            </pre>
            <div className="graph-placeholder">
              <Network size={48} />
              <p>Graph visualization would render here</p>
              <small>Integration with Mermaid.js needed for rendering</small>
            </div>
          </div>
        ) : (
          <div className="sidebar-empty">
            <p>Graph hidden or no data available</p>
            <button className="btn-primary" onClick={() => setShowGraph(true)}>
              Show Graph
            </button>
          </div>
        )}
      </div>
    </div>
  );
}