"""
Unit tests for HFModelBrowser (Task 2.2)

Tests:
- max_size_gb filter removes oversized models
- gated flag correctly parsed from API response
- 429 rate limit triggers retry with backoff
- token passed as Bearer header when provided, omitted when not
"""

from __future__ import annotations

import asyncio
import json
from typing import Any, Dict, List
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from hf_model_browser import HFModelBrowser, HFModelCard, _parse_model_card, _LRUCache


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_item(
    model_id: str = "owner/model",
    downloads: int = 1000,
    likes: int = 10,
    size_total: int = 0,
    license: str = "apache-2.0",
    tags: List[str] = None,
    gated: Any = False,
    description: str = "",
) -> Dict[str, Any]:
    return {
        "id": model_id,
        "downloads": downloads,
        "likes": likes,
        "safetensors": {"total": size_total} if size_total else {},
        "cardData": {"license": license},
        "tags": tags or ["text-generation"],
        "gated": gated,
        "description": description,
    }


# ---------------------------------------------------------------------------
# _parse_model_card unit tests
# ---------------------------------------------------------------------------

class TestParseModelCard:
    def test_basic_fields(self):
        item = _make_item(
            model_id="owner/repo",
            downloads=5000,
            likes=42,
            size_total=1_000_000_000,
            license="mit",
            tags=["text-generation", "pytorch"],
            gated=False,
            description="A great model",
        )
        card = _parse_model_card(item)
        assert card.model_id == "owner/repo"
        assert card.downloads == 5000
        assert card.likes == 42
        assert card.size_bytes == 1_000_000_000
        assert card.license == "mit"
        assert "text-generation" in card.tags
        assert card.gated is False
        assert card.description == "A great model"

    def test_gated_false_string(self):
        item = _make_item(gated=False)
        assert _parse_model_card(item).gated is False

    def test_gated_auto_string(self):
        item = _make_item(gated="auto")
        assert _parse_model_card(item).gated is True

    def test_gated_manual_string(self):
        item = _make_item(gated="manual")
        assert _parse_model_card(item).gated is True

    def test_gated_true_bool(self):
        item = _make_item(gated=True)
        assert _parse_model_card(item).gated is True

    def test_size_bytes_zero_when_no_safetensors(self):
        item = _make_item()
        item.pop("safetensors", None)
        card = _parse_model_card(item)
        assert card.size_bytes == 0

    def test_size_bytes_zero_when_safetensors_empty(self):
        item = _make_item()
        item["safetensors"] = {}
        card = _parse_model_card(item)
        assert card.size_bytes == 0

    def test_description_truncated_to_200_chars(self):
        long_desc = "x" * 500
        item = _make_item(description=long_desc)
        card = _parse_model_card(item)
        assert len(card.description) == 200

    def test_missing_fields_use_defaults(self):
        card = _parse_model_card({})
        assert card.model_id == ""
        assert card.downloads == 0
        assert card.likes == 0
        assert card.size_bytes == 0
        assert card.license == ""
        assert card.tags == []
        assert card.gated is False
        assert card.description == ""


# ---------------------------------------------------------------------------
# _LRUCache unit tests
# ---------------------------------------------------------------------------

class TestLRUCache:
    def test_put_and_get(self):
        cache = _LRUCache(3)
        cache.put(("a",), [])
        assert cache.get(("a",)) == []

    def test_miss_returns_none(self):
        cache = _LRUCache(3)
        assert cache.get(("missing",)) is None

    def test_evicts_oldest_when_full(self):
        cache = _LRUCache(2)
        cache.put(("a",), [])
        cache.put(("b",), [])
        cache.put(("c",), [])  # should evict "a"
        assert cache.get(("a",)) is None
        assert cache.get(("b",)) is not None
        assert cache.get(("c",)) is not None

    def test_access_refreshes_lru_order(self):
        cache = _LRUCache(2)
        cache.put(("a",), [])
        cache.put(("b",), [])
        cache.get(("a",))       # refresh "a"
        cache.put(("c",), [])   # should evict "b" (least recently used)
        assert cache.get(("a",)) is not None
        assert cache.get(("b",)) is None


