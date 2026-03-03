# Linux Installation Guide for NCode

Complete step-by-step guide for Linux users (Ubuntu, Fedora, Arch, and other distributions).

## Linux Distributions Covered

- **Ubuntu / Debian** - Most popular (uses `apt`)
- **Fedora / RHEL / CentOS** - RedHat-based (uses `dnf`)
- **Arch Linux** - Rolling release (uses `pacman`)
- **openSUSE** - (uses `zypper`)
- **Other distros** - Adapt Ubuntu instructions

---

## Prerequisites for All Linux Users

- 10GB free disk space
- `sudo` access (for installing packages)
- Internet connection
- Terminal/command line experience

**Check what you have:**
```bash
uname -a              # Shows Linux version
git --version        # Check if Git installed
node --version       # Check if Node installed
cargo --version      # Check if Rust installed
```

---

# Ubuntu / Debian Installation

## Complete Installation (10-15 minutes)

### ✅ Step 1: Update System Packages (2 minutes)

```bash
sudo apt update
sudo apt upgrade -y
```

### ✅ Step 2: Install Node.js (2 minutes)

**Option A: Using NodeSource Repository (RECOMMENDED)**

```bash
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt install -y nodejs
```

Or for newer version:
```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
```

**Option B: Using nvm (if you need multiple Node versions)**

```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash
source ~/.bashrc
# or source ~/.zshrc if using zsh
nvm install 18
# or nvm install 20
```

**Verify:**
```bash
node --version
npm --version
```

### ✅ Step 3: Install Rust (3 minutes)

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
```

When asked, press Enter for default option (1).

Then load Rust in current session:
```bash
source "$HOME/.cargo/env"
```

**Verify:**
```bash
rustc --version
cargo --version
```

### ✅ Step 4: Install Required Libraries (2 minutes)

These are needed for Tauri to work on Linux:

```bash
sudo apt install -y \
  libgtk-3-dev \
  libssl-dev \
  libayatana-appindicator3-dev \
  libwebkit2gtk-4.0-dev \
  libappindicator3-1 \
  webkit2gtk-driver \
  librsvg2-dev \
  patchelf
```

### ✅ Step 5: Install Git (1 minute)

```bash
sudo apt install -y git
```

### ✅ Step 6: Clone Repository (2 minutes)

Choose a location:
```bash
# Option A: Projects folder (recommended)
cd ~
mkdir -p Projects
cd Projects

# Option B: Desktop
cd ~/Desktop

# Option C: Documents
cd ~/Documents
```

Then clone:
```bash
git clone https://github.com/yourusername/ncode.git
cd ncode
```

### ✅ Step 7: Install Dependencies (5-10 minutes)

```bash
npm install
```

### ✅ Step 8: Install Tauri CLI (2-3 minutes)

```bash
cargo install tauri-cli
```

### ✅ Step 9: Run NCode!

```bash
npm run tauri dev
```

**First time:** Takes 3-5 minutes to compile  
**Later times:** 20-30 seconds

🎉 **You're done! NCode window should open!**

---

# Fedora / RHEL / CentOS Installation

## Complete Installation (10-15 minutes)

### ✅ Step 1: Update System Packages (2 minutes)

```bash
sudo dnf update -y
```

### ✅ Step 2: Install Node.js (2 minutes)

```bash
curl -fsSL https://rpm.nodesource.com/setup_18.x | sudo bash -
sudo dnf install -y nodejs
```

Or for Node 20:
```bash
curl -fsSL https://rpm.nodesource.com/setup_20.x | sudo bash -
sudo dnf install -y nodejs
```

**Verify:**
```bash
node --version
npm --version
```

### ✅ Step 3: Install Rust (3 minutes)

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
source "$HOME/.cargo/env"
```

**Verify:**
```bash
rustc --version
cargo --version
```

### ✅ Step 4: Install Required Libraries (2 minutes)

```bash
sudo dnf install -y \
  gtk3-devel \
  openssl-devel \
  libayatana-appindicator-devel \
  webkit2gtk3-devel \
  libappindicator-gtk3 \
  librsvg2-devel \
  patchelf
```

### ✅ Step 5: Install Git (1 minute)

```bash
sudo dnf install -y git
```

### ✅ Step 6-9: Clone, Install Dependencies, Run

Same as Ubuntu steps 6-9:

```bash
cd ~
mkdir -p Projects
cd Projects
git clone https://github.com/yourusername/ncode.git
cd ncode
npm install
cargo install tauri-cli
npm run tauri dev
```

🎉 **Done! NCode is running!**

---

# Arch Linux Installation

## Complete Installation (10-15 minutes)

### ✅ Step 1: Update System (1 minute)

```bash
sudo pacman -Syu
```

