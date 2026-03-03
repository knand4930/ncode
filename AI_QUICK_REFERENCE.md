# Quick Reference: AI Service Usage

## Command: `grpc_ai_chat`

Send a question to the AI service with automatic mode detection and issue analysis.

### Syntax
```rust
invoke("grpc_ai_chat", {
    "query": "Your question or code review request",
    "code": "Optional: code snippet to analyze", // Optional
    "model": "neural-chat:latest",               // Or gpt-4, claude-3-sonnet, etc
    "provider": "ollama",                        // ollama, openai, anthropic, groq
    "temperature": 0.7,                          // 0.0-1.0
    "max_tokens": 2000,                          // Response length limit
})
```

### Automatic Mode Detection

The system automatically detects your intent from keywords:

| Keyword | Mode | Effect |
|---------|------|--------|
| "debug", "bug", "crash" | BUG_HUNT | Focus on finding issues |
| "analyze", "review", "check" | CODE | Deep code analysis |
| "think", "reason", "explain" | THINK | Multi-step reasoning |
| "design", "architect", "plan" | ARCHITECT | High-level design |
| "code", "implement", "generate" | CODE | Code generation |
| Default (no keyword) | CHAT | Standard chat |

### Response Format

```json
{
    "content": "Main response text here...",
    "tokens_used": 150,
    "model": "neural-chat:latest",
    "metadata": {
        "confidence": "0.92",
        "valid": "true",
        "issues_detected": "2"
    }
}
```

### Examples

#### Example 1: Bug Detection
```typescript
// Frontend code
const response = await invoke("grpc_ai_chat", {
    query: "Why is this causing a null pointer error?",
    code: `function getValue(obj) {
        return obj.data.value;  // Can crash if data is null
    }`,
    model: "neural-chat:latest",
    provider: "ollama"
});

// Returns:
{
    content: "The function doesn't check if 'obj' or 'obj.data' are null...",
    metadata: {
        confidence: "0.95",      // High confidence in diagnosis
        issues_detected: "1"     // 1 issue found
    }
}
```

#### Example 2: Code Review
```typescript
const response = await invoke("grpc_ai_chat", {
    query: "Review this for performance issues",
    code: `function processItems(items) {
        for (let i = 0; i < items.length; i++) {
            for (let j = 0; j < items.length; j++) {
                // O(n²) operation
            }
        }
    }`,
    model: "gpt-4",
    provider: "openai",
    temperature: 0.5
});

// Returns detailed analysis with confidence and issues
```

#### Example 3: Architecture Question
```typescript
const response = await invoke("grpc_ai_chat", {
    query: "Design a caching layer for our service",
    model: "claude-3-sonnet",
    provider: "anthropic"
});

// System automatically selects ARCHITECT mode
// Returns architectural recommendations
```

---

## Command: `analyze_issues`

Perform deep code analysis without an LLM call (faster, deterministic).

### Syntax
```rust
invoke("analyze_issues", {
    "file_path": "src/main.rs",
    "code": "fn main() { ... }",
    "language": "rust"  // Optional: auto-detect if not provided
})
```

### Response Format

```json
{
    "file": "src/main.rs",
    "language": "rust",
    "total_issues": 3,
    "issues": [
        {
            "type": "resource_leak",
            "severity": "high",
            "line": 42,
            "message": "File opened but not closed",
            "suggestion": "Use 'with' statement or ensure close() is called"
        },
        {
            "type": "error_handling",
            "severity": "medium",
            "line": 55,
            "message": "Await without try-catch",
            "suggestion": "Wrap in try-catch for error handling"
        }
    ]
}
```

### Issue Types

| Type | Severity | Examples |
|------|----------|----------|
| `resource_leak` | HIGH | File handles, DB connections, memory |
| `error_handling` | HIGH | Try without catch, unhandled promises |
| `null_safety` | HIGH | Potential null dereferences |
| `race_condition` | MEDIUM | Concurrent access issues |
| `syntax` | HIGH | Bracket mismatch |
| `performance` | LOW | Nested loops, string concatenation |
| `security` | CRITICAL | Hardcoded secrets, SQL injection |

