"""
OpenAI-Compatible Provider

Generic provider for any OpenAI-compatible REST API endpoint.
Covers Mistral AI, Together AI, Perplexity, Fireworks, LM Studio, etc.

- GET  {base_url}/models          → fetch_models()
- POST {base_url}/chat/completions → chat()
- stream_chat() delegates to chat() (yields full response as single token)
- Authorization: Bearer {api_key}
- 401/403 → RuntimeError("AUTH_ERROR: ...")
"""

from __future__ import annotations

import logging
from typing import AsyncIterator, Dict, List, Optional

try:
    import aiohttp
    AIOHTTP_AVAILABLE = True
except ImportError:
    aiohttp = None  # type: ignore[assignment]
    AIOHTTP_AVAILABLE = False

logger = logging.getLogger(__name__)


class OpenAICompatProvider:
    """Generic OpenAI-compatible REST API provider."""

    def __init__(
        self,
        api_key: str,
        base_url: str,
        provider_name: str = "openai_compat",
    ) -> None:
        self.api_key = api_key
        self.base_url = base_url.rstrip("/")
        self.provider_name = provider_name
        self.session: Optional[aiohttp.ClientSession] = None

    # ------------------------------------------------------------------
    # Session lifecycle
    # ------------------------------------------------------------------

    async def init(self) -> None:
        """Initialize the aiohttp session."""
        self.session = aiohttp.ClientSession()

    async def close(self) -> None:
        """Close the aiohttp session."""
        if self.session:
            await self.session.close()
            self.session = None

    def _auth_headers(self) -> Dict[str, str]:
        return {"Authorization": f"Bearer {self.api_key}"}

    # ------------------------------------------------------------------
    # fetch_models
    # ------------------------------------------------------------------

    async def fetch_models(self) -> List[str]:
        """Fetch available models via GET {base_url}/models."""
        if not self.session:
            await self.init()

        headers = self._auth_headers()
        async with self.session.get(
            f"{self.base_url}/models", headers=headers
        ) as resp:
            if resp.status in (401, 403):
                body = await resp.text()
                raise RuntimeError(
                    f"AUTH_ERROR: Invalid or missing API key for {self.provider_name} "
                    f"(HTTP {resp.status}). Please update your key in Settings. "
                    f"Details: {body[:200]}"
                )
            if resp.status == 200:
                data = await resp.json()
                # Standard OpenAI format: { "data": [{ "id": "..." }, ...] }
                return [m["id"] for m in data.get("data", [])]
            body = await resp.text()
            raise RuntimeError(
                f"{self.provider_name} models error {resp.status}: {body[:300]}"
            )

    # ------------------------------------------------------------------
    # chat
    # ------------------------------------------------------------------

    async def chat(self, model: str, messages: List[Dict], **kwargs) -> str:
        """Send a chat request via POST {base_url}/chat/completions."""
        if not self.session:
            await self.init()

        headers = {**self._auth_headers(), "Content-Type": "application/json"}
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
            if resp.status in (401, 403):
                body = await resp.text()
                raise RuntimeError(
                    f"AUTH_ERROR: Invalid or missing API key for {self.provider_name} "
                    f"(HTTP {resp.status}). Please update your key in Settings. "
                    f"Details: {body[:200]}"
                )
            if resp.status == 200:
                data = await resp.json()
                choices = data.get("choices", [])
                if choices:
                    return choices[0].get("message", {}).get("content", "")
                return ""
            body = await resp.text()
            raise RuntimeError(
                f"{self.provider_name} chat error {resp.status}: {body[:300]}"
            )

    # ------------------------------------------------------------------
    # stream_chat
    # ------------------------------------------------------------------

    async def stream_chat(
        self, model: str, messages: List[Dict], **kwargs
    ) -> AsyncIterator[str]:
        """Yield the full chat response as a single token (delegates to chat())."""
        text = await self.chat(model, messages, **kwargs)
        if text:
            yield text
