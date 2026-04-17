"""STT engine supporting faster-whisper and Qwen3-ASR.

Singleton model pattern: model is loaded once and reused across jobs.
Engine type is determined by model_id prefix.
"""

import asyncio
import json
import logging
import math
import os
import subprocess
import tempfile
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

# ── Long-file chunking ───────────────────────────────────────────
# CTranslate2 on Windows crashes natively when faster-whisper processes
# very long post-VAD audio (reported around 1.5 h on Qwen3.5/Kotoba).
# Above LONG_FILE_THRESHOLD_S we split the file into CHUNK_DURATION_S
# slices and feed them one at a time. Temperature=0.0 and
# compute_type="default" from prior commits stay in effect per-chunk.
LONG_FILE_THRESHOLD_S = 60 * 60   # 3600s — single-pass for ≤60 min
CHUNK_DURATION_S = 30 * 60        # 1800s — 30-min chunks when splitting

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
    try:
        import torch
        if torch.cuda.is_available():
            free, total = torch.cuda.mem_get_info()
            log.info("[STT] VRAM after load: %.0f/%.0f MB free", free / 1024 / 1024, total / 1024 / 1024)
    except ImportError:
        pass
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


def _find_ffmpeg() -> str:
    """Find ffmpeg: check app-local bin first, then system PATH."""
    # Check app-local path
    appdata = os.environ.get("APPDATA", "")
    local_ffmpeg = os.path.join(appdata, "LocalSub", "bin", "ffmpeg.exe")
    if os.path.isfile(local_ffmpeg):
        return local_ffmpeg
    return "ffmpeg"


def _find_ffprobe() -> str:
    """Locate ffprobe — mirrors _find_ffmpeg. BtbN builds ship both."""
    appdata = os.environ.get("APPDATA", "")
    local_ffprobe = os.path.join(appdata, "LocalSub", "bin", "ffprobe.exe")
    if os.path.isfile(local_ffprobe):
        return local_ffprobe
    return "ffprobe"


def _probe_duration(file_path: str) -> float | None:
    """Return media duration in seconds, or None on any failure.

    Used by the STT chunking logic to decide whether to split a long
    file. Probe failure falls through to the single-pass path, so we
    never want this to raise.
    """
    try:
        result = subprocess.run(
            [
                _find_ffprobe(),
                "-v", "error",
                "-show_entries", "format=duration",
                "-of", "default=noprint_wrappers=1:nokey=1",
                file_path,
            ],
            capture_output=True,
            timeout=15,
        )
    except (FileNotFoundError, subprocess.TimeoutExpired, OSError):
        return None
    if result.returncode != 0:
        return None
    try:
        return float(result.stdout.decode("utf-8", errors="replace").strip())
    except (ValueError, AttributeError):
        return None


def unload_model() -> None:
    global _model, _loaded_model_id, _engine_type
    log.info("[STT] Unloading model: %s", _loaded_model_id)
    if _model is not None:
        del _model
    _model = None
    _loaded_model_id = None
    _engine_type = None
    import gc
    gc.collect()
    try:
        import torch
        if torch.cuda.is_available():
            torch.cuda.empty_cache()
            vram_free = torch.cuda.mem_get_info()[0] / (1024 * 1024)
            log.info("[STT] CUDA cache cleared, VRAM free: %.0f MB", vram_free)
    except ImportError:
        pass


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


def create_stt_job(
    file_path: str,
    language: str | None = None,
    model_id: str | None = None,
    start_time: float | None = None,
    end_time: float | None = None,
) -> str:
    job_id = str(uuid.uuid4())
    _stt_jobs[job_id] = {
        "id": job_id,
        "file_path": file_path,
        "language": language,
        "model_id": model_id,
        "start_time": start_time,
        "end_time": end_time,
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


async def _transcribe_range(
    job_id: str,
    job: dict,
    source_file: str,
    language_arg: str | None,
    range_start: float | None,
    range_end: float | None,
    time_offset: float,
    progress_base: float,
    progress_span: float,
    index_base: int,
    duration_hint: float,
) -> AsyncGenerator[dict[str, Any], None]:
    """Run a single faster-whisper transcription pass, optionally on a
    time slice of `source_file`.

    Yields stt_segment + stt_progress events exactly like the old
    single-shot path. The caller yields the final `done` event.

    progress_base / progress_span map the 0..1 fraction of THIS pass
    onto the overall progress scale (base=0 span=100 for single-pass).
    time_offset is added to every segment start/end so timestamps
    reflect the ORIGINAL file timeline. index_base is added to the
    per-chunk counter so indices stay monotonic across chunks.

    Final yield (type="_range_complete") carries the list of yielded
    segments and their count so the orchestrator can accumulate. That
    event is internal — the orchestrator strips it before re-yielding.
    """
    loop = asyncio.get_running_loop()
    temp_audio_path: str | None = None
    transcribe_file = source_file

    # Extract slice if requested
    if range_start is not None and range_end is not None:
        try:
            temp_audio_path = os.path.join(
                tempfile.gettempdir(),
                f"localsub_chunk_{job_id}_{int(range_start)}_{int(range_end)}.wav",
            )
            cmd = [
                _find_ffmpeg(), "-y",
                "-ss", str(range_start),
                "-to", str(range_end),
                "-i", source_file,
                "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le",
                temp_audio_path,
            ]
            log.info(
                "[STT] Extracting audio segment: %s -> %s (%.1fs~%.1fs)",
                source_file, temp_audio_path, range_start, range_end,
            )
            result = subprocess.run(cmd, capture_output=True, timeout=120)
            if result.returncode != 0:
                log.warning("[STT] ffmpeg failed (rc=%d), using original file", result.returncode)
                temp_audio_path = None
            else:
                transcribe_file = temp_audio_path
        except FileNotFoundError:
            log.warning("[STT] ffmpeg not found, using original file")
            temp_audio_path = None
        except Exception as e:
            log.warning("[STT] ffmpeg extraction failed: %s, using original file", e)
            temp_audio_path = None

    log.info(
        "[STT] Transcribing range: file=%s, lang=%s, offset=%.1fs, base_idx=%d",
        transcribe_file, language_arg, time_offset, index_base,
    )

    segments_iter, info = await loop.run_in_executor(
        None,
        lambda: _model.transcribe(
            transcribe_file,
            language=language_arg,
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
            temperature=0.0,
        ),
    )

    info_duration = info.duration if info.duration and info.duration > 0 else (duration_hint or 1.0)

    yielded_segments: list[dict[str, Any]] = []
    local_index = 0

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
            "index": index_base + local_index,
            "start": round(segment.start + time_offset, 3),
            "end": round(segment.end + time_offset, 3),
            "text": segment.text.strip(),
        }
        yielded_segments.append(seg_data)

        yield {"type": "stt_segment", "job_id": job_id, **seg_data}

        inner_frac = min(segment.end / info_duration, 1.0)
        progress = min(int(progress_base + inner_frac * progress_span), 99)
        yield {
            "type": "stt_progress",
            "job_id": job_id,
            "progress": progress,
            "message": f"Transcribing... ({index_base + local_index + 1} segments)",
        }

        local_index += 1
        await asyncio.sleep(0)

    if temp_audio_path and os.path.exists(temp_audio_path):
        try:
            os.remove(temp_audio_path)
        except OSError:
            pass

    # Internal "end of this range" signal — orchestrator strips it.
    yield {
        "type": "_range_complete",
        "yielded": yielded_segments,
        "count": local_index,
    }