# ---------------------------------------------------------------------------
# HFModelBrowser.search() tests (with mocked aiohttp)
# ---------------------------------------------------------------------------

def _make_mock_response(status: int, json_data: Any = None, text_data: str = ""):
    """Create a mock aiohttp response context manager."""
    mock_resp = MagicMock()
    mock_resp.status = status
    mock_resp.json = AsyncMock(return_value=json_data)
    mock_resp.text = AsyncMock(return_value=text_data)

    cm = MagicMock()
    cm.__aenter__ = AsyncMock(return_value=mock_resp)
    cm.__aexit__ = AsyncMock(return_value=False)
    return cm


def _make_mock_session(responses: list):
    """Create a mock aiohttp.ClientSession that returns responses in order."""
    session = MagicMock()
    session.closed = False
    session.close = AsyncMock()

    call_count = [0]

    def get_side_effect(*args, **kwargs):
        idx = call_count[0]
        call_count[0] += 1
        if idx < len(responses):
            return responses[idx]
        return responses[-1]

    session.get = MagicMock(side_effect=get_side_effect)
    return session


class TestHFModelBrowserSearch:
    def _run(self, coro):
        return asyncio.run(coro)

    def test_search_returns_parsed_cards(self):
        items = [
            _make_item("owner/model-a", downloads=2000, size_total=500_000_000),
            _make_item("owner/model-b", downloads=1000, size_total=200_000_000),
        ]
        browser = HFModelBrowser()
        mock_session = _make_mock_session([_make_mock_response(200, items)])
        browser._session = mock_session

        results = self._run(browser.search("test"))
        assert len(results) == 2
        assert results[0].model_id == "owner/model-a"
        assert results[1].model_id == "owner/model-b"

    def test_max_size_gb_filter_removes_oversized(self):
        items = [
            _make_item("owner/small", size_total=1_000_000_000),   # 1 GB
            _make_item("owner/large", size_total=10_000_000_000),  # 10 GB
        ]
        browser = HFModelBrowser()
        mock_session = _make_mock_session([_make_mock_response(200, items)])
        browser._session = mock_session

        results = self._run(browser.search("test", max_size_gb=5.0))
        assert len(results) == 1
        assert results[0].model_id == "owner/small"

    def test_max_size_gb_none_includes_all(self):
        items = [
            _make_item("owner/small", size_total=1_000_000_000),
            _make_item("owner/large", size_total=10_000_000_000),
        ]
        browser = HFModelBrowser()
        mock_session = _make_mock_session([_make_mock_response(200, items)])
        browser._session = mock_session

        results = self._run(browser.search("test", max_size_gb=None))
        assert len(results) == 2

    def test_max_size_gb_exact_boundary_excluded(self):
        # size_bytes > max_size_gb * 1e9 → exclude; equal is NOT excluded
        items = [
            _make_item("owner/exact", size_total=5_000_000_000),   # exactly 5 GB
            _make_item("owner/over", size_total=5_000_000_001),    # 1 byte over
        ]
        browser = HFModelBrowser()
        mock_session = _make_mock_session([_make_mock_response(200, items)])
        browser._session = mock_session

        results = self._run(browser.search("test", max_size_gb=5.0))
        assert len(results) == 1
        assert results[0].model_id == "owner/exact"

    def test_token_included_in_header_when_provided(self):
        browser = HFModelBrowser(hf_token="hf_testtoken123")
        mock_session = _make_mock_session([_make_mock_response(200, [])])
        browser._session = mock_session

        self._run(browser.search("test"))

        call_kwargs = mock_session.get.call_args
        headers = call_kwargs[1].get("headers", {})
        assert "Authorization" in headers
        assert headers["Authorization"] == "Bearer hf_testtoken123"

    def test_token_omitted_when_not_provided(self):
        browser = HFModelBrowser()  # no token
        mock_session = _make_mock_session([_make_mock_response(200, [])])
        browser._session = mock_session

        self._run(browser.search("test"))

        call_kwargs = mock_session.get.call_args
        headers = call_kwargs[1].get("headers", {})
        assert "Authorization" not in headers

    def test_token_omitted_when_empty_string(self):
        browser = HFModelBrowser(hf_token="")
        mock_session = _make_mock_session([_make_mock_response(200, [])])
        browser._session = mock_session

        self._run(browser.search("test"))

        call_kwargs = mock_session.get.call_args
        headers = call_kwargs[1].get("headers", {})
        assert "Authorization" not in headers

    def test_429_triggers_retry_with_backoff(self):
        items = [_make_item("owner/model")]
        responses = [
            _make_mock_response(429, text_data="rate limited"),
            _make_mock_response(200, items),
        ]
        browser = HFModelBrowser()
        mock_session = _make_mock_session(responses)
        browser._session = mock_session

        with patch("hf_model_browser.asyncio.sleep", new_callable=AsyncMock) as mock_sleep:
            results = self._run(browser.search("test"))

        # Should have retried once after sleeping
        mock_sleep.assert_called_once_with(10)  # first retry delay
        assert len(results) == 1

    def test_429_returns_cached_results_after_max_retries(self):
        cached_cards = [HFModelCard("owner/cached", 100, 5, 0, "mit")]
        items = [_make_item("owner/model")]

        # First call succeeds and populates cache
        browser = HFModelBrowser()
        mock_session = _make_mock_session([_make_mock_response(200, items)])
        browser._session = mock_session
        self._run(browser.search("test"))

        # Now simulate persistent 429 (4 responses: 3 retries + 1 initial)
        responses_429 = [_make_mock_response(429, text_data="rate limited")] * 4
        browser._session = _make_mock_session(responses_429)

        with patch("hf_model_browser.asyncio.sleep", new_callable=AsyncMock):
            results = self._run(browser.search("test"))

        # Should return cached results
        assert len(results) == 1
        assert results[0].model_id == "owner/model"

    def test_results_cached_after_successful_search(self):
        items = [_make_item("owner/model")]
        browser = HFModelBrowser()
        mock_session = _make_mock_session([_make_mock_response(200, items)])
        browser._session = mock_session

        self._run(browser.search("test"))

        cache_key = ("test", "text-generation", 20, None)
        cached = browser._cache.get(cache_key)
        assert cached is not None
        assert len(cached) == 1

    def test_search_passes_correct_params(self):
        browser = HFModelBrowser()
        mock_session = _make_mock_session([_make_mock_response(200, [])])
        browser._session = mock_session

        self._run(browser.search("llama", task="text-generation", limit=10))

        call_kwargs = mock_session.get.call_args
        params = call_kwargs[1].get("params", {})
        assert params["search"] == "llama"
        assert params["pipeline_tag"] == "text-generation"
        assert params["sort"] == "downloads"
        assert params["limit"] == 10


