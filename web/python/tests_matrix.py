"""Compute which findings the repo's four tests can actually see.

Not by reading the tests and judging them. By mutation: for each finding, apply
the patch that changes that behaviour, run each test against the patched repo,
and record whether any test noticed. A test suite that passes both with and
without a behaviour cannot distinguish them, which is the claim the matrix makes.

Every mutation is a change a maintainer might plausibly make, either the fix for
the finding or a swap to the other of two equally valid paths. None of them is
sabotage: the baseline run has to pass first, and any mutation that fails to
apply is reported rather than silently skipped.

Emits data/tests-matrix.json.
"""
from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
from datetime import datetime, timezone

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
PYTHON = sys.executable

TESTS = [
    "test_extract_normalizes_schema",
    "test_transform_adds_sentiment_and_engagement",
    "test_daily_summary_groups_by_day",
    "test_end_to_end_writes_parquet",
]

# (id, title, file, pattern, replacement, what the change represents)
MUTATIONS = [
    (
        "partition_on_event_date",
        "Partition on the post's own date instead of the run date",
        "pipeline/load.py",
        'posts_key = f"{_partition_path(cfg.s3_prefix, run_dt)}/posts_{ts}.parquet"',
        (
            '_event_dt = (\n'
            '        datetime.strptime(transformed["posts"][0]["day"], "%Y-%m-%d").replace(tzinfo=timezone.utc)\n'
            '        if transformed["posts"] and transformed["posts"][0]["day"]\n'
            '        else run_dt\n'
            '    )\n'
            '    posts_key = f"{_partition_path(cfg.s3_prefix, _event_dt)}/posts_{ts}.parquet"'
        ),
        "the headline fix for finding 4a",
    ),
    (
        "idempotent_object_key",
        "Key the object on the run instead of the wall clock",
        "pipeline/load.py",
        'ts = run_dt.strftime("%Y%m%dT%H%M%SZ")',
        'ts = "run"',
        "makes load idempotent, so a retry overwrites rather than duplicates",
    ),
    (
        "dedupe_on_id",
        "Drop duplicate post ids before writing",
        "pipeline/load.py",
        'posts_df = pd.DataFrame(transformed["posts"])',
        'posts_df = pd.DataFrame(transformed["posts"]).drop_duplicates(subset=["id"])',
        "the merge key finding 4c says is missing",
    ),
    (
        "force_fallback_scorer",
        "Force the 28 word lexicon instead of VADER",
        "pipeline/transform.py",
        "        from vaderSentiment.vaderSentiment import SentimentIntensityAnalyzer",
        '        raise ImportError("forced to the fallback scorer")',
        "swaps between the two scorers the repo can run, finding 4d",
    ),
    (
        "stem_the_lexicon",
        "Match lexicon words by prefix so delayed matches delay",
        "pipeline/transform.py",
        "    score = sum(t in _POS for t in tokens) - sum(t in _NEG for t in tokens)",
        (
            "    def _hit(t, words):\n"
            "        return any(t == w or (len(t) > len(w) and t.startswith(w)) for w in words)\n"
            "    score = sum(_hit(t, _POS) for t in tokens) - sum(_hit(t, _NEG) for t in tokens)"
        ),
        "the stemming finding 4e",
    ),
    (
        "honour_max_results",
        "Stop silently clamping max_results to 100",
        "pipeline/extract.py",
        "max_results=min(cfg.x_max_results, 100),",
        "max_results=cfg.x_max_results,",
        "the silent truncation in finding 4f",
    ),
    (
        "xcom_passes_a_key",
        "Push a row count through XCom instead of the whole payload",
        "dags/x_data_pipeline.py",
        'context["ti"].xcom_push(key="posts", value=posts)',
        'context["ti"].xcom_push(key="posts", value=len(posts))',
        "the XCom as a data bus antipattern, finding 4g",
    ),
    (
        "declare_an_explicit_schema",
        "Cast the columns before writing instead of inferring per batch",
        "pipeline/load.py",
        "    df.to_parquet(full, index=False)",
        (
            "    _types = {\n"
            '        "id": "string", "created_at": "string", "text": "string",\n'
            '        "like_count": "int64", "retweet_count": "int64",\n'
            '        "reply_count": "int64", "quote_count": "int64", "source": "string",\n'
            "    }\n"
            "    df = df.astype({k: v for k, v in _types.items() if k in df.columns})\n"
            "    df.to_parquet(full, index=False)"
        ),
        "the schema drift finding 4h",
    ),
]


PROBE = r"""
import json, re, sys, tempfile, os
sys.path.insert(0, ".")
import pyarrow.parquet as pq
from pipeline import run_etl
from pipeline.config import Config
from pipeline.extract import extract_posts
from pipeline.transform import transform_posts

tmp = tempfile.mkdtemp()
res = run_etl(Config(mock_mode=True, local_output_dir=tmp))
posts = extract_posts(Config(mock_mode=True))
out = transform_posts(posts)
table = pq.ParquetFile(res["locations"]["posts"]).read()

# The object name carries a wall clock stamp, so normalise it before comparing.
# Without this every mutation looks like it changed something, and the no-op
# check becomes worthless.
key = os.path.relpath(res["locations"]["posts"], tmp)
key = re.sub(r"\d{8}T\d{6}Z", "<TS>", key)

print(json.dumps({
    "posts_key": key,
    "scores": [r["sentiment_score"] for r in out["posts"]],
    "labels": [r["sentiment_label"] for r in out["posts"]],
    "rows": table.num_rows,
    "schema": {f.name: str(f.type) for f in table.schema},
    "summary": out["daily_summary"],
}))
"""


