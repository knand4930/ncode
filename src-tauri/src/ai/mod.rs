// src-tauri/src/ai/mod.rs
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{SystemTime, UNIX_EPOCH};
use serde::{Deserialize, Serialize};
use tauri::{command, AppHandle, Emitter};

const OLLAMA_BASE_LOCALHOST: &str = "http://localhost:11434";
const OLLAMA_BASE_LOOPBACK: &str = "http://127.0.0.1:11434";
const OLLAMA_BASE: &str = OLLAMA_BASE_LOCALHOST;
const LOCAL_OLLAMA_SYSTEM_PROMPT: &str =
    "You are NCode local coding assistant running on a user-selected Ollama model. \
     Never claim you are ChatGPT, OpenAI, Claude, Gemini, or any cloud-hosted provider. \
     Use project/context data provided in this chat. \
     Do not refuse with generic privacy/copyright disclaimers for normal code review requests. \
     If code context is missing, ask the user to enable RAG or include @file and then continue.";

#[derive(Serialize, Deserialize, Debug)]
pub struct OllamaRequest {
    pub model: String,
    pub prompt: String,
    pub stream: bool,
    pub options: Option<OllamaOptions>,
}

#[derive(Serialize, Deserialize, Debug)]
pub struct OllamaOptions {
    pub temperature: f32,
    pub num_predict: i32,
    pub stop: Option<Vec<String>>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct OllamaChatMessage {
    pub role: String,
    pub content: String,
}

#[derive(Serialize, Deserialize, Debug)]
pub struct OllamaChatRequest {
    pub model: String,
    pub messages: Vec<OllamaChatMessage>,
    pub stream: bool,
}

#[derive(Serialize, Deserialize, Debug)]
pub struct OllamaResponse {
    pub response: Option<String>,
    pub message: Option<OllamaChatMessage>,
    pub done: bool,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct CodeChunk {
    pub file_path: String,
    pub content: String,
    pub start_line: usize,
    pub end_line: usize,
    pub language: String,
}

#[derive(Serialize, Deserialize, Debug)]
pub struct RAGResult {
    pub answer: String,
    pub sources: Vec<CodeChunk>,
}

#[derive(Serialize, Clone)]
struct AgentEventPayload {
    kind: String,
    message: String,
    ts: u64,
}

#[derive(Deserialize, Debug, Default)]
struct AgentAction {
    action: String,
    reason: Option<String>,
    query: Option<String>,
    path: Option<String>,
}

fn now_ts_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn emit_agent_event(
    app: &AppHandle,
    run_id: &str,
    kind: &str,
    message: impl Into<String>,
) -> Result<(), String> {
    app.emit(
        &format!("ai-agent-{}", run_id),
        AgentEventPayload {
            kind: kind.to_string(),
            message: message.into(),
            ts: now_ts_millis(),
        },
    )
    .map_err(|e| e.to_string())
}

/// Check if Ollama is running and which models are available
/// If the HTTP endpoint is unreachable we fall back to running `ollama list`
#[command]
pub async fn check_ollama_status() -> Result<Vec<String>, String> {
    if let Ok(models) = fetch_ollama_tags(OLLAMA_BASE_LOCALHOST).await {
        return Ok(models);
    }
    if let Ok(models) = fetch_ollama_tags(OLLAMA_BASE_LOOPBACK).await {
        return Ok(models);
    }

    Err("Ollama server is not reachable on localhost:11434".to_string())
}

async fn fetch_ollama_tags(base: &str) -> Result<Vec<String>, String> {
    #[derive(Deserialize)]
    struct TagsResponse {
        models: Vec<ModelInfo>,
    }
    #[derive(Deserialize)]
    struct ModelInfo {
        name: String,
    }

    let client = reqwest::Client::new();
    let resp = client
        .get(format!("{}/api/tags", base))
        .send()
        .await
        .map_err(|e| e.to_string())?
        .error_for_status()
        .map_err(|e| e.to_string())?;
    let tags: TagsResponse = resp.json().await.map_err(|e| e.to_string())?;
    Ok(tags.models.into_iter().map(|m| m.name).collect())
}

/// Run `ollama list` on the host machine and parse the model names.
#[command]
pub async fn ollama_list_local() -> Result<Vec<String>, String> {
    let output_json = Command::new("ollama")
        .arg("list")
        .arg("--json")
        .output()
        .map_err(|e| format!("failed to spawn ollama: {}", e))?;

    if output_json.status.success() {
        let s = String::from_utf8_lossy(&output_json.stdout);
        if let Ok(v) = serde_json::from_str::<serde_json::Value>(&s) {
            if let Some(arr) = v.get("models").and_then(|m| m.as_array()) {
                let names = arr
                    .iter()
                    .filter_map(|e| e.get("name").and_then(|n| n.as_str()).map(|s| s.to_string()))
                    .collect();
                return Ok(names);
            }
        }
    }

    // fallback: plain table output
    let output = Command::new("ollama")
        .arg("list")
        .output()
        .map_err(|e| format!("failed to spawn ollama: {}", e))?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
    }

    let s = String::from_utf8_lossy(&output.stdout);
    let lines: Vec<String> = s
            .lines()
            .skip(1)
            .filter_map(|l| l.split_whitespace().next().map(|p| p.to_string()))
            .collect();
    Ok(lines)
}

/// spawn `ollama serve` in background; does not wait for completion
#[command]
pub async fn start_ollama() -> Result<(), String> {
    let mut cmd = Command::new("ollama");
    cmd.arg("serve");
    cmd.stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null());
    cmd.spawn()
        .map(|_| ())
        .map_err(|e| format!("failed to launch ollama: {}", e))
}

/// Basic completion for inline code suggestions
#[command]
pub async fn ollama_complete(
    model: String,
    prompt: String,
    max_tokens: Option<i32>,
) -> Result<String, String> {
    let client = reqwest::Client::new();

    let request = OllamaRequest {
        model,
        prompt,
        stream: false,
        options: Some(OllamaOptions {
            temperature: 0.1, // Low temp for code
            num_predict: max_tokens.unwrap_or(150),
            stop: Some(vec![
                "\n\n".to_string(),
                "```".to_string(),
                "// end".to_string(),
            ]),
        }),
    };

    let resp = client
        .post(format!("{}/api/generate", OLLAMA_BASE))
        .json(&request)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    let result: OllamaResponse = resp.json().await.map_err(|e| e.to_string())?;
    Ok(result.response.unwrap_or_default())
}

