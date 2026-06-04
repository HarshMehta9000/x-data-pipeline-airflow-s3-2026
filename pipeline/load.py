"""Load stage (FEATURE 1): write enriched data as partitioned Parquet to S3,
with a transparent local-filesystem fallback for offline runs.

Layout (the repo's title promise, finally delivered):
    {prefix}/posts/year=YYYY/month=MM/day=DD/posts_<ts>.parquet
    {prefix}/daily_summary/run_date=YYYY-MM-DD/summary_<ts>.parquet
"""
from __future__ import annotations

import io
import os
from datetime import datetime, timezone
from typing import Any

import pandas as pd

from .config import Config


def _partition_path(prefix: str, run_dt: datetime) -> str:
    return (
        f"{prefix}/posts/"
        f"year={run_dt:%Y}/month={run_dt:%m}/day={run_dt:%d}"
    )


def _summary_path(prefix: str, run_dt: datetime) -> str:
    return f"{prefix}/daily_summary/run_date={run_dt:%Y-%m-%d}"


def _write_local(df: pd.DataFrame, base_dir: str, key: str) -> str:
    full = os.path.join(base_dir, key)
    os.makedirs(os.path.dirname(full), exist_ok=True)
    df.to_parquet(full, index=False)
    return full


def _write_s3(df: pd.DataFrame, bucket: str, key: str) -> str:
    import boto3

    buf = io.BytesIO()
    df.to_parquet(buf, index=False)
    buf.seek(0)
    boto3.client("s3").put_object(Bucket=bucket, Key=key, Body=buf.getvalue())
    return f"s3://{bucket}/{key}"


def load_data(cfg: Config, transformed: dict[str, list[dict[str, Any]]]) -> dict[str, str]:
    """Write posts + daily summary as Parquet. Returns the written locations."""
    run_dt = datetime.now(timezone.utc)
    ts = run_dt.strftime("%Y%m%dT%H%M%SZ")

    posts_df = pd.DataFrame(transformed["posts"])
    summary_df = pd.DataFrame(transformed["daily_summary"])

    posts_key = f"{_partition_path(cfg.s3_prefix, run_dt)}/posts_{ts}.parquet"
    summary_key = f"{_summary_path(cfg.s3_prefix, run_dt)}/summary_{ts}.parquet"

    if cfg.use_s3:
        return {
            "posts": _write_s3(posts_df, cfg.s3_bucket, posts_key),
            "daily_summary": _write_s3(summary_df, cfg.s3_bucket, summary_key),
        }

    return {
        "posts": _write_local(posts_df, cfg.local_output_dir, posts_key),
        "daily_summary": _write_local(summary_df, cfg.local_output_dir, summary_key),
    }
