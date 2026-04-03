"""STT engine supporting faster-whisper and Qwen3-ASR.

Singleton model pattern: model is loaded once and reused across jobs.
Engine type is determined by model_id prefix.
"""

import asyncio
import json
import logging
import os
import uuid
from enum import Enum
from pathlib import Path
from typing import Any, AsyncGenerator

try:
    from faster_whisper import WhisperModel
except ImportError:
    WhisperModel = None  # type: ignore[misc,assignment]

import gpu_utils

log = logging.getLogger(__name__)

# ── Model singleton ────────────────────────────────────────────────

_model: Any = None
_loaded_model_id: str | None = None
_engine_type: str | None = None  # "whisper" or "qwen3-asr"


def _resolve_model_dir() -> Path:
    return Path(os.environ.get("MODEL_DIR", "./models"))


def _find_whisper_model_path(model_id: str) -> Path | None:
    """Return the directory containing model.bin for the given model_id."""
    base = _resolve_model_dir() / model_id
    if (base / "model.bin").exists():
        return base
    return None


def _is_qwen3_asr(model_id: str) -> bool:
    return "qwen3-asr" in model_id.lower()


def load_model(model_id: str) -> bool:
    global _model, _loaded_model_id, _engine_type

    if _model is not None and _loaded_model_id == model_id:
        return True  # already loaded

    # Unload previous model first
    unload_model()

    if _is_qwen3_asr(model_id):
        return _load_qwen3_asr(model_id)
    else:
        return _load_whisper(model_id)


def _load_whisper(model_id: str) -> bool:
    global _model, _loaded_model_id, _engine_type

    if WhisperModel is None:
        raise RuntimeError("faster-whisper is not installed")

    model_path = _find_whisper_model_path(model_id)
    if model_path is None:
        raise FileNotFoundError(f"Whisper model not found: {model_id}")

    device, compute_type = gpu_utils.get_stt_device()
    _model = WhisperModel(
        str(model_path),
        device=device,
        compute_type=compute_type,
    )
    _loaded_model_id = model_id
    _engine_type = "whisper"
    log.info("Loaded Whisper model: %s (device=%s)", model_id, device)
    return True


def _load_qwen3_asr(model_id: str) -> bool:
    global _model, _loaded_model_id, _engine_type

    try:
        import torch
        from qwen_asr import Qwen3ASRModel
    except ImportError:
        raise RuntimeError("qwen-asr is not installed. Run: pip install qwen-asr")

    # Check if model is downloaded locally
    model_dir = _resolve_model_dir() / model_id
    if model_dir.exists() and any(model_dir.iterdir()):
        model_path = str(model_dir)
    else:
        # Use HuggingFace model ID for auto-download
        model_path = "Qwen/Qwen3-ASR-1.7B"

    device = "cuda:0" if torch.cuda.is_available() else "cpu"
    dtype = torch.bfloat16 if torch.cuda.is_available() else torch.float32

    # Load with ForcedAligner for timestamps
    try:
        _model = Qwen3ASRModel.from_pretrained(
            model_path,
            dtype=dtype,
            device_map=device,
            forced_aligner="Qwen/Qwen3-ForcedAligner-0.6B",
            forced_aligner_kwargs=dict(dtype=dtype, device_map=device),
        )
    except Exception:
        # Fallback: load without ForcedAligner
        log.warning("ForcedAligner failed to load, loading without timestamps")
        _model = Qwen3ASRModel.from_pretrained(
            model_path,
            dtype=dtype,
            device_map=device,
        )

    _loaded_model_id = model_id
    _engine_type = "qwen3-asr"
    log.info("Loaded Qwen3-ASR model: %s (device=%s)", model_id, device)
    return True


