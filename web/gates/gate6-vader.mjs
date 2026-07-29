/*
  Gate 6: the VADER port equals the installed vaderSentiment.

  E2 puts both of the repo's scorers on the same text and lets the visitor type
  their own, so the VADER side has to be a real implementation. This asserts
  compound, pos, neu and neg exactly against Python on VADER's own examples, a
  targeted set covering each rule, and a generated corpus.

  Exact, not tolerant: both sides round to the same number of places from the
  same arithmetic, so any difference is a difference in the port.
*/
import { Gate } from "./assert.mjs";
import { requireLib } from "./build-lib.mjs";
import { runPythonJson } from "./python.mjs";
import { createRequire } from "node:module";
import path from "node:path";
import { paths } from "./build-lib.mjs";

export function run() {
  const g = new Gate("gate 6  vader port equals vaderSentiment");
  const { Vader } = requireLib("vader.js");
  const require = createRequire(import.meta.url);
  const data = require(path.join(paths.webRoot, "data", "vader-lexicon.json"));
  const vader = new Vader(data);

  const expected = runPythonJson("vader_corpus.py");
  g.ok(expected.count >= 400, `vader corpus has ${expected.count} texts, wanted 400 or more`);

  for (const row of expected.rows) {
    const got = vader.polarityScores(row.text);
    const label = JSON.stringify(row.text).slice(0, 48);
    g.eq(got.compound, row.scores.compound, `${label}: compound`);
    g.eq(got.pos, row.scores.pos, `${label}: pos`);
    g.eq(got.neu, row.scores.neu, `${label}: neu`);
    g.eq(got.neg, row.scores.neg, `${label}: neg`);
  }

  // The shipped lexicon is the package's lexicon, not a subset someone trimmed.
  const live = runPythonJson("vader_counts.py");
  g.eq(Object.keys(data.lexicon).length, live.lexicon, "lexicon entry count");
  g.eq(Object.keys(data.emoji).length, live.emoji, "emoji entry count");
  g.eq(data.negate.length, live.negate, "negation word count");
  g.eq(Object.keys(data.booster).length, live.booster, "booster word count");
  g.eq(Object.keys(data.special_cases).length, live.special_cases, "special case count");
  for (const [k, v] of Object.entries(live.constants)) {
    g.eq(data.constants[k], v, `constant ${k}`);
  }
  for (const [word, valence] of Object.entries(live.spot_check)) {
    g.eq(data.lexicon[word], valence, `lexicon valence for ${word}`);
  }

  return g.report();
}
