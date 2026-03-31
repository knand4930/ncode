// Rust gRPC Client for AI Service
// Communicates with Python gRPC server

use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tokio::sync::Mutex;
use tonic::transport::Channel;

// Include the generated protobuf code
pub mod ai_service {
    tonic::include_proto!("ai_service");
}

use ai_service::{
    ai_service_client::AiServiceClient,
    ChatRequest as ProtoChatRequest,
    Message as ProtoMessage,
    FetchModelsRequest,
    HealthRequest,
    TurboQuantRequest,
    TurboQuantListRequest,
    TurboQuantDeleteRequest,
    HfSearchRequest,
    HfDownloadRequest,
    HfLocalListRequest,
    HfLocalDeleteRequest,
};

#[derive(Clone)]
pub struct GrpcAiClient {
    inner: Arc<Mutex<Option<AiServiceClient<Channel>>>>,
    grpc_host: String,
    grpc_port: u16,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ChatMessage {
    pub role: String,
    pub content: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ChatResponse {
    pub content: String,
    pub tokens_used: i32,
    pub model: String,
}

#[derive(Debug)]
pub enum GrpcError {
    ConnectionError(String),
    RequestError(String),
}

impl std::fmt::Display for GrpcError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            GrpcError::ConnectionError(e) => write!(f, "Connection error: {}", e),
            GrpcError::RequestError(e) => write!(f, "Request error: {}", e),
        }
    }
}

impl std::error::Error for GrpcError {}

impl GrpcAiClient {
    /// Create a new gRPC client
    pub fn new(host: impl Into<String>, port: u16) -> Self {
        Self {
            inner: Arc::new(Mutex::new(None)),
            grpc_host: host.into(),
            grpc_port: port,
        }
    }

    /// Create a new client with defaults (127.0.0.1:50051)
    pub fn default_client() -> Self {
        Self::new("127.0.0.1", 50051)
    }

    /// Connect to the gRPC server
    pub async fn connect(&self) -> Result<(), GrpcError> {
        let addr = format!("http://{}:{}", self.grpc_host, self.grpc_port);
        
        let channel = Channel::from_shared(addr.clone())
            .map_err(|e| GrpcError::ConnectionError(e.to_string()))?
            .connect()
            .await
            .map_err(|e| GrpcError::ConnectionError(e.to_string()))?;

        let client = AiServiceClient::new(channel);
        let mut inner = self.inner.lock().await;
        *inner = Some(client);

        Ok(())
    }

    /// Check connection status
    pub async fn is_connected(&self) -> bool {
        self.inner.lock().await.is_some()
    }

    /// Health check
    pub async fn health_check(&self) -> Result<bool, GrpcError> {
        if !self.is_connected().await {
            self.connect().await?;
        }

        let mut inner = self.inner.lock().await;
        if let Some(client) = inner.as_mut() {
            let request = tonic::Request::new(HealthRequest {});
            match client.health(request).await {
                Ok(response) => {
                    let health_resp = response.into_inner();
                    Ok(health_resp.status == "healthy")
                }
                Err(e) => Err(GrpcError::RequestError(e.to_string())),
            }
        } else {
            Err(GrpcError::ConnectionError("Not connected".to_string()))
        }
    }

    /// Send a chat request to the gRPC service
    pub async fn chat(
        &self,
        model: impl Into<String>,
        prompt: impl Into<String>,
        history: Vec<ChatMessage>,
        provider: impl Into<String>,
        api_key: Option<String>,
        temperature: Option<f32>,
        max_tokens: Option<i32>,
        base_url: String,
    ) -> Result<ChatResponse, GrpcError> {
        if !self.is_connected().await {
            self.connect().await?;
        }

        let proto_messages: Vec<ProtoMessage> = history
            .into_iter()
            .map(|msg| ProtoMessage {
                role: msg.role,
                content: msg.content,
            })
            .collect();

        let request = ProtoChatRequest {
            model: model.into(),
            prompt: prompt.into(),
            history: proto_messages,
            provider: provider.into(),
            api_key: api_key.unwrap_or_default(),
            temperature: temperature.unwrap_or(0.7),
            max_tokens: max_tokens.unwrap_or(2000),
            base_url,
        };

        let mut inner = self.inner.lock().await;
        if let Some(client) = inner.as_mut() {
            let tonic_request = tonic::Request::new(request);
            match client.chat(tonic_request).await {
                Ok(response) => {
                    let chat_resp = response.into_inner();
                    Ok(ChatResponse {
                        content: chat_resp.content,
                        tokens_used: chat_resp.tokens_used,
                        model: chat_resp.model,
                    })
                }
                Err(e) => Err(GrpcError::RequestError(e.to_string())),
            }
        } else {
            Err(GrpcError::ConnectionError("Not connected".to_string()))
        }
    }

