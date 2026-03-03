# NCode AI Architecture - Complete System Overview

## System Components

### 1. **Frontend Layer** (React + TypeScript)
- **Location**: `/src/components/ai/AIPanel.tsx`
- **Responsibility**: User interface for AI chat
- **Key Features**:
  - Message input and display
  - Model selection dropdown
  - Provider selection (Ollama vs API)
  - API key management
  - RAG (Retrieval Augmented Generation) toggle
  - Agent mode for autonomous code analysis

**Flow**:
```
User types "How do I optimize this function?"
    ↓
AIPanel.tsx captures input
    ↓
onClick handler calls: await sendMessage(content)
    ↓
sendMessage() in aiStore.ts determines which backend to use
    ↓
Calls: await invoke("grpc_ai_chat", { model, messages, provider, api_key })
    ↓
Tauri bridge routes to Rust
```

### 2. **Tauri Bridge Layer** (TypeScript Store)
- **Location**: `/src/store/aiStore.ts`
- **Responsibility**: State management and command orchestration
- **Key Features**:
  - Zustand store for persistent state
  - LocalStorage for chat history and settings
  - Intelligent provider selection
  - RAG indexing coordination
  - Agent mode triggers

**State Flow**:
```
selectedProvider: "ollama" | "api"
    ↑         ↑
    |         └─ API provider (OpenAI/Anthropic/Groq)
    └───────────── Local Ollama

selectedOllamaModels: ["mistral:latest"]
apiKeys: [{ provider: "openai", apiKey: "sk-...", model: "gpt-4" }]
```

**Send Message Decision Tree**:
```
Is Agent Mode active?
├─ YES → Call agentic_rag_chat (full codebase analysis)
└─ NO  → Use RAG?
         ├─ YES → Call rag_query (context-aware chat)
         └─ NO  → Use Provider?
                  ├─ OLLAMA → Call grpc_ai_chat with provider="ollama"
                  └─ API   → Call grpc_ai_chat with provider="openai|anthropic|groq"
```

### 3. **Tauri Runtime Layer** (Rust Desktop Bridge)
- **Location**: `/src-tauri/src/lib.rs`
- **Responsibility**: Native application runtime and command routing
- **Key Features**:
  - File system access
  - Terminal emulation
  - Process management
  - gRPC client management

**Invoke Handler**:
```rust
invoke_handler(tauri::generate_handler![
    // File system
    fs_commands::read_file,
    fs_commands::write_file,
    
    // AI (NEW: gRPC-based)
    ai::grpc_ai_chat,           // ⭐ Primary AI command
    ai::grpc_health_check,      // Health monitoring
    ai::grpc_fetch_models,      // Model discovery
    
    // AI (Legacy: Direct HTTP)
    ai::ollama_chat,
    ai::api_chat,
    ...
])
```

### 4. **Rust AI Module** (gRPC Client)
- **Location**: `/src-tauri/src/ai/mod.rs`
- **Responsibility**: Business logic for AI requests
- **Key Innovations**:

#### `grpc_ai_chat()` - Primary Command ⭐

```rust
#[command]
pub async fn grpc_ai_chat(
    model: String,                      // "mistral", "gpt-4", etc.
    messages: Vec<OllamaChatMessage>,   // Chat history
    provider: String,                   // "ollama", "openai", etc.
    api_key: Option<String>,            // API key if needed
    temperature: Option<f32>,           // 0.0-1.0
    max_tokens: Option<i32>,            // Response length
) -> Result<String, String> {
    // 1. Create gRPC client
    let client = GrpcAiClient::default_client();
    
    // 2. Connect to Python service (localhost:50051)
    client.connect().await?;
    
    // 3. Convert messages to gRPC format
    let chat_messages: Vec<ChatMessage> = messages.iter()
        .map(|m| ChatMessage { role: m.role, content: m.content })
        .collect();
    
    // 4. Send ChatRequest through gRPC
    let response = client.chat(
        model,
        prompt,
        chat_messages,
        provider,
        api_key,
        temperature,
        max_tokens,
    ).await?;
    
    // 5. Return response content
    Ok(response.content)
}
```

**Implementation Details**:
- Uses **tonic** (Rust gRPC framework)
- Connects to Python service on `127.0.0.1:50051`
- Auto-reconnects if connection drops
- Includes error handling and logging
- Supports streaming responses (async-stream)

