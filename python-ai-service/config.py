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
    
    class Config:
        env_file = ".env"
        case_sensitive = False


# Global config instance
settings = Settings()
