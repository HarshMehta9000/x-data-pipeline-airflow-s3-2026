/*
  Gate 1: the browser pipeline equals the Python pipeline.

  The corpus is generated and scored by python/corpus.py, which imports the
  repo's own extract, transform and load modules. This gate replays the same
  inputs through the TypeScript in lib/pipeline.ts and asserts field by field.

  It runs twice, because the repo has two scorers and _make_scorer picks one by
  whether vaderSentiment imports. The fallback run blocks that import. Both runs
  exercise the same transform_posts, so the pair also measures finding 4d: how
  far apart the two lakes are for identical input.

  Discrete quantities are compared exactly: every normalised field, the
  engagement total, the label, the day, the partition path, the object key and
  the XCom byte count. The sentiment score is compared exactly too, because both
  sides round the same double with the same rule.
*/
import { Gate } from "./assert.mjs";
import { requireLib } from "./build-lib.mjs";
import { runPythonJson } from "./python.mjs";
import { createRequire } from "node:module";
import path from "node:path";
import { paths } from "./build-lib.mjs";

export function run() {
  const g = new Gate("gate 1  browser pipeline equals python pipeline");
  const pipeline = requireLib("pipeline.js");
  const pyjson = requireLib("pyjson.js");
  const { Vader } = requireLib("vader.js");
  const require = createRequire(import.meta.url);
  const vader = new Vader(require(path.join(paths.webRoot, "data", "vader-lexicon.json")));

  const scorers = {
    fallback: pipeline.fallbackSentiment,
    vader: (text) => vader.polarityScores(text).compound,
  };

  for (const mode of ["fallback", "vader"]) {
    const data = runPythonJson("corpus.py", [mode]);
    const scorer = scorers[mode];
    g.eq(data.scorer, mode, `corpus ran in ${mode} mode`);
    g.ok(data.cases.length >= 400, `corpus has ${data.cases.length} cases, wanted 400 or more`);

    // ---- per post parity ---------------------------------------------------
    data.per_post.forEach((expected, i) => {
      const raw = data.cases[i];
      const label = `${mode} case ${i} (${JSON.stringify(String(raw.text ?? "")).slice(0, 32)})`;

      const n = pipeline.normalize(raw);
      const e = expected.normalized;
      g.eq(n.id, e.id, `${label}: id`);
      g.eq(n.created_at, e.created_at, `${label}: created_at`);
      g.eq(n.text, e.text, `${label}: text`);
      g.eq(n.like_count, e.like_count, `${label}: like_count`);
      g.eq(n.retweet_count, e.retweet_count, `${label}: retweet_count`);
      g.eq(n.reply_count, e.reply_count, `${label}: reply_count`);
      g.eq(n.quote_count, e.quote_count, `${label}: quote_count`);
      g.eq(n.source, e.source, `${label}: source`);

      const out = pipeline.transformPosts([n], scorer);
      const row = out.posts[0];
      const x = expected.enriched;
      g.eq(row.engagement_total, x.engagement_total, `${label}: engagement_total`);
      g.eq(row.sentiment_score, x.sentiment_score, `${label}: sentiment_score`);
      g.eq(row.sentiment_label, x.sentiment_label, `${label}: sentiment_label`);
      g.eq(row.day, x.day, `${label}: day`);

      // The unrounded fallback score, so a rounding bug cannot cancel a
      // scoring bug. Always the fallback, in both modes.
      g.eq(
        pipeline.fallbackSentiment(n.text),
        expected.raw_score,
        `${label}: raw fallback score before rounding`,
      );

      // XCom sizes are a claim on the page, so they are gated like any number.
      g.eq(pyjson.pyJsonBytes([n]), expected.xcom_extract_bytes, `${label}: XCom bytes after extract`);
      g.eq(pyjson.pyJsonBytes(out), expected.xcom_transform_bytes, `${label}: XCom bytes after transform`);
    });

    // ---- whole corpus at once ----------------------------------------------
    const normalized = data.cases.map((c) => pipeline.normalize(c));
    const whole = pipeline.transformPosts(normalized, scorer);
    const expectedWhole = data.whole_corpus;

    g.eq(whole.daily_summary.length, expectedWhole.daily_summary.length, `${mode}: daily_summary row count`);
    whole.daily_summary.forEach((row, i) => {
      const x = expectedWhole.daily_summary[i];
      g.eq(row.day, x.day, `${mode} summary ${i}: day`);
      g.eq(row.post_count, x.post_count, `${mode} summary ${i}: post_count`);
      g.eq(row.total_engagement, x.total_engagement, `${mode} summary ${i}: total_engagement`);
      g.eq(row.avg_sentiment, x.avg_sentiment, `${mode} summary ${i}: avg_sentiment`);
      g.eq(row.positive, x.positive, `${mode} summary ${i}: positive`);
      g.eq(row.neutral, x.neutral, `${mode} summary ${i}: neutral`);
      g.eq(row.negative, x.negative, `${mode} summary ${i}: negative`);
    });

    g.eq(pyjson.pyJsonBytes(normalized), data.whole_xcom_extract_bytes, `${mode}: whole corpus XCom after extract`);
    g.eq(pyjson.pyJsonBytes(whole), data.whole_xcom_transform_bytes, `${mode}: whole corpus XCom after transform`);

    // ---- paths and object keys ---------------------------------------------
    for (const p of data.paths) {
      const runDt = new Date(p.run_iso);
      const keys = pipeline.loadKeys(p.prefix, runDt);
      g.eq(keys.posts_key, p.posts_key, `${mode}: posts key for ${p.run_iso} under ${p.prefix}`);
      g.eq(keys.summary_key, p.summary_key, `${mode}: summary key for ${p.run_iso} under ${p.prefix}`);
    }

    // ---- label thresholds, probed directly ---------------------------------
    // No post can score exactly 0.05 through the fallback, so the >= in _label
    // is invisible to the corpus. Probe the comparison itself, on both sides.
    for (const p of data.label_probes) {
      const score = p.rounded === undefined ? p.score : p.rounded;
      if (p.rounded !== undefined) {
        g.eq(pipeline.pyRound4(p.score), p.rounded, `round(${p.score}, 4)`);
      }
      g.eq(pipeline.labelFor(score), p.label, `label for ${score}`);
    }

    // ---- the lexicon the page draws is the repo's lexicon -------------------
    g.deepEq([...pipeline.POS_WORDS].sort(), data.lexicon.positive, `${mode}: positive lexicon matches transform.py`);
    g.deepEq([...pipeline.NEG_WORDS].sort(), data.lexicon.negative, `${mode}: negative lexicon matches transform.py`);
  }

  return g.report();
}
