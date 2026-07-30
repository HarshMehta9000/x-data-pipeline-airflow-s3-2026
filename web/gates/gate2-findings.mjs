/*
  Gate 2: the findings still hold, re-derived from the repo rather than
  transcribed from anyone's notes.

  Everything here is parsed out of the source files or produced by running them.
  If a maintainer changes the schedule, the retries, the lexicon, the fixture or
  the partition construction, this gate fails and the page stops claiming it.
*/
import fs from "node:fs";
import path from "node:path";
import { Gate } from "./assert.mjs";
import { requireLib } from "./build-lib.mjs";
import { REPO_ROOT, pythonEvalJson } from "./python.mjs";

const read = (rel) => fs.readFileSync(path.join(REPO_ROOT, rel), "utf8");

export function run() {
  const g = new Gate("gate 2  the findings hold, re-derived from source");
  const pipeline = requireLib("pipeline.js");

  /* ---- the DAG, parsed from the DAG file ------------------------------- */
  const dag = read("dags/x_data_pipeline.py");

  g.ok(/dag_id\s*=\s*"x_data_pipeline"/.test(dag), "dag_id is x_data_pipeline");
  g.ok(/schedule\s*=\s*"@daily"/.test(dag), "schedule is @daily");
  g.ok(/start_date\s*=\s*datetime\(2026,\s*1,\s*1\)/.test(dag), "start_date is 2026-01-01");
  g.ok(/catchup\s*=\s*False/.test(dag), "catchup is False, which is what hides finding 4a");
  g.ok(/"retries":\s*2/.test(dag), "default_args retries is 2");
  g.ok(
    /"retry_delay":\s*timedelta\(minutes=2\)/.test(dag),
    "default_args retry_delay is 2 minutes",
  );
  g.ok(/"owner":\s*"data-eng"/.test(dag), "owner is data-eng");

  const taskIds = [...dag.matchAll(/task_id\s*=\s*"([a-z_]+)"/g)].map((m) => m[1]);
  g.deepEq(taskIds, ["extract", "transform", "load"], "three tasks, in source order");
  g.ok(
    /extract\s*>>\s*transform\s*>>\s*load/.test(dag),
    "dependency order is extract >> transform >> load",
  );

  // Finding 4g: the whole payload goes through XCom, not a key.
  g.ok(
    /xcom_push\(key="posts",\s*value=posts\)/.test(dag),
    "extract pushes the whole post list through XCom",
  );
  g.ok(
    /xcom_push\(key="transformed",\s*value=transformed\)/.test(dag),
    "transform pushes the whole enriched payload through XCom",
  );

  /* ---- load partitions on the run date, transform computes an unused day */
  const load = read("pipeline/load.py");
  g.ok(
    /run_dt\s*=\s*datetime\.now\(timezone\.utc\)/.test(load),
    "load takes its date from datetime.now, not from the data",
  );
  g.ok(
    /year=\{run_dt:%Y\}\/month=\{run_dt:%m\}\/day=\{run_dt:%d\}/.test(load),
    "the posts partition is built from the run date",
  );
  g.ok(
    /run_date=\{run_dt:%Y-%m-%d\}/.test(load),
    "the summary partition is labelled run_date, which is at least honest",
  );
  g.ok(
    /ts\s*=\s*run_dt\.strftime\("%Y%m%dT%H%M%SZ"\)/.test(load),
    "the object key carries a wall clock stamp, so retries cannot overwrite",
  );
  g.ok(!/drop_duplicates|merge|upsert/i.test(load), "load has no dedupe, merge or upsert");

  const transform = read("pipeline/transform.py");
  g.ok(
    /"day":\s*\(p\["created_at"\]\s*or\s*""\)\[:10\]/.test(transform),
    "transform derives day from the post's own created_at",
  );
  // The precise claim: load never subscripts a row by "day". Searching for the
  // bare word instead matches day=DD in the module docstring and the partition
  // format string, neither of which is a read of the column.
  g.ok(
    !/\[["']day["']\]/.test(load),
    "load never reads the day column that transform computed",
  );
  g.ok(
    /\["day"\]/.test(transform),
    "transform is the only stage that touches the day column",
  );

  /* ---- the lexicon, counted from the source --------------------------- */
  const lex = pythonEvalJson(
    "import json,sys; sys.path.insert(0,'.');" +
      "from pipeline.transform import _POS,_NEG,_fallback_sentiment;" +
      "print(json.dumps({'pos':sorted(_POS),'neg':sorted(_NEG)}))",
  );
  g.eq(lex.pos.length, 14, "14 positive words");
  g.eq(lex.neg.length, 14, "14 negative words");
  g.eq(lex.pos.length + lex.neg.length, 28, "28 words in total");
  g.deepEq([...pipeline.POS_WORDS].sort(), lex.pos, "the page's positive list is the repo's");
  g.deepEq([...pipeline.NEG_WORDS].sort(), lex.neg, "the page's negative list is the repo's");
  g.ok(lex.neg.includes("delay"), "the negative list contains delay");
  g.ok(!lex.neg.includes("delayed"), "and does not contain delayed");
  g.ok(!lex.neg.includes("disappointing"), "and does not contain disappointing");

  /* ---- the fixture ----------------------------------------------------- */
  const fixture = JSON.parse(read("fixtures/sample_tweets.json"));
  g.eq(fixture.length, 5, "the fixture holds 5 posts");
  const days = {};
  for (const p of fixture) {
    const d = String(p.created_at).slice(0, 10);
    days[d] = (days[d] ?? 0) + 1;
  }
  g.deepEq(days, { "2026-01-15": 3, "2026-01-16": 2 }, "3 posts on the 15th, 2 on the 16th");
  for (const p of fixture) {
    g.eq(typeof p.id, "string", `fixture id ${p.id} is a string, not a number`);
  }
  // A 19 digit id cannot survive JSON.parse as a number, which is why the
  // string form above is load bearing rather than incidental.
  g.ok(
    Number("1850000000000000001") !== 1850000000000000001 ||
      String(Number(fixture[0].id)) !== fixture[0].id,
    "a 19 digit id would lose precision if it were parsed as a number",
  );

  // Finding 4e, on the fixture itself.
  const missed = pipeline.fallbackSentimentTrace(fixture[1].text);
  const hits = missed.tokens.filter((t) => t.hit !== null).map((t) => t.token);
  g.deepEq(hits, ["problem"], "the delayed and disappointing post matches only problem");

  /* ---- silent truncation ---------------------------------------------- */
  const extract = read("pipeline/extract.py");
  g.ok(
    /max_results=min\(cfg\.x_max_results,\s*100\)/.test(extract),
    "extract clamps max_results to 100",
  );
  g.ok(!/paginat|next_token|flatten/i.test(extract), "and does not paginate");
  const config = read("pipeline/config.py");
  g.ok(
    /x_max_results.*int\(os\.getenv\("X_MAX_RESULTS",\s*"100"\)\)/s.test(config),
    "config accepts any integer for X_MAX_RESULTS",
  );

  /* ---- the tests ------------------------------------------------------- */
  const tests = read("tests/test_pipeline.py");
  const testNames = [...tests.matchAll(/^def (test_[a-z_]+)/gm)].map((m) => m[1]);
  g.eq(testNames.length, 4, "there are exactly 4 tests");
  g.deepEq(
    testNames,
    [
      "test_extract_normalizes_schema",
      "test_transform_adds_sentiment_and_engagement",
      "test_daily_summary_groups_by_day",
      "test_end_to_end_writes_parquet",
    ],
    "and they are the four the matrix runs",
  );
  g.ok(
    /assert "year=" in str\(posts_file\) and "month=" in str\(posts_file\)/.test(tests),
    "the end to end test checks the partition names but not their values",
  );
  g.ok(
    !/2026-01-15.*year=|year=.*2026-01-15/.test(tests),
    "no test ties a partition to the post's own date",
  );

  /* ---- file sizes, so the page's description of the repo stays true ---- */
  const sizes = {
    "dags/x_data_pipeline.py": 64,
    "pipeline/__init__.py": 26,
    "pipeline/config.py": 56,
    "pipeline/extract.py": 68,
    "pipeline/load.py": 68,
    "pipeline/transform.py": 92,
    "tests/test_pipeline.py": 64,
  };
  let total = 0;
  for (const [file, expected] of Object.entries(sizes)) {
    const lines = read(file).split("\n").length - 1;
    g.eq(lines, expected, `${file} is ${expected} lines`);
    total += lines;
  }
  g.eq(total, 438, "438 lines of Python in total");

  return g.report();
}
