"""Prompt builder for LLM subtitle translation.

Constructs system and user prompts with glossary injection (as chat turns),
rolling summary, and style presets for segment-by-segment translation.
Glossary entries serve as both term dictionary and few-shot style examples.
"""

import re
from typing import Any

LANG_NAMES = {
    "ko": "Korean", "en": "English", "ja": "Japanese",
    "zh": "Chinese", "es": "Spanish", "fr": "French",
    "de": "German", "auto": "the source language",
}


def build_system_prompt(
    style_preset: str,
    source_lang: str,
    target_lang: str,
    custom_prompt: str | None = None,
    model_category: str = "general",
    media_filename: str | None = None,
    media_context: str | None = None,
    media_type: str | None = None,
) -> str:
    """Build the system prompt with explicit sections and recency-ordered rules.

    Layout (top-to-bottom):
      1. Role / task line (what we're translating)
      2. Core rule (faithful translation, no censoring)
      3. [optional] Additional instructions section (user custom_prompt)
      4. Output rule (ONLY the translation)
      5. [optional] /no_think marker

    Rules 4 and 5 are last on purpose — small (9B-class) models have strong
    recency bias, so final-position instructions are the ones that stick.
    """
    src = LANG_NAMES.get(source_lang, source_lang)
    tgt = LANG_NAMES.get(target_lang, target_lang)
    mt = media_type or "movie"

    parts: list[str] = [
        f"You translate {src} {mt} subtitles to natural spoken {tgt}.",
        "Preserve all content faithfully including profanity, slang, and mature themes.",
    ]

    if custom_prompt and custom_prompt.strip():
        parts.append("")
        parts.append("Additional instructions:")
        parts.append(custom_prompt.strip())

    parts.append("")
    parts.append("Output ONLY the translated line, nothing else.")

    if model_category == "general":
        parts.append("/no_think")

    return "\n".join(parts)


def _format_timestamp(seconds: float) -> str:
    m, s = divmod(int(seconds), 60)
    h, m = divmod(m, 60)
    return f"{h:02d}:{m:02d}:{s:02d}"


def _match_glossary(text: str, glossary: list[dict[str, str]]) -> list[dict[str, str]]:
    """Return glossary entries whose source term appears in text (case-insensitive)."""
    text_lower = text.lower()
    return [g for g in glossary if g["source"].lower() in text_lower]


def build_user_prompt(
    segments: list[dict[str, Any]],
    current_index: int,
    context_window: int,
    glossary: list[dict[str, str]],
    translations: dict[int, str] | None = None,
    rolling_summary: str | None = None,
    recent_translations_count: int = 10,
) -> str:
    # Direct translation — no context (9B models perform better without it)
    return segments[current_index].get("text", "")


def build_messages(
    segments: list[dict[str, Any]],
    current_index: int,
    source_lang: str,
    target_lang: str,
    context_window: int = 4,
    style_preset: str = "natural",
    glossary: list[dict[str, str]] | None = None,
    translations: dict[int, str] | None = None,
    custom_prompt: str | None = None,
    model_category: str = "general",
    rolling_summary: str | None = None,
    recent_translations_count: int = 10,
    media_filename: str | None = None,
    media_context: str | None = None,
    media_type: str | None = None,
    recent_examples: list[dict[str, str]] | None = None,
) -> list[dict[str, str]]:
    """Build chat messages for a single segment translation.

    Glossary entries are injected as chat turns — they serve as both
    term dictionary (short pairs) and few-shot style examples (sentence pairs).

    `recent_examples` is a dynamic buffer of the last N successful
    translations for this job. Injected AFTER the static glossary so the
    model sees: static anchors first, then scene-local style cues, then
    the segment to translate last (strongest recency signal).
    """
    msgs: list[dict[str, str]] = [
        {
            "role": "system",
            "content": build_system_prompt(
                style_preset, source_lang, target_lang,
                custom_prompt=custom_prompt,
                model_category=model_category,
                media_filename=media_filename,
                media_context=media_context,
                media_type=media_type,
            ),
        },
    ]

    # Inject glossary entries as chat turns (dual role: term dict + few-shot)
    for entry in (glossary or []):
        src_text = entry.get("source", "")
        tgt_text = entry.get("target", "")
        if src_text and tgt_text:
            msgs.append({"role": "user", "content": src_text})
            msgs.append({"role": "assistant", "content": tgt_text})

    # Inject recent translations as additional chat turns (dynamic few-shot).
    for ex in (recent_examples or []):
        src_text = ex.get("source", "")
        tgt_text = ex.get("target", "")
        if src_text and tgt_text:
            msgs.append({"role": "user", "content": src_text})
            msgs.append({"role": "assistant", "content": tgt_text})

    msgs.append({
        "role": "user",
        "content": build_user_prompt(
            segments, current_index, context_window, glossary or [],
            translations=translations,
            rolling_summary=rolling_summary,
            recent_translations_count=recent_translations_count,
        ),
    })

    return msgs


# ── Batch translation (kept for future "fast" quality tier) ───────