/// Multi-turn chat for AI panel (like Cursor chat)
#[command]
pub async fn ollama_chat(
    model: String,
    messages: Vec<OllamaChatMessage>,
    context: Option<String>, // RAG context
) -> Result<String, String> {
    let client = reqwest::Client::new();
    let model_name = model.clone();

    let mut all_messages = messages;
    
    // Prepend system message with context if provided
    if let Some(ctx) = context {
        all_messages.insert(0, OllamaChatMessage {
            role: "system".to_string(),
            content: format!(
                "{}\n\nUse this codebase context to answer with concrete file-level guidance:\n\n{}\n\nBe precise and reference specific files/lines when helpful.",
                LOCAL_OLLAMA_SYSTEM_PROMPT, ctx
            ),
        });
    } else {
        all_messages.insert(0, OllamaChatMessage {
            role: "system".to_string(),
            content: format!(
                "{}\n\nWrite clean, practical answers for code tasks.",
                LOCAL_OLLAMA_SYSTEM_PROMPT
            ),
        });
    }

    let messages_for_rewrite = all_messages.clone();
    let request = OllamaChatRequest {
        model,
        messages: all_messages,
        stream: false,
    };

    let resp = client
        .post(format!("{}/api/chat", OLLAMA_BASE))
        .json(&request)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    let result: OllamaResponse = resp.json().await.map_err(|e| e.to_string())?;
    
    if let Some(msg) = result.message {
        let mut content = msg.content;
        if looks_like_nonlocal_identity_refusal(&content) {
            if let Ok(rewritten) = rewrite_nonlocal_identity_response(
                &model_name,
                &messages_for_rewrite,
                &content,
            )
            .await
            {
                content = rewritten;
            } else {
                content = sanitize_nonlocal_identity_terms(&content);
            }
        }
        Ok(content)
    } else {
        Err("No response from model".to_string())
    }
}

fn looks_like_nonlocal_identity_refusal(text: &str) -> bool {
    let t = text.to_lowercase();
    let identity_hit = t.contains("chatgpt")
        || t.contains("openai")
        || t.contains("as an ai language model")
        || t.contains("developed by openai")
        || t.contains("designed by chatgpt");
    let refusal_hit = t.contains("cannot access")
        || t.contains("can't access")
        || t.contains("unable to access")
        || t.contains("privacy policies")
        || (t.contains("privacy") && t.contains("restrictions"));
    identity_hit && refusal_hit
}

fn sanitize_nonlocal_identity_terms(text: &str) -> String {
    text
        .replace("ChatGPT", "NCode local assistant")
        .replace("chatgpt", "NCode local assistant")
        .replace("OpenAI", "local Ollama model")
        .replace("openai", "local ollama model")
}

async fn rewrite_nonlocal_identity_response(
    model: &str,
    prior_messages: &[OllamaChatMessage],
    draft: &str,
) -> Result<String, String> {
    let last_user = prior_messages
        .iter()
        .rev()
        .find(|m| m.role == "user")
        .map(|m| m.content.clone())
        .unwrap_or_default();
    let rewrite_messages = vec![
        OllamaChatMessage {
            role: "system".to_string(),
            content: format!(
                "{}\n\
                 Rewrite assistant drafts for local NCode usage.\n\
                 Hard rules:\n\
                 - Do not mention ChatGPT, OpenAI, cloud provider identity, privacy-policy refusal text.\n\
                 - Assume this is a local Ollama model selected by the user.\n\
                 - Answer the user's coding request directly.\n\
                 - If file/project context is missing, ask for @file or RAG briefly and still provide useful next steps.",
                LOCAL_OLLAMA_SYSTEM_PROMPT
            ),
        },
        OllamaChatMessage {
            role: "user".to_string(),
            content: format!(
                "User request:\n{}\n\nDraft answer to rewrite:\n{}",
                last_user, draft
            ),
        },
    ];

    let rewritten = ollama_chat_direct(model, rewrite_messages).await?;
    Ok(sanitize_nonlocal_identity_terms(&rewritten))
}

/// Index entire codebase for RAG (runs in background)
#[command]
pub async fn index_codebase(
    root_path: String,
    chunk_size: Option<usize>,
) -> Result<usize, String> {
    let chunk_size = chunk_size.unwrap_or(50); // lines per chunk
    let mut chunks = Vec::new();
    
    index_directory(&root_path, &mut chunks, chunk_size)?;
    
    // Store index to temp file for fast loading
    let index_path = format!("{}/.NCode/index.json", root_path);
    std::fs::create_dir_all(format!("{}/.NCode", root_path))
        .map_err(|e| e.to_string())?;
    
    let json = serde_json::to_string(&chunks).map_err(|e| e.to_string())?;
    std::fs::write(&index_path, json).map_err(|e| e.to_string())?;
    
    Ok(chunks.len())
}

// Generic external LLM API chat call. Currently only OpenAI is implemented.
#[derive(Serialize, Deserialize, Debug)]
pub struct ExternalChatRequest {
    pub provider: String,
    pub api_key: String,
    pub model: String,
    pub messages: Vec<OllamaChatMessage>,
    pub context: Option<String>,
}

#[command]
pub async fn api_chat(
    provider: String,
    api_key: String,
    model: String,
    messages: Vec<OllamaChatMessage>,
    context: Option<String>,
) -> Result<String, String> {
    match provider.to_lowercase().as_str() {
        "openai" => {
            // convert to OpenAI API format
            #[derive(Serialize)]
            struct OpenAIMessage {
                role: String,
                content: String,
            }
            #[derive(Serialize)]
            struct OpenAIRequest {
                model: String,
                messages: Vec<OpenAIMessage>,
            }

            let mut all_msgs = Vec::new();
            if let Some(ctx) = context {
                all_msgs.push(OpenAIMessage {
                    role: "system".to_string(),
                    content: ctx,
                });
            }
            for m in messages.iter() {
                all_msgs.push(OpenAIMessage {
                    role: m.role.clone(),
                    content: m.content.clone(),
                });
            }

            let req_body = OpenAIRequest {
                model,
                messages: all_msgs,
            };
            let client = reqwest::Client::new();
            let resp = client
                .post("https://api.openai.com/v1/chat/completions")
                .bearer_auth(&api_key)
                .json(&req_body)
                .send()
                .await
                .map_err(|e| e.to_string())?;
            let json: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;
            if let Some(content) = json["choices"][0]["message"]["content"].as_str() {
                Ok(content.to_string())
            } else {
                Err("OpenAI response missing content".to_string())
            }
        }
        other => Err(format!("Provider '{}' not supported", other)),
    }
}

#[command]
pub async fn api_complete(
    provider: String,
    api_key: String,
    model: String,
    prompt: String,
    max_tokens: Option<i32>,
) -> Result<String, String> {
    match provider.to_lowercase().as_str() {
        "openai" => {
            #[derive(Serialize)]
            struct OpenAIReq<'a> {
                model: &'a str,
                prompt: &'a str,
                max_tokens: i32,
            }
            let req = OpenAIReq {
                model: &model,
                prompt: &prompt,
                max_tokens: max_tokens.unwrap_or(100),
            };
            let client = reqwest::Client::new();
            let resp = client
                .post("https://api.openai.com/v1/completions")
                .bearer_auth(&api_key)
                .json(&req)
                .send()
                .await
                .map_err(|e| e.to_string())?;
            let json: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;
            if let Some(text) = json["choices"][0]["text"].as_str() {
                Ok(text.to_string())
            } else {
                Err("OpenAI completion missing text".to_string())
            }
        }
        other => Err(format!("Provider '{}' not supported", other)),
    }
}

