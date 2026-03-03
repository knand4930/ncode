# AI Service Architecture - Visual Diagrams

## Complete System Flow Diagram

```
╔════════════════════════════════════════════════════════════════════════════╗
║                           NCODE AI ARCHITECTURE                            ║
╚════════════════════════════════════════════════════════════════════════════╝

┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓
┃                         FRONTEND LAYER (React)                             ┃
┃                                                                             ┃
┃  ┌─────────────────────────────────────────────────────────────────────┐  ┃
┃  │  AIPanel.tsx - User Interface                                       │  ┃
┃  │  ┌─────────────┐  ┌──────────────┐  ┌──────────────┐               │  ┃
┃  │  │   Input     │  │  Chat View   │  │  Settings    │               │  ┃
┃  │  │  [Type msg] │  │  [Response]  │  │  [Model sel] │               │  ┃
┃  │  └──────┬──────┘  └──────────────┘  └──────────────┘               │  ┃
┃  │         │                                                             │  ┃
┃  │         └────────────────────┬────────────────────────────────────┐  │  ┃
┃  │                              ▼                                    │  │  ┃
┃  │         aiStore.ts - State Management                            │  │  ┃
┃  │         (sendMessage decision logic)                             │  │  ┃
┃  └─────────────────────────────────────────────────────────────────┘  ┃
┃            │                                                             ┃
┃            │ invoke("grpc_ai_chat", {...})                             ┃
┃            ▼                                                             ┃
┗━━━━━━━━━━━━━┻━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛
               │
      Tauri Command Bridge
      (IPC - Inter-Process Communication)
               │
               ▼
┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓
┃                      BACKEND LAYER (Rust / Tauri)                         ┃
┃                                                                             ┃
┃  ┌─────────────────────────────────────────────────────────────────────┐  ┃
┃  │  lib.rs - Command Router                                            │  ┃
┃  │                                                                       │  ┃
┃  │  invoke_handler([                                                   │  ┃
┃  │    ai::grpc_ai_chat,     ◄───── NEW: gRPC Command                 │  ┃
┃  │    ai::grpc_health_check,                                          │  ┃
┃  │    ai::grpc_fetch_models,                                          │  ┃
┃  │    ...                                                               │  ┃
┃  │  ])                                                                 │  ┃
┃  └─────────────────────────────────────────────────────────────────────┘  ┃
┃            │                                                               ┃
┃            └────────────────┬───────────────────────────────────────────┐  ┃
┃                             ▼                                           │  ┃
┃  ┌─────────────────────────────────────────────────────────────────┐   │  ┃
┃  │  ai/mod.rs - AI Module                                          │   │  ┃
┃  │                                                                   │   │  ┃
┃  │  pub async fn grpc_ai_chat(                                      │   │  ┃
┃  │      model: String,                                             │   │  ┃
┃  │      messages: Vec<OllamaChatMessage>,                          │   │  ┃
┃  │      provider: String,                                          │   │  ┃
┃  │      api_key: Option<String>,                                   │   │  ┃
┃  │      temperature: Option<f32>,                                  │   │  ┃
┃  │      max_tokens: Option<i32>,                                   │   │  ┃
┃  │  ) -> Result<String, String> {                                  │   │  ┃
┃  │                                                                   │   │  ┃
┃  │    // 1. Create gRPC client                                      │   │  ┃
┃  │    let client = GrpcAiClient::default_client();                 │   │  ┃
┃  │                                                                   │   │  ┃
┃  │    // 2. Connect to Python service (127.0.0.1:50051)            │   │  ┃
┃  │    client.connect().await?;                                     │   │  ┃
┃  │                                                                   │   │  ┃
┃  │    // 3. Send chat request through gRPC                         │   │  ┃
┃  │    let response = client.chat(                                  │   │  ┃
┃  │        model, prompt, history, provider, api_key, ...          │   │  ┃
┃  │    ).await?;                                                    │   │  ┃
┃  │                                                                   │   │  ┃
┃  │    // 4. Return response content                                │   │  ┃
┃  │    Ok(response.content)                                         │   │  ┃
┃  │  }                                                               │   │  ┃
┃  └──────────────────────────┬──────────────────────────────────────┘   │  ┃
┃                             │                                           │  ┃
┃  ┌──────────────────────────┼──────────────────────────────────────┐   │  ┃
┃  │  grpc_client.rs - gRPC Client ◄────────────────────────────────┘   │  ┃
┃  │                                                                      │  ┃
┃  │  pub struct GrpcAiClient {                                         │  ┃
┃  │    inner: Arc<Mutex<Option<AiServiceClient<Channel>>>>,           │  ┃
┃  │    grpc_host: String,   // "127.0.0.1"                           │  ┃
┃  │    grpc_port: u16,      // 50051                                  │  ┃
┃  │  }                                                                  │  ┃
┃  │                                                                      │  ┃
┃  │  impl GrpcAiClient {                                              │  ┃
┃  │    pub async fn connect() -> Result<(), GrpcError>                │  ┃
┃  │    pub async fn chat(...) -> Result<ChatResponse, GrpcError>      │  ┃
┃  │    pub async fn stream_chat(...) -> Result<Stream>                │  ┃
┃  │    pub async fn fetch_models(...) -> Result<Vec<String>>          │  ┃
┃  │    pub async fn health_check() -> Result<bool>                    │  ┃
┃  │  }                                                                  │  ┃
┃  └──────────────┬───────────────────────────────────────────────────┘  ┃
┃                 │                                                        ┃
┗━━━━━━━━━━━━━━━━┻━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛
                  │
                  │ gRPC Request (Protocol Buffers)
                  │ Host: 127.0.0.1, Port: 50051
                  │ Message: ChatRequest {
                  │   model: "mistral",
                  │   prompt: "What is X?",
                  │   provider: "ollama",
                  │   temperature: 0.7,
                  │   max_tokens: 2000
                  │ }
                  │
                  ▼
┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓
┃                    AI SERVICE LAYER (Python / gRPC)                       ┃
┃                    server.py (Port 50051)                                ┃
┃                                                                             ┃
┃  ┌─────────────────────────────────────────────────────────────────────┐  ┃
┃  │  gRPC Server (Async)                                                │  ┃
┃  │                                                                       │  ┃
┃  │  ┌─── AIServicer Class (implements AIServiceServicer) ───┐          │  ┃
┃  │  │                                                        │          │  ┃
┃  │  │  async def Chat(request, context):                   │          │  ┃
┃  │  │    ┌──────────────────────────────────────────────┐  │          │  ┃
┃  │  │    │ 1. Extract ChatRequest                       │  │          │  ┃
┃  │  │    │    model = "mistral"                         │  │          │  ┃
┃  │  │    │    prompt = "What is X?"                     │  │          │  ┃
┃  │  │    │    provider = "ollama"                       │  │          │  ┃
┃  │  │    └──────────────────────────────────────────────┘  │          │  ┃
┃  │  │              │                                         │          │  ┃
┃  │  │              ▼                                         │          │  ┃
┃  │  │    ┌──────────────────────────────────────────────┐  │          │  ┃
┃  │  │    │ 2. Select Provider                          │  │          │  ┃
┃  │  │    │    prov = get_provider(provider)            │  │          │  ┃
┃  │  │    └──────────────────────────────────────────────┘  │          │  ┃
┃  │  │              │                                         │          │  ┃
┃  │  │              ▼                                         │          │  ┃
┃  │  │    ┌──────────────────────────────────────────────┐  │          │  ┃
┃  │  │    │ 3. Send to Provider                         │  │          │  ┃
┃  │  │    │    response = await prov.chat(              │  │          │  ┃
┃  │  │    │        model, messages, ...                 │  │          │  ┃
┃  │  │    │    )                                        │  │          │  ┃
┃  │  │    └──────────────────────────────────────────────┘  │          │  ┃
┃  │  │              │                                         │          │  ┃
┃  │  │              ▼                                         │          │  ┃
┃  │  │    ┌──────────────────────────────────────────────┐  │          │  ┃
┃  │  │    │ 4. Return ChatResponse                      │  │          │  ┃
┃  │  │    │    ChatResponse(                            │  │          │  ┃
┃  │  │    │        content=response,                    │  │          │  ┃
┃  │  │    │        tokens_used=150,                     │  │          │  ┃
┃  │  │    │        model="mistral"                      │  │          │  ┃
┃  │  │    │    )                                        │  │          │  ┃
┃  │  │    └──────────────────────────────────────────────┘  │          │  ┃
┃  │  │                                                        │          │  ┃
┃  │  └────────────────────────────────────────────────────────┘          │  ┃
┃  │                                                                       │  ┃
┃  │  ┌──────────────────┬────────────────┬────────────────┬───────────┐ │  ┃
┃  │  │ Provider Classes │                │                │           │ │  ┃
┃  │  │                  │                │                │           │ │  ┃
┃  │  │ OllamaProvider   │ OpenAIProvider │ AnthropicProv  │ GroqProv  │ │  ┃
┃  │  └──────────────────┴────────────────┴────────────────┴───────────┘ │  ┃
┃  └─────────────────────────────────────────────────────────────────────┘  ┃
┃            │                                                               ┃
┗━━━━━━━━━━━━┻━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛
             │
             │ Intelligently Route to Provider
             │
    ┌────────┴────────┬──────────────┬──────────────┬──────────────┐
    │                 │              │              │              │
    ▼                 ▼              ▼              ▼              ▼
┌─────────────┐  ┌──────────┐  ┌────────────┐  ┌──────────┐  ┌──────────┐
│   Ollama    │  │ OpenAI   │  │ Anthropic  │  │ Groq     │  │ Others   │
│             │  │ API      │  │ API        │  │ API      │  │ (Future) │
│ localhost:  │  │ api.     │  │ api.       │  │ api.     │  │          │
│ 11434       │  │ openai.  │  │ anthropic  │  │ groq.    │  │          │
│             │  │ com      │  │ .com       │  │ .com     │  │          │
│ Models:     │  │ Models:  │  │ Models:    │  │ Models:  │  │          │
│ mistral     │  │ gpt-4    │  │ claude-3-  │  │ mixtral  │  │          │
│ deepseek    │  │ gpt-4o   │  │ opus       │  │ llama2   │  │          │
│ codellama   │  │ gpt-3.5  │  │ claude-3-  │  │          │  │          │
│             │  │          │  │ sonnet     │  │          │  │          │
└─────────────┘  └──────────┘  └────────────┘  └──────────┘  └──────────┘
    │                 │              │              │              │
    └─────────────────┴──────────────┴──────────────┴──────────────┘
               │
         AI Response Generated
               │
               ▼
        ┌──────────────┐
        │ "Rust is a   │
        │ systems      │
        │ language..." │
        └──────────────┘
               │
               │ ChatResponse (gRPC)
               │ {
               │   content: "...",
               │   tokens_used: 150,
               │   model: "mistral"
               │ }
               │
               ▼
    Response Flows Back Through Stack
    (Rust Client ← gRPC ← Python Service)
               │
               ▼
        ┌─────────────────┐
        │ Rust gRPC Client│
        └────────┬────────┘
                 │
          invoke returns
          Result<String>
                 │
                 ▼
        ┌─────────────────┐
        │  React Store    │
        │  Adds Message   │
        └────────┬────────┘
                 │
                 ▼
        ┌─────────────────┐
        │  AIPanel Renders│
        │  Response       │
        └─────────────────┘
                 │
                 ▼
        ✅ User sees answer
```