### ✅ Step 2: Install Node.js (2 minutes)

```bash
sudo pacman -S nodejs npm
```

**Verify:**
```bash
node --version
npm --version
```

### ✅ Step 3: Install Rust (3 minutes)

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
source "$HOME/.cargo/env"
```

**Verify:**
```bash
rustc --version
cargo --version
```

### ✅ Step 4: Install Required Libraries (2 minutes)

```bash
sudo pacman -S \
  gtk3 \
  openssl \
  webkit2gtk \
  libappindicator-gtk3 \
  librsvg \
  patchelf
```

### ✅ Step 5: Install Git (1 minute)

```bash
sudo pacman -S git
```

### ✅ Step 6-9: Clone, Install, Run

```bash
cd ~
mkdir -p Projects
cd Projects
git clone https://github.com/yourusername/ncode.git
cd ncode
npm install
cargo install tauri-cli
npm run tauri dev
```

🎉 **Done!**

---

# Setting Up AI on Linux

## Option A: Local AI with Ollama (FREE)

Runs AI models on your Linux machine. Best for privacy, no costs.

### Install Ollama

```bash
curl -fsSL https://ollama.ai/install.sh | sh
```

Or using package manager:

**Ubuntu/Debian:**
```bash
sudo apt install -y ollama
```

**Fedora:**
```bash
sudo dnf install -y ollama
```

**Arch:**
```bash
sudo pacman -S ollama
```

### Start Ollama Service

```bash
# Start manually:
ollama serve

# Or enable as a service:
sudo systemctl enable ollama
sudo systemctl start ollama
```

### Download an AI Model

Choose one (opens in Terminal):

```bash
# Lightweight and fast (1GB) - GOOD FOR BEGINNERS
ollama pull deepseek-coder:1.3b

# Better quality (4GB)
ollama pull codellama:7b-code-q4_0

# Even better (13GB)
ollama pull codellama:13b-code-q4_0

# Very lightweight (387MB)
ollama pull phi:2.7b
```

### Configure in NCode

1. **In NCode, press:** Ctrl+, (comma)
2. **Click "AI / LLM" tab**
3. **Select "Ollama (Local)"**
4. **Click "Fetch"**
5. **Select your model**
6. **Start chatting!**

---

## Option B: Cloud AI (OpenAI, Anthropic, Groq)

Uses cloud services. Costs money, often better quality.

### Get an API Key

**OpenAI:**
- Go to https://platform.openai.com/api-keys
- Create new key
- Copy it (starts with `sk-`)

**Anthropic (Claude):**
- Go to https://console.anthropic.com/
- Get API key
- Copy it

**Groq (Fast, partly free):**
- Go to https://console.groq.com/
- Sign up
- Get API key
- Copy it

### Configure in NCode

1. Open **Settings** (Ctrl+,)
2. Click **"AI / LLM"** tab
3. Select **"API Key (Cloud)"**
4. Pick your provider
5. Paste your API key
6. Enter model name (e.g., `gpt-4o`, `claude-3-sonnet`)
7. Click **"Add Key"**
8. Select it
9. Start chatting!

---

# First Things to Try

1. **Open a Project**
   - In NCode, File → Open Folder
   - Select a folder with code
   - Files appear on left

2. **Quick Open Files**
   - Press Ctrl+P
   - Type filename
   - Press Enter

3. **Use Terminal in NCode**
   - Press Ctrl+` (backtick)
   - Terminal appears at bottom
   - Run Linux commands!

4. **Search Code**
   - Press Ctrl+H
   - Search in all files
   - Super fast!

5. **Chat with AI**
   - Click AI button (top right)
   - Ask programming questions
   - Get instant help!

---

## Essential Keyboard Shortcuts

