"""Transform stage (FEATURE 2): enrich posts with sentiment + engagement
analytics, then produce a daily aggregate summary.

Sentiment uses a compact lexicon scorer so offline runs need no model
download. If `vaderSentiment` is installed it is used automatically for
better accuracy; otherwise the built-in fallback applies.
"""
from __future__ import annotations

from collections import defaultdict
from typing import Any

# Minimal sentiment lexicon used only when vaderSentiment isn't installed.
# Keeps the offline path self-contained and deterministic.
_POS = {
    "good", "great", "love", "excellent", "amazing", "happy", "win", "best",
    "awesome", "incredible", "excited", "success", "wonderful", "huge",
}
_NEG = {
    "bad", "terrible", "hate", "awful", "sad", "lose", "worst", "broken",
    "fail", "disaster", "angry", "wrong", "problem", "delay",
}


def _fallback_sentiment(text: str) -> float:
    tokens = [t.strip(".,!?;:\"'").lower() for t in text.split()]
    score = sum(t in _POS for t in tokens) - sum(t in _NEG for t in tokens)
    if not tokens:
        return 0.0
    # Squash to roughly [-1, 1] like VADER's compound score.
    return max(-1.0, min(1.0, score / 3.0))


def _make_scorer():
    try:
        from vaderSentiment.vaderSentiment import SentimentIntensityAnalyzer

        analyzer = SentimentIntensityAnalyzer()
        return lambda text: analyzer.polarity_scores(text)["compound"]
    except Exception:
        return _fallback_sentiment


def _label(score: float) -> str:
    if score >= 0.05:
        return "positive"
    if score <= -0.05:
        return "negative"
    return "neutral"


def transform_posts(posts: list[dict[str, Any]]) -> dict[str, list[dict[str, Any]]]:
    """Return {'posts': enriched rows, 'daily_summary': aggregate rows}."""
    score_fn = _make_scorer()
    enriched: list[dict[str, Any]] = []

    for p in posts:
        engagement = (
            p["like_count"] + p["retweet_count"] + p["reply_count"] + p["quote_count"]
        )
        sentiment = round(score_fn(p["text"]), 4)
        enriched.append(
            {
                **p,
                "engagement_total": engagement,
                "sentiment_score": sentiment,
                "sentiment_label": _label(sentiment),
                "day": (p["created_at"] or "")[:10],
            }
        )

    # Daily aggregate summary.
    buckets: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in enriched:
        buckets[row["day"]].append(row)

    summary: list[dict[str, Any]] = []
    for day, rows in sorted(buckets.items()):
        n = len(rows)
        summary.append(
            {
                "day": day,
                "post_count": n,
                "total_engagement": sum(r["engagement_total"] for r in rows),
                "avg_sentiment": round(sum(r["sentiment_score"] for r in rows) / n, 4),
                "positive": sum(r["sentiment_label"] == "positive" for r in rows),
                "neutral": sum(r["sentiment_label"] == "neutral" for r in rows),
                "negative": sum(r["sentiment_label"] == "negative" for r in rows),
            }
        )

    return {"posts": enriched, "daily_summary": summary}