async def _run_whisper(job_id: str, job: dict) -> AsyncGenerator[dict[str, Any], None]:
    """Orchestrate one or many _transcribe_range calls.

    - User-supplied start_time/end_time (preview): single range call.
    - File ≤ LONG_FILE_THRESHOLD_S or probe failure: single call over
      the whole file.
    - Otherwise: split into CHUNK_DURATION_S slices, run sequentially,
      accumulate segment index, scale progress across chunks.
    """
    import time as _time
    _stt_start = _time.time()

    file_path = job["file_path"]
    language = job.get("language")
    lang_arg = language if language and language != "auto" else None
    user_start = job.get("start_time")
    user_end = job.get("end_time")

    all_segments: list[dict[str, Any]] = []

    # Preview mode — user asked for a specific window. Single pass.
    if user_start is not None and user_end is not None:
        async for ev in _transcribe_range(
            job_id, job, file_path, lang_arg,
            range_start=user_start, range_end=user_end,
            time_offset=user_start,
            progress_base=0.0, progress_span=100.0,
            index_base=0,
            duration_hint=(user_end - user_start),
        ):
            if ev.get("type") == "_range_complete":
                all_segments = ev["yielded"]
                continue
            if ev.get("type") == "cancelled":
                yield ev
                return
            yield ev
    else:
        # Full-file mode — decide single-pass vs chunked based on duration.
        duration = _probe_duration(file_path)
        if duration is None or duration <= LONG_FILE_THRESHOLD_S:
            log.info(
                "[STT] Single-pass mode (duration=%s)",
                f"{duration:.1f}s" if duration else "unknown",
            )
            async for ev in _transcribe_range(
                job_id, job, file_path, lang_arg,
                range_start=None, range_end=None,
                time_offset=0.0,
                progress_base=0.0, progress_span=100.0,
                index_base=0,
                duration_hint=duration or 1.0,
            ):
                if ev.get("type") == "_range_complete":
                    all_segments = ev["yielded"]
                    continue
                if ev.get("type") == "cancelled":
                    yield ev
                    return
                yield ev
        else:
            num_chunks = math.ceil(duration / CHUNK_DURATION_S)
            log.info(
                "[STT] Chunked mode: duration=%.1fs → %d x %.0fs chunks",
                duration, num_chunks, CHUNK_DURATION_S,
            )
            index_base = 0
            for chunk_i in range(num_chunks):
                chunk_start = chunk_i * CHUNK_DURATION_S
                chunk_end = min(chunk_start + CHUNK_DURATION_S, duration)
                progress_base = (chunk_start / duration) * 100.0
                progress_span = ((chunk_end - chunk_start) / duration) * 100.0

                log.info(
                    "[STT] Chunk %d/%d: %.1fs~%.1fs (progress %.1f..%.1f)",
                    chunk_i + 1, num_chunks, chunk_start, chunk_end,
                    progress_base, progress_base + progress_span,
                )

                async for ev in _transcribe_range(
                    job_id, job, file_path, lang_arg,
                    range_start=chunk_start, range_end=chunk_end,
                    time_offset=chunk_start,
                    progress_base=progress_base,
                    progress_span=progress_span,
                    index_base=index_base,
                    duration_hint=(chunk_end - chunk_start),
                ):
                    if ev.get("type") == "_range_complete":
                        all_segments.extend(ev["yielded"])
                        index_base += ev["count"]
                        continue
                    if ev.get("type") == "cancelled":
                        yield ev
                        return
                    yield ev

    _stt_elapsed = _time.time() - _stt_start
    _durations = [s["end"] - s["start"] for s in all_segments]
    log.info(
        "[STT] Complete: %d segments in %.1fs, avg_dur=%.1fs, max_dur=%.1fs",
        len(all_segments), _stt_elapsed,
        sum(_durations) / len(_durations) if _durations else 0,
        max(_durations) if _durations else 0,
    )

    job["state"] = SttJobState.DONE
    log.info("[STT] Transcription complete, model kept loaded (Rust will unload before LLM)")
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
