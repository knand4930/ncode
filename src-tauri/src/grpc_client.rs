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
    DecodingError(String),
}

impl std::fmt::Display for GrpcError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            GrpcError::ConnectionError(e) => write!(f, "Connection error: {}", e),
            GrpcError::RequestError(e) => write!(f, "Request error: {}", e),
            GrpcError::DecodingError(e) => write!(f, "Decoding error: {}", e),
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
        model: impl Into<String>,
        prompt: impl Into<String>,
        history: Vec<ChatMessage>,
        provider: impl Into<String>,
        api_key: Option<String>,
        temperature: Option<f32>,
        max_tokens: Option<i32>,
    ) -> Result<impl futures::Stream<Item = Result<String, GrpcError>>, GrpcError> {
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
        };

        let mut inner = self.inner.lock().await;
        if let Some(client) = inner.as_mut() {
            let tonic_request = tonic::Request::new(request);
            match client.stream_chat(tonic_request).await {
                Ok(response) => {
                    let mut stream = response.into_inner();
                    // Convert to our stream type
                    let stream = async_stream::stream! {
                        while let Some(result) = stream.message().await.transpose() {
                            match result {
                                Ok(token_resp) => {
                                    yield Ok::<String, GrpcError>(token_resp.token);
                                }
                                Err(e) => {
                                    yield Err::<String, GrpcError>(GrpcError::RequestError(e.to_string()));
                                    break;
                                }
                            }
                        }
                    };
                    Ok(stream)
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
