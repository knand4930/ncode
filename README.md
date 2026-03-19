# NCode

A VS Code-inspired desktop code editor built with Tauri, React, and Rust — with a built-in AI assistant powered by local and cloud LLMs.

![NCode](src-tauri/icons/icon.png)

---

## Overview

NCode is a cross-platform desktop IDE that combines a familiar editor experience with a deeply integrated AI coding assistant. It supports local models via Ollama, cloud providers (OpenAI, Anthropic, Groq), and an optional Python gRPC AI service for advanced features like RAG, agent mode, and multi-provider routing.

**Stack:**
- Frontend: React 18 + TypeScript + Monaco Editor
- Desktop shell: Tauri 2 (Rust)
- AI backend: Python gRPC service (optional)
- State: Zustand
- Styling: Tailwind CSS

---

## Features

### Editor
- Monaco Editor (same engine as VS Code)
- Multi-tab editing with unsaved change indicators
- File explorer with recursive directory tree
- Breadcrumb navigation
- Command palette (`Ctrl+Shift+P`)
- Quick open (`Ctrl+P`)
- Symbol search (`Ctrl+T`)
- Search & replace panel (`Ctrl+H`)
- Integrated terminal (xterm.js)
- Git panel
- Extensions panel
- Resizable panels (sidebar, editor, terminal, AI panel)

### AI Assistant
- **Chat mode** — direct Q&A with your codebase
- **Think mode** — step-by-step reasoning before answering
- **Agent mode** — multi-step planning with file-level actions
- **Bug Hunt mode** — systematic bug, vulnerability, and edge-case detection
- **Architect mode** — architecture review and refactoring suggestions
- `@file` context injection — attach the active file to any message
- File suggestion apply/reject with diff preview
- Shell command suggestions with one-click terminal execution
- AI change history with rollback support
- Multi-session chat history
- RAG (Retrieval-Augmented Generation) over your codebase
- Streaming responses with live token display

### AI Providers
| Provider | Type | Notes |
|---|---|---|
| Ollama | Local | Runs models on your machine |
| OpenAI | Cloud API | GPT-4, GPT-4o, etc. |
| Anthropic | Cloud API | Claude 3 family |
| Groq | Cloud API | Ultra-fast inference |
| AirLLM | Local | Split-model for low RAM |
| vLLM | Local/Cloud | High-throughput batched inference |

### Service Routing
- **Direct mode** — React → Rust → provider APIs (default, no extra setup)
- **gRPC mode** — React → Rust → Python gRPC service → provider APIs (enables advanced features)

### Appearance
- 7 built-in color themes: One Dark Pro, One Light, High Contrast, Solarized Dark, Monokai, GitHub Dark, Dracula
- 3 icon themes
- Configurable editor and UI fonts
- Adjustable font size, tab size, word wrap, minimap, format-on-save, auto-save

---

## Architecture

```
┌─────────────────────────────────────────┐
│           NCode (React + Tauri)          │
│                                          │
│  ┌──────────┐  ┌──────────┐  ┌────────┐ │
│  │  Editor  │  │ Sidebar  │  │AI Panel│ │
│  │ (Monaco) │  │ (Files,  │  │(Chat,  │ │
│  │          │  │  Git,    │  │ Agent, │ │
│  │          │  │  Search) │  │ RAG)   │ │
│  └──────────┘  └──────────┘  └────────┘ │
│                                          │
│  ┌──────────────────────────────────┐    │
│  │         Rust (Tauri) Backend     │    │
│  │  fs_commands · process_commands  │    │
│  │  terminal_commands · grpc_client │    │
│  └──────────────────────────────────┘    │
└─────────────────────────────────────────┘
              │              │
    ┌─────────┘              └──────────────┐
    ▼                                       ▼
Direct HTTP                         gRPC (optional)
(Ollama / OpenAI /              Python AI Service
 Anthropic / Groq)              (localhost:50051)
                                       │
                              ┌────────┴────────┐
                              ▼                 ▼
                           Ollama          OpenAI /
                         (local)        Anthropic / Groq
```

---

## Requirements