fn index_directory(
    path: &str, 
    chunks: &mut Vec<CodeChunk>, 
    chunk_size: usize
) -> Result<(), String> {
    let entries = std::fs::read_dir(path).map_err(|e| e.to_string())?;
    
    let code_extensions = ["rs", "ts", "tsx", "js", "jsx", "py", "go", "java", 
                           "cpp", "c", "h", "cs", "rb", "php", "swift", "kt",
                           "vue", "svelte", "md", "toml", "json", "yaml", "yml"];
    
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        if name.starts_with('.')
            || name == "node_modules"
            || name == "target"
            || name == "__pycache__"
            || name == "venv"
            || name == "env"
            || name == "dist"
            || name == "build"
        {
            continue;
        }
        
        let path_str = entry.path().to_string_lossy().to_string();
        let meta = entry.metadata().map_err(|e| e.to_string())?;
        
        if meta.is_dir() {
            let _ = index_directory(&path_str, chunks, chunk_size);
        } else if let Some(ext) = entry.path().extension() {
            let ext_str = ext.to_string_lossy().to_lowercase();
            if code_extensions.contains(&ext_str.as_str()) {
                if let Ok(content) = std::fs::read_to_string(&path_str) {
                    // Skip very large files
                    if content.len() > 500_000 { continue; }
                    
                    let lines: Vec<&str> = content.lines().collect();
                    let language = ext_str.to_string();
                    
                    // Chunk by lines
                    for (i, chunk_lines) in lines.chunks(chunk_size).enumerate() {
                        let start = i * chunk_size + 1;
                        let end = start + chunk_lines.len() - 1;
                        chunks.push(CodeChunk {
                            file_path: path_str.clone(),
                            content: chunk_lines.join("\n"),
                            start_line: start,
                            end_line: end,
                            language: language.clone(),
                        });
                    }
                }
            }
        }
    }
    
    Ok(())
}

fn default_model(model: String) -> String {
    if model.trim().is_empty() {
        "deepseek-coder:1.3b".to_string()
    } else {
        model
    }
}

fn load_indexed_chunks(root_path: &str) -> Result<Vec<CodeChunk>, String> {
    let index_path = format!("{}/.NCode/index.json", root_path);
    let index_json = std::fs::read_to_string(&index_path)
        .map_err(|_| "Codebase not indexed yet. Click 'Index Codebase' first.".to_string())?;
    serde_json::from_str(&index_json).map_err(|e| e.to_string())
}

fn select_relevant_chunks(chunks: &[CodeChunk], query: &str, limit: usize) -> Vec<CodeChunk> {
    let query_lower = query.to_lowercase();
    let query_words: Vec<String> = query_lower
        .split(|c: char| !c.is_alphanumeric() && c != '_' && c != '.' && c != '-')
        .filter(|w| !w.is_empty())
        .map(String::from)
        .collect();
    let dep_keywords = [
        "depend", "package", "library", "version", "install", "module", "import",
        "npm", "pnpm", "yarn", "pip", "poetry", "cargo", "go.mod", "requirements",
        "pyproject", "lockfile", "venv", "virtualenv", "env",
    ];
    let dependency_query = dep_keywords.iter().any(|k| query_lower.contains(k));

    let mut scored: Vec<(f32, usize)> = chunks
        .iter()
        .enumerate()
        .map(|(idx, chunk)| {
            let content_lower = chunk.content.to_lowercase();
            let file_lower = chunk.file_path.to_lowercase();
            let file_name = chunk
                .file_path
                .rsplit(|c| c == '/' || c == '\\')
                .next()
                .unwrap_or_default()
                .to_lowercase();
            let manifest_file = matches!(
                file_name.as_str(),
                "package.json"
                    | "package-lock.json"
                    | "pnpm-lock.yaml"
                    | "yarn.lock"
                    | "requirements.txt"
                    | "pyproject.toml"
                    | "poetry.lock"
                    | "pipfile"
                    | "pipfile.lock"
                    | "cargo.toml"
                    | "cargo.lock"
                    | "go.mod"
                    | "go.sum"
                    | "pom.xml"
                    | "build.gradle"
                    | "build.gradle.kts"
                    | "composer.json"
                    | "gemfile"
                    | "readme.md"
            );

            let mut score: f32 = query_words
                .iter()
                .map(|word| {
                    let content_count = content_lower.matches(word.as_str()).count() as f32;
                    let file_bonus = if file_lower.contains(word.as_str()) { 3.0 } else { 0.0 };
                    content_count + file_bonus
                })
                .sum();

            if manifest_file {
                score += 1.5;
                if dependency_query {
                    score += 8.0;
                }
            }

            (score, idx)
        })
        .collect();

    scored.sort_by(|a, b| {
        b.0.partial_cmp(&a.0)
            .unwrap_or(std::cmp::Ordering::Equal)
    });

    scored
        .into_iter()
        .filter(|(score, _)| *score > 0.0)
        .take(limit)
        .map(|(_, idx)| chunks[idx].clone())
        .collect()
}

fn load_dependency_contexts(root_path: &str) -> Vec<String> {
    let dependency_files = [
        "package.json",
        "package-lock.json",
        "pnpm-lock.yaml",
        "yarn.lock",
        "requirements.txt",
        "pyproject.toml",
        "poetry.lock",
        "Pipfile",
        "Pipfile.lock",
        "Cargo.toml",
        "go.mod",
    ];
    let mut dependency_contexts: Vec<String> = Vec::new();
    for rel in dependency_files {
        let p = format!("{}/{}", root_path, rel);
        if let Ok(content) = std::fs::read_to_string(&p) {
            let preview = content.lines().take(120).collect::<Vec<_>>().join("\n");
            dependency_contexts.push(format!(
                "// Project dependency file: {}\n```text\n{}\n```",
                rel, preview
            ));
            if dependency_contexts.len() >= 3 {
                break;
            }
        }
    }
    dependency_contexts
}

fn build_rag_context(root_path: &str, sources: &[CodeChunk]) -> String {
    let dependency_contexts = load_dependency_contexts(root_path);
    let code_context = sources
        .iter()
        .map(|chunk| {
            format!(
                "// File: {} (lines {}-{})\n```{}\n{}\n```",
                chunk.file_path, chunk.start_line, chunk.end_line, chunk.language, chunk.content
            )
        })
        .collect::<Vec<_>>()
        .join("\n\n");

    if dependency_contexts.is_empty() {
        code_context
    } else {
        format!("{}\n\n{}", dependency_contexts.join("\n\n"), code_context)
    }
}

