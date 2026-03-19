from __future__ import annotations

"""
AI Service gRPC Server

This server provides a unified interface for AI/LLM operations:
- Dynamic model discovery from multiple providers (Ollama, OpenAI, Anthropic, Groq)
- Streaming and non-streaming chat completions
- Health checks and status monitoring

Run this server:
    python3 -m grpc_tools.protoc -I. --python_out=. --grpc_python_out=. ai_service.proto
    python3 server.py
"""

import asyncio
import json
import logging
import os
import sys
import time
from concurrent import futures
from typing import AsyncIterator, List, Dict, Optional

try:
    import aiohttp
    AIOHTTP_AVAILABLE = True
except ImportError:
    aiohttp = None
    AIOHTTP_AVAILABLE = False

try:
    from pydantic import BaseModel
    PYDANTIC_AVAILABLE = True
except ImportError:
    PYDANTIC_AVAILABLE = False

    class BaseModel:  # type: ignore[no-redef]
        pass

try:
    import grpc
    GRPC_AVAILABLE = True
except ImportError as grpc_import_error:
    grpc = None
    GRPC_AVAILABLE = False

CORE_DEPS_AVAILABLE = AIOHTTP_AVAILABLE and PYDANTIC_AVAILABLE

# Import AI modules for advanced reasoning and RAG
try:
    from config import Settings
    from prompts import get_system_prompt, SYSTEM_PROMPTS, AIMode, ISSUE_DETECTION_PROMPT
    from reasoning import IssueDetector, ConfidenceScorer, ResponseValidator
    from rag_advanced import AdvancedCodeChunker, SmartRetriever, ContextBuilder
    MODULES_AVAILABLE = True
except ImportError as e:
    MODULES_AVAILABLE = False
    # Logging will be set up below

# Import generated protobuf code (after running protoc)
try:
    from ai_service_pb2 import (
        ChatRequest as PBChatRequest,
        ChatResponse,
        TokenResponse,
        FetchModelsRequest,
        FetchModelsResponse,
        HealthRequest,
        HealthResponse,
        Message,
    )
    from ai_service_pb2_grpc import AIServiceServicer, add_AIServiceServicer_to_server
    PROTOBUF_AVAILABLE = True
except ImportError:
    PROTOBUF_AVAILABLE = False

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

if not MODULES_AVAILABLE:
    logger.warning("Advanced AI modules not available: config.py, prompts.py, reasoning.py, rag_advanced.py")

if not CORE_DEPS_AVAILABLE:
    logger.warning("Missing Python dependencies (aiohttp/pydantic). Install with: python3 -m pip install -r requirements.txt")

if not GRPC_AVAILABLE:
    logger.warning("grpcio is not installed. Install dependencies with: python3 -m pip install -r requirements.txt")

if not PROTOBUF_AVAILABLE:
    logger.warning("Protobuf code not generated yet. Run: python3 -m grpc_tools.protoc -I. --python_out=. --grpc_python_out=. ai_service.proto")

# Configuration
SERVICE_VERSION = "0.1.0"
GRPC_HOST = os.getenv("GRPC_HOST", "127.0.0.1")
GRPC_PORT = int(os.getenv("GRPC_PORT", "50051"))

# ============================================================================
# PROMPT TEMPLATE LOADER (Tasks 6.1 - 6.4)
# ============================================================================

