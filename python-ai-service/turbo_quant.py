"""
TurboQuantEngine — quantizes HuggingFace / local models to GGUF, GPTQ, or AWQ format.

All heavy backends (llama-cpp-python, auto-gptq, autoawq, huggingface_hub) are
optional imports so the module loads even when they are not installed.
"""

from __future__ import annotations

import asyncio
import json
import os
import shutil
import subprocess
import sys
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable, List, Literal, Optional
from urllib.parse import urlparse

# ---------------------------------------------------------------------------
# Optional backend imports
# ---------------------------------------------------------------------------

try:
    from huggingface_hub import snapshot_download as _hf_snapshot_download
    _HF_HUB_AVAILABLE = True
except ImportError:
    _HF_HUB_AVAILABLE = False

try:
    import llama_cpp  # noqa: F401
    _LLAMA_CPP_AVAILABLE = True
except ImportError:
    _LLAMA_CPP_AVAILABLE = False

try:
    import auto_gptq  # noqa: F401
    _AUTO_GPTQ_AVAILABLE = True
except ImportError:
    _AUTO_GPTQ_AVAILABLE = False

try:
    import awq  # noqa: F401
    _AWQ_AVAILABLE = True
except ImportError:
    _AWQ_AVAILABLE = False

# ---------------------------------------------------------------------------
# Type aliases
# ---------------------------------------------------------------------------

QuantMethod = Literal["gguf", "gptq", "awq"]

# ---------------------------------------------------------------------------
# Dataclasses
# ---------------------------------------------------------------------------


@dataclass
class QuantProgress:
    stage: str        # "downloading" | "quantizing" | "done" | "error"
    percent: int      # 0-100
    message: str = ""


@dataclass
class QuantResult:
    success: bool
    local_path: str
    ollama_name: Optional[str] = None
    error: Optional[str] = None


@dataclass
class QuantizedModelInfo:
    model_id: str
    method: str
    bits: int
    size_mb: float
    local_path: str
    created_at: str
    ollama_name: Optional[str] = None


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

_METADATA_FILE = "metadata.json"


def _is_valid_model_source(model_id: str) -> bool:
    """Return True if model_id is a HuggingFace repo id or a local path."""
    # Check for URL scheme first — must do this before path checks because
    # URLs contain '/' which would otherwise match the path heuristic.
    parsed = urlparse(model_id)
    if parsed.scheme in ("http", "https", "ftp", "file"):
        # Only allow huggingface.co URLs
        host = parsed.netloc.lower()
        return host == "huggingface.co" or host.endswith(".huggingface.co")

    # Local path — absolute or relative that exists on disk
    if os.path.exists(model_id):
        return True
    # Absolute path (starts with /)
    if model_id.startswith("/"):
        return True
    # Relative path that looks like a filesystem path (starts with . or ..)
    if model_id.startswith("."):
        return True
    # Windows-style absolute path (e.g. C:\...)
    if len(model_id) >= 2 and model_id[1] == ":":
        return True

    # HuggingFace repo id: "owner/repo" — no scheme, exactly one slash,
    # both parts non-empty
    parts = model_id.split("/")
    if len(parts) == 2 and parts[0] and parts[1]:
        return True

    return False


def _dir_size_mb(path: Path) -> float:
    total = sum(f.stat().st_size for f in path.rglob("*") if f.is_file())
    return round(total / (1024 * 1024), 2)


def _safe_model_dir_name(model_id: str) -> str:
    """Convert a model_id to a filesystem-safe directory name."""
    return model_id.replace("/", "__").replace("\\", "__")


def _is_ollama_running() -> bool:
    """Return True if the Ollama daemon is reachable."""
    try:
        result = subprocess.run(
            ["ollama", "list"],
            capture_output=True,
            timeout=5,
        )
        return result.returncode == 0
    except Exception:
        return False


# ---------------------------------------------------------------------------
# Engine
# ---------------------------------------------------------------------------


