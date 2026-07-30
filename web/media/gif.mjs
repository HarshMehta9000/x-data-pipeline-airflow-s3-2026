/*
  The hero GIF: the DAG on its schedule, the lake diverging from the truth, and
  the contradiction held at the end.

  Shows the mechanism rather than the result. Task instances change state, the
  two lines separate as the runs accumulate, and the punchline only appears once
  the viewer has watched it happen.

  One media target per process, because this machine has 1.9GB and no swap. The
  encoder writes each frame as it is drawn rather than holding them all.
*/
import { createCanvas } from "@napi-rs/canvas";
// gifenc ships CommonJS, so its named exports are only reachable through the
// default import under ESM.
import gifenc from "gifenc";
const { GIFEncoder, quantize, applyPalette } = gifenc;
import fs from "node:fs";
import path from "node:path";
import {
  C,
  commas,
  drawDivergence,
  loadSim,
  outDir,
  panel,
  registerFonts,
  roundRect,
  text,
} from "./shared.mjs";

const W = 900;
const H = 506;
const RUNS = 30;
const FPS = 10;
const HOLD_FRAMES = 18; // just under two seconds on the contradiction
const DELAY = Math.round(1000 / FPS);

registerFonts();
const sim = loadSim();

const stream = sim.makePostStream(sim.DEFAULT_PARAMS.startMs, RUNS + 2, 12, 7);
const result = sim.simulate(
  { ...sim.DEFAULT_PARAMS, days: RUNS, measureXcom: true },
  stream,
);

const rows = result.series.map((s) => s.rowsInLake);
const distinct = result.series.map((s) => s.distinctPosts);
const MAX = Math.ceil(Math.max(...rows) / 1000) * 1000;

const TASKS = ["extract", "transform", "load"];
const STATES = {
  queued: { fg: C.stQueued, bg: C.stQueuedBg, mark: "o", label: "queued" },
  running: { fg: C.stRunning, bg: C.stRunningBg, mark: "*", label: "running" },
  success: { fg: C.stSuccess, bg: C.stSuccessBg, mark: "v", label: "success" },
};

const canvas = createCanvas(W, H);
const ctx = canvas.getContext("2d");

function drawFrame(runIdx, taskPhase, holding) {
  const run = result.runs[runIdx];
  const snap = result.series[runIdx];
  const runsDone = holding ? RUNS : runIdx;

  ctx.fillStyle = C.bg;
  ctx.fillRect(0, 0, W, H);

  /* header */
  text(ctx, "dag_id=x_data_pipeline   schedule=@daily   catchup=False", 32, 38, {
    font: "13px Mono",
    fill: C.faint,
  });
  const runDate = new Date(sim.DEFAULT_PARAMS.startMs + (runIdx + 1) * sim.DAY_MS)
    .toISOString()
    .slice(0, 10);
  text(ctx, `run ${runDate}`, W - 32, 38, {
    font: "13px Mono",
    fill: C.muted,
    align: "right",
  });

  /* the three tasks */
  const boxW = 176;
  const gap = 74;
  const top = 58;
  const boxH = 54;
  let x = 32;
  for (let i = 0; i < TASKS.length; i += 1) {
    const state = holding
      ? "success"
      : i < taskPhase
        ? "success"
        : i === taskPhase
          ? "running"
          : "queued";
    const s = STATES[state];

    panel(ctx, x, top, boxW, boxH, { fill: s.bg, stroke: C.hairline });
    text(ctx, TASKS[i], x + 14, top + 23, { font: "14px Mono", fill: C.ink });
    text(ctx, `${s.mark}  ${s.label}`, x + 14, top + 42, { font: "12px Mono", fill: s.fg });

    if (i < 2) {
      const ax = x + boxW;
      const ay = top + boxH / 2;
      ctx.strokeStyle = C.hairlineStrong;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(ax + 8, ay);
      ctx.lineTo(ax + gap - 16, ay);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(ax + gap - 16, ay - 4);
      ctx.lineTo(ax + gap - 8, ay);
      ctx.lineTo(ax + gap - 16, ay + 4);
      ctx.closePath();
      ctx.fillStyle = C.hairlineStrong;
      ctx.fill();

      // The real XCom payload size for this run.
      const bytes = i === 0 ? run.xcomExtractBytes : run.xcomTransformBytes;
      const moving = holding || taskPhase > i;
      text(ctx, `${(bytes / 1024).toFixed(1)}kB`, ax + gap / 2 - 4, ay - 10, {
        font: "11px Mono",
        fill: moving ? C.muted : C.faint,
        align: "center",
      });
      text(ctx, "XCom", ax + gap / 2 - 4, ay + 20, {
        font: "10px Mono",
        fill: C.faint,
        align: "center",
      });
      if (moving) {
        ctx.beginPath();
        ctx.arc(ax + gap - 22, ay, 3.5, 0, Math.PI * 2);
        ctx.fillStyle = C.accent;
        ctx.fill();
      }
    }
    x += boxW + gap;
  }

  /* run tally */
  const tallyY = top + boxH + 14;
  text(ctx, `runs ${runsDone}`, 32, tallyY + 26, { font: "12px Mono", fill: C.muted });
  text(ctx, `succeeded ${runsDone}`, 132, tallyY + 26, {
    font: "12px MonoBold",
    fill: C.stSuccess,
  });
  text(ctx, "failed 0", 288, tallyY + 26, { font: "12px Mono", fill: C.muted });

  /* the divergence */
  const chartX = 74;
  const chartY = 190;
  const chartW = W - chartX - 40;
  const chartH = 176;

  text(ctx, "rows in the lake against distinct posts", 32, chartY - 14, {
    font: "13px SansBold",
    fill: C.ink,
  });

  drawDivergence(ctx, {
    x: chartX,
    y: chartY,
    w: chartW,
    h: chartH,
    max: MAX,
    upTo: holding ? RUNS - 1 : runIdx,
    series: [
      { name: "rows in the lake", points: rows, color: C.series1 },
      { name: "distinct posts", points: distinct, color: C.series2 },
    ],
  });

  ctx.strokeStyle = C.hairlineStrong;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(chartX, chartY + chartH + 0.5);
  ctx.lineTo(chartX + chartW, chartY + chartH + 0.5);
  ctx.stroke();
  text(ctx, "day 1", chartX, chartY + chartH + 18, { font: "11px Mono", fill: C.faint });
  text(ctx, `day ${RUNS}`, chartX + chartW, chartY + chartH + 18, {
    font: "11px Mono",
    fill: C.faint,
    align: "right",
  });

  /* the counters */
  const statY = 412;
  const stats = [
    ["rows in the lake", commas(snap.rowsInLake), C.series1],
    ["distinct posts", commas(snap.distinctPosts), C.series2],
    [
      "duplication",
      `${(snap.rowsInLake / Math.max(snap.distinctPosts, 1)).toFixed(2)}x`,
      C.ink,
    ],
    ["objects", commas(snap.objects), C.ink],
  ];
  let sx = 32;
  for (const [label, value, colour] of stats) {
    text(ctx, label, sx, statY, { font: "11px Sans", fill: C.faint });
    text(ctx, value, sx, statY + 24, { font: "21px MonoBold", fill: colour });
    sx += 172;
  }

  /* the contradiction, only at the end */
  if (holding) {
    const bandY = H - 34;
    roundRect(ctx, 24, bandY - 30, W - 48, 44, 8);
    ctx.fillStyle = C.stRetryBg;
    ctx.fill();
    ctx.strokeStyle = "#e3c391";
    ctx.lineWidth = 1;
    ctx.stroke();
    const factor = (snap.rowsInLake / snap.distinctPosts).toFixed(1);
    text(
      ctx,
      `${RUNS} runs. ${RUNS} successes. Nothing to alert on. Every post is in the lake ${factor} times.`,
      W / 2,
      bandY - 2,
      { font: "15px SansBold", fill: C.ink, align: "center" },
    );
  }
}