async fn ollama_chat_direct(
    model: &str,
    messages: Vec<OllamaChatMessage>,
) -> Result<String, String> {
    let client = reqwest::Client::new();
    let request = OllamaChatRequest {
        model: model.to_string(),
        messages,
        stream: false,
    };
    let resp = client
        .post(format!("{}/api/chat", OLLAMA_BASE))
        .json(&request)
        .send()
        .await
        .map_err(|e| e.to_string())?
        .error_for_status()
        .map_err(|e| e.to_string())?;
    let result: OllamaResponse = resp.json().await.map_err(|e| e.to_string())?;
    if let Some(msg) = result.message {
        Ok(msg.content)
    } else {
        Err("Planner model returned no content".to_string())
    }
}

fn truncate_text(input: String, max_len: usize) -> String {
    if input.chars().count() <= max_len {
        input
    } else {
        let truncated: String = input.chars().take(max_len).collect();
        format!("{}...[truncated]", truncated)
    }
}

fn extract_json_object(raw: &str) -> Option<String> {
    // First try fenced json blocks.
    if let Some(start) = raw.find("```json") {
        let rest = &raw[(start + "```json".len())..];
        if let Some(end) = rest.find("```") {
            let candidate = rest[..end].trim();
            if candidate.starts_with('{') && candidate.ends_with('}') {
                return Some(candidate.to_string());
            }
        }
    }
    if let Some(start) = raw.find("```") {
        let rest = &raw[(start + 3)..];
        if let Some(end) = rest.find("```") {
            let candidate = rest[..end].trim();
            if candidate.starts_with('{') && candidate.ends_with('}') {
                return Some(candidate.to_string());
            }
        }
    }
    let start = raw.find('{')?;
    let end = raw.rfind('}')?;
    if end < start {
        return None;
    }
    Some(raw[start..=end].to_string())
}

fn parse_agent_action(raw: &str) -> Option<AgentAction> {
    if let Ok(parsed) = serde_json::from_str::<AgentAction>(raw.trim()) {
        if !parsed.action.trim().is_empty() {
            return Some(parsed);
        }
    }
    let json = extract_json_object(raw)?;
    let v: serde_json::Value = serde_json::from_str(&json).ok()?;
    let action = v
        .get("action")
        .or_else(|| v.get("tool"))
        .and_then(|x| x.as_str())
        .unwrap_or("")
        .trim()
        .to_string();
    if action.is_empty() {
        return None;
    }
    Some(AgentAction {
        action,
        reason: v.get("reason").and_then(|x| x.as_str()).map(|s| s.to_string()),
        query: v.get("query").and_then(|x| x.as_str()).map(|s| s.to_string()),
        path: v.get("path").and_then(|x| x.as_str()).map(|s| s.to_string()),
    })
}

fn pick_fallback_action(
    step: usize,
    user_query: &str,
    collected_sources: &[CodeChunk],
    read_paths: &HashSet<String>,
) -> AgentAction {
    if step == 1 {
        return AgentAction {
            action: "search_code".to_string(),
            reason: Some("Using deterministic planner fallback.".to_string()),
            query: Some(user_query.to_string()),
            path: None,
        };
    }

    if let Some(source) = collected_sources
        .iter()
        .find(|s| !read_paths.contains(&s.file_path))
    {
        return AgentAction {
            action: "read_file".to_string(),
            reason: Some("Reading a top ranked file to gather concrete evidence.".to_string()),
            query: None,
            path: Some(source.file_path.clone()),
        };
    }

    if step == 2 {
        return AgentAction {
            action: "list_dir".to_string(),
            reason: Some("Listing project root to discover likely files.".to_string()),
            query: None,
            path: Some(".".to_string()),
        };
    }

    AgentAction {
        action: "finish".to_string(),
        reason: Some("Collected enough signals for a first actionable review.".to_string()),
        query: None,
        path: None,
    }
}

fn root_path_buf(root_path: &str) -> Result<PathBuf, String> {
    Path::new(root_path)
        .canonicalize()
        .map_err(|e| format!("invalid project root: {}", e))
}

fn resolve_path_in_root(root_path: &str, requested: &str) -> Result<PathBuf, String> {
    let root = root_path_buf(root_path)?;
    let candidate = if Path::new(requested).is_absolute() {
        PathBuf::from(requested)
    } else {
        root.join(requested)
    };
    if !candidate.exists() {
        return Err(format!("Path does not exist: {}", requested));
    }
    let resolved = candidate
        .canonicalize()
        .map_err(|e| format!("Failed to resolve path '{}': {}", requested, e))?;
    if !resolved.starts_with(&root) {
        return Err("Path is outside the open project".to_string());
    }
    Ok(resolved)
}

fn display_rel_path(root_path: Option<&str>, full_path: &str) -> String {
    if let Some(root) = root_path {
        if let Ok(root_buf) = root_path_buf(root) {
            let full = PathBuf::from(full_path);
            if let Ok(rel) = full.strip_prefix(root_buf) {
                return rel.to_string_lossy().to_string();
            }
        }
    }
    full_path.to_string()
}

fn guess_language(path: &Path) -> String {
    path.extension()
        .map(|e| e.to_string_lossy().to_lowercase())
        .unwrap_or_else(|| "text".to_string())
}

fn is_modify_request(query: &str) -> bool {
    let q = query.to_lowercase();
    [
        "modify", "change", "update", "edit", "refactor", "fix", "improve", "rewrite",
    ]
    .iter()
    .any(|k| q.contains(k))
}

fn is_review_request(query: &str) -> bool {
    let q = query.to_lowercase();
    [
        "review",
        "analyze",
        "analyse",
        "audit",
        "investigate",
        "check",
        "codebase",
        "project",
        "repository",
        "one by one",
        "each file",
        "all files",
    ]
    .iter()
    .any(|k| q.contains(k))
}

fn needs_project_recon(query: &str) -> bool {
    is_modify_request(query) || is_review_request(query)
}

fn extract_query_keywords(query: &str) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    let stop_words = [
        "project", "projects", "review", "analyze", "analyse", "audit", "mode", "user",
        "request", "code", "codes", "file", "files", "task", "please", "need", "with",
        "from", "that", "this", "there", "your", "our", "website", "entire", "all", "one",
        "each", "then",
    ];
    for token in query
        .split(|c: char| !c.is_alphanumeric() && c != '_' && c != '-')
        .map(|t| t.trim().to_lowercase())
        .filter(|t| t.len() >= 3)
    {
        if stop_words.contains(&token.as_str()) {
            continue;
        }
        if !out.contains(&token) {
            out.push(token);
        }
    }
    if out.iter().any(|k| k.contains("login") || k.contains("auth")) {
        for k in ["login", "auth", "signin", "signup", "session", "token"] {
            let k = k.to_string();
            if !out.contains(&k) {
                out.push(k);
            }
        }
    }
    if out.is_empty() {
        for token in query
            .split(|c: char| !c.is_alphanumeric() && c != '_' && c != '-')
            .map(|t| t.trim().to_lowercase())
            .filter(|t| t.len() >= 3)
        {
            if !out.contains(&token) {
                out.push(token);
                if out.len() >= 3 {
                    break;
                }
            }
        }
    }
    out.truncate(8);
    out
}

