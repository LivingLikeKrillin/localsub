"""Prompt builder for LLM subtitle translation.

Constructs system and user prompts with context window, glossary injection,
translation memory, rolling summary, and style presets for segment-by-segment translation.
"""

import re
from typing import Any

STYLE_PROMPTS = {
    "natural": "Translate naturally and idiomatically. Paraphrasing is OK.",
    "formal": "Use formal/honorific language.",
    "literal": "Translate literally, preserving sentence structure.",
    "preserve_slang": "Preserve slang, profanity without censoring.",
}

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
) -> str:
    src = LANG_NAMES.get(source_lang, source_lang)
    tgt = LANG_NAMES.get(target_lang, target_lang)
    prompt = (
        f"Translate {src} movie subtitles to natural spoken {tgt}. "
        f"Profanity and slang must be translated faithfully. "
        f"Output only the translation."
    )

    if media_context:
        prompt += f"\nContext: {media_context}"
    elif media_filename:
        title = re.sub(r"\.[^.]+$", "", media_filename)
        title = re.sub(r"[\._\-]", " ", title).strip()
        prompt += f"\nTitle: {title}"

    if custom_prompt:
        prompt += f"\n{custom_prompt}"

    if model_category == "general":
        prompt += "\n/no_think"

    return prompt


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
    parts: list[str] = []

    # Rolling summary section
    if rolling_summary:
        parts.append("[Scene summary]")
        parts.append(rolling_summary)
        parts.append("")

    # Glossary section — only matching terms
    current_text = segments[current_index].get("text", "")
    matched = _match_glossary(current_text, glossary)
    if matched:
        parts.append("[Glossary]")
        for g in matched:
            parts.append(f"{g['source']} → {g['target']}")
        parts.append("")

    # Recent translations section — last N translations before current
    if translations and recent_translations_count > 0:
        recent_start = max(0, current_index - recent_translations_count)
        recent_entries = []
        for i in range(recent_start, current_index):
            if i in translations:
                recent_entries.append(translations[i])
        if recent_entries:
            parts.append("[Recent translations]")
            for entry in recent_entries:
                parts.append(entry)
            parts.append("")

    # Context window (previous N segments only)
    start = max(0, current_index - context_window)
    end = current_index + 1

    parts.append("[Context]")
    for i in range(start, end):
        text = segments[i].get("text", "")
        if i == current_index:
            parts.append(f">>> {text}")
        elif translations and i in translations:
            parts.append(f"{text} = {translations[i]}")
        else:
            parts.append(text)

    parts.append("")
    parts.append("Translate ONLY the line marked with >>>.")
    parts.append("Output ONLY the translated text. Do NOT include timestamps, markers, or any formatting.")

    return "\n".join(parts)


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
) -> list[dict[str, str]]:
    """Build chat messages for a single segment translation."""
    return [
        {
            "role": "system",
            "content": build_system_prompt(
                style_preset, source_lang, target_lang,
                custom_prompt=custom_prompt,
                model_category=model_category,
                media_filename=media_filename,
                media_context=media_context,
            ),
        },
        {
            "role": "user",
            "content": build_user_prompt(
                segments, current_index, context_window, glossary or [],
                translations=translations,
                rolling_summary=rolling_summary,
                recent_translations_count=recent_translations_count,
            ),
        },
    ]


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
        f"Fix: 1) unnatural/stilted expressions → natural spoken {tgt}, "
        f"2) inconsistent names/terms with surrounding subtitles. "
        f"Keep all profanity, slang, and vulgar expressions as-is. Do NOT censor or soften them. "
        f"If already natural, output unchanged. Output only the refined text."
    )
    if model_category == "general":
        system += "\n/no_think"

    parts: list[str] = []

    # Scene context for tone/mood awareness
    if rolling_summary:
        parts.append(f"[Scene] {rolling_summary}")
        parts.append("")

    # Previous translations for consistency
    start = max(0, current_index - context_window)
    for i in range(start, current_index):
        trans = translations.get(i, "")
        if trans:
            parts.append(trans)

    parts.append(f">>> {draft}")
    parts.append("")
    parts.append("Refine the line marked with >>>.")

    return [
        {"role": "system", "content": system},
        {"role": "user", "content": "\n".join(parts)},
    ]