## Decision Flow Diagram

```
┌─────────────────────────────────┐
│      User Sends Message         │
│  "How do I optimize this?"      │
└──────────────┬──────────────────┘
               │
               ▼
┌──────────────────────────────────────────────────────┐
│   aiStore.sendMessage() Analyzes Request             │
│                                                       │
│   Decision Tree:                                     │
│   ├─ Is agent mode active?                          │
│   │  └─ YES → Use agentic_rag_chat                 │
│   │            (Full codebase analysis)             │
│   │  └─ NO  → Continue                             │
│   │                                                  │
│   ├─ Should use RAG?                                │
│   │  └─ YES → Use rag_query                        │
│   │            (Context-aware chat)                 │
│   │  └─ NO  → Continue                             │
│   │                                                  │
│   ├─ Which provider selected?                       │
│   │  ├─ OLLAMA → invoke("grpc_ai_chat", {         │
│   │  │             provider: "ollama",              │
│   │  │             model: selectedOllamaModels[0],  │
│   │  │             ...                              │
│   │  │           })                                 │
│   │  │                                              │
│   │  └─ API → invoke("grpc_ai_chat", {            │
│   │           provider: apiKeyEntry.provider,      │
│   │           model: apiKeyEntry.model,            │
│   │           api_key: apiKeyEntry.apiKey,         │
│   │           ...                                  │
│   │         })                                      │
│   │                                                 │
│   └─ Error → Display error message                 │
└──────────────┬──────────────────────────────────────┘
               │
               ▼ invoke("grpc_ai_chat", {})
        ┌──────────────────────────────┐
        │    Rust gRPC Command         │
        │                              │
        │ 1. Create gRPC client        │
        │ 2. Connect to service        │
        │ 3. Send ChatRequest          │
        │ 4. Wait for response         │
        │ 5. Return content            │
        └──────────────┬───────────────┘
                       │
                       ▼ gRPC to 127.0.0.1:50051
        ┌──────────────────────────────┐
        │   Python AI Service          │
        │                              │
        │ 1. Receive ChatRequest       │
        │ 2. Select provider           │
        │ 3. Route to provider         │
        │ 4. Get response              │
        │ 5. Return ChatResponse       │
        └──────────────┬───────────────┘
                       │
                       ▼ Back to Rust
        ┌──────────────────────────────┐
        │   Rust Processes Response    │
        │                              │
        │ 1. Receive ChatResponse      │
        │ 2. Extract content           │
        │ 3. Return to Tauri/React     │
        └──────────────┬───────────────┘
                       │
                       ▼ Back to React
        ┌──────────────────────────────┐
        │   React Updates Store        │
        │   chatHistory.push(message)  │
        │                              │
        │   AIPanel Re-renders         │
        │   Shows AI Response          │
        └──────────────┬───────────────┘
                       │
                       ▼
              ✅ User sees answer in UI
```