class PromptTemplateLoader:
    """Loads and watches .kiro/prompts/*.md files, reloading within 5 seconds of changes."""

    MAX_TEMPLATE_CHARS = 8000
    POLL_INTERVAL = 5  # seconds

    def __init__(self, prompts_dir: str):
        self.prompts_dir = prompts_dir
        self._templates: Dict[str, str] = {}
        self._mtimes: Dict[str, float] = {}
        self._watcher_task: Optional[asyncio.Task] = None

    def load_all(self) -> None:
        """Scan and load all .md files from the prompts directory at startup."""
        if not os.path.isdir(self.prompts_dir):
            logger.info(f"[PromptTemplates] Directory not found: {self.prompts_dir}")
            return
        for fname in os.listdir(self.prompts_dir):
            if fname.endswith(".md"):
                self._load_file(fname)

    def _load_file(self, fname: str) -> None:
        """Load a single template file, validating UTF-8 and size."""
        fpath = os.path.join(self.prompts_dir, fname)
        stem = fname[:-3]  # strip .md
        try:
            with open(fpath, "rb") as f:
                raw = f.read()
            try:
                content = raw.decode("utf-8")
            except UnicodeDecodeError:
                logger.warning(f"[PromptTemplates] WARNING: Skipping {fname}: invalid UTF-8")
                return
            if len(content) > self.MAX_TEMPLATE_CHARS:
                logger.warning(
                    f"[PromptTemplates] WARNING: Skipping {fname}: "
                    f"file is {len(content)} chars (max {self.MAX_TEMPLATE_CHARS})"
                )
                return
            self._templates[stem] = content
            self._mtimes[fname] = os.path.getmtime(fpath)
            logger.info(f"[PromptTemplates] Loaded template: {stem}")
        except FileNotFoundError:
            pass
        except Exception as e:
            logger.warning(f"[PromptTemplates] WARNING: Skipping {fname}: {e}")

    def get(self, name: str) -> Optional[str]:
        """Return a loaded template by stem name, or None if not loaded."""
        return self._templates.get(name)

    def get_system_prompt(self, mode: str) -> str:
        """
        Resolve system prompt for a mode using the template resolution order:
        1. default.md prepended (if present)
        2. <mode>.md overrides built-in (if present)
        3. Built-in SYSTEM_PROMPTS[mode] as fallback
        """
        parts: List[str] = []
        default_tpl = self._templates.get("default")
        if default_tpl:
            parts.append(default_tpl)

        mode_tpl = self._templates.get(mode)
        if mode_tpl:
            parts.append(mode_tpl)
            return "\n\n".join(parts)

        # Fall back to built-in
        if MODULES_AVAILABLE:
            builtin = get_system_prompt(mode)
        else:
            builtin = "You are a helpful AI assistant."
        parts.append(builtin)
        return "\n\n".join(parts)

    async def _watch_loop(self) -> None:
        """Periodically poll the prompts directory for changes."""
        while True:
            await asyncio.sleep(self.POLL_INTERVAL)
            if not os.path.isdir(self.prompts_dir):
                continue
            try:
                current_files = {f for f in os.listdir(self.prompts_dir) if f.endswith(".md")}
                for fname in current_files:
                    fpath = os.path.join(self.prompts_dir, fname)
                    try:
                        mtime = os.path.getmtime(fpath)
                    except OSError:
                        continue
                    if self._mtimes.get(fname) != mtime:
                        logger.info(f"[PromptTemplates] Reloading changed template: {fname}")
                        self._load_file(fname)
            except Exception as e:
                logger.warning(f"[PromptTemplates] Watch loop error: {e}")

    def start_watcher(self) -> None:
        """Start the background asyncio polling task."""
        try:
            loop = asyncio.get_event_loop()
            self._watcher_task = loop.create_task(self._watch_loop())
        except RuntimeError:
            pass  # No running event loop yet; watcher will be started later


# Global template loader — initialized in run_server() with the project root
_template_loader: Optional[PromptTemplateLoader] = None


