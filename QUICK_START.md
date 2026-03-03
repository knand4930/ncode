# NCode Quick Start Guide

Get up and running with NCode in 5 minutes!

## 5-Minute Setup

### Choose Your Path

#### Path A: Existing Developer (Already have Node & Rust)
```bash
git clone https://github.com/yourusername/ncode.git
cd ncode
npm install
cargo install tauri-cli
npm run tauri dev
```
**Done!** App opens automatically.

#### Path B: First Time Setup

# **Linux / macOS:**
```bash
# 1. Install prerequisites (3 min)
brew install node rust     # macOS
# Ubuntu: curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash

# 2. Clone and run (2 min)
git clone https://github.com/yourusername/ncode.git
cd ncode
npm install && cargo install tauri-cli
npm run tauri dev
```

**Windows (PowerShell):**
```powershell
# 1. Download installers (3 min):
#    - Node.js 18+: https://nodejs.org
#    - Rust: https://www.rust-lang.org/tools/install
#    - Visual C++ Build Tools: https://aka.ms/vs/17/release/vs_BuildTools
# (Restart after each installer)

# 2. Clone and run (2 min):
git clone https://github.com/yourusername/ncode.git
cd ncode
npm install
cargo install tauri-cli
npm run tauri dev
```

---

## Basic Usage (2 minutes)

### 1. Open a Project
- Click "Open Folder" in left sidebar
- Choose your code directory
- Files appear in explorer

### 2. Edit Files
- Double-click to open files
- Edit with full Monaco features
- Auto-saves every 5 seconds

### 3. Quick Navigation
| Key | Action |
|-----|--------|
| `Ctrl+P` | Search & open files |
| `Ctrl+/` | Comment/uncomment |
| `Ctrl+H` | Search & replace |
| `Ctrl+T` | Jump to symbol |
| `` Ctrl+` `` | Open terminal |

### 4. Use the Terminal
```bash
# Integrated terminal appears at bottom
npm run dev         # Run any command
npm install         # Install packages
npm test            # Run tests
```

### 5. Use AI
- Press Ctrl+Shift+A or click AI icon (top right)
- Type a question
- Select provider (Ollama or API Key)
- Get instant answers!

---

## AI Setup (Choose One)

### Option 1: Free Local AI (Ollama) — RECOMMENDED FOR BEGINNERS

```bash
# 1. Install Ollama (choose your OS)
# macOS: brew install ollama
# Linux: curl -fsSL https://ollama.ai/install.sh | sh
# Windows: Download from https://ollama.ai

# 2. Pull a model (pick one):
ollama pull deepseek-coder:1.3b    # Lightest (1GB)
# OR
ollama pull codellama:7b-code-q4_0  # Better (4GB)

# 3. Start Ollama
ollama serve    # Runs in background

