"""Extract stage: pull posts from X (Twitter) API v2.

In mock_mode we load a JSON fixture instead of calling the network, so the
pipeline is fully runnable offline. The live path uses Tweepy's v2 client,
which is the only supported way to read X data in 2026 (snscrape and the old
free guest API no longer work).
"""
from __future__ import annotations

import json
from typing import Any

from .config import Config


def _normalize(raw: dict[str, Any]) -> dict[str, Any]:
    """Coerce one post into the flat schema the rest of the pipeline expects."""
    metrics = raw.get("public_metrics", {}) or {}
    return {
        "id": str(raw.get("id", "")),
        "created_at": raw.get("created_at", ""),
        "text": raw.get("text", ""),
        "like_count": int(metrics.get("like_count", 0)),
        "retweet_count": int(metrics.get("retweet_count", 0)),
        "reply_count": int(metrics.get("reply_count", 0)),
        "quote_count": int(metrics.get("quote_count", 0)),
        "source": raw.get("source", "unknown"),
    }


def _extract_from_fixture(cfg: Config) -> list[dict[str, Any]]:
    with open(cfg.fixture_path, "r", encoding="utf-8") as fh:
        payload = json.load(fh)
    return [_normalize(item) for item in payload]


def _extract_from_x_api(cfg: Config) -> list[dict[str, Any]]:
    import tweepy  # imported lazily so offline runs need no live deps

    if not cfg.x_bearer_token:
        raise RuntimeError("X_BEARER_TOKEN is required when MOCK_MODE is off")

    client = tweepy.Client(bearer_token=cfg.x_bearer_token)
    response = client.search_recent_tweets(
        query=cfg.x_query,
        max_results=min(cfg.x_max_results, 100),
        tweet_fields=["created_at", "public_metrics", "source"],
    )
    tweets = response.data or []
    return [
        _normalize(
            {
                "id": t.id,
                "created_at": str(t.created_at) if t.created_at else "",
                "text": t.text,
                "public_metrics": t.public_metrics,
                "source": getattr(t, "source", "unknown"),
            }
        )
        for t in tweets
    ]


def extract_posts(cfg: Config) -> list[dict[str, Any]]:
    """Return a list of normalized post dicts from X or the local fixture."""
    if cfg.mock_mode:
        return _extract_from_fixture(cfg)
    return _extract_from_x_api(cfg)
