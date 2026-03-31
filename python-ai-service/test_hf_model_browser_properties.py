"""
Property-based tests for HFModelBrowser (Task 2.1)

**Property 12: HF search results match task filter**
Every returned HFModelCard must have the requested task in its tags.

**Validates: Requirements 1.1, 1.2**

Uses hypothesis for property-based testing.
"""

from __future__ import annotations

import asyncio
from typing import Any, Dict, List
from unittest.mock import AsyncMock, MagicMock

import pytest
from hypothesis import given, settings, assume
from hypothesis import strategies as st

from hf_model_browser import HFModelBrowser, HFModelCard, _parse_model_card


# ---------------------------------------------------------------------------
# Strategies
# ---------------------------------------------------------------------------

# Valid HF model ID pattern: owner/repo
model_id_strategy = st.from_regex(r"[A-Za-z0-9_.-]{1,20}/[A-Za-z0-9_.-]{1,30}", fullmatch=True)

# Task/pipeline_tag values
task_strategy = st.sampled_from([
    "text-generation",
    "text2text-generation",
    "fill-mask",
    "token-classification",
    "question-answering",
    "summarization",
    "translation",
    "image-classification",
    "automatic-speech-recognition",
])

# Strategy for a model item that includes the requested task in its tags
def model_item_with_task(task: str) -> st.SearchStrategy[Dict[str, Any]]:
    """Generate a model API response item that includes the given task in tags."""
    extra_tags = st.lists(
        st.sampled_from(["pytorch", "transformers", "en", "license:apache-2.0", "arxiv:2301.00001"]),
        min_size=0,
        max_size=4,
    )
    return st.fixed_dictionaries({
        "id": model_id_strategy,
        "downloads": st.integers(min_value=0, max_value=10_000_000),
        "likes": st.integers(min_value=0, max_value=100_000),
        "safetensors": st.one_of(
            st.just({}),
            st.fixed_dictionaries({"total": st.integers(min_value=0, max_value=50_000_000_000)}),
        ),
        "cardData": st.fixed_dictionaries({
            "license": st.sampled_from(["apache-2.0", "mit", "cc-by-4.0", "llama2", ""]),
        }),
        "tags": extra_tags.map(lambda extras: [task] + extras),
        "gated": st.sampled_from([False, "auto", "manual", True]),
        "description": st.text(max_size=300),
    })


def _make_mock_session_from_items(items: List[Dict[str, Any]]) -> MagicMock:
    """Create a mock aiohttp session that returns the given items as a 200 response."""
    mock_resp = MagicMock()
    mock_resp.status = 200
    mock_resp.json = AsyncMock(return_value=items)
    mock_resp.text = AsyncMock(return_value="")

    cm = MagicMock()
    cm.__aenter__ = AsyncMock(return_value=mock_resp)
    cm.__aexit__ = AsyncMock(return_value=False)

    session = MagicMock()
    session.closed = False
    session.get = MagicMock(return_value=cm)
    return session


# ---------------------------------------------------------------------------
# Property 12: HF search results match task filter
# ---------------------------------------------------------------------------

class TestProperty12SearchResultsMatchTaskFilter:
    """
    Property 12: HF search results match task filter

    Every returned HFModelCard must have the requested task in its tags
    (as returned by the HF Hub API pipeline_tag field).

    Validates: Requirements 1.1, 1.2
    """

    @given(
        task=task_strategy,
        items=st.lists(
            st.one_of(
                # Items that include the task tag (should pass through)
                task_strategy.flatmap(lambda t: model_item_with_task(t)),
            ),
            min_size=0,
            max_size=10,
        ).flatmap(lambda items: st.just(items)),
    )
    @settings(max_examples=50)
    def test_all_results_contain_requested_task_in_tags(self, task: str, items: List[Dict]):
        """
        Property: For any call to HFModelBrowser.search(task=X), every HFModelCard
        in the result must have X in its tags list.

        The HF API is responsible for filtering by pipeline_tag — we verify that
        our parser preserves the tags faithfully so the UI can rely on them.
        """
        # Build items that all include the requested task in their tags
        task_items = []
        for item in items:
            # Ensure the task is in the tags for this test
            tags = list(item.get("tags", []))
            if task not in tags:
                tags = [task] + tags
            task_items.append({**item, "tags": tags})

        browser = HFModelBrowser()
        browser._session = _make_mock_session_from_items(task_items)

        results = asyncio.run(browser.search(query="", task=task))

        # Property: every result must have the requested task in its tags
        for card in results:
            assert task in card.tags, (
                f"Expected task '{task}' in tags of model '{card.model_id}', "
                f"but got tags: {card.tags}"
            )

    @given(
        task=task_strategy,
        n_items=st.integers(min_value=1, max_value=15),
    )
    @settings(max_examples=30)
    def test_parse_preserves_tags_faithfully(self, task: str, n_items: int):
        """
        Property: _parse_model_card preserves the tags list from the API response.
        If the API returns a model with task in tags, the parsed card must also have it.
        """
        item = {
            "id": "owner/model",
            "downloads": 100,
            "likes": 5,
            "safetensors": {},
            "cardData": {"license": "mit"},
            "tags": [task, "pytorch"],
            "gated": False,
            "description": "",
        }
        card = _parse_model_card(item)
        assert task in card.tags

    @given(
        task=task_strategy,
        extra_tags=st.lists(
            st.text(min_size=1, max_size=30, alphabet=st.characters(whitelist_categories=("Ll", "Lu", "Nd"), whitelist_characters="-_")),
            min_size=0,
            max_size=5,
        ),
    )
    @settings(max_examples=50)
    def test_tags_list_is_superset_of_api_tags(self, task: str, extra_tags: List[str]):
        """
        Property: The parsed HFModelCard.tags must be a superset of the tags
        returned by the API (no tags are dropped during parsing).
        """
        api_tags = [task] + extra_tags
        item = {
            "id": "owner/model",
            "downloads": 0,
            "likes": 0,
            "safetensors": {},
            "cardData": {},
            "tags": api_tags,
            "gated": False,
            "description": "",
        }
        card = _parse_model_card(item)
        for tag in api_tags:
            assert tag in card.tags, (
                f"Tag '{tag}' from API response was dropped during parsing. "
                f"Got: {card.tags}"
            )
