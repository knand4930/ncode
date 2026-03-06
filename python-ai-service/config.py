"""
Configuration management for AI Service
"""

import os
from typing import Optional
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    """Service configuration"""
    
    # Server
    grpc_port: int = int(os.getenv("GRPC_PORT", "50051"))
    grpc_host: str = os.getenv("GRPC_HOST", "127.0.0.1")
    
    # Logging
    log_level: str = os.getenv("LOG_LEVEL", "INFO")
    
    # Ollama
    ollama_base_url: str = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434")
    ollama_timeout: int = int(os.getenv("OLLAMA_TIMEOUT", "30"))
    
    # OpenAI
    openai_api_key: Optional[str] = os.getenv("OPENAI_API_KEY")
    openai_timeout: int = int(os.getenv("OPENAI_TIMEOUT", "30"))
    
    # Anthropic
    anthropic_api_key: Optional[str] = os.getenv("ANTHROPIC_API_KEY")
    anthropic_timeout: int = int(os.getenv("ANTHROPIC_TIMEOUT", "30"))
    
    # Groq
    groq_api_key: Optional[str] = os.getenv("GROQ_API_KEY")
    groq_timeout: int = int(os.getenv("GROQ_TIMEOUT", "30"))
    
    # Features
    enable_caching: bool = os.getenv("ENABLE_CACHING", "true").lower() == "true"
    enable_streaming: bool = os.getenv("ENABLE_STREAMING", "true").lower() == "true"
    
    # RAG Configuration
    rag_chunk_size: int = int(os.getenv("RAG_CHUNK_SIZE", "50"))      # Lines per chunk
    rag_overlap: int = int(os.getenv("RAG_OVERLAP", "10"))            # Lines overlap between chunks
    rag_max_chunks: int = int(os.getenv("RAG_MAX_CHUNKS", "20"))      # Max chunks to retrieve
    rag_similarity_threshold: float = float(os.getenv("RAG_SIMILARITY_THRESHOLD", "0.3"))
    
    # Agent Configuration
    agent_max_iterations: int = int(os.getenv("AGENT_MAX_ITERATIONS", "10"))
    agent_reasoning_depth: str = os.getenv("AGENT_REASONING_DEPTH", "detailed")  # "quick", "balanced", "detailed"
    agent_timeout: int = int(os.getenv("AGENT_TIMEOUT", "60"))
    agent_multi_step: bool = os.getenv("AGENT_MULTI_STEP", "true").lower() == "true"
    
    # Model Selection
    default_model_ollama: str = os.getenv("DEFAULT_MODEL_OLLAMA", "mistral")
    default_model_openai: str = os.getenv("DEFAULT_MODEL_OPENAI", "gpt-4")
    default_model_anthropic: str = os.getenv("DEFAULT_MODEL_ANTHROPIC", "claude-3-sonnet-20240229")
    default_model_groq: str = os.getenv("DEFAULT_MODEL_GROQ", "mixtral-8x7b-32768")
    
    # Advanced Features
    enable_code_analysis: bool = os.getenv("ENABLE_CODE_ANALYSIS", "true").lower() == "true"
    enable_issue_detection: bool = os.getenv("ENABLE_ISSUE_DETECTION", "true").lower() == "true"
    enable_reasoning_display: bool = os.getenv("ENABLE_REASONING_DISPLAY", "false").lower() == "true"
    max_reasoning_length: int = int(os.getenv("MAX_REASONING_LENGTH", "2000"))
    
    # Quality Control
    require_sources: bool = os.getenv("REQUIRE_SOURCES", "false").lower() == "true"
    min_confidence: float = float(os.getenv("MIN_CONFIDENCE", "0.5"))
    
    # AirLLM settings (split-model inference for limited RAM)
    airllm_base_url: str = os.getenv("AIRLLM_BASE_URL", "http://localhost:8000")
    airllm_model_path: Optional[str] = os.getenv("AIRLLM_MODEL_PATH")  # e.g., "meta-llama/Llama-2-7b-hf"
    airllm_timeout: int = int(os.getenv("AIRLLM_TIMEOUT", "120"))  # Longer timeout for split-model loading
    
    # vLLM settings (high-throughput batched inference)
    vllm_base_url: str = os.getenv("VLLM_BASE_URL", "http://localhost:8000")
    vllm_api_key: Optional[str] = os.getenv("VLLM_API_KEY")
    vllm_timeout: int = int(os.getenv("VLLM_TIMEOUT", "60"))
    vllm_default_model: Optional[str] = os.getenv("VLLM_DEFAULT_MODEL")  # e.g., "meta-llama/Meta-Llama-3-8B-Instruct"
    
    class Config:
        env_file = ".env"
        case_sensitive = False


# Global config instance
settings = Settings()