fn run_unix_command_in_root(root_path: &str, cmd: &str, args: &[&str]) -> Result<String, String> {
    let root = root_path_buf(root_path)?;
    let output = Command::new(cmd)
        .args(args)
        .current_dir(root)
        .output()
        .map_err(|e| format!("{} command failed to start: {}", cmd, e))?;
    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();

    // Some commands (like rg) return non-zero for "no matches"; keep stdout if present.
    if output.status.success() || !stdout.trim().is_empty() {
        Ok(stdout)
    } else if stderr.trim().is_empty() {
        Ok(String::new())
    } else {
        Err(stderr.trim().to_string())
    }
}

fn parse_search_hit(line: &str) -> Option<(String, usize)> {
    let mut parts = line.splitn(3, ':');
    let path = parts.next()?.trim();
    let line_no = parts.next()?.trim().parse::<usize>().ok()?;
    if path.is_empty() || line_no == 0 {
        return None;
    }
    Some((path.to_string(), line_no))
}

fn chunk_from_hit(root_path: &str, relative_path: &str, center_line: usize) -> Option<CodeChunk> {
    let resolved = resolve_path_in_root(root_path, relative_path).ok()?;
    if resolved.is_dir() {
        return None;
    }
    let content = std::fs::read_to_string(&resolved).ok()?;
    let lines: Vec<&str> = content.lines().collect();
    if lines.is_empty() {
        return None;
    }
    let start = center_line.saturating_sub(12).max(1);
    let end = std::cmp::min(lines.len(), center_line + 12);
    let snippet = lines[(start - 1)..end].join("\n");
    Some(CodeChunk {
        file_path: resolved.to_string_lossy().to_string(),
        content: snippet,
        start_line: start,
        end_line: end,
        language: guess_language(&resolved),
    })
}

fn search_with_unix_tools(root_path: &str, keyword: &str) -> Result<Vec<String>, String> {
    let rg_out = run_unix_command_in_root(
        root_path,
        "rg",
        &[
            "-n",
            "--no-heading",
            "-S",
            "--max-count",
            "200",
            "--glob",
            "!node_modules/**",
            "--glob",
            "!dist/**",
            "--glob",
            "!build/**",
            "--glob",
            "!target/**",
            keyword,
            ".",
        ],
    );

    match rg_out {
        Ok(s) => Ok(s.lines().map(|l| l.to_string()).collect()),
        Err(_) => {
            let grep_out = run_unix_command_in_root(
                root_path,
                "grep",
                &[
                    "-RIn",
                    "--exclude-dir=node_modules",
                    "--exclude-dir=dist",
                    "--exclude-dir=build",
                    "--exclude-dir=target",
                    keyword,
                    ".",
                ],
            )?;
            Ok(grep_out.lines().map(|l| l.to_string()).collect())
        }
    }
}

fn run_recon_with_unix_commands(
    app: &AppHandle,
    run_id: &str,
    root_path: &str,
    query: &str,
) -> (Vec<CodeChunk>, Vec<String>) {
    let mut notes: Vec<String> = Vec::new();
    let mut sources: Vec<CodeChunk> = Vec::new();

    let _ = emit_agent_event(
        app,
        run_id,
        "stage",
        "Recon: scanning entire project structure (command: find . -maxdepth 2 -type d)",
    );
    if let Ok(dir_scan) =
        run_unix_command_in_root(root_path, "find", &[".", "-maxdepth", "2", "-type", "d"])
    {
        let preview = dir_scan
            .lines()
            .filter(|l| !l.contains("node_modules") && !l.contains(".git"))
            .take(80)
            .collect::<Vec<_>>()
            .join("\n");
        notes.push(truncate_text(
            format!("Directory structure scan (find):\n{}", preview),
            5000,
        ));
    }

    for keyword in extract_query_keywords(query).into_iter().take(5) {
        let _ = emit_agent_event(
            app,
            run_id,
            "stage",
            format!(
                "Recon: searching related code for '{}' (command: rg -n -S \"{}\" .)",
                keyword, keyword
            ),
        );
        match search_with_unix_tools(root_path, &keyword) {
            Ok(lines) => {
                if lines.is_empty() {
                    continue;
                }
                notes.push(truncate_text(
                    format!(
                        "Search hits for '{}':\n{}",
                        keyword,
                        lines.iter().take(20).cloned().collect::<Vec<_>>().join("\n")
                    ),
                    6000,
                ));
                for hit in lines.iter().take(12) {
                    if let Some((rel, line_no)) = parse_search_hit(hit) {
                        if let Some(chunk) = chunk_from_hit(root_path, &rel, line_no) {
                            merge_sources(&mut sources, vec![chunk], 14);
                        }
                    }
                }
            }
            Err(e) => {
                notes.push(format!("Search failed for '{}': {}", keyword, e));
            }
        }
    }

    (sources, notes)
}

fn list_dir_preview(root_path: &str, requested: Option<&str>) -> Result<String, String> {
    let requested = requested.unwrap_or(".");
    let resolved = resolve_path_in_root(root_path, requested)?;
    if !resolved.is_dir() {
        return Err(format!("Not a directory: {}", requested));
    }
    let mut entries: Vec<(bool, String)> = std::fs::read_dir(&resolved)
        .map_err(|e| e.to_string())?
        .flatten()
        .map(|e| {
            let name = e.file_name().to_string_lossy().to_string();
            let is_dir = e.metadata().map(|m| m.is_dir()).unwrap_or(false);
            (is_dir, name)
        })
        .filter(|(_, name)| {
            !name.starts_with('.')
                && name != "node_modules"
                && name != "target"
                && name != "__pycache__"
                && name != "venv"
                && name != "env"
                && name != "dist"
                && name != "build"
        })
        .collect();

    entries.sort_by(|a, b| match (a.0, b.0) {
        (true, false) => std::cmp::Ordering::Less,
        (false, true) => std::cmp::Ordering::Greater,
        _ => a.1.to_lowercase().cmp(&b.1.to_lowercase()),
    });

    let max_entries = 80usize;
    let mut lines: Vec<String> = entries
        .iter()
        .take(max_entries)
        .map(|(is_dir, name)| format!("{} {}", if *is_dir { "[D]" } else { "[F]" }, name))
        .collect();
    if entries.len() > max_entries {
        lines.push(format!("... {} more entries", entries.len() - max_entries));
    }

    Ok(format!(
        "Directory listing for {}:\n{}",
        display_rel_path(Some(root_path), &resolved.to_string_lossy()),
        lines.join("\n")
    ))
}

