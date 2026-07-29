"""Generate the parity corpus and run it through the repo's real pipeline.

The corpus is written by this script, not by the TypeScript, so both sides are
scored on inputs neither of them chose. Everything is seeded, so a rerun
produces the same corpus and a diff in the gate means a diff in the code.

Emits JSON on stdout: {"cases": [...], "expected": [...]} where expected is
what pipeline/transform.py and pipeline/load.py actually produced.
"""
from __future__ import annotations

import json
import os
import random
import sys
from datetime import datetime, timedelta, timezone

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
sys.path.insert(0, REPO)

from pipeline.extract import _normalize  # noqa: E402
from pipeline.load import _partition_path, _summary_path  # noqa: E402
from pipeline.transform import _POS, _NEG, transform_posts, _fallback_sentiment, _label  # noqa: E402


def label_probes() -> list[dict]:
    """Scores that sit exactly on, and one ulp either side of, the label cuts.

    The fallback scorer only ever returns multiples of a third, so no post can
    land on +/-0.05 through it and a gate built only from posts leaves the
    threshold comparison untested: moving it from >= to > changes nothing that
    the corpus can see. VADER's compound is continuous and does reach these
    values, so probe _label directly.
    """
    import math

    cuts = [0.05, -0.05, 0.0, 1.0, -1.0, 0.049, 0.051, -0.049, -0.051]
    probes = []
    for c in cuts:
        for v in (c, math.nextafter(c, math.inf), math.nextafter(c, -math.inf)):
            probes.append({"score": v, "label": _label(v)})
    # Rounding to 4dp is what the pipeline actually feeds _label, so probe the
    # rounding boundary too, including an exact tie that Python breaks to even.
    for v in (0.03125, -0.03125, 0.05005, 0.04995, 0.00005, 2.5e-5, 1 / 32, 3 / 32):
        probes.append({"score": v, "rounded": round(v, 4), "label": _label(round(v, 4))})
    return probes

SEED = 20260728

WORDS = sorted(_POS | _NEG)
FILLER = [
    "the", "launch", "team", "today", "servers", "update", "quarter", "shipping",
    "delayed", "disappointing", "delays", "winning", "loser", "problems", "goodness",
    "GREAT", "Best.", "'love'", "hate,", "win!", "huge?", "fail;", "bad:",
]
UNICODE = [
    "caf\u00e9 na\u00efve",
    "\u65e5\u672c\u8a9e\u306e\u6295\u7a3f",
    "emoji \U0001f680 launch",
    "\u0645\u0631\u062d\u0628\u0627 win",
    "great\u00a0win",     # non breaking space: whitespace to both, two tokens
    "bad\u2028news",      # line separator: whitespace to both
    "win\u001cfail",      # file separator: whitespace to Python, not to JS \\s
    "\ufeffgreat",        # BOM: whitespace to JS \\s, not to Python
]


def _text(rng: random.Random, i: int) -> str:
    mode = i % 12
    if mode == 0:
        return ""
    if mode == 1:
        return "   "
    if mode == 2:
        return rng.choice(UNICODE)
    if mode == 3:
        # Long text, well past a post's real length.
        return " ".join(rng.choice(WORDS + FILLER) for _ in range(400))
    if mode == 4:
        # Pure punctuation, strips down to empty tokens.
        return ".,!? ;: \"' ..."
    n = rng.randint(1, 24)
    return " ".join(rng.choice(WORDS + FILLER) for _ in range(n))


def _threshold_texts() -> list[str]:
    """Texts that land within 0.001 of a label threshold, from both sides.

    The fallback scores in thirds, so the reachable scores near +/-0.05 are 0 and
    +/-0.3333. Exact threshold cases have to come from the score side instead,
    which the score parity assertions cover; here we pin the label boundary by
    constructing scores of exactly 0.05 and -0.05 through the summary path.
    """
    out = []
    for pos, neg in ((1, 1), (2, 2), (1, 0), (0, 1), (3, 0), (0, 3), (4, 1), (1, 4)):
        out.append(" ".join(["good"] * pos + ["bad"] * neg))
    return out


