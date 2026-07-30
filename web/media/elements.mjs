/*
  One GIF per element, so the README shows what the page does rather than
  asserting it.

  Usage: node media/elements.mjs <sentiment|retries|partitions|levers>
  One target per process, because this machine has 1.9GB and no swap.

  Every number drawn comes from the same ported logic the page runs: the VADER
  port and the fallback scorer for the sentiment card, the scheduler simulation
  for the rest. With XDP_FRAMES=<dir> each target writes its key frames as PNG
  instead of encoding, so they can be looked at before being trusted.
*/
import { createCanvas } from "@napi-rs/canvas";
import gifenc from "gifenc";
const { GIFEncoder, quantize, applyPalette } = gifenc;
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import {
  C,
  axisLabel,
  commas,
  loadSim,
  outDir,
  panel,
  registerFonts,
  roundRect,
  text,
  webRoot,
} from "./shared.mjs";

const W = 760;
const HEIGHTS = { sentiment: 322, retries: 420, partitions: 410, levers: 400 };
const FPS = 10;
const DELAY = Math.round(1000 / FPS);

const target = process.argv[2];
if (!target) throw new Error("usage: node media/elements.mjs <target>");
const H = HEIGHTS[target];
if (!H) throw new Error(`unknown target ${target}, want one of ${Object.keys(HEIGHTS)}`);

registerFonts();
const sim = loadSim();
const require = createRequire(import.meta.url);

const canvas = createCanvas(W, H);
const ctx = canvas.getContext("2d");

function clear() {
  ctx.fillStyle = C.bg;
  ctx.fillRect(0, 0, W, H);
}

function header(title, right) {
  text(ctx, title, 28, 34, { font: "15px SansBold", fill: C.ink });
  if (right) {
    text(ctx, right, W - 28, 34, { font: "12px Mono", fill: C.faint, align: "right" });
  }
}

/** A label above a value, the page's stat pattern. */
function stat(x, y, label, value, colour = C.ink, size = 26) {
  text(ctx, label, x, y, { font: "11px Sans", fill: C.faint });
  text(ctx, value, x, y + size + 4, { font: `${size}px MonoBold`, fill: colour });
}

/* ===================================================== element 2, sentiment */