### 5. **Rust gRPC Client Module**
- **Location**: `/src-tauri/src/grpc_client.rs`
- **Responsibility**: Low-level gRPC communication
- **Struct**: `GrpcAiClient`

**Key Methods**:
```rust
pub async fn connect(&self) -> Result<(), GrpcError>
    // Establish connection to Python gRPC service

pub async fn health_check(&self) -> Result<bool, GrpcError>
    // Check if service is healthy

pub async fn chat(
    &self,
    model: String,
    prompt: String,
    history: Vec<ChatMessage>,
    provider: String,
    api_key: Option<String>,
    temperature: Option<f32>,
    max_tokens: Option<i32>,
) -> Result<ChatResponse, GrpcError>
    // Send chat request, get response

pub async fn stream_chat(...)
    // Stream tokens as they're generated

pub async fn fetch_models(
    &self,
    provider: String,
    api_key: Option<String>,
    base_url: Option<String>,
) -> Result<Vec<String>, GrpcError>
    // Discover available models
```

**Data Structures**:
```rust
pub struct ChatMessage {
    pub role: String,       // "user", "assistant", "system"
    pub content: String,    // Message text
}

pub struct ChatResponse {
    pub content: String,    // AI response
    pub tokens_used: i32,   // Token count
    pub model: String,      // Model used
}

pub enum GrpcError {
    ConnectionError(String),
    RequestError(String),
    DecodingError(String),
}
```

### 6. **Python AI Service** (gRPC Server)
- **Location**: `/python-ai-service/server.py`
- **Responsibility**: Centralized AI decision engine
- **Port**: `50051` (gRPC)

**Architecture**:
```
┌─────────────────────────────────────────┐
│    AI Service gRPC Handler              │
│  (implements ai_service_pb2_grpc.py)    │
└────────────┬────────────────────────────┘
             │
    ┌────────┴────────┐
    │                 │
    ↓                 ↓
┌──────────┐     ┌──────────────┐
│  Chat()  │     │FetchModels() │
│ Health() │     │   Stream()   │
└────┬─────┘     └──────────────┘
     │
     ├─────────────────────────────────────┐
     │                                     │
     ↓                                     ↓
Provider Selection                   Model Discovery
(Which LLM to use?)            (What models available?)
     │
┌────┴────────────────────────────────────┐
│                                         │
├─ OllamaProvider (Local)                │
│  └─ http://localhost:11434             │
│     - mistral, deepseek, codellama...  │
│                                         │
├─ OpenAIProvider (Cloud)                │
│  └─ https://api.openai.com/v1          │
│     - gpt-4, gpt-4-turbo, gpt-3.5...   │
│                                         │
├─ AnthropicProvider (Cloud)             │
│  └─ https://api.anthropic.com/v1       │
│     - claude-3-opus, claude-3-sonnet... │
│                                         │
└─ GroqProvider (Cloud)                  │
   └─ https://api.groq.com/openai/v1     │
      - mixtral-8x7b, llama2-70b...      │
```

**Request Processing**:
```python
async def Chat(self, request: PBChatRequest):
    # 1. Extract request details
    model = request.model              # "mistral"
    prompt = request.prompt            # "What is X?"
    history = request.history          # Previous messages
    provider = request.provider        # "ollama"
    api_key = request.api_key          # (if needed)
    temperature = request.temperature  # 0.7
    max_tokens = request.max_tokens    # 2000
    
    # 2. Get appropriate provider
    provider_instance = self.get_provider(
        provider, api_key, base_url
    )
    
    # 3. Send to provider
    response = await provider_instance.chat(
        model, messages, temperature=temperature, max_tokens=max_tokens
    )
    
    # 4. Return ChatResponse
    return ChatResponse(
        content=response,
        tokens_used=0,  # TODO: track actual tokens
        model=request.model
    )
```

**Provider Classes**:

Each provider implements:
```python
async def chat(model, messages, **kwargs) -> str
    # Send request to provider, get response

async def stream_chat(model, messages, **kwargs) -> AsyncIterator[str]
    # Stream tokens from provider

async def fetch_models() -> List[str]
    # Get available models
```

### 7. **Protocol Buffers** (gRPC Contracts)
- **Location**: `/python-ai-service/ai_service.proto`
- **Generated Files**:
  - Python: `ai_service_pb2.py`, `ai_service_pb2_grpc.py`
  - Rust: Generated by `tonic-build` in `build.rs`

