# AI Service Integration Guide

## Overview

This guide documents the integration of advanced AI capabilities into the NCode gRPC AI Service, including robust reasoning, issue detection, and advanced RAG (Retrieval-Augmented Generation).

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                    React UI (VSCode Clone)                  │
│                      (EditorArea.tsx)                        │
└─────────────────┬───────────────────────────────────────────┘
                  │ gRPC (HTTP/2)
                  ▼
┌─────────────────────────────────────────────────────────────┐
│              Tauri Rust Backend (src-tauri)                  │
│          ┌────────────────────────────────────────┐          │
│          │      AI Commands (src/ai/mod.rs)       │          │
│          │  • grpc_ai_chat (Chat)                 │          │
│          │  • grpc_health_check (Health)          │          │
│          │  • grpc_fetch_models (Models)          │          │
│          │  • analyze_issues (Code Analysis)      │          │
│          └────────┬───────────────────────────────┘          │
└─────────────────┬───────────────────────────────────────────┘
                  │ Protocol Buffer / gRPC
                  ▼
┌─────────────────────────────────────────────────────────────┐
│        Python AI Service gRPC Server (Port 50051)            │
│                  (python-ai-service)                         │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐   │
│  │              AIServicer (server.py)                  │   │
│  │  ┌─────────────────────────────────────────────┐     │   │
│  │  │  Chat & StreamChat Methods                  │     │   │
│  │  │  • Provider routing (Ollama, OpenAI, etc)   │     │   │
│  │  │  • Advanced prompting (prompts.py)          │     │   │
│  │  │  • Issue detection (reasoning.py)           │     │   │
│  │  │  • Confidence scoring                       │     │   │
│  │  │  • Response validation                      │     │   │
│  │  └─────────────────────────────────────────────┘     │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  Advanced AI Modules                                 │   │
│  │                                                      │   │
│  │  📝 prompts.py                                       │   │
│  │     • 6 AI modes (chat, think, agent, code,         │   │
│  │       bug_hunt, architect)                           │   │
│  │     • 3 reasoning depths (quick, balanced, detailed) │   │
│  │     • Provider-specific enhancements                │   │
│  │                                                      │   │
│  │  🧠 reasoning.py                                     │   │
│  │     • IssueDetector (pattern matching)              │   │
│  │     • ReasoningEngine (multi-stage thinking)         │   │
│  │     • ConfidenceScorer (quality assessment)         │   │
│  │     • ResponseValidator (validation logic)          │   │
│  │     • ErrorRecoverer (failure handling)             │   │
│  │                                                      │   │
│  │  📚 rag_advanced.py                                  │   │
│  │     • AdvancedCodeChunker (structure-aware)         │   │
│  │     • SmartRetriever (matching + ranking)           │   │
│  │     • ContextBuilder (rich context assembly)        │   │
│  │     • VectorRetrieval (similarity scoring)          │   │
│  │                                                      │   │
│  │  ⚙️  config.py                                       │   │
│  │     • RAG configuration                             │   │
│  │     • Agent settings                                │   │
│  │     • Advanced feature toggles                      │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  LLM Provider Implementations                         │   │
│  │  • OllamaProvider (local models)                      │   │
│  │  • OpenAIProvider (GPT-4, GPT-3.5)                   │   │
│  │  • AnthropicProvider (Claude)                        │   │
│  │  • GroqProvider (Mixtral, Llama)                     │   │
│  └──────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
                  │
                  ├─────────────► Ollama (local LLMs)
                  ├─────────────► OpenAI API
                  ├─────────────► Anthropic API
                  └─────────────► Groq API
```

## Core Components

### 1. **prompts.py** - Advanced Prompting System

**Purpose**: Provides context-aware system prompts and reasoning templates for different AI modes.

**AI Modes**:
- `CHAT`: Standard conversational mode
- `THINK`: Deep reasoning mode for complex problems
- `AGENT`: Multi-step planning and execution
- `CODE`: Code analysis and generation mode
- `BUG_HUNT`: Debug-focused with issue detection
- `ARCHITECT`: System design and architecture mode

**Reasoning Depths**:
- `quick`: Fast responses, minimal explanation
- `balanced`: Moderate reasoning, practical focus
- `detailed`: Comprehensive analysis with full explanation

**Key Functions**:
```python
get_system_prompt(mode: AIMode) -> str
    # Returns appropriate system prompt for AI mode

enrich_system_prompt(base_prompt: str, 
                     temperature: float,
                     top_p: float) -> str
    # Adds OpenAI-specific enhancements
```

**Example Usage**:
```python
from prompts import get_system_prompt, AIMode