function buildSentiment() {
  const pipeline = require(path.join(webRoot, "tmp", "lib", "lib", "pipeline.js"));
  const { Vader } = require(path.join(webRoot, "tmp", "lib", "lib", "vader.js"));
  const vader = new Vader(require(path.join(webRoot, "data", "vader-lexicon.json")));

  const TEXTS = [
    "The launch was delayed again. This is a problem and pretty disappointing.",
    "Not a great result and honestly not the best week.",
    "The rollout is going well, but the outage was terrible.",
    "Some servers went down. Working on a fix now.",
  ];

  const cards = TEXTS.map((t) => {
    const trace = pipeline.fallbackSentimentTrace(t);
    const fScore = pipeline.pyRound4(trace.score);
    const vScore = pipeline.pyRound4(vader.polarityScores(t).compound);
    return {
      text: t,
      trace,
      fScore,
      fLabel: pipeline.labelFor(fScore),
      vScore,
      vLabel: pipeline.labelFor(vScore),
      disagree: pipeline.labelFor(fScore) !== pipeline.labelFor(vScore),
    };
  });

  function draw(i, reveal) {
    const c = cards[i];
    clear();
    header("Two scorers, one column", "transform._make_scorer");

    // the post text, wrapped
    ctx.font = "14px Sans";
    const words = c.text.split(" ");
    let line = "";
    let ty = 66;
    for (const w of words) {
      if (ctx.measureText(`${line}${w} `).width > W - 56) {
        text(ctx, line.trim(), 28, ty, { font: "14px Sans", fill: C.muted });
        line = "";
        ty += 20;
      }
      line += `${w} `;
    }
    text(ctx, line.trim(), 28, ty, { font: "14px Sans", fill: C.muted });

    const cardY = ty + 24;
    const cardH = 150;
    const cw = (W - 56 - 16) / 2;

    // fallback
    panel(ctx, 28, cardY, cw, cardH);
    text(ctx, "28 word fallback", 44, cardY + 24, { font: "13px SansBold", fill: C.ink });
    text(ctx, "no dependency", cw + 12, cardY + 24, {
      font: "10px Mono",
      fill: C.faint,
      align: "right",
    });

    // tokens, revealed left to right so the viewer sees the matching happen
    let tx = 44;
    let tline = cardY + 50;
    const shown = Math.ceil((reveal / 10) * c.trace.tokens.length);
    ctx.font = "11px Mono";
    for (let k = 0; k < Math.min(shown, c.trace.tokens.length); k += 1) {
      const tok = c.trace.tokens[k];
      const label = tok.token || tok.raw;
      const wpx = ctx.measureText(label).width + 8;
      if (tx + wpx > 28 + cw - 12) {
        tx = 44;
        tline += 17;
      }
      if (tok.hit) {
        roundRect(ctx, tx - 3, tline - 11, wpx, 15, 3);
        ctx.fillStyle = tok.hit === "positive" ? C.stSuccessBg : "#fdeaea";
        ctx.fill();
      }
      text(ctx, label, tx, tline, {
        font: "11px Mono",
        fill: tok.hit === "positive" ? C.stSuccess : tok.hit === "negative" ? "#b91c1c" : C.faint,
      });
      tx += wpx;
    }

    if (reveal >= 10) {
      stat(44, cardY + cardH - 46, "sentiment_score", c.fScore.toFixed(4), C.ink, 22);
      text(ctx, c.fLabel, 28 + cw - 16, cardY + cardH - 20, {
        font: "12px Mono",
        fill: c.fLabel === "negative" ? "#b91c1c" : c.fLabel === "positive" ? C.stSuccess : C.muted,
        align: "right",
      });
    }

    // vader
    const vx = 28 + cw + 16;
    panel(ctx, vx, cardY, cw, cardH);
    text(ctx, "VADER", vx + 16, cardY + 24, { font: "13px SansBold", fill: C.ink });
    text(ctx, `${commas(vader.lexiconSize)} entries`, vx + cw - 16, cardY + 24, {
      font: "10px Mono",
      fill: C.faint,
      align: "right",
    });

    if (reveal >= 6) {
      const sc = vader.polarityScores(c.text);
      const barY = cardY + 44;
      let bx = vx + 16;
      const bw = cw - 32;
      for (const [v, colour] of [
        [sc.pos, C.stSuccess],
        [sc.neu, "#94a3b8"],
        [sc.neg, "#b91c1c"],
      ]) {
        if (v <= 0) continue;
        ctx.fillStyle = colour;
        ctx.fillRect(bx, barY, bw * v, 14);
        bx += bw * v + 2;
      }
      text(ctx, `pos ${sc.pos}   neu ${sc.neu}   neg ${sc.neg}`, vx + 16, barY + 32, {
        font: "11px Mono",
        fill: C.faint,
      });
    }
    if (reveal >= 10) {
      stat(vx + 16, cardY + cardH - 46, "sentiment_score", c.vScore.toFixed(4), C.ink, 22);
      text(ctx, c.vLabel, vx + cw - 16, cardY + cardH - 20, {
        font: "12px Mono",
        fill: c.vLabel === "negative" ? "#b91c1c" : c.vLabel === "positive" ? C.stSuccess : C.muted,
        align: "right",
      });
    }

    // the verdict
    if (reveal >= 10) {
      const bandY = cardY + cardH + 14;
      roundRect(ctx, 28, bandY, W - 56, 40, 8);
      ctx.fillStyle = c.disagree ? C.stRetryBg : C.surface2;
      ctx.fill();
      ctx.strokeStyle = c.disagree ? "#e3c391" : C.hairline;
      ctx.lineWidth = 1;
      ctx.stroke();
      const delta = Math.abs(c.vScore - c.fScore).toFixed(4);
      text(
        ctx,
        c.disagree
          ? `${delta} apart, and they disagree on the label: ${c.fLabel} against ${c.vLabel}`
          : `${delta} apart on the same text, same label this time`,
        W / 2,
        bandY + 25,
        { font: "13px SansBold", fill: C.ink, align: "center" },
      );
    }
  }

  const frames = [];
  for (let i = 0; i < cards.length; i += 1) {
    for (let r = 0; r <= 10; r += 1) frames.push([i, r]);
    for (let h = 0; h < 8; h += 1) frames.push([i, 10]);
  }
  return { draw: ([i, r]) => draw(i, r), frames, key: [[0, 10], [2, 10]] };
}