**Messages**:
```proto
message ChatRequest {
  string model = 1;
  string prompt = 2;
  repeated Message history = 3;
  string provider = 4;
  string api_key = 5;
  float temperature = 6;
  int32 max_tokens = 7;
}

message ChatResponse {
  string content = 1;
  int32 tokens_used = 2;
  string model = 3;
}

message TokenResponse {
  string token = 1;
  bool done = 2;
}
```

**Services**:
```proto
service AIService {
  rpc Chat(ChatRequest) returns (ChatResponse);
  rpc StreamChat(ChatRequest) returns (stream TokenResponse);
  rpc FetchModels(FetchModelsRequest) returns (FetchModelsResponse);
  rpc Health(HealthRequest) returns (HealthResponse);
}
```

## Data Flow - Complete Example

**Scenario**: User asks "Who invented the internet?" while using mistral model via Ollama

### Step-by-Step

**1. User Input** (React → Tauri)
```typescript
// AIPanel.tsx
const handleSend = async () => {
  const text = "Who invented the internet?";
  await sendMessage(text);  // → aiStore.ts
};
```

**2. Store Decision** (aiStore.ts)
```typescript
sendMessage: async (content: string) => {
  if (selectedProvider === "ollama") {
    // Use gRPC via Rust
    const response = await invoke("grpc_ai_chat", {
      model: "mistral:latest",
      messages: [
        { role: "user", content: "Who invented the internet?" }
      ],
      provider: "ollama",
      api_key: null,
      temperature: 0.7,
      max_tokens: 2000
    });
    
    // Display response
    chatHistory.push({
      role: "assistant",
      content: response
    });
  }
};
```

**3. Rust Command Handler** (lib.rs)
```rust
invoke_handler received: {
  command: "grpc_ai_chat",
  payload: {
    model: "mistral:latest",
    messages: [...],
    provider: "ollama",
    ...
  }
}

→ Calls: ai::grpc_ai_chat(model, messages, provider, api_key, ...)
```

**4. Rust gRPC Client** (ai/mod.rs)
```rust
pub async fn grpc_ai_chat(...) {
    // 1. Create client
    let client = GrpcAiClient::default_client();
    
    // 2. Connect to Python service
    client.connect().await?;  // Connect to 127.0.0.1:50051
    
    // 3. Send ChatRequest
    let response = client.chat(
        "mistral:latest",
        "Who invented the internet?",
        vec![],
        "ollama",
        None,
        Some(0.7),
        Some(2000)
    ).await?;
    
    // 4. Return content
    Ok(response.content)
}
```

**5. gRPC Network** (tonic serialization)
```
Rust sends:
┌─────────────────────────────────────────────┐
│ gRPC Frame                                  │
│ ┌───────────────────────────────────────┐   │
│ │ ChatRequest (Protobuf binary)         │   │
│ │ - model: "mistral:latest"             │   │
│ │ - prompt: "Who invented internet?"    │   │
│ │ - provider: "ollama"                  │   │
│ │ - temperature: 0.7                    │   │
│ │ - max_tokens: 2000                    │   │
│ └───────────────────────────────────────┘   │
│ [Sent over TCP/HTTP2 to 127.0.0.1:50051]   │
└─────────────────────────────────────────────┘
```

**6. Python gRPC Handler** (server.py)
```python
async def Chat(self, request: ChatRequest, context):
    # 1. Deserialize request
    model = "mistral:latest"
    prompt = "Who invented the internet?"
    provider = "ollama"
    
    # 2. Get provider
    prov = OllamaProvider(
        base_url="http://localhost:11434"
    )
    
    # 3. Send to Ollama
    response = await prov.chat(
        model="mistral:latest",
        messages=[{"role": "user", "content": prompt}],
        temperature=0.7,
        max_tokens=2000
    )
    # response = "The internet was developed by..."
    
    # 4. Send ChatResponse back
    return ChatResponse(
        content="The internet was developed by...",
        tokens_used=150,
        model="mistral:latest"
    )
```

**7. Ollama HTTP Call** (from Python)
```
POST http://localhost:11434/api/chat
Content-Type: application/json

{
  "model": "mistral:latest",
  "messages": [
    { "role": "user", "content": "Who invented the internet?" }
  ],
  "stream": false
}

← Response with model's answer
```

