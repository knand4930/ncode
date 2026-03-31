"""
LocalModelProvider — run locally downloaded models for inference.

Supports:
  - GGUF files via llama-cpp-python (CPU-friendly, no GPU required)
  - Raw HuggingFace weights via transformers + TextIteratorStreamer

Both backends are optional imports; the module loads without them and raises
MISSING_DEPENDENCY errors on demand.
"""

from __future__ import annotations

import threading
from typing import Any, AsyncIterator, Dict, List, Optional


def _is_oom_error(exc: Exception) -> bool:
    """Return True if the exception looks like an out-of-memory error."""
    msg = str(exc).lower()
    return "out of memory" in msg or "oom" in msg


class LocalModelProvider:
    """Run locally downloaded models for inference (GGUF or raw weights)."""

    def __init__(self, cache_dir: str = "~/.cache/hf_local_models") -> None:
        self.cache_dir = cache_dir
        self._model_cache: Dict[str, Any] = {}

    # ------------------------------------------------------------------
    # Public helpers
    # ------------------------------------------------------------------

    def is_gguf(self, model_path: str) -> bool:
        """Return True if model_path points to a GGUF file."""
        return model_path.lower().endswith(".gguf")

    def unload(self, model_path: str) -> None:
        """Remove a loaded model from the in-memory cache to free RAM."""
        self._model_cache.pop(model_path, None)

    # ------------------------------------------------------------------
    # GGUF backend (llama-cpp-python)
    # ------------------------------------------------------------------

    def _load_gguf(self, model_path: str) -> Any:
        """Load (or return cached) a llama-cpp-python Llama instance."""
        if model_path in self._model_cache:
            return self._model_cache[model_path]

        try:
            from llama_cpp import Llama  # type: ignore[import]
        except ImportError:
            raise RuntimeError(
                "MISSING_DEPENDENCY: llama-cpp-python is not installed. "
                "Install with: pip install llama-cpp-python"
            )

        try:
            llama = Llama(model_path=model_path, n_ctx=4096, verbose=False)
        except MemoryError as exc:
            raise RuntimeError(
                "OUT_OF_MEMORY: Model requires more RAM than available. "
                "Consider quantizing with TurboQuant first."
            ) from exc
        except RuntimeError as exc:
            if _is_oom_error(exc):
                raise RuntimeError(
                    "OUT_OF_MEMORY: Model requires more RAM than available. "
                    "Consider quantizing with TurboQuant first."
                ) from exc
            raise

        self._model_cache[model_path] = llama
        return llama

    async def _stream_chat_gguf(
        self,
        model_path: str,
        messages: List[Dict],
        max_tokens: int,
        temperature: float,
    ) -> AsyncIterator[str]:
        """Async generator that yields tokens from a GGUF model."""
        try:
            llama = self._load_gguf(model_path)
        except MemoryError as exc:
            raise RuntimeError(
                "OUT_OF_MEMORY: Model requires more RAM than available. "
                "Consider quantizing with TurboQuant first."
            ) from exc

        try:
            stream = llama.create_chat_completion(
                messages=messages,
                max_tokens=max_tokens,
                temperature=temperature,
                stream=True,
            )
            for chunk in stream:
                token = chunk["choices"][0]["delta"].get("content", "")
                if token:
                    yield token
        except MemoryError as exc:
            raise RuntimeError(
                "OUT_OF_MEMORY: Model requires more RAM than available. "
                "Consider quantizing with TurboQuant first."
            ) from exc
        except RuntimeError as exc:
            if _is_oom_error(exc):
                raise RuntimeError(
                    "OUT_OF_MEMORY: Model requires more RAM than available. "
                    "Consider quantizing with TurboQuant first."
                ) from exc
            raise

    # ------------------------------------------------------------------
    # Raw weights backend (transformers)
    # ------------------------------------------------------------------

    def _load_transformers(self, model_path: str) -> tuple:
        """Load (or return cached) tokenizer + model from a raw weights directory."""
        if model_path in self._model_cache:
            return self._model_cache[model_path]

        try:
            from transformers import (  # type: ignore[import]
                AutoModelForCausalLM,
                AutoTokenizer,
                TextIteratorStreamer,
            )
        except ImportError:
            raise RuntimeError(
                "MISSING_DEPENDENCY: transformers is not installed. "
                "Install with: pip install transformers torch"
            )

        try:
            tokenizer = AutoTokenizer.from_pretrained(model_path)
            model = AutoModelForCausalLM.from_pretrained(model_path)
        except MemoryError as exc:
            raise RuntimeError(
                "OUT_OF_MEMORY: Model requires more RAM than available. "
                "Consider quantizing with TurboQuant first."
            ) from exc
        except RuntimeError as exc:
            if _is_oom_error(exc):
                raise RuntimeError(
                    "OUT_OF_MEMORY: Model requires more RAM than available. "
                    "Consider quantizing with TurboQuant first."
                ) from exc
            raise

        self._model_cache[model_path] = (tokenizer, model)
        return tokenizer, model

    async def _stream_chat_transformers(
        self,
        model_path: str,
        messages: List[Dict],
        max_tokens: int,
        temperature: float,
    ) -> AsyncIterator[str]:
        """Async generator that yields tokens from a raw weights model."""
        try:
            from transformers import TextIteratorStreamer  # type: ignore[import]
        except ImportError:
            raise RuntimeError(
                "MISSING_DEPENDENCY: transformers is not installed. "
                "Install with: pip install transformers torch"
            )

        try:
            tokenizer, model = self._load_transformers(model_path)
        except MemoryError as exc:
            raise RuntimeError(
                "OUT_OF_MEMORY: Model requires more RAM than available. "
                "Consider quantizing with TurboQuant first."
            ) from exc

        # Build a simple prompt from messages
        prompt = "\n".join(
            f"{m.get('role', 'user')}: {m.get('content', '')}" for m in messages
        )
        inputs = tokenizer(prompt, return_tensors="pt")

        streamer = TextIteratorStreamer(
            tokenizer, skip_prompt=True, skip_special_tokens=True
        )

        generate_kwargs = dict(
            **inputs,
            streamer=streamer,
            max_new_tokens=max_tokens,
            temperature=temperature,
            do_sample=temperature > 0,
        )

        exc_holder: List[Optional[Exception]] = [None]

        def _generate() -> None:
            try:
                model.generate(**generate_kwargs)
            except MemoryError as exc:
                exc_holder[0] = RuntimeError(
                    "OUT_OF_MEMORY: Model requires more RAM than available. "
                    "Consider quantizing with TurboQuant first."
                )
            except RuntimeError as exc:
                if _is_oom_error(exc):
                    exc_holder[0] = RuntimeError(
                        "OUT_OF_MEMORY: Model requires more RAM than available. "
                        "Consider quantizing with TurboQuant first."
                    )
                else:
                    exc_holder[0] = exc

        thread = threading.Thread(target=_generate, daemon=True)
        thread.start()

        for token in streamer:
            if exc_holder[0] is not None:
                raise exc_holder[0]
            yield token

        thread.join()
        if exc_holder[0] is not None:
            raise exc_holder[0]

    # ------------------------------------------------------------------
    # Public async API
    # ------------------------------------------------------------------

    async def stream_chat(
        self,
        model_path: str,
        messages: List[Dict],
        max_tokens: int = 512,
        temperature: float = 0.7,
    ) -> AsyncIterator[str]:
        """Async generator that streams response tokens from a local model."""
        if self.is_gguf(model_path):
            async for token in self._stream_chat_gguf(
                model_path, messages, max_tokens, temperature
            ):
                yield token
        else:
            async for token in self._stream_chat_transformers(
                model_path, messages, max_tokens, temperature
            ):
                yield token

    async def chat(
        self,
        model_path: str,
        messages: List[Dict],
        max_tokens: int = 512,
        temperature: float = 0.7,
    ) -> str:
        """Return the full response string from a local model."""
        tokens: List[str] = []
        async for token in self.stream_chat(model_path, messages, max_tokens, temperature):
            tokens.append(token)
        return "".join(tokens)
