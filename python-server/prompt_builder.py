"""Prompt builder for LLM subtitle translation.

Constructs system and user prompts with context window, glossary injection,
and style presets for segment-by-segment translation.
"""

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
) -> str:
    style = STYLE_PROMPTS.get(style_preset, STYLE_PROMPTS["natural"])
    return (
        f"You are a professional subtitle translator. {style}\n"
        f"Translate from {source_lang} to {target_lang}.\n"
        "Output ONLY the translated text. No explanations, no quotes, no extra formatting."
    )


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
) -> list[dict[str, str]]:
    """Build chat messages for a single segment translation."""
    return [
        {
            "role": "system",
            "content": build_system_prompt(style_preset, source_lang, target_lang),
        },
        {
            "role": "user",
            "content": build_user_prompt(
                segments, current_index, context_window, glossary or []
            ),
        },
    ]