| Shortcut | What it does |
|----------|--------------|
| **Ctrl+P** | Quick open files (fastest!) |
| **Ctrl+H** | Find & replace |
| **Ctrl+F** | Find in file |
| **Ctrl+T** | Jump to symbol/function |
| **Ctrl+/** | Comment/uncomment |
| **Ctrl+S** | Save file |
| **Ctrl+Z** | Undo |
| **Ctrl+Y** | Redo |
| **Ctrl+X** | Cut line |
| **Ctrl+C** | Copy |
| **Ctrl+V** | Paste |
| **Ctrl+,** | Open Settings |
| **Ctrl+J** | Toggle Terminal |
| **Ctrl+B** | Toggle File Explorer |
| **Ctrl+Shift+X** | Extensions |
| **Ctrl+\`** | Focus Terminal |
| **Ctrl+K Ctrl+C** | Line comment |
| **Ctrl+K Ctrl+U** | Uncomment |

---

## Building for Distribution

Share NCode with others:

```bash
npm run tauri build
```

Creates:
- **AppImage** - Single file, runs anywhere
- **deb file** - For Debian/Ubuntu users
- **rpm file** - For Fedora/RHEL users

Find them in: `target/release/`

Share the AppImage - works on almost any Linux!

---

## Troubleshooting

### "npm: command not found"

**Solution:**
```bash
# Close and reopen Terminal
# If still doesn't work:
source ~/.bashrc
# or if using zsh:
source ~/.zshrc
```

### "cargo: command not found"

**Solution:**
```bash
source "$HOME/.cargo/env"
# Then try cargo command again
```

### "Cannot find GTK-3"

**Solution:**

For Ubuntu/Debian:
```bash
sudo apt install libgtk-3-dev
```

For Fedora:
```bash
sudo dnf install gtk3-devel
```

For Arch:
```bash
sudo pacman -S gtk3
```

### Build takes too long (first time normal!)

**First build:** 5-10 minutes (normal!)  
**Later builds:** 20-30 seconds

Use `npm run tauri dev` for development, not `tauri build`

### Ollama is not responding

**Check if it's running:**
```bash
curl http://localhost:11434/api/tags
```

Should return JSON with your models.

**If not running, start it:**
```bash
ollama serve
```

### Can't use GUI apps

**Make sure you have display:**
```bash
echo $DISPLAY
# Should show something like :0 or :1
```

If empty, you might be in a terminal-only environment.

### Import/Library Errors During Build

Some packages need extra tools:

```bash
# Ubuntu/Debian:
sudo apt install build-essential

# Fedora:
sudo dnf groupinstall "Development Tools"

# Arch:
sudo pacman -S base-devel
```

---

## Advanced Configuration

### Use Custom Node Version with nvm

```bash
# Install nvm
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash

# Reload shell
source ~/.bashrc

# Install Node versions you want
nvm install 18
nvm install 20

# Switch versions:
nvm use 18   # Use Node 18
nvm use 20   # Use Node 20
```

### Faster Builds

```bash
# Add to ~/.profile or ~/.bashrc:
export CARGO_BUILD_JOBS=$(nproc)

# Or set Node to use more cores:
npm config set package-lock false
```

### Run as Systemd Service (Advanced)

Create `/etc/systemd/system/ncode.service`:

```ini
[Unit]
Description=NCode Editor
After=network.target

[Service]
Type=simple
User=yourusername
WorkingDirectory=/home/yourusername/Projects/ncode
ExecStart=/usr/bin/npm run tauri dev
Restart=on-failure

[Install]
WantedBy=multi-user.target
```

Then:
```bash
sudo systemctl daemon-reload
sudo systemctl enable ncode
sudo systemctl start ncode
```

---

## Tips for Linux Users

✅ **Do this:**
- Keep terminal open while running `npm run tauri dev`
- Learn keyboard shortcuts (Ctrl+P is your friend!)
- Make sure Ollama is running before using AI
- Check `uname -a` if you're unsure what distro
- Use `sudo apt/dnf/pacman` for system-level installs

❌ **Don't do this:**
- Close terminal while NCode is running
- Edit huge files (>100MB) without SSD
- Try to run GUI apps in SSH (no display)
- Blame the distro if a command doesn't exist
- Use `sudo` for npm installs (causes permission issues)

---

## Getting Help

If you get stuck:

1. **Check this guide** - Most issues are here
2. **Read [README.md](./README.md)** - Full documentation
3. **Check [QUICK_START.md](./QUICK_START.md)** - Beginner guide
4. **Open GitHub Issue** - Report bugs
5. **Open GitHub Discussion** - Ask questions
6. **Stack Overflow** - Search Tauri/Rust errors
7. **Arch Wiki** - Excellent Linux reference
8. **Your distro's forum** - Community help

---

## You're Ready! 🎉

You now have NCode installed and running on Linux!

**Next steps:**
1. Open a project folder
2. Try Ctrl+P to open files
3. Set up AI in Settings
4. Start coding with AI assistance!

**Welcome to NCode on Linux!**

---

## Distribution-Specific Commands Quick Reference

| Task | Ubuntu/Debian | Fedora/RHEL | Arch |
|------|---------------|-----------|------|
| Update | `apt update && apt upgrade` | `dnf update` | `pacman -Syu` |
| Install Package | `apt install -y <pkg>` | `dnf install -y <pkg>` | `pacman -S <pkg>` |
| Search Package | `apt search <pkg>` | `dnf search <pkg>` | `pacman -Ss <pkg>` |
| Remove Package | `apt remove <pkg>` | `dnf remove <pkg>` | `pacman -R <pkg>` |
| Clean Cache | `apt clean` | `dnf clean all` | `pacman -Sc` |

