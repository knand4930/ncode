# 🚀 NCode Setup & Installation Hub

Welcome! This is your central hub for installing and setting up NCode on your system.

## Choose Your Operating System

Pick your OS below to get started with detailed, step-by-step instructions:

### 🪟 Windows
**Windows 10 & 11 (64-bit)**

Complete guide with all Windows-specific steps, from installing Node.js and Rust, to running the development server.

👉 **[Read Windows Setup Guide →](./WINDOWS_SETUP.md)**

- PowerShell commands (not Bash)
- Visual C++ Build Tools installation
- Ollama setup for Windows
- Windows troubleshooting

Estimated time: **15-20 minutes**

---

### 🍎 macOS
**Monterey, Ventura, Sonoma (Intel & Apple Silicon)**

Complete macOS installation with Homebrew, both Apple Silicon and Intel support.

👉 **[Read macOS Setup Guide →](./MACOS_SETUP.md)**

- Homebrew package manager
- nvm for Node version management
- Apple Silicon M1/M2/M3 support
- macOS troubleshooting

Estimated time: **10-15 minutes**

---

### 🐧 Linux
**Ubuntu, Fedora, Arch, and Others**

Platform-specific instructions for all major Linux distributions.

👉 **[Read Linux Setup Guide →](./LINUX_SETUP.md)**

- Ubuntu/Debian (apt)
- Fedora/RHEL/CentOS (dnf)
- Arch Linux (pacman)
- openSUSE and others
- Systemd service setup (advanced)

Estimated time: **10-15 minutes**

---

## Don't Know Your OS?

**Check your operating system:**

### Windows
Press `Win + X` and look at the menu - usually says "Windows PowerShell" or "Terminal"

### macOS
Click the Apple 🍎 logo (top-left) → "About This Mac" - will show "macOS Monterey" or similar

### Linux
Open terminal and run:
```bash
uname -s
# Output shows Linux, then run:
cat /etc/os-release
# Shows which distro (Ubuntu, Fedora, Arch, etc)
```

---

## Quick Path Selector

**I have Node.js and Rust already:**
- Go straight to: Clone the repo and run `npm install && npm run tauri dev`
- See [QUICK_START.md](./QUICK_START.md)

**I'm completely new to coding:**
- Start with: [QUICK_START.md](./QUICK_START.md) - gentle introduction
- Then follow your OS guide above

**I just want 5 minutes:**
- Go to: [QUICK_START.md](./QUICK_START.md) - quick setup guide

**I need detailed reference docs:**
- Go to: [README.md](./README.md) - comprehensive reference

---

## Installation Overview

All three platforms follow roughly the same path:

```
1. Install Node.js
2. Install Rust
3. Install platform-specific libraries
4. Clone repository
5. Install dependencies (npm install)
6. Run dev server (npm run tauri dev)
7. Set up AI provider (optional but recommended)
```

Each platform has its own details, which is why we have OS-specific guides.

---

## What You'll Get After Setup

✅ **Fully working NCode editor** - desktop app similar to VS Code
✅ **AI assistance** - integrated AI chat for code help
✅ **Terminal** - built-in terminal for running commands
✅ **Debugging** - debug code right in the editor
✅ **Extensions-ready** - plugin architecture for future extensions

---

## What to Install First

You'll need to install **in this order**:

1. **Node.js** - JavaScript runtime (for the UI)
2. **Rust** - Compiled language (for the desktop app)
3. **Git** - For cloning the repository
4. **Build Tools** - Compilers for your OS
5. **Development Libraries** - GTK, WebKit2, etc.

After those, installation is just:
```bash
git clone ...
npm install
npm run tauri dev
```

---

## Common Questions Answered

### How long does installation take?

- **First time:** 15-20 minutes (includes compiling)
- Mostly waiting for downloads and compilation
- Actual steps you do: 10-15 minutes

### Do I need admin/sudo access?

Yes, to install system packages like:
- Node.js
- Rust
- Build tools
- Development libraries

You'll be asked for your password a few times.

### What if something breaks?

Each platform guide has a **Troubleshooting** section covering:
- "command not found" errors
- Build failures
- Permission issues
- AI setup problems
- Performance issues

### Can I uninstall?

**Easy uninstall:**

- Delete the `ncode` folder
- Optionally uninstall Node.js/Rust (platform specific)

### What are the system requirements?

**Minimum:**
- 4GB RAM
- 10GB disk space
- Dual-core processor

**Recommended:**
- 8GB+ RAM
- 20GB disk space (for comfortable development)
- 4+ core processor