### Example

```typescript
const issues = await invoke("analyze_issues", {
    file_path: "src/api.ts",
    code: `
async function fetchData(id) {
    const response = await fetch(`/api/${id}`);  // No error handling
    return response.json();
}

function processFile(path) {
    const file = fs.readFileSync(path);  // Not closed
    return JSON.parse(file);
}
    `,
    language: "typescript"
});

// Returns:
{
    total_issues: 2,
    issues: [
        { type: "error_handling", severity: "high", line: 2, ... },
        { type: "resource_leak", severity: "high", line: 7, ... }
    ]
}
```

---

## Chat with Advanced Prompts

### CHAT Mode

Standard conversational assistance.

```
System Prompt: "You are a helpful, knowledgeable AI assistant..."
Best for: General questions, explanations, help with tasks
```

### THINK Mode

Deep reasoning with step-by-step exploration.

```
System Prompt: "Analyze this problem step by step..."
Best for: Complex problems, architectural decisions
Reasoning: Understand → Explore → Evaluate → Decide
```

### CODE Mode

Specialized for code generation and analysis.

```
System Prompt: "You are an expert code reviewer and generator..."
Best for: Code reviews, bug fixes, implementation help
Analysis: Checks structure, style, performance, security
```

### BUG_HUNT Mode

Aggressive issue detection and debugging focus.

```
System Prompt: "You are a debugging expert. Find ALL issues..."
Detects: Resource leaks, errors, null safety, race conditions
Confidence: Higher due to pattern matching
```

### ARCHITECT Mode

System design and architecture recommendations.

```
System Prompt: "You are a system architect..."
Best for: Design decisions, scaling, technology choices
Includes: Trade-offs, alternatives, implementation path
```

### AGENT Mode

Multi-step autonomous planning and execution.

```
System Prompt: "You are an autonomous agent..."
Behavior: Plans steps, executes, validates, adapts
Best for: Complex multi-step tasks, refactoring
```

---

## Configuration Tuning

### For Better Accuracy
```env
RAG_CHUNK_SIZE=50           # Keep chunks semantic
RAG_OVERLAP=10              # Maintain context
RAG_MAX_CHUNKS=20           # More context = better answers
RAG_SIMILARITY_THRESHOLD=0.3 # Broader matching
ENABLE_ISSUE_DETECTION=true # Always on
ENABLE_CODE_ANALYSIS=true   # Always on
AGENT_REASONING_DEPTH=detailed
```

### For Speed
```env
RAG_CHUNK_SIZE=100          # Larger chunks, faster
RAG_OVERLAP=5               # Less overlap
RAG_MAX_CHUNKS=5            # Minimal context
AGENT_REASONING_DEPTH=quick # Fast responses
ENABLE_ISSUE_DETECTION=false # Skip analysis
```

### For Balance
```env
RAG_CHUNK_SIZE=50           # Standard
RAG_OVERLAP=10              # Standard
RAG_MAX_CHUNKS=10           # Medium context
AGENT_REASONING_DEPTH=balanced
ENABLE_ISSUE_DETECTION=true
```

---

## Frontend Integration Example

### React Component