    /// Fetch available models from provider
    pub async fn fetch_models(
        &self,
        provider: impl Into<String>,
        api_key: Option<String>,
        base_url: Option<String>,
    ) -> Result<Vec<String>, GrpcError> {
        if !self.is_connected().await {
            self.connect().await?;
        }

        let request = FetchModelsRequest {
            provider: provider.into(),
            api_key: api_key.unwrap_or_default(),
            base_url: base_url.unwrap_or_default(),
        };

        let mut inner = self.inner.lock().await;
        if let Some(client) = inner.as_mut() {
            let tonic_request = tonic::Request::new(request);
            match client.fetch_models(tonic_request).await {
                Ok(response) => {
                    let models_resp = response.into_inner();
                    if !models_resp.error.is_empty() {
                        return Err(GrpcError::RequestError(models_resp.error));
                    }
                    Ok(models_resp.models)
                }
                Err(e) => Err(GrpcError::RequestError(e.to_string())),
            }
        } else {
            Err(GrpcError::ConnectionError("Not connected".to_string()))
        }
    }

    /// Stream chat tokens (for real-time response)
    pub async fn stream_chat(
        &self,
        app: &tauri::AppHandle,
        message_id: String,
        model: impl Into<String>,
        messages: Vec<ChatMessage>,
        provider: impl Into<String>,
        api_key: Option<String>,
        temperature: Option<f32>,
        max_tokens: Option<i32>,
        base_url: String,
    ) -> Result<(), GrpcError> {
        use tauri::Emitter;

        if !self.is_connected().await {
            self.connect().await?;
        }

        let proto_messages: Vec<ProtoMessage> = messages
            .into_iter()
            .map(|msg| ProtoMessage {
                role: msg.role,
                content: msg.content,
            })
            .collect();

        // StreamChat uses the same ChatRequest as Chat
        let request = ProtoChatRequest {
            model: model.into(),
            prompt: String::new(),
            history: proto_messages,
            provider: provider.into(),
            api_key: api_key.unwrap_or_default(),
            temperature: temperature.unwrap_or(0.7),
            max_tokens: max_tokens.unwrap_or(2000),
            base_url,
        };

        #[derive(Clone, serde::Serialize)]
        struct StreamTokenPayload {
            #[serde(rename = "messageId")]
            message_id: String,
            token: String,
        }

        #[derive(Clone, serde::Serialize)]
        struct StreamDonePayload {
            #[serde(rename = "messageId")]
            message_id: String,
        }

        #[derive(Clone, serde::Serialize)]
        struct StreamErrorPayload {
            #[serde(rename = "messageId")]
            message_id: String,
            error: String,
        }

        let mut inner = self.inner.lock().await;
        if let Some(client) = inner.as_mut() {
            let tonic_request = tonic::Request::new(request);
            match client.stream_chat(tonic_request).await {
                Ok(response) => {
                    let mut stream = response.into_inner();
                    loop {
                        match stream.message().await {
                            Ok(Some(token_resp)) => {
                                if !token_resp.token.is_empty() {
                                    let _ = app.emit("ai-stream-token", StreamTokenPayload {
                                        message_id: message_id.clone(),
                                        token: token_resp.token,
                                    });
                                }
                                if token_resp.done {
                                    break;
                                }
                            }
                            Ok(None) => break,
                            Err(e) => {
                                let _ = app.emit("ai-stream-error", StreamErrorPayload {
                                    message_id: message_id.clone(),
                                    error: e.to_string(),
                                });
                                return Err(GrpcError::RequestError(e.to_string()));
                            }
                        }
                    }
                    let _ = app.emit("ai-stream-done", StreamDonePayload { message_id });
                    Ok(())
                }
                Err(e) => {
                    let _ = app.emit("ai-stream-error", StreamErrorPayload {
                        message_id: message_id.clone(),
                        error: e.to_string(),
                    });
                    Err(GrpcError::RequestError(e.to_string()))
                }
            }
        } else {
            Err(GrpcError::ConnectionError("Not connected".to_string()))
        }
    }

