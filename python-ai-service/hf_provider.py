"""
HuggingFace Inference API Provider

Implements LLMProvider for the HuggingFace Inference API:
- Static curated list of popular code/chat models
- Single-turn: text-generation format (inputs + parameters)
- Multi-turn: conversational format (past_user_inputs, generated_responses, text)
- Bearer token authentication
- Retry logic for 503 model-loading responses (exponential backoff)
- 401/403 → AUTH_ERROR, 429 → RATE_LIMIT
- stream_chat() with SSE fallback to non-streaming chat()
"""

from __future__ import annotations

import asyncio
import json
import logging
from typing import AsyncIterator, Dict, List, Optional

try:
    import aiohttp
    AIOHTTP_AVAILABLE = True
except ImportError:
    aiohttp = None  # type: ignore[assignment]
    AIOHTTP_AVAILABLE = False

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Curated model list (≥10 popular code/chat models)
# ---------------------------------------------------------------------------
HF_CURATED_MODELS: List[str] = [
    "codellama/CodeLlama-7b-hf",
    "bigcode/starcoder2-7b",
    "mistralai/Mistral-7B-Instruct-v0.2",
    "HuggingFaceH4/zephyr-7b-beta",
    "google/gemma-7b-it",
    "meta-llama/Llama-2-7b-chat-hf",
    "Qwen/Qwen2.5-Coder-7B-Instruct",
    "deepseek-ai/deepseek-coder-6.7b-instruct",
    "microsoft/phi-2",
    "tiiuae/falcon-7b-instruct",
]

# Retry delays for 503 model-loading responses (seconds)
_RETRY_DELAYS = [5, 10, 20]


def _build_hf_payload(messages: List[Dict]) -> tuple[str, Dict]:
    """
    Convert a messages list into a HuggingFace Inference API payload.

    Single-turn (only one user message, no history):
        POST /<model>  { "inputs": "<text>", "parameters": {...} }

    Multi-turn (conversation history present):
        POST /<model>  {
            "inputs": {
                "past_user_inputs": [...],
                "generated_responses": [...],
                "text": "<latest user message>"
            }
        }

    Returns (format, payload) where format is "text-generation" or "conversational".
    """
    user_msgs: List[str] = []
    assistant_msgs: List[str] = []
    system_prefix = ""

    for msg in messages:
        role = str(msg.get("role", "user")).lower()
        content = str(msg.get("content", ""))
        if role == "system":
            system_prefix = content
        elif role == "user":
            user_msgs.append(content)
        elif role == "assistant":
            assistant_msgs.append(content)

    # Determine if this is a multi-turn conversation
    has_history = len(user_msgs) > 1 or len(assistant_msgs) > 0

    if not has_history:
        # Single-turn: text-generation format
        latest = user_msgs[-1] if user_msgs else ""
        if system_prefix:
            latest = f"{system_prefix}\n\n{latest}"
        payload = {
            "inputs": latest,
            "parameters": {
                "max_new_tokens": 512,
                "return_full_text": False,
            },
        }
        return "text-generation", payload
    else:
        # Multi-turn: conversational format
        # past_user_inputs = all user messages except the last
        # generated_responses = all assistant messages
        # text = latest user message
        past_user = user_msgs[:-1]
        latest_user = user_msgs[-1] if user_msgs else ""

        if system_prefix and past_user:
            past_user[0] = f"{system_prefix}\n\n{past_user[0]}"
        elif system_prefix and not past_user:
            latest_user = f"{system_prefix}\n\n{latest_user}"

        payload = {
            "inputs": {
                "past_user_inputs": past_user,
                "generated_responses": assistant_msgs,
                "text": latest_user,
            },
        }
        return "conversational", payload


