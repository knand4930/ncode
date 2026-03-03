"""
AI Service gRPC Server

This server provides a unified interface for AI/LLM operations:
- Dynamic model discovery from multiple providers (Ollama, OpenAI, Anthropic, Groq)
- Streaming and non-streaming chat completions
- Health checks and status monitoring

Run this server:
    python -m grpc_tools.protoc -I. --python_out=. --grpc_python_out=. ai_service.proto
    python server.py
"""

import asyncio
import logging
from concurrent import futures
import grpc
from typing import AsyncIterator, List, Dict, Optional

import aiohttp
from pydantic import BaseModel

# Import generated protobuf code (after running protoc)
# from ai_service_pb2 import *
# from ai_service_pb2_grpc import *

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Configuration
SERVICE_VERSION = "0.1.0"
GRPC_PORT = 50051

class ModelConfig(BaseModel):
    """Configuration for model access"""
    provider: str
    api_key: Optional[str] = None
    base_url: Optional[str] = None


class ChatMessage(BaseModel):
    """Chat message structure"""
    role: str  # "user", "assistant", "system"
    content: str


class ChatRequest(BaseModel):
    """Chat request structure"""
    model: str
    prompt: str
    history: List[ChatMessage] = []
    provider: str
    api_key: Optional[str] = None
    temperature: float = 0.7
    max_tokens: int = 2000


class LLMProvider:
    """Base class for LLM providers"""
    
    def __init__(self, api_key: Optional[str] = None, base_url: Optional[str] = None):
        self.api_key = api_key
        self.base_url = base_url
        self.session: Optional[aiohttp.ClientSession] = None
    
    async def init(self):
        """Initialize async session"""
        self.session = aiohttp.ClientSession()
    
    async def close(self):
        """Close async session"""
        if self.session:
            await self.session.close()
    
    async def fetch_models(self) -> List[str]:
        """Fetch available models from provider"""
        raise NotImplementedError
    
    async def chat(self, model: str, messages: List[Dict], **kwargs) -> str:
        """Send chat request to provider"""
        raise NotImplementedError
    
    async def stream_chat(self, model: str, messages: List[Dict], **kwargs) -> AsyncIterator[str]:
        """Stream chat tokens from provider"""
        raise NotImplementedError


class OllamaProvider(LLMProvider):
    """Ollama local model provider"""
    
    def __init__(self, base_url: str = "http://localhost:11434"):
        super().__init__(base_url=base_url)
    
    async def fetch_models(self) -> List[str]:
        """Fetch models from Ollama"""
        try:
            if not self.session:
                await self.init()
            
            async with self.session.get(f"{self.base_url}/api/tags") as resp:
                if resp.status == 200:
                    data = await resp.json()
                    return [m["name"] for m in data.get("models", [])]
                else:
                    logger.error(f"Ollama API error: {resp.status}")
                    return []
        except Exception as e:
            logger.error(f"Failed to fetch Ollama models: {e}")
            return []
    
    async def chat(self, model: str, messages: List[Dict], **kwargs) -> str:
        """Send chat request to Ollama"""
        try:
            if not self.session:
                await self.init()
            
            payload = {
                "model": model,
                "messages": messages,
                "stream": False,
            }
            
            async with self.session.post(
                f"{self.base_url}/api/chat",
                json=payload,
            ) as resp:
                if resp.status == 200:
                    data = await resp.json()
                    return data.get("message", {}).get("content", "")
                else:
                    logger.error(f"Ollama chat error: {resp.status}")
                    return ""
        except Exception as e:
            logger.error(f"Ollama chat failed: {e}")
            return ""


class OpenAIProvider(LLMProvider):
    """OpenAI API provider"""
    
    def __init__(self, api_key: str):
        super().__init__(api_key=api_key, base_url="https://api.openai.com/v1")
    
    async def fetch_models(self) -> List[str]:
        """Fetch models from OpenAI API"""
        try:
            if not self.session:
                await self.init()
            
            headers = {"Authorization": f"Bearer {self.api_key}"}
            async with self.session.get(
                f"{self.base_url}/models",
                headers=headers
            ) as resp:
                if resp.status == 200:
                    data = await resp.json()
                    return [m["id"] for m in data.get("data", [])]
                else:
                    logger.error(f"OpenAI API error: {resp.status}")
                    return []
        except Exception as e:
            logger.error(f"Failed to fetch OpenAI models: {e}")
            return []
    
    async def chat(self, model: str, messages: List[Dict], **kwargs) -> str:
        """Send chat request to OpenAI"""
        try:
            if not self.session:
                await self.init()
            
            headers = {"Authorization": f"Bearer {self.api_key}"}
            payload = {
                "model": model,
                "messages": messages,
                "temperature": kwargs.get("temperature", 0.7),
                "max_tokens": kwargs.get("max_tokens", 2000),
            }
            
            async with self.session.post(
                f"{self.base_url}/chat/completions",
                headers=headers,
                json=payload,
            ) as resp:
                if resp.status == 200:
                    data = await resp.json()
                    return data["choices"][0]["message"]["content"]
                else:
                    logger.error(f"OpenAI chat error: {resp.status}")
                    return ""
        except Exception as e:
            logger.error(f"OpenAI chat failed: {e}")
            return ""


