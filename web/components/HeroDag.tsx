"use client";

import { useMemo } from "react";
import {
  DAY_MS,
  DEFAULT_PARAMS,
  makePostStream,
  simulate,
  TASK_IDS,
  type TaskId,
} from "@/lib/sim";
import { useElapsed, useOnScreen, useReducedMotion } from "@/lib/hooks";
import { Mono } from "@/components/ui";

const HERO_DAYS = 30;
const DAY_MS_ON_SCREEN = 300;
const HOLD_MS = 2000;
const CYCLE_MS = HERO_DAYS * DAY_MS_ON_SCREEN + HOLD_MS;

type Phase = "queued" | "running" | "success";

function stateFor(taskIndex: number, activeIndex: number, dayStarted: boolean): Phase {
  if (!dayStarted) return "queued";
  if (taskIndex < activeIndex) return "success";
  if (taskIndex === activeIndex) return "running";
  return "queued";
}

const STATE_STYLE: Record<Phase, { fg: string; bg: string; mark: string; label: string }> = {
  queued: { fg: "text-st-queued", bg: "bg-st-queued-bg", mark: "○", label: "queued" },
  running: { fg: "text-st-running", bg: "bg-st-running-bg", mark: "◐", label: "running" },
  success: { fg: "text-st-success", bg: "bg-st-success-bg", mark: "✓", label: "success" },
};

