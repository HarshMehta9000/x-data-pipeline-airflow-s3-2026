/*
  Gate 5: the Parquet claim.

  This page does not write Parquet in the browser, so it must never say that it
  does. Two halves: the measurements are real and reproducible, and the copy
  never claims bytes were produced here.
*/
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { Gate } from "./assert.mjs";
import { requireLib, paths } from "./build-lib.mjs";
import { runPythonJson } from "./python.mjs";

const require = createRequire(import.meta.url);

export function run() {
  const g = new Gate("gate 5  the parquet claim");
  const sim = requireLib("sim.js");
  const measured = require(path.join(paths.webRoot, "data", "parquet-bytes.json"));

  /* ---- the measurement is real ---------------------------------------- */
  g.ok(measured.points === undefined, "the file keeps points per dataset, not a bare curve");
  g.ok(measured.posts.points.length >= 8, "at least eight measured row counts");
  g.ok(
    /^\d{4}-\d{2}-\d{2}$/.test(measured.measured_at),
    "the measurement records its date",
  );
  g.ok(measured.environment.pyarrow.length > 0, "and the pyarrow version that produced it");
  g.ok(measured.environment.pandas.length > 0, "and the pandas version");

  let prev = 0;
  for (const point of measured.posts.points) {
    g.ok(point.bytes > prev, `bytes increase at ${point.rows} rows`);
    prev = point.bytes;
    g.eq(
      sim.parquetBytes("posts", point.rows),
      point.bytes,
      `the model returns the measured value at ${point.rows} rows`,
    );
  }

  // Interpolation stays between its neighbours rather than wandering.
  for (let i = 1; i < measured.posts.points.length; i += 1) {
    const a = measured.posts.points[i - 1];
    const b = measured.posts.points[i];
    const mid = Math.round((a.rows + b.rows) / 2);
    const v = sim.parquetBytes("posts", mid);
    g.ok(v >= a.bytes && v <= b.bytes, `interpolated size at ${mid} rows sits between the measurements`);
  }

  g.eq(sim.parquetBytes("posts", 0), 0, "no rows means no object");

  // The small file problem, quantified from the measurement rather than asserted.
  const one = measured.posts.points.find((p) => p.rows === 1);
  const big = measured.posts.points[measured.posts.points.length - 1];
  g.ok(one.bytes > 4000, "a one row Parquet file still costs thousands of bytes");
  const marginal = (big.bytes - one.bytes) / (big.rows - 1);
  g.ok(marginal < one.bytes / 10, "the marginal cost per row is far below the fixed overhead");

  /* ---- schema drift is measured, not asserted -------------------------- */
  const drift = measured.schema_drift;
  const typical = drift.typical_batch;
  g.ok(Object.keys(typical).length >= 12, "the typical schema has every column");
  g.eq(typical.source, "string", "source is a string in a typical batch");
  g.eq(drift.all_sources_absent.source, "null", "and becomes null when the batch has none");
  g.eq(typical.like_count, "int64", "like_count is int64 in a typical batch");
  g.eq(
    drift.one_missing_like_count.like_count,
    "double",
    "and becomes double when one row is missing it",
  );

  /* ---- the readability probes ------------------------------------------ */
  const readability = require(path.join(paths.webRoot, "data", "readability.json"));
  g.deepEq(readability.colliding_names, ["day"], "day is the colliding name");
  const byReader = Object.fromEntries(readability.probes.map((p) => [p.reader, p]));

  g.ok(byReader["pyarrow.parquet.ParquetFile"].ok, "a single object opens on its own");
  g.eq(
    byReader["pyarrow.parquet.ParquetFile"].detail.day_column_type,
    "string",
    "and its day column is a string",
  );
  g.ok(
    !byReader["pyarrow.dataset hive"].ok,
    "the partitioned dataset does not open in pyarrow",
  );
  g.ok(
    byReader["pyarrow.dataset hive"].error.includes("day"),
    "and the error names the day field",
  );
  g.ok(byReader["duckdb hive_partitioning"].ok, "duckdb opens the same layout");
  g.deepEq(
    byReader["duckdb hive_partitioning"].detail.day_values,
    [28],
    "and returns the run's day of month as day",
  );
  g.ok(
    !byReader["duckdb filter on the event date"].ok,
    "filtering on the event date fails against that column",
  );
  g.deepEq(
    byReader["duckdb hive_partitioning off"].detail.day_values,
    ["2026-01-15", "2026-01-16"],
    "with partitioning off the real event dates come back",
  );

  // These have to disagree, or the finding is not a finding.
  g.ok(
    JSON.stringify(byReader["duckdb hive_partitioning"].detail.day_values) !==
      JSON.stringify(byReader["duckdb hive_partitioning off"].detail.day_values),
    "the two readings of day genuinely differ",
  );

  /* ---- the page never claims to have produced Parquet bytes ------------ */
  const componentDir = path.join(paths.webRoot, "components");
  const appDir = path.join(paths.webRoot, "app");
  const files = [
    ...fs.readdirSync(componentDir).map((f) => path.join(componentDir, f)),
    ...fs.readdirSync(appDir).map((f) => path.join(appDir, f)),
  ].filter((f) => f.endsWith(".tsx"));

  const FORBIDDEN = [
    /we write (real )?parquet/i,
    /parquet written in (your |the )?browser/i,
    /encod(e|ing) parquet here/i,
    /generated parquet bytes/i,
  ];

  for (const file of files) {
    const source = fs.readFileSync(file, "utf8");
    for (const pattern of FORBIDDEN) {
      g.ok(
        !pattern.test(source),
        `${path.basename(file)} does not claim the browser produced Parquet (${pattern})`,
      );
    }
  }

  // And where sizes are shown, the provenance is shown with them.
  const e6 = fs.readFileSync(path.join(componentDir, "E6Diagnostics.tsx"), "utf8");
  g.ok(
    e6.includes("parquet.measured_at") && e6.includes("parquet.environment"),
    "the schema drift panel cites when and with what it was measured",
  );

  /* ---- the measurement reproduces ------------------------------------- */
  if (process.env.XDP_SKIP_SLOW !== "1") {
    const fresh = runPythonJson("measure_parquet.py");
    const a = measured.posts.points.find((p) => p.rows === 100);
    const b = fresh.posts.points.find((p) => p.rows === 100);
    // Dereferencing a missing point would crash instead of failing, and a
    // crash is a worse failure mode than a red assertion.
    g.ok(a !== undefined, "the stored measurement has a 100 row point");
    g.ok(b !== undefined, "a fresh measurement has a 100 row point");
    if (a && b) {
      g.eq(b.bytes, a.bytes, "re-running the measurement reproduces the 100 row size");
      g.deepEq(
        fresh.posts.points.map((p) => p.rows),
        measured.posts.points.map((p) => p.rows),
        "and measures the same row counts",
      );
      g.deepEq(
        fresh.posts.points.map((p) => p.bytes),
        measured.posts.points.map((p) => p.bytes),
        "and reproduces every measured size",
      );
    }
    g.deepEq(
      fresh.schema_drift.all_sources_absent,
      measured.schema_drift.all_sources_absent,
      "and reproduces the drifted schema",
    );
  }

  return g.report();
}