## Provider Selection Logic

```
┌────────────────────────────────────────┐
│   User Request with Provider Context   │
│                                        │
│   {                                    │
│     provider: "ollama" | "openai" |    │
│                "anthropic" | "groq"    │
│     model: "mistral" | "gpt-4" |...    │
│     api_key: (if provider == "api")    │
│   }                                    │
└──────────────┬─────────────────────────┘
               │
         Python Service Routes:
               │
      ┌────────┼────────┬─────────┬──────────┐
      │        │        │         │          │
      ▼        ▼        ▼         ▼          ▼
   OLLAMA   OPENAI   ANTHROPIC   GROQ    FUTURE
      │        │        │         │
      │        │        │         │
     ┌┴───────┐│        │         │
     │        └┼────────┼─────────┘
     │         │        │
     └─────────└────────┘
           │
        Provider Code:
     
    if provider == "ollama":
        OllamaProvider(base_url: str)
        .chat(model, messages)
        → localhost:11434/api/chat
     
    elif provider == "openai":
        OpenAIProvider(api_key: str)
        .chat(model, messages)
        → api.openai.com/v1/chat/completions
     
    elif provider == "anthropic":
        AnthropicProvider(api_key: str)
        .chat(model, messages)
        → api.anthropic.com/v1/messages
     
    elif provider == "groq":
        GroqProvider(api_key: str)
        .chat(model, messages)
        → api.groq.com/openai/v1/chat/completions
```