fn read_file_preview(
    root_path: &str,
    requested: &str,
) -> Result<(String, CodeChunk), String> {
    let resolved = resolve_path_in_root(root_path, requested)?;
    if resolved.is_dir() {
        return Err(format!("Path is a directory, not a file: {}", requested));
    }
    let content = std::fs::read_to_string(&resolved)
        .map_err(|e| format!("Failed reading file '{}': {}", requested, e))?;
    let lines: Vec<&str> = content.lines().collect();
    let max_lines = 220usize;
    let shown = lines.iter().take(max_lines).copied().collect::<Vec<_>>();
    let numbered = shown
        .iter()
        .enumerate()
        .map(|(i, line)| format!("{:4} {}", i + 1, line))
        .collect::<Vec<_>>()
        .join("\n");
    let mut preview = format!(
        "Read file {} (showing {} of {} lines):\n{}",
        display_rel_path(Some(root_path), &resolved.to_string_lossy()),
        shown.len(),
        lines.len(),
        numbered
    );
    if lines.len() > shown.len() {
        preview.push_str("\n... [truncated]");
    }

    let chunk = CodeChunk {
        file_path: resolved.to_string_lossy().to_string(),
        content: shown.join("\n"),
        start_line: 1,
        end_line: shown.len(),
        language: guess_language(&resolved),
    };
    Ok((preview, chunk))
}

fn summarize_hits_for_observation(
    root_path: Option<&str>,
    query: &str,
    hits: &[CodeChunk],
) -> String {
    if hits.is_empty() {
        return format!("search_code('{}') returned no direct matches", query);
    }
    let mut out = Vec::new();
    out.push(format!(
        "search_code('{}') returned {} hit(s):",
        query,
        hits.len()
    ));
    for hit in hits.iter().take(3) {
        let rel = display_rel_path(root_path, &hit.file_path);
        let snippet = hit
            .content
            .lines()
            .take(20)
            .collect::<Vec<_>>()
            .join("\n");
        out.push(format!(
            "- {}:{}-{}\n{}",
            rel, hit.start_line, hit.end_line, snippet
        ));
    }
    truncate_text(out.join("\n\n"), 6500)
}

fn merge_sources(dest: &mut Vec<CodeChunk>, add: Vec<CodeChunk>, max_total: usize) {
    let mut seen: HashSet<String> = dest
        .iter()
        .map(|c| format!("{}:{}:{}", c.file_path, c.start_line, c.end_line))
        .collect();
    for chunk in add {
        if dest.len() >= max_total {
            break;
        }
        let key = format!("{}:{}:{}", chunk.file_path, chunk.start_line, chunk.end_line);
        if seen.insert(key) {
            dest.push(chunk);
        }
    }
}

fn merge_notes(dest: &mut Vec<String>, add: Vec<String>, max_total: usize) {
    let mut seen: HashSet<String> = dest.iter().cloned().collect();
    for note in add {
        if dest.len() >= max_total {
            break;
        }
        let normalized = truncate_text(note.trim().to_string(), 6000);
        if normalized.is_empty() {
            continue;
        }
        if seen.insert(normalized.clone()) {
            dest.push(normalized);
        }
    }
}

fn planner_prompt(
    user_query: &str,
    root_path: Option<&str>,
    observations: &[String],
    step: usize,
    max_steps: usize,
) -> String {
    let recent_obs = if observations.is_empty() {
        "(none yet)".to_string()
    } else {
        observations
            .iter()
            .rev()
            .take(6)
            .cloned()
            .collect::<Vec<_>>()
            .into_iter()
            .rev()
            .collect::<Vec<_>>()
            .join("\n\n")
    };
    format!(
        "User task:\n{}\n\nProject root: {}\nStep {}/{}\n\nRecent tool observations:\n{}\n\n\
         Return ONLY one JSON object with this schema:\n\
         {{\"action\":\"search_code|list_dir|read_file|finish\",\"reason\":\"short\",\"query\":\"...optional...\",\"path\":\"...optional...\"}}\n\n\
         Rules:\n\
         - Use one action only.\n\
         - For list_dir/read_file, use path relative to project root.\n\
         - Use search_code before read_file if unsure.\n\
         - Choose finish only when you have enough evidence.",
        user_query,
        root_path.unwrap_or("(not set)"),
        step,
        max_steps,
        recent_obs
    )
}

async fn run_agent_planner_loop(
    app: &AppHandle,
    run_id: &str,
    model: &str,
    user_query: &str,
    root_path: Option<&str>,
    chunks: &[CodeChunk],
) -> Result<(Vec<CodeChunk>, Vec<String>), String> {
    let max_steps = 6usize;
    let mut observations: Vec<String> = Vec::new();
    let mut collected_sources: Vec<CodeChunk> = Vec::new();
    let mut read_paths: HashSet<String> = HashSet::new();

    for step in 1..=max_steps {
        let _ = emit_agent_event(
            app,
            run_id,
            "stage",
            format!("Planner step {}/{}: deciding next action", step, max_steps),
        );

        let planner_system = "You are a coding agent planner. Decide the next best tool action and output only valid JSON.";
        let planner_input = planner_prompt(user_query, root_path, &observations, step, max_steps);
        let raw = ollama_chat_direct(
            model,
            vec![
                OllamaChatMessage {
                    role: "system".to_string(),
                    content: planner_system.to_string(),
                },
                OllamaChatMessage {
                    role: "user".to_string(),
                    content: planner_input,
                },
            ],
        )
        .await
        .unwrap_or_else(|_| "{\"action\":\"search_code\"}".to_string());

        let mut used_fallback = false;
        let action = if let Some(parsed) = parse_agent_action(&raw) {
            parsed
        } else {
            used_fallback = true;
            pick_fallback_action(step, user_query, &collected_sources, &read_paths)
        };
        if used_fallback {
            let _ = emit_agent_event(
                app,
                run_id,
                "stage",
                format!("Planner step {}: using deterministic fallback action", step),
            );
        }

        let action_name = action.action.to_lowercase();
        let reason_suffix = action
            .reason
            .as_ref()
            .map(|r| format!(" ({})", r))
            .unwrap_or_default();
        match action_name.as_str() {
            "search_code" | "search" => {
                let search_query = action.query.unwrap_or_else(|| user_query.to_string());
                let _ = emit_agent_event(
                    app,
                    run_id,
                    "stage",
                    format!(
                        "Planner step {}: search_code('{}'){}",
                        step, search_query, reason_suffix
                    ),
                );
                let hits = select_relevant_chunks(chunks, &search_query, 5);
                let obs = summarize_hits_for_observation(root_path, &search_query, &hits);
                observations.push(obs);
                merge_sources(&mut collected_sources, hits, 12);
            }
            "list_dir" => {
                let req = action.path.as_deref().unwrap_or(".");
                let _ = emit_agent_event(
                    app,
                    run_id,
                    "stage",
                    format!("Planner step {}: list_dir('{}'){}", step, req, reason_suffix),
                );
                let obs = if let Some(root) = root_path {
                    list_dir_preview(root, Some(req))
                } else {
                    Err("No open project root for list_dir.".to_string())
                }
                .unwrap_or_else(|e| format!("list_dir('{}') failed: {}", req, e));
                observations.push(truncate_text(obs, 5000));
            }
            "read_file" => {
                let req = action.path.as_deref().unwrap_or("");
                let _ = emit_agent_event(
                    app,
                    run_id,
                    "stage",
                    format!("Planner step {}: read_file('{}'){}", step, req, reason_suffix),
                );
                let obs = if let Some(root) = root_path {
                    read_file_preview(root, req)
                        .map(|(preview, chunk)| {
                            read_paths.insert(chunk.file_path.clone());
                            merge_sources(&mut collected_sources, vec![chunk], 12);
                            preview
                        })
                } else {
                    Err("No open project root for read_file.".to_string())
                }
                .unwrap_or_else(|e| format!("read_file('{}') failed: {}", req, e));
                observations.push(truncate_text(obs, 7000));
            }
            "finish" => {
                let reason = action.reason.unwrap_or_else(|| "Enough evidence collected.".to_string());
                let _ = emit_agent_event(
                    app,
                    run_id,
                    "stage",
                    format!("Planner step {}: finish ({})", step, reason),
                );
                observations.push(format!("Planner finished investigation: {}", reason));
                break;
            }
            other => {
                let obs = format!(
                    "Planner returned unknown action '{}'. Fallback observation added and continuing.",
                    other
                );
                observations.push(obs);
            }
        }

        if observations.len() > 10 {
            let drain_count = observations.len() - 10;
            observations.drain(0..drain_count);
        }
    }

    Ok((collected_sources, observations))
}