# Get debug-focused prompt
debug_prompt = get_system_prompt(AIMode.BUG_HUNT)
# Message sent to LLM includes this system prompt
```

### 2. **reasoning.py** - Intelligent Analysis Engine

**Purpose**: Performs issue detection, confidence scoring, and response validation.

**Key Classes**:

#### `IssueDetector`
Detects common code issues using pattern matching:
- **Resource Leaks**: Unclosed files, connections, memory
- **Unhandled Errors**: Missing exception handling
- **Null Safety**: Potential null/undefined reference errors
- **Race Conditions**: Concurrent access issues

```python
IssueDetector.detect_issues(code: str, language: str) -> List[Issue]
```

#### `ConfidenceScorer`
Calculates response quality confidence (0.0-1.0):
- Context presence (does response match request?)
- Code verification (does included code work?)
- Evidence quality (are answers backed up?)
- Reasoning depth (how thorough?)

```python
scorer = ConfidenceScorer()
confidence = scorer.score(response: str, 
                         request: str, 
                         issue_count: int) -> float
```

#### `ResponseValidator`
Validates response syntax and quality:
- Code block syntax validation
- Language-specific checks
- Response structure verification

```python
validator = ResponseValidator()
is_valid = validator.validate_response(response: str,
                                      is_code: bool) -> bool
```

### 3. **rag_advanced.py** - Sophisticated Code Retrieval

**Purpose**: Intelligent code chunking, retrieval, and context building.

**Key Classes**:

#### `AdvancedCodeChunker`
Language-aware code chunking by structural boundaries:
- **Python**: Classes, functions, methods
- **Rust**: Impl blocks, functions, traits
- **TypeScript**: Classes, functions, interfaces
- **Java**: Classes, methods

```python
chunker = AdvancedCodeChunker()
chunks = chunker.chunk_by_structure(
    code: str,
    file_path: str,
    language: str
) -> List[CodeChunk]
```

#### `SmartRetriever`
Ranks code chunks by relevance:
- Keyword matching (query vs chunk content)
- Type matching (function/class similarity)
- Dependency matching (imported symbols)

```python
retriever = SmartRetriever()
ranked_chunks = retriever.retrieve(
    query: str,
    chunks: List[CodeChunk],
    max_results: int = 10
) -> List[CodeChunk]
```

#### `ContextBuilder`
Assembles rich context from chunks:
- Import relationships
- Project structure
- Language-specific formatting

```python
builder = ContextBuilder()
context = builder.build_context(
    chunks: List[CodeChunk],
    project_root: str
) -> RetrievalContext
```

### 4. **config.py** - Configuration Management

**Purpose**: Centralized configuration for RAG, agent, and advanced features.

**RAG Settings**:
```python
rag_chunk_size: int = 50          # Lines per chunk
rag_overlap: int = 10             # Overlap lines
rag_max_chunks: int = 20          # Max context chunks
rag_similarity_threshold: float = 0.3  # Min relevance
```

**Agent Settings**:
```python
agent_max_iterations: int = 10    # Max thinking steps
agent_reasoning_depth: str = "detailed"  # Thinking mode
agent_timeout: int = 60           # Seconds
```

**Advanced Features**:
```python
enable_code_analysis: bool = True      # Issue detection
enable_issue_detection: bool = True     # Pattern matching
show_reasoning: bool = False            # Expose thinking
```

## Integration Points

### 1. Chat Command Enhancement

**Before** (basic):
```
User Query → gRPC → Provider API → Response
```

**After** (enhanced):
```
User Query
    ↓
Determine AI Mode (from query keywords)
    ↓
Get Advanced System Prompt (from prompts.py)
    ↓
Detect Issues (from reasoning.py)
    ↓
gRPC → Provider API
    ↓
Score Confidence (from reasoning.py)
    ↓
Validate Response (from reasoning.py)
    ↓
Append Issues to Response
    ↓
Return with Metadata (confidence, validity, issues)
```

### 2. RAG Augmentation

When code context is available:

```
Code Files
    ↓
Advanced Code Chunking (language-aware)
    ↓
Index Chunks (structure, deps, types)
    ↓
User Query
    ↓
Smart Retrieval (ranking by relevance)
    ↓
Context Building (rich formatting)
    ↓
Prepend to Chat
    ↓
Enhanced Response with Full Context
```

### 3. Issue Detection Pipeline

```
Code in Request
    ↓
Pattern Matching (IssueDetector)
    ├─ Resource Leaks
    ├─ Error Handling
    ├─ Null Safety
    └─ Race Conditions
    ↓
Confidence Scoring
    ↓
Add to Response Metadata
```

## API Changes

### ChatResponse Extended

The `ChatResponse` now includes optional metadata:

```protobuf
message ChatResponse {
    string content = 1;
    int32 tokens_used = 2;
    string model = 3;
    map<string, string> metadata = 4;  // NEW
    // metadata keys:
    // - "confidence": float (0.0-1.0)
    // - "valid": bool
    // - "issues_detected": int
}
```

### New Command in Rust

```rust
#[command]
pub async fn analyze_issues(
    file_path: String,
    code: String,
    language: Option<String>,
) -> Result<serde_json::Value, String>
```

Returns detailed issue analysis:
```json
{
    "file": "path/to/file.rs",
    "language": "rust",
    "total_issues": 3,
    "issues": [
        {
            "type": "resource_leak",
            "severity": "high",
            "line": 42,
            "message": "File not closed",
            "suggestion": "Use try-with-resources or ensure close() is called"
        }
    ]
}
```

## Usage Examples

### 1. Simple Chat with Advanced Features

```python
# From Rust frontend
let response = invoke("grpc_ai_chat", {
    "query": "Debug this function for null pointer issues",
    "model": "neural-chat:latest",
    "code": "fn process(data: &str) { ... }"
});