/* ======================================================= element 3, retries */

function buildRetries() {
  const RUNS = 12;
  const STEPS = [0, 0.1, 0.25, 0.45];
  const stream = sim.makePostStream(sim.DEFAULT_PARAMS.startMs, RUNS + 8, 12, 7);
  const runsFor = STEPS.map((p) =>
    sim.simulate(
      { ...sim.DEFAULT_PARAMS, days: RUNS, failureProb: p, retries: 2, retryDelayMin: 2, seed: 11 },
      stream,
    ),
  );

  const COLOUR = { success: C.stSuccess, failed: "#b91c1c", up_for_retry: C.stRetry };

  function draw(stepIdx, upTo) {
    const r = runsFor[stepIdx];
    const T = r.totals;
    const maxMin = Math.max(...r.runs.map((x) => x.durationMin), 1);
    clear();
    header("What a retry costs", `retries=2  retry_delay=2min`);

    text(ctx, "task failure probability", 28, 60, { font: "11px Sans", fill: C.faint });
    text(ctx, `${Math.round(STEPS[stepIdx] * 100)}%`, 190, 60, {
      font: "13px MonoBold",
      fill: C.accent,
    });

    // slider track showing where we are
    ctx.fillStyle = C.surface2;
    ctx.fillRect(240, 54, 200, 5);
    ctx.fillStyle = C.accent;
    ctx.fillRect(240, 54, 200 * (STEPS[stepIdx] / 0.6), 5);

    const top = 80;
    const rowH = 15;
    for (let i = 0; i < Math.min(upTo, RUNS); i += 1) {
      const run = r.runs[i];
      const y = top + i * rowH;
      text(ctx, `run ${i + 1}`, 28, y + 11, { font: "10px Mono", fill: C.faint });
      const barX = 84;
      const barW = W - barX - 96;
      ctx.fillStyle = C.surface2;
      roundRect(ctx, barX, y + 1, barW, 12, 3);
      ctx.fill();
      for (const t of run.tasks) {
        const bx = barX + (t.startMin / maxMin) * barW;
        const bw = Math.max((t.durationMin / maxMin) * barW, 3);
        ctx.fillStyle = COLOUR[t.state];
        roundRect(ctx, bx, y + 2, bw, 10, 2);
        ctx.fill();
      }
      text(ctx, run.state === "success" ? "success" : "failed", W - 28, y + 11, {
        font: "10px Mono",
        fill: run.state === "success" ? C.stSuccess : "#b91c1c",
        align: "right",
      });
    }

    const sy = top + RUNS * rowH + 22;
    stat(28, sy, "runs succeeded", `${T.successfulRuns}/${T.runs}`, C.stSuccess, 22);
    stat(196, sy, "retries fired", commas(T.retries), C.stRetry, 22);
    stat(364, sy, "rows in the lake", commas(T.rowsInLake), C.series1, 22);
    stat(556, sy, "distinct posts", commas(T.distinctPosts), C.series2, 22);

    const bandY = sy + 56;
    roundRect(ctx, 28, bandY, W - 56, 34, 8);
    ctx.fillStyle = STEPS[stepIdx] > 0 ? C.stRetryBg : C.surface2;
    ctx.fill();
    ctx.strokeStyle = STEPS[stepIdx] > 0 ? "#e3c391" : C.hairline;
    ctx.stroke();
    /*
      Derived from the run states, not from the slider. At a high enough failure
      probability runs really do fail, and an earlier version of this frame said
      "every run still reports success" beside a column showing five failures.
    */
    const extra = T.rowsInLake - runsFor[0].totals.rowsInLake;
    const allGreen = T.successfulRuns === T.runs;
    text(
      ctx,
      allGreen && STEPS[stepIdx] > 0
        ? `Every run still reports success, and the retries added ${commas(extra)} rows nobody asked for.`
        : allGreen
          ? "No failures yet. Every run green, and most posts are already in the lake six times."
          : `${T.runs - T.successfulRuns} runs failed. The ${T.successfulRuns} that succeeded still added ${commas(extra)} duplicate rows, silently.`,
      W / 2,
      bandY + 22,
      { font: "12px SansBold", fill: C.ink, align: "center" },
    );
  }

  const frames = [];
  for (let s = 0; s < STEPS.length; s += 1) {
    for (let u = 1; u <= RUNS; u += 1) frames.push([s, u]);
    for (let h = 0; h < 8; h += 1) frames.push([s, RUNS]);
  }
  return { draw: ([s, u]) => draw(s, u), frames, key: [[0, 12], [3, 12]] };
}

