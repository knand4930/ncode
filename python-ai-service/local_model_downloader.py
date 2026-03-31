"""
LocalModelDownloader — downloads HuggingFace model weights to a local cache directory.

huggingface_hub is an optional import; the module loads without it and surfaces
a MISSING_DEPENDENCY error on demand.
"""

from __future__ import annotations

import json
import os
import shutil
import threading
import time
import urllib.request
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable, List, Optional

from turbo_quant import _is_valid_model_source

# ---------------------------------------------------------------------------
# Optional backend import
# ---------------------------------------------------------------------------

try:
    import huggingface_hub as _hf_hub
    _HF_HUB_AVAILABLE = True
except ImportError:
    _hf_hub = None  # type: ignore
    _HF_HUB_AVAILABLE = False

# ---------------------------------------------------------------------------
# Dataclasses
# ---------------------------------------------------------------------------


@dataclass
class DownloadProgress:
    model_id: str
    bytes_done: int
    bytes_total: int        # 0 if unknown
    speed_bps: int
    done: bool = False
    error: Optional[str] = None
    local_path: Optional[str] = None


@dataclass
class DownloadResult:
    success: bool
    local_path: str
    size_bytes: int
    error: Optional[str] = None


@dataclass
class LocalModelInfo:
    model_id: str
    local_path: str
    size_bytes: int
    downloaded_at: str      # ISO 8601
    quantized_path: Optional[str] = None
    quantized_method: Optional[str] = None
    quantized_bits: Optional[int] = None


# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

_INFO_FILE = "local_model_info.json"
_HF_API_BASE = "https://huggingface.co/api/models"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _safe_dir_name(model_id: str) -> str:
    """Convert owner/repo to owner__repo for filesystem safety."""
    return model_id.replace("/", "__")


def _dir_size_bytes(path: Path) -> int:
    return sum(f.stat().st_size for f in path.rglob("*") if f.is_file())


# ---------------------------------------------------------------------------
# Custom tqdm subclass for progress reporting
# ---------------------------------------------------------------------------


def _make_progress_tqdm(model_id: str, progress_cb: Callable[[DownloadProgress], None], cancel_event: threading.Event):
    """
    Return a tqdm subclass that calls progress_cb on each update and checks
    the cancel_event to abort the download.
    """
    try:
        from tqdm import tqdm as _tqdm_base
    except ImportError:
        # If tqdm is not available, return a no-op class
        class _NoOpTqdm:
            def __init__(self, *args, **kwargs):
                pass
            def update(self, n=1):
                pass
            def close(self):
                pass
            def __enter__(self):
                return self
            def __exit__(self, *args):
                pass
        return _NoOpTqdm

    class _ProgressTqdm(_tqdm_base):
        def __init__(self, *args, **kwargs):
            super().__init__(*args, **kwargs)
            self._last_update_time: float = time.time()
            self._last_bytes: int = 0

        def update(self, n: int = 1) -> None:
            if cancel_event.is_set():
                raise RuntimeError(f"Download cancelled for model {model_id}")

            super().update(n)

            now = time.time()
            elapsed = now - self._last_update_time
            if elapsed > 0:
                speed_bps = int((self.n - self._last_bytes) / elapsed)
            else:
                speed_bps = 0

            self._last_update_time = now
            self._last_bytes = self.n

            progress_cb(DownloadProgress(
                model_id=model_id,
                bytes_done=self.n,
                bytes_total=self.total or 0,
                speed_bps=max(0, speed_bps),
            ))

    return _ProgressTqdm


# ---------------------------------------------------------------------------
# Main class
# ---------------------------------------------------------------------------


