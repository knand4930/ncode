// src-tauri/src/commands/terminal_commands.rs
use std::collections::HashMap;
#[cfg(unix)]
use std::fs::File;
use std::io::{Read, Write};
#[cfg(unix)]
use std::os::fd::{AsRawFd, FromRawFd};
#[cfg(unix)]
use std::os::unix::process::CommandExt;
use std::path::Path;
use std::process::{Child, Command, Stdio};
#[cfg(not(unix))]
use std::process::ChildStdin;
use std::sync::{LazyLock, Mutex};
use std::thread;
use serde::Serialize;
use tauri::{command, AppHandle, Emitter};

enum TerminalWriter {
    #[cfg(not(unix))]
    Stdin(ChildStdin),
    #[cfg(unix)]
    Pty(File),
}

impl TerminalWriter {
    fn write_all(&mut self, data: &[u8]) -> Result<(), String> {
        match self {
            #[cfg(not(unix))]
            TerminalWriter::Stdin(stdin) => {
                stdin
                    .write_all(data)
                    .map_err(|e| format!("Write failed: {e}"))?;
                stdin.flush().map_err(|e| format!("Flush failed: {e}"))
            }
            #[cfg(unix)]
            TerminalWriter::Pty(file) => {
                file.write_all(data)
                    .map_err(|e| format!("Write failed: {e}"))?;
                file.flush().map_err(|e| format!("Flush failed: {e}"))
            }
        }
    }

    fn resize(&self, cols: u16, rows: u16) -> Result<(), String> {
        match self {
            #[cfg(not(unix))]
            TerminalWriter::Stdin(_) => Ok(()),
            #[cfg(unix)]
            TerminalWriter::Pty(file) => {
                let winsize = libc::winsize {
                    ws_row: rows,
                    ws_col: cols,
                    ws_xpixel: 0,
                    ws_ypixel: 0,
                };

                let result = unsafe { libc::ioctl(file.as_raw_fd(), libc::TIOCSWINSZ, &winsize) };
                if result == -1 {
                    return Err(format!(
                        "Failed to resize PTY: {}",
                        std::io::Error::last_os_error()
                    ));
                }

                Ok(())
            }
        }
    }
}

struct TerminalSession {
    writer: TerminalWriter,
    child: Child,
}

static TERMINALS: LazyLock<Mutex<HashMap<String, TerminalSession>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalCreateInfo {
    shell_name: String,
    cwd: String,
}

fn resolved_cwd(cwd: &str) -> String {
    if Path::new(cwd).exists() {
        return cwd.to_string();
    }

    if let Ok(home) = std::env::var("HOME") {
        if Path::new(&home).exists() {
            return home;
        }
    }

    if let Ok(current_dir) = std::env::current_dir() {
        let current_dir = current_dir.to_string_lossy().to_string();
        if Path::new(&current_dir).exists() {
            return current_dir;
        }
    }

    "/tmp".to_string()
}

#[cfg(target_os = "windows")]
fn resolve_shell() -> Result<(String, Vec<String>), String> {
    if let Ok(comspec) = std::env::var("COMSPEC") {
        if !comspec.trim().is_empty() {
            return Ok((comspec, Vec::new()));
        }
    }

    Ok(("cmd.exe".to_string(), Vec::new()))
}

#[cfg(unix)]
fn resolve_shell() -> Result<(String, Vec<String>), String> {
    let mut candidates = Vec::new();

    if let Ok(shell) = std::env::var("SHELL") {
        if !shell.trim().is_empty() {
            candidates.push(shell);
        }
    }

    candidates.extend(
        ["/bin/bash", "/bin/zsh", "/bin/sh", "/usr/bin/bash", "/usr/bin/zsh", "/usr/bin/sh"]
            .into_iter()
            .map(|s| s.to_string()),
    );

    for candidate in candidates {
        if Path::new(&candidate).exists() {
            return Ok((candidate, vec!["-i".to_string()]));
        }
    }

    Err("No supported shell found. Checked SHELL, /bin/bash, /bin/zsh, and /bin/sh.".to_string())
}

fn emit_banner(app: &AppHandle, id: &str, cwd_display: &str) {
    let app_init = app.clone();
    let id_init = id.to_string();
    let cwd_display = cwd_display.to_string();
    thread::spawn(move || {
        thread::sleep(std::time::Duration::from_millis(80));
        let _ = app_init.emit(
            &format!("terminal-output-{}", id_init),
            format!("\x1b[32mNCode Terminal\x1b[0m — {}\r\n", cwd_display),
        );
    });
}

fn shell_label(shell: &str) -> String {
    Path::new(shell)
        .file_name()
        .and_then(|name| name.to_str())
        .filter(|name| !name.trim().is_empty())
        .unwrap_or("shell")
        .to_string()
}

fn spawn_pipe_reader<R>(app: AppHandle, id: String, reader: R)
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
                    let _ = app.emit(&format!("terminal-output-{}", id), text);
                }
            }
        }
    });
}

