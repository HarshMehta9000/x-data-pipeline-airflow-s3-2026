"""Can the lake this pipeline writes actually be read back?

Everything else on the page is about where rows land. This asks the prior
question: once the objects are on disk in the layout load.py produces, does a
partition aware reader open them.

The answer is measured, not argued. The repo's own run_etl writes into a temp
directory and several readers are pointed at the result, each one recorded with
its exact error. Emitted as data/readability.json, re-derived by gate 5.

The finding, for the record: transform.py adds a string column named `day`
holding the post's own date, and load.py partitions into directories named
`day=DD` holding the run's day of month. Hive style discovery materialises the
partition key as a column, so the dataset has two fields called `day` with
different types and different meanings, and the merge fails.
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

import pyarrow  # noqa: E402
import pyarrow.dataset as ds  # noqa: E402
import pyarrow.parquet as pq  # noqa: E402

from pipeline import run_etl  # noqa: E402
from pipeline.config import Config  # noqa: E402

try:
    import duckdb
except ImportError:  # pragma: no cover
    duckdb = None


def probe(name, description, fn):
    try:
        detail = fn()
        return {
            "reader": name,
            "description": description,
            "ok": True,
            "detail": detail,
            "error_type": None,
            "error": None,
        }
    except Exception as exc:  # noqa: BLE001  the error is the measurement
        return {
            "reader": name,
            "description": description,
            "ok": False,
            "detail": None,
            "error_type": type(exc).__name__,
            "error": " ".join(str(exc).split())[:300],
        }


def main() -> None:
    tmp = tempfile.mkdtemp(prefix="xdp-read-")
    try:
        result = run_etl(Config(mock_mode=True, local_output_dir=tmp))
        posts_file = result["locations"]["posts"]
        posts_root = os.path.join(tmp, "x-data", "posts")

        file_table = pq.ParquetFile(posts_file).read()
        columns = list(file_table.schema.names)
        partition_dirs = [
            p for p in os.path.relpath(posts_file, tmp).split(os.sep) if "=" in p
        ]
        collisions = sorted(
            {p.split("=", 1)[0] for p in partition_dirs} & set(columns)
        )

        probes = [
            probe(
                "pyarrow.parquet.ParquetFile",
                "One object, opened directly, with no partition discovery.",
                lambda: {
                    "rows": pq.ParquetFile(posts_file).read().num_rows,
                    "day_column_type": str(file_table.schema.field("day").type),
                    "day_values": file_table.column("day").to_pylist()[:3],
                },
            ),
            probe(
                "pyarrow.dataset hive",
                "The whole posts dataset, the way a partitioned table is normally read.",
                lambda: {"rows": ds.dataset(posts_root, format="parquet", partitioning="hive").to_table().num_rows},
            ),
            probe(
                "pyarrow.dataset no partitioning",
                "The same files with partition discovery switched off, which throws the partition values away.",
                lambda: {"rows": ds.dataset(posts_root, format="parquet").to_table().num_rows},
            ),
        ]

        if duckdb is not None:
            glob = os.path.join(posts_root, "**", "*.parquet")
            hive = f"read_parquet('{glob}', hive_partitioning=true)"
            flat = f"read_parquet('{glob}', hive_partitioning=false)"

            probes.append(
                probe(
                    "duckdb hive_partitioning",
                    "An independent engine reading the same layout with partition keys on. It opens, which is the problem.",
                    lambda: {
                        "rows": duckdb.sql(f"select count(*) from {hive}").fetchone()[0],
                        "columns": [
                            r[0] for r in duckdb.sql(f"describe select * from {hive}").fetchall()
                        ],
                        "day_values": [
                            r[0] for r in duckdb.sql(f"select distinct day from {hive}").fetchall()
                        ],
                        "day_type": duckdb.sql(
                            f"select typeof(day) from {hive} limit 1"
                        ).fetchone()[0],
                    },
                )
            )
            probes.append(
                probe(
                    "duckdb filter on the event date",
                    "The query a reader would actually write against a column called day.",
                    lambda: {
                        "rows": duckdb.sql(
                            f"select count(*) from {hive} where day = '2026-01-15'"
                        ).fetchone()[0]
                    },
                )
            )
            probes.append(
                probe(
                    "duckdb hive_partitioning off",
                    "The same engine ignoring the partition directories, which is the only way to see the real day column.",
                    lambda: {
                        "rows": duckdb.sql(f"select count(*) from {flat}").fetchone()[0],
                        "day_values": sorted(
                            r[0] for r in duckdb.sql(f"select distinct day from {flat}").fetchall()
                        ),
                        "day_type": duckdb.sql(
                            f"select typeof(day) from {flat} limit 1"
                        ).fetchone()[0],
                    },
                )
            )

        json.dump(
            {
                "version": 1,
                "measured_at": datetime.now(timezone.utc).strftime("%Y-%m-%d"),
                "produced_by": "web/python/readability.py",
                "environment": {
                    "python": sys.version.split()[0],
                    "pyarrow": pyarrow.__version__,
                    "duckdb": None if duckdb is None else duckdb.__version__,
                },
                "written_by": "pipeline.run_etl on the repo's own fixture, MOCK_MODE",
                "object_path": os.path.relpath(posts_file, tmp),
                "file_columns": columns,
                "partition_dirs": partition_dirs,
                "colliding_names": collisions,
                "probes": probes,
            },
            sys.stdout,
            indent=2,
        )
        sys.stdout.write("\n")
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


if __name__ == "__main__":
    main()
