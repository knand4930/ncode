# macOS Installation Guide for NCode

Complete step-by-step guide for macOS users (Monterey, Ventura, Sonoma).

## Prerequisites

- macOS 11 (Monterey) or newer
- Apple Silicon (M1/M2/M3) or Intel processor
- Administrator access
- 10GB free disk space
- Internet connection

## Apple Silicon vs Intel

Some step differences. **Check your Mac:**
1. Click Apple logo (top-left)
2. Select "About This Mac"
3. Look for CPU info

---

## Installation Steps (All Users)

### ✅ Step 1: Install Homebrew (2 minutes)

Homebrew is a package manager that makes installing software easy on macOS.

1. **Open Terminal:**
   - Press Cmd+Space
   - Type "Terminal"
   - Press Enter

2. **Copy and paste this command:**
   ```bash
   /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
   ```

3. **Press Enter**

4. **It will ask for your password:**
   - Type your Mac password
   - Press Enter
   - (It won't show as you type)

5. **Wait for installation** (2-3 minutes)

6. **After installation completes, run:**
   ```bash
   brew --version
   ```
   Should show version like `Homebrew 4.0.0`

---

### ✅ Step 2: Install Node.js (2 minutes)

Using Homebrew:

1. **In Terminal, run:**
   ```bash
   brew install node
   ```

2. **Wait for installation** (1-2 minutes)

3. **Verify it worked:**
   ```bash
   node --version
   npm --version
   ```

   Should show versions like `v18.15.0` and `9.x.x`

---

### ✅ Step 3: Install Rust (2 minutes)

1. **In Terminal, run:**
   ```bash
   curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
   ```

2. **When asked for the default option:**
   - Press Enter to select default (option 1)

3. **Wait for installation** (1-2 minutes)

4. **Load Rust in current session:**
   ```bash
   source "$HOME/.cargo/env"
   ```

5. **Verify it worked:**
   ```bash
   rustc --version
   cargo --version
   ```

   Should show version information

---

### ✅ Step 4: Clone NCode Repository (2 minutes)

1. **First, install Git (if you don't have it):**
   ```bash
   brew install git
   ```

2. **Navigate to where you want to clone it:**
   ```bash
   # Option A: Desktop
   cd ~/Desktop

   # Option B: Documents
   cd ~/Documents

   # Option C: Create a Projects folder
   cd ~
   mkdir -p Projects
   cd Projects
   ```

3. **Clone the repository:**
   ```bash
   git clone https://github.com/yourusername/ncode.git
   cd ncode
   ```

4. **You're now in the project folder!**

---

### ✅ Step 5: Install JavaScript Dependencies (5-10 minutes)

1. **Make sure you're in the ncode folder:**
   ```bash
   pwd
   # Should show something like: /Users/yourname/Projects/ncode
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```
   This downloads all JavaScript libraries (5-10 minutes)

3. **Install Tauri CLI:**
   ```bash
   cargo install tauri-cli
   ```
   This compiles the Tauri framework (3-5 minutes)

---

### ✅ Step 6: Run NCode! (5 minutes first time)

1. **In Terminal (in ncode folder), run:**
   ```bash
   npm run tauri dev
   ```

2. **First time takes 3-5 minutes** to compile everything

3. **Wait for the window to appear!**

4. **You see the NCode editor?** Success! 🎉

5. **Next times, it's much faster** (10-20 seconds)

---

## Setting Up AI on macOS

### Option A: Local AI with Ollama (FREE)

Runs AI on your Mac. Best for privacy, no costs.

**1. Install Ollama**
- Download from: https://ollama.ai/download
- Click "Download for macOS"
- Choose version for your Mac (Apple Silicon or Intel)
- Open the downloaded file
- Drag Ollama to Applications folder
- Wait for installation

**2. Start Ollama**

- Open Applications > Ollama
- Or open Terminal and run:
  ```bash
  ollama serve
  ```
- It runs in background (look for Ollama in menu bar)

**3. Install an AI Model**

Open Terminal and choose one:

```bash
# Lightweight and fast (1GB) - GOOD FOR BEGINNERS
ollama pull deepseek-coder:1.3b

# Better quality, slower (4GB)
ollama pull codellama:7b-code-q4_0

# Even better quality (13GB)
ollama pull codellama:13b-code-q4_0

# Very lightweight, fast (387MB)
ollama pull phi:2.7b
```

This downloads the model (2-5 minutes depending on size).

**4. Configure in NCode**

1. **In NCode, press:** Cmd+, (comma)
2. **Click "AI / LLM" tab**
3. **Select "Ollama (Local)"**
4. **Click "Fetch"**
5. **Your model should appear**
6. **Click to select it**
7. **Go back and start chatting!**

---

### Option B: Cloud AI (OpenAI, Anthropic, Groq)

Uses cloud providers. Costs money but often better quality.

**1. Get an API Key**

Choose one:

- **OpenAI (ChatGPT):**
  - Go to https://platform.openai.com/api-keys
  - Sign up if needed
  - Create new secret key
  - Copy the key (starts with `sk-`)

- **Anthropic (Claude):**
  - Go to https://console.anthropic.com/
  - Sign up
  - Get API key
  - Copy it

- **Groq (Fast and partly free):**
  - Go to https://console.groq.com/
  - Sign up
  - Get API key
  - Copy it

**2. Configure in NCode**

1. Open **Settings** (Cmd+,)
2. Click **"AI / LLM"** tab
3. Select **"API Key (Cloud)"**
4. Pick your provider from dropdown
5. Paste your API key
6. Enter model name (e.g., `gpt-4o`, `claude-3-sonnet`)
7. Click **"Add Key"**
8. Select it
9. Start chatting!

---

## First Things to Try

1. **Open a Project Folder**
   - Click "Open Folder" in NCode
   - Select a folder with code
   - Files appear on the left

2. **Quick Open Files**
   - Press Cmd+P
   - Type a filename
   - Press Enter

3. **Use Terminal in NCode**
   - Press Ctrl+` (backtick)
   - Terminal appears at bottom
   - Run any commands!

4. **Search Code**
   - Press Cmd+H
   - Type to find text
   - Great for searching multiple files!

5. **Chat with AI**
   - Click AI button (top right)
   - Type a question
   - Get instant coding help!

---

## Essential Keyboard Shortcuts

These are same as VS Code:

| Shortcut | What it does |
|----------|--------------|
| **Cmd+P** | Quick open files (fastest!) |
| **Cmd+H** | Find & replace |
| **Cmd+F** | Find in file |
| **Cmd+T** | Jump to symbol/function |
| **Cmd+/** | Comment/uncomment |
| **Cmd+S** | Save file |
| **Cmd+Z** | Undo |
| **Cmd+Shift+Z** | Redo |
| **Cmd+X** | Cut line |
| **Cmd+C** | Copy |
| **Cmd+V** | Paste |
| **Cmd+,** | Open Settings |
| **Cmd+J** | Toggle Terminal |
| **Cmd+B** | Toggle File Explorer |
| **Cmd+Shift+X** | Extensions |
| **Cmd+\`** | Focus Terminal |
| **Cmd+K Cmd+C** | Line comment |
| **Cmd+K Cmd+U** | Uncomment |

---

## Building for Distribution

When you want to share NCode with others:

1. **In Terminal (in ncode folder), run:**
   ```bash
   npm run tauri build
   ```

2. **This creates:**
   - **DMG installer** (easier for others)
   - **App binary** (just the app)

3. **Find them in:**
   ```bash
   target/release/
   ```

4. **Share the .dmg file** - others can drag-and-drop to install!

---

## Troubleshooting

### "command not found: npm"
**Solution:**
- Close Terminal completely
- Open a new Terminal window
- Try again
- If still doesn't work: restart your Mac

### "command not found: cargo"
**Solution:**
```bash
# Load Rust environment
source "$HOME/.cargo/env"
# Then try again
```

### Permission Denied (Password)
**Solution:**
- The npm/cargo commands might need permission
- Just type your Mac password when asked
- It won't show as you type (normal!)

### First build takes too long

**This is normal!** First build compiles everything:
- First time: 5-10 minutes
- Subsequent times: 20-30 seconds
- Use `npm run tauri dev` not `npm run tauri build` while developing

### Ollama not connecting

**Check if Ollama is running:**
```bash
# In Terminal, test this
curl http://localhost:11434/api/tags

# Should return JSON with your models
# If error, Ollama isn't running
```

**Start Ollama:**
```bash
ollama serve
```

### M1/M2 Mac specific issues

**Some packages might not work on Apple Silicon:**
```bash
# Try this if you get compilation errors
arch -x86_64 npm install
```

Or use Rosetta:
1. Click Terminal in Finder
2. Get Info (Cmd+I)
3. Check "Open using Rosetta"
4. Try again

---

## Advanced: Use nvm for Node.js Versions

If you need to switch between Node.js versions:

1. **Install nvm:**
   ```bash
   brew install nvm
   mkdir ~/.nvm
   ```

2. **Add to your shell profile:**
   ```bash
   # For zsh (macOS default):
   echo 'export NVM_DIR="$HOME/.nvm"' >> ~/.zshrc
   echo '[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"' >> ~/.zshrc
   
   # For bash:
   echo 'export NVM_DIR="$HOME/.nvm"' >> ~/.bash_profile
   echo '[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"' >> ~/.bash_profile
   ```

3. **Reload shell:**
   ```bash
   # Close and reopen Terminal, or:
   source ~/.zshrc  # for zsh
   # or
   source ~/.bash_profile  # for bash
   ```

4. **Install Node.js via nvm:**
   ```bash
   nvm install 18
   nvm install 20
   nvm use 18  # switch to Node 18
   nvm use 20  # switch to Node 20
   ```

---

## Tips for macOS Users

✅ **Do this:**
- Keep Terminal window open while running dev server
- Learn keyboard shortcuts (Cmd instead of Ctrl)
- Use Cmd+P to quickly find files
- Make sure Ollama is running before using local AI
- Check "Apple Silicon" vs "Intel" when installing software

❌ **Don't do this:**
- Close Terminal while NCode is running in dev mode
- Edit huge files (>100MB)
- Try to use Windows shortcuts
- Expect first build to be fast

---

## Getting Help

If something breaks:

1. **Check this guide** - Most issues are here
2. **Read [README.md](./README.md)** - Full documentation
3. **Open GitHub Issue** - Report bugs
4. **Open GitHub Discussion** - Ask questions
5. **Stack Overflow** - Search for Tauri/Rust errors

---

## You're Ready! 🎉

You now have NCode installed and running on macOS!

**Next steps:**
1. Open a project folder
2. Try Cmd+P to open files
3. Set up AI in Settings
4. Start coding!

**Welcome to NCode!**