export function HeroDag() {
  const reduced = useReducedMotion();
  const [ref, onScreen] = useOnScreen<HTMLDivElement>();
  const elapsed = useElapsed(onScreen && !reduced, "hero");

  const sim = useMemo(() => {
    const stream = makePostStream(DEFAULT_PARAMS.startMs, HERO_DAYS + 2, 12, 7);
    return simulate(
      { ...DEFAULT_PARAMS, days: HERO_DAYS, measureXcom: true },
      stream,
    );
  }, []);

  // Reduced motion gets the finished state, which is the state that carries the
  // point, rather than a frozen first frame.
  const t = reduced ? CYCLE_MS - 1 : elapsed % CYCLE_MS;
  const rawDay = Math.floor(t / DAY_MS_ON_SCREEN);
  const day = Math.min(rawDay, HERO_DAYS - 1);
  const holding = rawDay >= HERO_DAYS;
  const withinDay = (t % DAY_MS_ON_SCREEN) / DAY_MS_ON_SCREEN;
  const activeTask = holding ? 3 : Math.min(2, Math.floor(withinDay * 3));

  const run = sim.runs[day];
  const snapshot = sim.series[day];
  const runsDone = holding ? HERO_DAYS : day;

  const partitions = useMemo(() => {
    const seen = new Map<string, { rows: number; objects: number }>();
    for (let i = 0; i <= day; i += 1) {
      for (const w of sim.runs[i]?.writes ?? []) {
        if (w.dataset !== "posts") continue;
        const cur = seen.get(w.partition) ?? { rows: 0, objects: 0 };
        cur.rows += w.rows;
        cur.objects += 1;
        seen.set(w.partition, cur);
      }
    }
    return [...seen.entries()].map(([partition, v]) => ({ partition, ...v }));
  }, [sim, day]);

  const runDate = new Date(DEFAULT_PARAMS.startMs + (day + 1) * DAY_MS)
    .toISOString()
    .slice(0, 10);

  return (
    <div ref={ref} className="grid gap-4 lg:grid-cols-[1.15fr_1fr]">
      {/* the DAG */}
      <div className="rounded-xl border border-hairline bg-surface p-4">
        <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="mono text-12 text-faint">
            dag_id=<span className="text-ink">x_data_pipeline</span> schedule=
            <span className="text-ink">@daily</span>
          </h3>
          <p className="mono text-12 text-faint">
            run <span className="tnum text-ink">{runDate}</span>
          </p>
        </div>

        <div className="scroll-x -mx-1 px-1 pb-1">
          <div className="flex min-w-[460px] items-center gap-2">
            {TASK_IDS.map((taskId: TaskId, i) => {
              const phase = stateFor(i, activeTask, true);
              const style = STATE_STYLE[phase];
              const bytes =
                i === 0 ? run?.xcomExtractBytes ?? 0 : i === 1 ? run?.xcomTransformBytes ?? 0 : 0;
              return (
                <div key={taskId} className="flex flex-1 items-center gap-2">
                  <div
                    className={`min-w-0 flex-1 rounded-lg border border-hairline ${style.bg} px-3 py-2.5 transition-colors duration-200`}
                  >
                    <p className="mono truncate text-12 text-ink">{taskId}</p>
                    <p className={`mono mt-1 flex items-center gap-1.5 text-12 ${style.fg}`}>
                      <span aria-hidden="true">{style.mark}</span>
                      {style.label}
                    </p>
                  </div>
                  {i < 2 ? (
                    <div className="flex w-16 shrink-0 flex-col items-center">
                      <span
                        className={`mono tnum whitespace-nowrap text-12 transition-opacity duration-200 ${
                          activeTask > i ? "text-muted opacity-100" : "text-faint opacity-30"
                        }`}
                      >
                        {bytes > 0 ? `${(bytes / 1024).toFixed(1)}kB` : "not set"}
                      </span>
                      <svg width="56" height="10" aria-hidden="true">
                        <line
                          x1="0"
                          y1="5"
                          x2="48"
                          y2="5"
                          stroke="var(--hairline-strong)"
                          strokeWidth="1.5"
                        />
                        <path d="M48 1 L54 5 L48 9 Z" fill="var(--hairline-strong)" />
                        {activeTask > i ? (
                          <circle r="3" fill="var(--accent)">
                            <animate
                              attributeName="cx"
                              from="0"
                              to="48"
                              dur="0.5s"
                              repeatCount="indefinite"
                            />
                            <animate
                              attributeName="cy"
                              from="5"
                              to="5"
                              dur="0.5s"
                              repeatCount="indefinite"
                            />
                          </circle>
                        ) : null}
                      </svg>
                      <span className="mono text-12 text-faint">XCom</span>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>

        <dl className="mt-5 grid grid-cols-3 gap-3 border-t border-hairline pt-4">
          <div>
            <dt className="text-12 text-faint">Runs</dt>
            <dd className="tnum mt-0.5 text-20 font-semibold text-ink">{runsDone}</dd>
          </div>
          <div>
            <dt className="text-12 text-faint">Succeeded</dt>
            <dd className="tnum mt-0.5 text-20 font-semibold text-st-success">{runsDone}</dd>
          </div>
          <div>
            <dt className="text-12 text-faint">Failed</dt>
            <dd className="tnum mt-0.5 text-20 font-semibold text-ink">0</dd>
          </div>
        </dl>

        <div
          className={`mt-4 rounded-lg border px-3 py-3 transition-all duration-300 ${
            holding
              ? "border-st-retry/40 bg-st-retry-bg opacity-100"
              : "border-hairline bg-surface-2 opacity-70"
          }`}
        >
          <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1">
            <span className="text-12 text-muted">
              rows in the lake{" "}
              <span className="tnum text-16 font-semibold text-ink">
                {(snapshot?.rowsInLake ?? 0).toLocaleString("en-US")}
              </span>
            </span>
            <span className="text-12 text-muted">
              distinct posts{" "}
              <span className="tnum text-16 font-semibold text-ink">
                {(snapshot?.distinctPosts ?? 0).toLocaleString("en-US")}
              </span>
            </span>
          </div>
          <p
            className={`mt-1.5 text-14 transition-opacity duration-300 ${
              holding ? "text-ink opacity-100" : "text-muted opacity-0"
            }`}
          >
            Thirty runs, thirty successes, nothing to alert on. Every post is in
            the lake about seven times.
          </p>
        </div>
      </div>

      {/* where it lands */}
      <div className="rounded-xl border border-hairline bg-surface p-4">
        <div className="mb-3 flex items-baseline justify-between gap-2">
          <h3 className="mono text-12 text-faint">s3://bucket/x-data/posts/</h3>
          <p className="mono tnum text-12 text-faint">
            {partitions.length} partition{partitions.length === 1 ? "" : "s"}
          </p>
        </div>
        <div className="h-[268px] overflow-y-auto pr-1">
          <ul className="space-y-1">
            {partitions.map((p, i) => {
              const parts = p.partition.split("/");
              const leaf = parts.slice(-3).join("/");
              const isNewest = i === partitions.length - 1;
              return (
                <li
                  key={p.partition}
                  className={`flex items-center justify-between gap-2 rounded border px-2 py-1.5 transition-colors duration-300 ${
                    isNewest && !holding
                      ? "border-accent/40 bg-accent-soft"
                      : "border-hairline bg-surface-2"
                  }`}
                >
                  <span className="mono truncate text-12 text-ink">{leaf}</span>
                  <span className="mono tnum shrink-0 text-12 text-faint">
                    {p.objects} obj · {p.rows.toLocaleString("en-US")} rows
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
        <p className="mt-3 border-t border-hairline pt-3 text-12 text-muted">
          One partition per <Mono className="text-ink">run</Mono> date, not per
          post date. The posts inside{" "}
          <Mono className="text-ink">{partitions.at(-1)?.partition.split("/").slice(-3).join("/") ?? ""}</Mono>{" "}
          were written across seven different days.
        </p>
      </div>
    </div>
  );
}