fn looks_like_generic_agent_answer(answer: &str, sources: &[CodeChunk]) -> bool {
    let lower = answer.to_lowercase();
    let generic_markers = [
        "i'm an ai",
        "i am an ai",
        "text model trained",
        "general approach",
        "i can provide",
        "i cannot access",
        "i can't access",
        "without seeing your code",
        "in general",
    ];
    if generic_markers.iter().any(|m| lower.contains(m)) {
        return true;
    }

    if sources.is_empty() {
        return false;
    }

    let mut has_file_ref = false;
    for src in sources.iter().take(10) {
        if let Some(name) = Path::new(&src.file_path)
            .file_name()
            .map(|n| n.to_string_lossy().to_lowercase())
        {
            if !name.is_empty() && lower.contains(&name) {
                has_file_ref = true;
                break;
            }
        }
    }
    !has_file_ref
}

fn build_grounded_fallback_answer(
    query: &str,
    root_path: Option<&str>,
    sources: &[CodeChunk],
) -> String {
    let escape_pattern_token = |token: &str| {
        token
            .replace('\\', "\\\\")
            .replace('|', "\\|")
            .replace('"', "\\\"")
    };

    if sources.is_empty() {
        return format!(
            "## Thinking\n\
             - The request could not be grounded because no relevant project files were found.\n\n\
             ## Plan\n\
             1. Open the correct project folder.\n\
             2. Re-run with a concrete target (for example: `modify login page`).\n\
             3. Ensure RAG indexing completes.\n\n\
             ## File Changes\n\
             - No file candidates available yet.\n\n\
             ## Validation\n\
             - Run `rg -n \"login|auth|signin|signup\" .` from the project root to locate auth-related files.\n\n\
             ## Final Answer\n\
             I need concrete project files to produce a reliable line-by-line plan for: {}",
            query
        );
    }

    let mut seen_paths: HashSet<String> = HashSet::new();
    let mut file_lines: Vec<String> = Vec::new();
    for src in sources.iter() {
        if file_lines.len() >= 6 {
            break;
        }
        if seen_paths.insert(src.file_path.clone()) {
            let rel = display_rel_path(root_path, &src.file_path);
            file_lines.push(format!(
                "- `{}` (lines {}-{})",
                rel, src.start_line, src.end_line
            ));
        }
    }

    let keywords = extract_query_keywords(query);
    let rg_pattern = if keywords.is_empty() {
        "login|auth|signin|signup".to_string()
    } else {
        keywords
            .iter()
            .take(5)
            .map(|k| escape_pattern_token(k))
            .collect::<Vec<_>>()
            .join("|")
    };

    format!(
        "## Thinking\n\
         - I inspected project files related to: `{}`.\n\
         - I selected concrete source locations to avoid generic guidance.\n\n\
         ## Plan\n\
         1. Review the listed files and confirm the login/auth flow.\n\
         2. Apply focused changes to components, handlers, and validation paths.\n\
         3. Run validation commands and fix any regressions.\n\n\
         ## File Changes\n\
         {}\n\n\
         ## Validation\n\
         - `rg -n \"{}\" .`\n\
         - `npm run build`\n\
         - Run your project test command for the changed area.\n\n\
         ## Final Answer\n\
         I completed a grounded project scan and identified the primary files above. If you want, I can now produce exact patch-level edits for those files.",
        query,
        file_lines.join("\n"),
        rg_pattern
    )
}

fn stream_chunks(text: &str, chunk_chars: usize) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    let mut buf = String::new();
    let mut count = 0usize;
    for ch in text.chars() {
        buf.push(ch);
        count += 1;
        if ch == '\n' || count >= chunk_chars {
            out.push(buf.clone());
            buf.clear();
            count = 0;
        }
    }
    if !buf.is_empty() {
        out.push(buf);
    }
    out
}

async fn stream_ollama_agent_response(
    app: &AppHandle,
    run_id: &str,
    model: &str,
    query: &str,
    root_path: Option<&str>,
    rag_context: Option<String>,
    sources: &[CodeChunk],
) -> Result<String, String> {
    let mut system_prompt = format!(
        "{}\n\
         You are NCode Agent, an execution-focused coding assistant.\n\
         Think step-by-step and be explicit.\n\
         Always prefer existing project dependencies and patterns.\n\
         Respond in markdown with exactly these sections:\n\
         ## Thinking\n\
         ## Plan\n\
         ## File Changes\n\
         ## Validation\n\
         ## Final Answer\n\
         In File Changes, list concrete paths and what to modify.\n\
         Never output generic boilerplate. Always anchor findings to real project files.",
        LOCAL_OLLAMA_SYSTEM_PROMPT
    );
    if let Some(ctx) = rag_context {
        system_prompt.push_str("\n\nProject context:\n");
        system_prompt.push_str(&ctx);
    }

    let mut user_prompt = format!("User request:\n{}", query);
    if let Some(root) = root_path {
        user_prompt.push_str(&format!("\n\nProject root: {}", root));
    }

    let base_messages = vec![
        OllamaChatMessage {
            role: "system".to_string(),
            content: system_prompt,
        },
        OllamaChatMessage {
            role: "user".to_string(),
            content: user_prompt,
        },
    ];
    let mut full = ollama_chat_direct(model, base_messages.clone()).await?;
    if looks_like_nonlocal_identity_refusal(&full) {
        if let Ok(rewritten) = rewrite_nonlocal_identity_response(model, &base_messages, &full).await {
            full = rewritten;
        } else {
            full = sanitize_nonlocal_identity_terms(&full);
        }
    }

    if looks_like_generic_agent_answer(&full, sources) {
        let file_list = sources
            .iter()
            .take(8)
            .map(|s| {
                if let Some(root) = root_path {
                    display_rel_path(Some(root), &s.file_path)
                } else {
                    s.file_path.clone()
                }
            })
            .collect::<Vec<_>>()
            .join(", ");
        let mut retry_messages = base_messages.clone();
        retry_messages.push(OllamaChatMessage {
            role: "assistant".to_string(),
            content: full.clone(),
        });
        retry_messages.push(OllamaChatMessage {
            role: "user".to_string(),
            content: format!(
                "Your previous answer was too generic. Rewrite it as a concrete code review.\n\
                 Requirements:\n\
                 - Mention at least 3 exact files from this set when relevant: {}\n\
                 - Include line-level or snippet-level rationale when possible\n\
                 - Include actionable fixes and validation commands\n\
                 - Do not include any generic AI disclaimers.",
                if file_list.is_empty() { "(no indexed sources)" } else { &file_list }
            ),
        });
        if let Ok(retry) = ollama_chat_direct(model, retry_messages).await {
            full = retry;
            if looks_like_nonlocal_identity_refusal(&full) {
                full = sanitize_nonlocal_identity_terms(&full);
            }
        }
    }

    if looks_like_generic_agent_answer(&full, sources) {
        full = build_grounded_fallback_answer(query, root_path, sources);
    }

    if full.trim().is_empty() {
        return Err("Agent produced an empty response".to_string());
    }

    for chunk in stream_chunks(&full, 72) {
        let _ = emit_agent_event(app, run_id, "token", chunk);
    }
    Ok(full)
}