# ---------------------------------------------------------------------------
# HFModelBrowser.get_model_info() tests
# ---------------------------------------------------------------------------

class TestHFModelBrowserGetModelInfo:
    def _run(self, coro):
        return asyncio.run(coro)

    def test_get_model_info_returns_card(self):
        item = _make_item("owner/specific-model", downloads=9999, likes=100)
        browser = HFModelBrowser()
        mock_session = MagicMock()
        mock_session.closed = False
        mock_resp = MagicMock()
        mock_resp.status = 200
        mock_resp.json = AsyncMock(return_value=item)
        cm = MagicMock()
        cm.__aenter__ = AsyncMock(return_value=mock_resp)
        cm.__aexit__ = AsyncMock(return_value=False)
        mock_session.get = MagicMock(return_value=cm)
        browser._session = mock_session

        card = self._run(browser.get_model_info("owner/specific-model"))
        assert card.model_id == "owner/specific-model"
        assert card.downloads == 9999

    def test_get_model_info_raises_on_error(self):
        browser = HFModelBrowser()
        mock_session = MagicMock()
        mock_session.closed = False
        mock_resp = MagicMock()
        mock_resp.status = 404
        mock_resp.text = AsyncMock(return_value="Not Found")
        cm = MagicMock()
        cm.__aenter__ = AsyncMock(return_value=mock_resp)
        cm.__aexit__ = AsyncMock(return_value=False)
        mock_session.get = MagicMock(return_value=cm)
        browser._session = mock_session

        with pytest.raises(RuntimeError, match="404"):
            self._run(browser.get_model_info("owner/nonexistent"))
