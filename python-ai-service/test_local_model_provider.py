"""
Tests for LocalModelProvider — unit tests and property-based tests.

Property 9: LocalModelProvider GGUF detection
  Validates: Requirements 3.1, 3.2

Property 10: MISSING_DEPENDENCY error prefix
  Validates: Requirements 3.5, 3.6

Unit tests:
  - Model instance cached after first load (no double-load)
  - unload() removes model from cache dict
  Validates: Requirements 3.3, 3.4
"""

from __future__ import annotations

import sys
import types
import unittest
from unittest.mock import MagicMock, patch

import pytest
from hypothesis import given, settings
from hypothesis import strategies as st

from local_model_provider import LocalModelProvider


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_provider() -> LocalModelProvider:
    return LocalModelProvider()


# ---------------------------------------------------------------------------
# Property 9: GGUF detection
# **Validates: Requirements 3.1, 3.2**
# ---------------------------------------------------------------------------

# Strategy: paths that end with .gguf (any case)
_gguf_extensions = st.sampled_from([".gguf", ".GGUF", ".Gguf", ".gGuF"])
_path_prefix = st.text(
    alphabet=st.characters(blacklist_characters="\x00"),
    min_size=1,
    max_size=50,
).filter(lambda s: not s.lower().endswith(".gguf"))

_gguf_path = st.builds(lambda prefix, ext: prefix + ext, _path_prefix, _gguf_extensions)

# Strategy: directory-style paths (no .gguf suffix)
_dir_path = st.text(
    alphabet=st.characters(blacklist_characters="\x00"),
    min_size=1,
    max_size=60,
).filter(lambda s: not s.lower().endswith(".gguf"))


class TestGGUFDetectionProperty:
    """Property 9: GGUF detection — any .gguf path → True; directory paths → False."""

    @given(_gguf_path)
    @settings(max_examples=200)
    def test_gguf_path_returns_true(self, path: str) -> None:
        """Any path ending in .gguf (case-insensitive) must return True."""
        provider = _make_provider()
        assert provider.is_gguf(path) is True, (
            f"Expected is_gguf({path!r}) to be True"
        )

    @given(_dir_path)
    @settings(max_examples=200)
    def test_non_gguf_path_returns_false(self, path: str) -> None:
        """Any path without .gguf extension must return False."""
        provider = _make_provider()
        assert provider.is_gguf(path) is False, (
            f"Expected is_gguf({path!r}) to be False"
        )


# ---------------------------------------------------------------------------
# Property 10: MISSING_DEPENDENCY error prefix
# **Validates: Requirements 3.5, 3.6**
# ---------------------------------------------------------------------------

class TestMissingDependencyErrorPrefix(unittest.TestCase):
    """Property 10: errors raised when backend absent must start with MISSING_DEPENDENCY:"""

    def _run_stream(self, provider: LocalModelProvider, model_path: str) -> None:
        """Helper: consume stream_chat synchronously via asyncio.run()."""
        import asyncio

        async def _consume() -> None:
            async for _ in provider.stream_chat(
                model_path, [{"role": "user", "content": "hi"}]
            ):
                pass

        asyncio.run(_consume())

    def test_gguf_missing_dependency_prefix(self) -> None:
        """MISSING_DEPENDENCY raised for GGUF when llama_cpp absent."""
        provider = _make_provider()

        with patch.dict(sys.modules, {"llama_cpp": None}):
            with self.assertRaises(RuntimeError) as ctx:
                self._run_stream(provider, "/some/model.gguf")

        self.assertTrue(
            str(ctx.exception).startswith("MISSING_DEPENDENCY:"),
            f"Expected MISSING_DEPENDENCY: prefix, got: {ctx.exception}",
        )

    def test_transformers_missing_dependency_prefix(self) -> None:
        """MISSING_DEPENDENCY raised for raw weights when transformers absent."""
        provider = _make_provider()

        with patch.dict(sys.modules, {"transformers": None}):
            with self.assertRaises(RuntimeError) as ctx:
                self._run_stream(provider, "/some/model_dir")

        self.assertTrue(
            str(ctx.exception).startswith("MISSING_DEPENDENCY:"),
            f"Expected MISSING_DEPENDENCY: prefix, got: {ctx.exception}",
        )

    def test_gguf_missing_dependency_prefix_chat(self) -> None:
        """MISSING_DEPENDENCY raised via chat() for GGUF when llama_cpp absent."""
        import asyncio

        provider = _make_provider()

        with patch.dict(sys.modules, {"llama_cpp": None}):
            with self.assertRaises(RuntimeError) as ctx:
                asyncio.run(
                    provider.chat("/some/model.gguf", [{"role": "user", "content": "hi"}])
                )

        self.assertTrue(
            str(ctx.exception).startswith("MISSING_DEPENDENCY:"),
            f"Expected MISSING_DEPENDENCY: prefix, got: {ctx.exception}",
        )