```tsx
import { invoke } from '@tauri-apps/api/tauri';
import { useState } from 'react';

export function AIChat() {
    const [response, setResponse] = useState(null);
    const [confidence, setConfidence] = useState(null);
    const [issues, setIssues] = useState([]);

    async function askAI(query: string, code?: string) {
        const result = await invoke("grpc_ai_chat", {
            query,
            code,
            model: "neural-chat:latest",
            provider: "ollama"
        });

        setResponse(result.content);
        setConfidence(parseFloat(result.metadata.confidence));
        setIssues(parseInt(result.metadata.issues_detected));
    }

    async function analyzeCode(code: string, language: string) {
        const result = await invoke("analyze_issues", {
            file_path: "unknown." + language,
            code,
            language
        });

        console.log(`Found ${result.total_issues} issues`);
        result.issues.forEach(issue => {
            console.log(`Line ${issue.line}: ${issue.message}`);
        });
    }

    return (
        <div>
            <input
                type="text"
                placeholder="Ask the AI..."
                onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                        askAI(e.currentTarget.value);
                    }
                }}
            />
            
            {response && (
                <div>
                    <p>{response}</p>
                    <div>
                        Confidence: {(confidence * 100).toFixed(0)}%
                        Issues: {issues}
                    </div>
                </div>
            )}
        </div>
    );
}
```

---

## Troubleshooting

### "No response from AI"
**Check**:
- Is gRPC server running? `python server.py`
- Is provider available? (Ollama port 11434, OpenAI key, etc.)
- Check port 50051 is open

### "Low confidence score"
**Solutions**:
- Provide more context
- Include code examples
- Use specific keywords
- Check language detection

### "Issues not detected"
**Check**:
- Is code valid syntax?
- Is language correctly detected?
- Check pattern regex in reasoning.py

### "RAG not finding code"
**Solutions**:
- Increase `RAG_SIMILARITY_THRESHOLD=-0.2` (broader)
- Provide more context
- Check code language is supported

---

## Supported Languages

### Full Support (RAG + Issues)
- ✅ Python
- ✅ Rust
- ✅ TypeScript / JavaScript
- ✅ Java

### Chat-Only
- ✅ All languages (but no RAG chunking)

---

## Performance Expectations

| Operation | Time | Notes |
|-----------|------|-------|
| Mode detection | <5ms | Keyword matching |
| Issue detection | ~100ms | 1000 lines of code |
| Chat response | 1-10s | Depends on LLM |
| Stream token | ~100ms | Per token from Ollama |
| GPT-4 response | 10-30s | Via OpenAI API |

---

## Best Practices

1. ✅ **Be specific**: "Debug null pointer" > "fix code"
2. ✅ **Include context**: Provide code snippets with questions
3. ✅ **Use keywords**: Say "analyze" for reviews, "debug" for issues
4. ✅ **Check confidence**: Low scores = uncertain answers
5. ✅ **Verify issues**: Detected issues are pattern-based, review suggestions
6. ✅ **Cache responses**: Same question = similar answer
7. ✅ **Use appropriate model**: gpt-4 for complex, neural-chat for simple
8. ✅ **Monitor tokens**: Track token usage for cost optimization

---

## Advanced Usage

### Custom System Prompt
```typescript
// User can override with custom prompt
const response = await invoke("grpc_ai_chat", {
    query: "Your question",
    code: "your code",
    system_prompt: "Custom system prompt here..." // Custom prompt
});
```

### Streaming with Events
```typescript
// Frontend listens to agent events
listen("agent-event", (event) => {
    console.log("Stage:", event.payload.stage);
    console.log("Progress:", event.payload.progress);
});
```

### RAG Context Display
```typescript
// Get RAG sources used in response
const response = await invoke("grpc_ai_chat", { ... });
response.sources.forEach(source => {
    console.log(`${source.file}:${source.line_start}-${source.line_end}`);
});
```

---

## Environment Setup

### Development
```bash
# Terminal 1: Python Service
cd python-ai-service
python -m grpc_tools.protoc -I. --python_out=. --grpc_python_out=. ai_service.proto
pip install -r requirements.txt
python server.py

# Terminal 2: Frontend Development
npm run dev

# Terminal 3: Rust Backend (if needed)
cargo build
```

### Production
```bash
# Build release binaries
cargo build --release

# Run as service
systemctl start ncode-ai-service
```

---

**Version**: 0.1.0  
**Last Updated**: 2024  
**Status**: ✅ Ready for Use
