"""STT engine wrapping faster-whisper.

Singleton model pattern: WhisperModel is loaded once into `_model` and reused
across jobs to avoid 5-15 s reload per transcription.
"""

import asyncio
import json
import os
import uuid
from enum import Enum
from pathlib import Path
from typing import Any, AsyncGenerator

try:
    from faster_whisper import WhisperModel
except ImportError:
    WhisperModel = None  # type: ignore[misc,assignment]


# ── Model singleton ────────────────────────────────────────────────

_model: Any = None
_loaded_model_id: str | None = None


def _resolve_model_dir() -> Path:
    return Path(os.environ.get("MODEL_DIR", "./models"))


def _find_whisper_model_path(model_id: str) -> Path | None:
    """Return the directory containing model.bin for the given model_id."""
    base = _resolve_model_dir() / model_id
    if (base / "model.bin").exists():
        return base
    return None


def _get_compute_type_and_device() -> tuple[str, str]:
    """Detect CUDA availability and return (device, compute_type)."""
    try:
        import torch
        if torch.cuda.is_available():
            return "cuda", "float16"
    except ImportError:
        pass
    return "cpu", "int8"


def load_model(model_id: str) -> bool:
    global _model, _loaded_model_id

    if WhisperModel is None:
        raise RuntimeError("faster-whisper is not installed")

    if _model is not None and _loaded_model_id == model_id:
        return True  # already loaded

    model_path = _find_whisper_model_path(model_id)
    if model_path is None:
        raise FileNotFoundError(f"Whisper model not found: {model_id}")

    device, compute_type = _get_compute_type_and_device()
    _model = WhisperModel(
        str(model_path),
        device=device,
        compute_type=compute_type,
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

class SttJobState(str, Enum):
    QUEUED = "QUEUED"
    RUNNING = "RUNNING"
    DONE = "DONE"
    FAILED = "FAILED"
    CANCELED = "CANCELED"


_stt_jobs: dict[str, dict[str, Any]] = {}


def create_stt_job(file_path: str, language: str | None = None, model_id: str | None = None) -> str:
    job_id = str(uuid.uuid4())
    _stt_jobs[job_id] = {
        "id": job_id,
        "file_path": file_path,
        "language": language,
        "model_id": model_id,
        "state": SttJobState.QUEUED,
        "cancel_flag": False,
    }
    return job_id


def cancel_stt_job(job_id: str) -> bool:
    job = _stt_jobs.get(job_id)
    if job is None:
        return False
    if job["state"] in (SttJobState.DONE, SttJobState.FAILED, SttJobState.CANCELED):
        return False
    job["cancel_flag"] = True
    return True


def get_stt_job(job_id: str) -> dict[str, Any] | None:
    return _stt_jobs.get(job_id)


def cleanup_job(job_id: str) -> None:
    """Remove a terminal-state job from memory."""
    job = _stt_jobs.get(job_id)
    if job and job["state"] in (
        SttJobState.DONE,
        SttJobState.FAILED,
        SttJobState.CANCELED,
    ):
        del _stt_jobs[job_id]


def _auto_purge_jobs() -> None:
    """Auto-purge oldest completed jobs when dict exceeds 100 entries."""
    if len(_stt_jobs) <= 100:
        return
    terminal = [
        jid
        for jid, j in _stt_jobs.items()
        if j["state"] in (SttJobState.DONE, SttJobState.FAILED, SttJobState.CANCELED)
    ]
    for jid in terminal:
        del _stt_jobs[jid]
        if len(_stt_jobs) <= 100:
            break


# ── SSE generator ──────────────────────────────────────────────────

async def run_stt(job_id: str) -> AsyncGenerator[dict[str, Any], None]:
    """Async generator yielding SSE events during transcription."""
    job = _stt_jobs.get(job_id)
    if job is None:
        yield {"type": "error", "job_id": job_id, "error": "Job not found"}
        return

    job["state"] = SttJobState.RUNNING

    # Determine model_id — fallback to first available whisper model
    model_id = job.get("model_id")
    if not model_id:
        model_dir = _resolve_model_dir()
        if model_dir.exists():
            for d in model_dir.iterdir():
                if d.is_dir() and (d / "model.bin").exists():
                    model_id = d.name
                    break
    if not model_id:
        yield {"type": "error", "job_id": job_id, "error": "No whisper model available"}
        job["state"] = SttJobState.FAILED
        cleanup_job(job_id)
        return

    # Load model if needed
    if not is_model_loaded() or _loaded_model_id != model_id:
        yield {
            "type": "stt_progress",
            "job_id": job_id,
            "progress": 0,
            "message": "Loading Whisper model...",
        }
        try:
            await asyncio.get_running_loop().run_in_executor(None, load_model, model_id)
        except Exception as e:
            yield {"type": "error", "job_id": job_id, "error": f"Failed to load model: {e}"}
            job["state"] = SttJobState.FAILED
            cleanup_job(job_id)
            return

    if job["cancel_flag"]:
        job["state"] = SttJobState.CANCELED
        yield {"type": "cancelled", "job_id": job_id}
        cleanup_job(job_id)
        return

    yield {
        "type": "stt_progress",
        "job_id": job_id,
        "progress": 0,
        "message": "Starting transcription...",
    }

    try:
        file_path = job["file_path"]
        language = job.get("language")
        # language=None means auto-detect for faster-whisper
        lang_arg = language if language and language != "auto" else None

        # Run transcribe in executor to avoid blocking the event loop
        loop = asyncio.get_running_loop()
        segments_iter, info = await loop.run_in_executor(
            None,
            lambda: _model.transcribe(
                file_path,
                language=lang_arg,
                beam_size=5,
                vad_filter=True,
            ),
        )

        duration = info.duration if info.duration and info.duration > 0 else 1.0
        all_segments: list[dict[str, Any]] = []
        index = 0

        # Iterate segments (CPU-bound, yield after each)
        def _consume_next(it):
            try:
                return next(it)
            except StopIteration:
                return None

        while True:
            if job["cancel_flag"]:
                job["state"] = SttJobState.CANCELED
                yield {"type": "cancelled", "job_id": job_id}
                return

            segment = await loop.run_in_executor(None, _consume_next, segments_iter)
            if segment is None:
                break

            seg_data = {
                "index": index,
                "start": round(segment.start, 3),
                "end": round(segment.end, 3),
                "text": segment.text.strip(),
            }
            all_segments.append(seg_data)

            yield {
                "type": "stt_segment",
                "job_id": job_id,
                **seg_data,
            }

            progress = min(int((segment.end / duration) * 100), 99)
            yield {
                "type": "stt_progress",
                "job_id": job_id,
                "progress": progress,
                "message": f"Transcribing... ({index + 1} segments)",
            }

            index += 1
            await asyncio.sleep(0)  # yield control

        # Done
        job["state"] = SttJobState.DONE
        yield {
            "type": "done",
            "job_id": job_id,
            "result": json.dumps(all_segments),
        }

    except Exception as e:
        job["state"] = SttJobState.FAILED
        yield {"type": "error", "job_id": job_id, "error": str(e)}
    finally:
        cleanup_job(job_id)
        _auto_purge_jobs()