### Core
- [Node.js](https://nodejs.org/) 18+
- [Rust](https://rustup.rs/) (stable)
- [Tauri CLI prerequisites](https://tauri.app/start/prerequisites/) for your OS

### For local AI (Ollama)
- [Ollama](https://ollama.com/) installed and running

### For gRPC AI service (optional)
- Python 3.8+
- `pip` or `uv`

---

## Installation

### 1. Clone the repo

```bash
git clone https://github.com/your-username/ncode.git
cd ncode
```

### 2. Install frontend dependencies

```bash
npm install
```

### 3. (Optional) Set up the Python AI service

```bash
cd python-ai-service
python3 -m pip install -r requirements.txt
cp .env.example .env
# Edit .env with your API keys
```

### 4. (Optional) Generate protobuf stubs

```bash
cd python-ai-service
python3 -m grpc_tools.protoc -I. --python_out=. --grpc_python_out=. ai_service.proto
```

---

## Running

### Development

```bash
npm run tauri:dev
```

This starts the Vite dev server and the Tauri app together.

### Python AI service (if using gRPC mode)

```bash
cd python-ai-service
python3 main.py
```

Server starts on `localhost:50051`.

### Production build

```bash
npm run tauri:build
```

Output bundles (`.deb`, `.rpm`) are in `src-tauri/target/release/bundle/`.

---

## Configuration

### AI providers

Open Settings (`Ctrl+,`) → AI / LLM tab.

- **Ollama**: Set the base URL (default `http://localhost:11434`), click Fetch to load installed models, then check the ones you want to use.
- **Cloud APIs**: Select a provider, enter your API key and model name, click Add Key, then check it to activate.
- **Service route**: Switch between Direct and gRPC mode. gRPC mode requires the Python service to be running.

### Environment variables (Python service)

Copy `python-ai-service/.env.example` to `python-ai-service/.env`:

```env
# Server
GRPC_PORT=50051
GRPC_HOST=127.0.0.1
LOG_LEVEL=INFO

# Ollama
OLLAMA_BASE_URL=http://localhost:11434

# Cloud providers (optional)
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...
GROQ_API_KEY=gsk_...

# Features
ENABLE_CACHING=true
ENABLE_STREAMING=true

# RAG
RAG_CHUNK_SIZE=50
RAG_OVERLAP=10
RAG_MAX_CHUNKS=20

# Agent
AGENT_MAX_ITERATIONS=10
AGENT_REASONING_DEPTH=detailed
```

---

## Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| `Ctrl+P` | Quick open file |
| `Ctrl+Shift+P` | Command palette |
| `Ctrl+S` | Save file |
| `Ctrl+Shift+S` | Save all files |
| `Ctrl+W` | Close tab |
| `Ctrl+B` | Toggle sidebar |
| `Ctrl+`` ` `` | Toggle terminal |
| `Ctrl+,` | Settings |
| `Ctrl+Shift+A` | Toggle AI panel |
| `Ctrl+Shift+E` | Explorer view |
| `Ctrl+Shift+F` | Search view |
| `Ctrl+Shift+G` | Git view |
| `Ctrl+Shift+X` | Extensions view |
| `Ctrl+T` | Symbol search |
| `Ctrl+H` | Search & replace |

---

## Project Structure

```
ncode/
├── src/                        # React frontend
│   ├── components/
│   │   ├── ai/                 # AI panel, diff modal
│   │   ├── editor/             # Monaco editor, tabs, breadcrumbs, command palette
│   │   ├── sidebar/            # File explorer, git, search, symbols, tasks
│   │   ├── terminal/           # Integrated terminal
│   │   ├── settings/           # Settings panel
│   │   ├── statusbar/          # Status bar
│   │   └── titlebar/           # Title bar, menu bar
│   ├── store/                  # Zustand stores (editor, AI, UI, terminal)
│   └── utils/                  # Error parser, language runner, project scanner
├── src-tauri/                  # Rust/Tauri backend
│   ├── src/
│   │   ├── commands/           # fs, process, terminal Tauri commands
│   │   ├── ai/                 # AI Rust module
│   │   ├── lsp/                # LSP module
│   │   └── grpc_client.rs      # gRPC client for Python AI service
│   └── tauri.conf.json
└── python-ai-service/          # Optional Python gRPC AI backend
    ├── server.py               # gRPC server
    ├── main.py                 # Entry point
    ├── config.py               # Settings (pydantic)
    ├── prompts.py              # Prompt templates
    ├── rag_advanced.py         # RAG implementation
    ├── reasoning.py            # Reasoning/agent logic
    └── ai_service.proto        # Protobuf service definition
```

---

## Recommended Ollama Models

| Model | RAM | Notes |
|---|---|---|
| `qwen2.5-coder` | 4 GB | Lightweight, fast |
| `deepseek-coder` | 4 GB | Balanced quality |
| `codellama` | 4 GB | Best code quality |
| `mistral` | 4 GB | General purpose |
| `starcoder2` | 2 GB | Good for completions |

Install a model:

```bash
ollama pull qwen2.5-coder
```

---

## Troubleshooting

**Ollama not detected**
- Make sure `ollama serve` is running
- Check the base URL in Settings matches your Ollama instance
- Click "Start Ollama" in the AI panel warning banner

**gRPC service unreachable**
- Start the Python service: `cd python-ai-service && python3 main.py`
- Check port 50051 is not in use: `lsof -i :50051`
- Switch back to Direct mode in Settings if you don't need gRPC features

**Build fails (Rust)**
- Ensure Rust stable toolchain is installed: `rustup update stable`
- On Linux, install Tauri system dependencies: see [LINUX_SETUP.md](LINUX_SETUP.md)
- On macOS: see [MACOS_SETUP.md](MACOS_SETUP.md)
- On Windows: see [WINDOWS_SETUP.md](WINDOWS_SETUP.md)

**Protobuf build errors**
- Install `protoc`: `apt install protobuf-compiler` (Linux) or `brew install protobuf` (macOS)
- Or set the `skip-protobuf-build` feature flag in `Cargo.toml`

---

## Platform Setup Guides

- [Linux](LINUX_SETUP.md)
- [macOS](MACOS_SETUP.md)
- [Windows](WINDOWS_SETUP.md)
- [gRPC setup](SETUP_GRPC.md)

---

## License

MIT