class AnthropicProvider(LLMProvider):
    """Anthropic API provider"""
    
    def __init__(self, api_key: str):
        super().__init__(api_key=api_key, base_url="https://api.anthropic.com/v1")
    
    async def fetch_models(self) -> List[str]:
        """Fetch models from Anthropic API"""
        try:
            if not self.session:
                await self.init()
            
            headers = {"x-api-key": self.api_key}
            async with self.session.get(
                f"{self.base_url}/models",
                headers=headers
            ) as resp:
                if resp.status == 200:
                    data = await resp.json()
                    return [m["id"] for m in data.get("data", [])]
                else:
                    logger.error(f"Anthropic API error: {resp.status}")
                    return []
        except Exception as e:
            logger.error(f"Failed to fetch Anthropic models: {e}")
            return []


class GroqProvider(LLMProvider):
    """Groq API provider"""
    
    def __init__(self, api_key: str):
        super().__init__(api_key=api_key, base_url="https://api.groq.com/openai/v1")
    
    async def fetch_models(self) -> List[str]:
        """Fetch models from Groq API"""
        try:
            if not self.session:
                await self.init()
            
            headers = {"Authorization": f"Bearer {self.api_key}"}
            async with self.session.get(
                f"{self.base_url}/models",
                headers=headers
            ) as resp:
                if resp.status == 200:
                    data = await resp.json()
                    return [m["id"] for m in data.get("data", [])]
                else:
                    logger.error(f"Groq API error: {resp.status}")
                    return []
        except Exception as e:
            logger.error(f"Failed to fetch Groq models: {e}")
            return []


class AIServicer:
    """gRPC AI Service implementation"""
    
    def __init__(self):
        self.providers: Dict[str, LLMProvider] = {}
    
    async def initialize_providers(self):
        """Initialize all provider instances"""
        logger.info("Initializing AI service providers...")
        # Note: For now, providers are initialized on-demand
        # In production, you might pre-warm connections here
    
    def get_provider(self, provider: str, api_key: Optional[str], base_url: Optional[str]) -> LLMProvider:
        """Get or create provider instance"""
        if provider == "ollama":
            return OllamaProvider(base_url or "http://localhost:11434")
        elif provider == "openai":
            return OpenAIProvider(api_key)
        elif provider == "anthropic":
            return AnthropicProvider(api_key)
        elif provider == "groq":
            return GroqProvider(api_key)
        else:
            raise ValueError(f"Unknown provider: {provider}")
    
    async def fetch_models(self, provider: str, api_key: Optional[str], base_url: Optional[str]) -> List[str]:
        """Fetch models from provider"""
        try:
            prov = self.get_provider(provider, api_key, base_url)
            await prov.init()
            models = await prov.fetch_models()
            await prov.close()
            return models
        except Exception as e:
            logger.error(f"Failed to fetch models from {provider}: {e}")
            return []


async def run_server():
    """Run the gRPC server"""
    servicer = AIServicer()
    await servicer.initialize_providers()
    
    server = grpc.aio.server(
        futures.ThreadPoolExecutor(max_workers=10)
    )
    
    # Register service (when protobuf code is available)
    # ai_service_pb2_grpc.add_AIServiceServicer_to_server(
    #     AIServicer(), server
    # )
    
    server.add_insecure_port(f"[::]:{GRPC_PORT}")
    logger.info(f"Starting AI Service gRPC server on port {GRPC_PORT}")
    logger.info(f"Service version: {SERVICE_VERSION}")
    
    await server.start()
    await server.wait_for_termination()


if __name__ == "__main__":
    try:
        # First, generate protobuf code:
        # python -m grpc_tools.protoc -I. --python_out=. --grpc_python_out=. ai_service.proto
        
        logger.info("=" * 60)
        logger.info("NCode AI Service - gRPC Server")
        logger.info("=" * 60)
        logger.info(f"Version: {SERVICE_VERSION}")
        logger.info("")
        logger.info("IMPORTANT: Before running this server, generate the protobuf code:")
        logger.info("")
        logger.info("  python -m pip install -r requirements.txt")
        logger.info("  python -m grpc_tools.protoc -I. --python_out=. --grpc_python_out=. ai_service.proto")
        logger.info("")
        logger.info("Then run the server with:")
        logger.info("  python server.py")
        logger.info("=" * 60)
        
        asyncio.run(run_server())
    except KeyboardInterrupt:
        logger.info("Server shutdown requested")
    except Exception as e:
        logger.error(f"Server error: {e}", exc_info=True)
