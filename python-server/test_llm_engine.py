"""Tests for llm_engine helpers (post-processing, fallback resolution)."""

from llm_engine import _fix_untranslated


def test_fix_untranslated_uses_user_vocabulary_before_hardcoded():
    vocab = [
        {"source": "おい", "target": "이봐"},  # user override — differs from hardcoded
    ]
    # LLM echoed the source → should fall through to vocabulary
    result = _fix_untranslated("おい", "おい", vocabulary=vocab)
    assert result == "이봐"


def test_fix_untranslated_vocabulary_exact_match_only():
    vocab = [
        {"source": "やばい", "target": "위험"},
    ]
    # Source differs → no match, translated passes through
    result = _fix_untranslated("ヤバい", "ヤバい", vocabulary=vocab)
    assert result == "ヤバい"


def test_fix_untranslated_no_vocab_no_change():
    # With no vocabulary and no hardcoded map (removed now that the
    # default vocabulary ships with the app), an echoed input passes
    # through unchanged.
    result = _fix_untranslated("おい", "おい")
    assert result == "おい"


def test_fix_untranslated_non_echo_passes_through():
    vocab = [{"source": "おい", "target": "야"}]
    # LLM actually translated — don't touch it
    result = _fix_untranslated("おい", "안녕", vocabulary=vocab)
    assert result == "안녕"


def test_fix_untranslated_empty_translation_uses_vocabulary():
    vocab = [{"source": "おい", "target": "야"}]
    result = _fix_untranslated("おい", "", vocabulary=vocab)
    assert result == "야"


def test_fix_untranslated_empty_translation_no_vocab_empty_return():
    # No vocabulary match, no hardcoded match for this input → return as-is (empty)
    result = _fix_untranslated("something weird", "", vocabulary=None)
    assert result == ""


def test_fix_untranslated_whitespace_normalized_for_echo_detection():
    vocab = [{"source": "おい", "target": "야"}]
    # Translated has trailing whitespace but is otherwise identical
    result = _fix_untranslated("おい", "  おい  ", vocabulary=vocab)
    assert result == "야"


def test_fix_untranslated_vocab_with_missing_fields_skipped():
    vocab = [
        {"source": "", "target": "야"},       # empty source
        {"source": "おい", "target": ""},     # empty target — must not be used
        {"source": "おい", "target": "이봐"},  # valid — should win
    ]
    result = _fix_untranslated("おい", "おい", vocabulary=vocab)
    assert result == "이봐"


import prompt_builder


def test_pivot_mode_builds_two_leg_messages_with_correct_glossaries():
    """Pivot mode must route the source→pivot glossary to leg 1 and
    the pivot→target glossary to leg 2. Final leg also takes recent
    examples; first leg does not."""
    segs = [{"start": 0.0, "end": 5.0, "text": "山本を殺せ"}]
    pivot_glossary = [{"source": "山本", "target": "Yamamoto"}]
    final_glossary = [{"source": "Yamamoto", "target": "야마모토"}]
    recent = [{"source": "Kill him.", "target": "죽여버려"}]

    # Leg 1: JA → EN with pivot_glossary only
    leg1 = prompt_builder.build_messages(
        segs, current_index=0,
        source_lang="ja", target_lang="en",
        glossary=pivot_glossary,
    )
    # system + glossary pair + user = 4 messages
    assert len(leg1) == 4
    assert leg1[1] == {"role": "user", "content": "山本"}
    assert leg1[2] == {"role": "assistant", "content": "Yamamoto"}
    assert leg1[3] == {"role": "user", "content": "山本を殺せ"}

    # Leg 2: EN → KO with final_glossary + recent_examples
    segs2 = [{"start": 0.0, "end": 5.0, "text": "Kill Yamamoto."}]
    leg2 = prompt_builder.build_messages(
        segs2, current_index=0,
        source_lang="en", target_lang="ko",
        glossary=final_glossary,
        recent_examples=recent,
    )
    # system + glossary pair + recent pair + user = 6 messages
    assert len(leg2) == 6
    assert leg2[1] == {"role": "user", "content": "Yamamoto"}
    assert leg2[2] == {"role": "assistant", "content": "야마모토"}
    assert leg2[3] == {"role": "user", "content": "Kill him."}
    assert leg2[4] == {"role": "assistant", "content": "죽여버려"}
    assert leg2[5] == {"role": "user", "content": "Kill Yamamoto."}
