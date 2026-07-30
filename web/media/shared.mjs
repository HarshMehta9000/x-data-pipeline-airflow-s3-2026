/*
  Shared drawing for the generated media.

  No browser and no ffmpeg on this machine, so everything is drawn with
  @napi-rs/canvas and encoded with gifenc. Fonts are registered by absolute
  path, because nothing here can rely on a system font stack resolving.

  Every figure drawn comes from the same simulation the page runs, required out
  of tmp/lib. Nothing is typed in.
*/
import { GlobalFonts } from "@napi-rs/canvas";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
export const webRoot = path.resolve(here, "..");
export const outDir = path.join(webRoot, "public");

/* ------------------------------------------------------------------- fonts */

const FONTS = [
  ["/usr/share/fonts/cantarell/Cantarell-Regular.otf", "Sans"],
  ["/usr/share/fonts/cantarell/Cantarell-Bold.otf", "SansBold"],
  ["/usr/share/fonts/adobe-source-code-pro/SourceCodePro-Regular.otf", "Mono"],
  ["/usr/share/fonts/adobe-source-code-pro/SourceCodePro-Semibold.otf", "MonoBold"],
];

export function registerFonts() {
  for (const [file, name] of FONTS) {
    if (!fs.existsSync(file)) throw new Error(`font missing: ${file}`);
    if (!GlobalFonts.registerFromPath(file, name)) {
      throw new Error(`font failed to register: ${file}`);
    }
  }
}

/* ------------------------------------------------------------------ colours */

// The light theme tokens from app/globals.css, which is the primary mode.
export const C = {
  bg: "#fbfbfd",
  surface: "#ffffff",
  surface2: "#f4f5f8",
  ink: "#14161c",
  muted: "#5c6270",
  faint: "#878d9b",
  hairline: "#e3e4e9",
  hairlineStrong: "#d2d4db",
  accent: "#4338ca",
  accentSoft: "#eef0ff",
  series1: "#4338ca",
  series2: "#db2777",
  stQueued: "#64748b",
  stQueuedBg: "#eef2f6",
  stRunning: "#0e7490",
  stRunningBg: "#e0f2fe",
  stSuccess: "#15803d",
  stSuccessBg: "#e7f6ec",
  stRetry: "#b45309",
  stRetryBg: "#fdf0dd",
};

/* ------------------------------------------------------- simulation, shared */

export function loadSim() {
  const require = createRequire(import.meta.url);
  const libPath = path.join(webRoot, "tmp", "lib", "lib", "sim.js");
  if (!fs.existsSync(libPath)) {
    throw new Error(
      "tmp/lib is missing. Run `npm run gate` once first so the TypeScript is compiled.",
    );
  }
  return require(libPath);
}

/* --------------------------------------------------------------- primitives */

export function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + w - rr, y);
  ctx.arcTo(x + w, y, x + w, y + rr, rr);
  ctx.lineTo(x + w, y + h - rr);
  ctx.arcTo(x + w, y + h, x + w - rr, y + h, rr);
  ctx.lineTo(x + rr, y + h);
  ctx.arcTo(x, y + h, x, y + h - rr, rr);
  ctx.lineTo(x, y + rr);
  ctx.arcTo(x, y, x + rr, y, rr);
  ctx.closePath();
}

export function panel(ctx, x, y, w, h, { fill = C.surface, stroke = C.hairline } = {}) {
  roundRect(ctx, x, y, w, h, 10);
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.strokeStyle = stroke;
  ctx.lineWidth = 1;
  ctx.stroke();
}

export function text(ctx, str, x, y, { font = "16px Sans", fill = C.ink, align = "left" } = {}) {
  ctx.font = font;
  ctx.fillStyle = fill;
  ctx.textAlign = align;
  ctx.textBaseline = "alphabetic";
  ctx.fillText(str, x, y);
}

/**
 * Axis labels that do not lie. Math.round(1.5) is 2, which turned a 1,500 row
 * gridline into one labelled 2k on the first render of the hero GIF.
 */
export function axisLabel(v) {
  if (v === 0) return "0";
  if (v < 1000) return String(Math.round(v));
  const k = v / 1000;
  return `${Number.isInteger(k) ? k : k.toFixed(1)}k`;
}

export function commas(n) {
  return Math.round(n).toLocaleString("en-US");
}

/**
 * The diverging pair, drawn progressively up to `upTo` points.
 * Two series only, in the validated categorical slots, with direct labels.
 */
export function drawDivergence(ctx, { x, y, w, h, series, upTo, max }) {
  ctx.save();

  // Recessive grid, three lines only.
  ctx.strokeStyle = C.hairline;
  ctx.lineWidth = 1;
  for (const t of [0, 0.5, 1]) {
    const gy = Math.round(y + h - t * h) + 0.5;
    ctx.beginPath();
    ctx.moveTo(x, gy);
    ctx.lineTo(x + w, gy);
    ctx.stroke();
    text(ctx, axisLabel(max * t), x - 8, gy + 4, {
      font: "11px Mono",
      fill: C.faint,
      align: "right",
    });
  }

  const n = series[0].points.length;
  const px = (i) => x + (n <= 1 ? 0 : (i / (n - 1)) * w);
  const py = (v) => y + h - (v / max) * h;

  for (const s of series) {
    ctx.strokeStyle = s.color;
    ctx.lineWidth = 2.5;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.beginPath();
    for (let i = 0; i <= upTo && i < n; i += 1) {
      const vx = px(i);
      const vy = py(s.points[i]);
      if (i === 0) ctx.moveTo(vx, vy);
      else ctx.lineTo(vx, vy);
    }
    ctx.stroke();

    if (upTo > 0) {
      const i = Math.min(upTo, n - 1);
      const vx = px(i);
      const vy = py(s.points[i]);
      // A 2px surface ring, so overlapping heads stay separable.
      ctx.beginPath();
      ctx.arc(vx, vy, 5, 0, Math.PI * 2);
      ctx.fillStyle = s.color;
      ctx.fill();
      ctx.strokeStyle = C.surface;
      ctx.lineWidth = 2;
      ctx.stroke();

      text(ctx, s.name, vx - 10, vy - 12, {
        font: "12px SansBold",
        fill: s.color,
        align: "right",
      });
    }
  }

  ctx.restore();
}