def _get_template_loader() -> Optional[PromptTemplateLoader]:
    return _template_loader

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

    def _messages_to_prompt(self, messages: List[Dict]) -> str:
        """Convert role-based chat messages into a single prompt for /api/generate fallback."""
        parts: List[str] = []
        for msg in messages:
            role = str(msg.get("role", "user")).lower().strip()
            content = str(msg.get("content", "")).strip()
            if not content:
                continue
            if role == "system":
                label = "System"
            elif role == "assistant":
                label = "Assistant"
            else:
                label = "User"
            parts.append(f"{label}:\n{content}")
        parts.append("Assistant:")
        return "\n\n".join(parts)

    async def _chat_via_generate(self, model: str, messages: List[Dict], **kwargs) -> str:
        """Fallback for endpoints that expose /api/generate but not /api/chat."""
        if not self.session:
            await self.init()
        payload = {
            "model": model,
            "prompt": self._messages_to_prompt(messages),
            "stream": False,
            "options": {
                "temperature": kwargs.get("temperature", 0.7),
                "num_predict": kwargs.get("max_tokens", 2000),
            },
        }
        async with self.session.post(
            f"{self.base_url}/api/generate",
            json=payload,
        ) as resp:
            if resp.status == 200:
                data = await resp.json()
                return data.get("response", "")
            if resp.status == 404:
                logger.warning(f"Ollama /api/generate returned 404 for model '{model}', trying OpenAI-compatible /v1/chat/completions")
                return await self._chat_via_openai_compat(model, messages, **kwargs)
            body = await resp.text()
            if "not found" in body.lower() or "does not exist" in body.lower():
                available = await self.fetch_models()
                raise RuntimeError(
                    f"Model '{model}' not found on Ollama. "
                    f"Available models: {available or ['none']}. "
                    f"Run: ollama pull {model}"
                )
            logger.error(f"Ollama generate fallback error {resp.status}: {body[:300]}")
            return ""

    async def _chat_via_openai_compat(self, model: str, messages: List[Dict], **kwargs) -> str:
        """Fallback for local servers exposing OpenAI-compatible APIs."""
        if not self.session:
            await self.init()
        payload = {
            "model": model,
            "messages": messages,
            "temperature": kwargs.get("temperature", 0.7),
            "max_tokens": kwargs.get("max_tokens", 2000),
            "stream": False,
        }
        async with self.session.post(
            f"{self.base_url}/v1/chat/completions",
            json=payload,
        ) as resp:
            if resp.status == 200:
                data = await resp.json()
                choices = data.get("choices", [])
                if choices:
                    return choices[0].get("message", {}).get("content", "")
                return ""
            body = await resp.text()
            logger.error(f"OpenAI-compat fallback error {resp.status}: {body[:300]}")
            return ""
    
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
                if resp.status == 404:
                    logger.warning(f"Ollama /api/chat returned 404 for model '{model}', falling back to /api/generate")
                    return await self._chat_via_generate(model, messages, **kwargs)
                else:
                    body = await resp.text()
                    # Check if it's a model-not-found error and provide helpful message
                    if "not found" in body.lower() or "does not exist" in body.lower():
                        available = await self.fetch_models()
                        raise RuntimeError(
                            f"Model '{model}' not found on Ollama. "
                            f"Available models: {available or ['none — run: ollama pull <model>']}. "
                            f"Run: ollama pull {model}"
                        )
                    logger.error(f"Ollama chat error {resp.status}: {body[:300]}")
                    return ""
        except RuntimeError:
            raise
        except Exception as e:
            logger.error(f"Ollama chat failed: {e}")
            return ""
    
    async def stream_chat(self, model: str, messages: List[Dict], **kwargs) -> AsyncIterator[str]:
        """Stream chat tokens from Ollama"""
        try:
            if not self.session:
                await self.init()
            
            payload = {
                "model": model,
                "messages": messages,
                "stream": True,
            }
            
            async with self.session.post(
                f"{self.base_url}/api/chat",
                json=payload,
            ) as resp:
                if resp.status == 200:
                    async for line in resp.content:
                        if line:
                            data = json.loads(line)
                            if "message" in data and "content" in data["message"]:
                                yield data["message"]["content"]
                elif resp.status == 404:
                    logger.warning("Ollama stream /api/chat returned 404, falling back to non-stream /api/generate")
                    text = await self._chat_via_generate(model, messages, **kwargs)
                    if text:
                        yield text
                else:
                    body = await resp.text()
                    logger.error(f"Ollama stream chat error {resp.status}: {body[:300]}")
        except Exception as e:
            logger.error(f"Ollama stream chat failed: {e}")


class OpenAIProvider(LLMProvider):
    """OpenAI API provider"""
    
    def __init__(self, api_key: Optional[str]):
        if not api_key:
            raise ValueError("OpenAI API key is required")
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
                body = await resp.text()
                raise RuntimeError(f"OpenAI API error {resp.status}: {body[:300]}")
        except Exception as e:
            logger.error(f"Failed to fetch OpenAI models: {e}")
            raise
    
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
                body = await resp.text()
                raise RuntimeError(f"OpenAI chat error {resp.status}: {body[:300]}")
        except Exception as e:
            logger.error(f"OpenAI chat failed: {e}")
            raise

    async def stream_chat(self, model: str, messages: List[Dict], **kwargs) -> AsyncIterator[str]:
        """Fallback streaming for providers without token stream implementation"""
        text = await self.chat(model, messages, **kwargs)
        if text:
            yield text


