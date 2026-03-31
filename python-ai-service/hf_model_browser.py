"""
HuggingFace Hub Model Browser

Searches the HuggingFace Hub public API for models by task, keyword, and size filters.
Returns structured HFModelCard metadata for display in the UI.

Features:
- Async HTTP via aiohttp (optional import)
- HTTP 429 retry with exponential backoff (10s, 20s, 40s, max 3 retries)
- In-memory LRU cache (last 10 queries) for rate-limit fallback
- Authorization header only when token is non-empty
- max_size_gb client-side filter
- Gated flag: any truthy value (True, "auto", "manual") → gated=True
"""

from __future__ import annotations

import asyncio
import logging
from collections import OrderedDict
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

try:
    import aiohttp
    AIOHTTP_AVAILABLE = True
except ImportError:
    aiohttp = None  # type: ignore[assignment]
    AIOHTTP_AVAILABLE = False

logger = logging.getLogger(__name__)

HF_API_BASE = "https://huggingface.co/api"

# Retry delays for HTTP 429 responses (seconds)
_RETRY_DELAYS_429 = [10, 20, 40]

# LRU cache capacity
_CACHE_CAPACITY = 10


@dataclass
class HFModelCard:
    model_id: str
    downloads: int
    likes: int
    size_bytes: int
    license: str
    tags: List[str] = field(default_factory=list)
    gated: bool = False
    description: str = ""


class _LRUCache:
    """Simple in-memory LRU cache with a fixed capacity."""

    def __init__(self, capacity: int) -> None:
        self._capacity = capacity
        self._store: OrderedDict = OrderedDict()

    def get(self, key: tuple) -> Optional[List[HFModelCard]]:
        if key not in self._store:
            return None
        self._store.move_to_end(key)
        return self._store[key]

    def put(self, key: tuple, value: List[HFModelCard]) -> None:
        if key in self._store:
            self._store.move_to_end(key)
        self._store[key] = value
        if len(self._store) > self._capacity:
            self._store.popitem(last=False)

    def __len__(self) -> int:
        return len(self._store)


def _parse_model_card(item: Dict[str, Any]) -> HFModelCard:
    """Parse a single HF API model item into an HFModelCard."""
    model_id = item.get("id", "") or item.get("modelId", "")

    downloads = int(item.get("downloads", 0) or 0)
    likes = int(item.get("likes", 0) or 0)

    # Size from safetensors.total (bytes)
    safetensors = item.get("safetensors") or {}
    size_bytes = int(safetensors.get("total", 0) or 0)

    # License from cardData.license
    card_data = item.get("cardData") or {}
    license_val = str(card_data.get("license", "") or "")

    # Tags list
    tags: List[str] = list(item.get("tags") or [])

    # Gated: false, "auto", "manual" — any truthy value → True
    gated_raw = item.get("gated", False)
    gated = bool(gated_raw)

    # Description (first 200 chars of model card description)
    description = str(item.get("description", "") or "")[:200]

    return HFModelCard(
        model_id=model_id,
        downloads=downloads,
        likes=likes,
        size_bytes=size_bytes,
        license=license_val,
        tags=tags,
        gated=gated,
        description=description,
    )


