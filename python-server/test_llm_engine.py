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


def test_fix_untranslated_falls_back_to_hardcoded_when_vocab_miss():
    # With no vocabulary, the function should still handle the known
    # Japanese fallbacks so behaviour is backwards-compatible with
    # translations issued before the default vocabulary was installed.
    result = _fix_untranslated("おい", "おい")
    assert result == "야"


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