/* ------------------------------------------------------------ look at it */

/*
  Code review does not catch layout. With XDP_FRAMES=<dir> this writes
  representative frames as PNG from the same drawing code, so they can be opened
  and checked for collisions and overflow before the GIF is trusted.
*/
if (process.env.XDP_FRAMES) {
  const dir = process.env.XDP_FRAMES;
  fs.mkdirSync(dir, { recursive: true });
  const targets = [
    ["start", 0, 0, false],
    ["mid-transform", 6, 1, false],
    ["mid-load", 16, 2, false],
    ["final", RUNS - 1, 2, true],
  ];
  for (const [name, run, phase, holding] of targets) {
    drawFrame(run, phase, holding);
    fs.writeFileSync(path.join(dir, `${name}.png`), canvas.toBuffer("image/png"));
    console.log("wrote", name);
  }
  process.exit(0);
}

/* ------------------------------------------------------------------ encode */

const gif = GIFEncoder();
let frames = 0;

// A single global palette, built from the first and last frames so both the
// running state and the contradiction band are represented in it.
function paletteFrom(frameList) {
  const merged = new Uint8ClampedArray(frameList.length * W * H * 4);
  frameList.forEach((data, i) => merged.set(data, i * W * H * 4));
  return quantize(merged, 64, { format: "rgb565" });
}

drawFrame(0, 0, false);
const first = ctx.getImageData(0, 0, W, H).data;
drawFrame(RUNS - 1, 2, true);
const last = ctx.getImageData(0, 0, W, H).data;
const palette = paletteFrom([first, last]);

for (let run = 0; run < RUNS; run += 1) {
  for (let phase = 0; phase < 3; phase += 1) {
    drawFrame(run, phase, false);
    const { data } = ctx.getImageData(0, 0, W, H);
    gif.writeFrame(applyPalette(data, palette, "rgb565"), W, H, {
      palette: frames === 0 ? palette : undefined,
      delay: DELAY,
      transparent: false,
    });
    frames += 1;
  }
}

drawFrame(RUNS - 1, 2, true);
const holdData = ctx.getImageData(0, 0, W, H).data;
const holdIndexed = applyPalette(holdData, palette, "rgb565");
for (let i = 0; i < HOLD_FRAMES; i += 1) {
  gif.writeFrame(holdIndexed, W, H, { delay: DELAY, transparent: false });
  frames += 1;
}

gif.finish();

fs.mkdirSync(outDir, { recursive: true });
const out = path.join(outDir, "hero.gif");
fs.writeFileSync(out, gif.bytes());

const kb = (fs.statSync(out).size / 1024).toFixed(0);
console.log(
  `hero.gif  ${W}x${H}  ${frames} frames  ${(frames / FPS).toFixed(1)}s  ${kb} kB`,
);
console.log(
  `  final: ${commas(rows[RUNS - 1])} rows, ${commas(distinct[RUNS - 1])} distinct, ` +
    `${(rows[RUNS - 1] / distinct[RUNS - 1]).toFixed(2)}x`,
);