/* ==================================================== element 4, partitions */

function buildPartitions() {
  const HISTORY = 90;
  const stream = sim.makePostStream(sim.DEFAULT_PARAMS.startMs, HISTORY, 12, 7);
  const readability = require(path.join(webRoot, "data", "readability.json"));

  const daily = {
    run: sim.simulate({ ...sim.DEFAULT_PARAMS, days: HISTORY, levers: sim.NO_LEVERS }, stream),
    event: sim.simulate({ ...sim.DEFAULT_PARAMS, days: HISTORY, levers: sim.ALL_LEVERS }, stream),
  };
  const bf = {
    ...sim.DEFAULT_PARAMS,
    days: 1,
    lookbackDays: HISTORY + 1,
    firstRunOffsetDays: HISTORY + 1,
  };
  const backfill = {
    run: sim.simulate({ ...bf, levers: sim.NO_LEVERS }, stream),
    event: sim.simulate({ ...bf, levers: sim.ALL_LEVERS }, stream),
  };

  const arrow = readability.probes.find((p) => p.reader === "pyarrow.dataset hive");

  function histogram(x, y, w, h, bars, colour, max, label) {
    text(ctx, label, x, y - 8, { font: "11px Sans", fill: C.muted });
    text(ctx, `${bars.length} partition${bars.length === 1 ? "" : "s"}`, x + w, y - 8, {
      font: "10px Mono",
      fill: C.faint,
      align: "right",
    });
    ctx.strokeStyle = C.hairline;
    ctx.beginPath();
    ctx.moveTo(x, y + h + 0.5);
    ctx.lineTo(x + w, y + h + 0.5);
    ctx.stroke();
    const bw = Math.max(w / Math.max(bars.length, 1) - 2, 2);
    bars.forEach((b, i) => {
      const bh = Math.max((b.rows / max) * h, 2);
      ctx.fillStyle = colour;
      roundRect(ctx, x + i * (bw + 2), y + h - bh, bw, bh, 3);
      ctx.fill();
    });
    text(ctx, `largest ${commas(Math.max(0, ...bars.map((b) => b.rows)))} rows`, x, y + h + 16, {
      font: "10px Mono",
      fill: C.faint,
    });
  }

  function draw(mode, phase) {
    const d = mode === 0 ? daily : backfill;
    const max = Math.max(
      ...d.run.partitions.map((p) => p.rows),
      ...d.event.partitions.map((p) => p.rows),
      1,
    );
    clear();
    header(
      "Where the data actually lands",
      mode === 0 ? "90 daily runs" : "one backfill of 90 days",
    );

    const cw = (W - 56 - 20) / 2;
    histogram(28, 82, cw, 120, d.run.partitions, C.series1, max, "keyed on the run date, as written");
    histogram(28 + cw + 20, 82, cw, 120, d.event.partitions, C.series2, max, "keyed on the post's own date");

    const bandY = 232;
    roundRect(ctx, 28, bandY, W - 56, 46, 8);
    ctx.fillStyle = mode === 1 ? C.stRetryBg : C.surface2;
    ctx.fill();
    ctx.strokeStyle = mode === 1 ? "#e3c391" : C.hairline;
    ctx.stroke();
    text(
      ctx,
      mode === 0
        ? `Both make ${d.run.partitions.length} partitions, so nothing looks wrong day to day.`
        : `The whole archive lands in ${d.run.partitions.length} partition of ${commas(
            Math.max(...d.run.partitions.map((p) => p.rows)),
          )} rows, against ${d.event.partitions.length}.`,
      W / 2,
      bandY + 19,
      { font: "12px SansBold", fill: C.ink, align: "center" },
    );
    text(
      ctx,
      mode === 0
        ? "The difference is what is inside them: seven days of posts filed under one run date."
        : "catchup=False is the only thing hiding this.",
      W / 2,
      bandY + 36,
      { font: "11px Sans", fill: C.muted, align: "center" },
    );

    // the collision, revealed after the backfill lands
    if (phase >= 8) {
      const cy = 296;
      roundRect(ctx, 28, cy, W - 56, 96, 8);
      ctx.fillStyle = C.surface;
      ctx.fill();
      ctx.strokeStyle = C.hairlineStrong;
      ctx.stroke();
      text(ctx, "And there are two fields named day", 44, cy + 24, {
        font: "13px SansBold",
        fill: C.ink,
      });
      text(
        ctx,
        "transform writes a string column day. load writes a directory day=. Hive discovery collides them:",
        44,
        cy + 44,
        { font: "11px Sans", fill: C.muted },
      );
      text(ctx, `pyarrow: ${arrow.error.slice(0, 66)}`, 44, cy + 64, {
        font: "11px Mono",
        fill: "#b91c1c",
      });
      text(ctx, "duckdb: opens, and day is silently the run's day of month", 44, cy + 82, {
        font: "11px Mono",
        fill: C.stRetry,
      });
    }
  }

  const frames = [];
  for (let m = 0; m < 2; m += 1) {
    for (let p = 0; p < 16; p += 1) frames.push([m, m === 1 ? p : 0]);
  }
  return { draw: ([m, p]) => draw(m, p), frames, key: [[0, 0], [1, 12]] };
}