def build_batch_messages(
    segments: list[dict[str, Any]],
    batch_indices: list[int],
    source_lang: str,
    target_lang: str,
    context_window: int = 2,
    style_preset: str = "natural",
    glossary: list[dict[str, str]] | None = None,
    translations: dict[int, str] | None = None,
    custom_prompt: str | None = None,
    model_category: str = "general",
) -> list[dict[str, str]]:
    """Build chat messages for a batch of segments (3-5 per call)."""
    parts: list[str] = []
    glossary = glossary or []

    # Gather all glossary matches for the batch
    all_matched: list[dict[str, str]] = []
    for idx in batch_indices:
        text = segments[idx].get("text", "")
        for g in _match_glossary(text, glossary):
            if g not in all_matched:
                all_matched.append(g)
    if all_matched:
        parts.append("[Glossary]")
        for g in all_matched:
            parts.append(f"{g['source']} → {g['target']}")
        parts.append("")

    # Context: show some segments before the batch for context
    first_idx = batch_indices[0]
    ctx_start = max(0, first_idx - context_window)
    if ctx_start < first_idx and translations:
        parts.append("[Previous context]")
        for i in range(ctx_start, first_idx):
            seg = segments[i]
            ts = _format_timestamp(seg.get("start", 0))
            text = seg.get("text", "")
            if i in translations:
                parts.append(f"[{ts}] {text} → {translations[i]}")
            else:
                parts.append(f"[{ts}] {text}")
        parts.append("")

    # Segments to translate
    parts.append("[Translate the following segments]")
    for num, idx in enumerate(batch_indices, 1):
        seg = segments[idx]
        ts = _format_timestamp(seg.get("start", 0))
        text = seg.get("text", "")
        parts.append(f"{num}. [{ts}] {text}")

    parts.append("")
    parts.append("Output as a numbered list:")
    for num in range(1, len(batch_indices) + 1):
        parts.append(f"{num}. (translation)")

    return [
        {
            "role": "system",
            "content": build_system_prompt(
                style_preset, source_lang, target_lang,
                custom_prompt=custom_prompt,
                model_category=model_category,
            ),
        },
        {"role": "user", "content": "\n".join(parts)},
    ]


def parse_batch_output(raw: str, expected_count: int) -> list[str]:
    """Parse numbered list output from batch translation."""
    results: list[str] = []
    pattern = re.compile(r"^\d+[\.\)]\s*(.+)$")
    for line in raw.strip().splitlines():
        line = line.strip()
        if not line:
            continue
        m = pattern.match(line)
        if m:
            results.append(m.group(1).strip())
        elif not results:
            continue

    if not results:
        results = [line.strip() for line in raw.strip().splitlines() if line.strip()]

    while len(results) < expected_count:
        results.append("")
    return results[:expected_count]


# ── Rolling summary ──────────────────────────────────────────────

def build_summary_messages(
    segments: list[dict[str, Any]],
    translations: dict[int, str],
    start_index: int,
    end_index: int,
    previous_summary: str | None,
    source_lang: str,
    target_lang: str,
    model_category: str = "general",
) -> list[dict[str, str]]:
    """Build messages for generating a rolling scene summary."""
    system = (
        "You are a subtitle analyst. Summarize the subtitle segments below in 2-3 sentences.\n"
        "Focus on: scene setting, character names, emotional tone, key events.\n"
        "If a previous summary exists, update it with new information.\n"
        "Keep total under 100 words. Output ONLY the summary.\n"
    )
    if model_category == "general":
        system += "\n/no_think"

    parts: list[str] = []
    if previous_summary:
        parts.append("[Previous summary]")
        parts.append(previous_summary)
        parts.append("")

    parts.append(f"[New segments {start_index + 1}-{end_index + 1}]")
    for i in range(start_index, min(end_index + 1, len(segments))):
        seg = segments[i]
        ts = _format_timestamp(seg.get("start", 0))
        text = seg.get("text", "")
        trans = translations.get(i, "")
        if trans:
            parts.append(f"[{ts}] {text} → {trans}")
        else:
            parts.append(f"[{ts}] {text}")

    parts.append("")
    parts.append("Write an updated summary incorporating the new segments.")

    return [
        {"role": "system", "content": system},
        {"role": "user", "content": "\n".join(parts)},
    ]


# ── 2-Pass refinement ─────────────────────────────────────────────

def build_refine_messages(
    segments: list[dict[str, Any]],
    current_index: int,
    draft: str,
    source_lang: str,
    target_lang: str,
    translations: dict[int, str],
    context_window: int = 4,
    glossary: list[dict[str, str]] | None = None,
    custom_prompt: str | None = None,
    model_category: str = "general",
    rolling_summary: str | None = None,
) -> list[dict[str, str]]:
    """Build messages for 2nd-pass refinement of a single segment."""
    src = LANG_NAMES.get(source_lang, source_lang)
    tgt = LANG_NAMES.get(target_lang, target_lang)
    system = (
        f"Refine this {src}-to-{tgt} subtitle translation. "
        f"Fix: 1) unnatural expressions → natural spoken {tgt}, "
        f"2) inconsistent names. "
        f"Keep all profanity as-is. "
        f"Do NOT add words or expressions not present in the original meaning. "
        f"Do NOT start with greetings or filler words unless the original has them. "
        f"If already natural, output unchanged. Output only the refined text."
    )
    if model_category == "general":
        system += "\n/no_think"

    parts: list[str] = []

    # Scene context for tone/mood awareness (only rolling summary, no previous translations)
    if rolling_summary:
        parts.append(f"[Scene] {rolling_summary}")
        parts.append("")

    parts.append(f">>> {draft}")
    parts.append("")
    parts.append("Refine the line above.")

    return [
        {"role": "system", "content": system},
        {"role": "user", "content": "\n".join(parts)},
    ]
