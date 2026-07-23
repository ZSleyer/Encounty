#!/usr/bin/env python3
"""Extracts NCC test fixtures from a development database.

Test templates are authored in the running app (dev DB) and carry their
ground truth encoded in the template NAME:

    <Pokemon>: <label> (<difficulty>) [<n>: <start>f-<end>f(max<frame>f) | ...]

where each bracket entry is one expected encounter window in video frames
(60 fps) and the optional ``max<frame>`` marks the very last frame that is
still detectable at all (hard, rare; documented but not asserted). The
parser tolerates the variants observed in real names: ``|`` or ``&`` as
separators, missing ``f`` suffixes and a missing closing parenthesis after
``max``.

Outputs into ``fixtures/`` next to this script:
  - one PNG per template:  <video>_<Pokemon>_<id>.png
  - test-config.json:      region definitions (existing suite format)
  - ground-truth.json:     encounters, difficulty, negative frames, sweep cases

Usage: python3 extract-fixtures.py [path-to-encounty.db]
"""

import json
import re
import sqlite3
import subprocess
import sys
from pathlib import Path

FPS = 60

# Canonical pokemon_id (UUID) -> (pokemon name, video name). Names inside the
# DB template names can carry typos ("Girtatina"), so the UUID is the key.
POKEMON_VIDEOS = {
    "df958079-9376-4e4a-b6f1-62591034d52b": ("Mewtu", "FRLG_SoftReset"),
    "eb1f7a16-5f94-45e8-b776-8a59f629c7ec": ("Kyurem", "Dual_SoftReset"),
    "fc701b0b-99b6-485e-9155-bb67cd581349": ("Giratina", "Dual_SoftReset"),
    "f67b7163-6484-42ce-800a-5d09ef01fc4d": ("Goldini", "FRLG_Fishing"),
    "e3b0ae5f-8548-41c1-8a61-9f737b0aa902": ("Bluzuk", "FRLG_Runaway"),
    "59073910-9133-404b-9c0a-5c44fc8646e8": ("Chaneira", "FRLG_Runaway"),
    "bcaf1338-2a1b-4ef0-b8d1-9d43464d4c1e": ("Bisasam", "FRLG_Starter"),
    "fb0bbeba-3259-42e5-a671-833e10d0c583": ("Schiggy", "FRLG_Starter"),
    "d2a8ef99-0ad1-4d0a-9b54-e9353b3ce32b": ("Glumanda", "FRLG_Starter"),
    "ac37a68b-3f99-4591-8e7a-344dfa6b4af4": ("Dartiri", "SV_Breeding"),
    "df6655d5-e4fc-436a-ad29-3d8f4736718b": ("Relicanth", "SwSh_Breeding"),
    "1609040a-eac4-4397-9d0d-dcdac1ce2a3b": ("Picochilla", "SwSh_Runaway"),
}

# Corrections for typos in DB template names that cannot be parsed as-is.
# template_id -> {encounter index (0-based): (start, end)}
WINDOW_OVERRIDES = {
    # "Mewtu: Copyright (easy) [1: 614f-268f | ...]": 268 predates 614; the
    # author confirmed the window is 614-768.
    39: {0: (614, 768)},
}

# Sweep cases for the parameter-sweep suite: one wide 2D window, one 3D case.
# Template 39 (Copyright) instead of 35 (Wow!): the Wow! window contains
# screen fades that legitimately drop the score, which a clean-settings
# sweep expectation cannot tolerate.
SWEEP_TEMPLATE_IDS = {39, 44}

NAME_RE = re.compile(r"^[^:]+:\s*(?P<label>.*?)\s*\((?P<diff>[^)]+)\)\s*\[(?P<body>.*?)\]?\s*$")
WINDOW_RE = re.compile(
    r"^\s*\d+\s*:\s*(?P<start>\d+)f?\s*-\s*(?P<end>\d+)f?\s*(?:\(\s*max\s*(?P<max>\d+)f?\s*\)?)?\s*$"
)


def parse_name(name: str, template_id: int):
    """Parses label, difficulty and encounter windows from a template name."""
    m = NAME_RE.match(name)
    if not m:
        raise ValueError(f"template {template_id}: unparseable name: {name!r}")
    windows = []
    for i, part in enumerate(re.split(r"[|&]", m.group("body"))):
        wm = WINDOW_RE.match(part)
        if not wm:
            raise ValueError(f"template {template_id}: unparseable window {part!r} in {name!r}")
        start, end = int(wm.group("start")), int(wm.group("end"))
        if template_id in WINDOW_OVERRIDES and i in WINDOW_OVERRIDES[template_id]:
            start, end = WINDOW_OVERRIDES[template_id][i]
        if end < start:
            raise ValueError(f"template {template_id}: window {start}-{end} is reversed in {name!r}")
        window = {"start": start, "end": end}
        if wm.group("max"):
            window["maxEnd"] = int(wm.group("max"))
        windows.append(window)
    return m.group("label"), m.group("diff").strip().lower(), windows