# ---------------------------------------------------------------------------
# Unit tests: caching and unload
# Validates: Requirements 3.3, 3.4
# ---------------------------------------------------------------------------

class TestModelCaching(unittest.TestCase):
    """Model instance cached after first load; unload() removes from cache."""

    def _make_mock_llama_module(self) -> types.ModuleType:
        """Create a fake llama_cpp module with a mock Llama class."""
        mock_llama_instance = MagicMock()
        mock_llama_instance.create_chat_completion.return_value = iter([
            {"choices": [{"delta": {"content": "hello"}}]},
        ])

        mock_llama_cls = MagicMock(return_value=mock_llama_instance)

        fake_module = types.ModuleType("llama_cpp")
        fake_module.Llama = mock_llama_cls  # type: ignore[attr-defined]
        return fake_module

    def test_gguf_model_cached_after_first_load(self) -> None:
        """Llama() constructor called only once even after multiple stream_chat calls."""
        fake_module = self._make_mock_llama_module()
        provider = _make_provider()

        with patch.dict(sys.modules, {"llama_cpp": fake_module}):
            # Load once
            provider._load_gguf("/model/test.gguf")
            # Load again — should hit cache
            provider._load_gguf("/model/test.gguf")

        # Llama() should have been constructed exactly once
        fake_module.Llama.assert_called_once()

    def test_unload_removes_from_cache(self) -> None:
        """unload() removes the model from _model_cache."""
        fake_module = self._make_mock_llama_module()
        provider = _make_provider()

        with patch.dict(sys.modules, {"llama_cpp": fake_module}):
            provider._load_gguf("/model/test.gguf")

        assert "/model/test.gguf" in provider._model_cache

        provider.unload("/model/test.gguf")

        assert "/model/test.gguf" not in provider._model_cache

    def test_unload_nonexistent_key_is_noop(self) -> None:
        """unload() on a path not in cache does not raise."""
        provider = _make_provider()
        provider.unload("/nonexistent/model.gguf")  # should not raise

    def test_different_paths_cached_separately(self) -> None:
        """Two different model paths are cached as separate entries."""
        fake_module = self._make_mock_llama_module()
        provider = _make_provider()

        with patch.dict(sys.modules, {"llama_cpp": fake_module}):
            provider._load_gguf("/model/a.gguf")
            provider._load_gguf("/model/b.gguf")

        assert "/model/a.gguf" in provider._model_cache
        assert "/model/b.gguf" in provider._model_cache
        # Llama() called twice — once per path
        assert fake_module.Llama.call_count == 2


# ---------------------------------------------------------------------------
# Additional unit tests: is_gguf edge cases
# ---------------------------------------------------------------------------

class TestIsGGUFEdgeCases(unittest.TestCase):
    def setUp(self) -> None:
        self.provider = _make_provider()

    def test_lowercase_gguf(self) -> None:
        assert self.provider.is_gguf("/path/to/model.gguf") is True

    def test_uppercase_gguf(self) -> None:
        assert self.provider.is_gguf("/path/to/model.GGUF") is True

    def test_mixed_case_gguf(self) -> None:
        assert self.provider.is_gguf("/path/to/model.GgUf") is True

    def test_directory_path(self) -> None:
        assert self.provider.is_gguf("/path/to/model_dir") is False

    def test_safetensors_file(self) -> None:
        assert self.provider.is_gguf("/path/to/model.safetensors") is False

    def test_bin_file(self) -> None:
        assert self.provider.is_gguf("/path/to/pytorch_model.bin") is False

    def test_gguf_in_middle_of_path(self) -> None:
        # .gguf in directory name but not at end
        assert self.provider.is_gguf("/path/gguf_models/model.bin") is False

    def test_empty_string(self) -> None:
        assert self.provider.is_gguf("") is False


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