def probe(root: str) -> dict:
    """What the pipeline observably produces offline, for detecting no-op mutations.

    A mutation the tests do not catch is only interesting if it changed
    something. Anything whose effect is invisible offline is reported as such
    rather than counted as a blind spot in the tests.
    """
    proc = subprocess.run(
        [PYTHON, "-c", PROBE], cwd=root, capture_output=True, text=True
    )
    if proc.returncode != 0:
        return {"error": (proc.stderr or "")[-300:]}
    try:
        return json.loads(proc.stdout)
    except json.JSONDecodeError:
        return {"error": (proc.stdout or "")[-300:]}


def run_test(root: str, test: str) -> tuple[bool, str]:
    proc = subprocess.run(
        [PYTHON, "-m", "pytest", f"tests/test_pipeline.py::{test}", "-q", "--tb=line", "-p", "no:cacheprovider"],
        cwd=root,
        capture_output=True,
        text=True,
    )
    return proc.returncode == 0, (proc.stdout or "")[-400:]


def make_copy() -> str:
    tmp = tempfile.mkdtemp(prefix="xdp-mutate-")
    for item in ("pipeline", "dags", "tests", "fixtures"):
        src = os.path.join(REPO, item)
        if os.path.isdir(src):
            shutil.copytree(src, os.path.join(tmp, item))
    return tmp


def apply_mutation(root: str, path: str, pattern: str, replacement: str) -> bool:
    full = os.path.join(root, path)
    with open(full, encoding="utf-8") as fh:
        source = fh.read()
    if pattern not in source:
        return False
    source = source.replace(pattern, replacement, 1)
    if path == "pipeline/load.py" and "timezone" not in source.split("\n")[11]:
        pass
    with open(full, "w", encoding="utf-8") as fh:
        fh.write(source)
    return True


def main() -> None:
    baseline_root = make_copy()
    baseline = {t: run_test(baseline_root, t)[0] for t in TESTS}
    baseline_probe = probe(baseline_root)
    shutil.rmtree(baseline_root, ignore_errors=True)

    if not all(baseline.values()):
        raise SystemExit(f"baseline is not green, refusing to draw a matrix: {baseline}")

    rows = []
    for mid, title, path, pattern, replacement, represents in MUTATIONS:
        root = make_copy()
        try:
            applied = apply_mutation(root, path, pattern, replacement)
            if not applied:
                rows.append({
                    "id": mid,
                    "title": title,
                    "file": path,
                    "represents": represents,
                    "applied": False,
                    "error": "pattern not found in source, mutation not applied",
                    "results": {},
                    "detected": None,
                })
                continue

            mutated_probe = probe(root)
            changed = mutated_probe != baseline_probe
            results = {}
            for t in TESTS:
                ok, tail = run_test(root, t)
                results[t] = {"passed": ok, "output": tail if not ok else ""}
            detected = any(not r["passed"] for r in results.values())
            rows.append({
                "id": mid,
                "title": title,
                "file": path,
                "represents": represents,
                "applied": True,
                "results": {k: v["passed"] for k, v in results.items()},
                "failures": {k: v["output"] for k, v in results.items() if not v["passed"]},
                "detected": detected,
                "changes_offline_output": changed,
                "observable": {
                    "baseline_posts_key": baseline_probe.get("posts_key"),
                    "mutated_posts_key": mutated_probe.get("posts_key"),
                    "baseline_scores": baseline_probe.get("scores"),
                    "mutated_scores": mutated_probe.get("scores"),
                },
            })
        finally:
            shutil.rmtree(root, ignore_errors=True)

    json.dump(
        {
            "version": 1,
            "measured_at": datetime.now(timezone.utc).strftime("%Y-%m-%d"),
            "produced_by": "web/python/tests_matrix.py",
            "method": (
                "For each mutation the repo is copied, the patch is applied, and each "
                "test is run on its own. A test that passes both before and after "
                "cannot distinguish the two behaviours."
            ),
            "tests": TESTS,
            "baseline_all_pass": all(baseline.values()),
            "rows": rows,
            "baseline_probe": baseline_probe,
            "summary": {
                "mutations": len(rows),
                "detected": sum(1 for r in rows if r["detected"]),
                "undetected": sum(1 for r in rows if r["detected"] is False),
                "changed_output_but_undetected": sum(
                    1 for r in rows if r["detected"] is False and r.get("changes_offline_output")
                ),
                "no_offline_effect": sum(
                    1 for r in rows if r.get("changes_offline_output") is False
                ),
            },
        },
        sys.stdout,
        indent=2,
    )
    sys.stdout.write("\n")


if __name__ == "__main__":
    main()
