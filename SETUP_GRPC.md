# gRPC Setup Guide

This guide helps you set up the complete gRPC architecture for NCode AI Service.

## Architecture Flow

```
React UI → Rust (Tauri) → gRPC Client → Python AI Service → Ollama/APIs
                  ↓
       Rust processes editor logic
```

## Setup Steps

### 1. Install Python Dependencies

```bash
cd python-ai-service
python3 -m pip install -r requirements.txt
```

### 2. Generate Protobuf Code

Run this command to generate the Python gRPC code from the .proto file:

```bash
python3 -m grpc_tools.protoc -I. --python_out=. --grpc_python_out=. ai_service.proto
```

This will create:
- `ai_service_pb2.py` - Protocol buffer definitions
- `ai_service_pb2_grpc.py` - gRPC service stubs

### 3. Start the Python AI Service

```bash
cd python-ai-service
python3 server.py
```

Expected output:
```
====================================================================
NCode AI Service - gRPC Server
====================================================================
Version: 0.1.0
Starting AI Service gRPC server on port 50051
```

### 4. Build Rust Project

The Rust gRPC client is auto-generated from the proto file:

```bash
cd /home/ubuntu/Projects/vscode-clone
npm run tauri:dev
```

## Configuration

### Python Service (.env)

Create a `.env` file in `python-ai-service/`:

```env
GRPC_HOST=127.0.0.1
GRPC_PORT=50051
OLLAMA_BASE_URL=http://localhost:11434
LOG_LEVEL=INFO
ENABLE_CACHING=true
ENABLE_STREAMING=true
```

### Rust Configuration

gRPC client settings in Rust (auto-generated):
- Default host: `127.0.0.1:50051`
- Timeout: 30 seconds
- Supports streaming responses

## Data Flow

1. **User sends message in React UI**
   - `aiStore.ts` calls `invoke("grpc_ai_chat", ...)` when service route is set to `gRPC`

2. **Tauri processes request**
   - Rust `ai/mod.rs` receives the invoke call
   - Creates gRPC request with model, prompt, history

3. **gRPC communication**
   - Rust client sends `ChatRequest` to Python
   - Contains: model, prompt, message history, provider, API key

4. **Python AI Service decides**
   - Selects appropriate provider (Ollama, OpenAI, Anthropic, Groq)
   - Routes request to selected provider
   - Returns `ChatResponse` via gRPC

5. **Response flows back**
   - Rust receives response from gRPC
   - Forwards to React UI
   - UI updates with AI response

## Available gRPC Methods

### `Chat(ChatRequest) → ChatResponse`
Send a chat message and get a single response.

```proto
message ChatRequest {
  string model = 1;           // Model ID
  string prompt = 2;          // User message
  repeated Message history = 3; // Previous messages
  string provider = 4;        // "ollama", "openai", "anthropic", "groq"
  string api_key = 5;         // API key (if needed)
  float temperature = 6;      // 0.0-1.0
  int32 max_tokens = 7;       // Max response length
}

message ChatResponse {
  string content = 1;         // AI response
  int32 tokens_used = 2;      // Token count
  string model = 3;           // Model used
}
```

### `StreamChat(ChatRequest) → stream TokenResponse`
For streaming token-by-token responses:

```proto
message TokenResponse {
  string token = 1;           // Single token
  bool done = 2;              // Done streaming?
}
```

### `FetchModels(FetchModelsRequest) → FetchModelsResponse`
Discover available models from a provider.

### `Health(HealthRequest) → HealthResponse`
Check if service is healthy and ready.

## Troubleshooting

### "Protobuf code not generated"
Run: `python3 -m grpc_tools.protoc -I. --python_out=. --grpc_python_out=. ai_service.proto`

### "Connection refused" (Rust ↔ Python)
- Ensure Python service is running on port 50051
- Check firewall settings
- Verify gRPC host in Rust code

### "Ollama unavailable"
- Ensure Ollama is running: `ollama serve`
- Verify it's accessible at http://localhost:11434
- Check `OLLAMA_BASE_URL` in `.env`

### Models not loading
- For Ollama: `ollama list` should show installed models
- For APIs: Verify API keys in settings
- Check Python service logs for errors

## Testing

### Test Python Service

```bash
python3 -c "
import grpc
from ai_service_pb2 import ChatRequest, Message
from ai_service_pb2_grpc import AIServiceStub

# Connect to service
with grpc.insecure_channel('127.0.0.1:50051') as channel:
    stub = AIServiceStub(channel)
    # Send test message
    response = stub.Chat(ChatRequest(
        model='mistral',
        prompt='Hello!',
        provider='ollama'
    ))
    print(response.content)
"
```

### Test Tauri Commands

In the UI or DevTools console:

```javascript
import { invoke } from '@tauri-apps/api/core';

// Test sending message through gRPC bridge
await invoke('grpc_ai_chat', {
  model: 'mistral',
  provider: 'ollama',
  messages: [{ role: 'user', content: 'What is Rust?' }],
  temperature: 0.7,
  maxTokens: 512
});
```

## Performance Notes

- Streaming enabled for real-time responses
- Token caching active in Python service
- Connection pooling for API providers
- Async/await throughout the stack
