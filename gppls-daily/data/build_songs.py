#!/usr/bin/env python3
"""Build songs.json (used by the player) from songs.tsv.

Edit songs.tsv, then run:  python3 gppls-daily/data/build_songs.py
"""
import csv
import json
import re
from pathlib import Path

HERE = Path(__file__).parent
SRC = HERE / "songs.tsv"
OUT = HERE.parent / "songs.json"

# "gppls daily 12", "g.ppls daily 12", "(gppls daily 12)", and the "gaily" typo on day 65
MARKER = re.compile(r"\s*[-–]?\s*\(?\bg\.?ppls [dg]aily (\d+)\)?", re.I)
PROD = re.compile(r"\s*\(prod\.?\s+([^)]+)\)", re.I)
DATE = re.compile(r"\s*\(?\b(\d{1,2}\.\d{1,2}\.\d{2})\)?")
# Names that are only the day marker plus a generic word keep the marker, e.g. "gppls daily 254 type beat"
GENERIC = {"", "type beat", "freestyle", "based freestyle"}


def parse(day, name):
    title = name
    producer = None
    date = None

    m = PROD.search(title)
    if m:
        producer = m.group(1).strip()
        title = PROD.sub("", title, count=1)

    m = DATE.search(title)
    if m:
        date = m.group(1)
        title = DATE.sub("", title, count=1)

    without_marker = MARKER.sub("", title, count=1)
    # "i want my check type beat - gppls daily 267 type beat" -> drop the repeated suffix
    without_marker = re.sub(r"(type beat) type beat$", r"\1", without_marker.strip())
    if without_marker.strip(" -").lower() not in GENERIC:
        title = without_marker

    # Days 1-10: "nah (gppls daily 1) - 10.10.18 freestyle" -> "nah freestyle"
    title = re.sub(r"\s+-\s+freestyle$", " freestyle", title.strip())
    title = re.sub(r"\s{2,}", " ", title).strip(" -–")
    return {"day": day, "title": title, "producer": producer, "date": date}


def main():
    songs = []
    with SRC.open(newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f, delimiter="\t"):
            day = int(row["song_number"])
            song = parse(day, row["song_name"].strip())
            song["name"] = row["song_name"].strip()
            song["soundcloud"] = row["soundcloud_link"].strip() or None
            songs.append({k: v for k, v in song.items() if v is not None})

    OUT.write_text(json.dumps(songs, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    print(f"wrote {len(songs)} songs to {OUT}")


if __name__ == "__main__":
    main()
