# NCode AI Service - Architecture & Testing Guide

## Complete Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        React UI (Frontend)                       │
│  - AIPanel.tsx sends message via invoke()                        │
│  - User types → "What is Rust?"                                  │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             │ invoke("send_message")
                             ↓
┌─────────────────────────────────────────────────────────────────┐
│                  Tauri Bridge (src/store/aiStore.ts)             │
│  - Calls invoke("grpc_ai_chat" or "ollama_chat")                │
│  - Routes to Rust backend                                        │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             │ Tauri Command
                             ↓
┌─────────────────────────────────────────────────────────────────┐
│              Rust Backend (src-tauri/src/ai/mod.rs)              │
│                                                                   │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │  OLD: Direct HTTP Calls                                 │    │
│  │  - ollama_chat → ollama_complete, etc.                 │    │
│  │  - api_chat → OpenAI/Anthropic/Groq APIs              │    │
│  └─────────────────────────────────────────────────────────┘    │
│                                                                   │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │  NEW: gRPC Route ⭐                                      │    │
│  │  - grpc_ai_chat() creates gRPC client                 │    │
│  │  - Sends ChatRequest to Python AI Service             │    │
│  │  - Returns ChatResponse back to React                 │    │
│  └─────────────────────────────────────────────────────────┘    │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             │ gRPC (port 50051)
                             │ localhost:50051
                             ↓
┌─────────────────────────────────────────────────────────────────┐
│         Python AI Service (python-ai-service/server.py)          │
│                                                                   │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │  AI Decision Engine                                     │    │
│  │  - Receives ChatRequest with model, prompt, provider   │    │
│  │  - Analyzes which model/provider to use                │    │
│  └─────────────────────────────────────────────────────────┘    │
│                                                                   │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │  Provider Routing                                       │    │
│  │  if provider == "ollama":                              │    │
│  │    → OllamaProvider (localhost:11434)                 │    │
│  │  elif provider == "openai":                            │    │
│  │    → OpenAIProvider (api.openai.com)                  │    │
│  │  elif provider == "anthropic":                         │    │
│  │    → AnthropicProvider (api.anthropic.com)            │    │
│  │  elif provider == "groq":                              │    │
│  │    → GroqProvider (api.groq.com)                      │    │
│  └─────────────────────────────────────────────────────────┘    │
│                                                                   │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │  Returns ChatResponse with:                            │    │
│  │  - content: AI's response text                         │    │
│  │  - tokens_used: Token count                            │    │
│  │  - model: Model that was used                          │    │
│  └─────────────────────────────────────────────────────────┘    │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             │ gRPC Response
                             ↓