def unload_model() -> None:
    global _model, _loaded_model_id, _engine_type
    _model = None
    _loaded_model_id = None
    _engine_type = None


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

    # Determine model_id — fallback to first available model
    model_id = job.get("model_id")
    if not model_id:
        model_dir = _resolve_model_dir()
        if model_dir.exists():
            for d in model_dir.iterdir():
                if d.is_dir() and (d / "model.bin").exists():
                    model_id = d.name
                    break
    if not model_id:
        yield {"type": "error", "job_id": job_id, "error": "No STT model available"}
        job["state"] = SttJobState.FAILED
        cleanup_job(job_id)
        return

    # Load model if needed
    if not is_model_loaded() or _loaded_model_id != model_id:
        engine_name = "Qwen3-ASR" if _is_qwen3_asr(model_id) else "Whisper"
        yield {
            "type": "stt_progress",
            "job_id": job_id,
            "progress": 0,
            "message": f"Loading {engine_name} model...",
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
        if _engine_type == "qwen3-asr":
            async for event in _run_qwen3_asr(job_id, job):
                yield event
        else:
            async for event in _run_whisper(job_id, job):
                yield event
    except Exception as e:
        job["state"] = SttJobState.FAILED
        yield {"type": "error", "job_id": job_id, "error": str(e)}
    finally:
        cleanup_job(job_id)
        _auto_purge_jobs()


async def _run_whisper(job_id: str, job: dict) -> AsyncGenerator[dict[str, Any], None]:
    """Run transcription with faster-whisper engine."""
    import time as _time
    _stt_start = _time.time()

    file_path = job["file_path"]
    language = job.get("language")
    lang_arg = language if language and language != "auto" else None

    log.info("[STT] Starting whisper transcription: file=%s, lang=%s", file_path, lang_arg)

    loop = asyncio.get_running_loop()
    segments_iter, info = await loop.run_in_executor(
        None,
        lambda: _model.transcribe(
            file_path,
            language=lang_arg,
            beam_size=5,
            word_timestamps=True,
            vad_filter=True,
            vad_parameters=dict(
                max_speech_duration_s=15,
                min_silence_duration_ms=200,
                speech_pad_ms=300,
                threshold=0.3,
            ),
            condition_on_previous_text=False,
            no_speech_threshold=0.3,
        ),
    )

    duration = info.duration if info.duration and info.duration > 0 else 1.0
    all_segments: list[dict[str, Any]] = []
    index = 0

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
        await asyncio.sleep(0)

    # Log STT statistics
    _stt_elapsed = _time.time() - _stt_start
    _durations = [s["end"] - s["start"] for s in all_segments]
    log.info(
        "[STT] Complete: %d segments in %.1fs, avg_dur=%.1fs, max_dur=%.1fs, audio=%.0fs",
        len(all_segments), _stt_elapsed,
        sum(_durations) / len(_durations) if _durations else 0,
        max(_durations) if _durations else 0,
        duration,
    )

    # Unload model immediately after STT to free VRAM/RAM
    yield {
        "type": "stt_progress",
        "job_id": job_id,
        "progress": 99,
        "message": "Unloading STT model...",
    }
    unload_model()
    log.info("[STT] Whisper model unloaded")

    job["state"] = SttJobState.DONE
    yield {
        "type": "done",
        "job_id": job_id,
        "result": json.dumps(all_segments),
    }


async def _run_qwen3_asr(job_id: str, job: dict) -> AsyncGenerator[dict[str, Any], None]:
    """Run transcription with Qwen3-ASR engine."""
    file_path = job["file_path"]
    language = job.get("language")
    lang_arg = language if language and language != "auto" else None

    loop = asyncio.get_running_loop()

    yield {
        "type": "stt_progress",
        "job_id": job_id,
        "progress": 5,
        "message": "Qwen3-ASR transcribing...",
    }

    # Qwen3-ASR transcribe (blocking call, run in executor)
    def _transcribe():
        kwargs = {"audio": file_path}
        if lang_arg:
            # Map language codes to Qwen3-ASR language names
            lang_map = {
                "ja": "Japanese", "en": "English", "ko": "Korean",
                "zh": "Chinese", "es": "Spanish", "fr": "French",
                "de": "German",
            }
            kwargs["language"] = lang_map.get(lang_arg, lang_arg)
        kwargs["return_time_stamps"] = True
        return _model.transcribe(**kwargs)

    if job["cancel_flag"]:
        job["state"] = SttJobState.CANCELED
        yield {"type": "cancelled", "job_id": job_id}
        return

    results = await loop.run_in_executor(None, _transcribe)

    if not results or len(results) == 0:
        job["state"] = SttJobState.FAILED
        yield {"type": "error", "job_id": job_id, "error": "Qwen3-ASR returned no results"}
        return

    result = results[0]
    all_segments: list[dict[str, Any]] = []

    # Check if timestamps are available
    if hasattr(result, "time_stamps") and result.time_stamps:
        # With ForcedAligner: word/segment level timestamps
        for i, ts in enumerate(result.time_stamps):
            if job["cancel_flag"]:
                job["state"] = SttJobState.CANCELED
                yield {"type": "cancelled", "job_id": job_id}
                return

            seg_data = {
                "index": i,
                "start": round(ts.start_time, 3),
                "end": round(ts.end_time, 3),
                "text": ts.text.strip(),
            }
            all_segments.append(seg_data)

            yield {
                "type": "stt_segment",
                "job_id": job_id,
                **seg_data,
            }

            progress = min(int(((i + 1) / len(result.time_stamps)) * 100), 99)
            yield {
                "type": "stt_progress",
                "job_id": job_id,
                "progress": progress,
                "message": f"Processing segments... ({i + 1}/{len(result.time_stamps)})",
            }

            if i % 10 == 0:
                await asyncio.sleep(0)
    else:
        # Without ForcedAligner: split full text into sentences
        full_text = result.text.strip()
        if full_text:
            # Simple sentence splitting by punctuation
            import re
            sentences = re.split(r'(?<=[。！？.!?\n])\s*', full_text)
            sentences = [s.strip() for s in sentences if s.strip()]

            for i, sentence in enumerate(sentences):
                seg_data = {
                    "index": i,
                    "start": 0.0,  # No timestamp info
                    "end": 0.0,
                    "text": sentence,
                }
                all_segments.append(seg_data)

                yield {
                    "type": "stt_segment",
                    "job_id": job_id,
                    **seg_data,
                }

            log.warning("Qwen3-ASR: no timestamps available, segments have no timing")

    job["state"] = SttJobState.DONE
    yield {
        "type": "done",
        "job_id": job_id,
        "result": json.dumps(all_segments),
    }