/// RAG query: find relevant code + generate answer
#[command]
pub async fn rag_query(
    root_path: String,
    query: String,
    model: String,
) -> Result<RAGResult, String> {
    let chunks = match load_indexed_chunks(&root_path) {
        Ok(chunks) => chunks,
        Err(_) => {
            let _ = index_codebase(root_path.clone(), None).await?;
            load_indexed_chunks(&root_path)?
        }
    };

    let sources = select_relevant_chunks(&chunks, &query, 8);
    if sources.is_empty() {
        return Ok(RAGResult {
            answer: "No relevant code found for this query.".to_string(),
            sources: vec![],
        });
    }

    let context = build_rag_context(&root_path, &sources);
    let answer = ollama_chat(
        default_model(model),
        vec![OllamaChatMessage {
            role: "user".to_string(),
            content: format!(
                "{}\n\nProject root: {}. Prefer existing dependencies and project conventions.",
                query, root_path
            ),
        }],
        Some(context),
    )
    .await?;

    Ok(RAGResult { answer, sources })
}

/// Agentic RAG query: grounded answer with plan/actions/validation sections.
#[command]
pub async fn rag_agent_query(
    root_path: String,
    query: String,
    model: String,
) -> Result<RAGResult, String> {
    let agent_query = format!(
        "AGENT MODE.\n\
         Produce a structured response with these sections:\n\
         1) Understanding\n\
         2) Plan\n\
         3) File-level changes\n\
         4) Validation steps/commands\n\
         5) Risks/Open questions\n\
         Use only project context and dependencies when possible.\n\n\
         User task:\n{}",
        query
    );
    rag_query(root_path, agent_query, model).await
}

/// Streaming agent mode with realtime progress and token events.
#[command]
pub async fn agentic_rag_chat(
    app: AppHandle,
    run_id: String,
    root_path: Option<String>,
    query: String,
    model: String,
) -> Result<RAGResult, String> {
    let selected_model = default_model(model);
    let normalized_root = root_path
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());
    let mut indexed_chunks: Vec<CodeChunk> = Vec::new();
    let mut sources: Vec<CodeChunk> = Vec::new();
    let mut investigation_notes: Vec<String> = Vec::new();

    let _ = emit_agent_event(&app, &run_id, "stage", "Starting agent run");

    if let Some(root) = normalized_root.as_deref() {
        let index_path = format!("{}/.NCode/index.json", root);
        if !std::path::Path::new(&index_path).exists() {
            let _ = emit_agent_event(&app, &run_id, "stage", "Indexing project for RAG context");
            let count = index_codebase(root.to_string(), None).await?;
            let _ = emit_agent_event(
                &app,
                &run_id,
                "stage",
                format!("Indexed {} chunks", count),
            );
        }

        indexed_chunks = load_indexed_chunks(root)?;

        if needs_project_recon(&query) {
            let _ = emit_agent_event(
                &app,
                &run_id,
                "stage",
                "Recon mode enabled: scanning project and searching related files with Linux commands",
            );
            let (recon_sources, recon_notes) =
                run_recon_with_unix_commands(&app, &run_id, root, &query);
            merge_sources(&mut sources, recon_sources, 14);
            merge_notes(&mut investigation_notes, recon_notes, 20);
            let _ = emit_agent_event(
                &app,
                &run_id,
                "stage",
                format!(
                    "Recon finished: {} source chunk(s), {} note(s)",
                    sources.len(),
                    investigation_notes.len()
                ),
            );
        }
    } else {
        let _ = emit_agent_event(
            &app,
            &run_id,
            "stage",
            "No open folder selected, running without RAG context",
        );
    }

    match run_agent_planner_loop(
        &app,
        &run_id,
        &selected_model,
        &query,
        normalized_root.as_deref(),
        &indexed_chunks,
    )
    .await
    {
        Ok((planner_sources, notes)) => {
            merge_sources(&mut sources, planner_sources, 18);
            merge_notes(&mut investigation_notes, notes, 24);
            let _ = emit_agent_event(
                &app,
                &run_id,
                "stage",
                format!(
                    "Planner completed with {} source chunk(s) and {} observation(s)",
                    sources.len(),
                    investigation_notes.len()
                ),
            );
        }
        Err(err) => {
            let _ = emit_agent_event(
                &app,
                &run_id,
                "stage",
                format!("Planner loop failed, continuing with direct generation: {}", err),
            );
        }
    }

    let mut context_parts: Vec<String> = Vec::new();
    if let Some(root) = normalized_root.as_deref() {
        if !sources.is_empty() {
            context_parts.push(build_rag_context(root, &sources));
        }
    }
    if !investigation_notes.is_empty() {
        context_parts.push(format!(
            "Agent investigation log:\n{}",
            investigation_notes.join("\n\n")
        ));
    }
    let rag_context = if context_parts.is_empty() {
        None
    } else {
        Some(context_parts.join("\n\n"))
    };

    let _ = emit_agent_event(&app, &run_id, "stage", "Generating agent response");
    match stream_ollama_agent_response(
        &app,
        &run_id,
        &selected_model,
        &query,
        normalized_root.as_deref(),
        rag_context,
        &sources,
    )
    .await
    {
        Ok(answer) => {
            let _ = emit_agent_event(&app, &run_id, "done", "Agent run completed");
            Ok(RAGResult { answer, sources })
        }
        Err(err) => {
            let _ = emit_agent_event(&app, &run_id, "error", format!("Agent failed: {}", err));
            Err(err)
        }
    }
}
