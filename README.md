# NCode — VS Code Clone with AI (Tauri + React)

A full VS Code-like editor built with **Tauri + React**, featuring:
- Monaco Editor (same engine as VS Code)
- Quick file open (Ctrl+P) with fuzzy search
- Search & Replace panel with regex support (Ctrl+H)
- Symbol navigation (Ctrl+T) and multi-cursor editing
- Settings dialog & keyboard shortcut viewer
- Extension system / plugin marketplace (basic)
- 40+ language syntax support
- Built-in terminal
- Git branch indicator in status bar
- AI autocomplete (local LLM via Ollama, 1–2GB RAM)
- Cursor-like AI RAG (codebase indexing + chat)

---

## Stack

| Layer | Tech |
|-------|------|
| Shell | Tauri 2.x (Rust) |
| UI | React 18 + TypeScript |
| Editor | Monaco Editor |
| State | Zustand |
| Styling | Tailwind CSS |
| AI (basic) | Ollama (codellama:7b-code-q4, ~4GB) or deepseek-coder:1.3b (~1GB) |
| AI (RAG) | LlamaIndex.ts + local embeddings |
| Extensions | Custom plugin system |

---

## Setup

```bash
# Prerequisites
# - Rust: https://rustup.rs
# - Node 18+
# - Tauri CLI: cargo install tauri-cli

# 1. Clone
git clone <repo>
cd NCode

# 2. Install deps
npm install

# 3. Run dev
npm run tauri dev

# 4. Build
npm run tauri build
```

---

## AI Setup (Ollama)

The editor will automatically check for a running Ollama daemon on startup and populate a model list. You can select a single model or, starting with the latest release, mark multiple models to run in parallel. Use the dropdown in the AI panel (top‑right of the AI view) or go to **Settings → AI / LLM** to manage models and providers.

If Ollama is not installed or you prefer cloud services, the settings page also offers an **API Key** form. Enter a provider name (e.g. `openai`), the target model (e.g. `gpt-3.5-turbo`), and the key. You may add as many keys/providers as you like. Once added, the AI panel dropdown will list your API keys alongside any Ollama models so you can switch freely.

**Quick start instructions** (Ollama only):

```bash
# Install Ollama: https://ollama.ai
# For 1GB RAM (basic suggestions):
ollama pull deepseek-coder:1.3b

# For 2-4GB RAM (better quality):
ollama pull codellama:7b-code-q4_0
ollama pull nomic-embed-text  # for RAG embeddings
```

---

## Roadmap / Missing Features

While NCode now includes many productivity features, the following capabilities
remain on the roadmap:

* Full LSP-based go‑to‑definition & references
* Language linting/analysis (ESLint, Pylint) and type‑checking
* Integrated debugger (breakpoints, step controls, variable watch)
* Complete Git UI (commit, diff, branch management, merge conflict resolution)
* Task runner & build tool integration
* Workspace/multi‑folder support and drag‑and‑drop explorer
* Collaboration (live share, remote SSH/containers)
* Dependency vulnerability scanning & refactoring tools

Contributions and suggestions are welcome!


```bash
# Install Ollama: https://ollama.ai
# For 1GB RAM (basic suggestions):
ollama pull deepseek-coder:1.3b

# For 2-4GB RAM (better quality):
ollama pull codellama:7b-code-q4_0
ollama pull nomic-embed-text  # for RAG embeddings
```

---

## Architecture

```
src/
├── components/
│   ├── editor/          # Monaco editor wrapper, tabs, diff view
│   ├── sidebar/         # File explorer, search, git, extensions
│   ├── terminal/        # Integrated terminal (xterm.js)
│   ├── ai/              # AI chat panel, inline suggestions, RAG
│   ├── extensions/      # Extension marketplace + loader
│   └── statusbar/       # Bottom status bar
├── hooks/               # useEditor, useAI, useFileSystem, useTerminal
├── store/               # Zustand stores (editor, AI, extensions, UI)
├── utils/               # File ops, language detection, RAG indexer
└── types/               # TypeScript interfaces

src-tauri/
├── src/
│   ├── main.rs          # Tauri app entry
│   ├── commands/        # File system, terminal, process commands
│   ├── lsp/             # LSP bridge for language servers
│   └── ai/              # Ollama bridge, RAG pipeline
```