class LocalModelDownloader:
    """Downloads HuggingFace model weights to a local cache directory."""

    def __init__(
        self,
        cache_dir: str = "~/.cache/hf_local_models",
        hf_token: Optional[str] = None,
    ) -> None:
        self.cache_dir = Path(cache_dir).expanduser().resolve()
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        self.hf_token = hf_token
        # Per-model cancel events
        self._cancel_events: dict[str, threading.Event] = {}

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def download(
        self,
        model_id: str,
        progress_cb: Callable[[DownloadProgress], None],
    ) -> DownloadResult:
        """Download model weights from HuggingFace Hub."""
        if not _HF_HUB_AVAILABLE:
            return DownloadResult(
                success=False,
                local_path="",
                size_bytes=0,
                error=(
                    "MISSING_DEPENDENCY: huggingface_hub is not installed. "
                    "Install with: pip install huggingface_hub"
                ),
            )

        # Validate model source
        if not _is_valid_model_source(model_id):
            return DownloadResult(
                success=False,
                local_path="",
                size_bytes=0,
                error=f"INVALID_MODEL_SOURCE: '{model_id}' is not a valid HuggingFace repo id or local path.",
            )

        # Check disk space
        required_bytes = self.get_disk_requirement(model_id)
        if required_bytes and required_bytes > 0:
            try:
                usage = shutil.disk_usage(str(self.cache_dir))
                free_bytes = usage.free
                if required_bytes > free_bytes:
                    required_gb = required_bytes / (1024 ** 3)
                    free_gb = free_bytes / (1024 ** 3)
                    return DownloadResult(
                        success=False,
                        local_path="",
                        size_bytes=0,
                        error=(
                            f"INSUFFICIENT_DISK_SPACE: This model requires ~{required_gb:.1f}GB "
                            f"but only {free_gb:.1f}GB is available."
                        ),
                    )
            except Exception:
                pass  # If disk check fails, proceed anyway

        # Set up cancel event
        cancel_event = threading.Event()
        self._cancel_events[model_id] = cancel_event

        # Determine local directory
        safe_name = _safe_dir_name(model_id)
        local_dir = self.cache_dir / safe_name

        try:
            tqdm_cls = _make_progress_tqdm(model_id, progress_cb, cancel_event)

            token = self.hf_token if self.hf_token else None

            local_path = _hf_hub.snapshot_download(
                repo_id=model_id,
                local_dir=str(local_dir),
                token=token,
                tqdm_class=tqdm_cls,
            )

            # Calculate total size
            size_bytes = _dir_size_bytes(Path(local_path))

            # Write metadata
            info = LocalModelInfo(
                model_id=model_id,
                local_path=local_path,
                size_bytes=size_bytes,
                downloaded_at=datetime.now(timezone.utc).isoformat(),
            )
            info_path = Path(local_path) / _INFO_FILE
            info_path.write_text(
                json.dumps(asdict(info), indent=2), encoding="utf-8"
            )

            # Emit final done event
            progress_cb(DownloadProgress(
                model_id=model_id,
                bytes_done=size_bytes,
                bytes_total=size_bytes,
                speed_bps=0,
                done=True,
                local_path=local_path,
            ))

            return DownloadResult(
                success=True,
                local_path=local_path,
                size_bytes=size_bytes,
            )

        except RuntimeError as exc:
            err_msg = str(exc)
            if "cancelled" in err_msg.lower():
                return DownloadResult(
                    success=False,
                    local_path="",
                    size_bytes=0,
                    error="CANCELLED: Download was cancelled by user.",
                )
            return DownloadResult(
                success=False,
                local_path="",
                size_bytes=0,
                error=f"DOWNLOAD_ERROR: {err_msg}",
            )
        except Exception as exc:
            return DownloadResult(
                success=False,
                local_path="",
                size_bytes=0,
                error=f"DOWNLOAD_ERROR: {exc}",
            )
        finally:
            self._cancel_events.pop(model_id, None)

    def cancel(self, model_id: str) -> None:
        """Signal cancellation for an in-progress download."""
        event = self._cancel_events.get(model_id)
        if event:
            event.set()

    def get_disk_requirement(self, model_id: str) -> Optional[int]:
        """
        Estimate disk space required for the model in bytes.
        Queries the HF Hub API for safetensors total size.
        Returns 0 if unknown.
        """
        try:
            url = f"{_HF_API_BASE}/{model_id}"
            req = urllib.request.Request(url)
            if self.hf_token:
                req.add_header("Authorization", f"Bearer {self.hf_token}")
            req.add_header("User-Agent", "local-model-downloader/1.0")

            with urllib.request.urlopen(req, timeout=10) as resp:
                data = json.loads(resp.read().decode("utf-8"))

            # Try safetensors.total first
            safetensors = data.get("safetensors", {})
            if isinstance(safetensors, dict):
                total = safetensors.get("total")
                if total is not None:
                    return int(total)

            # Fallback: sum up sibling file sizes
            siblings = data.get("siblings", [])
            if siblings:
                total = sum(
                    s.get("size", 0) for s in siblings
                    if isinstance(s, dict) and s.get("size")
                )
                if total > 0:
                    return total

            return 0
        except Exception:
            return 0

    def list_downloaded(self) -> List[LocalModelInfo]:
        """Scan cache_dir for local_model_info.json files and return parsed list."""
        results: List[LocalModelInfo] = []
        for info_file in self.cache_dir.rglob(_INFO_FILE):
            try:
                data = json.loads(info_file.read_text(encoding="utf-8"))
                results.append(LocalModelInfo(
                    model_id=data["model_id"],
                    local_path=data["local_path"],
                    size_bytes=int(data["size_bytes"]),
                    downloaded_at=data["downloaded_at"],
                    quantized_path=data.get("quantized_path"),
                    quantized_method=data.get("quantized_method"),
                    quantized_bits=data.get("quantized_bits"),
                ))
            except Exception:
                continue
        return results

    def delete(self, model_id: str) -> None:
        """Remove the model directory from the cache."""
        safe_name = _safe_dir_name(model_id)
        model_dir = self.cache_dir / safe_name
        if model_dir.exists():
            shutil.rmtree(model_dir)
