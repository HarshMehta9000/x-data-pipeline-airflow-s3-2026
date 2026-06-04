"""Tests for the X data pipeline. All run offline (MOCK_MODE default)."""
from __future__ import annotations

import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from pipeline import run_etl  # noqa: E402
from pipeline.config import Config  # noqa: E402
from pipeline.extract import extract_posts  # noqa: E402
from pipeline.transform import transform_posts  # noqa: E402


def _cfg(tmp_path) -> Config:
    return Config(mock_mode=True, local_output_dir=str(tmp_path))


def test_extract_normalizes_schema():
    posts = extract_posts(Config(mock_mode=True))
    assert len(posts) == 5
    expected = {
        "id", "created_at", "text", "like_count", "retweet_count",
        "reply_count", "quote_count", "source",
    }
    assert expected.issubset(posts[0].keys())
    assert isinstance(posts[0]["like_count"], int)


def test_transform_adds_sentiment_and_engagement():
    posts = extract_posts(Config(mock_mode=True))
    out = transform_posts(posts)
    first = out["posts"][0]
    assert first["engagement_total"] == (
        first["like_count"] + first["retweet_count"]
        + first["reply_count"] + first["quote_count"]
    )
    assert -1.0 <= first["sentiment_score"] <= 1.0
    assert first["sentiment_label"] in {"positive", "neutral", "negative"}
    # The cheerful post #1 should read positive; the "problem" post negative.
    assert out["posts"][0]["sentiment_label"] == "positive"
    assert out["posts"][1]["sentiment_label"] == "negative"


def test_daily_summary_groups_by_day():
    posts = extract_posts(Config(mock_mode=True))
    out = transform_posts(posts)
    days = {row["day"] for row in out["daily_summary"]}
    assert days == {"2026-01-15", "2026-01-16"}
    jan15 = next(r for r in out["daily_summary"] if r["day"] == "2026-01-15")
    assert jan15["post_count"] == 3


def test_end_to_end_writes_parquet(tmp_path):
    result = run_etl(_cfg(tmp_path))
    assert result["post_count"] == 5
    assert result["mock_mode"] is True
    posts_file = Path(result["locations"]["posts"])
    summary_file = Path(result["locations"]["daily_summary"])
    assert posts_file.exists() and posts_file.suffix == ".parquet"
    assert summary_file.exists()
    # Partition layout must be present in the path.
    assert "year=" in str(posts_file) and "month=" in str(posts_file)
