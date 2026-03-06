// src/components/ErrorBoundary.tsx
import { Component, type ReactNode, type ErrorInfo } from "react";

interface Props {
    children: ReactNode;
    fallbackLabel?: string;
}

interface State {
    hasError: boolean;
    error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
    constructor(props: Props) {
        super(props);
        this.state = { hasError: false, error: null };
    }

    static getDerivedStateFromError(error: Error): State {
        return { hasError: true, error };
    }

    componentDidCatch(error: Error, info: ErrorInfo) {
        console.error(`[ErrorBoundary] ${this.props.fallbackLabel || "Component"} crashed:`, error, info);
    }

    render() {
        if (this.state.hasError) {
            return (
                <div
                    style={{
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "center",
                        justifyContent: "center",
                        height: "100%",
                        gap: "12px",
                        padding: "24px",
                        color: "#858585",
                        fontSize: "13px",
                        fontFamily: "'Inter', system-ui, sans-serif",
                        background: "#1e1e1e",
                    }}
                >
                    <div style={{ fontSize: "32px" }}>⚠️</div>
                    <div style={{ fontWeight: 600, color: "#cccccc" }}>
                        {this.props.fallbackLabel || "Component"} crashed
                    </div>
                    <div style={{ color: "#6b6b6b", maxWidth: "300px", textAlign: "center" }}>
                        {this.state.error?.message || "An unexpected error occurred"}
                    </div>
                    <button
                        onClick={() => this.setState({ hasError: false, error: null })}
                        style={{
                            background: "#007acc",
                            color: "white",
                            border: "none",
                            borderRadius: "4px",
                            padding: "6px 16px",
                            cursor: "pointer",
                            fontSize: "12px",
                            transition: "background 0.15s",
                        }}
                        onMouseOver={(e) => (e.currentTarget.style.background = "#1a85d6")}
                        onMouseOut={(e) => (e.currentTarget.style.background = "#007acc")}
                    >
                        Try Again
                    </button>
                </div>
            );
        }

        return this.props.children;
    }
}