# 4. In NCode:
# Settings (Ctrl+,) → AI / LLM → Ollama → Click "Fetch"
# Select your model → Start chat!
```

### Option 2: Cloud AI (Instant, No Setup)

1. Get API key:
   - **OpenAI:** https://platform.openai.com/api-keys
   - **Anthropic:** https://console.anthropic.com/
   - **Groq (Free!):** https://console.groq.com/

2. In NCode:
   - Settings → AI / LLM
   - Select "API Key (Cloud)"
   - Choose provider
   - Paste your key
   - Start chat!

---

## Common Tasks

### Writing & Debugging

**Ask AI:**
```
✓ "Write a function to sort an array"
✓ "Why is my code throwing an error?"
✓ "Explain this algorithm"
✓ "Add error handling here"
```

### Code Review

**Ask AI:**
```
✓ "Review this function for bugs"
✓ "Is this performant?"
✓ "Refactor this to be cleaner"
✓ "What security issues do you see?"
```

### Learning

**Ask AI:**
```
✓ "How do I use async/await?"
✓ "What's the difference between let and const?"
✓ "Show me examples of React hooks"
✓ "Explain promises in JavaScript"
```

### Generate Code

**Ask AI:**
```
✓ "Create a login form component"
✓ "Write unit tests for this function"
✓ "Generate API documentation"
✓ "Create database schema for a blog"
```

---

## Keyboard Shortcuts Cheat Sheet

### Navigation & Editing
| Shortcut | What it does |
|----------|--------------|
| `Ctrl+P` | Open any file quickly |
| `Ctrl+H` | Find & replace |
| `Ctrl+F` | Find in file |
| `Ctrl+T` | Jump to symbol/function |
| `Ctrl+G` | Go to line number |
| `Ctrl+/` | Toggle comment |
| `Ctrl+D` | Select current word |
| `Ctrl+L` | Select entire line |

### File & Editor
| Shortcut | What it does |
|----------|--------------|
| `Ctrl+N` | New file |
| `Ctrl+S` | Save file |
| `Ctrl+W` | Close file |
| `Ctrl+Tab` | Switch to next file |
| `Ctrl+Shift+Tab` | Switch to previous file |
| `Ctrl+Shift+Del` | Delete file |

### UI Panels
| Shortcut | What it does |
|----------|--------------|
| `Ctrl+B` | Toggle file explorer |
| `Ctrl+J` | Toggle terminal |
| `Ctrl+,` | Open settings |
| `Ctrl+Shift+G` | Git panel |
| `Ctrl+Shift+X` | Extensions |
| `Ctrl+Shift+A` | AI chat |

### Editing
| Shortcut | What it does |
|----------|--------------|
| `Ctrl+Z` | Undo |
| `Ctrl+Y` | Redo |
| `Ctrl+C` | Copy |
| `Ctrl+X` | Cut |
| `Ctrl+V` | Paste |
| `Alt+Up` | Move line up |
| `Alt+Down` | Move line down |
| `Shift+Alt+Up` | Copy line up |
| `Shift+Alt+Down` | Copy line down |

---

## Settings You Should Know

Go to **Settings** (Ctrl+,):

### Editor
- **Font Size:** 10-24px (default: 14)
- **Tab Size:** 2/4/8 spaces (default: 2)
- **Word Wrap:** On/Off
- **Auto Save:** On/Off
- **Theme:** One Dark Pro, GitHub, Dracula

### AI / LLM
- **Provider:** Ollama (local) or API (cloud)
- **Model:** Select from dropdown
- **Base URL:** localhost:11434 (for Ollama)

---

## Troubleshooting

### "npm command not found"
- **Linux/macOS:** Restart terminal
- **Windows:** Restart PowerShell

### "Ollama not connecting"
```bash
# Make sure Ollama is running:
ollama serve    # Leave this open in another terminal

# Check if it's working:
# Open browser to http://localhost:11434/api/tags
# You should see JSON with model list
```

### "AI won't respond"
1. **Settings → AI / LLM**
2. Check "Current Provider" is set
3. Click "Fetch" to refresh models
4. Select a model from dropdown
5. Try again

### App is slow
1. Close large files (>10MB)
2. Disable Minimap (Settings → Minimap)
3. Use lighter theme

### Can't install dependencies
```bash
# Clear and reinstall
rm -rf node_modules package-lock.json
npm install

# Then
npm run tauri dev
```

---

## Next Steps

1. **Customize Settings:**
   - Font size, theme, tab size
   - AI provider & model

2. **Learn More:**
   - Full docs: [README.md](./README.md)
   - Installation guide: [INSTALLATION.md](./INSTALLATION.md)
   - AI features: [AI_UPDATES_SUMMARY.md](./AI_UPDATES_SUMMARY.md)

3. **Open a Real Project:**
   - Clone a GitHub repo
   - Open your work project
   - Start editing with AI help!

4. **Share Feedback:**
   - Report issues on GitHub
   - Suggest features
   - Contribute improvements

---

## Tips & Tricks

### Speed Up Your Workflow

**👀 Use Quick Open:**
- Ctrl+P to find any file instantly
- Type partial name (e.g., "app" finds "App.tsx")
- Hit Enter to open

**🔍 Smart Search:**
- Ctrl+H to find & replace patterns
- Use regex for complex replacements
- Perfect for renaming across files

**🤖 Let AI Help:**
- Stuck on debugging? Ask AI
- Need documentation? AI writes it
- Want code examples? AI generates them

**⚡ Keyboard is Faster:**
- Learn shortcuts (see cheat sheet above)
- Mouse only for file browser
- Productivity multiplies with keyboard skills

### Best Practices

✅ **Do:**
- Use Ctrl+P instead of clicking files
- Use terminal for commands
- Save frequently (auto-save helps)
- Close unused files

❌ **Don't:**
- Edit 100+ files at once (gets slow)
- Use On massive binary files
- Expect perfect AI code (review & test)
- Forget to commit to git!

---

## Getting More Help

| Question | Answer |
|----------|--------|
| How do I...? | See [README.md](./README.md) |
| Installation issues? | See [INSTALLATION.md](./INSTALLATION.md) |
| Detailed AI docs? | See [python-ai-service/README.md](./python-ai-service/README.md) |
| Report a bug? | GitHub Issues |
| Request a feature? | GitHub Discussions |

---

## Welcome to NCode! 🚀

You're ready to code with AI superpowers. Start by opening a project and asking AI for help!

**Have fun coding!**