class AnthropicProvider(LLMProvider):
    """Anthropic API provider"""
    
    def __init__(self, api_key: Optional[str]):
        if not api_key:
            raise ValueError("Anthropic API key is required")
        super().__init__(api_key=api_key, base_url="https://api.anthropic.com/v1")
    
    async def fetch_models(self) -> List[str]:
        """Fetch models from Anthropic API"""
        try:
            if not self.session:
                await self.init()
            
            headers = {
                "x-api-key": self.api_key,
                "anthropic-version": "2023-06-01",
            }
            async with self.session.get(
                f"{self.base_url}/models",
                headers=headers
            ) as resp:
                if resp.status == 200:
                    data = await resp.json()
                    return [m["id"] for m in data.get("data", [])]
                body = await resp.text()
                raise RuntimeError(f"Anthropic API error {resp.status}: {body[:300]}")
        except Exception as e:
            logger.error(f"Failed to fetch Anthropic models: {e}")
            raise

    async def chat(self, model: str, messages: List[Dict], **kwargs) -> str:
        """Send chat request to Anthropic"""
        try:
            if not self.session:
                await self.init()

            system_parts: List[str] = []
            anthropic_messages: List[Dict] = []
            for msg in messages:
                role = msg.get("role", "user")
                content = msg.get("content", "")
                if role == "system":
                    if content:
                        system_parts.append(content)
                    continue
                if role not in ("user", "assistant"):
                    role = "user"
                anthropic_messages.append({"role": role, "content": content})

            if not anthropic_messages:
                anthropic_messages.append({"role": "user", "content": "Hello"})

            payload: Dict = {
                "model": model,
                "messages": anthropic_messages,
                "max_tokens": kwargs.get("max_tokens", 2000),
            }
            if system_parts:
                payload["system"] = "\n\n".join(system_parts)

            # Enable extended thinking when requested (Req 4.7)
            if kwargs.get("enable_thinking", False):
                thinking_budget = kwargs.get("thinking_budget", 5000)
                payload["thinking"] = {
                    "type": "enabled",
                    "budget_tokens": thinking_budget,
                }
                # Extended thinking requires a higher max_tokens than the budget
                if payload["max_tokens"] <= thinking_budget:
                    payload["max_tokens"] = thinking_budget + 1000

            headers = {
                "x-api-key": self.api_key,
                "anthropic-version": "2023-06-01",
            }
            async with self.session.post(
                f"{self.base_url}/messages",
                headers=headers,
                json=payload,
            ) as resp:
                if resp.status == 200:
                    data = await resp.json()
                    content_blocks = data.get("content", [])
                    if not content_blocks:
                        return ""
                    # Collect thinking blocks and text blocks separately
                    thinking_parts: List[str] = []
                    text_parts: List[str] = []
                    for block in content_blocks:
                        if isinstance(block, dict):
                            if block.get("type") == "thinking":
                                thinking_parts.append(block.get("thinking", ""))
                            elif block.get("type") == "text":
                                text_parts.append(block.get("text", ""))
                    # Wrap thinking in <thinking> tags so the frontend can parse it
                    if thinking_parts:
                        thinking_text = "\n".join(thinking_parts)
                        text_text = "\n".join(text_parts)
                        return f"<thinking>{thinking_text}</thinking>{text_text}"
                    return "\n".join(text_parts)
                body = await resp.text()
                raise RuntimeError(f"Anthropic chat error {resp.status}: {body[:300]}")
        except Exception as e:
            logger.error(f"Anthropic chat failed: {e}")
            raise

    async def stream_chat(self, model: str, messages: List[Dict], **kwargs) -> AsyncIterator[str]:
        text = await self.chat(model, messages, **kwargs)
        if text:
            yield text


class GroqProvider(LLMProvider):
    """Groq API provider"""
    
    def __init__(self, api_key: Optional[str]):
        if not api_key:
            raise ValueError("Groq API key is required")
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
                body = await resp.text()
                raise RuntimeError(f"Groq API error {resp.status}: {body[:300]}")
        except Exception as e:
            logger.error(f"Failed to fetch Groq models: {e}")
            raise

    async def chat(self, model: str, messages: List[Dict], **kwargs) -> str:
        """Send chat request to Groq (OpenAI-compatible format)"""
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
                    return data.get("choices", [{}])[0].get("message", {}).get("content", "")
                body = await resp.text()
                raise RuntimeError(f"Groq chat error {resp.status}: {body[:300]}")
        except Exception as e:
            logger.error(f"Groq chat failed: {e}")
            raise

    async def stream_chat(self, model: str, messages: List[Dict], **kwargs) -> AsyncIterator[str]:
        text = await self.chat(model, messages, **kwargs)
        if text:
            yield text