    /// Start TurboQuant quantization, streaming progress events
    pub async fn turbo_quant_start(
        &self,
        app: &tauri::AppHandle,
        model_id: String,
        method: String,
        bits: i32,
    ) -> Result<(), GrpcError> {
        use tauri::Emitter;

        if !self.is_connected().await {
            self.connect().await?;
        }

        let request = TurboQuantRequest { model_id, method, bits };

        #[derive(Clone, serde::Serialize)]
        struct ProgressPayload {
            percent: i32,
            stage: String,
            message: String,
        }

        #[derive(Clone, serde::Serialize)]
        struct DonePayload {
            #[serde(rename = "localPath")]
            local_path: String,
            #[serde(rename = "ollamaName")]
            ollama_name: String,
        }

        #[derive(Clone, serde::Serialize)]
        struct ErrorPayload {
            error: String,
        }

        let mut inner = self.inner.lock().await;
        if let Some(client) = inner.as_mut() {
            let tonic_request = tonic::Request::new(request);
            match client.turbo_quant_start(tonic_request).await {
                Ok(response) => {
                    let mut stream = response.into_inner();
                    loop {
                        match stream.message().await {
                            Ok(Some(progress)) => {
                                if !progress.error.is_empty() {
                                    let _ = app.emit("turbo-quant-error", ErrorPayload {
                                        error: progress.error,
                                    });
                                    return Err(GrpcError::RequestError("TurboQuant error".to_string()));
                                }
                                let _ = app.emit("turbo-quant-progress", ProgressPayload {
                                    percent: progress.percent,
                                    stage: progress.stage.clone(),
                                    message: progress.message.clone(),
                                });
                                if progress.done {
                                    let _ = app.emit("turbo-quant-done", DonePayload {
                                        local_path: progress.local_path,
                                        ollama_name: progress.ollama_name,
                                    });
                                    break;
                                }
                            }
                            Ok(None) => break,
                            Err(e) => {
                                let _ = app.emit("turbo-quant-error", ErrorPayload {
                                    error: e.to_string(),
                                });
                                return Err(GrpcError::RequestError(e.to_string()));
                            }
                        }
                    }
                    Ok(())
                }
                Err(e) => {
                    let _ = app.emit("turbo-quant-error", ErrorPayload { error: e.to_string() });
                    Err(GrpcError::RequestError(e.to_string()))
                }
            }
        } else {
            Err(GrpcError::ConnectionError("Not connected".to_string()))
        }
    }

    /// List all quantized models in the cache
    pub async fn turbo_quant_list(&self) -> Result<Vec<serde_json::Value>, GrpcError> {
        if !self.is_connected().await {
            self.connect().await?;
        }

        let request = TurboQuantListRequest {};
        let mut inner = self.inner.lock().await;
        if let Some(client) = inner.as_mut() {
            let tonic_request = tonic::Request::new(request);
            match client.turbo_quant_list(tonic_request).await {
                Ok(response) => {
                    let list_resp = response.into_inner();
                    let models = list_resp.models.into_iter().map(|m| {
                        serde_json::json!({
                            "modelId": m.model_id,
                            "method": m.method,
                            "bits": m.bits,
                            "sizeMb": m.size_mb,
                            "localPath": m.local_path,
                            "createdAt": m.created_at,
                            "ollamaName": m.ollama_name,
                        })
                    }).collect();
                    Ok(models)
                }
                Err(e) => Err(GrpcError::RequestError(e.to_string())),
            }
        } else {
            Err(GrpcError::ConnectionError("Not connected".to_string()))
        }
    }