┌─────────────────────────────────────────────────────────────────┐
│         Ollama or Cloud APIs (Decision Made)                     │
│                                                                   │
│  Local:        Or          Cloud:                               │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ Ollama (localhost:11434)                                 │   │
│  │ - mistral:latest                                         │   │
│  │ - deepseek-coder:1.3b                                   │   │
│  │ - codellama:7b                                           │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                   │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ OpenAI API (https://api.openai.com)                     │   │
│  │ - gpt-4, gpt-4-turbo, gpt-3.5-turbo                    │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                   │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ Anthropic API (https://api.anthropic.com)              │   │
│  │ - claude-3-opus, Claude 3 Sonnet                        │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                   │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ Groq API (https://api.groq.com)                         │   │
│  │ - mixtral-8x7b, llama2-70b                              │   │
│  └──────────────────────────────────────────────────────────┘   │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             │ AI Response
                             ↓
┌─────────────────────────────────────────────────────────────────┐
│         Response Flows Back Through Stack                        │
│                                                                   │
│  API Response → Python gRPC → Rust Client → React UI           │
└─────────────────────────────────────────────────────────────────┘
                             │
                             ↓
                   ✅ Chat Updates in UI
```

## Key Improvements

### Before (Direct HTTP)
```
React → Rust → (Ollama OR OpenAI OR Anthropic OR Groq)
       ↑
       Duplicated provider routing logic
       No centralized AI decision engine
```

### After (gRPC)
```
React → Rust → gRPC → Python (AI Decision Engine) → Ollama/APIs
                      ↑
                      Centralized model selection
                      Consistent caching/streaming
                      Easy to extend
```

## Step-by-Step Testing

### 1. Setup Python Environment

```bash
cd python-ai-service

# Install dependencies
pip install -r requirements.txt

# Generate protobuf code
python -m grpc_tools.protoc -I. --python_out=. --grpc_python_out=. ai_service.proto

# Verify generated files
ls -la ai_service_pb2.py ai_service_pb2_grpc.py
```

### 2. Start Ollama (Local Testing)

```bash
# Terminal 1: Start Ollama
ollama serve

# Terminal 2: Pull a model
ollama pull mistral
```

### 3. Start Python gRPC Service

```bash
# Terminal 3
cd python-ai-service
python server.py
```

Expected output:
```
======================================================================
NCode AI Service - gRPC Server
======================================================================
Version: 0.1.0
Starting AI Service gRPC server on port 50051
Service version: 0.1.0
```

### 4. Build & Run Tauri App

```bash
# Terminal 4
npm run tauri:dev
```

### 5. Test in UI

1. **Open Settings** → Add API Key (optional)
2. **Switch to AI Panel**
3. **Type a message**: "What's the capital of France?"
4. **Select model**: mistral (or another Ollama model)
5. **Send message**

### 6. Verify gRPC Flow

Watch the Python service logs. You should see:
```
Chat request: model=mistral, provider=ollama
```

## Manual gRPC Testing

### Test from Python

```python
import grpc
from ai_service_pb2 import ChatRequest, Message
from ai_service_pb2_grpc import AIServiceStub

# Connect to gRPC service
with grpc.secure_channel('127.0.0.1:50051', grpc.local_channel_credentials()) as channel:
    stub = AIServiceStub(channel)
    
    # Create a chat request
    request = ChatRequest(
        model='mistral',
        prompt='Hello!',
        provider='ollama',
        temperature=0.7,
        max_tokens=200
    )
    
    # Send request
    response = stub.Chat(request)
    print(f"Response: {response.content}")
```

### Test from Rust CLI

```bash
cd src-tauri

cargo test --lib grpc_client::tests -- --nocapture
```

### Test Health Check

```bash
# From Rust
curl -X POST http://localhost:11235/api/health
```

## Environment Configuration

### .env (python-ai-service/)

```env
# gRPC Server
GRPC_HOST=127.0.0.1
GRPC_PORT=50051

# Ollama
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_TIMEOUT=30

# OpenAI
OPENAI_API_KEY=sk-...
OPENAI_TIMEOUT=30

# Anthropic
ANTHROPIC_API_KEY=sk-ant-...
ANTHROPIC_TIMEOUT=30

# Groq
GROQ_API_KEY=gsk_...
GROQ_TIMEOUT=30

# Features
ENABLE_CACHING=true
ENABLE_STREAMING=true
LOG_LEVEL=INFO
```

### Rust Defaults (src-tauri/src/grpc_client.rs)

```rust
const DEFAULT_HOST: &str = "127.0.0.1";
const DEFAULT_PORT: u16 = 50051;
const DEFAULT_TIMEOUT: Duration = Duration::from_secs(30);
```

## Data Structures

### ChatRequest (Protocol Buffer)

```proto
message ChatRequest {
  string model = 1;              // "mistral", "gpt-4", etc.
  string prompt = 2;             // User message
  repeated Message history = 3;  // Previous messages
  string provider = 4;           // "ollama", "openai", "anthropic", "groq"
  string api_key = 5;            // API key if needed
  float temperature = 6;         // 0.0-1.0
  int32 max_tokens = 7;          // Response length limit
}

message Message {
  string role = 1;      // "user", "assistant", "system"
  string content = 2;   // Message text
}
```

### ChatResponse (Protocol Buffer)

```proto
message ChatResponse {
  string content = 1;       // AI response
  int32 tokens_used = 2;    // Token count
  string model = 3;         // Model that was used
}
```

## Troubleshooting

### "Connection refused" (Port 50051)

**Problem**: Rust can't connect to Python gRPC service

**Solution**:
1. Verify Python service is running: `ps aux | grep server.py`
2. Check port is listening: `lsof -i :50051`
3. Verify `GRPC_HOST` and `GRPC_PORT` match in both Rust and Python

### "Protobuf code not generated"

**Problem**: `ai_service_pb2.py` and `ai_service_pb2_grpc.py` don't exist

**Solution**:
```bash
cd python-ai-service
python -m grpc_tools.protoc -I. --python_out=. --grpc_python_out=. ai_service.proto
```

### "Ollama unavailable"

**Problem**: gRPC service can't reach Ollama

**Solution**:
1. Start Ollama: `ollama serve`
2. Check it's running: `curl http://localhost:11434/api/tags`
3. Update `OLLAMA_BASE_URL` in `.env` if using different port

### "API key rejected"

**Problem**: OpenAI/Anthropic/Groq API key fails

**Solution**:
1. Verify key is correct
2. Check API key hasn't expired
3. Review logs: `LOG_LEVEL=DEBUG python server.py`
4. Test API directly: `curl -H "Authorization: Bearer $APIKEY" https://api.openai.com/v1/models`

## Performance Metrics

| Metric | Value | Notes |
|--------|-------|-------|
| Connection overhead | ~50ms | One-time per app launch |
| Chat request latency | 10-50ms | Network overhead |
| Token generation | 10-100ms per token | Depends on model |
| Streaming latency | ~5ms per chunk | Real-time feedback |

## Next Steps

1. ✅ Test gRPC flow with Ollama
2. ✅ Add API key, test with OpenAI
3. ✅ Test streaming responses
4. ✅ Monitor token usage
5. ✅ Implement caching in Python service
6. ✅ Add health checks and monitoring
