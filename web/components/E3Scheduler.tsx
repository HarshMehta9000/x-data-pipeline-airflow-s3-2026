"use client";

import { useMemo, useState } from "react";
import { DEFAULT_PARAMS, makePostStream, simulate, type TaskInstance } from "@/lib/sim";
import { useAutopilot } from "@/lib/hooks";
import { CyclingBadge, Mono, Stat } from "@/components/ui";

const RUNS = 12;

/* The autopilot walks the failure probability, because that is the control that
   makes the point: the counters move and the run states do not. */
const AUTO_STEPS = [0, 0.1, 0.25, 0.45];

const STATE_COLOR: Record<TaskInstance["state"], string> = {
  success: "var(--st-success)",
  failed: "var(--st-failed)",
  up_for_retry: "var(--st-retry)",
};

const STATE_MARK: Record<TaskInstance["state"], string> = {
  success: "✓",
  failed: "✕",
  up_for_retry: "↻",
};

function Slider({
  label,
  value,
  min,
  max,
  step,
  onChange,
  format,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  format: (v: number) => string;
}) {
  return (
    <label className="block">
      <span className="flex items-baseline justify-between gap-2 text-12">
        <span className="text-muted">{label}</span>
        <span className="tnum mono text-ink">{format(value)}</span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="mt-1.5 w-full accent-[var(--accent)]"
      />
    </label>
  );
}

export function E3Scheduler() {
  const auto = useAutopilot(AUTO_STEPS.length, 4000);
  const [manual, setManual] = useState<{ p: number; retries: number; delay: number } | null>(null);
  const failureProb = manual?.p ?? (AUTO_STEPS[auto.index] as number);
  const retries = manual?.retries ?? 2;
  const retryDelay = manual?.delay ?? 2;

  const set = (patch: Partial<{ p: number; retries: number; delay: number }>) => {
    setManual((cur) => ({
      p: patch.p ?? cur?.p ?? failureProb,
      retries: patch.retries ?? cur?.retries ?? retries,
      delay: patch.delay ?? cur?.delay ?? retryDelay,
    }));
    auto.takeOver();
  };

  const stream = useMemo(
    () => makePostStream(DEFAULT_PARAMS.startMs, RUNS + 8, 12, 7),
    [],
  );

  const sim = useMemo(
    () =>
      simulate(
        { ...DEFAULT_PARAMS, days: RUNS, failureProb, retries, retryDelayMin: retryDelay, seed: 11 },
        stream,
      ),
    [stream, failureProb, retries, retryDelay],
  );

  const maxMin = Math.max(...sim.runs.map((r) => r.durationMin), 1);
  const T = sim.totals;

  return (
    <div {...auto.handoffProps}>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-4">
        <div className="grid flex-1 gap-x-6 gap-y-3 sm:grid-cols-3" style={{ maxWidth: 620 }}>
          <Slider
            label="task failure probability"
            value={failureProb}
            min={0}
            max={0.6}
            step={0.05}
            onChange={(v) => set({ p: v })}
            format={(v) => `${Math.round(v * 100)}%`}
          />
          <Slider
            label="retries"
            value={retries}
            min={0}
            max={5}
            step={1}
            onChange={(v) => set({ retries: v })}
            format={(v) => String(v)}
          />
          <Slider
            label="retry_delay"
            value={retryDelay}
            min={1}
            max={15}
            step={1}
            onChange={(v) => set({ delay: v })}
            format={(v) => `${v} min`}
          />
        </div>
        <CyclingBadge cycling={auto.cycling} />
      </div>

      <div className="rounded-xl border border-hairline bg-surface p-4">
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="text-14 font-semibold text-ink">Task instances</h3>
          <p className="mono text-12 text-faint">
            {T.taskAttempts} attempts · {T.retries} retries
          </p>
        </div>

        <div className="scroll-x">
          <div className="min-w-[540px]">
            {sim.runs.map((run) => (
              <div key={run.runIdx} className="flex items-center gap-2 py-[3px]">
                <span className="mono tnum w-14 shrink-0 text-12 text-faint">
                  run {run.runIdx + 1}
                </span>
                <div className="relative h-5 flex-1 rounded bg-surface-2">
                  {run.tasks.map((t, i) => {
                    const left = (t.startMin / maxMin) * 100;
                    const w = Math.max((t.durationMin / maxMin) * 100, 1.2);
                    return (
                      <div
                        key={`${t.taskId}-${t.attempt}-${i}`}
                        className="absolute top-[3px] h-[14px] rounded-[3px]"
                        style={{
                          left: `${left}%`,
                          width: `${w}%`,
                          background: STATE_COLOR[t.state],
                          opacity: t.state === "success" ? 1 : 0.9,
                        }}
                        title={`${t.taskId} attempt ${t.attempt}: ${t.state}, ${t.durationMin} min`}
                      />
                    );
                  })}
                </div>
                <span
                  className={`mono w-16 shrink-0 text-12 ${
                    run.state === "success" ? "text-st-success" : "text-st-failed"
                  }`}
                >
                  {run.state === "success" ? "✓ success" : "✕ failed"}
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 border-t border-hairline pt-3">
          {(["success", "up_for_retry", "failed"] as const).map((s) => (
            <span key={s} className="flex items-center gap-1.5 text-12 text-muted">
              <span
                aria-hidden="true"
                className="inline-block h-2.5 w-2.5 rounded-[2px]"
                style={{ background: STATE_COLOR[s] }}
              />
              <span aria-hidden="true">{STATE_MARK[s]}</span>
              {s}
            </span>
          ))}
        </div>
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-xl border border-hairline bg-surface px-4 py-3">
          <Stat
            label="DAG runs succeeded"
            value={`${T.successfulRuns} of ${T.runs}`}
            tone="success"
            sub="what the scheduler reports"
          />
        </div>
        <div className="rounded-xl border border-hairline bg-surface px-4 py-3">
          <Stat
            label="Objects written"
            value={T.objects.toLocaleString("en-US")}
            sub={`${T.putRequests.toLocaleString("en-US")} PUT requests`}
          />
        </div>
        <div className="rounded-xl border border-hairline bg-surface px-4 py-3">
          <Stat
            label="Rows in the lake"
            value={T.rowsInLake.toLocaleString("en-US")}
            tone="accent"
            sub="counting every object once"
          />
        </div>
        <div className="rounded-xl border border-hairline bg-surface px-4 py-3">
          <Stat
            label="Distinct posts"
            value={T.distinctPosts.toLocaleString("en-US")}
            sub={`duplication ${T.duplicationFactor.toFixed(2)}x`}
          />
        </div>
      </div>

      <p className="mt-4 max-w-[72ch] text-14 text-muted">
        Turn failures up. The retries fire, the Gantt grows, rows in the lake
        climb, and the run column stays green the whole way, because a retry that
        eventually succeeds is a successful run.{" "}
        <Mono className="text-ink">load</Mono> is not idempotent: its object key
        carries a fresh <Mono className="text-ink">%Y%m%dT%H%M%SZ</Mono> stamp, so
        an attempt that writes and then fails leaves its file behind and the retry
        writes another one beside it. Modelled as failing after the write, which
        is the case the retry makes worse, so the duplication reported here is an
        upper bound rather than a typical value.
      </p>
    </div>
  );
}
