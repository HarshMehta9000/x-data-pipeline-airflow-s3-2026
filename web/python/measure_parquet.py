"""Measure what the repo's load stage actually writes, with pyarrow.

Nothing on the page estimates Parquet size from a guess. This runs
pipeline.load.load_data at a range of row counts, reads the files back, and
fits bytes as overhead plus bytes per row by least squares. The fit, the raw
measurements and the versions of the libraries that produced them go into
data/parquet-bytes.json, and gate 5 re-derives the fit from the raw points.

Also records the inferred Parquet schema per batch, which is what finding 4h is
about: pd.DataFrame(rows) infers dtypes per batch, so two batches of the same
logical data can disagree on column type.
"""
from __future__ import annotations

import json
import os
import shutil
import sys
import tempfile
from datetime import datetime, timezone

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
sys.path.insert(0, REPO)

# Block the optional scorer so the measurement is a property of the schema and
# the row count, not of what happens to be installed. With vaderSentiment
# present the sentiment_score values differ and the file size moves by a few
# bytes, which is finding 4d showing up in a build artefact.
sys.modules["vaderSentiment"] = None  # type: ignore[assignment]
sys.modules["vaderSentiment.vaderSentiment"] = None  # type: ignore[assignment]

import pandas as pd  # noqa: E402
import pyarrow  # noqa: E402
import pyarrow.parquet as pq  # noqa: E402

from pipeline.config import Config  # noqa: E402
from pipeline.extract import _normalize  # noqa: E402
from pipeline.load import load_data  # noqa: E402
from pipeline.transform import transform_posts  # noqa: E402

ROW_COUNTS = [1, 2, 5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000]

TEXTS = [
    "Shipping the update tonight. Status report to follow.",
    "This is an amazing milestone for the team. Huge win and I am so excited!",
    "The launch was delayed again. This is a problem and pretty disappointing.",
    "Incredible progress today. The best engineers in the world made this happen.",
    "Some servers went down. Working on a fix now.",
]


def make_posts(n: int) -> list[dict]:
    out = []
    for i in range(n):
        day = 15 + (i % 7)
        out.append(
            _normalize(
                {
                    "id": f"19{100000000000000 + i:015d}",
                    "created_at": f"2026-01-{day:02d}T{i % 24:02d}:00:00.000Z",
                    "text": TEXTS[i % len(TEXTS)],
                    "source": "Twitter Web App",
                    "public_metrics": {
                        "like_count": 1000 + i * 7,
                        "retweet_count": 100 + i,
                        "reply_count": 50 + (i % 31),
                        "quote_count": i % 17,
                    },
                }
            )
        )
    return out


def fit(xs: list[int], ys: list[int]) -> tuple[float, float]:
    """Ordinary least squares, y = a + b x."""
    n = len(xs)
    sx = sum(xs)
    sy = sum(ys)
    sxx = sum(x * x for x in xs)
    sxy = sum(x * y for x, y in zip(xs, ys))
    denom = n * sxx - sx * sx
    b = (n * sxy - sx * sy) / denom
    a = (sy - b * sx) / n
    return a, b


def schema_of(rows: list[dict]) -> dict[str, str]:
    table = pyarrow.Table.from_pandas(pd.DataFrame(rows), preserve_index=False)
    return {f.name: str(f.type) for f in table.schema}


def main() -> None:
    tmp = tempfile.mkdtemp(prefix="xdp-parquet-")
    try:
        posts_points = []
        summary_points = []
        schemas = {}

        for n in ROW_COUNTS:
            posts = make_posts(n)
            transformed = transform_posts(posts)
            cfg = Config(mock_mode=True, local_output_dir=tmp)
            locs = load_data(cfg, transformed)

            posts_path = locs["posts"]
            summary_path = locs["daily_summary"]
            posts_bytes = os.path.getsize(posts_path)
            summary_bytes = os.path.getsize(summary_path)

            # Read it back so the number describes a file pyarrow can open.
            back = pq.ParquetFile(posts_path).read()
            assert back.num_rows == n, f"round trip lost rows at n={n}"

            posts_points.append({"rows": n, "bytes": posts_bytes})
            summary_points.append(
                {"rows": len(transformed["daily_summary"]), "bytes": summary_bytes}
            )
            if n == 100:
                schemas["posts"] = {f.name: str(f.type) for f in back.schema}

        # Finding 4h: the same logical schema, inferred differently per batch.
        full = make_posts(20)
        no_source = [dict(p, source=None) for p in make_posts(20)]
        zero_metrics = [
            dict(p, like_count=0, retweet_count=0, reply_count=0, quote_count=0)
            for p in make_posts(20)
        ]
        # A single null count in the batch. It has to be introduced after
        # transform, because transform sums the four counts and a None there
        # raises TypeError rather than producing a row: the pipeline has no
        # guard for a metric the API did not return.
        one_missing = [dict(r) for r in transform_posts(make_posts(20))["posts"]]
        one_missing[0]["like_count"] = None

        drift = {
            "typical_batch": schema_of(transform_posts(full)["posts"]),
            "all_sources_absent": schema_of(transform_posts(no_source)["posts"]),
            "all_metrics_zero": schema_of(transform_posts(zero_metrics)["posts"]),
            "one_missing_like_count": schema_of(one_missing),
        }

        a_p, b_p = fit([p["rows"] for p in posts_points], [p["bytes"] for p in posts_points])
        uniq = {}
        for p in summary_points:
            uniq[p["rows"]] = p["bytes"]
        srows = sorted(uniq)
        a_s, b_s = fit(srows, [uniq[r] for r in srows])

        json.dump(
            {
                "version": 1,
                "measured_at": datetime.now(timezone.utc).strftime("%Y-%m-%d"),
                "produced_by": "web/python/measure_parquet.py",
                "environment": {
                    "python": sys.version.split()[0],
                    "pandas": pd.__version__,
                    "pyarrow": pyarrow.__version__,
                },
                "scorer": "fallback lexicon, vaderSentiment import blocked",
                "note": (
                    "Sizes are of files written by pipeline/load.py through "
                    "pandas.to_parquet with its default compression, read back with "
                    "pyarrow.parquet to confirm the row count survives."
                ),
                "posts": {
                    "points": posts_points,
                    "overhead_bytes": round(a_p, 3),
                    "bytes_per_row": round(b_p, 4),
                },
                "daily_summary": {
                    "points": [{"rows": r, "bytes": uniq[r]} for r in srows],
                    "overhead_bytes": round(a_s, 3),
                    "bytes_per_row": round(b_s, 4),
                },
                "schema_at_100_rows": schemas.get("posts", {}),
                "schema_drift": drift,
            },
            sys.stdout,
            indent=2,
        )
        sys.stdout.write("\n")
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


if __name__ == "__main__":
    main()
