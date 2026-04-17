"""Unified GPU detection via nvidia-smi.

Single source of truth for both STT (faster-whisper) and LLM (llama-cpp-python)
pipelines.  Uses nvidia-smi rather than torch.cuda so that GPU detection works
even when PyTorch is not installed.
"""

import os
import subprocess

_gpu_cache: bool | None = None


def detect_gpu() -> bool:
    """Return True if an NVIDIA GPU is available (nvidia-smi succeeds)."""
    global _gpu_cache
    if _gpu_cache is not None:
        return _gpu_cache

    try:
        result = subprocess.run(
            ["nvidia-smi"],
            capture_output=True,
            timeout=5,
            creationflags=0x08000000 if os.name == "nt" else 0,
        )
        _gpu_cache = result.returncode == 0
    except (FileNotFoundError, subprocess.TimeoutExpired, OSError):
        _gpu_cache = False

    return _gpu_cache


def get_stt_device() -> tuple[str, str]:
    """Return (device, compute_type) for faster-whisper.

    `compute_type="default"` lets CTranslate2 pick the math precision that
    matches the model's stored quantization. This matters because different
    Whisper variants ship in different formats:
      - Whisper Large-v3 (upstream Systran):       float16  (~3.1 GB)
      - Kotoba-Whisper v2 (japanese fine-tune):    int8     (~1.5 GB)
      - Qwen3-ASR is loaded through a separate code path
    Forcing "float16" onto an int8-stored model made CT2's temperature
    retry path segfault on Windows (observed on 2.5h audio with Kotoba).
    """
    if detect_gpu():
        return "cuda", "default"
    return "cpu", "default"


def get_llm_n_gpu_layers() -> int:
    """Return default n_gpu_layers for llama-cpp-python.

    - GPU present  → -1  (offload all layers)
    - CPU fallback →  0
    """
    return -1 if detect_gpu() else 0