class AirLLMProvider(LLMProvider):
    """AirLLM provider for split-model loading with limited RAM.
    
    AirLLM enables running large models by splitting them across
    limited GPU/CPU memory. It exposes an OpenAI-compatible HTTP API.
    
    Default endpoint: http://localhost:8000
    Start with: airllm serve --model <model_path>
    """
    
    def __init__(self, base_url: str = "http://localhost:8000", model_path: Optional[str] = None):
        super().__init__(base_url=base_url)
        self.model_path = model_path or os.getenv("AIRLLM_MODEL_PATH", "")
    
    async def fetch_models(self) -> List[str]:
        """Fetch available models from AirLLM server"""
        try:
            if not self.session:
                await self.init()
            
            async with self.session.get(f"{self.base_url}/v1/models") as resp:
                if resp.status == 200:
                    data = await resp.json()
                    return [m["id"] for m in data.get("data", [])]
                # AirLLM may not have /models endpoint; return configured model
                if self.model_path:
                    return [self.model_path]
                return []
        except Exception as e:
            logger.warning(f"AirLLM model fetch failed: {e}")
            if self.model_path:
                return [self.model_path]
            return []
    
    async def chat(self, model: str, messages: List[Dict], **kwargs) -> str:
        """Send chat request to AirLLM (OpenAI-compatible format)"""
        try:
            if not self.session:
                await self.init()
            
            payload = {
                "model": model or self.model_path,
                "messages": messages,
                "temperature": kwargs.get("temperature", 0.7),
                "max_tokens": kwargs.get("max_tokens", 2000),
                "stream": False,
            }
            
            timeout = aiohttp.ClientTimeout(total=int(os.getenv("AIRLLM_TIMEOUT", "120")))
            async with self.session.post(
                f"{self.base_url}/v1/chat/completions",
                json=payload,
                timeout=timeout,
            ) as resp:
                if resp.status == 200:
                    data = await resp.json()
                    return data.get("choices", [{}])[0].get("message", {}).get("content", "")
                body = await resp.text()
                raise RuntimeError(f"AirLLM chat error {resp.status}: {body[:300]}")
        except Exception as e:
            logger.error(f"AirLLM chat failed: {e}")
            raise

    async def stream_chat(self, model: str, messages: List[Dict], **kwargs) -> AsyncIterator[str]:
        """AirLLM streaming (falls back to full response)"""
        text = await self.chat(model, messages, **kwargs)
        if text:
            yield text


class VLLMProvider(LLMProvider):
    """vLLM provider for high-throughput batched inference.
    
    vLLM uses PagedAttention for efficient memory management and
    provides an OpenAI-compatible API with native streaming support.
    
    Default endpoint: http://localhost:8000
    Start with: python -m vllm.entrypoints.openai.api_server --model <model_name>
    """
    
    def __init__(self, api_key: Optional[str] = None, base_url: str = "http://localhost:8000"):
        super().__init__(
            api_key=api_key or os.getenv("VLLM_API_KEY", ""),
            base_url=base_url or os.getenv("VLLM_BASE_URL", "http://localhost:8000")
        )
    
    async def fetch_models(self) -> List[str]:
        """Fetch available models from vLLM server"""
        try:
            if not self.session:
                await self.init()
            
            headers = {}
            if self.api_key:
                headers["Authorization"] = f"Bearer {self.api_key}"
            
            async with self.session.get(
                f"{self.base_url}/v1/models",
                headers=headers
            ) as resp:
                if resp.status == 200:
                    data = await resp.json()
                    return [m["id"] for m in data.get("data", [])]
                body = await resp.text()
                raise RuntimeError(f"vLLM API error {resp.status}: {body[:300]}")
        except Exception as e:
            logger.error(f"Failed to fetch vLLM models: {e}")
            raise
    
    async def chat(self, model: str, messages: List[Dict], **kwargs) -> str:
        """Send chat request to vLLM (OpenAI-compatible format)"""
        try:
            if not self.session:
                await self.init()
            
            headers = {}
            if self.api_key:
                headers["Authorization"] = f"Bearer {self.api_key}"
            
            payload = {
                "model": model,
                "messages": messages,
                "temperature": kwargs.get("temperature", 0.7),
                "max_tokens": kwargs.get("max_tokens", 2000),
                "stream": False,
            }
            
            timeout = aiohttp.ClientTimeout(total=int(os.getenv("VLLM_TIMEOUT", "60")))
            async with self.session.post(
                f"{self.base_url}/v1/chat/completions",
                headers=headers,
                json=payload,
                timeout=timeout,
            ) as resp:
                if resp.status == 200:
                    data = await resp.json()
                    return data.get("choices", [{}])[0].get("message", {}).get("content", "")
                body = await resp.text()
                raise RuntimeError(f"vLLM chat error {resp.status}: {body[:300]}")
        except Exception as e:
            logger.error(f"vLLM chat failed: {e}")
            raise
    
    async def stream_chat(self, model: str, messages: List[Dict], **kwargs) -> AsyncIterator[str]:
        """Stream chat tokens from vLLM (SSE streaming)"""
        try:
            if not self.session:
                await self.init()
            
            headers = {}
            if self.api_key:
                headers["Authorization"] = f"Bearer {self.api_key}"
            
            payload = {
                "model": model,
                "messages": messages,
                "temperature": kwargs.get("temperature", 0.7),
                "max_tokens": kwargs.get("max_tokens", 2000),
                "stream": True,
            }
            
            timeout = aiohttp.ClientTimeout(total=int(os.getenv("VLLM_TIMEOUT", "60")))
            async with self.session.post(
                f"{self.base_url}/v1/chat/completions",
                headers=headers,
                json=payload,
                timeout=timeout,
            ) as resp:
                if resp.status == 200:
                    async for line in resp.content:
                        decoded = line.decode("utf-8", errors="ignore").strip()
                        if not decoded or not decoded.startswith("data: "):
                            continue
                        data_str = decoded[6:]  # Strip "data: " prefix
                        if data_str == "[DONE]":
                            break
                        try:
                            chunk = json.loads(data_str)
                            delta = chunk.get("choices", [{}])[0].get("delta", {})
                            content = delta.get("content", "")
                            if content:
                                yield content
                        except json.JSONDecodeError:
                            continue
                else:
                    body = await resp.text()
                    logger.error(f"vLLM stream error {resp.status}: {body[:300]}")
        except Exception as e:
            logger.error(f"vLLM stream failed: {e}")