**8. Response Flows Back**
```
Ollama Response → Python service → gRPC → Rust client → React UI
                                    ↑
                        ChatResponse message
                        (protobuf binary)
```

**9. UI Update** (React)
```typescript
// ChatMessage appears in AIPanel
<div className="message assistant">
  The internet was developed by...
</div>
```

## Configuration Files

### Cargo.toml (Rust Dependencies)
```toml
[dependencies]
tauri = "2.0"
tonic = "0.10"           # ← gRPC framework
prost = "0.12"           # ← Protobuf serialization
prost-types = "0.12"
tokio = "1.0"            # ← Async runtime
reqwest = "0.12"         # ← HTTP client
serde = "1.0"            # ← Serialization
```

### requirements.txt (Python Dependencies)
```
grpcio==1.64.0           # ← gRPC server
grpcio-tools==1.64.0     # ← Protobuf compiler
protobuf==5.26.1
aiohttp==3.10.5          # ← Async HTTP client
pydantic==2.7.1          # ← Data validation
tokio = "1.0"            
```

### build.rs (Rust Build Script)
```rust
// Compiles proto files before building main binary
tonic_build::configure()
    .compile(
        &["ai_service.proto"],
        &["../python-ai-service"],
    )?;
```

## Advantages of gRPC Architecture

### 1. **Centralization**
- Single AI decision engine
- Model selection logic in one place
- Consistent behavior across all providers

### 2. **Scalability**
- Can move Python service to different machine
- Multiple Rust instances → single Python service
- Load balancing ready

### 3. **Performance**
- Protocol Buffers: more efficient than JSON
- HTTP/2: multiplexing, header compression
- Streaming: real-time token delivery
- Connection pooling

### 4. **Maintainability**
- Clear API contracts (proto definitions)
- Decoupled frontend, backend, AI logic
- Easy to add new providers

### 5. **Debugging**
- gRPC has built-in logging
- Protocol Buffers are self-documenting
- Separate services = easier to debug

### 6. **Future-Proof**
- Add caching layer in Python service
- Implement request queuing
- Add monitoring/telemetry
- Support for batch requests
- Multi-model routing strategies

## Current vs. Proposed

### Current (Direct HTTP)
```
React UI
  ├─ invoke("ollama_chat")        [Rust makes HTTP to Ollama]
  │  └─ HTTP → Ollama
  │
  ├─ invoke("api_chat")           [Rust makes HTTP to OpenAI/etc]
  │  └─ HTTP → OpenAI/Anthropic/Groq
  │
  └─ invoke("rag_query")          [Rust makes HTTP to Ollama]
     └─ Local RAG + HTTP → Ollama
```

### Proposed (gRPC)
```
React UI
  └─ invoke("sendMessage")
     └─ aiStore decides logic
        └─ invoke("grpc_ai_chat")  [Rust sends gRPC]
           └─ gRPC → Python Service
              ├─ AI Decision Engine
              └─ Routes to Ollama/API based on logic
```

## Migration Path

### Phase 1 ✅ (Current)
- Keep legacy commands (`ollama_chat`, `api_chat`)
- Add new gRPC commands (`grpc_ai_chat`)
- Both work in parallel

### Phase 2 (Optional)
- Update aiStore to prefer gRPC commands
- Keep legacy as fallback
- Monitor for issues

### Phase 3 (Optional)
- Remove legacy commands
- Fully gRPC-dependent
- Cleaner codebase

## Security Considerations

1. **gRPC Connection**
   - Uses HTTP/2
   - Can be secured with TLS in production
   - Currently localhost-only (secure within machine)

2. **API Keys**
   - Stored in React localStorage (not ideal for production)
   - Should move to secure storage
   - Python service handles keys, not exposed to frontend

3. **Ollama Access**
   - Local-only by default (11434)
   - No authentication by default
   - Consider network isolation

## Production Deployment

For production use:

1. **gRPC Security**
```rust
// Use TLS for remote Python service
let channel = Channel::from_shared(addr)?
    .tls_config(ClientTlsConfig::new())?
    .connect()
    .await?;
```

2. **Python Service Hardening**
```python
# Add authentication
# Add rate limiting
# Add request validation
# Use environment variables for API keys
```

3. **Monitoring**
```python
# Log all requests
# Track token usage
# Monitor response times
# Alert on errors
```

This architecture provides the solid foundation for a production-grade AI-powered code editor.