## Message Flow Sequence

```
Time →

User UI
  │
  ├─ Types message: "What is Async in Rust?"
  │
  └─ Click Send button
        │
        ▼
    React/AIPanel
        │
        ├─ Calls sendMessage() from store
        │
        └─ Store analyzes:
           - Provider: "ollama"
           - Model: "mistral"
           - No RAG needed
           │
           ├─ invoke("grpc_ai_chat", {
           │    model: "mistral",
           │    messages: [{role: "user", content: "..."}],
           │    provider: "ollama",
           │    temperature: 0.7,
           │    max_tokens: 2000
           │  })
           │
           ▼
        Tauri Bridge (IPC)
           │
           ├─ Routes command to Rust handler
           │
           ▼
        Rust: ai::grpc_ai_chat()
           │
           ├─ Creates GrpcAiClient
           ├─ Connects to 127.0.0.1:50051
           ├─ Serializes ChatRequest to Protobuf
           │
           ▼
        Network: gRPC over HTTP/2
           │
           ├─ Sends binary Protobuf message
           │
           ▼
        Python: server.py:Chat()
           │
           ├─ Deserializes ChatRequest
           ├─ Determines: provider="ollama", model="mistral"
           ├─ Gets OllamaProvider instance
           │
           ▼
        Python: OllamaProvider.chat()
           │
           ├─ Sends HTTP POST to 127.0.0.1:11434
           ├─ Ollama processes locally
           ├─ Generates response tokens incrementally
           │
           ▼
        Ollama (Local)
           │
           ├─ Loads mistral model (if not cached)
           ├─ Processes prompt
           ├─ Generates: "Async in Rust enables..."
           │
           ▼
        HTTP Response back to Python
           │
           ├─ Python receives full response
           ├─ Wraps in ChatResponse Protobuf message:
           │  {
           │    content: "Async in Rust enables...",
           │    tokens_used: 187,
           │    model: "mistral"
           │  }
           │
           ▼
        gRPC Response back to Rust
           │
           ├─ Deserializes ChatResponse
           ├─ Extracts content: "Async in Rust enables..."
           │
           ▼
        Rust: grpc_ai_chat() Returns
           │
           ├─ Ok("Async in Rust enables...")
           │
           ▼
        Tauri Bridge Returns to React
           │
           ├─ Promise resolves with response
           │
           ▼
        React: sendMessage() Completes
           │
           ├─ chatHistory.push({
           │    role: "assistant",
           │    content: "Async in Rust enables..."
           │  })
           │
           ├─ Store updates
           │ 
           ▼
        AIPanel Re-renders
           │
           ├─ New message appears in chat
           │
           ▼
        ✅ User sees: "Async in Rust enables..."
```

This complete visualization shows how your fixed architecture works end-to-end!
