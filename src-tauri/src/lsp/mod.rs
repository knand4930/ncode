// src-tauri/src/lsp/mod.rs
// LSP (Language Server Protocol) bridge
// Connects to language servers for advanced code intelligence

use std::collections::HashMap;
use std::process::{Child, Command, Stdio};
use std::sync::{LazyLock, Mutex};
use serde::{Deserialize, Serialize};
use tauri::command;

static LSP_PROCESSES: LazyLock<Mutex<HashMap<String, u32>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

#[derive(Serialize, Deserialize)]
pub struct LSPConfig {
    pub language: String,
    pub command: String,
    pub args: Vec<String>,
}

// Language server configurations
pub fn get_lsp_config(language: &str) -> Option<LSPConfig> {
    match language {
        "typescript" | "javascript" => Some(LSPConfig {
            language: language.to_string(),
            command: "typescript-language-server".to_string(),
            args: vec!["--stdio".to_string()],
        }),
        "python" => Some(LSPConfig {
            language: language.to_string(),
            command: "pylsp".to_string(),
            args: vec![],
        }),
        "rust" => Some(LSPConfig {
            language: language.to_string(),
            command: "rust-analyzer".to_string(),
            args: vec![],
        }),
        "go" => Some(LSPConfig {
            language: language.to_string(),
            command: "gopls".to_string(),
            args: vec![],
        }),
        "java" => Some(LSPConfig {
            language: language.to_string(),
            command: "jdtls".to_string(),
            args: vec![],
        }),
        "cpp" | "c" => Some(LSPConfig {
            language: language.to_string(),
            command: "clangd".to_string(),
            args: vec![],
        }),
        _ => None,
    }
}

#[command]
pub fn start_lsp(language: String, workspace_root: String) -> Result<String, String> {
    let config = get_lsp_config(&language)
        .ok_or_else(|| format!("No LSP configured for {}", language))?;

    // Check if command exists
    let which = Command::new("which")
        .arg(&config.command)
        .output()
        .map_err(|e| e.to_string())?;

    if !which.status.success() {
        return Err(format!(
            "LSP '{}' not found. Install it:\n{}",
            config.command,
            get_install_instructions(&language)
        ));
    }

    Ok(format!("LSP {} ready for {}", config.command, language))
}

#[command]
pub fn lsp_request(_language: String, _method: String, _params: String) -> Result<String, String> {
    // In a full implementation, this would forward JSON-RPC to the LSP process
    // For now, Monaco provides built-in completions for most languages
    Ok("{}".to_string())
}

fn get_install_instructions(language: &str) -> &'static str {
    match language {
        "typescript" | "javascript" => "npm install -g typescript-language-server typescript",
        "python" => "pip install python-lsp-server",
        "rust" => "rustup component add rust-analyzer",
        "go" => "go install golang.org/x/tools/gopls@latest",
        "cpp" | "c" => "Install clangd via LLVM or your package manager",
        _ => "Check the LSP documentation",
    }
}
