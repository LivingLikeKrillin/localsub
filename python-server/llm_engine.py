"""LLM engine wrapping llama-cpp-python.

Singleton model pattern: Llama is loaded once into `_model` and reused
across jobs to avoid repeated load times.
"""

import asyncio
import json
import logging
import os
import re
import uuid
from enum import Enum
from pathlib import Path
from typing import Any, AsyncGenerator

log = logging.getLogger(__name__)

try:
    from llama_cpp import Llama
except ImportError:
    Llama = None  # type: ignore[misc,assignment]

import gpu_utils
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
        n_gpu_layers = gpu_utils.get_llm_n_gpu_layers()

    # Try GPU first, fallback to CPU
    if n_gpu_layers != 0:
        try:
            _model = Llama(
                model_path=str(model_path),
                n_gpu_layers=n_gpu_layers,
                n_ctx=8192,
                verbose=False,
            )
            _loaded_model_id = model_id
            return True
        except Exception as e:
            log.warning("GPU load failed, falling back to CPU: %s", e)

    _model = Llama(
        model_path=str(model_path),
        n_gpu_layers=0,
        n_ctx=8192,
        verbose=False,
    )
    _loaded_model_id = model_id
    return True


def unload_model() -> None:
    global _model, _loaded_model_id
    log.info("[LLM] Unloading model: %s", _loaded_model_id)
    _model = None
    _loaded_model_id = None


def is_model_loaded() -> bool:
    return _model is not None


# ── Output postprocessing ──────────────────────────────────────────

def _postprocess(raw: str) -> str:
    """Clean LLM output: strip prefixes, quotes, backticks, think blocks, prompt leakage."""
    text = raw.strip()

    # Strip <think>...</think> blocks (Qwen3 thinking mode leakage)
    text = re.sub(r"<think>.*?</think>", "", text, flags=re.DOTALL).strip()

    # Strip prompt leakage: timestamp markers like [00:12:34] or >>> markers
    text = re.sub(r"^>>>?\s*", "", text)
    text = re.sub(r"\[?\d{2}:\d{2}:\d{2}\]?\s*", "", text)

    # If output contains multiple lines with timestamps, keep only the first clean line
    lines = text.split("\n")
    clean_lines = []
    for line in lines:
        line = line.strip()
        # Remove lines that are just timestamps or prompt artifacts
        line = re.sub(r"^>>>?\s*", "", line)
        line = re.sub(r"^\[?\d{2}:\d{2}:\d{2}\]?\s*", "", line)
        if line:
            clean_lines.append(line)
    # For single-segment translation, take only the first meaningful line
    text = clean_lines[0] if clean_lines else ""

    # Strip common prefixes
    for prefix in [
        "Translation:", "translation:", "번역:", "Answer:", "answer:",
        "Output:", "output:", "Translated:", "translated:",
    ]:
        if text.startswith(prefix):
            text = text[len(prefix):].strip()

    # Strip wrapping quotes (double or single)
    if len(text) >= 2:
        if (text[0] == '"' and text[-1] == '"') or (text[0] == "'" and text[-1] == "'"):
            text = text[1:-1].strip()

    # Strip wrapping backticks
    if len(text) >= 2 and text[0] == '`' and text[-1] == '`':
        text = text[1:-1].strip()

    # Strip triple backtick blocks
    if text.startswith("```") and text.endswith("```"):
        text = text[3:-3].strip()

    # Strip leading dashes (prompt format leakage)
    text = re.sub(r"^-{1,2}\s*", "", text).strip()

    return text


# ── Quality tier sampling parameters ───────────────────────────────

QUALITY_SAMPLING: dict[str, dict[str, float]] = {
    "fast": {"temperature": 0.1, "top_p": 0.8, "repeat_penalty": 1.0},
    "balanced": {"temperature": 0.3, "top_p": 0.9, "repeat_penalty": 1.1},
    "best": {"temperature": 0.3, "top_p": 0.95, "repeat_penalty": 1.15},
}

BATCH_SIZE = 1


# ── Job management ─────────────────────────────────────────────────

class TranslateJobState(str, Enum):
    QUEUED = "QUEUED"
    RUNNING = "RUNNING"
    DONE = "DONE"
    FAILED = "FAILED"
    CANCELED = "CANCELED"


_translate_jobs: dict[str, dict[str, Any]] = {}


SUMMARY_INTERVAL = 25  # Generate rolling summary every N segments
SUMMARY_REFRESH = 200  # Regenerate summary from scratch every N segments


