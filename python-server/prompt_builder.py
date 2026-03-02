"""Prompt builder for LLM subtitle translation.

Constructs system and user prompts with context window, glossary injection,
translation memory, and style presets for segment-by-segment translation.
"""

import re
from typing import Any

STYLE_PROMPTS = {
    "natural": "Translate naturally and idiomatically. Paraphrasing is OK.",
    "formal": "Use formal/honorific language.",
    "literal": "Translate literally, preserving sentence structure.",
    "preserve_slang": "Preserve slang, profanity without censoring.",
}


def build_system_prompt(
    style_preset: str,
    source_lang: str,
    target_lang: str,
    custom_prompt: str | None = None,
    model_category: str = "general",
) -> str:
    style = STYLE_PROMPTS.get(style_preset, STYLE_PROMPTS["natural"])
    prompt = (
        f"You are an expert subtitle translator from {source_lang} to {target_lang}. "
        f"{style}\n\n"
        "## Rules\n"
        "- Output ONLY the translated subtitle text. Nothing else.\n"
        "- NEVER prefix your output with \"Translation:\", \"번역:\", \"Answer:\", or similar labels.\n"
        "- NEVER wrap your output in quotes, backticks, or any other formatting.\n"
        "- Keep translations roughly the same length as the original (subtitle readability).\n"
        "- Preserve speaker markers like \"- \" at the beginning of lines.\n"
        "- Preserve proper nouns, brand names, and technical terms unless the glossary specifies otherwise.\n"
        "- Maintain consistency with previous translations shown in the context.\n"
        "- Translate interjections and sound effects naturally (e.g. \"Huh?\" → natural equivalent).\n"
        "- If multiple lines are joined, keep the line break structure.\n"
    )

    if custom_prompt:
        prompt += f"\n## Additional instructions\n{custom_prompt}\n"

    # Qwen3 (general category): suppress thinking mode for clean output
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
) -> str:
    parts: list[str] = []

    # Glossary section — only matching terms
    current_text = segments[current_index].get("text", "")
    matched = _match_glossary(current_text, glossary)
    if matched:
        parts.append("[Glossary]")
        for g in matched:
            parts.append(f"{g['source']} → {g['target']}")
        parts.append("")

    # Context window
    start = max(0, current_index - context_window)
    end = min(len(segments), current_index + context_window + 1)

    parts.append("[Context]")
    for i in range(start, end):
        seg = segments[i]
        ts = _format_timestamp(seg.get("start", 0))
        text = seg.get("text", "")
        if i == current_index:
            parts.append(f">>> [{ts}] {text}")
        elif translations and i in translations:
            # Show previous translation for context (translation memory)
            parts.append(f"[{ts}] {text} → {translations[i]}")
        else:
            parts.append(f"[{ts}] {text}")

    parts.append("")
    parts.append("Translate ONLY the line marked with >>>.")
    parts.append("Output ONLY the translated text, nothing else.")

    return "\n".join(parts)


def build_messages(
    segments: list[dict[str, Any]],
    current_index: int,
    source_lang: str,
    target_lang: str,
    context_window: int = 2,
    style_preset: str = "natural",
    glossary: list[dict[str, str]] | None = None,
    translations: dict[int, str] | None = None,
    custom_prompt: str | None = None,
    model_category: str = "general",
) -> list[dict[str, str]]:
    """Build chat messages for a single segment translation."""
    return [
        {
            "role": "system",
            "content": build_system_prompt(
                style_preset, source_lang, target_lang,
                custom_prompt=custom_prompt,
                model_category=model_category,
            ),
        },
        {
            "role": "user",
            "content": build_user_prompt(
                segments, current_index, context_window, glossary or [],
                translations=translations,
            ),
        },
    ]


# ── Batch translation ──────────────────────────────────────────────

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
    """Parse numbered list output from batch translation.

    Returns a list of translated strings. Falls back to line splitting
    if pattern matching fails. Pads with empty strings if not enough results.
    """
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
            # Haven't found any numbered lines yet, skip preamble
            continue

    # Fallback: if we got nothing, split by lines
    if not results:
        results = [line.strip() for line in raw.strip().splitlines() if line.strip()]

    # Pad or truncate to expected count
    while len(results) < expected_count:
        results.append("")
    return results[:expected_count]


# ── 2-Pass refinement ─────────────────────────────────────────────

def build_refine_messages(
    segments: list[dict[str, Any]],
    current_index: int,
    draft: str,
    source_lang: str,
    target_lang: str,
    translations: dict[int, str],
    context_window: int = 2,
    glossary: list[dict[str, str]] | None = None,
    custom_prompt: str | None = None,
    model_category: str = "general",
) -> list[dict[str, str]]:
    """Build messages for 2nd-pass refinement of a single segment."""
    system = (
        f"You are refining a subtitle translation from {source_lang} to {target_lang}. "
        "Improve for natural flow, consistency with surrounding translations, and correct terminology.\n"
        "- If the draft is already good, output it unchanged.\n"
        "- Output ONLY the refined translation. No labels, no quotes, no explanations.\n"
    )
    if custom_prompt:
        system += f"\n## Additional instructions\n{custom_prompt}\n"
    if model_category == "general":
        system += "\n/no_think"

    parts: list[str] = []
    glossary = glossary or []
    current_text = segments[current_index].get("text", "")
    matched = _match_glossary(current_text, glossary)
    if matched:
        parts.append("[Glossary]")
        for g in matched:
            parts.append(f"{g['source']} → {g['target']}")
        parts.append("")

    # Surrounding context with translations
    start = max(0, current_index - context_window)
    end = min(len(segments), current_index + context_window + 1)
    parts.append("[Context with translations]")
    for i in range(start, end):
        seg = segments[i]
        ts = _format_timestamp(seg.get("start", 0))
        text = seg.get("text", "")
        trans = translations.get(i, "")
        if i == current_index:
            parts.append(f">>> [{ts}] {text}")
            parts.append(f"    Draft: {draft}")
        elif trans:
            parts.append(f"[{ts}] {text} → {trans}")
        else:
            parts.append(f"[{ts}] {text}")

    parts.append("")
    parts.append("Refine ONLY the draft for the line marked with >>>.")
    parts.append("Output ONLY the refined translation, nothing else.")

    return [
        {"role": "system", "content": system},
        {"role": "user", "content": "\n".join(parts)},
    ]