/* ======================================================== element 5, levers */

function buildLevers() {
  const DAYS = 90;
  const stream = sim.makePostStream(sim.DEFAULT_PARAMS.startMs, DAYS, 12, 7);
  const LEVERS = [
    { eventDatePartition: false, deterministicKey: false, watermark: false },
    { eventDatePartition: true, deterministicKey: false, watermark: false },
    { eventDatePartition: true, deterministicKey: true, watermark: false },
    { eventDatePartition: true, deterministicKey: true, watermark: true },
  ];
  const NAMES = [
    "partition on the event date",
    "make load idempotent",
    "add a watermark",
  ];
  const results = LEVERS.map((levers) =>
    sim.simulate({ ...sim.DEFAULT_PARAMS, days: DAYS, failureProb: 0.1, levers }, stream),
  );
  const MAX = Math.ceil(Math.max(...results[0].series.map((s) => s.rowsInLake)) / 1000) * 1000;

  function draw(stage, t) {
    const r = results[stage];
    const T = r.totals;
    clear();
    header("The lake after ninety days", "task failure probability 10%");

    // the three switches
    let x = 28;
    for (let i = 0; i < 3; i += 1) {
      const on = Object.values(LEVERS[stage])[i];
      const bw = (W - 56 - 24) / 3;
      panel(ctx, x, 54, bw, 46, {
        fill: on ? "#eef0ff" : C.surface,
        stroke: on ? C.accent : C.hairline,
      });
      // switch
      const sx = x + bw - 40;
      roundRect(ctx, sx, 70, 28, 15, 8);
      ctx.fillStyle = on ? C.accent : "#dfe1e7";
      ctx.fill();
      ctx.beginPath();
      ctx.arc(on ? sx + 20 : sx + 8, 77.5, 5.5, 0, Math.PI * 2);
      ctx.fillStyle = "#ffffff";
      ctx.fill();
      text(ctx, NAMES[i], x + 14, 82, {
        font: "11px SansBold",
        fill: on ? C.accent : C.muted,
      });
      x += bw + 12;
    }

    // the two lines
    const cx = 74;
    const cy = 124;
    const cw = W - cx - 34;
    const ch = 132;
    ctx.strokeStyle = C.hairline;
    for (const g of [0, 0.5, 1]) {
      const gy = Math.round(cy + ch - g * ch) + 0.5;
      ctx.beginPath();
      ctx.moveTo(cx, gy);
      ctx.lineTo(cx + cw, gy);
      ctx.stroke();
      text(ctx, axisLabel(MAX * g), cx - 8, gy + 4, {
        font: "10px Mono",
        fill: C.faint,
        align: "right",
      });
    }
    /*
      With all three levers on the two series are identical, so their end labels
      land on the same pixel and overprint. Offset them when the endpoints are
      within a few pixels of each other.
    */
    const ends = [
      r.series[r.series.length - 1].rowsInLake,
      r.series[r.series.length - 1].distinctPosts,
    ];
    const coincide = Math.abs(((ends[0] - ends[1]) / MAX) * ch) < 14;
    let labelSlot = 0;
    for (const [pts, colour, name] of [
      [r.series.map((s) => s.rowsInLake), C.series1, "rows in the lake"],
      [r.series.map((s) => s.distinctPosts), C.series2, "distinct posts"],
    ]) {
      ctx.strokeStyle = colour;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      pts.forEach((v, i) => {
        const px = cx + (i / (pts.length - 1)) * cw;
        const py = cy + ch - (v / MAX) * ch;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      });
      ctx.stroke();
      const last = pts[pts.length - 1];
      const baseY = cy + ch - (last / MAX) * ch;
      const dy = coincide ? (labelSlot === 0 ? -12 : 16) : -10;
      labelSlot += 1;
      text(ctx, name, cx + cw - 6, baseY + dy, {
        font: "11px SansBold",
        fill: colour,
        align: "right",
      });
    }

    const sy = cy + ch + 34;
    stat(28, sy, "duplication factor", `${T.duplicationFactor.toFixed(2)}x`,
      T.duplicationFactor === 1 ? C.stSuccess : C.accent, 30);
    stat(230, sy, "rows in the lake", commas(T.rowsInLake), C.series1, 22);
    stat(420, sy, "distinct posts", commas(T.distinctPosts), C.series2, 22);
    stat(600, sy, "objects", commas(T.objects), C.ink, 22);

    const bandY = sy + 62;
    const done = T.duplicationFactor === 1;
    roundRect(ctx, 28, bandY, W - 56, 34, 8);
    ctx.fillStyle = done ? C.stSuccessBg : C.surface2;
    ctx.fill();
    ctx.strokeStyle = done ? "#9fd3b0" : C.hairline;
    ctx.stroke();
    text(
      ctx,
      done
        ? "All three on: exactly one copy of every post, in the partition matching its own timestamp."
        : `${3 - Object.values(LEVERS[stage]).filter(Boolean).length} to go. Each one alone is not enough.`,
      W / 2,
      bandY + 22,
      { font: "12px SansBold", fill: C.ink, align: "center" },
    );
  }

  const frames = [];
  for (let s = 0; s < 4; s += 1) for (let h = 0; h < 14; h += 1) frames.push([s, h]);
  return { draw: ([s, t]) => draw(s, t), frames, key: [[0, 0], [3, 0]] };
}

