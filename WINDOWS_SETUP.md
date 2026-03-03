# Windows Installation Guide for NCode

Complete step-by-step guide for Windows users (Windows 10/11 64-bit).

## Prerequisites

- Windows 10 or Windows 11 (64-bit)
- Administrator access
- At least 10GB free disk space
- Stable internet connection

## Installation Steps

### ✅ Step 1: Install Node.js (5 minutes)

1. **Open your web browser**
2. **Go to:** https://nodejs.org/
3. **Click:** "Download LTS" (should be v18 or v20)
4. **Run the installer** (.msi file)
5. **Follow the steps:**
   - Accept License Agreement
   - Choose Installation Folder (default is fine)
   - Leave everything checked
   - Click "Install"
   - Wait for installation (2-3 minutes)
6. **Click "Finish"**

**Verify Installation:**
1. Open PowerShell (Press `Win + X`, then select "Windows Terminal" or "PowerShell")
2. Type:
   ```powershell
   node --version
   npm --version
   ```
3. Should show version numbers like `v18.15.0` and `9.x.x`

---

### ✅ Step 2: Install Rust (5 minutes)

1. **Open your web browser**
2. **Go to:** https://www.rust-lang.org/tools/install
3. **Click:** "DOWNLOAD RUSTUP-INIT.EXE"
4. **Run the installer**
5. **When asked for installation method:**
   - Press `1` and then Enter (default)
   - Wait for installation
6. **Close the window when done**

**Verify Installation:**
1. **Close and reopen PowerShell** (this is important!)
2. Type:
   ```powershell
   rustc --version
   cargo --version
   ```
3. Should show version information

---

### ✅ Step 3: Install Visual C++ Build Tools (5 minutes)

This is required for Rust compilation on Windows.

1. **Open your web browser**
2. **Go to:** https://aka.ms/vs/17/release/vs_BuildTools
3. **Click:** "Download"
4. **Run the installer** (Visual Studio Installer)
5. **When it opens:**
   - Click "Desktop development with C++"
   - Click "Install"
   - Wait for download (2-3 minutes)
   - Wait for installation (2-3 minutes)
6. **Restart your computer when prompted**

---

### ✅ Step 4: Install Git (Optional but Recommended - 2 minutes)

1. **Go to:** https://git-scm.com/download/win
2. **Click:** "Click here to download"
3. **Run installer**
4. **Click "Next" for all steps** (default options are fine)
5. **Click "Finish"**

---

### ✅ Step 5: Clone NCode Repository (2 minutes)

**Option A: Using Git (if you installed it)**

1. Open PowerShell
2. Navigate to where you want the project:
   ```powershell
   cd Desktop
   # or
   cd Documents
   # or wherever you want
   ```

3. Clone the repository:
   ```powershell
   git clone https://github.com/yourusername/ncode.git
   cd ncode
   ```

**Option B: Without Git (download as ZIP)**

1. Go to https://github.com/yourusername/ncode
2. Click green **"Code"** button
3. Click **"Download ZIP"**
4. Extract the ZIP file to your Desktop or Documents
5. Open PowerShell
6. Navigate to the folder:
   ```powershell
   cd Desktop\ncode
   # or wherever you extracted it
   ```

---

### ✅ Step 6: Install Dependencies (5-10 minutes)

1. Make sure you're in the `ncode` folder in PowerShell
2. Run:
   ```powershell
   npm install
   ```
   This will download and install all JavaScript dependencies (will take 5-10 minutes)

3. Then install Tauri CLI:
   ```powershell
   cargo install tauri-cli
   ```
   This will download and compile the Tauri CLI (will take 3-5 minutes)

---

### ✅ Step 7: Create a Shortcut to the Code (Optional)

To make it easier to open the project folder:

1. Open File Explorer
2. Navigate to your `ncode` folder
3. Right-click on the `ncode` folder
4. Select **"Pin to Quick access"**
5. Now it appears in the left sidebar for easy access

---

## Running NCode

### First Time (Development Mode)

1. **Open PowerShell**
2. **Navigate to your ncode folder:**
   ```powershell
   cd Desktop\ncode
   ```

3. **Start the development server:**
   ```powershell
   npm run tauri dev
   ```

   First time takes 3-5 minutes to compile. You'll see:
   - Lots of compilation messages
   - "Compiling NCode v0.1.0"
   - Then the app window opens!

4. **Click inside the app window** and start editing code!

### Subsequent Times (Much Faster!)

Just run:
```powershell
npm run tauri dev
```

Should open in 10-20 seconds after first time.

---

## Setting Up AI

### Option A: Local AI with Ollama (FREE)

This runs AI models on your computer. Best for privacy and no API costs.

**1. Install Ollama**
- Download from: https://ollama.ai/download
- Run the installer
- Restart when prompted

**2. Download an AI Model**

Open PowerShell and choose one:

```powershell
# Lightweight and fast (1GB) - RECOMMENDED FOR BEGINNERS
ollama pull deepseek-coder:1.3b

# Better quality, slower (4GB)
ollama pull codellama:7b-code-q4_0

# Even better but needs more RAM (13GB)
ollama pull codellama:13b-code-q4_0
```

This downloads the model (might take 2-5 minutes depending on size).

**3. Keep Ollama Running**

Ollama needs to stay running in the background. You can:

- **Option 1:** Leave PowerShell window open with `ollama serve` running
- **Option 2:** Ollama starts automatically on Windows startup (default)
- **Option 3:** Run it from Windows Start Menu if you can find it

**4. Configure in NCode**

1. **In NCode**, go to **Settings** (Ctrl+, or Ctrl+Shift+,)
2. Click the **"AI / LLM"** tab
3. Select **"Ollama (Local)"**
4. Click **"Fetch"** button
5. Your model should appear
6. Click to select it
7. Go back to chat and start typing!

---

### Option B: Cloud AI (OpenAI, Anthropic, Groq)

Uses someone else's computers to run AI. Costs money but often better quality.

**1. Get an API Key**

Choose one:

- **OpenAI (Best but costs):**
  - Go to https://platform.openai.com/api-keys
  - Sign up if needed
  - Click "Create new secret key"
  - Copy the key (starts with `sk-`)

- **Anthropic (Claude):**
  - Go to https://console.anthropic.com/
  - Get API key
  - Copy it

- **Groq (Fast and partly FREE):**
  - Go to https://console.groq.com/
  - Sign up
  - Get API key
  - Copy it

**2. Configure in NCode**

1. Open **Settings** (Ctrl+,)
2. Click **"AI / LLM"** tab
3. Select **"API Key (Cloud)"**
4. Choose your provider from dropdown
5. Paste your API key
6. Enter model name (e.g., `gpt-4o`, `claude-3-sonnet`, `mixtral-8x7b-32768`)
7. Click **"Add Key"**
8. Select it from the list
9. Start chatting!

---

## First Things to Try

1. **Open a Folder**
   - In NCode, click "Open Folder"
   - Select a project with code
   - Files appear on the left

2. **Quick Open Files**
   - Press Ctrl+P
   - Type a filename
   - Press Enter to open

3. **Use the Terminal**
   - Press Ctrl+` (backtick/grave accent key)
   - Terminal appears at bottom
   - Run any Windows commands!

4. **Search in Files**
   - Press Ctrl+H (search & replace)
   - Type to find code

5. **Ask AI for Help**
   - Click AI icon (top right)
   - Type a question
   - Get instant coding help!

---

## Keyboard Shortcuts

These work in NCode (many are same as VS Code):

| Shortcut | What it does |
|----------|--------------|
| **Ctrl+P** | Quick open files (fastest way!) |
| **Ctrl+H** | Find & replace |
| **Ctrl+F** | Find in file |
| **Ctrl+T** | Jump to symbol/function |
| **Ctrl+//** | Comment/uncomment line |
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

---

## Building a Release Version

When you want to give NCode to others:

1. In PowerShell (in your ncode folder):
   ```powershell
   npm run tauri build
   ```

2. This creates:
   - **MSI Installer:** Easier for others to install
   - **Portable EXE:** No installation needed

3. Files are in: `target\release\`

4. Share the `.msi` file - people can click to install!

---

## Troubleshooting

### "npm command not found"

**Solution:**
- Close PowerShell
- Open a fresh PowerShell window
- Try again
- If still doesn't work, restart Windows

### "cargo command not found"

**Solution:**
- Close PowerShell completely
- Open Task Manager (Ctrl+Shift+Esc)
- Click "PowerShell" → "End Task"
- Open a new PowerShell
- Try again

### "Visual C++ build tools required"

**Solution:**
1. Go to https://aka.ms/vs/17/release/vs_BuildTools
2. Download "Visual Studio Build Tools"
3. Run the installer
4. Check "Desktop development with C++"
5. Click "Install"
6. Wait 10-15 minutes
7. Restart Windows
8. Try again in new PowerShell

### Compilation Fails

**Solution 1:**
```powershell
# Clear cache and reinstall
rmdir node_modules -r -force
del package-lock.json
npm install
npm run tauri dev
```

**Solution 2:**
```powershell
# Clear Rust cache
cargo clean
npm run tauri dev
```

### Ollama not Connecting

**Check 1:** Ollama is running
- Look for Ollama in System Tray (bottom right)
- Or open PowerShell and run: `ollama serve`

**Check 2:** Test the connection
- Open browser to: http://localhost:11434/api/tags
- Should show JSON with your models
- If not, restart Ollama

### Settings Not Saving

Usually auto-saves. If not:
- Manual save: Press Ctrl+S
- Check folder permissions
- Try Settings → Editor → Restart app

---

## Tips for Windows Users

✅ **Do this:**
- Keep PowerShell/Terminal window open while running dev server
- Use Ctrl+P for everything (it's fastest!)
- Learn keyboard shortcuts instead of mouse
- Check Ollama is running before using local AI

❌ **Don't do this:**
- Close PowerShell while app is running
- Edit extremely large files (>50MB)
- Expect mouse to be faster than keyboard
- Blame the app if Ollama isn't running!

---

## Getting Help

If you get stuck:

1. **Check this guide again** - Most issues are covered above
2. **Read the [README.md](./README.md)** - Full documentation
3. **Open an Issue on GitHub** - Report bugs
4. **Check GitHub Discussions** - Ask questions

---

## You're Ready! 🎉

You now have NCode installed and ready to use!

**Next steps:**
1. Open a project folder
2. Press Ctrl+P to try it out
3. Turn on AI (Settings → AI / LLM)
4. Ask AI a question
5. Start coding!

**Welcome to NCode!**