    /// Delete a quantized model from the cache
    pub async fn turbo_quant_delete(
        &self,
        model_id: String,
        method: String,
        bits: i32,
    ) -> Result<(), GrpcError> {
        if !self.is_connected().await {
            self.connect().await?;
        }

        let request = TurboQuantDeleteRequest { model_id, method, bits };
        let mut inner = self.inner.lock().await;
        if let Some(client) = inner.as_mut() {
            let tonic_request = tonic::Request::new(request);
            match client.turbo_quant_delete(tonic_request).await {
                Ok(response) => {
                    let del_resp = response.into_inner();
                    if !del_resp.success {
                        return Err(GrpcError::RequestError(del_resp.error));
                    }
                    Ok(())
                }
                Err(e) => Err(GrpcError::RequestError(e.to_string())),
            }
        } else {
            Err(GrpcError::ConnectionError("Not connected".to_string()))
        }
    }

    /// Search HuggingFace Hub for models
    pub async fn hf_search(
        &self,
        query: String,
        task: String,
        limit: i32,
        max_size_gb: f32,
        hf_token: String,
    ) -> Result<Vec<serde_json::Value>, GrpcError> {
        if !self.is_connected().await {
            self.connect().await?;
        }

        let request = HfSearchRequest { query, task, limit, max_size_gb, hf_token };
        let mut inner = self.inner.lock().await;
        if let Some(client) = inner.as_mut() {
            let tonic_request = tonic::Request::new(request);
            match client.hf_search(tonic_request).await {
                Ok(response) => {
                    let resp = response.into_inner();
                    if !resp.error.is_empty() {
                        return Err(GrpcError::RequestError(resp.error));
                    }
                    let models: Vec<serde_json::Value> = resp.models.into_iter().map(|m| {
                        serde_json::json!({
                            "modelId": m.model_id,
                            "downloads": m.downloads,
                            "likes": m.likes,
                            "sizeBytes": m.size_bytes,
                            "license": m.license,
                            "tags": m.tags,
                            "gated": m.gated,
                            "description": m.description,
                        })
                    }).collect();
                    Ok(models)
                }
                Err(e) => Err(GrpcError::RequestError(e.to_string())),
            }
        } else {
            Err(GrpcError::ConnectionError("Not connected".to_string()))
        }
    }

