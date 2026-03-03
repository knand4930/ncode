# NCode — AI-Powered Code Editor (Tauri + React)

<div align="center">

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Tauri](https://img.shields.io/badge/Tauri-2.x-blue)](https://tauri.app)
[![React](https://img.shields.io/badge/React-18-blue)](https://react.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue)](https://www.typescriptlang.org)

**A lightweight VS Code alternative with built-in AI assistance, perfect for code editing and development.**

[Features](#features) • [Installation](#installation) • [Usage](#usage) • [Configuration](#configuration) • [Troubleshooting](#troubleshooting)

</div>

---

## Features

### Editor
- 🎨 **Monaco Editor** - Same engine as VS Code
- 🔍 **Quick Open** - Fuzzy file search (Ctrl+P)
- 🔄 **Search & Replace** - With regex support (Ctrl+H)
- 📍 **Symbol Navigation** - Jump to symbols (Ctrl+T)
- 🎯 **Multi-cursor Editing** - Advanced text editing
- 40+ **Language Support** - Syntax highlighting for all major languages
- ⚙️ **Settings Panel** - Customizable editor preferences
- 🎨 **Theme Support** - Multiple color themes

### Developer Tools
- 💻 **Built-in Terminal** - Integrated shell (bash, zsh, powershell)
- 🔗 **Git Integration** - Branch info, staging, commits
- 📦 **Extension System** - Plugin marketplace (basic)
- 🛠️ **Command Palette** - Quick access to commands
- 📂 **File Explorer** - Browse and manage files

### AI Features
- 🤖 **AI Chat** - Multi-provider LLM support
- 💡 **Code Completion** - Context-aware suggestions
- 🧠 **RAG (Retrieval-Augmented Generation)** - Codebase awareness
- 🔧 **Multiple Providers** - Ollama (local) + OpenAI + Anthropic + Groq
- 💾 **Chat Persistence** - Conversations saved across sessions
- 🚀 **Streaming Responses** - Real-time token display

---

## Tech Stack

| Component | Technology |
|-----------|------------|
| **Desktop Shell** | Tauri 2.x (Rust) |
| **UI Framework** | React 18 + TypeScript |
| **Editor Engine** | Monaco Editor |
| **State Management** | Zustand |
| **Styling** | Tailwind CSS |
| **Terminal** | xterm.js |
| **AI (Local)** | Ollama |
| **AI (Cloud)** | OpenAI, Anthropic, Groq |
| **AI Service** | Python gRPC (optional) |

---

## Installation

### Prerequisites

Choose your operating system:

#### Linux (Ubuntu/Debian)

```bash
# Update package manager
sudo apt update
sudo apt upgrade -y

# Install dependencies
sudo apt install -y \
    curl \
    git \
    build-essential \
    libssl-dev \
    pkg-config \
    libgtk-3-dev \
    libayatana-appindicator3-dev \
    librsvg2-dev

# Node.js 18+ (using nvm - recommended)
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash
source ~/.bashrc
nvm install 18
nvm use 18

# Verify installations
node --version   # Should be v18.x.x
npm --version    # Should be 9.x.x
```

#### macOS

```bash
# Install Homebrew (if not already installed)
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

# Install dependencies
brew install rustup-init node

# Install Rust
rustup-init -y
source $HOME/.cargo/env

# Verify installations
node --version   # Should be v18.x.x
npm --version    # Should be 9.x.x
rustc --version  # Should be recent stable
```

#### Windows

1. **Install Node.js 18+**
   - Download from https://nodejs.org/
   - Run the installer and follow steps
   - Verify: Open PowerShell and run:
     ```powershell
     node --version
     npm --version
     ```

2. **Install Rust**
   - Download from https://www.rust-lang.org/tools/install
   - Run `rustup-init.exe`
   - Follow the installation steps
   - Verify:
     ```powershell
     rustc --version
     cargo --version
     ```

3. **Install Visual C++ Build Tools** (if needed)
   - Download from https://aka.ms/vs/17/release/vs_BuildTools
   - Select "Desktop development with C++"
   - Complete installation

4. **Install Git** (optional but recommended)
   - Download from https://git-scm.com/
   - Use default installation settings

---

### Clone & Setup

#### Linux / macOS

```bash
# Clone repository
git clone https://github.com/yourusername/ncode.git
cd ncode

# Install dependencies
npm install

# Install Tauri CLI
cargo install tauri-cli

# Run development server
npm run dev

# Build for production
npm run build

# Create installers
npm run tauri build
```

#### Windows (PowerShell)

```powershell
# Clone repository
git clone https://github.com/yourusername/ncode.git
cd ncode

# Install dependencies
npm install

# Install Tauri CLI
cargo install tauri-cli

# Run development server
npm run dev

# Build for production
npm run build

# Create installers
npm run tauri build
```

---

## Quick Start

### 1. Start the Editor

**Development Mode:**
```bash
npm run tauri dev
```

**Release Build:**
- Linux/macOS: `/target/release/ncode`
- Windows: `/target/release/ncode.exe`

### 2. Basic Keybindings

| Shortcut | Action |
|----------|--------|
| `Ctrl+P` | Quick open files |
| `Ctrl+H` | Search & replace |
| `Ctrl+F` | Find in file |
| `Ctrl+T` | Jump to symbol |
| `Ctrl+/` | Toggle comment |
| `Ctrl+Shift+D` | Debug |
| `Ctrl+Shift+G` | Open Git |
| `Ctrl+Shift+X` | Extensions |
| `Ctrl+,` | Settings |
| `` Ctrl+` `` | Toggle terminal |

### 3. Open a Project

1. Click **File Explorer** (left sidebar)
2. Click "Open Folder"
3. Select your project directory
4. Start editing!

---

## AI Setup

### Option 1: Local AI (Ollama) — Recommended for Beginners

#### Installation

**Linux:**
```bash
# Download and install
curl -fsSL https://ollama.ai/install.sh | sh

# Or use package manager
sudo apt install ollama  # Debian/Ubuntu

# Start Ollama service
ollama serve
```

**macOS:**
```bash
# Download from https://ollama.ai or:
brew install ollama

# Start Ollama
ollama serve
```

**Windows:**
```powershell
# Download installer from https://ollama.ai/download
# Run the .exe installer

# Start Ollama (runs in background automatically)
ollama serve
```

#### Pull Models

```bash
# Lightweight (1GB RAM) - Good for basic suggestions
ollama pull deepseek-coder:1.3b

# Medium (2-4GB RAM) - Balanced quality/speed
ollama pull codellama:7b-code-q4_0

# Better quality (4+ GB RAM) - Slower but smarter
ollama pull codellama:13b-code-q4_0

# For RAG/embeddings (optional)
ollama pull nomic-embed-text
```

#### Configure in NCode

1. Open **Settings** (Ctrl+,)
2. Go to **AI / LLM** tab
3. Select **"Ollama (Local)"** provider
4. Click **"Fetch"** button
5. Select a model from the dropdown
6. Start chatting!

### Option 2: Cloud AI — OpenAI, Anthropic, Groq

#### Get API Keys

1. **OpenAI:**
   - Visit https://platform.openai.com/api-keys
   - Create new API key
   - Copy the key

2. **Anthropic (Claude):**
   - Visit https://console.anthropic.com/
   - Create new API key
   - Copy the key

3. **Groq:**
   - Visit https://console.groq.com/
   - Create new API key
   - Copy the key

#### Configure in NCode

1. Open **Settings** (Ctrl+,)
2. Go to **AI / LLM** tab
3. Select **"API Key (Cloud)"** provider
4. Choose provider (OpenAI, Anthropic, Groq)
5. Paste your API key
6. Enter model name (e.g., `gpt-4o`, `claude-3-sonnet`, `mixtral-8x7b-32768`)
7. Click **"Add Key"**
8. Start chatting!

### Option 3: Hybrid Setup (HTTP + gRPC)

For advanced features like caching and monitoring:

```bash
# Install Python service
cd python-ai-service
python3 -m pip install -r requirements.txt

# Generate protobuf code
python3 -m grpc_tools.protoc -I. --python_out=. --grpc_python_out=. ai_service.proto

# Start service (runs on localhost:50051)
python3 main.py
```

See [python-ai-service/README.md](./python-ai-service/README.md) for details.

---

## Usage & Use Cases

### Use Case 1: Web Development

```
Project: React Todo App
├── src/
│   ├── components/
│   │   ├── TodoList.tsx
│   │   └── TodoItem.tsx
│   ├── App.tsx
│   └── main.tsx
└── package.json

Steps:
1. Open folder in NCode
2. Use Ctrl+P to quickly jump between files
3. Use Ctrl+F to search for specific components
4. Ask AI: "Generate TypeScript types for todos"
5. Use built-in terminal to run:
   - npm start
   - npm run build
   - npm test
```

### Use Case 2: Code Review & Refactoring

```
Ask AI:
✓ "Review this function for performance issues"
✓ "Refactor this code to use async/await"
✓ "Add error handling to this endpoint"
✓ "Optimize database queries in this module"

AI will:
- Analyze your code
- Suggest improvements
- Reference similar patterns
- Explain reasoning
```

### Use Case 3: Project Analysis

```
Ask AI:
✓ "Analyze this codebase one by one"
✓ "Find potential bugs in the architecture"
✓ "What are the main dependencies?"
✓ "Suggest improvements for scalability"

RAG Mode:
- Searches through all files
- Understands project structure
- Provides file-specific suggestions
```

### Use Case 4: Learning & Debugging

```
Ask AI:
✓ "Explain how this algorithm works"
✓ "Why is my code throwing this error?"
✓ "How do I implement OAuth in Node.js?"
✓ "What's the best practice for error handling?"

AI will:
- Provide explanations with code examples
- Debug errors with context
- Suggest best practices
- Reference documentation
```

### Use Case 5: Documentation

```
Ask AI:
✓ "Generate JSDoc comments for this file"
✓ "Create API documentation from this code"
✓ "Write unit tests for this function"
✓ "Generate a README for this module"

Output:
- Professional documentation
- Test templates
- Code examples
```

---

## Configuration

### Editor Settings

| Setting | Options | Default |
|---------|---------|---------|
| **Theme** | One Dark Pro, GitHub, Dracula | One Dark Pro |
| **Font Size** | 10-24px | 14px |
| **Tab Size** | 2, 4, 8 spaces | 2 spaces |
| **Word Wrap** | On / Off | On |
| **Minimap** | On / Off | On |
| **Auto Save** | On / Off | On |
| **Format on Save** | On / Off | Off |

### AI Configuration

**Environment Variables** (optional):

```bash
# For Ollama
export OLLAMA_BASE_URL=http://localhost:11434

# For OpenAI
export OPENAI_API_KEY=sk-...

# For Anthropic
export ANTHROPIC_API_KEY=sk-ant-...

# For Groq
export GROQ_API_KEY=gsk-...
```

**Configuration File** (~/.ncode/config.json):

```json
{
  "editor": {
    "fontSize": 14,
    "tabSize": 2,
    "wordWrap": true,
    "theme": "one-dark-pro"
  },
  "ai": {
    "provider": "ollama",
    "baseUrl": "http://localhost:11434",
    "model": "deepseek-coder:1.3b"
  },
  "features": {
    "rag": true,
    "codeCompletion": true,
    "chatPersistence": true
  }
}
```

---

## Development

### Building from Source

**Prerequisites:**
- Rust 1.70+ ([install](https://rustup.rs))
- Node.js 18+ ([install](https://nodejs.org))
- Git

**Build Steps:**

```bash
# Clone and setup
git clone https://github.com/yourusername/ncode.git
cd ncode

# Install dependencies
npm install

# Development mode (hot reload)
npm run dev

# Production build
npm run build

# Create platform-specific installers
npm run tauri build  # All platforms
npm run tauri build -- --target x86_64-unknown-linux-gnu  # Linux 64-bit
npm run tauri build -- --target x86_64-pc-windows-msvc    # Windows 64-bit
npm run tauri build -- --target x86_64-apple-darwin       # macOS Intel
npm run tauri build -- --target aarch64-apple-darwin      # macOS Apple Silicon
```

### Project Structure

```
ncode/
├── src/                           # React frontend (TypeScript)
│   ├── components/                # UI components
│   │   ├── ai/                    # AI chat panel
│   │   ├── editor/                # Monaco editor
│   │   ├── sidebar/               # File explorer, git, search
│   │   ├── terminal/              # Integrated terminal
│   │   ├── settings/              # Settings dialog
│   │   └── statusbar/             # Bottom status bar
│   ├── store/                     # Zustand state management
│   │   ├── aiStore.ts             # AI state & logic
│   │   ├── editorStore.ts         # Editor state
│   │   └── uiStore.ts             # UI preferences
│   ├── hooks/                     # Custom React hooks
│   ├── utils/                     # Helper functions
│   ├── types/                     # TypeScript types
│   ├── App.tsx                    # Main app component
│   └── main.tsx                   # Entry point
│
├── src-tauri/                     # Tauri backend (Rust)
│   ├── src/
│   │   ├── main.rs                # Tauri app setup
│   │   ├── commands/              # Tauri commands
│   │   │   ├── fs_commands.rs     # File system ops
│   │   │   ├── terminal_commands.rs # Terminal ops
│   │   │   ├── process_commands.rs # Process execution
│   │   │   └── mod.rs             # Command registry
│   │   ├── ai/                    # AI integration
│   │   │   ├── mod.rs             # Ollama & RAG bridge
│   │   │   └── types.rs           # AI type definitions
│   │   ├── lsp/                   # Language server protocol
│   │   └── lib.rs                 # Library exports
│   ├── Cargo.toml                 # Rust dependencies
│   └── tauri.conf.json            # Tauri configuration
│
├── python-ai-service/             # Python gRPC server (optional)
│   ├── server.py                  # gRPC service
│   ├── config.py                  # Configuration
│   ├── ai_service.proto           # Protocol buffer definitions
│   └── requirements.txt           # Python dependencies
│
├── README.md                      # This file
├── INSTALLATION.md                # Detailed installation guide
├── AI_UPDATES_SUMMARY.md          # AI feature changelog
├── package.json                   # Node.js configuration
├── tsconfig.json                  # TypeScript configuration
└── vite.config.ts                 # Vite bundler configuration
```

### Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Write/update tests
5. Submit a pull request

---

## Troubleshooting

### Installation Issues

#### "Command not found: cargo"
- **Linux/macOS:** Run `source $HOME/.cargo/env`
- **Windows:** Restart PowerShell or VS Code
- **Solution:** Re-run Rust installer

#### "npm command not found"
- **Linux/macOS:** Run `nvm use 18` or `source ~/.bashrc`
- **Windows:** Restart PowerShell after Node.js installation
- **Solution:** Verify Node.js installed: `node --version`

#### "Tauri CLI not found"
```bash
cargo install tauri-cli
# or if already installed:
cargo install tauri-cli --force
```

### AI Setup Issues

#### Ollama not connecting
```bash
# Check if service is running
ps aux | grep ollama  # Linux/macOS
tasklist | findstr ollama  # Windows

# Check port is open
curl http://localhost:11434/api/tags  # Should return JSON

# Restart Ollama
# Kill the process and run: ollama serve
```

#### API key authentication fails
- Verify key is correctly copied (no extra spaces)
- Check API key is active on provider's dashboard
- Try with a test request first:
  ```bash
  curl -H "Authorization: Bearer YOUR_KEY" https://api.openai.com/v1/models
  ```

#### Chat not responding
1. Go to **Settings → AI / LLM**
2. Check "Current Provider" field
3. Verify model is selected
4. Click "Fetch" button to refresh models
5. Try a simple message first
6. Check browser console (F12) for errors

### Performance Issues

#### Editor is slow
- **Solution:** Disable Minimap (Settings → Minimap)
- **Solution:** Close large files (>10MB)
- **Solution:** Reduce theme effects

#### AI responses are slow
- **Ollama:** Model might be too large, try smaller model
- **API:** Check internet connection, API provider status
- **Solution:** See response time in chat message metadata

#### High CPU/Memory usage
- **Solution:** Close unused files
- **Solution:** Reduce terminal buffer size
- **Solution:** Disable RAG if not needed
- **Solution:** Use lighter Ollama model

### Platform-Specific

#### Linux: "libssl-dev not found"
```bash
# Ubuntu/Debian
sudo apt install libssl-dev

# Fedora/RHEL
sudo dnf install openssl-devel

# Arch
sudo pacman -S openssl
```

#### macOS: "Code signature invalid"
```bash
# Remove quarantine attribute
xattr -d com.apple.quarantine /Applications/NCode.app
```

#### Windows: "Visual C++ build tools required"
- Download: https://aka.ms/vs/17/release/vs_BuildTools
- Select "Desktop development with C++"
- Restart installation

---

## Performance Metrics

### Memory Usage
| Component | Typical | Peak |
|-----------|---------|------|
| Editor (idle) | 80-120 MB | 150-200 MB |
| With Ollama model loaded | 200-500 MB | 600-1,200 MB |
| Browser DevTools | +100-200 MB | +300-500 MB |

### Startup Time
| Platform | Time |
|----------|------|
| Linux | 2-3 seconds |
| macOS | 2-4 seconds |
| Windows | 3-5 seconds |

### AI Response Time
| Provider | Model | Time |
|----------|-------|------|
| Ollama | deepseek-coder:1.3b | 1-3 seconds |
| Ollama | codellama:7b-code-q4_0 | 3-8 seconds |
| OpenAI | gpt-4 | 2-5 seconds |
| OpenAI | gpt-3.5-turbo | 1-3 seconds |
| Anthropic | claude-3-sonnet | 2-6 seconds |

---

## Keyboard Shortcuts Reference

### File Operations
| Shortcut | Action |
|----------|--------|
| `Ctrl+N` | New file |
| `Ctrl+O` | Open file |
| `Ctrl+Shift+O` | Open folder |
| `Ctrl+S` | Save |
| `Ctrl+Shift+S` | Save all |
| `Ctrl+W` | Close tab |
| `Ctrl+Shift+W` | Close all tabs |

### Editing
| Shortcut | Action |
|----------|--------|
| `Ctrl+C` | Copy |
| `Ctrl+X` | Cut |
| `Ctrl+V` | Paste |
| `Ctrl+Z` | Undo |
| `Ctrl+Y` | Redo |
| `Ctrl+/` | Toggle comment |
| `Ctrl+Shift+K` | Delete line |
| `Alt+Up/Down` | Move line |
| `Alt+Shift+Up/Down` | Copy line |

### Navigation
| Shortcut | Action |
|----------|--------|
| `Ctrl+G` | Go to line |
| `Ctrl+T` | Go to symbol |
| `Ctrl+P` | Quick open |
| `Ctrl+Shift+P` | Command palette |
| `Ctrl+Tab` | Switch tab |
| `Ctrl+Shift+Tab` | Switch to previous tab |

### Search
| Shortcut | Action |
|----------|--------|
| `Ctrl+F` | Find |
| `Ctrl+H` | Replace |
| `F3` | Find next |
| `Shift+F3` | Find previous |
| `Ctrl+Shift+F` | Find in files |
| `Ctrl+Shift+H` | Replace in files |

### Panel Toggles
| Shortcut | Action |
|----------|--------|
| `Ctrl+B` | Toggle sidebar |
| `Ctrl+J` | Toggle terminal |
| `` Ctrl+` `` | Focus terminal |
| `Ctrl+,` | Settings |
| `Ctrl+Shift+D` | Debug |
| `Ctrl+Shift+G` | Source control |
| `Ctrl+Shift+X` | Extensions |

---

## Roadmap

### Completed ✅
- Monaco Editor integration
- File explorer & basic file ops
- Search & replace with regex
- Git status integration
- AI Chat (multiple providers)
- Chat history persistence
- Syntax highlighting (40+ languages)
- Settings dialog
- Terminal integration
- RAG support (Ollama)

### In Progress 🔄
- LSP support (go to definition, references)
- Full Git workflow UI (commit, diff, branches)
- Debugger integration
- Extension marketplace (full implementation)
- Streaming token display

### Planned 📋
- Code intelligence (linting, type checking)
- Build task runner
- Multi-workspace support
- Remote SSH edit
- Live collaboration
- Integrated package manager UI

---

## FAQ

**Q: Can I use NCode on work projects?**  
A: Yes! It's a full-featured editor suitable for professional development.

**Q: Is the AI feature free?**  
A: Local Ollama models are free. Cloud APIs (OpenAI, etc.) charge per usage.

**Q: Can I contribute?**  
A: Absolutely! See the [Contributing](#contributing) section.

**Q: Where are my files stored?**  
A: Files remain on your local disk. NCode just reads them.

**Q: Is my code private?**  
A: With Ollama (local), yes. Cloud APIs send code to their servers.

**Q: Can I run multiple instances?**  
A: Yes, but each instance has separate state and settings.

**Q: Will you add more AI providers?**  
A: Yes, we're always adding support for new LLM providers.

---

## License

This project is licensed under the **MIT License** - see [LICENSE](./LICENSE) file for details.

---

## Support

- 📖 [Documentation](./README.md)
- 🐛 [Report Issues](https://github.com/yourusername/ncode/issues)
- 💬 [Discussions](https://github.com/yourusername/ncode/discussions)
- 🗺️ [Roadmap](./ROADMAP.md)

---

## Acknowledgments

- [Tauri](https://tauri.app) - Desktop app framework
- [Monaco Editor](https://microsoft.github.io/monaco-editor/) - Code editor engine
- [React](https://react.dev) - UI framework
- [Ollama](https://ollama.ai) - Local LLM support

---

<div align="center">

Made with ❤️ by NCode contributors

**[Star ⭐](https://github.com/knand4930/ncode) | [Fork 🍴](https://github.com/knand4930/ncode/fork) | [Share 📢](twitter.com)**

</div>