#[cfg(unix)]
fn dup_fd(fd: libc::c_int) -> Result<libc::c_int, String> {
    let duplicated = unsafe { libc::dup(fd) };
    if duplicated == -1 {
        return Err(format!(
            "Failed to duplicate PTY file descriptor: {}",
            std::io::Error::last_os_error()
        ));
    }
    Ok(duplicated)
}

#[cfg(unix)]
fn create_terminal_session(
    app: &AppHandle,
    id: &str,
    shell: &str,
    args: &[String],
    cwd: &str,
) -> Result<TerminalSession, String> {
    let mut master = -1;
    let mut slave = -1;

    let openpty_result = unsafe {
        libc::openpty(
            &mut master,
            &mut slave,
            std::ptr::null_mut(),
            std::ptr::null(),
            std::ptr::null(),
        )
    };

    if openpty_result == -1 {
        return Err(format!(
            "Failed to allocate PTY: {}",
            std::io::Error::last_os_error()
        ));
    }

    let stdout_fd = dup_fd(slave)?;
    let stderr_fd = dup_fd(slave)?;
    let slave_for_ctty = slave;

    let stdin = unsafe { Stdio::from_raw_fd(slave) };
    let stdout = unsafe { Stdio::from_raw_fd(stdout_fd) };
    let stderr = unsafe { Stdio::from_raw_fd(stderr_fd) };

    let mut cmd = Command::new(shell);
    cmd.args(args)
        .current_dir(cwd)
        .stdin(stdin)
        .stdout(stdout)
        .stderr(stderr)
        .env("TERM", "xterm-256color")
        .env("COLORTERM", "truecolor")
        .env("LANG", "en_US.UTF-8")
        .env("TERM_PROGRAM", "NCode");

    unsafe {
        cmd.pre_exec(move || {
            if libc::setsid() == -1 {
                return Err(std::io::Error::last_os_error());
            }

            if libc::ioctl(slave_for_ctty, libc::TIOCSCTTY as _, 0) == -1 {
                return Err(std::io::Error::last_os_error());
            }

            Ok(())
        });
    }

    let child = cmd
        .spawn()
        .map_err(|e| format!("Failed to spawn shell `{shell}`: {e}"))?;

    let master_file = unsafe { File::from_raw_fd(master) };
    let reader = master_file
        .try_clone()
        .map_err(|e| format!("Failed to clone PTY reader: {e}"))?;

    spawn_pipe_reader(app.clone(), id.to_string(), reader);

    Ok(TerminalSession {
        writer: TerminalWriter::Pty(master_file),
        child,
    })
}

#[cfg(not(unix))]
fn create_terminal_session(
    app: &AppHandle,
    id: &str,
    shell: &str,
    args: &[String],
    cwd: &str,
) -> Result<TerminalSession, String> {
    let mut cmd = Command::new(shell);
    cmd.args(args)
        .current_dir(cwd)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .env("TERM", "xterm-256color")
        .env("COLORTERM", "truecolor")
        .env("LANG", "en_US.UTF-8")
        .env("TERM_PROGRAM", "NCode");

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("Failed to spawn shell `{shell}`: {e}"))?;

    let stdin = child.stdin.take().ok_or("No stdin")?;
    let stdout = child.stdout.take().ok_or("No stdout")?;
    let stderr = child.stderr.take().ok_or("No stderr")?;

    spawn_pipe_reader(app.clone(), id.to_string(), stdout);
    spawn_pipe_reader(app.clone(), id.to_string(), stderr);

    Ok(TerminalSession {
        writer: TerminalWriter::Stdin(stdin),
        child,
    })
}

#[command]
pub async fn create_terminal(
    app: AppHandle,
    id: String,
    cwd: String,
) -> Result<TerminalCreateInfo, String> {
    let (shell, args) = resolve_shell()?;
    let cwd = resolved_cwd(&cwd);

    let session = create_terminal_session(&app, &id, &shell, &args, &cwd)?;

    TERMINALS.lock().unwrap().insert(id.clone(), session);
    emit_banner(&app, &id, &cwd);

    Ok(TerminalCreateInfo {
        shell_name: shell_label(&shell),
        cwd,
    })
}

#[command]
pub async fn write_to_terminal(id: String, data: String) -> Result<(), String> {
    let mut map = TERMINALS.lock().unwrap();
    let session = map
        .get_mut(&id)
        .ok_or_else(|| format!("Terminal session `{id}` not found"))?;

    session.writer.write_all(data.as_bytes())
}

#[command]
pub fn resize_terminal(id: String, cols: u16, rows: u16) -> Result<(), String> {
    let map = TERMINALS.lock().unwrap();
    let session = map
        .get(&id)
        .ok_or_else(|| format!("Terminal session `{id}` not found"))?;

    session.writer.resize(cols, rows)
}

#[command]
pub fn kill_terminal(id: String) -> Result<(), String> {
    let mut map = TERMINALS.lock().unwrap();
    if let Some(mut session) = map.remove(&id) {
        let _ = session.child.kill();
        let _ = session.child.wait();
    }
    Ok(())
}