    /// Download a model from HuggingFace Hub, streaming progress events
    pub async fn hf_download(
        &self,
        app: &tauri::AppHandle,
        model_id: String,
        hf_token: String,
    ) -> Result<(), GrpcError> {
        use tauri::Emitter;

        if !self.is_connected().await {
            self.connect().await?;
        }

        let request = HfDownloadRequest { model_id: model_id.clone(), hf_token };

        #[derive(Clone, serde::Serialize)]
        struct ProgressPayload {
            #[serde(rename = "modelId")]
            model_id: String,
            #[serde(rename = "bytesDone")]
            bytes_done: i64,
            #[serde(rename = "bytesTotal")]
            bytes_total: i64,
            #[serde(rename = "speedBps")]
            speed_bps: i64,
            done: bool,
            error: String,
            #[serde(rename = "localPath")]
            local_path: String,
        }

        #[derive(Clone, serde::Serialize)]
        struct DonePayload {
            #[serde(rename = "modelId")]
            model_id: String,
            #[serde(rename = "localPath")]
            local_path: String,
        }

        #[derive(Clone, serde::Serialize)]
        struct ErrorPayload {
            #[serde(rename = "modelId")]
            model_id: String,
            error: String,
        }

        let mut inner = self.inner.lock().await;
        if let Some(client) = inner.as_mut() {
            let tonic_request = tonic::Request::new(request);
            match client.hf_download(tonic_request).await {
                Ok(response) => {
                    let mut stream = response.into_inner();
                    loop {
                        match stream.message().await {
                            Ok(Some(progress)) => {
                                let _ = app.emit("hf-download-progress", ProgressPayload {
                                    model_id: progress.model_id.clone(),
                                    bytes_done: progress.bytes_done,
                                    bytes_total: progress.bytes_total,
                                    speed_bps: progress.speed_bps,
                                    done: progress.done,
                                    error: progress.error.clone(),
                                    local_path: progress.local_path.clone(),
                                });
                                if !progress.error.is_empty() {
                                    let _ = app.emit("hf-download-error", ErrorPayload {
                                        model_id: progress.model_id,
                                        error: progress.error,
                                    });
                                    return Err(GrpcError::RequestError("HF download error".to_string()));
                                }
                                if progress.done {
                                    let _ = app.emit("hf-download-done", DonePayload {
                                        model_id: progress.model_id,
                                        local_path: progress.local_path,
                                    });
                                    break;
                                }
                            }
                            Ok(None) => break,
                            Err(e) => {
                                let _ = app.emit("hf-download-error", ErrorPayload {
                                    model_id: model_id.clone(),
                                    error: e.to_string(),
                                });
                                return Err(GrpcError::RequestError(e.to_string()));
                            }
                        }
                    }
                    Ok(())
                }
                Err(e) => {
                    let _ = app.emit("hf-download-error", ErrorPayload {
                        model_id: model_id.clone(),
                        error: e.to_string(),
                    });
                    Err(GrpcError::RequestError(e.to_string()))
                }
            }
        } else {
            Err(GrpcError::ConnectionError("Not connected".to_string()))
        }
    }

    /// List locally downloaded HF models
    pub async fn hf_local_list(&self) -> Result<Vec<serde_json::Value>, GrpcError> {
        if !self.is_connected().await {
            self.connect().await?;
        }

        let request = HfLocalListRequest {};
        let mut inner = self.inner.lock().await;
        if let Some(client) = inner.as_mut() {
            let tonic_request = tonic::Request::new(request);
            match client.hf_local_list(tonic_request).await {
                Ok(response) => {
                    let resp = response.into_inner();
                    let models: Vec<serde_json::Value> = resp.models.into_iter().map(|m| {
                        serde_json::json!({
                            "modelId": m.model_id,
                            "localPath": m.local_path,
                            "sizeBytes": m.size_bytes,
                            "downloadedAt": m.downloaded_at,
                            "quantizedPath": m.quantized_path,
                            "quantizedMethod": m.quantized_method,
                            "quantizedBits": m.quantized_bits,
                        })
                    }).collect();
                    Ok(models)
                }
                Err(e) => Err(GrpcError::RequestError(e.to_string())),
            }
        } else {
            Err(GrpcError::ConnectionError("Not connected".to_string()))
        }
    }

    /// Delete a locally downloaded HF model
    pub async fn hf_local_delete(&self, model_id: String) -> Result<(), GrpcError> {
        if !self.is_connected().await {
            self.connect().await?;
        }

        let request = HfLocalDeleteRequest { model_id };
        let mut inner = self.inner.lock().await;
        if let Some(client) = inner.as_mut() {
            let tonic_request = tonic::Request::new(request);
            match client.hf_local_delete(tonic_request).await {
                Ok(response) => {
                    let del_resp = response.into_inner();
                    if !del_resp.success {
                        return Err(GrpcError::RequestError(del_resp.error));
                    }
                    Ok(())
                }
                Err(e) => Err(GrpcError::RequestError(e.to_string())),
            }
        } else {
            Err(GrpcError::ConnectionError("Not connected".to_string()))
        }
    }

    /// Disconnect from the gRPC server
    pub async fn disconnect(&self) {
        let mut inner = self.inner.lock().await;
        *inner = None;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_client_creation() {
        let client = GrpcAiClient::new("127.0.0.1", 50051);
        assert!(!client.is_connected().await);
    }

    #[tokio::test]
    async fn test_default_client() {
        let client = GrpcAiClient::default_client();
        assert!(!client.is_connected().await);
    }
}