class AIServicer(AIServiceServicer if PROTOBUF_AVAILABLE else object):
    """gRPC AI Service implementation"""
    
    def __init__(self):
        if PROTOBUF_AVAILABLE:
            super().__init__()
        self.providers: Dict[str, LLMProvider] = {}
    
    async def initialize_providers(self):
        """Initialize all provider instances"""
        logger.info("Initializing AI service providers...")
        # Note: For now, providers are initialized on-demand
        # In production, you might pre-warm connections here
    
    def get_provider(self, provider: str, api_key: Optional[str], base_url: Optional[str]) -> LLMProvider:
        """Get or create provider instance"""
        provider = provider.lower().strip()
        if provider == "ollama":
            return OllamaProvider(base_url or os.getenv("OLLAMA_BASE_URL", "http://localhost:11434"))
        elif provider == "openai":
            return OpenAIProvider(api_key)
        elif provider == "anthropic":
            return AnthropicProvider(api_key)
        elif provider == "groq":
            return GroqProvider(api_key)
        elif provider == "airllm":
            return AirLLMProvider(
                base_url=base_url or os.getenv("AIRLLM_BASE_URL", "http://localhost:8000"),
                model_path=os.getenv("AIRLLM_MODEL_PATH", ""),
            )
        elif provider == "vllm":
            return VLLMProvider(
                api_key=api_key or os.getenv("VLLM_API_KEY", ""),
                base_url=base_url or os.getenv("VLLM_BASE_URL", "http://localhost:8000"),
            )
        else:
            raise ValueError(f"Unknown provider: {provider}")
    
    async def fetch_models_internal(self, provider: str, api_key: Optional[str], base_url: Optional[str]) -> List[str]:
        """Fetch models from provider"""
        prov = self.get_provider(provider, api_key, base_url)
        await prov.init()
        try:
            return await prov.fetch_models()
        finally:
            await prov.close()
    
    async def Chat(self, request: PBChatRequest, context: grpc.aio.ServicerContext) -> ChatResponse:
        """Handle chat requests with advanced reasoning and issue detection"""
        try:
            logger.info(f"Chat request: model={request.model}, provider={request.provider}")
            
            # Convert protobuf messages to dict
            messages = [{"role": msg.role, "content": msg.content} for msg in request.history]
            messages.append({"role": "user", "content": request.prompt})
            
            # Initialize system prompt
            system_prompt = "You are a helpful AI assistant."
            
            # Use advanced prompting if available
            if MODULES_AVAILABLE:
                try:
                    # Prefer explicit mode field from request, fall back to heuristics
                    mode_str = getattr(request, "mode", "") or ""
                    if mode_str:
                        mode = get_system_prompt.__module__ and AIMode.CHAT  # placeholder
                        try:
                            mode = AIMode[mode_str.upper()] if mode_str.upper() in AIMode.__members__ else AIMode(mode_str.lower())
                        except (KeyError, ValueError):
                            mode = AIMode.CHAT
                    else:
                        # Determine AI mode based on request context
                        mode = AIMode.CHAT  # Default mode
                        if "debug" in request.prompt.lower() or "bug" in request.prompt.lower():
                            mode = AIMode.BUG_HUNT
                        elif "analyze" in request.prompt.lower() or "review" in request.prompt.lower():
                            mode = AIMode.CODE
                        elif "think" in request.prompt.lower() or "reason" in request.prompt.lower():
                            mode = AIMode.THINK
                        elif "design" in request.prompt.lower() or "architecture" in request.prompt.lower():
                            mode = AIMode.ARCHITECT

                    # Use ISSUE_DETECTION_PROMPT for bug_hunt mode (Req 5.1)
                    if mode == AIMode.BUG_HUNT:
                        system_prompt = ISSUE_DETECTION_PROMPT
                    else:
                        loader = _get_template_loader()
                        if loader:
                            system_prompt = loader.get_system_prompt(mode.value)
                        else:
                            system_prompt = get_system_prompt(mode)
                    logger.info(f"Using AI mode: {mode.value}")
                except Exception as e:
                    logger.warning(f"Failed to get advanced prompt: {e}, using default")
            
            # Detect issues if code is present
            detected_issues = []
            if MODULES_AVAILABLE and "code" in request.prompt.lower():
                try:
                    detected_issues = IssueDetector.detect_issues(request.prompt, "python")
                    if detected_issues:
                        logger.info(f"Detected {len(detected_issues)} potential issues")
                except Exception as e:
                    logger.warning(f"Issue detection failed: {e}")
            
            # Get the provider and send request
            prov = self.get_provider(request.provider, request.api_key, None)
            await prov.init()
            try:
                # Prepare messages with system prompt
                enhanced_messages = [{"role": "system", "content": system_prompt}] + messages

                # Enable Anthropic extended thinking when provider is anthropic and mode is think (Req 4.7)
                extra_kwargs: Dict = {}
                if request.provider.lower() == "anthropic":
                    mode_str = getattr(request, "mode", "") or ""
                    if mode_str == "think" or "think" in request.prompt.lower()[:50]:
                        extra_kwargs["enable_thinking"] = True
                        extra_kwargs["thinking_budget"] = 5000

                response = await prov.chat(
                    request.model,
                    enhanced_messages,
                    temperature=request.temperature,
                    max_tokens=request.max_tokens,
                    **extra_kwargs,
                )
            finally:
                await prov.close()
            
            # Score confidence if available
            confidence = 1.0
            if MODULES_AVAILABLE:
                try:
                    scorer = ConfidenceScorer()
                    confidence = scorer.score(response, request.prompt, len(detected_issues))
                except Exception as e:
                    logger.warning(f"Confidence scoring failed: {e}")
            
            # Validate response if available
            is_valid = True
            if MODULES_AVAILABLE:
                try:
                    validator = ResponseValidator()
                    is_valid = validator.validate_response(response, "code" in request.prompt.lower())
                except Exception as e:
                    logger.warning(f"Response validation failed: {e}")
            
            # Add issues to response metadata if detected
            response_content = response
            if detected_issues:
                issues_text = "\n\n[Detected Issues]\n"
                for issue in detected_issues[:5]:  # Limit to 5 issues
                    if isinstance(issue, dict):
                        issue_type = issue.get("type", "unknown")
                        issue_msg = issue.get("message") or issue.get("description", "")
                    else:
                        issue_type = getattr(issue, "type", "unknown")
                        issue_msg = getattr(issue, "message", None) or getattr(issue, "description", "")
                    issues_text += f"- {issue_type}: {issue_msg}\n"
                response_content = response + issues_text
            
            return ChatResponse(
                content=response_content,
                tokens_used=0,  # TODO: track actual tokens
                model=request.model,
            )
        except Exception as e:
            logger.error(f"Chat error: {e}", exc_info=True)
            await context.abort(grpc.StatusCode.INTERNAL, str(e))
    
    async def StreamChat(self, request: PBChatRequest, context: grpc.aio.ServicerContext) -> AsyncIterator[TokenResponse]:
        """Handle streaming chat requests with advanced reasoning"""
        try:
            logger.info(f"StreamChat request: model={request.model}, provider={request.provider}")
            
            # Convert protobuf messages to dict
            messages = [{"role": msg.role, "content": msg.content} for msg in request.history]
            messages.append({"role": "user", "content": request.prompt})
            
            # Initialize system prompt
            system_prompt = "You are a helpful AI assistant."
            
            # Use advanced prompting if available
            if MODULES_AVAILABLE:
                try:
                    mode = AIMode.CHAT
                    if "debug" in request.prompt.lower() or "bug" in request.prompt.lower():
                        mode = AIMode.BUG_HUNT
                    elif "analyze" in request.prompt.lower() or "review" in request.prompt.lower():
                        mode = AIMode.CODE
                    
                    loader = _get_template_loader()
                    if loader:
                        system_prompt = loader.get_system_prompt(mode.value)
                    else:
                        system_prompt = get_system_prompt(mode)
                    logger.info(f"Streaming with AI mode: {mode.value}")                except Exception as e:
                    logger.warning(f"Failed to get advanced prompt: {e}")
            
            # Get the provider
            prov = self.get_provider(request.provider, request.api_key, None)
            await prov.init()
            try:
                # Prepare messages with system prompt
                enhanced_messages = [{"role": "system", "content": system_prompt}] + messages
                
                # Stream tokens
                async for token in prov.stream_chat(
                    request.model,
                    enhanced_messages,
                    temperature=request.temperature,
                    max_tokens=request.max_tokens
                ):
                    yield TokenResponse(token=token, done=False)
                
                yield TokenResponse(token="", done=True)
            finally:
                await prov.close()
        except Exception as e:
            logger.error(f"StreamChat error: {e}", exc_info=True)
            await context.abort(grpc.StatusCode.INTERNAL, str(e))
    
    async def FetchModels(self, request: FetchModelsRequest, context: grpc.aio.ServicerContext) -> FetchModelsResponse:
        """Fetch models from provider"""
        try:
            logger.info(f"FetchModels request: provider={request.provider}")
            
            models = await self.fetch_models_internal(
                request.provider,
                request.api_key,
                request.base_url
            )
            
            return FetchModelsResponse(models=models, error="")
        except Exception as e:
            logger.error(f"FetchModels error: {e}", exc_info=True)
            return FetchModelsResponse(models=[], error=str(e))
    
    async def Health(self, request: HealthRequest, context: grpc.aio.ServicerContext) -> HealthResponse:
        """Health check endpoint"""
        try:
            # Service health should represent gRPC availability; Ollama can be down while API providers still work.
            try:
                prov = OllamaProvider()
                await prov.init()
                await prov.fetch_models()
                await prov.close()
            except Exception as ollama_err:
                logger.warning(f"Health check: Ollama unavailable - {ollama_err}")

            return HealthResponse(status="healthy", version=SERVICE_VERSION)
        except Exception as e:
            logger.warning(f"Health check failure: {e}")
            return HealthResponse(status="unhealthy", version=SERVICE_VERSION)


