"""LLM engine wrapping llama-cpp-python.

Singleton model pattern: Llama is loaded once into `_model` and reused
across jobs to avoid repeated load times.
"""

import asyncio
import json
import os
import subprocess
import uuid
from enum import Enum
from pathlib import Path
from typing import Any, AsyncGenerator

try:
    from llama_cpp import Llama
except ImportError:
    Llama = None  # type: ignore[misc,assignment]

import prompt_builder


# ── Model singleton ────────────────────────────────────────────────

_model: Any = None
_loaded_model_id: str | None = None


def _resolve_model_dir() -> Path:
    return Path(os.environ.get("MODEL_DIR", "./models"))


def _find_llm_model_path(model_id: str) -> Path | None:
    """Return the .gguf file path for the given model_id."""
    base = _resolve_model_dir() / model_id
    if not base.exists():
        return None
    for f in base.iterdir():
        if f.suffix == ".gguf" and f.is_file():
            return f
    return None


def _get_n_gpu_layers() -> int:
    """Detect NVIDIA GPU via nvidia-smi. Returns -1 (all GPU) or 0 (CPU)."""
    try:
        result = subprocess.run(
            ["nvidia-smi"],
            capture_output=True,
            timeout=5,
            creationflags=0x08000000 if os.name == "nt" else 0,
        )
        if result.returncode == 0:
            return -1
    except (FileNotFoundError, subprocess.TimeoutExpired, OSError):
        pass
    return 0


def load_model(model_id: str, n_gpu_layers: int | None = None) -> bool:
    global _model, _loaded_model_id

    if Llama is None:
        raise RuntimeError("llama-cpp-python is not installed")

    if _model is not None and _loaded_model_id == model_id:
        return True

    model_path = _find_llm_model_path(model_id)
    if model_path is None:
        raise FileNotFoundError(f"LLM model not found: {model_id}")

    if n_gpu_layers is None:
        n_gpu_layers = _get_n_gpu_layers()

    # Try GPU first, fallback to CPU
    if n_gpu_layers != 0:
        try:
            _model = Llama(
                model_path=str(model_path),
                n_gpu_layers=n_gpu_layers,
                n_ctx=4096,
                verbose=False,
            )
            _loaded_model_id = model_id
            return True
        except Exception:
            pass  # fallback to CPU

    _model = Llama(
        model_path=str(model_path),
        n_gpu_layers=0,
        n_ctx=4096,
        verbose=False,
    )
    _loaded_model_id = model_id
    return True


def unload_model() -> None:
    global _model, _loaded_model_id
    _model = None
    _loaded_model_id = None


def is_model_loaded() -> bool:
    return _model is not None


# ── Job management ─────────────────────────────────────────────────

class TranslateJobState(str, Enum):
    QUEUED = "QUEUED"
    RUNNING = "RUNNING"
    DONE = "DONE"
    FAILED = "FAILED"
    CANCELED = "CANCELED"


_translate_jobs: dict[str, dict[str, Any]] = {}


def create_translate_job(
    segments: list[dict[str, Any]],
    source_lang: str,
    target_lang: str,
    context_window: int = 2,
    style_preset: str = "natural",
    glossary: list[dict[str, str]] | None = None,
    model_id: str | None = None,
) -> str:
    job_id = str(uuid.uuid4())
    _translate_jobs[job_id] = {
        "id": job_id,
        "segments": segments,
        "source_lang": source_lang,
        "target_lang": target_lang,
        "context_window": context_window,
        "style_preset": style_preset,
        "glossary": glossary or [],
        "model_id": model_id,
        "state": TranslateJobState.QUEUED,
        "cancel_flag": False,
    }
    return job_id


def cancel_translate_job(job_id: str) -> bool:
    job = _translate_jobs.get(job_id)
    if job is None:
        return False
    if job["state"] in (TranslateJobState.DONE, TranslateJobState.FAILED, TranslateJobState.CANCELED):
        return False
    job["cancel_flag"] = True
    return True


def get_translate_job(job_id: str) -> dict[str, Any] | None:
    return _translate_jobs.get(job_id)


# ── SSE generator ──────────────────────────────────────────────────

async def run_translate(job_id: str) -> AsyncGenerator[dict[str, Any], None]:
    """Async generator yielding SSE events during translation."""
    job = _translate_jobs.get(job_id)
    if job is None:
        yield {"type": "error", "job_id": job_id, "error": "Job not found"}
        return

    job["state"] = TranslateJobState.RUNNING

    # Determine model_id — fallback to first available LLM model
    model_id = job.get("model_id")
    if not model_id:
        model_dir = _resolve_model_dir()
        if model_dir.exists():
            for d in model_dir.iterdir():
                if d.is_dir() and any(f.suffix == ".gguf" for f in d.iterdir() if f.is_file()):
                    model_id = d.name
                    break
    if not model_id:
        yield {"type": "error", "job_id": job_id, "error": "No LLM model available"}
        job["state"] = TranslateJobState.FAILED
        return

    # Load model if needed
    if not is_model_loaded() or _loaded_model_id != model_id:
        yield {
            "type": "translate_progress",
            "job_id": job_id,
            "progress": 0,
            "message": "Loading LLM model...",
        }
        try:
            await asyncio.get_running_loop().run_in_executor(None, load_model, model_id)
        except Exception as e:
            yield {"type": "error", "job_id": job_id, "error": f"Failed to load LLM: {e}"}
            job["state"] = TranslateJobState.FAILED
            return

    if job["cancel_flag"]:
        job["state"] = TranslateJobState.CANCELED
        yield {"type": "cancelled", "job_id": job_id}
        return

    yield {
        "type": "translate_progress",
        "job_id": job_id,
        "progress": 0,
        "message": "Starting translation...",
    }

    segments = job["segments"]
    source_lang = job["source_lang"]
    target_lang = job["target_lang"]
    context_window = job["context_window"]
    style_preset = job["style_preset"]
    glossary = job["glossary"]
    total = len(segments)
    all_results: list[dict[str, Any]] = []

    try:
        loop = asyncio.get_running_loop()

        for i in range(total):
            if job["cancel_flag"]:
                job["state"] = TranslateJobState.CANCELED
                yield {"type": "cancelled", "job_id": job_id}
                return

            messages = prompt_builder.build_messages(
                segments, i,
                source_lang=source_lang,
                target_lang=target_lang,
                context_window=context_window,
                style_preset=style_preset,
                glossary=glossary,
            )

            # Run LLM inference in executor (blocking call)
            def _infer(msgs=messages):
                return _model.create_chat_completion(
                    messages=msgs,
                    max_tokens=512,
                )

            response = await loop.run_in_executor(None, _infer)

            translated = ""
            if response and "choices" in response and len(response["choices"]) > 0:
                translated = response["choices"][0].get("message", {}).get("content", "").strip()

            original = segments[i].get("text", "")
            result_entry = {
                "index": i,
                "original": original,
                "translated": translated,
            }
            all_results.append(result_entry)

            yield {
                "type": "translate_segment",
                "job_id": job_id,
                **result_entry,
            }

            progress = min(int(((i + 1) / total) * 100), 99)
            yield {
                "type": "translate_progress",
                "job_id": job_id,
                "progress": progress,
                "message": f"Translating... ({i + 1}/{total} segments)",
            }

            await asyncio.sleep(0)  # yield control

        # Done
        job["state"] = TranslateJobState.DONE
        yield {
            "type": "done",
            "job_id": job_id,
            "result": json.dumps(all_results),
        }

    except Exception as e:
        job["state"] = TranslateJobState.FAILED
        yield {"type": "error", "job_id": job_id, "error": str(e)}
