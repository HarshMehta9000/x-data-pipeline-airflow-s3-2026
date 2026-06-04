# X Data Pipeline — Airflow + S3 (2026)

An Airflow ETL that ingests posts from **X (Twitter)** via the official
**X API v2**, enriches them with **sentiment and engagement analytics**, and
loads them to **S3 as partitioned Parquet**. It runs **fully offline out of the
box** (no credentials, no AWS) so you can verify the whole pipeline in seconds,
then flip two environment variables to run it live.

> **2026 update note.** The original version of this project used `snscrape`
> to scrape `@elonmusk`'s timeline and wrote a flat local CSV. Free scraping of
> X stopped working in 2023, so the source has been migrated to the supported
> X API v2 (via Tweepy). The "S3" in the title — which the original never
> actually implemented — is now real.
>
> **Why X and not LinkedIn?** LinkedIn has no public API for searching or
> reading posts, and scraping it violates their Terms of Service. There is no
> realistic, compliant way to build a LinkedIn post-ingestion pipeline, so this
> project uses X, which exposes a paid-but-official read API.

## What's new (the two features)

1. **Real S3 load with partitioned Parquet** (`pipeline/load.py`)
   Data is written as columnar Parquet in a Hive-style partition layout
   (`year=/month=/day=`), which is the standard for querying with Athena,
   Spark, or DuckDB. When no bucket is configured (or in mock mode), it writes
   to a local directory with the identical layout, so the code path is the same
   everywhere.

2. **Sentiment + engagement analytics enrichment** (`pipeline/transform.py`)
   Every post gets a sentiment score and label, plus a combined engagement
   total (likes + retweets + replies + quotes). A **daily aggregate summary**
   is produced alongside the raw rows (post count, total engagement, average
   sentiment, and a positive/neutral/negative breakdown per day). Sentiment uses
   `vaderSentiment` when installed and falls back to a built-in lexicon scorer
   otherwise, so offline runs need nothing extra.

## Architecture

```
                 ┌───────────┐     ┌─────────────┐     ┌──────────┐
   X API v2  ──► │  extract  │ ──► │  transform  │ ──► │   load   │ ──► S3 (Parquet)
  (or fixture)   └───────────┘     └─────────────┘     └──────────┘     (or local dir)
                  normalize          sentiment +         partitioned
                  to flat schema     engagement +        year=/month=/day=
                                     daily summary
```

The three stages are independent, importable functions in the `pipeline`
package and are wired together as an Airflow DAG (`dags/x_data_pipeline.py`)
that passes data between tasks via XCom.

## Project layout

```
.
├── dags/
│   └── x_data_pipeline.py      # Airflow 2.9 DAG: extract >> transform >> load
├── pipeline/
│   ├── config.py               # env-driven config; MOCK_MODE toggle
│   ├── extract.py              # X API v2 (Tweepy) + offline fixture fallback
│   ├── transform.py            # FEATURE 2: sentiment + engagement + daily summary
│   ├── load.py                 # FEATURE 1: partitioned Parquet to S3 / local
│   └── __init__.py             # run_etl() orchestrator
├── fixtures/sample_tweets.json # offline sample shaped like an X API v2 response
├── tests/test_pipeline.py      # pytest suite, runs offline
└── requirements.txt
```

## Quickstart (offline — no credentials needed)

```bash
pip install pandas pyarrow pytest vaderSentiment

# run the tests
python -m pytest tests/ -v

# run the ETL directly
python -c "from pipeline import run_etl; print(run_etl())"
```

This reads the bundled fixture, enriches it, and writes Parquet under
`./output/`. The default `MOCK_MODE=1` means no network or AWS calls happen.

### Run it through Airflow

```bash
pip install "apache-airflow==2.9.3"
export AIRFLOW_HOME=/tmp/aflow
export AIRFLOW__CORE__DAGS_FOLDER="$(pwd)/dags"
export AIRFLOW__CORE__LOAD_EXAMPLES=False
airflow db migrate
airflow dags test x_data_pipeline
```

## Running live (X API + S3)

You need an X API Bearer Token (the v2 read endpoints require at least the
**Basic** paid tier as of 2026) and AWS credentials with write access to a
bucket. Then:

```bash
export MOCK_MODE=0
export X_BEARER_TOKEN="your-x-bearer-token"
export X_QUERY="from:elonmusk"          # any X API v2 search query
export X_MAX_RESULTS=100
export S3_BUCKET="your-bucket-name"
export S3_PREFIX="x-data"
# AWS creds via the usual chain (env vars, ~/.aws/credentials, or IAM role)
```

Install the live extras and run as above:

```bash
pip install tweepy boto3
```

## Configuration reference

| Variable           | Default        | Purpose                                            |
| ------------------ | -------------- | -------------------------------------------------- |
| `MOCK_MODE`        | `1`            | `1` = offline fixture + local writes; `0` = live   |
| `X_BEARER_TOKEN`   | *(empty)*      | X API v2 bearer token (required when live)         |
| `X_QUERY`          | `from:elonmusk`| X API v2 search query                              |
| `X_MAX_RESULTS`    | `100`          | Max posts per run (X API caps at 100/request)      |
| `S3_BUCKET`        | *(empty)*      | Target S3 bucket (live load)                       |
| `S3_PREFIX`        | `x-data`       | Key prefix inside the bucket                       |
| `LOCAL_OUTPUT_DIR` | `./output`     | Where Parquet lands in mock/no-bucket mode         |

## Output layout

```
{prefix}/posts/year=YYYY/month=MM/day=DD/posts_<ts>.parquet
{prefix}/daily_summary/run_date=YYYY-MM-DD/summary_<ts>.parquet
```

## Proof it works

The full pipeline was executed end-to-end in offline mode. All four tests pass:

```
tests/test_pipeline.py::test_extract_normalizes_schema PASSED            [ 25%]
tests/test_pipeline.py::test_transform_adds_sentiment_and_engagement PASSED [ 50%]
tests/test_pipeline.py::test_daily_summary_groups_by_day PASSED          [ 75%]
tests/test_pipeline.py::test_end_to_end_writes_parquet PASSED            [100%]
============================== 4 passed in 0.80s ===============================
```

The Airflow DAG parses with **no import errors** and runs to success on
Airflow 2.9.3 (`airflow dags test x_data_pipeline`):

```
Marking task as SUCCESS ... task_id=extract
Marking task as SUCCESS ... task_id=transform
Marking task as SUCCESS ... task_id=load
DagRun Finished: dag_id=x_data_pipeline, ... state=success
```

Enriched output (the two new features visible in the data):

```
                 id  sentiment_score sentiment_label  engagement_total        day
1850000000000000001           0.9233        positive             56860 2026-01-15
1850000000000000002          -0.5574        negative             15335 2026-01-15
1850000000000000003           0.0000         neutral              9843 2026-01-15
1850000000000000004           0.8070        positive             72390 2026-01-16
1850000000000000005           0.0000         neutral              7308 2026-01-16

=== DAILY SUMMARY ===
       day  post_count  total_engagement  avg_sentiment  positive  neutral  negative
2026-01-15           3             82038         0.1220         1        1         1
2026-01-16           2             79698         0.4035         1        1         0
```

## License

See `LICENSE` (unchanged from the original project).