async def run_server():
    """Run the gRPC server"""
    if not CORE_DEPS_AVAILABLE:
        raise RuntimeError("Missing dependencies (aiohttp/pydantic). Run: python3 -m pip install -r requirements.txt")
    if not GRPC_AVAILABLE:
        raise RuntimeError("grpcio is not installed. Run: python3 -m pip install -r requirements.txt")
    if not PROTOBUF_AVAILABLE:
        raise RuntimeError("Protobuf code not generated. Run: python3 -m grpc_tools.protoc -I. --python_out=. --grpc_python_out=. ai_service.proto")

    # Initialize prompt template loader (Tasks 6.1, 6.2)
    global _template_loader
    project_root = os.getenv("KIRO_PROJECT_ROOT", os.getcwd())
    prompts_dir = os.path.join(project_root, ".kiro", "prompts")
    _template_loader = PromptTemplateLoader(prompts_dir)
    _template_loader.load_all()
    _template_loader.start_watcher()

    servicer = AIServicer()
    await servicer.initialize_providers()
    
    server = grpc.aio.server(
        futures.ThreadPoolExecutor(max_workers=10)
    )
    
    # Register service
    add_AIServiceServicer_to_server(servicer, server)
    
    bind_addr = f"{GRPC_HOST}:{GRPC_PORT}"
    server.add_insecure_port(bind_addr)
    logger.info(f"Starting AI Service gRPC server on {bind_addr}")
    logger.info(f"Service version: {SERVICE_VERSION}")
    
    await server.start()
    try:
        await server.wait_for_termination()
    finally:
        await server.stop(grace=3)


if __name__ == "__main__":
    try:
        # First, generate protobuf code:
        # python3 -m grpc_tools.protoc -I. --python_out=. --grpc_python_out=. ai_service.proto
        
        logger.info("=" * 60)
        logger.info("NCode AI Service - gRPC Server")
        logger.info("=" * 60)
        logger.info(f"Version: {SERVICE_VERSION}")
        logger.info("")
        logger.info("IMPORTANT: Before running this server, generate the protobuf code:")
        logger.info("")
        logger.info("  python3 -m pip install -r requirements.txt")
        logger.info("  python3 -m grpc_tools.protoc -I. --python_out=. --grpc_python_out=. ai_service.proto")
        logger.info("")
        logger.info("Then run the server with:")
        logger.info("  python3 server.py")
        logger.info("=" * 60)
        
        asyncio.run(run_server())
    except KeyboardInterrupt:
        logger.info("Server shutdown requested")
    except Exception as e:
        logger.error(f"Server error: {e}", exc_info=True)
        sys.exit(1)
