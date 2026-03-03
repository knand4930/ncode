// src-tauri/src/commands/terminal_commands.rs
use std::collections::HashMap;
use std::sync::{LazyLock, Mutex};
use tauri::{command, AppHandle, Emitter};

// PTY sessions stored by ID
static TERMINALS: LazyLock<Mutex<HashMap<String, u32>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

#[command]
pub async fn create_terminal(
    app: AppHandle,
    id: String,
    cwd: String,
) -> Result<(), String> {
    // In production, use tauri-plugin-pty or portable-pty crate
    // This spawns a shell process and bridges I/O via Tauri events
    
    #[cfg(target_os = "windows")]
    let shell = "cmd.exe";
    #[cfg(not(target_os = "windows"))]
    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/bash".to_string());
    
    let term_id = id.clone();
    let _app_handle = app.clone();
    
    // Spawn shell
    let mut cmd = std::process::Command::new(&shell);
    cmd.current_dir(&cwd)
       .stdin(std::process::Stdio::piped())
       .stdout(std::process::Stdio::piped())
       .stderr(std::process::Stdio::piped());
    
    match cmd.spawn() {
        Ok(child) => {
            let pid = child.id();
            TERMINALS.lock().unwrap().insert(id.clone(), pid);
            
            // Bridge stdout to frontend
            let _stdout = child.stdout;
            let _err_id = term_id.clone();
            
            // In real impl: spawn thread to read stdout and emit events
            // app_handle.emit(&format!("terminal-output-{}", term_id), output)?;
            
            Ok(())
        }
        Err(_e) => {
            // Fallback: emit a welcome message so terminal isn't blank
            app.emit(&format!("terminal-output-{}", id), 
                "\x1b[32mNCode Terminal\x1b[0m\r\n$ ".to_string())
                .ok();
            Ok(()) // Don't fail, terminal still shows
        }
    }
}

#[command]
pub async fn write_to_terminal(_id: String, _data: String) -> Result<(), String> {
    // Write to PTY stdin (no-op placeholder)
    // In production: look up PTY by ID and write to it
    Ok(())
}

#[command]
pub fn kill_terminal(id: String) -> Result<(), String> {
    if let Some(pid) = TERMINALS.lock().unwrap().remove(&id) {
        #[cfg(unix)]
        unsafe { libc::kill(pid as i32, libc::SIGTERM); }
    }
    Ok(())
}