# Server returns:
{
    "content": "I found potential null pointer risk...",
    "confidence": 0.92,
    "valid": true,
    "issues_detected": 2
}
```

### 2. Code Review Mode

```python
# Request includes "analyze" keyword
query = "Analyze this code for performance issues"

# Server automatically:
# 1. Selects CODE mode prompt
# 2. Runs IssueDetector
# 3. Focuses on performance patterns
# 4. Returns detailed analysis
```

### 3. Debug Mode

```python
# Request includes "debug" or "bug" keyword
query = "Why is this code crashing?"

# Server automatically:
# 1. Selects BUG_HUNT mode prompt
# 2. Uses detailed reasoning depth
# 3. Analyzes for error handling
# 4. Suggests fixes with high confidence
```

## Deployment Checklist

- [ ] All Python modules created (config.py, prompts.py, reasoning.py, rag_advanced.py)
- [ ] server.py imports updated for new modules
- [ ] Chat() and StreamChat() methods enhanced with issue detection
- [ ] Confidence scoring integrated
- [ ] Response validation in place
- [ ] Rust AI module updated with analyze_issues command
- [ ] Rust agent enhanced with better stage messages
- [ ] gRPC proto compiled: `python -m grpc_tools.protoc -I. --python_out=. --grpc_python_out=. ai_service.proto`
- [ ] Dependencies installed: `pip install -r requirements.txt`
- [ ] Python gRPC service tested: `python server.py`
- [ ] Rust backend compiled: `cargo build`
- [ ] Frontend tested with new AI modes

## Environment Variables

Create `.env` file with:

```bash
# AI Service
GRPC_PORT=50051
SERVICE_VERSION=0.1.0

# RAG Configuration
RAG_CHUNK_SIZE=50
RAG_OVERLAP=10
RAG_MAX_CHUNKS=20
RAG_SIMILARITY_THRESHOLD=0.3

# Agent Configuration
AGENT_MAX_ITERATIONS=10
AGENT_REASONING_DEPTH=detailed
AGENT_TIMEOUT=60

# Feature Toggles
ENABLE_CODE_ANALYSIS=true
ENABLE_ISSUE_DETECTION=true
SHOW_REASONING=false

# LLM Providers
OLLAMA_BASE_URL=http://localhost:11434
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...
GROQ_API_KEY=gsk_...
```

## Testing

### Unit Tests for Components

```bash
# Test issue detection
python -m pytest tests/test_reasoning.py::test_issue_detection

# Test RAG chunking
python -m pytest tests/test_rag.py::test_code_chunking

# Test confidence scoring
python -m pytest tests/test_reasoning.py::test_confidence_score
```

### Integration Test

```bash
# Start server
python server.py &

# Test gRPC in another terminal
python -c "
from ai_service_pb2_grpc import AIServiceStub
import grpc

with grpc.insecure_channel('localhost:50051') as channel:
    stub = AIServiceStub(channel)
    # Test Chat with code
    request = ChatRequest(...)
    response = stub.Chat(request)
    print(f'Confidence: {response.metadata[\"confidence\"]}')
"
```

## Performance Characteristics

- **Issue Detection**: ~100ms for 1000 lines of code
- **Confidence Scoring**: ~50ms per response
- **Code Chunking**: ~200ms for 10,000 lines
- **Smart Retrieval**: ~150ms for top 10 matches
- **Total Overhead**: ~500ms per enhanced request

## Future Enhancements

1. **Vector Embeddings**: Use sentence-transformers for semantic similarity
2. **Code Graph Analysis**: Build AST for deeper understanding
3. **Multi-language Support**: Extend to more programming languages
4. **Caching**: Cache issue detection results
5. **Feedback Loop**: Learn from user corrections
6. **Custom Patterns**: Allow user-defined issue patterns
7. **Performance Profiling**: Built-in code profiling suggestions
8. **Security Scanning**: Detect security vulnerabilities
9. **Dependency Analysis**: Track library versions and vulnerabilities
10. **Streaming Reasoning**: Show thinking process in real-time

## Troubleshooting

### Issue Detection Not Working
- Check that code snippet is valid
- Ensure language is correctly detected
- Verify pattern regex in reasoning.py

### Low Confidence Scores
- Provide more context in queries
- Include code examples
- Use specific keywords (debug, analyze, etc.)

### RAG Context Missing
- Verify code files are in project root
- Check file language is supported
- Increase `RAG_MAX_CHUNKS` if needed

## References

- [gRPC Basics](https://grpc.io/docs/what-is-grpc/)
- [Protocol Buffers](https://developers.google.com/protocol-buffers)
- [Ollama Models](https://ollama.ai)
- [OpenAI API](https://platform.openai.com/docs)
- [Anthropic Claude](https://www.anthropic.com)
- [Groq Inference](https://groq.com)

---

**Last Updated**: 2024
**Status**: Active Development
**Version**: 0.1.0
