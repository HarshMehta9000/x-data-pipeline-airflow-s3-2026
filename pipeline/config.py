"""Central configuration, driven entirely by environment variables.

Every knob has a safe default so the pipeline runs offline with zero setup.
Set MOCK_MODE=0 plus the X_* and S3 vars to run against live services.
"""
from __future__ import annotations

import os
from dataclasses import dataclass, field


def _as_bool(value: str | None, default: bool) -> bool:
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


@dataclass(frozen=True)
class Config:
    # When True, no network calls are made: tweets come from a local fixture
    # and "S3" writes go to a local directory. This is what lets the DAG run
    # and be verified without paid X API credentials or an AWS account.
    mock_mode: bool = field(
        default_factory=lambda: _as_bool(os.getenv("MOCK_MODE"), True)
    )

    # --- X (Twitter) API v2 ---
    x_bearer_token: str = field(default_factory=lambda: os.getenv("X_BEARER_TOKEN", ""))
    x_query: str = field(default_factory=lambda: os.getenv("X_QUERY", "from:elonmusk"))
    x_max_results: int = field(
        default_factory=lambda: int(os.getenv("X_MAX_RESULTS", "100"))
    )

    # --- Storage (S3 or local fallback) ---
    s3_bucket: str = field(default_factory=lambda: os.getenv("S3_BUCKET", ""))
    s3_prefix: str = field(default_factory=lambda: os.getenv("S3_PREFIX", "x-data"))
    # Used in mock_mode, or as a fallback when no bucket is configured.
    local_output_dir: str = field(
        default_factory=lambda: os.getenv("LOCAL_OUTPUT_DIR", "./output")
    )

    fixture_path: str = field(
        default_factory=lambda: os.getenv(
            "FIXTURE_PATH",
            os.path.join(os.path.dirname(__file__), "..", "fixtures", "sample_tweets.json"),
        )
    )

    @property
    def use_s3(self) -> bool:
        """True only when we should actually talk to S3."""
        return bool(self.s3_bucket) and not self.mock_mode


def load_config() -> Config:
    return Config()