class TurboQuantEngine:
    """Quantizes models to GGUF / GPTQ / AWQ format and manages the cache."""

    def __init__(self, cache_dir: str = "~/.cache/turbo_quant") -> None:
        self.cache_dir = Path(cache_dir).expanduser().resolve()
        self.cache_dir.mkdir(parents=True, exist_ok=True)

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    async def quantize(
        self,
        model_id: str,
        method: QuantMethod,
        bits: int,
        progress_cb: Callable[[QuantProgress], None],
    ) -> QuantResult:
        """Download and quantize *model_id* using *method* at *bits* precision."""
        try:
            return await self._quantize_impl(model_id, method, bits, progress_cb)
        except Exception as exc:
            progress_cb(QuantProgress(stage="error", percent=0, message=str(exc)))
            return QuantResult(success=False, local_path="", error=str(exc))

    def list_quantized(self) -> List[QuantizedModelInfo]:
        """Return all quantized models found in the cache directory."""
        results: List[QuantizedModelInfo] = []
        for meta_file in self.cache_dir.rglob(_METADATA_FILE):
            try:
                data = json.loads(meta_file.read_text(encoding="utf-8"))
                results.append(
                    QuantizedModelInfo(
                        model_id=data["model_id"],
                        method=data["method"],
                        bits=int(data["bits"]),
                        size_mb=float(data["size_mb"]),
                        local_path=data["local_path"],
                        created_at=data["created_at"],
                        ollama_name=data.get("ollama_name"),
                    )
                )
            except Exception:
                # Skip corrupt metadata files
                continue
        return results

    def delete_quantized(self, model_id: str, method: str, bits: int) -> None:
        """Remove a quantized model directory from the cache."""
        out_dir = self._output_dir(model_id, method, bits)
        if out_dir.exists():
            shutil.rmtree(out_dir)

    # ------------------------------------------------------------------
    # Internal implementation
    # ------------------------------------------------------------------

    def _output_dir(self, model_id: str, method: str, bits: int) -> Path:
        safe_id = _safe_model_dir_name(model_id)
        return self.cache_dir / safe_id / f"{method}_{bits}bit"

    async def _quantize_impl(
        self,
        model_id: str,
        method: QuantMethod,
        bits: int,
        progress_cb: Callable[[QuantProgress], None],
    ) -> QuantResult:
        # --- Validate model source ---
        if not _is_valid_model_source(model_id):
            raise ValueError(
                f"Invalid model source '{model_id}'. "
                "Only HuggingFace repo ids (owner/repo) or local filesystem paths are allowed."
            )

        out_dir = self._output_dir(model_id, method, bits)

        # --- Idempotency: return cached result if output already exists ---
        meta_path = out_dir / _METADATA_FILE
        if meta_path.exists():
            try:
                data = json.loads(meta_path.read_text(encoding="utf-8"))
                return QuantResult(
                    success=True,
                    local_path=data["local_path"],
                    ollama_name=data.get("ollama_name"),
                )
            except Exception:
                pass  # Fall through and re-quantize if metadata is corrupt

        # --- Download / resolve local path ---
        progress_cb(QuantProgress(stage="downloading", percent=0, message=f"Downloading {model_id}…"))

        if os.path.exists(model_id):
            model_local_path = model_id
        else:
            # Check if already downloaded by LocalModelDownloader
            hf_local_cache = Path("~/.cache/hf_local_models").expanduser() / model_id.replace("/", "__")
            if hf_local_cache.exists() and any(hf_local_cache.rglob("*")):
                model_local_path = str(hf_local_cache)
            else:
                if not _HF_HUB_AVAILABLE:
                    err = "MISSING_DEPENDENCY: huggingface_hub is not installed. Install with: pip install huggingface_hub"
                    progress_cb(QuantProgress(stage="error", percent=0, message=err))
                    return QuantResult(success=False, local_path="", error=err)

                loop = asyncio.get_event_loop()
                model_local_path = await loop.run_in_executor(
                    None,
                    lambda: _hf_snapshot_download(model_id),
                )

        progress_cb(QuantProgress(stage="downloading", percent=100, message="Download complete."))

        # --- Check backend availability ---
        missing = self._check_backend(method)
        if missing:
            err = f"MISSING_DEPENDENCY: {missing}"
            progress_cb(QuantProgress(stage="error", percent=0, message=err))
            return QuantResult(success=False, local_path="", error=err)

        # --- Quantize ---
        progress_cb(QuantProgress(stage="quantizing", percent=0, message=f"Quantizing with {method} ({bits}-bit)…"))

        out_dir.mkdir(parents=True, exist_ok=True)

        if method == "gguf":
            quant_path = await self._quantize_gguf(model_local_path, out_dir, bits)
        elif method == "gptq":
            quant_path = await self._quantize_gptq(model_local_path, out_dir, bits)
        elif method == "awq":
            quant_path = await self._quantize_awq(model_local_path, out_dir, bits)
        else:
            raise ValueError(f"Unknown quantization method: {method!r}")

        progress_cb(QuantProgress(stage="quantizing", percent=100, message="Quantization complete."))

        # --- Register with Ollama (GGUF only) ---
        ollama_name: Optional[str] = None
        if method == "gguf" and _is_ollama_running():
            ollama_name = self._register_with_ollama(model_id, quant_path, bits)

        # --- Save metadata ---
        size_mb = _dir_size_mb(out_dir)
        metadata = {
            "model_id": model_id,
            "method": method,
            "bits": bits,
            "size_mb": size_mb,
            "local_path": str(quant_path),
            "created_at": datetime.now(timezone.utc).isoformat(),
            "ollama_name": ollama_name,
        }
        meta_path.write_text(json.dumps(metadata, indent=2), encoding="utf-8")

        progress_cb(QuantProgress(stage="done", percent=100, message="Done."))

        return QuantResult(
            success=True,
            local_path=str(quant_path),
            ollama_name=ollama_name,
        )

    # ------------------------------------------------------------------
    # Backend checks
    # ------------------------------------------------------------------

    def _check_backend(self, method: QuantMethod) -> Optional[str]:
        """Return an error string if the required backend is missing, else None."""
        if method == "gguf":
            if not _LLAMA_CPP_AVAILABLE:
                return (
                    "llama-cpp-python is not installed. "
                    "Install with: pip install llama-cpp-python"
                )
        elif method == "gptq":
            if not _AUTO_GPTQ_AVAILABLE:
                return (
                    "auto-gptq is not installed. "
                    "Install with: pip install auto-gptq"
                )
        elif method == "awq":
            if not _AWQ_AVAILABLE:
                return (
                    "autoawq is not installed. "
                    "Install with: pip install autoawq"
                )
        return None

    # ------------------------------------------------------------------
    # Quantization backends
    # ------------------------------------------------------------------

    async def _quantize_gguf(self, model_path: str, out_dir: Path, bits: int) -> Path:
        """Convert to GGUF using llama.cpp convert script via subprocess."""
        quant_type = "q4_0" if bits == 4 else "q8_0"
        out_file = out_dir / f"model-{quant_type}.gguf"

        # Locate the convert script bundled with llama-cpp-python
        convert_script = self._find_llama_convert_script()

        cmd = [
            sys.executable,
            convert_script,
            model_path,
            "--outfile", str(out_file),
            "--outtype", quant_type,
        ]

        loop = asyncio.get_event_loop()
        await loop.run_in_executor(None, lambda: self._run_subprocess(cmd))

        return out_file

    async def _quantize_gptq(self, model_path: str, out_dir: Path, bits: int) -> Path:
        """Quantize using auto-gptq."""
        from transformers import AutoTokenizer  # type: ignore
        from auto_gptq import AutoGPTQForCausalLM, BaseQuantizeConfig  # type: ignore

        quantize_config = BaseQuantizeConfig(bits=bits, group_size=128)
        tokenizer = AutoTokenizer.from_pretrained(model_path)
        model = AutoGPTQForCausalLM.from_pretrained(model_path, quantize_config)

        # Minimal calibration dataset
        examples = [
            tokenizer("auto-gptq quantization calibration", return_tensors="pt")
        ]

        loop = asyncio.get_event_loop()
        await loop.run_in_executor(None, lambda: model.quantize(examples))
        await loop.run_in_executor(None, lambda: model.save_quantized(str(out_dir)))

        return out_dir

    async def _quantize_awq(self, model_path: str, out_dir: Path, bits: int) -> Path:
        """Quantize using autoawq."""
        from awq import AutoAWQForCausalLM  # type: ignore
        from transformers import AutoTokenizer  # type: ignore

        quant_config = {"zero_point": True, "q_group_size": 128, "w_bit": bits, "version": "GEMM"}
        model = AutoAWQForCausalLM.from_pretrained(model_path)
        tokenizer = AutoTokenizer.from_pretrained(model_path, trust_remote_code=True)

        loop = asyncio.get_event_loop()
        await loop.run_in_executor(
            None,
            lambda: model.quantize(tokenizer, quant_config=quant_config),
        )
        await loop.run_in_executor(None, lambda: model.save_quantized(str(out_dir)))

        return out_dir

    # ------------------------------------------------------------------
    # Ollama registration
    # ------------------------------------------------------------------

    def _register_with_ollama(self, model_id: str, gguf_path: Path, bits: int) -> Optional[str]:
        """Create an Ollama model from the GGUF file and return its name."""
        try:
            safe_name = model_id.replace("/", "-").lower()
            ollama_name = f"{safe_name}-{bits}bit"

            modelfile_content = f"FROM {gguf_path}\n"
            modelfile_path = gguf_path.parent / "Modelfile"
            modelfile_path.write_text(modelfile_content, encoding="utf-8")

            self._run_subprocess(["ollama", "create", ollama_name, "-f", str(modelfile_path)])
            return ollama_name
        except Exception:
            return None

    # ------------------------------------------------------------------
    # Subprocess helper
    # ------------------------------------------------------------------

    @staticmethod
    def _run_subprocess(cmd: list) -> None:
        result = subprocess.run(cmd, capture_output=True, text=True)
        if result.returncode != 0:
            raise RuntimeError(
                f"Command {cmd[0]!r} failed (exit {result.returncode}):\n"
                f"{result.stderr or result.stdout}"
            )

    @staticmethod
    def _find_llama_convert_script() -> str:
        """Locate the llama.cpp convert_hf_to_gguf.py script."""
        # Try common locations relative to the llama_cpp package
        try:
            import llama_cpp as _lc
            pkg_dir = Path(_lc.__file__).parent
            for candidate in [
                pkg_dir / "convert_hf_to_gguf.py",
                pkg_dir.parent / "convert_hf_to_gguf.py",
                pkg_dir / "llama_cpp" / "convert_hf_to_gguf.py",
            ]:
                if candidate.exists():
                    return str(candidate)
        except Exception:
            pass

        # Fallback: assume it's on PATH or in the current directory
        fallback = Path("convert_hf_to_gguf.py")
        if fallback.exists():
            return str(fallback)

        raise FileNotFoundError(
            "Could not locate llama.cpp convert_hf_to_gguf.py script. "
            "Ensure llama-cpp-python is installed correctly."
        )
