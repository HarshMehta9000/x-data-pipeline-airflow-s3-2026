"use client";

import { useCallback, useId, useMemo, useState } from "react";

/*
  Small SVG chart primitives. Two series maximum, because that is what the
  validated palette carries and every chart on this page compares exactly two
  things. Grid and axes are recessive, marks are 2px, and both charts ship a
  hover layer and a table view so identity is never colour alone.
*/

export interface Series {
  name: string;
  points: number[];
  /** "1" or "2", mapping to the validated categorical slots. */
  slot: "1" | "2";
  dashed?: boolean;
}

const PAD = { top: 16, right: 16, bottom: 26, left: 52 };

function niceMax(v: number): number {
  if (v <= 0) return 1;
  const mag = 10 ** Math.floor(Math.log10(v));
  const n = v / mag;
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
  return step * mag;
}

export function formatCompact(n: number): string {
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}M`;
  if (Math.abs(n) >= 1_000) return `${(n / 1_000).toFixed(n % 1_000 === 0 ? 0 : 1)}k`;
  return String(Math.round(n));
}

export function LineChart({
  series,
  xLabels,
  height = 220,
  yLabel,
  xLabel,
  annotation,
  formatValue = (v: number) => v.toLocaleString("en-US"),
}: {
  series: Series[];
  xLabels: string[];
  height?: number;
  yLabel?: string;
  xLabel?: string;
  /** One sentence naming what the reader should see, placed on the plot. */
  annotation?: { at: number; text: string };
  formatValue?: (v: number) => string;
}) {
  const id = useId();
  const [hover, setHover] = useState<number | null>(null);
  const [showTable, setShowTable] = useState(false);

  const n = Math.max(...series.map((s) => s.points.length), 1);
  const width = 720;
  const max = niceMax(Math.max(1, ...series.flatMap((s) => s.points)));
  const plotW = width - PAD.left - PAD.right;
  const plotH = height - PAD.top - PAD.bottom;

  const x = useCallback((i: number) => PAD.left + (n <= 1 ? 0 : (i / (n - 1)) * plotW), [n, plotW]);
  const y = useCallback((v: number) => PAD.top + plotH - (v / max) * plotH, [max, plotH]);

  const paths = useMemo(
    () =>
      series.map((s) => ({
        ...s,
        d: s.points.map((v, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(2)},${y(v).toFixed(2)}`).join(" "),
      })),
    [series, x, y],
  );

  const ticks = [0, 0.5, 1].map((t) => max * t);

  const onMove = useCallback(
    (e: React.PointerEvent<SVGSVGElement>) => {
      const rect = e.currentTarget.getBoundingClientRect();
      const px = ((e.clientX - rect.left) / rect.width) * width;
      const i = Math.round(((px - PAD.left) / plotW) * (n - 1));
      setHover(i >= 0 && i < n ? i : null);
    },
    [n, plotW],
  );

  return (
    <div>
      <div className="scroll-x">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="w-full min-w-[520px] touch-pan-y"
          role="img"
          aria-label={`${series.map((s) => s.name).join(" and ")} over ${n} runs`}
          onPointerMove={onMove}
          onPointerLeave={() => setHover(null)}
        >
          {ticks.map((t) => (
            <g key={t}>
              <line
                x1={PAD.left}
                x2={width - PAD.right}
                y1={y(t)}
                y2={y(t)}
                stroke="var(--hairline)"
                strokeWidth="1"
              />
              <text
                x={PAD.left - 8}
                y={y(t) + 4}
                textAnchor="end"
                className="tnum"
                fontSize="11"
                fill="var(--faint)"
              >
                {formatCompact(t)}
              </text>
            </g>
          ))}

          {hover !== null ? (
            <line
              x1={x(hover)}
              x2={x(hover)}
              y1={PAD.top}
              y2={PAD.top + plotH}
              stroke="var(--hairline-strong)"
              strokeWidth="1"
            />
          ) : null}

          {paths.map((s) => (
            <path
              key={s.name}
              d={s.d}
              fill="none"
              stroke={`var(--series-${s.slot})`}
              strokeWidth="2"
              strokeLinejoin="round"
              strokeLinecap="round"
              strokeDasharray={s.dashed ? "5 4" : undefined}
            />
          ))}

          {hover !== null
            ? series.map((s) =>
                s.points[hover] === undefined ? null : (
                  <circle
                    key={s.name}
                    cx={x(hover)}
                    cy={y(s.points[hover] as number)}
                    r="4.5"
                    fill={`var(--series-${s.slot})`}
                    stroke="var(--surface)"
                    strokeWidth="2"
                  />
                ),
              )
            : null}

          {/* Direct labels at the last point, so identity survives without the legend. */}
          {series.map((s) => {
            const last = s.points.length - 1;
            const v = s.points[last];
            if (v === undefined) return null;
            return (
              <text
                key={`${s.name}-label`}
                x={x(last) - 4}
                y={y(v) - 8}
                textAnchor="end"
                fontSize="11"
                fontWeight="600"
                fill="var(--muted)"
              >
                {s.name}
              </text>
            );
          })}

          {annotation ? (
            <text
              x={x(annotation.at)}
              y={PAD.top + 12}
              fontSize="11"
              fill="var(--muted)"
              textAnchor="middle"
            >
              {annotation.text}
            </text>
          ) : null}

          <line
            x1={PAD.left}
            x2={width - PAD.right}
            y1={PAD.top + plotH}
            y2={PAD.top + plotH}
            stroke="var(--hairline-strong)"
            strokeWidth="1"
          />
          {[0, Math.floor((n - 1) / 2), n - 1].map((i) => (
            <text
              key={i}
              x={x(i)}
              y={height - 8}
              textAnchor={i === 0 ? "start" : i === n - 1 ? "end" : "middle"}
              fontSize="11"
              fill="var(--faint)"
              className="tnum"
            >
              {xLabels[i] ?? i + 1}
            </text>
          ))}
        </svg>
      </div>

      <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-4">
          {series.map((s) => (
            <span key={s.name} className="flex items-center gap-2 text-12 text-muted">
              <svg width="16" height="8" aria-hidden="true">
                <line
                  x1="0"
                  y1="4"
                  x2="16"
                  y2="4"
                  stroke={`var(--series-${s.slot})`}
                  strokeWidth="2"
                  strokeDasharray={s.dashed ? "4 3" : undefined}
                />
              </svg>
              {s.name}
              {hover !== null && s.points[hover] !== undefined ? (
                <span className="tnum text-ink">{formatValue(s.points[hover] as number)}</span>
              ) : null}
            </span>
          ))}
          {hover !== null ? (
            <span className="mono text-12 text-faint">{xLabels[hover] ?? ""}</span>
          ) : null}
        </div>
        <button
          type="button"
          onClick={() => setShowTable((v) => !v)}
          className="text-12 text-faint underline decoration-dotted underline-offset-4 hover:text-ink"
          aria-expanded={showTable}
          aria-controls={`${id}-table`}
        >
          {showTable ? "Hide values" : "Show values"}
        </button>
      </div>

      {(yLabel ?? xLabel) ? (
        <p className="mt-1 text-12 text-faint">
          {yLabel ? <span>y: {yLabel}</span> : null}
          {yLabel && xLabel ? " · " : null}
          {xLabel ? <span>x: {xLabel}</span> : null}
        </p>
      ) : null}

      {showTable ? (
        <div id={`${id}-table`} className="scroll-x mt-3 max-h-64 overflow-y-auto">
          <table className="w-full text-12">
            <thead className="sticky top-0 bg-surface text-faint">
              <tr>
                <th className="px-2 py-1 text-left font-medium">{xLabel ?? "x"}</th>
                {series.map((s) => (
                  <th key={s.name} className="px-2 py-1 text-right font-medium">
                    {s.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="mono">
              {Array.from({ length: n }, (_, i) => (
                <tr key={i} className="border-t border-hairline">
                  <td className="px-2 py-1 text-faint">{xLabels[i] ?? i + 1}</td>
                  {series.map((s) => (
                    <td key={s.name} className="px-2 py-1 text-right text-ink">
                      {s.points[i] === undefined ? "" : formatValue(s.points[i] as number)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}

/** Rows per partition, one bar per partition, two configurations side by side. */
export function PartitionHistogram({
  bars,
  slot,
  max,
  label,
  emptyNote,
}: {
  bars: { partition: string; rows: number }[];
  slot: "1" | "2";
  max: number;
  label: string;
  emptyNote?: string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const top = Math.max(max, 1);

  return (
    <div>
      <p className="mb-2 flex items-baseline justify-between gap-2 text-12">
        <span className="text-muted">{label}</span>
        <span className="tnum text-faint">
          {bars.length} partition{bars.length === 1 ? "" : "s"}
        </span>
      </p>
      <div
        className="flex h-32 items-end gap-[2px]"
        onPointerLeave={() => setHover(null)}
        role="img"
        aria-label={`${label}: ${bars.length} partitions, largest holds ${Math.max(0, ...bars.map((b) => b.rows))} rows`}
      >
        {bars.length === 0 ? (
          <p className="text-12 text-faint">{emptyNote ?? "nothing written"}</p>
        ) : (
          bars.map((b, i) => (
            <div
              key={b.partition}
              className="relative min-w-[3px] flex-1 rounded-t-[4px] transition-[height] duration-300"
              style={{
                height: `${Math.max(2, (b.rows / top) * 100)}%`,
                background: `var(--series-${slot})`,
                opacity: hover === null || hover === i ? 1 : 0.45,
              }}
              onPointerEnter={() => setHover(i)}
            />
          ))
        )}
      </div>
      <p className="mono mt-2 h-8 text-12 text-faint">
        {hover !== null && bars[hover] ? (
          <>
            {bars[hover]?.partition}
            <br />
            <span className="text-ink">{bars[hover]?.rows.toLocaleString("en-US")} rows</span>
          </>
        ) : (
          <span className="text-faint">
            largest holds {Math.max(0, ...bars.map((b) => b.rows)).toLocaleString("en-US")} rows
          </span>
        )}
      </p>
    </div>
  );
}
