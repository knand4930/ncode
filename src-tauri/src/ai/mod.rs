// src-tauri/src/ai/mod.rs
use futures::StreamExt;
use std::collections::HashSet;
use std::fs::OpenOptions;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::Duration;
use std::time::{SystemTime, UNIX_EPOCH};
use serde::{Deserialize, Serialize};
use tauri::{command, AppHandle, Emitter};

const OLLAMA_BASE_LOCALHOST: &str = "http://localhost:11434";
const OLLAMA_BASE_LOOPBACK: &str = "http://127.0.0.1:11434";
const OLLAMA_BASE: &str = OLLAMA_BASE_LOCALHOST;
const AGENT_MAX_PLANNER_STEPS: usize = 4;
const AGENT_EARLY_SOURCE_TARGET: usize = 4; // Reduced to prevent local context saturation
const AGENT_RECON_KEYWORD_LIMIT: usize = 3;
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
    #[serde(default)]
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

/// A single tool call emitted by the agent model
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct ToolCall {
    pub tool: String,
    pub args: serde_json::Value,
}

/// The agent's response containing one or more tool calls
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct ToolCallResponse {
    pub tool_calls: Vec<ToolCall>,
}

/// Payload for ai-agent-event Tauri event
#[derive(Serialize, Clone)]
pub struct AgentStepEvent {
    pub step: usize,
    pub tool: String,
    pub args: serde_json::Value,
    pub result: String,
    pub ts: u64,
}

/// Payload for ai-agent-file-change Tauri event
#[derive(Serialize, Clone)]
pub struct AgentFileChangeEvent {
    pub path: String,
    pub content: String,
    pub action: String, // "write" | "create" | "delete"
}

/// Payload for ai-agent-confirm-required Tauri event
#[derive(Serialize, Clone)]
pub struct AgentConfirmEvent {
    pub confirm_id: String,
    pub path: String,
    pub diff: String,
    pub tool: String, // "write_file" | "delete_file"
}

