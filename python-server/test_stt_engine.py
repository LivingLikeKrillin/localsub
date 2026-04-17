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
