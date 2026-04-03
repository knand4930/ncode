// src-tauri/src/commands/process_commands.rs
use serde::Serialize;
use std::collections::HashMap;
use std::io::Read;
use std::process::{Command, Stdio};
use std::sync::{Arc, LazyLock, Mutex};
use std::thread;
use tauri::{command, AppHandle, Emitter};

static RUNNING_COMMANDS: LazyLock<Mutex<HashMap<String, u32>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandFinishedPayload {
    run_id: String,
    command: String,
    exit_code: i32,
    output: String,
}

fn emit_to_terminal(app: &AppHandle, terminal_id: &Option<String>, text: &str) {
    if let Some(id) = terminal_id {
        let _ = app.emit(&format!("terminal-output-{id}"), text.to_string());
    }
}

fn spawn_output_reader<R>(
    app: AppHandle,
    run_id: String,
    terminal_id: Option<String>,
    reader: R,
    output: Arc<Mutex<String>>,
) -> thread::JoinHandle<()>
where
    R: Read + Send + 'static,
{
    thread::spawn(move || {
        let mut reader = std::io::BufReader::new(reader);
        let mut buf = [0u8; 4096];
        loop {
            match reader.read(&mut buf) {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    let text = String::from_utf8_lossy(&buf[..n]).to_string();
                    if let Ok(mut out) = output.lock() {
                        out.push_str(&text);
                    }
                    let _ = app.emit(&format!("command-output-{}", run_id), text.clone());
                    emit_to_terminal(&app, &terminal_id, &text);
                }
            }
        }
    })
}

#[cfg(target_os = "windows")]
fn build_shell_command(cmd: &str) -> Command {
    let mut command = Command::new("cmd");
    command.arg("/C").arg(cmd);
    command
}

#[cfg(not(target_os = "windows"))]
fn build_shell_command(cmd: &str) -> Command {
    let mut command = Command::new("sh");
    command.arg("-lc").arg(cmd);
    command
}

#[command]
pub fn run_command(cmd: String, cwd: String) -> Result<String, String> {
    let output = build_shell_command(&cmd)
        .current_dir(&cwd)
        .output()
        .map_err(|e| e.to_string())?;

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();
    let combined = match (stdout.trim().is_empty(), stderr.trim().is_empty()) {
        (false, false) => format!("{stdout}\n{stderr}"),
        (false, true) => stdout,
        (true, false) => stderr,
        (true, true) => String::new(),
    };

    if output.status.success() {
        Ok(combined)
    } else {
        Err(combined)
    }
}

#[command]
pub async fn run_command_stream(
    app: AppHandle,
    run_id: String,
    cmd: String,
    cwd: String,
    terminal_id: Option<String>,
) -> Result<(), String> {
    let mut command = build_shell_command(&cmd);
    command
        .current_dir(&cwd)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .env("TERM", "xterm-256color")
        .env("COLORTERM", "truecolor")
        .env("LANG", "en_US.UTF-8")
        .env("TERM_PROGRAM", "NCode");

    let mut child = command
        .spawn()
        .map_err(|e| format!("Failed to start command `{cmd}`: {e}"))?;

    let pid = child.id();
    let stdout = child.stdout.take().ok_or("Failed to capture stdout")?;
    let stderr = child.stderr.take().ok_or("Failed to capture stderr")?;
    let collected_output = Arc::new(Mutex::new(String::new()));

    RUNNING_COMMANDS
        .lock()
        .unwrap()
        .insert(run_id.clone(), pid);

    emit_to_terminal(
        &app,
        &terminal_id,
        &format!("\x1b[90m$ {}\x1b[0m\r\n", cmd),
    );

    let stdout_handle = spawn_output_reader(
        app.clone(),
        run_id.clone(),
        terminal_id.clone(),
        stdout,
        collected_output.clone(),
    );
    let stderr_handle = spawn_output_reader(
        app.clone(),
        run_id.clone(),
        terminal_id.clone(),
        stderr,
        collected_output.clone(),
    );

    thread::spawn(move || {
        let wait_result = child.wait();
        let _ = stdout_handle.join();
        let _ = stderr_handle.join();

        RUNNING_COMMANDS.lock().unwrap().remove(&run_id);

        let exit_code = match wait_result {
            Ok(status) => status
                .code()
                .unwrap_or(if status.success() { 0 } else { -1 }),
            Err(_) => -1,
        };

        let output = collected_output
            .lock()
            .map(|text| text.clone())
            .unwrap_or_else(|_| String::new());

        let summary = if exit_code == 0 {
            format!("\r\n\x1b[32m✓ Exit {exit_code}\x1b[0m\r\n")
        } else {
            format!("\r\n\x1b[31m✗ Exit {exit_code}\x1b[0m\r\n")
        };
        emit_to_terminal(&app, &terminal_id, &summary);

        let _ = app.emit(
            &format!("command-finished-{}", run_id),
            CommandFinishedPayload {
                run_id,
                command: cmd,
                exit_code,
                output,
            },
        );
    });

    Ok(())
}

#[command]
pub fn kill_command_run(run_id: String) -> Result<(), String> {
    let pid = RUNNING_COMMANDS
        .lock()
        .unwrap()
        .remove(&run_id)
        .ok_or_else(|| format!("No running command found for `{run_id}`"))?;

    #[cfg(target_os = "windows")]
    {
        let status = Command::new("taskkill")
            .args(["/PID", &pid.to_string(), "/T", "/F"])
            .status()
            .map_err(|e| format!("Failed to stop command `{run_id}`: {e}"))?;
        if !status.success() {
            return Err(format!("Failed to stop command `{run_id}`"));
        }
    }

    #[cfg(not(target_os = "windows"))]
    {
        let result = unsafe { libc::kill(pid as i32, libc::SIGTERM) };
        if result == -1 {
            return Err(format!(
                "Failed to stop command `{run_id}`: {}",
                std::io::Error::last_os_error()
            ));
        }
    }

    Ok(())
}