### Is it free?

Yes! NCode is open-source.

However, if you use cloud AI providers (OpenAI, Anthropic), those have subscription costs. Local Ollama is completely free.

---

## AI Setup Options

After installation, you can choose your AI provider:

### Local & Free (Ollama)
- Runs on your computer
- No API keys needed
- Private (your data stays local)
- Models: Deepseek-Coder, CodeLlama, Phi
- **Cost:** Free (uses your computer's resources)

### Cloud & Quick (OpenAI, Anthropic, Groq)
- Instant, no installation
- Professional grade models
- Pay per use or subscription
- Models: GPT-4o, Claude-3, Mixtral
- **Cost:** $5-20/month typical

### Hybrid (gRPC Service)
- Mix of local + cloud
- Custom configuration
- Advanced setup
- **Cost:** Depends on your choice

Get detailed AI setup in any of the platform guides above.

---

## Next Steps After Installation

### 1. Open a Project
```
File → Open Folder → select your project
```

### 2. Learn Keyboard Shortcuts
```
Ctrl+P (or Cmd+P on Mac) - fastest way to open files!
```

### 3. Set Up Your Preferred AI
```
Settings (Ctrl+, or Cmd+,) → AI / LLM tab
```

### 4. Try It Out
```
Click on any code file
Type Ctrl+/ to comment lines
Use Ctrl+H to find and replace
```

### 5. Enable AI Chat
```
Click AI button (top right)
Ask it: "How does this function work?"
```

---

## Documentation Map

Here's all the NCode documentation:

| Document | Purpose | Read if... |
|----------|---------|-----------|
| **[WINDOWS_SETUP.md](./WINDOWS_SETUP.md)** | Windows installation | You use Windows |
| **[MACOS_SETUP.md](./MACOS_SETUP.md)** | macOS installation | You use macOS |
| **[LINUX_SETUP.md](./LINUX_SETUP.md)** | Linux installation | You use Linux |
| **[QUICK_START.md](./QUICK_START.md)** | 5-minute setup | You want quick start |
| **[INSTALLATION.md](./INSTALLATION.md)** | Detailed setup guide | You need reference |
| **[README.md](./README.md)** | Complete reference | You want full docs |
| **SETUP_HUB.md** | This file | You're choosing where to start |

---

## Troubleshooting Before You Start

### "I don't know which OS I have"

**Windows:** Look for "This PC" or "My Computer" on desktop
**macOS:** Look for Apple 🍎 logo, top-left corner
**Linux:** You probably know! But run: `cat /etc/os-release`

### "I have Windows but the guide looks like Mac"

Every OS has its own guide! Look for:
- [WINDOWS_SETUP.md](./WINDOWS_SETUP.md) - Just for Windows
- [MACOS_SETUP.md](./MACOS_SETUP.md) - Just for Mac
- [LINUX_SETUP.md](./LINUX_SETUP.md) - Just for Linux

### "I'm stuck on a step"

1. Check the **Troubleshooting** section in your OS guide
2. Copy-paste the error message into Google
3. Check [QUICK_START.md](./QUICK_START.md) for quick fixes
4. Open a GitHub Issue with the exact error

---

## Installation Checklist

Use this checklist as you go through the steps:

### Pre-Installation
- [ ] I know which OS I have
- [ ] I have a terminal/PowerShell open
- [ ] I have 10GB+ free disk space
- [ ] I have internet connection

### During Installation
- [ ] Node.js installed and verified
- [ ] Rust installed and verified
- [ ] Platform libraries installed
- [ ] Repository cloned
- [ ] npm dependencies installed
- [ ] Tauri CLI installed

### Post-Installation
- [ ] `npm run tauri dev` opens the app
- [ ] I can see the NCode editor window
- [ ] AI provider selected (Optional)
- [ ] I can open a folder and edit files

---

## Getting Help

**Something doesn't work?**

1. **Check your OS guide** - Troubleshooting section
2. **Check [QUICK_START.md](./QUICK_START.md)** - Common solutions
3. **Search your error** - Google the exact error message
4. **Open an Issue** - On GitHub with error details
5. **Ask in Discussions** - GitHub community help

---

## Ready to Start?

### Choose your operating system above and follow those steps!

**Don't worry:** Each guide is detailed and step-by-step. You've got this! 🚀

---

**Questions?** → Check [README.md](./README.md#faq)  
**Quick setup?** → Go to [QUICK_START.md](./QUICK_START.md)  
**Detailed reference?** → Go to [INSTALLATION.md](./INSTALLATION.md)
