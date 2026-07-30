/*
  The social card, 1200x630.

  Every figure on it is read out of the same simulation and the same measured
  data files the page uses. The headline is the page's headline, so a card that
  outlives a copy change is a bug rather than a nuisance: gate 7 checks that the
  card's headline still matches app/page.tsx.

  With XDP_FRAMES=<dir> it writes a copy there too, so it can be looked at
  before it is trusted.
*/
import { createCanvas } from "@napi-rs/canvas";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import {
  C,
  commas,
  drawDivergence,
  loadSim,
  outDir,
  registerFonts,
  roundRect,
  text,
  webRoot,
} from "./shared.mjs";

const W = 1200;
const H = 630;
const RUNS = 90;

registerFonts();
const sim = loadSim();
const require = createRequire(import.meta.url);
const readability = require(path.join(webRoot, "data", "readability.json"));
const matrix = require(path.join(webRoot, "data", "tests-matrix.json"));

const stream = sim.makePostStream(sim.DEFAULT_PARAMS.startMs, RUNS, 12, 7);
const result = sim.simulate({ ...sim.DEFAULT_PARAMS, days: RUNS }, stream);
const T = result.totals;

const rows = result.series.map((s) => s.rowsInLake);
const distinct = result.series.map((s) => s.distinctPosts);
const MAX = Math.ceil(Math.max(...rows) / 1000) * 1000;

const canvas = createCanvas(W, H);
const ctx = canvas.getContext("2d");

ctx.fillStyle = C.bg;
ctx.fillRect(0, 0, W, H);

/* a single hairline rule at the top, in the accent, as the only ornament */
ctx.fillStyle = C.accent;
ctx.fillRect(0, 0, W, 5);

/* eyebrow */
text(ctx, "x_data_pipeline   airflow 2.9   s3   parquet", 64, 84, {
  font: "17px Mono",
  fill: C.faint,
});

/* headline, matching app/page.tsx */
text(ctx, "Every run is green.", 64, 168, { font: "64px SansBold", fill: C.ink });
text(ctx, "The data is wrong.", 64, 236, { font: "64px SansBold", fill: C.accent });

/* the sentence that earns it */
text(
  ctx,
  `${RUNS} scheduled runs, ${T.successfulRuns} successes, ${T.failedRuns} failures.`,
  64,
  292,
  { font: "22px Sans", fill: C.muted },
);
text(
  ctx,
  `Every post lands in the lake ${T.duplicationFactor.toFixed(1)} times.`,
  64,
  326,
  { font: "22px Sans", fill: C.muted },
);

/* the four numbers */
const stats = [
  ["rows in the lake", commas(T.rowsInLake), C.series1],
  ["distinct posts", commas(T.distinctPosts), C.series2],
  ["duplication", `${T.duplicationFactor.toFixed(2)}x`, C.ink],
  ["tests that notice", `${matrix.summary.detected} of ${matrix.summary.mutations}`, C.ink],
];
let sx = 64;
for (const [label, value, colour] of stats) {
  text(ctx, label, sx, 402, { font: "15px Sans", fill: C.faint });
  text(ctx, value, sx, 438, { font: "32px MonoBold", fill: colour });
  sx += 190;
}

/* the divergence, small and to the right */
drawDivergence(ctx, {
  x: 760,
  y: 96,
  w: 376,
  h: 208,
  max: MAX,
  upTo: RUNS - 1,
  series: [
    { name: "rows", points: rows, color: C.series1 },
    { name: "distinct", points: distinct, color: C.series2 },
  ],
});
text(ctx, `${RUNS} days`, 1136, 326, { font: "13px Mono", fill: C.faint, align: "right" });

/* the finding, in the reader's own words */
const arrow = readability.probes.find((p) => p.reader === "pyarrow.dataset hive");
roundRect(ctx, 64, 486, W - 128, 92, 10);
ctx.fillStyle = C.stRetryBg;
ctx.fill();
ctx.strokeStyle = "#e3c391";
ctx.lineWidth = 1;
ctx.stroke();

text(ctx, "Two fields named day, with two types and two meanings:", 88, 520, {
  font: "18px SansBold",
  fill: C.ink,
});
text(ctx, arrow.error.slice(0, 78), 88, 550, { font: "16px Mono", fill: C.stRetry });
text(ctx, "measured, not asserted", W - 88, 550, {
  font: "14px Sans",
  fill: C.muted,
  align: "right",
});

/* write it */
fs.mkdirSync(outDir, { recursive: true });
const out = path.join(outDir, "og.png");
fs.writeFileSync(out, canvas.toBuffer("image/png"));
if (process.env.XDP_FRAMES) {
  fs.mkdirSync(process.env.XDP_FRAMES, { recursive: true });
  fs.writeFileSync(path.join(process.env.XDP_FRAMES, "og.png"), canvas.toBuffer("image/png"));
}

console.log(`og.png  ${W}x${H}  ${(fs.statSync(out).size / 1024).toFixed(0)} kB`);
console.log(
  `  ${commas(T.rowsInLake)} rows, ${commas(T.distinctPosts)} distinct, ` +
    `${T.duplicationFactor.toFixed(2)}x, ${matrix.summary.detected}/${matrix.summary.mutations} noticed`,
);
