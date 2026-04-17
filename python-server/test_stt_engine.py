"""Tests for stt_engine helpers — pure function tests."""
import subprocess
from unittest import mock

import stt_engine


def test_probe_duration_parses_ffprobe_output():
    completed = mock.Mock()
    completed.returncode = 0
    completed.stdout = b"12649.651000\n"
    with mock.patch.object(subprocess, "run", return_value=completed):
        d = stt_engine._probe_duration("some.mp4")
    assert d == 12649.651


def test_probe_duration_handles_nonzero_exit():
    completed = mock.Mock()
    completed.returncode = 1
    completed.stdout = b""
    with mock.patch.object(subprocess, "run", return_value=completed):
        d = stt_engine._probe_duration("missing.mp4")
    assert d is None


def test_probe_duration_handles_unparseable_output():
    completed = mock.Mock()
    completed.returncode = 0
    completed.stdout = b"not a number\n"
    with mock.patch.object(subprocess, "run", return_value=completed):
        d = stt_engine._probe_duration("weird.mp4")
    assert d is None


def test_probe_duration_handles_missing_ffprobe():
    with mock.patch.object(
        subprocess, "run", side_effect=FileNotFoundError()
    ):
        d = stt_engine._probe_duration("anything.mp4")
    assert d is None


def test_compute_chunks_short_file_returns_single_pass():
    # 45 min file — under the 60-min threshold
    chunks = stt_engine._compute_chunks(45 * 60)
    assert chunks == [(0.0, 2700.0, 0.0, 100.0)]


def test_compute_chunks_exactly_threshold_stays_single_pass():
    # 60 min — boundary; no need to chunk
    chunks = stt_engine._compute_chunks(60 * 60)
    assert chunks == [(0.0, 3600.0, 0.0, 100.0)]


def test_compute_chunks_long_file_splits_into_30min_slices():
    # 2 h 30 min → five 30-min chunks
    chunks = stt_engine._compute_chunks(150 * 60)
    assert len(chunks) == 5
    assert chunks[0] == (0.0, 1800.0, 0.0, 20.0)
    assert chunks[1] == (1800.0, 3600.0, 20.0, 20.0)
    assert chunks[4] == (7200.0, 9000.0, 80.0, 20.0)
    # Progress windows sum to 100
    assert sum(span for _, _, _, span in chunks) == 100.0


def test_compute_chunks_uneven_tail():
    # 1 h 40 min → 4 chunks, last one 10 min
    chunks = stt_engine._compute_chunks(100 * 60)
    assert len(chunks) == 4
    assert chunks[-1][0] == 5400.0
    assert chunks[-1][1] == 6000.0
    # last chunk's progress span is (600 / 6000) * 100 = 10.0
    assert abs(chunks[-1][3] - 10.0) < 1e-6


def test_compute_chunks_probe_failure_returns_single_pass():
    chunks = stt_engine._compute_chunks(None)
    assert chunks == [(None, None, 0.0, 100.0)]
