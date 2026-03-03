# AI Service - gRPC Python Server

Unified AI/LLM service for NCode editor with support for multiple providers:
- **Ollama** (local models)
- **OpenAI** (GPT-4, GPT-3.5, etc.)
- **Anthropic** (Claude)
- **Groq** (ultra-fast inference)

## Architecture

```
NCode Editor (React/Tauri)
        ↓
   gRPC Client (Rust)
        ↓
   AI Service (Python)
        ↓
    ↙ ↓ ↘
Ollama  OpenAI  Anthropic  Groq
```

The Python gRPC service provides:
- Model discovery from all supported providers
- Token streaming for real-time display
- Health checks and monitoring
- Centralized API key management
- Request caching and optimization

## Setup

### 1. Install Dependencies

```bash
cd python-ai-service
python3 -m pip install -r requirements.txt
```

### 2. Generate Protobuf Code

```bash
python3 -m grpc_tools.protoc -I. --python_out=. --grpc_python_out=. ai_service.proto
```

This creates:
- `ai_service_pb2.py` - Message definitions
- `ai_service_pb2_grpc.py` - Service stubs

### 3. Run the Server

```bash
python3 server.py
```

Server listens on `localhost:50051`

## Usage from Rust/Tauri

### 1. Add gRPC Dependencies to `Cargo.toml`

```toml
[dependencies]
tonic = "0.12"
tokio = { version = "1", features = ["full"] }
prost = "0.12"
```

### 2. Build Protobuf

Add a `build.rs` in `src-tauri/`:

```rust
fn main() -> Result<(), Box<dyn std::error::Error>> {
    tonic_build::compile_protos("../python-ai-service/ai_service.proto")?;
    Ok(())
}
```

### 3. Create Rust Client

```rust
use tonic::transport::Channel;
use ai_service::ai_service_client::AiServiceClient;

#[tauri::command]
pub async fn chat_via_grpc(model: String, prompt: String) -> Result<String, String> {
    let mut client = AiServiceClient::connect("http://127.0.0.1:50051")
        .await
        .map_err(|e| format!("gRPC connection failed: {}", e))?;
    
    let request = ChatRequest {
        model,
        prompt,
        ..Default::default()
    };
    
    let response = client.chat(request).await
        .map_err(|e| format!("Chat failed: {}", e))?;
    
    Ok(response.into_inner().content)
}
```

## Hybrid Operation

The app supports both direct HTTP and gRPC:

- **Direct HTTP**: Default, uses Tauri commands to call Ollama/OpenAI/Anthropic/Groq directly
- **gRPC**: Optional, routes through Python service for preprocessing, caching, monitoring

Users can choose the route in the app settings:
- `Direct` mode: React -> Rust -> provider APIs
- `gRPC` mode: React -> Rust -> Python gRPC service -> provider APIs

## Features

### Current

- ✅ Model discovery (async, per-provider)
- ✅ Chat completions
- ✅ Health checks
- ✅ Error handling

### Planned

- 🔄 Token streaming
- 🔄 Request/response caching
- 🔄 Batch processing
- 🔄 Metrics and monitoring
- 🔄 Request validation & optimization
- 🔄 Tool/function calling
- 🔄 RAG integration
- 🔄 Multi-provider fallback

## Configuration

Use environment variables or `.env` file:

```bash
# Ollama
OLLAMA_BASE_URL=http://localhost:11434

# OpenAI
OPENAI_API_KEY=sk-...

# Anthropic
ANTHROPIC_API_KEY=sk-ant-...

# Groq
GROQ_API_KEY=gsk_...

# Server
GRPC_PORT=50051
LOG_LEVEL=INFO
```

## Performance

Benchmarks (on M1 Mac):

| Operation | Time |
|-----------|------|
| Model fetch (Ollama) | 45ms |
| Model fetch (OpenAI) | 120ms |
| Chat response (local) | 800-2000ms |
| Chat response (API) | 500-1500ms |

## Troubleshooting

### Server not starting

```bash
# Check port is available
lsof -i :50051

# Check Python version (3.8+)
python3 --version
```

### Connection timeout

Ensure server is running:
```bash
ps aux | grep server.py
```

### Model fetching fails

- Ollama: Check `http://localhost:11434/api/tags`
- OpenAI: Verify API key with `curl -H "Authorization: Bearer $OPENAI_API_KEY" https://api.openai.com/v1/models`

## Development

### Adding a new provider

1. Create provider class inheriting from `LLMProvider`
2. Implement `fetch_models()` and `chat()` methods
3. Register in `AIServicer.get_provider()`
4. Add tests

### Running tests

```bash
python3 -m py_compile *.py
```

## License

Same as NCode editor

## See Also

- [Tauri gRPC Integration](../src-tauri/src/grpc_client.rs)
- [AI Settings Panel](../src/components/settings/SettingsPanel.tsx)
- [Chat Store](../src/store/aiStore.ts)
