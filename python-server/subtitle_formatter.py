"""Subtitle format converters (SRT, VTT, ASS).

Each segment dict is expected to have at minimum:
  - start: float (seconds)
  - end:   float (seconds)
  - text:  str

If a segment contains a `translated` key, dual-subtitle output is produced
(original on top, translated below).
"""

from typing import Sequence


# ── Timestamp helpers ──────────────────────────────────────────────

def _ts_srt(seconds: float) -> str:
    """00:01:23,456"""
    h = int(seconds // 3600)
    m = int((seconds % 3600) // 60)
    s = int(seconds % 60)
    ms = int(round((seconds % 1) * 1000))
    return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"


def _ts_vtt(seconds: float) -> str:
    """00:01:23.456"""
    h = int(seconds // 3600)
    m = int((seconds % 3600) // 60)
    s = int(seconds % 60)
    ms = int(round((seconds % 1) * 1000))
    return f"{h:02d}:{m:02d}:{s:02d}.{ms:03d}"


def _ts_ass(seconds: float) -> str:
    """0:01:23.45 (centiseconds)"""
    h = int(seconds // 3600)
    m = int((seconds % 3600) // 60)
    s = int(seconds % 60)
    cs = int(round((seconds % 1) * 100))
    return f"{h:d}:{m:02d}:{s:02d}.{cs:02d}"


# ── Formatters ─────────────────────────────────────────────────────

def segments_to_srt(segments: Sequence[dict]) -> str:
    lines: list[str] = []
    for i, seg in enumerate(segments, start=1):
        start = _ts_srt(seg["start"])
        end = _ts_srt(seg["end"])
        text = seg["text"].strip()
        if "translated" in seg and seg["translated"]:
            text = f"{text}\n{seg['translated'].strip()}"
        lines.append(f"{i}\n{start} --> {end}\n{text}\n")
    return "\n".join(lines)


def segments_to_vtt(segments: Sequence[dict]) -> str:
    lines: list[str] = ["WEBVTT", ""]
    for i, seg in enumerate(segments, start=1):
        start = _ts_vtt(seg["start"])
        end = _ts_vtt(seg["end"])
        text = seg["text"].strip()
        if "translated" in seg and seg["translated"]:
            text = f"{text}\n{seg['translated'].strip()}"
        lines.append(f"{i}\n{start} --> {end}\n{text}\n")
    return "\n".join(lines)


def segments_to_ass(segments: Sequence[dict]) -> str:
    header = (
        "[Script Info]\n"
        "Title: LocalSub Export\n"
        "ScriptType: v4.00+\n"
        "PlayResX: 1920\n"
        "PlayResY: 1080\n"
        "\n"
        "[V4+ Styles]\n"
        "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, "
        "OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, "
        "ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, "
        "Alignment, MarginL, MarginR, MarginV, Encoding\n"
        "Style: Default,Arial,48,&H00FFFFFF,&H000000FF,&H00000000,&H80000000,"
        "0,0,0,0,100,100,0,0,1,2,1,2,10,10,30,1\n"
        "\n"
        "[Events]\n"
        "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n"
    )
    lines: list[str] = [header]
    for seg in segments:
        start = _ts_ass(seg["start"])
        end = _ts_ass(seg["end"])
        text = seg["text"].strip().replace("\n", "\\N")
        if "translated" in seg and seg["translated"]:
            text = f"{text}\\N{seg['translated'].strip().replace(chr(10), '\\N')}"
        lines.append(
            f"Dialogue: 0,{start},{end},Default,,0,0,0,,{text}"
        )
    return "\n".join(lines)


# ── Unified entry point ────────────────────────────────────────────

def format_subtitles(segments: Sequence[dict], fmt: str = "srt") -> str:
    fmt = fmt.lower()
    if fmt == "vtt":
        return segments_to_vtt(segments)
    if fmt == "ass":
        return segments_to_ass(segments)
    return segments_to_srt(segments)
