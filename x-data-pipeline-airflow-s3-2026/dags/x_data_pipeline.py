"""Airflow 2.9 DAG for the X data pipeline.

Three tasks (extract -> transform -> load) wired with XCom. Uses the modern
`airflow.operators.python` import path and a static `start_date` (the
deprecated `days_ago` helper was removed). Runs offline out of the box via
MOCK_MODE; set the X_* / S3_* env vars and MOCK_MODE=0 for live runs.
"""
from __future__ import annotations

import sys
from datetime import datetime, timedelta
from pathlib import Path

from airflow import DAG
from airflow.operators.python import PythonOperator

# Make the sibling `pipeline` package importable when this file lives in dags/.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from pipeline import load_config  # noqa: E402
from pipeline.extract import extract_posts  # noqa: E402
from pipeline.load import load_data  # noqa: E402
from pipeline.transform import transform_posts  # noqa: E402

default_args = {
    "owner": "data-eng",
    "depends_on_past": False,
    "retries": 2,
    "retry_delay": timedelta(minutes=2),
}


def _extract(**context):
    posts = extract_posts(load_config())
    context["ti"].xcom_push(key="posts", value=posts)
    return len(posts)


def _transform(**context):
    posts = context["ti"].xcom_pull(task_ids="extract", key="posts")
    transformed = transform_posts(posts)
    context["ti"].xcom_push(key="transformed", value=transformed)
    return len(transformed["posts"])


def _load(**context):
    transformed = context["ti"].xcom_pull(task_ids="transform", key="transformed")
    return load_data(load_config(), transformed)


with DAG(
    dag_id="x_data_pipeline",
    description="Extract posts from X, enrich with sentiment/engagement, load to S3 as Parquet",
    default_args=default_args,
    start_date=datetime(2026, 1, 1),
    schedule="@daily",
    catchup=False,
    tags=["x", "etl", "s3", "sentiment"],
) as dag:
    extract = PythonOperator(task_id="extract", python_callable=_extract)
    transform = PythonOperator(task_id="transform", python_callable=_transform)
    load = PythonOperator(task_id="load", python_callable=_load)

    extract >> transform >> load
