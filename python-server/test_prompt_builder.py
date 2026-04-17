"""Tests for prompt_builder.py — pure function tests."""

from prompt_builder import (
    build_system_prompt,
    _format_timestamp,
    _match_glossary,
    build_user_prompt,
    build_messages,
)


# ── build_system_prompt ───────────────────────────────────────────


def test_build_system_prompt_natural():
    # New architecture is style-agnostic at the system level; style is no longer
    # injected as text into the prompt. Assert on what IS present: language names
    # and translation task framing.
    prompt = build_system_prompt("natural", "en", "ko")
    assert "English" in prompt
    assert "Korean" in prompt
    assert "translate" in prompt.lower()
    assert "subtitles" in prompt.lower()


def test_build_system_prompt_formal():
    # Style preset is accepted but no longer injected as text (style-agnostic).
    # Verify the function accepts "formal" without error and still produces a prompt.
    prompt = build_system_prompt("formal", "en", "ko")
    assert "English" in prompt
    assert "Korean" in prompt
    assert "translate" in prompt.lower()


def test_build_system_prompt_unknown_style():
    # Unknown style is silently ignored (style-agnostic architecture).
    # Prompt still contains language names and task framing.
    prompt = build_system_prompt("nonexistent_style", "en", "ko")
    assert "English" in prompt
    assert "Korean" in prompt
    assert "translate" in prompt.lower()


# ── _format_timestamp ─────────────────────────────────────────────


def test_format_timestamp_zero():
    assert _format_timestamp(0.0) == "00:00:00"


def test_format_timestamp_complex():
    assert _format_timestamp(3661.0) == "01:01:01"


# ── _match_glossary ───────────────────────────────────────────────


def test_match_glossary_found():
    glossary = [{"source": "AI", "target": "인공지능"}]
    result = _match_glossary("AI is great", glossary)
    assert len(result) == 1
    assert result[0]["target"] == "인공지능"


def test_match_glossary_case_insensitive():
    glossary = [{"source": "Hello", "target": "안녕"}]
    result = _match_glossary("hello world", glossary)
    assert len(result) == 1


def test_match_glossary_not_found():
    glossary = [{"source": "AI", "target": "인공지능"}]
    result = _match_glossary("no match here", glossary)
    assert len(result) == 0


# ── build_user_prompt ─────────────────────────────────────────────


def _make_segments(n: int = 5):
    return [
        {"start": float(i * 10), "end": float(i * 10 + 9), "text": f"Segment {i}"}
        for i in range(n)
    ]


def test_build_user_prompt_returns_current_segment_text():
    segs = _make_segments(5)
    prompt = build_user_prompt(segs, current_index=2, context_window=2, glossary=[])
    # After refactor, build_user_prompt returns bare segment text only
    # (9B models perform better without prior-context injection).
    # Context/glossary injection now happens via chat turns in build_messages.
    assert prompt == "Segment 2"


def test_build_user_prompt_ignores_glossary_arg():
    segs = [{"start": 0.0, "end": 5.0, "text": "AI is great"}]
    glossary = [{"source": "AI", "target": "인공지능"}]
    prompt = build_user_prompt(segs, current_index=0, context_window=2, glossary=glossary)
    # Glossary is now injected as chat turns in build_messages, not as text here
    assert prompt == "AI is great"


def test_build_user_prompt_first_segment_returns_its_text():
    segs = _make_segments(5)
    prompt = build_user_prompt(segs, current_index=0, context_window=2, glossary=[])
    assert prompt == "Segment 0"


def test_build_user_prompt_no_glossary_section_when_empty():
    segs = _make_segments(3)
    prompt = build_user_prompt(segs, current_index=1, context_window=1, glossary=[])
    # Never contains section markers — plain text only
    assert "[Glossary]" not in prompt
    assert "[Context]" not in prompt


# ── build_messages ────────────────────────────────────────────────


def test_build_messages_structure():
    segs = [{"start": 0.0, "end": 5.0, "text": "Hello"}]
    messages = build_messages(segs, current_index=0, source_lang="en", target_lang="ko")
    assert len(messages) == 2
    assert messages[0]["role"] == "system"
    assert messages[1]["role"] == "user"
    # Last user message is the bare segment text (no markers)
    assert messages[1]["content"] == "Hello"


