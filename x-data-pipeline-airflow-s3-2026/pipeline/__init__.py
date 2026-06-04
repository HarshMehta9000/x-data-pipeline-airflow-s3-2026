"""X data pipeline: extract -> transform -> load."""
from __future__ import annotations

from typing import Any

from .config import Config, load_config
from .extract import extract_posts
from .load import load_data
from .transform import transform_posts


def run_etl(cfg: Config | None = None) -> dict[str, Any]:
    """Run the full ETL once and return a small result summary."""
    cfg = cfg or load_config()
    posts = extract_posts(cfg)
    transformed = transform_posts(posts)
    locations = load_data(cfg, transformed)
    return {
        "post_count": len(transformed["posts"]),
        "summary_days": len(transformed["daily_summary"]),
        "locations": locations,
        "mock_mode": cfg.mock_mode,
    }


__all__ = ["Config", "load_config", "run_etl", "extract_posts", "transform_posts", "load_data"]