/// A recorded file change for rollback
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct AgentFileChange {
    pub path: String,
    pub original_content: Option<String>, // None if file was created (didn't exist)
    pub action: String,
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

fn normalize_ollama_base(base_url: Option<&str>) -> String {
    base_url
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .unwrap_or(OLLAMA_BASE)
        .trim_end_matches('/')
        .to_string()
}

fn body_preview(body: String, max_len: usize) -> String {
    let trimmed = body.trim().to_string();
    if trimmed.is_empty() {
        return "(empty response body)".to_string();
    }
    truncate_text(trimmed, max_len)
}

fn messages_to_generate_prompt(messages: &[OllamaChatMessage]) -> String {
    let mut parts: Vec<String> = Vec::new();
    for msg in messages {
        let role = msg.role.to_lowercase();
        let content = msg.content.trim();
        if content.is_empty() {
            continue;
        }
        let label = match role.as_str() {
            "system" => "System",
            "assistant" => "Assistant",
            _ => "User",
        };
        parts.push(format!("{}:\n{}", label, content));
    }
    parts.push("Assistant:".to_string());
    parts.join("\n\n")
}

async fn ollama_chat_with_fallback(
    client: &reqwest::Client,
    base_url: &str,
    request: &OllamaChatRequest,
) -> Result<OllamaResponse, String> {
    let chat_url = format!("{}/api/chat", base_url);
    let resp = client
        .post(&chat_url)
        .json(request)
        .send()
        .await
        .map_err(|e| format!("Local LLM request failed at {}: {}", chat_url, e))?;

    if resp.status().is_success() {
        let mut parsed: OllamaResponse = resp.json().await.map_err(|e| e.to_string())?;
        if parsed.message.is_none() {
            if let Some(text) = parsed.response.clone() {
                parsed.message = Some(OllamaChatMessage {
                    role: "assistant".to_string(),
                    content: text,
                });
            }
        }
        return Ok(parsed);
    }

    if resp.status() != reqwest::StatusCode::NOT_FOUND {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        return Err(format!(
            "Local LLM chat error at {} (status {}): {}",
            chat_url,
            status,
            body_preview(body, 220)
        ));
    }

    let generate_url = format!("{}/api/generate", base_url);
    let generate_req = OllamaRequest {
        model: request.model.clone(),
        prompt: messages_to_generate_prompt(&request.messages),
        stream: false,
        options: Some(OllamaOptions {
            temperature: 0.7,
            num_predict: 4000,
            stop: None,
        }),
    };
    let gen_resp = client
        .post(&generate_url)
        .json(&generate_req)
        .send()
        .await
        .map_err(|e| format!("Local fallback request failed at {}: {}", generate_url, e))?;

    if gen_resp.status().is_success() {
        let mut parsed: OllamaResponse = gen_resp.json().await.map_err(|e| e.to_string())?;
        if parsed.message.is_none() {
            if let Some(text) = parsed.response.clone() {
                parsed.message = Some(OllamaChatMessage {
                    role: "assistant".to_string(),
                    content: text,
                });
            }
        }
        return Ok(parsed);
    }

    let generate_status = gen_resp.status();
    let generate_body = gen_resp.text().await.unwrap_or_default();
    if generate_status != reqwest::StatusCode::NOT_FOUND {
        return Err(format!(
            "Local LLM fallback error at {} (status {}): {}",
            generate_url,
            generate_status,
            body_preview(generate_body, 220)
        ));
    }

    let openai_url = format!("{}/v1/chat/completions", base_url);
    let openai_model = request.model.clone();
    let openai_model_alt = openai_model.replace(':', "-");

    let openai_payload = serde_json::json!({
        "model": openai_model,
        "messages": request.messages,
        "stream": false,
        "temperature": 0.7,
        "max_tokens": 4000
    });
    let mut openai_resp = client
        .post(&openai_url)
        .json(&openai_payload)
        .send()
        .await
        .map_err(|e| format!("Local OpenAI-compat fallback failed at {}: {}", openai_url, e))?;

    // Some servers (OpenAI-compatible or otherwise) may use a slightly different model naming scheme
    // (e.g. `deepseek-coder:1.3b` -> `deepseek-coder-1.3b`). Try that if the first call fails.
    if !openai_resp.status().is_success() && openai_model != openai_model_alt {
        let openai_payload_alt = serde_json::json!({
            "model": openai_model_alt,
            "messages": request.messages,
            "stream": false,
            "temperature": 0.7,
            "max_tokens": 4000
        });
        openai_resp = client
            .post(&openai_url)
            .json(&openai_payload_alt)
            .send()
            .await
            .map_err(|e| format!("Local OpenAI-compat fallback failed at {}: {}", openai_url, e))?;
    }

    if openai_resp.status().is_success() {
        let parsed: serde_json::Value = openai_resp.json().await.map_err(|e| e.to_string())?;
        let content = parsed
            .get("choices")
            .and_then(|v| v.as_array())
            .and_then(|arr| arr.first())
            .and_then(|choice| choice.get("message"))
            .and_then(|msg| msg.get("content"))
            .and_then(|c| c.as_str())
            .unwrap_or("")
            .to_string();
        return Ok(OllamaResponse {
            response: Some(content.clone()),
            message: Some(OllamaChatMessage {
                role: "assistant".to_string(),
                content,
            }),
            done: true,
        });
    }

    // Some local LLM servers expose the OpenAI-compatible `/v1/completions` endpoint instead of `/v1/chat/completions`.
    // Try that as a fallback before failing hard.
    let openai_status = openai_resp.status();
    let openai_body = openai_resp.text().await.unwrap_or_default();

    let completions_url = format!("{}/v1/completions", base_url);
    let completions_payload = serde_json::json!({
        "model": openai_model,
        "prompt": messages_to_generate_prompt(&request.messages),
        "stream": false,
        "temperature": 0.7,
        "max_tokens": 4000
    });
    let mut comp_resp = client
        .post(&completions_url)
        .json(&completions_payload)
        .send()
        .await
        .map_err(|e| format!("Local OpenAI-compat fallback failed at {}: {}", completions_url, e))?;

    if !comp_resp.status().is_success() && openai_model != openai_model_alt {
        let completions_payload_alt = serde_json::json!({
            "model": openai_model_alt,
            "prompt": messages_to_generate_prompt(&request.messages),
            "stream": false,
            "temperature": 0.7,
            "max_tokens": 4000
        });
        comp_resp = client
            .post(&completions_url)
            .json(&completions_payload_alt)
            .send()
            .await
            .map_err(|e| format!("Local OpenAI-compat fallback failed at {}: {}", completions_url, e))?;
    }

    if comp_resp.status().is_success() {
        let parsed: serde_json::Value = comp_resp.json().await.map_err(|e| e.to_string())?;
        let content = parsed
            .get("choices")
            .and_then(|v| v.as_array())
            .and_then(|arr| arr.first())
            .and_then(|choice| choice.get("text"))
            .and_then(|c| c.as_str())
            .unwrap_or("")
            .to_string();
        return Ok(OllamaResponse {
            response: Some(content.clone()),
            message: Some(OllamaChatMessage {
                role: "assistant".to_string(),
                content,
            }),
            done: true,
        });
    }

    let comp_status = comp_resp.status();
    let comp_body = comp_resp.text().await.unwrap_or_default();

    Err(format!(
        "Local LLM endpoint {} is incompatible with Ollama-style chat. Tried /api/chat (404), /api/generate (404), /v1/chat/completions (status {}), and /v1/completions (status {}). Last response(s): chat: {} | completions: {}",
        base_url,
        openai_status,
        comp_status,
        body_preview(openai_body, 220),
        body_preview(comp_body, 220)
    ))
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

/// Fetch available models from Ollama with custom base URL
#[command]
pub async fn fetch_ollama_models(base_url: String) -> Result<Vec<String>, String> {
    fetch_ollama_tags(&base_url).await
}

/// Fetch available models from OpenAI API
#[command]
pub async fn fetch_openai_models(api_key: String) -> Result<Vec<String>, String> {
    #[derive(Deserialize)]
    struct OpenAIModel {
        id: String,
    }
    #[derive(Deserialize)]
    struct OpenAIModelsResponse {
        data: Vec<OpenAIModel>,
    }

    let client = reqwest::Client::new();
    let resp = client
        .get("https://api.openai.com/v1/models")
        .header("Authorization", format!("Bearer {}", api_key))
        .send()
        .await
        .map_err(|e| format!("OpenAI request failed: {}", e))?
        .error_for_status()
        .map_err(|e| format!("OpenAI error: {}", e))?;
    let data: OpenAIModelsResponse = resp.json().await.map_err(|e| e.to_string())?;
    Ok(data.data.into_iter().map(|m| m.id).collect())
}

/// Fetch available models from Anthropic API
#[command]
pub async fn fetch_anthropic_models(api_key: String) -> Result<Vec<String>, String> {
    #[derive(Deserialize)]
    struct AnthropicModel {
        id: String,
    }
    #[derive(Deserialize)]
    struct AnthropicModelsResponse {
        data: Vec<AnthropicModel>,
    }

    let client = reqwest::Client::new();
    let resp = client
        .get("https://api.anthropic.com/v1/models")
        .header("x-api-key", api_key)
        .header("anthropic-version", "2023-06-01")
        .send()
        .await
        .map_err(|e| format!("Anthropic request failed: {}", e))?
        .error_for_status()
        .map_err(|e| format!("Anthropic error: {}", e))?;
    let data: AnthropicModelsResponse = resp.json().await.map_err(|e| e.to_string())?;
    Ok(data.data.into_iter().map(|m| m.id).collect())
}

/// Fetch available models from Groq API
#[command]
pub async fn fetch_groq_models(api_key: String) -> Result<Vec<String>, String> {
    #[derive(Deserialize)]
    struct GroqModel {
        id: String,
    }
    #[derive(Deserialize)]
    struct GroqModelsResponse {
        data: Vec<GroqModel>,
    }

    let client = reqwest::Client::new();
    let resp = client
        .get("https://api.groq.com/openai/v1/models")
        .header("Authorization", format!("Bearer {}", api_key))
        .send()
        .await
        .map_err(|e| format!("Groq request failed: {}", e))?
        .error_for_status()
        .map_err(|e| format!("Groq error: {}", e))?;
    let data: GroqModelsResponse = resp.json().await.map_err(|e| e.to_string())?;
    Ok(data.data.into_iter().map(|m| m.id).collect())
}

/// Basic completion for inline code suggestions
#[command]
pub async fn ollama_complete(
    model: String,
    prompt: String,
    max_tokens: Option<i32>,
    base_url: Option<String>,
) -> Result<String, String> {
    let client = reqwest::Client::new();
    let base = normalize_ollama_base(base_url.as_deref());

    let request = OllamaRequest {
        model: model.clone(),
        prompt: prompt.clone(),
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
        .post(format!("{}/api/generate", base))
        .json(&request)
        .send()
        .await
        .map_err(|e| format!("Local completion request failed: {}", e))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();

        // Some local LLM servers expose an OpenAI-compatible `/v1/completions` endpoint instead of `/api/generate`.
        // Try that before failing hard.
        let openai_url = format!("{}/v1/completions", base);
        let openai_payload = serde_json::json!({
            "model": model.clone(),
            "prompt": prompt.clone(),
            "max_tokens": max_tokens.unwrap_or(150),
            "temperature": 0.1,
            "stream": false,
        });
        let openai_resp = client
            .post(&openai_url)
            .json(&openai_payload)
            .send()
            .await
            .map_err(|e| format!("Local OpenAI-compat fallback failed at {}: {}", openai_url, e))?;

        if openai_resp.status().is_success() {
            let parsed: serde_json::Value = openai_resp.json().await.map_err(|e| e.to_string())?;
            let content = parsed
                .get("choices")
                .and_then(|v| v.as_array())
                .and_then(|arr| arr.first())
                .and_then(|choice| choice.get("text"))
                .and_then(|c| c.as_str())
                .unwrap_or("")
                .to_string();
            return Ok(content);
        }

        let openai_status = openai_resp.status();
        let openai_body = openai_resp.text().await.unwrap_or_default();

        return Err(format!(
            "Local completion endpoint returned status {}: {}\nFallback /v1/completions returned status {}: {}",
            status,
            body_preview(body, 220),
            openai_status,
            body_preview(openai_body, 220)
        ));
    }

    let result: OllamaResponse = resp.json().await.map_err(|e| e.to_string())?;
    Ok(result.response.unwrap_or_default())
}

/// Multi-turn chat for AI panel (like Cursor chat)
#[command]
pub async fn ollama_chat(
    model: String,
    messages: Vec<OllamaChatMessage>,
    context: Option<String>, // RAG context
    base_url: Option<String>,
) -> Result<String, String> {
    let client = reqwest::Client::new();
    let base = normalize_ollama_base(base_url.as_deref());
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

    let result = ollama_chat_with_fallback(&client, &base, &request).await?;
    
    if let Some(msg) = result.message {
        let mut content = msg.content;
        if looks_like_nonlocal_identity_refusal(&content) {
            if let Ok(rewritten) = rewrite_nonlocal_identity_response(
                &model_name,
                &messages_for_rewrite,
                &content,
                &base,
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
    base_url: &str,
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

    let rewritten = ollama_chat_direct(model, rewrite_messages, base_url).await?;
    Ok(sanitize_nonlocal_identity_terms(&rewritten))
}

/// Index entire codebase for RAG (runs in background)
#[command]
pub async fn index_codebase(
    root_path: String,
    chunk_size: Option<usize>,
) -> Result<usize, String> {
    let chunk_size = chunk_size.unwrap_or(25); // Reduced from 50 to 25 for better local LLM speed
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

// Generic external LLM API chat call across supported cloud providers.
// struct may be unused in current builds but kept for future expansion
#[allow(dead_code)]
#[derive(Serialize, Deserialize, Debug)]
pub struct ExternalChatRequest {
    pub provider: String,
    pub api_key: String,
    pub model: String,
    pub messages: Vec<OllamaChatMessage>,
    pub context: Option<String>,
}

async fn decode_api_json(
    response: reqwest::Response,
    provider: &str,
) -> Result<serde_json::Value, String> {
    let status = response.status();
    let body = response.text().await.map_err(|e| e.to_string())?;
    if !status.is_success() {
        return Err(format!(
            "{} API error ({}): {}",
            provider,
            status,
            truncate_text(body, 500)
        ));
    }
    serde_json::from_str(&body).map_err(|e| format!("Invalid {} response JSON: {}", provider, e))
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
        "openai" | "groq" => {
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

            let endpoint = if provider.eq_ignore_ascii_case("groq") {
                "https://api.groq.com/openai/v1/chat/completions"
            } else {
                "https://api.openai.com/v1/chat/completions"
            };

            let req_body = OpenAIRequest {
                model,
                messages: all_msgs,
            };
            let client = reqwest::Client::new();
            let resp = client
                .post(endpoint)
                .bearer_auth(&api_key)
                .json(&req_body)
                .send()
                .await
                .map_err(|e| e.to_string())?;
            let json = decode_api_json(resp, &provider).await?;
            if let Some(content) = json["choices"][0]["message"]["content"].as_str() {
                Ok(content.to_string())
            } else {
                Err(format!("{} response missing message content", provider))
            }
        }
        "anthropic" => {
            let mut system_parts: Vec<String> = Vec::new();
            if let Some(ctx) = context {
                if !ctx.trim().is_empty() {
                    system_parts.push(ctx);
                }
            }

            let mut anthropic_messages: Vec<serde_json::Value> = Vec::new();
            for m in messages {
                match m.role.as_str() {
                    "system" => {
                        if !m.content.trim().is_empty() {
                            system_parts.push(m.content);
                        }
                    }
                    "assistant" => anthropic_messages.push(serde_json::json!({
                        "role": "assistant",
                        "content": m.content,
                    })),
                    _ => anthropic_messages.push(serde_json::json!({
                        "role": "user",
                        "content": m.content,
                    })),
                }
            }

            if anthropic_messages.is_empty() {
                anthropic_messages.push(serde_json::json!({
                    "role": "user",
                    "content": "Hello",
                }));
            }

            let mut req = serde_json::json!({
                "model": model,
                "max_tokens": 2000,
                "messages": anthropic_messages,
            });
            if !system_parts.is_empty() {
                req["system"] = serde_json::Value::String(system_parts.join("\n\n"));
            }

            let client = reqwest::Client::new();
            let resp = client
                .post("https://api.anthropic.com/v1/messages")
                .header("x-api-key", api_key)
                .header("anthropic-version", "2023-06-01")
                .json(&req)
                .send()
                .await
                .map_err(|e| e.to_string())?;
            let json = decode_api_json(resp, "anthropic").await?;
            if let Some(content) = json["content"][0]["text"].as_str() {
                Ok(content.to_string())
            } else {
                Err("Anthropic response missing content".to_string())
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
    let max_tokens = max_tokens.unwrap_or(100);
    match provider.to_lowercase().as_str() {
        "openai" | "groq" => {
            let endpoint = if provider.eq_ignore_ascii_case("groq") {
                "https://api.groq.com/openai/v1/chat/completions"
            } else {
                "https://api.openai.com/v1/chat/completions"
            };

            let req = serde_json::json!({
                "model": model,
                "messages": [
                    {
                        "role": "user",
                        "content": prompt
                    }
                ],
                "max_tokens": max_tokens,
                "temperature": 0.1
            });
            let client = reqwest::Client::new();
            let resp = client
                .post(endpoint)
                .bearer_auth(&api_key)
                .json(&req)
                .send()
                .await
                .map_err(|e| e.to_string())?;
            let json = decode_api_json(resp, &provider).await?;
            if let Some(text) = json["choices"][0]["message"]["content"].as_str() {
                Ok(text.to_string())
            } else {
                Err(format!("{} completion missing text", provider))
            }
        }
        "anthropic" => {
            let req = serde_json::json!({
                "model": model,
                "max_tokens": max_tokens,
                "messages": [
                    {
                        "role": "user",
                        "content": prompt
                    }
                ]
            });

            let client = reqwest::Client::new();
            let resp = client
                .post("https://api.anthropic.com/v1/messages")
                .header("x-api-key", api_key)
                .header("anthropic-version", "2023-06-01")
                .json(&req)
                .send()
                .await
                .map_err(|e| e.to_string())?;
            let json = decode_api_json(resp, "anthropic").await?;
            if let Some(text) = json["content"][0]["text"].as_str() {
                Ok(text.to_string())
            } else {
                Err("Anthropic completion missing text".to_string())
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
    // Return the model as-is; callers must validate the model name before calling.
    // We no longer fall back to a hardcoded model name since it may not be installed.
    model
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
    base_url: &str,
) -> Result<String, String> {
    let client = reqwest::Client::new();
    let request = OllamaChatRequest {
        model: model.to_string(),
        messages,
        stream: false,
    };
    let result = ollama_chat_with_fallback(&client, base_url, &request).await?;
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
    let q = query.to_lowercase();
    let deep_scan_requested = [
        "deep scan",
        "full scan",
        "exhaustive",
        "comprehensive scan",
        "scan all files",
    ]
    .iter()
    .any(|k| q.contains(k));
    is_modify_request(query) || (is_review_request(query) && deep_scan_requested)
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

    for keyword in extract_query_keywords(query)
        .into_iter()
        .take(AGENT_RECON_KEYWORD_LIMIT)
    {
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
                for hit in lines.iter().take(6) {
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
    let max_lines = 120usize;
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
    base_url: &str,
    user_query: &str,
    root_path: Option<&str>,
    chunks: &[CodeChunk],
) -> Result<(Vec<CodeChunk>, Vec<String>), String> {
    let max_steps = AGENT_MAX_PLANNER_STEPS;
    let mut observations: Vec<String> = Vec::new();
    let mut collected_sources: Vec<CodeChunk> = Vec::new();
    let mut read_paths: HashSet<String> = HashSet::new();
    let mut stagnant_steps = 0usize;

    for step in 1..=max_steps {
        let sources_before = collected_sources.len();
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
            base_url,
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
                let hits = select_relevant_chunks(chunks, &search_query, 4);
                let obs = summarize_hits_for_observation(root_path, &search_query, &hits);
                observations.push(obs);
                merge_sources(&mut collected_sources, hits, AGENT_EARLY_SOURCE_TARGET);
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
                            merge_sources(&mut collected_sources, vec![chunk], AGENT_EARLY_SOURCE_TARGET);
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

        if observations.len() > 8 {
            let drain_count = observations.len() - 8;
            observations.drain(0..drain_count);
        }

        if collected_sources.len() > sources_before {
            stagnant_steps = 0;
        } else {
            stagnant_steps += 1;
        }

        if step >= 2 && collected_sources.len() >= AGENT_EARLY_SOURCE_TARGET {
            let _ = emit_agent_event(
                app,
                run_id,
                "stage",
                format!(
                    "Planner: enough evidence collected ({} source chunks). Moving to answer generation.",
                    collected_sources.len()
                ),
            );
            break;
        }

        if step >= 2 && stagnant_steps >= 2 {
            let _ = emit_agent_event(
                app,
                run_id,
                "stage",
                "Planner: no new evidence in recent steps. Finishing early for faster response.",
            );
            break;
        }
    }

    Ok((collected_sources, observations))
}

async fn stream_ollama_chat_direct(
    app: &AppHandle,
    run_id: &str,
    model: &str,
    messages: Vec<OllamaChatMessage>,
    base_url: &str,
) -> Result<String, String> {
    let client = reqwest::Client::new();
    let request = OllamaChatRequest {
        model: model.to_string(),
        messages,
        stream: true,
    };
    let resp = client
        .post(format!("{}/api/chat", base_url))
        .json(&request)
        .send()
        .await
        .map_err(|e| e.to_string())?
        .error_for_status()
        .map_err(|e| e.to_string())?;

    let mut stream = resp.bytes_stream();
    let mut buf = String::new();
    let mut full = String::new();

    while let Some(item) = stream.next().await {
        let bytes = item.map_err(|e| e.to_string())?;
        buf.push_str(&String::from_utf8_lossy(&bytes));

        while let Some(pos) = buf.find('\n') {
            let line = buf[..pos].trim().to_string();
            buf.drain(..=pos);
            if line.is_empty() {
                continue;
            }
            if let Ok(chunk) = serde_json::from_str::<OllamaResponse>(&line) {
                let token = chunk
                    .message
                    .as_ref()
                    .map(|m| m.content.clone())
                    .or_else(|| chunk.response.clone())
                    .unwrap_or_default();
                if !token.is_empty() {
                    full.push_str(&token);
                    let _ = emit_agent_event(app, run_id, "token", token);
                }
                if chunk.done {
                    return if full.trim().is_empty() {
                        Err("Agent stream returned empty response".to_string())
                    } else {
                        Ok(full)
                    };
                }
            }
        }
    }

    if full.trim().is_empty() {
        Err("Agent stream returned empty response".to_string())
    } else {
        Ok(full)
    }
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
    base_url: &str,
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
         For each proposed file change, use this exact format so UI can map it:\n\
         ### File: relative/path/from/project-root\n\
         ```language\n\
         full file content or patch content\n\
         ```\n\
         If terminal commands are needed, add a bash block in Validation.\n\
         Never output generic boilerplate. Always anchor findings to real project files.\n\
         Never claim edits were already applied; provide proposals and wait for user approval.",
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
    let mut streamed_live = true;
    let mut full = match stream_ollama_chat_direct(app, run_id, model, base_messages.clone(), base_url).await {
        Ok(text) => text,
        Err(_) => {
            streamed_live = false;
            let _ = emit_agent_event(
                app,
                run_id,
                "stage",
                "Live token stream unavailable, using fast fallback response mode.",
            );
            ollama_chat_direct(model, base_messages.clone(), base_url).await?
        }
    };
    if looks_like_nonlocal_identity_refusal(&full) {
        if let Ok(rewritten) = rewrite_nonlocal_identity_response(model, &base_messages, &full, base_url).await {
            full = rewritten;
        } else {
            full = sanitize_nonlocal_identity_terms(&full);
        }
    }

    if looks_like_generic_agent_answer(&full, sources) {
        let _ = emit_agent_event(
            app,
            run_id,
            "stage",
            "Model answer was generic. Switching to grounded fallback summary.",
        );
        full = build_grounded_fallback_answer(query, root_path, sources);
    }

    if full.trim().is_empty() {
        return Err("Agent produced an empty response".to_string());
    }

    if !streamed_live {
        for chunk in stream_chunks(&full, 72) {
            let _ = emit_agent_event(app, run_id, "token", chunk);
        }
    }
    Ok(full)
}

/// Expose raw RAG context without tying to Ollama, for multi-model / API orchestration
#[command]
pub async fn get_rag_context(
    root_path: String,
    query: String,
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
            answer: "".to_string(),
            sources: vec![],
        });
    }

    let context = build_rag_context(&root_path, &sources);
    Ok(RAGResult { answer: context, sources })
}

/// RAG query: find relevant code + generate answer
#[command]
pub async fn rag_query(
    root_path: String,
    query: String,
    model: String,
    base_url: Option<String>,
) -> Result<RAGResult, String> {
    let selected_model = default_model(model);
    if selected_model.trim().is_empty() {
        return Err("No model specified. Please select an Ollama model in the AI panel.".to_string());
    }
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
        selected_model,
        vec![OllamaChatMessage {
            role: "user".to_string(),
            content: format!(
                "{}\n\nProject root: {}. Prefer existing dependencies and project conventions.",
                query, root_path
            ),
        }],
        Some(context),
        base_url,
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
    base_url: Option<String>,
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
    rag_query(root_path, agent_query, model, base_url).await
}

/// Streaming agent mode with realtime progress and token events.
#[command]
pub async fn agentic_rag_chat(
    app: AppHandle,
    run_id: String,
    root_path: Option<String>,
    query: String,
    model: String,
    base_url: Option<String>,
    context: Option<String>,
) -> Result<RAGResult, String> {
    let selected_model = default_model(model);
    if selected_model.trim().is_empty() {
        return Err("No model specified. Please select an Ollama model in the AI panel.".to_string());
    }
    let resolved_base = normalize_ollama_base(base_url.as_deref());
    let normalized_root = root_path
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());
    let mut indexed_chunks: Vec<CodeChunk> = Vec::new();
    let mut sources: Vec<CodeChunk> = Vec::new();
    let mut investigation_notes: Vec<String> = Vec::new();

    let _ = emit_agent_event(&app, &run_id, "stage", "Starting advanced agentic run");

    if let Some(root) = normalized_root.as_deref() {
        let index_path = format!("{}/.NCode/index.json", root);
        if !std::path::Path::new(&index_path).exists() {
            let _ = emit_agent_event(&app, &run_id, "stage", "Indexing project for RAG context");
            let count = index_codebase(root.to_string(), None).await?;
            let _ = emit_agent_event(
                &app,
                &run_id,
                "stage",
                format!("Indexed {} chunks for retrieval", count),
            );
        }

        indexed_chunks = load_indexed_chunks(root)?;
        let _ = emit_agent_event(
            &app,
            &run_id,
            "stage",
            format!("Loaded {} code chunks from index", indexed_chunks.len()),
        );

        if needs_project_recon(&query) {
            let _ = emit_agent_event(
                &app,
                &run_id,
                "stage",
                "🔍 Reconnaissance mode: Scanning project structure and dependencies",
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
                    "✅ Recon complete: {} source chunk(s) found, {} observation(s) recorded",
                    sources.len(),
                    investigation_notes.len()
                ),
            );
        } else {
            let _ = emit_agent_event(
                &app,
                &run_id,
                "stage",
                "📚 Using RAG retrieval for targeted analysis",
            );
        }
    } else {
        let _ = emit_agent_event(
            &app,
            &run_id,
            "stage",
            "⚠️ No folder open - proceeding with memory-only context",
        );
    }

    // Run the agent planner with improved error handling
    match run_agent_planner_loop(
        &app,
        &run_id,
        &selected_model,
        &resolved_base,
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
                    "🎯 Agent planner: Found {} sources and {} observations",
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
                format!("⚠️ Planner encountered limit, using collected sources: {}", err),
            );
        }
    }

    // Build comprehensive context
    let mut context_parts: Vec<String> = Vec::new();
    // Inject caller-supplied system context (mode hints, project info) first
    if let Some(ref extra_ctx) = context {
        if !extra_ctx.trim().is_empty() {
            context_parts.push(format!("=== SYSTEM INSTRUCTIONS ===\n{}", extra_ctx.trim()));
        }
    }
    if let Some(root) = normalized_root.as_deref() {
        if !sources.is_empty() {
            let rag_context = build_rag_context(root, &sources);
            context_parts.push(format!("=== CODE CONTEXT ===\n{}", rag_context));
        }
    }
    if !investigation_notes.is_empty() {
        context_parts.push(format!(
            "=== INVESTIGATION LOG ===\nAgent observations:\n{}",
            investigation_notes.join("\n\n")
        ));
    }
    let rag_context = if context_parts.is_empty() {
        None
    } else {
        Some(context_parts.join("\n\n=== END SECTION ===\n\n"))
    };

    // Generate final response with full context
    let _ = emit_agent_event(&app, &run_id, "stage", "🤖 Advanced reasoning and response generation");
    match stream_ollama_agent_response(
        &app,
        &run_id,
        &selected_model,
        &resolved_base,
        &query,
        normalized_root.as_deref(),
        rag_context,
        &sources,
    )
    .await
    {
        Ok(answer) => {
            let _ = emit_agent_event(&app, &run_id, "done", "✅ Agent analysis complete");
            Ok(RAGResult { answer, sources })
        }
        Err(err) => {
            let _ = emit_agent_event(&app, &run_id, "error", format!("❌ Agent error: {}", err));
            Err(err)
        }
    }
}

/// Robust issue detection and analysis
///
/// Analyzes code for bugs, performance issues, security vulnerabilities
#[command]
/// Analyze code for security issues
fn analyze_security(code: &str, _language: &str) -> Vec<serde_json::Value> {
    let mut issues = Vec::new();
    let lines: Vec<&str> = code.lines().collect();
    
    for (idx, line) in lines.iter().enumerate() {
        let line_no = idx + 1;
        
        // Check for SQL injection patterns
        if line.contains("SQL") || line.contains("query") {
            if line.contains("format(") || line.contains("f\"") || line.contains("concat") {
                issues.push(serde_json::json!({
                    "type": "security",
                    "severity": "critical",
                    "line": line_no,
                    "message": "Potential SQL injection - string concatenation used",
                    "suggestion": "Use parameterized queries or prepared statements"
                }));
            }
        }
        
        // Check for hardcoded secrets
        if line.contains("password") || line.contains("api_key") || line.contains("secret") {
            if line.contains("=") && !line.trim().starts_with("//") {
                let value = line.split('=').nth(1).unwrap_or("");
                if value.contains("\"") || value.contains("'") {
                    issues.push(serde_json::json!({
                        "type": "security",
                        "severity": "critical",
                        "line": line_no,
                        "message": "Hardcoded secret detected",
                        "suggestion": "Use environment variables or secure vaults"
                    }));
                }
            }
        }
    }
    
    issues
}

/// Analyze code for syntax issues
fn analyze_syntax(code: &str, _language: &str) -> Vec<serde_json::Value> {
    let mut issues = Vec::new();
    
    // Basic bracket matching
    let mut stack = Vec::new();
    for (idx, ch) in code.chars().enumerate() {
        match ch {
            '{' | '[' | '(' => stack.push((ch, idx)),
            '}' => {
                if stack.is_empty() || stack.pop().unwrap().0 != '{' {
                    issues.push(serde_json::json!({
                        "type": "syntax",
                        "severity": "high",
                        "position": idx,
                        "message": "Mismatched braces",
                    }));
                }
            }
            ']' => {
                if stack.is_empty() || stack.pop().unwrap().0 != '[' {
                    issues.push(serde_json::json!({
                        "type": "syntax",
                        "severity": "high",
                        "position": idx,
                        "message": "Mismatched brackets",
                    }));
                }
            }
            ')' => {
                if stack.is_empty() || stack.pop().unwrap().0 != '(' {
                    issues.push(serde_json::json!({
                        "type": "syntax",
                        "severity": "high",
                        "position": idx,
                        "message": "Mismatched parentheses",
                    }));
                }
            }
            _ => {}
        }
    }
    
    issues
}

/// Send a chat message through the Python gRPC AI Service
///
/// This is the recommended way to send AI requests. The Python service handles:
/// - Model selection and routing
/// - Ollama (local) or API (cloud) provider decisions
/// - Token management and streaming
///
/// Flow:
/// 1. React UI sends message via invoke()
/// 2. Rust gRPC client sends to Python service
/// 3. Python service decides model/provider and calls Ollama or APIs
/// 4. Response flows back through gRPC to React UI
#[command]
pub async fn grpc_ai_chat(
    model: String,
    messages: Vec<OllamaChatMessage>,
    provider: String,
    api_key: Option<String>,
    temperature: Option<f32>,
    max_tokens: Option<i32>,
) -> Result<String, String> {
    use crate::grpc_client::{GrpcAiClient, ChatMessage};

    let client = GrpcAiClient::default_client();
    
    // Check if we can connect
    match client.connect().await {
        Ok(_) => {},
        Err(e) => {
            return Err(format!("Failed to connect to gRPC AI service on port 50051: {}. Make sure the Python AI service is running (python3 python-ai-service/server.py)", e));
        }
    }

    // Extract latest user prompt and keep prior messages as history to avoid duplicating the same prompt.
    let latest_user_idx = messages.iter().rposition(|m| m.role == "user");
    let prompt = latest_user_idx
        .and_then(|idx| messages.get(idx).map(|m| m.content.clone()))
        .or_else(|| messages.last().map(|m| m.content.clone()))
        .unwrap_or_else(|| "Hello".to_string());

    let chat_messages: Vec<ChatMessage> = messages
        .iter()
        .enumerate()
        .filter(|(idx, _)| latest_user_idx.map(|u| u != *idx).unwrap_or(true))
        .map(|(_, m)| ChatMessage {
            role: m.role.clone(),
            content: m.content.clone(),
        })
        .collect();

    // Send chat request through gRPC
    match client.chat(
        model,
        prompt,
        chat_messages,
        provider,
        api_key,
        temperature,
        max_tokens,
    )
    .await
    {
        Ok(response) => {
            client.disconnect().await;
            Ok(response.content)
        }
        Err(e) => {
            client.disconnect().await;
            Err(format!("gRPC AI chat error: {}", e))
        }
    }
}

/// Check if the Python gRPC AI Service is healthy and accessible
#[command]
pub async fn grpc_health_check() -> Result<bool, String> {
    use crate::grpc_client::GrpcAiClient;

    let client = GrpcAiClient::default_client();
    match client.health_check().await {
        Ok(healthy) => {
            client.disconnect().await;
            Ok(healthy)
        }
        Err(e) => {
            client.disconnect().await;
            Err(format!("gRPC health check failed: {}", e))
        }
    }
}

fn find_python_service_dir() -> Option<PathBuf> {
    let mut candidates: Vec<PathBuf> = Vec::new();

    if let Ok(custom_dir) = std::env::var("NCODE_PY_SERVICE_DIR") {
        if !custom_dir.trim().is_empty() {
            candidates.push(PathBuf::from(custom_dir));
        }
    }
    if let Ok(cwd) = std::env::current_dir() {
        candidates.push(cwd.join("python-ai-service"));
        candidates.push(cwd.join("../python-ai-service"));
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            candidates.push(dir.join("python-ai-service"));
            candidates.push(dir.join("../python-ai-service"));
            candidates.push(dir.join("../../python-ai-service"));
            candidates.push(dir.join("../../../python-ai-service"));
        }
    }

    for candidate in candidates {
        if candidate.join("server.py").exists() {
            return Some(candidate);
        }
    }
    None
}

fn check_python_import(service_dir: &Path, python: &str, module: &str) -> Result<(), String> {
    let check = Command::new(python)
        .arg("-c")
        .arg(format!("import {}", module))
        .current_dir(service_dir)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .output()
        .map_err(|e| format!("Failed to run python import check for '{}': {}", module, e))?;
    if check.status.success() {
        return Ok(());
    }

    let detail = String::from_utf8_lossy(&check.stderr).trim().to_string();
    Err(format!(
        "Missing Python module '{}'. Run: cd {} && {} -m pip install -r requirements.txt{}",
        module,
        service_dir.to_string_lossy(),
        python,
        if detail.is_empty() {
            "".to_string()
        } else {
            format!(" (detail: {})", detail)
        }
    ))
}

fn ensure_python_grpc_preflight(service_dir: &Path, python: &str) -> Result<(), String> {
    let required_files = ["server.py", "ai_service.proto"];
    for rel in required_files {
        let path = service_dir.join(rel);
        if !path.exists() {
            return Err(format!(
                "Missing required file for gRPC service: {}",
                path.to_string_lossy()
            ));
        }
    }

    for module in ["grpc", "grpc_tools", "aiohttp", "pydantic", "pydantic_settings"] {
        check_python_import(service_dir, python, module)?;
    }

    let pb2 = service_dir.join("ai_service_pb2.py");
    let pb2_grpc = service_dir.join("ai_service_pb2_grpc.py");
    if !pb2.exists() || !pb2_grpc.exists() {
        let gen = Command::new(python)
            .args([
                "-m",
                "grpc_tools.protoc",
                "-I.",
                "--python_out=.",
                "--grpc_python_out=.",
                "ai_service.proto",
            ])
            .current_dir(service_dir)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .output()
            .map_err(|e| format!("Failed to run grpc_tools.protoc: {}", e))?;
        if !gen.status.success() {
            let out = String::from_utf8_lossy(&gen.stdout).trim().to_string();
            let err = String::from_utf8_lossy(&gen.stderr).trim().to_string();
            return Err(format!(
                "Failed to generate protobuf Python stubs. Run manually:\ncd {}\n{} -m grpc_tools.protoc -I. --python_out=. --grpc_python_out=. ai_service.proto\nstdout: {}\nstderr: {}",
                service_dir.to_string_lossy(),
                python,
                if out.is_empty() { "(empty)".to_string() } else { out },
                if err.is_empty() { "(empty)".to_string() } else { err },
            ));
        }
    }

    Ok(())
}

fn read_log_tail(path: &Path, max_lines: usize) -> String {
    let content = std::fs::read_to_string(path).unwrap_or_default();
    if content.trim().is_empty() {
        return "(no log output captured)".to_string();
    }
    let lines: Vec<&str> = content.lines().collect();
    let start = lines.len().saturating_sub(max_lines);
    lines[start..].join("\n")
}

fn find_python_executable(service_dir: &Path) -> Option<String> {
    let mut candidates: Vec<String> = Vec::new();

    if let Ok(custom) = std::env::var("NCODE_PYTHON") {
        if !custom.trim().is_empty() {
            candidates.push(custom);
        }
    }
    if let Ok(custom) = std::env::var("PYTHON") {
        if !custom.trim().is_empty() {
            candidates.push(custom);
        }
    }

    candidates.push(
        service_dir
            .join(".venv/bin/python3")
            .to_string_lossy()
            .to_string(),
    );
    candidates.push(
        service_dir
            .join(".venv/bin/python")
            .to_string_lossy()
            .to_string(),
    );
    candidates.push("python3".to_string());
    candidates.push("python".to_string());

    for bin in candidates {
        let check = Command::new(&bin)
            .arg("--version")
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();
        if check.map(|s| s.success()).unwrap_or(false) {
            return Some(bin);
        }
    }
    None
}

#[command]
pub async fn start_grpc_service() -> Result<String, String> {
    if let Ok(true) = grpc_health_check().await {
        return Ok("gRPC service is already running on 127.0.0.1:50051".to_string());
    }

    let service_dir = find_python_service_dir()
        .ok_or_else(|| "Could not find python-ai-service directory".to_string())?;
    let python = find_python_executable(&service_dir)
        .ok_or_else(|| "Could not find a usable Python interpreter".to_string())?;
    ensure_python_grpc_preflight(&service_dir, &python)?;

    let log_path = service_dir.join(".ncode-grpc.log");
    let stdout_log = OpenOptions::new()
        .create(true)
        .write(true)
        .truncate(true)
        .open(&log_path)
        .map_err(|e| format!("Failed to open gRPC log file {}: {}", log_path.to_string_lossy(), e))?;
    let stderr_log = stdout_log
        .try_clone()
        .map_err(|e| format!("Failed to clone gRPC log handle: {}", e))?;

    Command::new(&python)
        .arg("server.py")
        .current_dir(&service_dir)
        .env("PYTHONUNBUFFERED", "1")
        .stdin(Stdio::null())
        .stdout(Stdio::from(stdout_log))
        .stderr(Stdio::from(stderr_log))
        .spawn()
        .map_err(|e| format!("Failed to start gRPC service: {}", e))?;

    for _ in 0..20 {
        tokio::time::sleep(Duration::from_millis(300)).await;
        if let Ok(true) = grpc_health_check().await {
            return Ok(format!(
                "Started gRPC service from {}",
                service_dir.to_string_lossy()
            ));
        }
    }

    let log_tail = read_log_tail(&log_path, 60);
    Err(format!(
        "Started python process but gRPC is still unreachable. Service dir: {}. Python: {}. Log: {}\nRecent log output:\n{}",
        service_dir.to_string_lossy(),
        python,
        log_path.to_string_lossy(),
        log_tail
    ))
}

/// Streaming chat command — emits ai-stream-token, ai-stream-done, ai-stream-error events
#[command]
pub async fn ollama_chat_stream(
    app: AppHandle,
    model: String,
    messages: Vec<OllamaChatMessage>,
    context: Option<String>,
    base_url: Option<String>,
) -> Result<(), String> {
    let message_id = format!("stream-{}", now_ts_millis());
    let base = normalize_ollama_base(base_url.as_deref());

    let mut all_messages = messages;
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
            content: format!("{}\n\nWrite clean, practical answers for code tasks.", LOCAL_OLLAMA_SYSTEM_PROMPT),
        });
    }

    #[derive(Clone, Serialize)]
    struct StreamTokenPayload {
        #[serde(rename = "messageId")]
        message_id: String,
        token: String,
    }

    #[derive(Clone, Serialize)]
    struct StreamDonePayload {
        #[serde(rename = "messageId")]
        message_id: String,
    }

    #[derive(Clone, Serialize)]
    struct StreamErrorPayload {
        #[serde(rename = "messageId")]
        message_id: String,
        error: String,
    }

    let client = reqwest::Client::new();
    let request = OllamaChatRequest {
        model,
        messages: all_messages,
        stream: true,
    };

    let resp = match client
        .post(format!("{}/api/chat", base))
        .json(&request)
        .send()
        .await
    {
        Ok(r) if r.status().is_success() => r,
        Ok(r) => {
            let status = r.status();
            let body = r.text().await.unwrap_or_default();
            let _ = app.emit("ai-stream-error", StreamErrorPayload {
                message_id,
                error: format!("Ollama error ({}): {}", status, body_preview(body, 220)),
            });
            return Err("Stream request failed".to_string());
        }
        Err(e) => {
            let _ = app.emit("ai-stream-error", StreamErrorPayload {
                message_id,
                error: format!("Connection failed: {}", e),
            });
            return Err(e.to_string());
        }
    };

    let mut stream = resp.bytes_stream();
    let mut buf = String::new();

    while let Some(item) = stream.next().await {
        let bytes = match item {
            Ok(b) => b,
            Err(e) => {
                let _ = app.emit("ai-stream-error", StreamErrorPayload {
                    message_id,
                    error: format!("Stream read error: {}", e),
                });
                return Err(e.to_string());
            }
        };
        buf.push_str(&String::from_utf8_lossy(&bytes));

        while let Some(pos) = buf.find('\n') {
            let line = buf[..pos].trim().to_string();
            buf.drain(..=pos);
            if line.is_empty() {
                continue;
            }
            if let Ok(chunk) = serde_json::from_str::<OllamaResponse>(&line) {
                let token = chunk
                    .message
                    .as_ref()
                    .map(|m| m.content.clone())
                    .or_else(|| chunk.response.clone())
                    .unwrap_or_default();
                if !token.is_empty() {
                    let _ = app.emit("ai-stream-token", StreamTokenPayload {
                        message_id: message_id.clone(),
                        token,
                    });
                }
                if chunk.done {
                    let _ = app.emit("ai-stream-done", StreamDonePayload {
                        message_id,
                    });
                    return Ok(());
                }
            }
        }
    }

    // Stream ended without a done flag — emit done anyway
    let _ = app.emit("ai-stream-done", StreamDonePayload { message_id });
    Ok(())
}

/// Stream chat via gRPC — emits ai-stream-token, ai-stream-done, ai-stream-error events
#[command]
pub async fn grpc_stream_chat(
    app: AppHandle,
    model: String,
    messages: Vec<OllamaChatMessage>,
    provider: String,
    api_key: Option<String>,
    temperature: Option<f32>,
    max_tokens: Option<i32>,
) -> Result<(), String> {
    use crate::grpc_client::{GrpcAiClient, ChatMessage};

    let message_id = format!("grpc-stream-{}", now_ts_millis());
    let client = GrpcAiClient::default_client();

    match client.connect().await {
        Ok(_) => {}
        Err(e) => {
            return Err(format!("Failed to connect to gRPC AI service: {}", e));
        }
    }

    let chat_messages: Vec<ChatMessage> = messages
        .into_iter()
        .map(|m| ChatMessage { role: m.role, content: m.content })
        .collect();

    let result = client
        .stream_chat(&app, message_id, model, chat_messages, provider, api_key, temperature, max_tokens)
        .await;

    client.disconnect().await;
    result.map_err(|e| e.to_string())
}

/// Fetch available models from a provider via gRPC
#[command]
pub async fn grpc_fetch_models(
    provider: String,
    api_key: Option<String>,
    base_url: Option<String>,
) -> Result<Vec<String>, String> {
    use crate::grpc_client::GrpcAiClient;

    let client = GrpcAiClient::default_client();
    match client.connect().await {
        Ok(_) => {},
        Err(e) => {
            return Err(format!("Failed to connect to gRPC AI service: {}", e));
        }
    }

    match client.fetch_models(provider, api_key, base_url).await {
        Ok(models) => {
            client.disconnect().await;
            Ok(models)
        }
        Err(e) => {
            client.disconnect().await;
            Err(format!("gRPC fetch models error: {}", e))
        }
    }
}

fn parse_tool_calls(raw: &str) -> Vec<ToolCall> {
    let json_str = extract_json_object(raw).unwrap_or_default();
    if json_str.is_empty() {
        return vec![];
    }
    // Try tool_calls array
    if let Ok(resp) = serde_json::from_str::<ToolCallResponse>(&json_str) {
        if !resp.tool_calls.is_empty() {
            return resp.tool_calls;
        }
    }
    // Try single tool call
    if let Ok(tc) = serde_json::from_str::<ToolCall>(&json_str) {
        if !tc.tool.is_empty() {
            return vec![tc];
        }
    }
    vec![]
}

fn run_agent_command(project_root: &str, cmd: &str) -> String {
    let parts: Vec<&str> = cmd.splitn(2, ' ').collect();
    let (prog, rest) = if parts.len() == 2 { (parts[0], parts[1]) } else { (cmd, "") };
    let args: Vec<&str> = if rest.is_empty() { vec![] } else { rest.split_whitespace().collect() };

    match std::process::Command::new(prog)
        .args(&args)
        .current_dir(project_root)
        .output()
    {
        Ok(out) => {
            let stdout = String::from_utf8_lossy(&out.stdout).to_string();
            let stderr = String::from_utf8_lossy(&out.stderr).to_string();
            if stdout.is_empty() && !stderr.is_empty() {
                stderr
            } else {
                stdout
            }
        }
        Err(e) => format!("Command error: {}", e),
    }
}

fn compute_simple_diff(original: &str, new_content: &str) -> String {
    let orig_lines: Vec<&str> = original.lines().collect();
    let new_lines: Vec<&str> = new_content.lines().collect();
    let mut diff = String::new();
    let max = orig_lines.len().max(new_lines.len());
    for i in 0..max {
        match (orig_lines.get(i), new_lines.get(i)) {
            (Some(o), Some(n)) if o != n => {
                diff.push_str(&format!("- {}\n+ {}\n", o, n));
            }
            (Some(o), None) => diff.push_str(&format!("- {}\n", o)),
            (None, Some(n)) => diff.push_str(&format!("+ {}\n", n)),
            _ => {}
        }
    }
    if diff.is_empty() { "(no changes)".to_string() } else { diff }
}

/// Run an agentic task with tool-call loop, step counter, and max-steps enforcement.
/// Emits ai-agent-event, ai-agent-file-change, and ai-agent-confirm-required Tauri events.
#[command]
pub async fn run_agent_task(
    app: AppHandle,
    model: String,
    messages: Vec<OllamaChatMessage>,
    project_root: String,
    max_steps: Option<usize>,
) -> Result<String, String> {
    use std::sync::{Arc, Mutex};
    use tokio::sync::oneshot;
    use tauri::Listener;

    let max = max_steps.unwrap_or(20);
    let mut history = messages.clone();
    let mut change_history: Vec<AgentFileChange> = Vec::new();
    let mut step = 0usize;

    // System prompt for agent mode
    let system_msg = OllamaChatMessage {
        role: "system".to_string(),
        content: format!(
            "You are an autonomous coding agent. For each step, respond with a JSON object containing a 'tool_calls' array. \
             Each tool call has 'tool' and 'args' fields. \
             Available tools: read_file(path), write_file(path, content), create_file(path, content), \
             delete_file(path), list_dir(path), search_code(query), run_command(cmd), finish(summary). \
             Project root: {}. Always use relative paths.",
            project_root
        ),
    };
    if history.is_empty() || history[0].role != "system" {
        history.insert(0, system_msg);
    }

    let base_url = OLLAMA_BASE.to_string();

    loop {
        if step >= max {
            let partial = format!("Reached maximum steps ({}). Partial completion.", max);
            let result = serde_json::json!({
                "summary": partial,
                "changes": change_history
            });
            return Ok(result.to_string());
        }

        // Call the model
        let response = ollama_chat_direct(
            &model,
            history.clone(),
            &base_url,
        ).await?;

        // Add assistant response to history
        history.push(OllamaChatMessage {
            role: "assistant".to_string(),
            content: response.clone(),
        });

        // Parse tool calls
        let tool_calls = parse_tool_calls(&response);
        if tool_calls.is_empty() {
            let result = serde_json::json!({
                "summary": response,
                "changes": change_history
            });
            return Ok(result.to_string());
        }

        let mut tool_results = Vec::new();

        for tc in &tool_calls {
            step += 1;
            let tool_name = tc.tool.as_str();
            let args = &tc.args;

            let result_str: String = match tool_name {
                "finish" => {
                    let summary = args.get("summary")
                        .and_then(|v| v.as_str())
                        .unwrap_or("Task complete.")
                        .to_string();
                    let _ = app.emit("ai-agent-event", AgentStepEvent {
                        step,
                        tool: tool_name.to_string(),
                        args: args.clone(),
                        result: summary.clone(),
                        ts: now_ts_millis(),
                    });
                    let result = serde_json::json!({
                        "summary": summary,
                        "changes": change_history
                    });
                    return Ok(result.to_string());
                }

                "read_file" => {
                    let path = args.get("path").and_then(|v| v.as_str()).unwrap_or("");
                    match resolve_path_in_root(&project_root, path) {
                        Ok(full_path) => {
                            std::fs::read_to_string(&full_path)
                                .unwrap_or_else(|e| format!("Error reading file: {}", e))
                        }
                        Err(e) => format!("Error resolving path: {}", e),
                    }
                }

                "list_dir" => {
                    let path = args.get("path").and_then(|v| v.as_str());
                    list_dir_preview(&project_root, path).unwrap_or_else(|e| e)
                }

                "search_code" => {
                    let query = args.get("query").and_then(|v| v.as_str()).unwrap_or("");
                    match search_with_unix_tools(&project_root, query) {
                        Ok(hits) => hits.join("\n"),
                        Err(e) => format!("Search error: {}", e),
                    }
                }

                "run_command" => {
                    let cmd = args.get("cmd").and_then(|v| v.as_str()).unwrap_or("");
                    run_agent_command(&project_root, cmd)
                }

                "write_file" | "create_file" => {
                    let path = args.get("path").and_then(|v| v.as_str()).unwrap_or("");
                    let content = args.get("content").and_then(|v| v.as_str()).unwrap_or("");
                    let action = if tool_name == "create_file" { "create" } else { "write" };

                    match resolve_path_in_root_or_new(&project_root, path) {
                        Ok(full_path) => {
                            let original = std::fs::read_to_string(&full_path).ok();
                            let diff = compute_simple_diff(
                                original.as_deref().unwrap_or(""),
                                content,
                            );

                            let confirm_id = format!("confirm-{}", now_ts_millis());
                            let (tx, rx) = oneshot::channel::<bool>();
                            let tx = Arc::new(Mutex::new(Some(tx)));

                            let event_name = format!("ai-agent-confirm-{}", confirm_id);
                            let tx_clone = tx.clone();
                            let handler = app.listen(event_name.clone(), move |_event| {
                                if let Some(sender) = tx_clone.lock().unwrap().take() {
                                    let _ = sender.send(true);
                                }
                            });

                            let _ = app.emit("ai-agent-confirm-required", AgentConfirmEvent {
                                confirm_id: confirm_id.clone(),
                                path: path.to_string(),
                                diff,
                                tool: tool_name.to_string(),
                            });

                            let confirmed = tokio::time::timeout(
                                Duration::from_secs(60),
                                rx,
                            ).await.unwrap_or(Ok(false)).unwrap_or(false);

                            app.unlisten(handler);

                            if !confirmed {
                                "Operation denied by user.".to_string()
                            } else {
                                if let Some(parent) = full_path.parent() {
                                    let _ = std::fs::create_dir_all(parent);
                                }
                                match std::fs::write(&full_path, content) {
                                    Ok(_) => {
                                        change_history.push(AgentFileChange {
                                            path: full_path.to_string_lossy().to_string(),
                                            original_content: original,
                                            action: action.to_string(),
                                        });
                                        let _ = app.emit("ai-agent-file-change", AgentFileChangeEvent {
                                            path: path.to_string(),
                                            content: content.to_string(),
                                            action: action.to_string(),
                                        });
                                        format!("File written: {}", path)
                                    }
                                    Err(e) => format!("Error writing file: {}", e),
                                }
                            }
                        }
                        Err(e) => format!("Error resolving path: {}", e),
                    }
                }

                "delete_file" => {
                    let path = args.get("path").and_then(|v| v.as_str()).unwrap_or("");
                    match resolve_path_in_root(&project_root, path) {
                        Ok(full_path) => {
                            let original = std::fs::read_to_string(&full_path).ok();
                            let diff = format!("--- {}\n+++ /dev/null\n(file deleted)", path);

                            let confirm_id = format!("confirm-{}", now_ts_millis());
                            let (tx, rx) = oneshot::channel::<bool>();
                            let tx = Arc::new(Mutex::new(Some(tx)));

                            let event_name = format!("ai-agent-confirm-{}", confirm_id);
                            let tx_clone = tx.clone();
                            let handler = app.listen(event_name.clone(), move |_event| {
                                if let Some(sender) = tx_clone.lock().unwrap().take() {
                                    let _ = sender.send(true);
                                }
                            });

                            let _ = app.emit("ai-agent-confirm-required", AgentConfirmEvent {
                                confirm_id: confirm_id.clone(),
                                path: path.to_string(),
                                diff,
                                tool: "delete_file".to_string(),
                            });

                            let confirmed = tokio::time::timeout(
                                Duration::from_secs(60),
                                rx,
                            ).await.unwrap_or(Ok(false)).unwrap_or(false);

                            app.unlisten(handler);

                            if !confirmed {
                                "Deletion denied by user.".to_string()
                            } else {
                                match std::fs::remove_file(&full_path) {
                                    Ok(_) => {
                                        change_history.push(AgentFileChange {
                                            path: full_path.to_string_lossy().to_string(),
                                            original_content: original,
                                            action: "delete".to_string(),
                                        });
                                        let _ = app.emit("ai-agent-file-change", AgentFileChangeEvent {
                                            path: path.to_string(),
                                            content: String::new(),
                                            action: "delete".to_string(),
                                        });
                                        format!("File deleted: {}", path)
                                    }
                                    Err(e) => format!("Error deleting file: {}", e),
                                }
                            }
                        }
                        Err(e) => format!("Error resolving path: {}", e),
                    }
                }

                _ => format!("Unknown tool: {}", tool_name),
            };

            // Emit step event (for non-finish tools)
            let _ = app.emit("ai-agent-event", AgentStepEvent {
                step,
                tool: tool_name.to_string(),
                args: args.clone(),
                result: result_str.clone(),
                ts: now_ts_millis(),
            });

            tool_results.push(format!("Tool: {}\nResult: {}", tool_name, result_str));
        }

        // Feed tool results back to model
        history.push(OllamaChatMessage {
            role: "user".to_string(),
            content: format!("Tool results:\n{}", tool_results.join("\n\n")),
        });
    }
}

/// Like resolve_path_in_root but allows paths that don't exist yet (for file creation)
fn resolve_path_in_root_or_new(root_path: &str, requested: &str) -> Result<PathBuf, String> {
    let root = root_path_buf(root_path)?;
    let candidate = if Path::new(requested).is_absolute() {
        PathBuf::from(requested)
    } else {
        root.join(requested)
    };
    // For new files, we can't canonicalize since they don't exist yet
    // Just check the path doesn't escape the root
    let normalized = candidate.components().fold(PathBuf::new(), |mut acc, c| {
        match c {
            std::path::Component::ParentDir => { acc.pop(); acc }
            std::path::Component::CurDir => acc,
            other => { acc.push(other); acc }
        }
    });
    if !normalized.starts_with(&root) {
        return Err("Path is outside the open project".to_string());
    }
    Ok(normalized)
}

// ── Prompt Template Management (Tasks 6.5, 6.6) ─────────────────────────────

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct PromptTemplate {
    pub name: String,
    pub content: String,
}

/// List all prompt templates from .kiro/prompts/*.md
#[command]
pub async fn list_prompt_templates(project_root: String) -> Result<Vec<PromptTemplate>, String> {
    let prompts_dir = PathBuf::from(&project_root).join(".kiro").join("prompts");
    if !prompts_dir.exists() {
        return Ok(vec![]);
    }
    let entries = std::fs::read_dir(&prompts_dir)
        .map_err(|e| format!("Failed to read prompts directory: {}", e))?;
    let mut templates = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) == Some("md") {
            let name = path
                .file_stem()
                .and_then(|s| s.to_str())
                .unwrap_or("")
                .to_string();
            if name.is_empty() {
                continue;
            }
            match std::fs::read_to_string(&path) {
                Ok(content) => templates.push(PromptTemplate { name, content }),
                Err(e) => eprintln!("[PromptTemplates] Failed to read {:?}: {}", path, e),
            }
        }
    }
    templates.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(templates)
}

/// Save a prompt template to .kiro/prompts/<name>.md
#[command]
pub async fn save_prompt_template(
    project_root: String,
    name: String,
    content: String,
) -> Result<(), String> {
    if name.is_empty() {
        return Err("Template name cannot be empty".to_string());
    }
    // Sanitize name: only allow alphanumeric, hyphens, underscores
    if !name.chars().all(|c| c.is_alphanumeric() || c == '-' || c == '_') {
        return Err("Template name may only contain letters, numbers, hyphens, and underscores".to_string());
    }
    let prompts_dir = PathBuf::from(&project_root).join(".kiro").join("prompts");
    std::fs::create_dir_all(&prompts_dir)
        .map_err(|e| format!("Failed to create prompts directory: {}", e))?;
    let file_path = prompts_dir.join(format!("{}.md", name));
    std::fs::write(&file_path, &content)
        .map_err(|e| format!("Failed to write template file: {}", e))?;
    Ok(())
}