def test_build_messages_glossary_injected_as_chat_turns():
    segs = [{"start": 0.0, "end": 5.0, "text": "AI is great"}]
    glossary = [{"source": "AI", "target": "인공지능"}]
    messages = build_messages(
        segs, current_index=0, source_lang="en", target_lang="ko",
        glossary=glossary,
    )
    # system + (user/assistant pair for glossary entry) + final user = 4 messages
    assert len(messages) == 4
    assert messages[0]["role"] == "system"
    assert messages[1] == {"role": "user", "content": "AI"}
    assert messages[2] == {"role": "assistant", "content": "인공지능"}
    assert messages[3] == {"role": "user", "content": "AI is great"}


def test_build_messages_recent_examples_after_glossary():
    segs = [{"start": 10.0, "end": 15.0, "text": "Segment C"}]
    glossary = [{"source": "A", "target": "A_target"}]
    recent = [
        {"source": "Segment A", "target": "Segment A target"},
        {"source": "Segment B", "target": "Segment B target"},
    ]
    messages = build_messages(
        segs, current_index=0, source_lang="en", target_lang="ko",
        glossary=glossary, recent_examples=recent,
    )
    # system + glossary pair + 2 recent pairs + final user = 8 messages
    assert len(messages) == 8
    assert messages[0]["role"] == "system"
    # Glossary first
    assert messages[1] == {"role": "user", "content": "A"}
    assert messages[2] == {"role": "assistant", "content": "A_target"}
    # Then recent examples (ordered)
    assert messages[3] == {"role": "user", "content": "Segment A"}
    assert messages[4] == {"role": "assistant", "content": "Segment A target"}
    assert messages[5] == {"role": "user", "content": "Segment B"}
    assert messages[6] == {"role": "assistant", "content": "Segment B target"}
    # Final query last
    assert messages[7] == {"role": "user", "content": "Segment C"}


def test_build_messages_recent_examples_empty_skipped():
    segs = [{"start": 0.0, "end": 5.0, "text": "Hello"}]
    recent = [
        {"source": "", "target": "empty source"},
        {"source": "only source", "target": ""},
    ]
    messages = build_messages(
        segs, current_index=0, source_lang="en", target_lang="ko",
        recent_examples=recent,
    )
    # Entries with missing source OR target are silently skipped
    assert len(messages) == 2
    assert messages[1] == {"role": "user", "content": "Hello"}


# ── New structure: custom prompt placement and output-rule recency ──

def test_build_system_prompt_has_output_rule_last_when_no_custom():
    prompt = build_system_prompt("natural", "ja", "ko")
    lines = [line for line in prompt.splitlines() if line.strip()]
    # Last meaningful line is /no_think, the one before is the output rule
    assert lines[-1].startswith("/no_think")
    assert "output" in lines[-2].lower()


def test_build_system_prompt_custom_placed_before_output_rule():
    prompt = build_system_prompt(
        "natural", "ja", "ko",
        custom_prompt="Use Busan dialect.",
    )
    # Custom appears, and it appears before the output rule and /no_think.
    # Anchor on the exact canonical phrase "Output ONLY" (case-sensitive) so
    # this test catches reorderings even if the output rule wording drifts.
    idx_custom = prompt.find("Use Busan dialect.")
    idx_output = prompt.find("Output ONLY")
    idx_no_think = prompt.find("/no_think")
    assert idx_custom != -1, f"custom prompt missing in: {prompt!r}"
    assert idx_output != -1, f"output rule missing in: {prompt!r}"
    assert idx_no_think != -1, f"/no_think missing in: {prompt!r}"
    assert idx_custom < idx_output < idx_no_think


def test_build_system_prompt_custom_has_section_marker():
    prompt = build_system_prompt(
        "natural", "ja", "ko",
        custom_prompt="Keep character names unchanged.",
    )
    # Section marker introduces the custom block so the model can distinguish it
    assert "Additional instructions:" in prompt


def test_build_system_prompt_empty_custom_omits_section():
    prompt = build_system_prompt("natural", "ja", "ko", custom_prompt="")
    assert "Additional instructions:" not in prompt


def test_build_system_prompt_whitespace_only_custom_omits_section():
    prompt = build_system_prompt("natural", "ja", "ko", custom_prompt="   \n  ")
    assert "Additional instructions:" not in prompt


def test_build_system_prompt_preserves_media_type():
    prompt = build_system_prompt(
        "natural", "ja", "ko", media_type="drama"
    )
    assert "drama" in prompt


def test_build_system_prompt_no_think_only_for_general_category():
    general = build_system_prompt("natural", "ja", "ko", model_category="general")
    instruct = build_system_prompt("natural", "ja", "ko", model_category="instruct")
    assert "/no_think" in general
    assert "/no_think" not in instruct