def video_frame_count(video_path: Path) -> int:
    """Total frame count via ffprobe (duration based, 60 fps)."""
    out = subprocess.run(
        ["ffprobe", "-v", "quiet", "-show_entries", "format=duration", "-of", "csv=p=0", str(video_path)],
        capture_output=True, text=True, check=True,
    ).stdout.strip()
    return int(float(out) * FPS)


def negative_frames(windows, total_frames: int):
    """Picks up to five frames well outside every (max-extended) window."""
    PAD = 60
    spans = sorted((w["start"] - PAD, w.get("maxEnd", w["end"]) + PAD) for w in windows)
    candidates = [1]
    prev_end = 0
    for s, e in spans:
        mid = (prev_end + s) // 2
        if mid - prev_end > PAD and s - mid > PAD:
            candidates.append(mid)
        prev_end = e
    tail_mid = (prev_end + total_frames) // 2
    if tail_mid - prev_end > PAD and total_frames - tail_mid > PAD:
        candidates.append(tail_mid)
    inside = lambda f: any(s <= f <= e for s, e in spans)
    return [f for f in candidates if not inside(f)][:5]


def main() -> None:
    db_path = sys.argv[1] if len(sys.argv) > 1 else str(Path.home() / ".config/encounty/encounty.db")
    fixtures = Path(__file__).parent / "fixtures"
    fixtures.mkdir(exist_ok=True)

    con = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
    templates = con.execute(
        "SELECT id, pokemon_id, name, image_data FROM detector_templates WHERE name LIKE '%[%' ORDER BY id"
    ).fetchall()

    test_config = []
    ground_truth = []
    frame_counts = {}

    for tid, pokemon_id, name, image_data in templates:
        if pokemon_id not in POKEMON_VIDEOS:
            print(f"SKIP template {tid}: unknown pokemon_id {pokemon_id} ({name})")
            continue
        pokemon, video = POKEMON_VIDEOS[pokemon_id]
        label, difficulty, windows = parse_name(name, tid)

        png = fixtures / f"{video}_{pokemon}_{tid}.png"
        png.write_bytes(image_data)

        regions = con.execute(
            "SELECT type, expected_text, rect_x, rect_y, rect_w, rect_h FROM template_regions "
            "WHERE template_id = ? AND is_negative = 0 ORDER BY sort_order",
            (tid,),
        ).fetchall()
        for rtype, expected_text, x, y, w, h in regions:
            test_config.append({
                "video_name": video,
                "pokemon_name": pokemon,
                "template_id": tid,
                "region_type": rtype,
                "expected_text": expected_text,
                "rect_x": x, "rect_y": y, "rect_w": w, "rect_h": h,
            })

        video_path = fixtures / f"{video}.mp4"
        if video not in frame_counts:
            frame_counts[video] = video_frame_count(video_path)

        entry = {
            "videoName": video,
            "templateId": tid,
            "pokemonName": pokemon,
            "label": label,
            "difficulty": difficulty,
            "loopTestable": difficulty != "unrealistic",
            "expectedEncounters": len(windows),
            "encounters": windows,
            "negativeFrames": negative_frames(windows, frame_counts[video]),
        }
        if tid in SWEEP_TEMPLATE_IDS:
            first = windows[0]
            entry["sweepCase"] = {
                "scanStart": max(0, first["start"] - 200),
                "scanEnd": first.get("maxEnd", first["end"]) + 200,
                "matchFrame": (first["start"] + first["end"]) // 2,
            }
        ground_truth.append(entry)
        print(f"OK  {tid:3} {pokemon:11} {video:15} {difficulty:11} windows={windows} neg={entry['negativeFrames']}")

    (fixtures / "test-config.json").write_text(json.dumps(test_config, indent=2) + "\n")
    (fixtures / "ground-truth.json").write_text(json.dumps(ground_truth, indent=2) + "\n")
    print(f"\nWrote {len(ground_truth)} templates, {len(test_config)} regions.")


if __name__ == "__main__":
    main()
