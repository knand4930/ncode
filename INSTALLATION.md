# Complete Installation Guide for NCode

This guide provides detailed, step-by-step instructions for installing NCode on Linux, macOS, and Windows.

## Table of Contents

- [Linux Installation](#linux-installation)
- [macOS Installation](#macos-installation)  
- [Windows Installation](#windows-installation)
- [Post-Installation Setup](#post-installation-setup)
- [Troubleshooting](#troubleshooting)

---

## Linux Installation

### Ubuntu / Debian

#### Step 1: Update System

```bash
sudo apt update
sudo apt upgrade -y
```

#### Step 2: Install Required Dependencies

```bash
sudo apt install -y \
    curl \
    git \
    build-essential \
    libssl-dev \
    pkg-config \
    libgtk-3-dev \
    libayatana-appindicator3-dev \
    librsvg2-dev \
    wget
```

**What each package does:**
- `curl`: Download files from internet
- `git`: Version control system
- `build-essential`: Compiler toolchain (gcc, make, etc.)
- `libssl-dev`: SSL/TLS development libraries
- `pkg-config`: Library configuration tool
- `libgtk-3-dev`: GUI toolkit (required by Tauri)
- `libayatana-appindicator3-dev`: System tray support
- `librsvg2-dev`: SVG icon rendering

#### Step 3: Install Node.js 18+ (using nvm - Recommended)

```bash
# Download and install nvm
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash

# Reload shell configuration
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"

# Or reload bash
source ~/.bashrc

# Install Node.js 18 LTS
nvm install 18
nvm use 18
nvm alias default 18

# Verify installation
node --version    # Should show v18.x.x
npm --version     # Should show 9.x.x or higher
```

**Alternative: Using apt (simpler but older versions)**

```bash
sudo apt install nodejs npm

# If versions are too old, use NodeSource repository:
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt install -y nodejs
```

#### Step 4: Install Rust

```bash
# Download and run Rust installer
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

# Choose option 1 (default installation)
# Then reload shell
source $HOME/.cargo/env

# Verify installation
rustc --version   # Should show recent stable version
cargo --version
```

#### Step 5: Clone NCode Repository

```bash
# Choose where to store your projects (e.g., ~/Projects)
mkdir -p ~/Projects
cd ~/Projects

# Clone the repository
git clone https://github.com/yourusername/ncode.git
cd ncode
```

#### Step 6: Install Dependencies

```bash
# Install npm packages
npm install

# Install Tauri CLI
cargo install tauri-cli
```

#### Step 7: Run Development Server

```bash
# Start the development server with hot reload
npm run tauri dev

# This will compile and launch the app
# Note: First build takes 2-3 minutes

# For faster rebuilds on subsequent runs:
npm run tauri dev
```

#### Step 8: Build for Production

```bash
# Create optimized production build
npm run tauri build

# Output will be in: ./target/release/ncode
# Run with: ./target/release/ncode
```

---

### Fedora / RHEL / CentOS

#### Step 1: Update System

```bash
sudo dnf update -y
```

#### Step 2: Install Dependencies

```bash
sudo dnf install -y \
    curl \
    git \
    gcc \
    gcc-c++ \
    make \
    openssl-devel \
    pkg-config \
    gtk3-devel \
    libayatana-appindicator-devel \
    librsvg2-devel \
    webkit2gtk3-devel
```

#### Step 3-8: Follow same steps as Ubuntu/Debian above

---

### Arch Linux

#### Step 1: Update System

```bash
sudo pacman -Syu
```

#### Step 2: Install Dependencies

```bash
sudo pacman -S \
    base-devel \
    curl \
    git \
    openssl \
    pkg-config \
    gtk3 \
    libayatana-appindicator \
    librsvg \
    webkit2gtk
```

#### Step 3-8: Follow same steps as Ubuntu/Debian above

---

## macOS Installation

### Prerequisites

- Mac with Intel or Apple Silicon chip
- macOS 10.15 or later
- Homebrew (optional but recommended)

### Step 1: Install Homebrew (if not already installed)

```bash
# Check if Homebrew is installed
brew --version

# If not installed, run:
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

# Add Homebrew to PATH (Apple Silicon Macs)
# Add to ~/.zprofile or ~/.bash_profile:
export PATH=/opt/homebrew/bin:$PATH
source ~/.zprofile
```

### Step 2: Install Node.js

```bash
# Using Homebrew (recommended)
brew install node@18

# Add to PATH
echo 'export PATH="/opt/homebrew/opt/node@18/bin:$PATH"' >> ~/.zprofile
source ~/.zprofile

# Verify installation
node --version    # Should show v18.x.x
npm --version     # Should show 9.x.x or higher
```

**Alternative: Using nvm**

```bash
# Install nvm
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash

# Reload shell
source ~/.zprofile

# Install Node.js
nvm install 18
nvm use 18
```

### Step 3: Install Rust

```bash
# Download and run Rust installer
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

# Choose option 1 (default)
# Reload shell
source ~/.cargo/env

# Verify installation
rustc --version
cargo --version
```

### Step 4: Install Required Tools

```bash
# Install additional required tools
brew install git

# For Apple Silicon, you may need:
brew install openssl pkg-config
```

### Step 5: Clone Repository

```bash
# Create projects directory
mkdir -p ~/Projects
cd ~/Projects

# Clone NCode
git clone https://github.com/yourusername/ncode.git
cd ncode
```

### Step 6: Install Dependencies

```bash
npm install
cargo install tauri-cli
```

### Step 7: Run Development Server

```bash
npm run tauri dev
```

### Step 8: Build for macOS

```bash
# Build both Intel and Apple Silicon versions
npm run tauri build

# Or build for specific architecture
npm run tauri build -- --target x86_64-apple-darwin      # Intel
npm run tauri build -- --target aarch64-apple-darwin     # Apple Silicon
npm run tauri build -- --universal-apple-darwin          # Universal (both)
```

**Output locations:**
- Intel: `./target/x86_64-apple-darwin/release/`
- Apple Silicon: `./target/aarch64-apple-darwin/release/`

---

## Windows Installation

### Prerequisites

- Windows 10 or Windows 11 (64-bit)
- Administrator access
- At least 5GB free disk space

### Step 1: Install Node.js

1. Visit https://nodejs.org/
2. Download **LTS version (18.x or newer)**
3. Run the installer
4. Follow the installation wizard:
   - Accept license agreement
   - Choose installation path (default is fine)
   - Ensure "npm package manager" is selected
   - Click "Install"

5. **Restart your computer**

6. Verify installation:
   ```powershell
   node --version
   npm --version
   ```

### Step 2: Install Rust

1. Visit https://www.rust-lang.org/tools/install
2. Download **rustup-init.exe** for Windows
3. Run the installer
4. When prompted, select option **1** (default installation)
5. **Restart PowerShell/CMD** after installation

Verify:
```powershell
rustc --version
cargo --version
```

### Step 3: Install Visual C++ Build Tools

This is required for compiling Rust code on Windows.

1. Visit https://aka.ms/vs/17/release/vs_BuildTools
2. Download the **Visual Studio Build Tools**
3. Run the installer
4. When asked about workloads, select **"Desktop development with C++"**
5. Click "Install" and wait for completion
6. **Restart your computer**

### Step 4: Install Git (Optional but Recommended)

1. Visit https://git-scm.com/download/win
2. Download the Windows installer
3. Run it and follow default options
4. Restart PowerShell/CMD

### Step 5: Clone Repository

1. Create a projects folder:
   ```powershell
   mkdir C:\Users\YourUsername\Projects
   cd C:\Users\YourUsername\Projects
   ```

2. Clone NCode:
   ```powershell
   git clone https://github.com/yourusername/ncode.git
   cd ncode
   ```

   **If `git` is not installed**, download and extract ZIP from GitHub instead:
   - Go to https://github.com/yourusername/ncode
   - Click "Code" → "Download ZIP"
   - Extract to `C:\Users\YourUsername\Projects\ncode`
   - Open PowerShell and navigate to that folder

### Step 6: Install Dependencies

```powershell
npm install
cargo install tauri-cli
```

This may take 5-10 minutes on first run.

### Step 7: Run Development Server

```powershell
npm run tauri dev
```

Wait for compilation (3-5 minutes first time) and the app window will open.

### Step 8: Build for Windows

```powershell
npm run tauri build

# This creates:
# - .msi installer (recommended for users)
# - .exe executable
# Located in: .\target\release\
```

**Output files:**
- MSI Installer: `target\release\ncode_0.1.0_x64_en-US.msi`
- Portable EXE: `target\release\ncode.exe`

---

## Post-Installation Setup

### 1. Set Up AI (Choose one option)

#### Option A: Local AI with Ollama

**Linux:**
```bash
curl -fsSL https://ollama.ai/install.sh | sh
ollama pull deepseek-coder:1.3b
ollama serve
```

**macOS:**
```bash
brew install ollama
ollama pull deepseek-coder:1.3b
ollama serve
```

**Windows (PowerShell):**
1. Download from https://ollama.ai/download
2. Run the installer
3. Open PowerShell and run:
   ```powershell
   ollama pull deepseek-coder:1.3b
   ollama serve
   ```

#### Option B: Cloud AI (OpenAI, Anthropic, Groq)

1. Get API key:
   - **OpenAI:** https://platform.openai.com/api-keys
   - **Anthropic:** https://console.anthropic.com/
   - **Groq:** https://console.groq.com/

2. In NCode:
   - Settings (Ctrl+,) → AI / LLM
   - Select "API Key (Cloud)"
   - Paste your key
   - Enter model name (e.g., gpt-4o)

### 2. Create Desktop Shortcuts (Optional)

**Linux:**
```bash
# Create desktop entry
cat > ~/.local/share/applications/ncode.desktop << EOF
[Desktop Entry]
Name=NCode
Exec=/path/to/ncode/target/release/ncode
Icon=code
Type=Application
Terminal=false
Categories=Development;
EOF

# Make it executable
chmod +x ~/.local/share/applications/ncode.desktop
```

**Windows:**
1. Right-click `ncode.exe`
2. Select "Create shortcut"
3. Move to Desktop or Start Menu

**macOS:**
1. Open Finder
2. Drag `NCode.app` to Applications folder
3. Or create alias: `ln -s /path/to/NCode.app ~/Applications/`

---

## Troubleshooting

### Installation Won't Start / Dependencies Not Found

**Linux:**
```bash
# Reinstall build dependencies
sudo apt clean
sudo apt autoclean
sudo apt install --reinstall build-essential libssl-dev

# Clear Rust cache and rebuild
rm -rf target/
cargo clean
# Then try: npm run tauri dev
```

**macOS:**
```bash
# Clear npm cache
npm cache clean --force

# Reinstall dependencies
rm -rf node_modules package-lock.json
npm install

# Clear Rust cache
rm -rf target/
cargo clean
```

**Windows:**
```powershell
# Clear npm cache
npm cache clean --force

# Remove node_modules
rmdir node_modules -r -force

# Reinstall
npm install

# Clear Rust cache
cargo clean
```

### "command not found: cargo"

**Solution:**
```bash
# Add Rust to PATH
source $HOME/.cargo/env

# Or add to your shell profile permanently:
# For bash: echo 'source $HOME/.cargo/env' >> ~/.bashrc
# For zsh: echo 'source $HOME/.cargo/env' >> ~/.zprofile
```

### "npm command not found"

**Linux/macOS:**
```bash
# Reload shell
source ~/.bashrc        # For bash
source ~/.zprofile      # For zsh

# Or restart Terminal
```

**Windows:**
- Restart PowerShell or VS Code

### Visual C++ Build Tools Error (Windows)

```powershell
# Check if build tools are installed
Set-Location "C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools"

# If not found, reinstall:
# 1. Go to https://aka.ms/vs/17/release/vs_BuildTools
# 2. Download and run installer
# 3. Select "Desktop development with C++"
# 4. Click Modify
# 5. Wait for installation
# 6. Restart PowerShell
```

### Tauri Dev Server Won't Start

```bash
# Option 1: Kill existing process
pkill -f "tauri dev"      # Linux/macOS
taskkill /IM ncode.exe   # Windows

# Option 2: Check port 1421 is free
lsof -i :1421            # Linux/macOS
netstat -ano | findstr :1421  # Windows

# Option 3: Clear cache
rm -rf target/debug
cargo clean
npm run tauri dev
```

### Ollama Connection Issues

```bash
# Check if Ollama is running
ps aux | grep ollama     # Linux/macOS
tasklist | findstr ollama  # Windows

# Check connection
curl http://localhost:11434/api/tags

# If it fails, restart Ollama:
# Linux/macOS: killall ollama; ollama serve
# Windows: Restart the Ollama service
```

### Build Takes Too Long

```bash
# First build is slow (compiles all dependencies)
# Subsequent builds are much faster

# To speed up development, use:
npm run tauri dev  # Hot reload for faster iteration

# For parallel compilation on Linux/macOS:
CARGO_BUILD_JOBS=4 npm run tauri dev

# Use release optimizations only when needed:
npm run tauri build -- --release
```

### Out of Disk Space

**Linux:**
```bash
# Check disk usage
df -h

# Clean up build artifacts
cargo clean
rm -rf node_modules
rm target/ -rf

# Reinstall and build again
npm install
npm run tauri dev
```

---

## Next Steps

1. **Configure Editor Settings:**
   - Open NCode
   - Settings (Ctrl+,)
   - Adjust font size, theme, tab size

2. **Set Up AI:**
   - If using Ollama, pull a model: `ollama pull deepseek-coder:1.3b`
   - In NCode, go to Settings → AI / LLM
   - Select your provider and model

3. **Open Your First Project:**
   - Click "Open Folder" in File Explorer
   - Select your code project
   - Start editing!

4. **Learn Keyboard Shortcuts:**
   - Ctrl+P: Quick open files
   - Ctrl+/: Comment toggle
   - Ctrl+H: Search & replace
   - Ctrl+T: Go to symbol

---

## Getting Help

- **Documentation:** [README.md](./README.md)
- **Issues:** GitHub Issues
- **Discussions:** GitHub Discussions
- **Troubleshooting:** See above sections

---

## System Requirements Summary

| Component | Minimum | Recommended |
|-----------|---------|-------------|
| OS | Windows 10, macOS 10.15, Ubuntu 18.04 | Windows 11, macOS 11+, Ubuntu 20.04+ |
| CPU | Intel/AMD/Apple Silicon | 4+ cores |
| RAM | 4GB | 8GB+ (for AI models) |
| Disk | 2GB free | 10GB (with AI models) |
| Network | Optional | Required for cloud AI |

---

Good luck with your installation! If you encounter issues, refer to the troubleshooting section or open an issue on GitHub.