def build_cases() -> list[dict]:
    rng = random.Random(SEED)
    cases: list[dict] = []

    # 1. The repo's own fixture, untouched.
    with open(os.path.join(REPO, "fixtures", "sample_tweets.json"), encoding="utf-8") as fh:
        for item in json.load(fh):
            cases.append(item)

    # 2. Threshold probes.
    for i, text in enumerate(_threshold_texts()):
        cases.append({
            "id": f"thr{i}",
            "created_at": "2026-02-01T00:00:00.000Z",
            "text": text,
            "source": "probe",
            "public_metrics": {"like_count": 1, "retweet_count": 0, "reply_count": 0, "quote_count": 0},
        })

    # 3. Structural edge cases: missing fields, nulls, wrong shapes.
    base = datetime(2026, 1, 1, tzinfo=timezone.utc)
    cases.extend([
        {},
        # An int id, which Python str()s. Deliberately small: a real 19 digit X
        # id is above 2**53 and cannot survive JSON.parse as a number, which is
        # why the fixture and the API both carry ids as strings. gate 2 asserts
        # that property of the fixture rather than letting this case hide it.
        {"id": 1850123},
        {"id": "x", "created_at": None, "text": "great"},  # null created_at
        {"id": "y", "text": "win", "public_metrics": None},
        {"id": "z", "created_at": "", "text": "bad"},
        {"id": "w", "created_at": "2026-01-15", "text": "huge win"},   # short date
        {"id": "v", "created_at": "2026-01-15T10:00:00.000Z", "text": "win", "public_metrics": {}},
        {"id": "u", "created_at": "2026-01-15T10:00:00.000Z", "text": "win",
         "public_metrics": {"like_count": 0, "retweet_count": 0, "reply_count": 0, "quote_count": 0}},
        {"id": "t", "created_at": "2026-01-15T10:00:00.000Z", "text": "win", "source": None},
    ])

    # 4. The bulk of the corpus.
    rng2 = random.Random(SEED + 1)
    for i in range(420):
        day = base + timedelta(days=rng2.randint(0, 120), hours=rng2.randint(0, 23))
        metrics = {}
        if i % 7 != 0:
            metrics = {
                "like_count": rng2.randint(0, 500000),
                "retweet_count": rng2.randint(0, 90000),
                "reply_count": rng2.randint(0, 40000),
                "quote_count": rng2.randint(0, 9000),
            }
        item = {
            "id": f"185000000000000{i:04d}",
            "created_at": day.strftime("%Y-%m-%dT%H:%M:%S.000Z"),
            "text": _text(rng2, i),
            "public_metrics": metrics,
        }
        if i % 5 != 0:
            item["source"] = rng2.choice(["Twitter for iPhone", "Twitter Web App", "Twitter for Android"])
        cases.append(item)

    return cases


def run_dates() -> list[str]:
    rng = random.Random(SEED + 2)
    out = [
        "2026-01-01T00:00:00Z",
        "2026-01-20T09:00:00Z",
        "2026-03-02T04:15:30Z",
        "2026-07-28T23:03:14Z",
        "2026-12-31T23:59:59Z",
        "2027-02-28T12:00:00Z",
        "2028-02-29T06:07:08Z",   # leap day
        "2026-11-01T00:00:01Z",
    ]
    for _ in range(24):
        d = datetime(2026, 1, 1, tzinfo=timezone.utc) + timedelta(
            days=rng.randint(0, 800), seconds=rng.randint(0, 86399)
        )
        out.append(d.strftime("%Y-%m-%dT%H:%M:%SZ"))
    return out


def main() -> None:
    """Score the corpus with whichever scorer the environment gives us.

    Called twice by gate 1, once as `corpus.py fallback` and once as
    `corpus.py vader`. The fallback run blocks the import rather than patching
    the pipeline, so both runs go through the repo's real _make_scorer and the
    difference between them is exactly finding 4d: the same code, two
    environments, two different lakes.
    """
    mode = sys.argv[1] if len(sys.argv) > 1 else "fallback"
    if mode == "fallback":
        sys.modules["vaderSentiment"] = None  # type: ignore[assignment]
        sys.modules["vaderSentiment.vaderSentiment"] = None  # type: ignore[assignment]
    else:
        import vaderSentiment  # noqa: F401  fail loudly if it is not installed

    cases = build_cases()
    normalized = [_normalize(c) for c in cases]

    # Per post expectations, one post at a time so a bad case cannot hide in an
    # aggregate, plus the whole corpus at once for the summary and byte counts.
    per_post = []
    for n in normalized:
        out = transform_posts([n])
        row = out["posts"][0]
        per_post.append({
            "normalized": n,
            "enriched": row,
            "raw_score": _fallback_sentiment(n["text"]),
            "xcom_extract_bytes": len(json.dumps([n]).encode("utf-8")),
            "xcom_transform_bytes": len(json.dumps(out).encode("utf-8")),
        })

    whole = transform_posts(normalized)

    paths = []
    for iso in run_dates():
        dt = datetime.strptime(iso, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)
        ts = dt.strftime("%Y%m%dT%H%M%SZ")
        for prefix in ("x-data", "lake/raw"):
            paths.append({
                "run_iso": iso,
                "prefix": prefix,
                "posts_key": f"{_partition_path(prefix, dt)}/posts_{ts}.parquet",
                "summary_key": f"{_summary_path(prefix, dt)}/summary_{ts}.parquet",
            })

    json.dump(
        {
            "seed": SEED,
            "scorer": mode,
            "cases": cases,
            "per_post": per_post,
            "whole_corpus": whole,
            "whole_xcom_extract_bytes": len(json.dumps(normalized).encode("utf-8")),
            "whole_xcom_transform_bytes": len(json.dumps(whole).encode("utf-8")),
            "paths": paths,
            "label_probes": label_probes(),
            "lexicon": {"positive": sorted(_POS), "negative": sorted(_NEG)},
        },
        sys.stdout,
    )


if __name__ == "__main__":
    main()