def create_translate_job(
    segments: list[dict[str, Any]],
    source_lang: str,
    target_lang: str,
    context_window: int = 4,
    style_preset: str = "natural",
    glossary: list[dict[str, str]] | None = None,
    model_id: str | None = None,
    n_gpu_layers: int | None = None,
    translation_quality: str = "balanced",
    custom_prompt: str | None = None,
    two_pass: bool = False,
    model_category: str = "general",
    media_filename: str | None = None,
    media_context: str | None = None,
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
        "n_gpu_layers": n_gpu_layers,
        "translation_quality": translation_quality,
        "custom_prompt": custom_prompt,
        "two_pass": two_pass,
        "model_category": model_category,
        "media_filename": media_filename,
        "media_context": media_context,
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


def cleanup_job(job_id: str) -> None:
    """Remove a terminal-state job from memory."""
    job = _translate_jobs.get(job_id)
    if job and job["state"] in (
        TranslateJobState.DONE,
        TranslateJobState.FAILED,
        TranslateJobState.CANCELED,
    ):
        del _translate_jobs[job_id]


def _auto_purge_jobs() -> None:
    """Auto-purge oldest completed jobs when dict exceeds 100 entries."""
    if len(_translate_jobs) <= 100:
        return
    terminal = [
        jid
        for jid, j in _translate_jobs.items()
        if j["state"] in (TranslateJobState.DONE, TranslateJobState.FAILED, TranslateJobState.CANCELED)
    ]
    for jid in terminal:
        del _translate_jobs[jid]
        if len(_translate_jobs) <= 100:
            break


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
        cleanup_job(job_id)
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
            _n_gpu = job.get("n_gpu_layers")
            await asyncio.get_running_loop().run_in_executor(
                None, load_model, model_id, _n_gpu
            )
        except Exception as e:
            yield {"type": "error", "job_id": job_id, "error": f"Failed to load LLM: {e}"}
            job["state"] = TranslateJobState.FAILED
            cleanup_job(job_id)
            return

    if job["cancel_flag"]:
        job["state"] = TranslateJobState.CANCELED
        yield {"type": "cancelled", "job_id": job_id}
        cleanup_job(job_id)
        return

    segments = job["segments"]
    source_lang = job["source_lang"]
    target_lang = job["target_lang"]
    context_window = job["context_window"]
    style_preset = job["style_preset"]
    glossary = job["glossary"]
    quality = job.get("translation_quality", "balanced")
    custom_prompt = job.get("custom_prompt")
    two_pass = job.get("two_pass", False)
    model_category = job.get("model_category", "general")
    media_filename = job.get("media_filename")
    media_context = job.get("media_context")
    total = len(segments)
    all_results: list[dict[str, Any]] = []
    completed_translations: dict[int, str] = {}
    sampling = QUALITY_SAMPLING.get(quality, QUALITY_SAMPLING["balanced"])
    rolling_summary: str | None = None

    # Auto-infer media context from first segments if not provided
    if not media_context and total > 0:
        yield {
            "type": "translate_progress",
            "job_id": job_id,
            "progress": 0,
            "message": "Analyzing content for context...",
        }
        try:
            loop = asyncio.get_running_loop()
            sample_count = min(100, total)
            sample_lines = "\n".join(
                seg.get("text", "") for seg in segments[:sample_count]
            )
            context_msgs = [
                {
                    "role": "system",
                    "content": (
                        "You are a media analyst. Based on the subtitle lines below, "
                        "write a brief context description (3-5 sentences) covering:\n"
                        "- What type of content this is (movie, drama, documentary, etc.)\n"
                        "- Genre and tone (comedy, thriller, romance, etc.)\n"
                        "- Key character names mentioned and their apparent roles\n"
                        "- General setting or situation\n"
                        "Output ONLY the description. No labels or formatting.\n"
                        "/no_think"
                    ),
                },
                {"role": "user", "content": f"Subtitle lines:\n{sample_lines}"},
            ]

            def _infer_context(msgs=context_msgs):
                return _model.create_chat_completion(
                    messages=msgs, max_tokens=300,
                    temperature=0.2, top_p=0.9,
                )

            ctx_resp = await loop.run_in_executor(None, _infer_context)
            if ctx_resp and "choices" in ctx_resp:
                raw = ctx_resp["choices"][0].get("message", {}).get("content") or ""
                raw = re.sub(r"<think>.*?</think>", "", raw, flags=re.DOTALL).strip()
                if raw:
                    media_context = raw
                    log.info("Auto-inferred media context: %s", media_context[:200])
        except Exception as e:
            log.warning("Failed to auto-infer media context: %s", e)

    yield {
        "type": "translate_progress",
        "job_id": job_id,
        "progress": 0,
        "message": "Starting translation...",
    }

    import time as _time
    _translate_start = _time.time()
    log.info(
        "[TRANSLATE] Starting: %d segments, model=%s, quality=%s, two_pass=%s, context=%s",
        total, _loaded_model_id, quality, two_pass, media_context[:80] if media_context else "none",
    )

    # Progress scaling for 2-pass
    pass1_weight = 0.7 if two_pass else 1.0

    try:
        loop = asyncio.get_running_loop()

        # ── Pass 1: Batch translation ──────────────────────────
        i = 0
        while i < total:
            if job["cancel_flag"]:
                job["state"] = TranslateJobState.CANCELED
                yield {"type": "cancelled", "job_id": job_id}
                return

            # Determine batch
            remaining = total - i
            batch_size = min(BATCH_SIZE, remaining)
            batch_indices = list(range(i, i + batch_size))

            if batch_size == 1:
                # Single segment — use standard prompt
                messages = prompt_builder.build_messages(
                    segments, i,
                    source_lang=source_lang,
                    target_lang=target_lang,
                    context_window=context_window,
                    style_preset=style_preset,
                    glossary=glossary,
                    translations=completed_translations,
                    custom_prompt=custom_prompt,
                    model_category=model_category,
                    rolling_summary=rolling_summary,
                    media_filename=media_filename,
                    media_context=media_context,
                )

                # Log full prompt for debugging
                log.debug("[TRANSLATE] seg=%d prompt_system=%s", i, messages[0]["content"][:100])
                log.debug("[TRANSLATE] seg=%d prompt_user=%s", i, messages[1]["content"][:300])

                def _infer_single(msgs=messages, samp=sampling):
                    return _model.create_chat_completion(
                        messages=msgs,
                        max_tokens=512,
                        temperature=samp["temperature"],
                        top_p=samp["top_p"],
                        repeat_penalty=samp["repeat_penalty"],
                    )

                response = await loop.run_in_executor(None, _infer_single)
                translated = ""
                raw_content = ""
                if response and "choices" in response and len(response["choices"]) > 0:
                    raw_content = response["choices"][0].get("message", {}).get("content") or ""
                    translated = _postprocess(raw_content)

                log.debug(
                    "[TRANSLATE] seg=%d | orig=%s | raw=%s | post=%s",
                    i,
                    segments[i].get("text", "")[:50],
                    raw_content[:80],
                    translated[:80],
                )

                # Detect repeated translation (same as previous)
                if i > 0 and translated and translated == completed_translations.get(i - 1):
                    log.warning("[TRANSLATE] seg=%d repeated previous translation: %s", i, translated[:50])

                completed_translations[i] = translated
                result_entry = {
                    "index": i,
                    "original": segments[i].get("text", ""),
                    "translated": translated,
                }
                all_results.append(result_entry)

                yield {
                    "type": "translate_segment",
                    "job_id": job_id,
                    **result_entry,
                }

                progress = min(int(((i + 1) / total) * pass1_weight * 100), 99)
                yield {
                    "type": "translate_progress",
                    "job_id": job_id,
                    "progress": progress,
                    "message": f"Translating... ({i + 1}/{total} segments)",
                }
                i += 1

                # Rolling summary generation
                if i > 0 and i % SUMMARY_INTERVAL == 0:
                    try:
                        # Refresh from scratch periodically to prevent drift
                        prev_summary = None if (i % SUMMARY_REFRESH == 0) else rolling_summary
                        summary_start = max(0, i - SUMMARY_INTERVAL)
                        summary_msgs = prompt_builder.build_summary_messages(
                            segments, completed_translations,
                            summary_start, i - 1,
                            prev_summary, source_lang, target_lang,
                            model_category=model_category,
                        )

                        def _infer_summary(msgs=summary_msgs):
                            return _model.create_chat_completion(
                                messages=msgs,
                                max_tokens=256,
                                temperature=0.2,
                                top_p=0.9,
                                repeat_penalty=1.0,
                            )

                        summary_resp = await loop.run_in_executor(None, _infer_summary)
                        if summary_resp and "choices" in summary_resp:
                            raw = summary_resp["choices"][0].get("message", {}).get("content") or ""
                            raw = re.sub(r"<think>.*?</think>", "", raw, flags=re.DOTALL).strip()
                            if raw:
                                rolling_summary = raw
                                log.info("Rolling summary updated at segment %d: %s", i, rolling_summary[:100])
                    except Exception as e:
                        log.warning("Summary generation failed at segment %d: %s", i, e)
            else:
                # Batch translation
                messages = prompt_builder.build_batch_messages(
                    segments, batch_indices,
                    source_lang=source_lang,
                    target_lang=target_lang,
                    context_window=context_window,
                    style_preset=style_preset,
                    glossary=glossary,
                    translations=completed_translations,
                    custom_prompt=custom_prompt,
                    model_category=model_category,
                )

                def _infer_batch(msgs=messages, samp=sampling, bs=batch_size):
                    return _model.create_chat_completion(
                        messages=msgs,
                        max_tokens=512 * bs,
                        temperature=samp["temperature"],
                        top_p=samp["top_p"],
                        repeat_penalty=samp["repeat_penalty"],
                    )

                response = await loop.run_in_executor(None, _infer_batch)
                raw_output = ""
                if response and "choices" in response and len(response["choices"]) > 0:
                    raw_output = response["choices"][0].get("message", {}).get("content") or ""
                    # Strip think blocks before parsing
                    raw_output = re.sub(r"<think>.*?</think>", "", raw_output, flags=re.DOTALL).strip()

                batch_translations = prompt_builder.parse_batch_output(raw_output, batch_size)

                for batch_num, idx in enumerate(batch_indices):
                    translated = _postprocess(batch_translations[batch_num])
                    completed_translations[idx] = translated
                    result_entry = {
                        "index": idx,
                        "original": segments[idx].get("text", ""),
                        "translated": translated,
                    }
                    all_results.append(result_entry)

                    yield {
                        "type": "translate_segment",
                        "job_id": job_id,
                        **result_entry,
                    }

                progress = min(int(((i + batch_size) / total) * pass1_weight * 100), 99)
                yield {
                    "type": "translate_progress",
                    "job_id": job_id,
                    "progress": progress,
                    "message": f"Translating... ({min(i + batch_size, total)}/{total} segments)",
                }
                i += batch_size

            await asyncio.sleep(0)  # yield control

        # ── Pass 2: Refinement (optional) ──────────────────────
        if two_pass and not job["cancel_flag"]:
            yield {
                "type": "translate_progress",
                "job_id": job_id,
                "progress": 70,
                "message": "Refining translations (pass 2)...",
            }

            for idx in range(total):
                if job["cancel_flag"]:
                    job["state"] = TranslateJobState.CANCELED
                    yield {"type": "cancelled", "job_id": job_id}
                    return

                draft = completed_translations.get(idx, "")
                messages = prompt_builder.build_refine_messages(
                    segments, idx, draft,
                    source_lang=source_lang,
                    target_lang=target_lang,
                    translations=completed_translations,
                    context_window=context_window,
                    glossary=glossary,
                    custom_prompt=custom_prompt,
                    model_category=model_category,
                )

                def _infer_refine(msgs=messages, samp=sampling):
                    return _model.create_chat_completion(
                        messages=msgs,
                        max_tokens=512,
                        temperature=samp["temperature"],
                        top_p=samp["top_p"],
                        repeat_penalty=samp["repeat_penalty"],
                    )

                response = await loop.run_in_executor(None, _infer_refine)
                refined = ""
                if response and "choices" in response and len(response["choices"]) > 0:
                    content = response["choices"][0].get("message", {}).get("content") or ""
                    refined = _postprocess(content)

                if refined:
                    completed_translations[idx] = refined
                    # Update the result entry
                    for entry in all_results:
                        if entry["index"] == idx:
                            entry["translated"] = refined
                            break

                    yield {
                        "type": "translate_segment",
                        "job_id": job_id,
                        "index": idx,
                        "original": segments[idx].get("text", ""),
                        "translated": refined,
                    }

                progress = 70 + min(int(((idx + 1) / total) * 30), 29)
                yield {
                    "type": "translate_progress",
                    "job_id": job_id,
                    "progress": progress,
                    "message": f"Refining... ({idx + 1}/{total} segments)",
                }

                await asyncio.sleep(0)

        # Done
        _translate_elapsed = _time.time() - _translate_start
        _repeated = sum(1 for j in range(1, len(all_results))
                        if all_results[j]["translated"] == all_results[j-1]["translated"]
                        and all_results[j]["translated"])
        log.info(
            "[TRANSLATE] Complete: %d segments in %.1fs (%.1f seg/s), repeated=%d",
            len(all_results), _translate_elapsed,
            len(all_results) / _translate_elapsed if _translate_elapsed > 0 else 0,
            _repeated,
        )
        job["state"] = TranslateJobState.DONE
        yield {
            "type": "done",
            "job_id": job_id,
            "result": json.dumps(all_results),
        }

    except Exception as e:
        job["state"] = TranslateJobState.FAILED
        yield {"type": "error", "job_id": job_id, "error": str(e)}
    finally:
        cleanup_job(job_id)
        _auto_purge_jobs()