class HFModelBrowser:
    """Browse and search the HuggingFace Hub model catalog."""

    def __init__(self, hf_token: Optional[str] = None) -> None:
        self.hf_token = hf_token or ""
        self._session: Optional[Any] = None  # aiohttp.ClientSession
        self._cache: _LRUCache = _LRUCache(_CACHE_CAPACITY)

    def _headers(self) -> Dict[str, str]:
        headers: Dict[str, str] = {}
        if self.hf_token:
            headers["Authorization"] = f"Bearer {self.hf_token}"
        return headers

    async def _ensure_session(self) -> Any:
        # If a session is already injected (e.g. in tests), use it directly
        if self._session is not None and not getattr(self._session, "closed", False):
            return self._session
        if not AIOHTTP_AVAILABLE:
            raise RuntimeError(
                "MISSING_DEPENDENCY: aiohttp is not installed. "
                "Install with: pip install aiohttp"
            )
        self._session = aiohttp.ClientSession()
        return self._session

    async def close(self) -> None:
        """Close the underlying aiohttp session."""
        if self._session and not self._session.closed:
            await self._session.close()
            self._session = None

    async def _get_with_retry(
        self,
        url: str,
        params: Dict[str, Any],
        cache_key: Optional[tuple] = None,
    ) -> Any:
        """
        GET request with exponential backoff on HTTP 429.

        On 429 with a cached result available, returns the cached result
        with a note logged. Raises RuntimeError on persistent 429 after retries.
        """
        session = await self._ensure_session()
        headers = self._headers()
        last_status: Optional[int] = None

        for attempt in range(len(_RETRY_DELAYS_429) + 1):
            async with session.get(url, headers=headers, params=params) as resp:
                if resp.status == 200:
                    return await resp.json()

                if resp.status == 429:
                    last_status = 429
                    if attempt < len(_RETRY_DELAYS_429):
                        delay = _RETRY_DELAYS_429[attempt]
                        logger.warning(
                            f"[HFModelBrowser] Rate limited (429), retrying in {delay}s "
                            f"(attempt {attempt + 1}/{len(_RETRY_DELAYS_429)})..."
                        )
                        await asyncio.sleep(delay)
                        continue

                    # Exhausted retries — return cached results if available
                    if cache_key is not None:
                        cached = self._cache.get(cache_key)
                        if cached is not None:
                            logger.warning(
                                "[HFModelBrowser] Rate limit persists after retries; "
                                "returning cached results."
                            )
                            return {"_from_cache": True, "_cached_results": cached}

                    raise RuntimeError(
                        "RATE_LIMIT: HuggingFace Hub API rate limit exceeded after "
                        f"{len(_RETRY_DELAYS_429)} retries. Please wait before retrying."
                    )

                body = await resp.text()
                raise RuntimeError(
                    f"HuggingFace Hub API error {resp.status}: {body[:300]}"
                )

        raise RuntimeError("HuggingFace Hub request failed after all retries.")

    async def search(
        self,
        query: str = "",
        task: str = "text-generation",
        limit: int = 20,
        min_downloads: int = 0,
        max_size_gb: Optional[float] = None,
    ) -> List[HFModelCard]:
        """
        Search HuggingFace Hub for models.

        Args:
            query: Search keyword(s).
            task: Pipeline tag filter (e.g. "text-generation").
            limit: Maximum number of results to request from the API.
            min_downloads: Minimum download count filter (client-side).
            max_size_gb: Maximum model size in GB (client-side filter).

        Returns:
            List of HFModelCard objects.
        """
        cache_key = (query, task, limit, max_size_gb)
        cached = self._cache.get(cache_key)

        url = f"{HF_API_BASE}/models"
        params: Dict[str, Any] = {
            "sort": "downloads",
            "limit": limit,
        }
        if query:
            params["search"] = query
        if task:
            params["pipeline_tag"] = task

        try:
            data = await self._get_with_retry(url, params, cache_key=cache_key)
        except RuntimeError as exc:
            if "RATE_LIMIT" in str(exc) and cached is not None:
                logger.warning(
                    "[HFModelBrowser] Returning cached results due to rate limit."
                )
                return cached
            raise

        # Handle cache-fallback sentinel returned by _get_with_retry
        if isinstance(data, dict) and data.get("_from_cache"):
            return data["_cached_results"]

        if not isinstance(data, list):
            logger.warning(f"[HFModelBrowser] Unexpected API response type: {type(data)}")
            return []

        results: List[HFModelCard] = []
        for item in data:
            try:
                card = _parse_model_card(item)
            except Exception as exc:
                logger.debug(f"[HFModelBrowser] Failed to parse model item: {exc}")
                continue

            # Client-side filters
            if min_downloads > 0 and card.downloads < min_downloads:
                continue
            if max_size_gb is not None and card.size_bytes > max_size_gb * 1e9:
                continue

            results.append(card)

        self._cache.put(cache_key, results)
        return results

    async def get_model_info(self, model_id: str) -> HFModelCard:
        """
        Fetch metadata for a single model by its ID.

        Args:
            model_id: HuggingFace model ID (e.g. "mistralai/Mistral-7B-Instruct-v0.2").

        Returns:
            HFModelCard with model metadata.
        """
        url = f"{HF_API_BASE}/models/{model_id}"
        session = await self._ensure_session()
        headers = self._headers()

        async with session.get(url, headers=headers) as resp:
            if resp.status == 200:
                item = await resp.json()
                return _parse_model_card(item)

            body = await resp.text()
            raise RuntimeError(
                f"HuggingFace Hub API error {resp.status} for model '{model_id}': "
                f"{body[:300]}"
            )