/* ==================================================================== drive */

const BUILDERS = {
  sentiment: buildSentiment,
  retries: buildRetries,
  partitions: buildPartitions,
  levers: buildLevers,
};

const builder = BUILDERS[target];
if (!builder) throw new Error(`unknown target ${target}, want one of ${Object.keys(BUILDERS)}`);

const { draw, frames, key } = builder();

if (process.env.XDP_FRAMES) {
  const dir = process.env.XDP_FRAMES;
  fs.mkdirSync(dir, { recursive: true });
  key.forEach((k, i) => {
    draw(k);
    fs.writeFileSync(path.join(dir, `${target}-${i}.png`), canvas.toBuffer("image/png"));
    console.log("wrote", `${target}-${i}.png`);
  });
  process.exit(0);
}

// A global palette built from the key frames, so no frame introduces a colour
// the palette cannot represent.
const samples = key.map((k) => {
  draw(k);
  return ctx.getImageData(0, 0, W, H).data;
});
const merged = new Uint8ClampedArray(samples.length * W * H * 4);
samples.forEach((d, i) => merged.set(d, i * W * H * 4));
const palette = quantize(merged, 64, { format: "rgb565" });

const gif = GIFEncoder();
frames.forEach((f, i) => {
  draw(f);
  const { data } = ctx.getImageData(0, 0, W, H);
  gif.writeFrame(applyPalette(data, palette, "rgb565"), W, H, {
    palette: i === 0 ? palette : undefined,
    delay: DELAY,
    transparent: false,
  });
});
gif.finish();

fs.mkdirSync(outDir, { recursive: true });
const out = path.join(outDir, `${target}.gif`);
fs.writeFileSync(out, gif.bytes());
console.log(
  `${target}.gif  ${W}x${H}  ${frames.length} frames  ` +
    `${(frames.length / FPS).toFixed(1)}s  ${(fs.statSync(out).size / 1024).toFixed(0)} kB`,
);