class HuggingFaceProvider:
    """HuggingFace Inference API provider."""

    def __init__(
        self,
        api_key: str,
        base_url: str = "https://api-inference.huggingface.co",
    ) -> None:
        self.api_key = api_key
        self.base_url = base_url.rstrip("/")
        self.session: Optional[aiohttp.ClientSession] = None

    # ------------------------------------------------------------------
    # Session lifecycle (mirrors LLMProvider base class pattern)
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
        """Return the curated static list of HuggingFace models."""
        return list(HF_CURATED_MODELS)

    # ------------------------------------------------------------------
    # Internal HTTP helper with retry logic
    # ------------------------------------------------------------------

    async def _post_with_retry(self, url: str, payload: Dict) -> Dict:
        """
        POST to the HF Inference API with retry on 503 (model loading).

        Raises:
            RuntimeError: AUTH_ERROR on 401/403, RATE_LIMIT on 429.
            RuntimeError: on persistent 503 after retries.
        """
        if not self.session:
            await self.init()

        headers = {**self._auth_headers(), "Content-Type": "application/json"}
        last_error: Optional[str] = None

        for attempt in range(len(_RETRY_DELAYS) + 1):
            async with self.session.post(url, headers=headers, json=payload) as resp:
                if resp.status == 200:
                    return await resp.json()

                if resp.status in (401, 403):
                    body = await resp.text()
                    raise RuntimeError(
                        f"AUTH_ERROR: Invalid or missing HuggingFace API key "
                        f"(HTTP {resp.status}). Please update your key in Settings. "
                        f"Details: {body[:200]}"
                    )

                if resp.status == 429:
                    body = await resp.text()
                    raise RuntimeError(
                        f"RATE_LIMIT: HuggingFace API rate limit exceeded. "
                        f"Please wait before retrying. Details: {body[:200]}"
                    )

                if resp.status == 503:
                    body = await resp.text()
                    last_error = body
                    if attempt < len(_RETRY_DELAYS):
                        delay = _RETRY_DELAYS[attempt]
                        logger.warning(
                            f"[HuggingFace] Model loading (503), retrying in {delay}s "
                            f"(attempt {attempt + 1}/{len(_RETRY_DELAYS)})..."
                        )
                        await asyncio.sleep(delay)
                        continue
                    # Exhausted retries
                    raise RuntimeError(
                        f"HuggingFace model is still loading after {len(_RETRY_DELAYS)} retries. "
                        f"Details: {last_error[:200]}"
                    )

                body = await resp.text()
                raise RuntimeError(
                    f"HuggingFace API error {resp.status}: {body[:300]}"
                )

        raise RuntimeError("HuggingFace request failed after all retries.")

    # ------------------------------------------------------------------
    # chat
    # ------------------------------------------------------------------

    async def chat(self, model: str, messages: List[Dict], **kwargs) -> str:
        """
        Send a chat request to the HuggingFace Inference API.

        Routes to text-generation or conversational format based on history.
        """
        try:
            url = f"{self.base_url}/models/{model}"
            fmt, payload = _build_hf_payload(messages)
            data = await self._post_with_retry(url, payload)

            if fmt == "text-generation":
                # Response: list of {"generated_text": "..."}
                if isinstance(data, list) and data:
                    return str(data[0].get("generated_text", ""))
                if isinstance(data, dict):
                    return str(data.get("generated_text", ""))
                return ""
            else:
                # Conversational response: {"generated_text": "..."}
                if isinstance(data, dict):
                    return str(data.get("generated_text", ""))
                return ""
        except RuntimeError:
            raise
        except Exception as e:
            logger.error(f"[HuggingFace] chat failed: {e}")
            raise

    # ------------------------------------------------------------------
    # stream_chat
    # ------------------------------------------------------------------

    async def stream_chat(
        self, model: str, messages: List[Dict], **kwargs
    ) -> AsyncIterator[str]:
        """
        Stream chat tokens via SSE from the HuggingFace Inference API.

        Falls back to non-streaming chat() if SSE is not supported by the model.
        """
        if not self.session:
            await self.init()

        url = f"{self.base_url}/models/{model}"
        fmt, payload = _build_hf_payload(messages)

        # Add stream flag for text-generation endpoints that support it
        stream_payload = {**payload, "stream": True}
        headers = {**self._auth_headers(), "Content-Type": "application/json"}

        try:
            async with self.session.post(
                url, headers=headers, json=stream_payload
            ) as resp:
                if resp.status in (401, 403):
                    body = await resp.text()
                    raise RuntimeError(
                        f"AUTH_ERROR: Invalid or missing HuggingFace API key "
                        f"(HTTP {resp.status}). Details: {body[:200]}"
                    )

                if resp.status == 429:
                    body = await resp.text()
                    raise RuntimeError(
                        f"RATE_LIMIT: HuggingFace API rate limit exceeded. "
                        f"Details: {body[:200]}"
                    )

                content_type = resp.headers.get("Content-Type", "")

                if resp.status == 200 and "text/event-stream" in content_type:
                    # Parse SSE stream
                    async for raw_line in resp.content:
                        line = raw_line.decode("utf-8", errors="replace").rstrip("\n\r")
                        if line.startswith("data:"):
                            data_str = line[len("data:"):].strip()
                            if data_str == "[DONE]":
                                break
                            try:
                                chunk = json.loads(data_str)
                                token = chunk.get("token", {}).get("text", "")
                                if token:
                                    yield token
                            except json.JSONDecodeError:
                                # Yield raw text if not JSON
                                if data_str:
                                    yield data_str
                    return

                # Fallback: non-streaming response or unsupported streaming
                logger.debug(
                    f"[HuggingFace] stream_chat falling back to non-streaming "
                    f"(status={resp.status}, content-type={content_type})"
                )

        except RuntimeError:
            raise
        except Exception as e:
            logger.warning(f"[HuggingFace] SSE stream failed ({e}), falling back to chat()")

        # Fallback to non-streaming chat()
        text = await self.chat(model, messages, **kwargs)
        if text:
            yield text
