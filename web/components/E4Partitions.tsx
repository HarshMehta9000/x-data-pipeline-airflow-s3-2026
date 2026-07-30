"use client";

import { useMemo, useState } from "react";
import readability from "@/data/readability.json";
import { ALL_LEVERS, DEFAULT_PARAMS, makePostStream, NO_LEVERS, simulate } from "@/lib/sim";
import { PartitionHistogram } from "@/components/charts";
import { useAutopilot } from "@/lib/hooks";
import { CyclingBadge, Mono, Panel } from "@/components/ui";

const HISTORY_DAYS = 90;

type Mode = "daily" | "backfill";

export function E4Partitions() {
  const auto = useAutopilot(2, 5200);
  const [manual, setManual] = useState<Mode | null>(null);
  const mode: Mode = manual ?? (auto.index === 0 ? "daily" : "backfill");

  const stream = useMemo(
    () => makePostStream(DEFAULT_PARAMS.startMs, HISTORY_DAYS, 12, 7),
    [],
  );

  const { runDate, eventDate } = useMemo(() => {
    const params =
      mode === "backfill"
        ? {
            ...DEFAULT_PARAMS,
            days: 1,
            lookbackDays: HISTORY_DAYS + 1,
            firstRunOffsetDays: HISTORY_DAYS + 1,
          }
        : { ...DEFAULT_PARAMS, days: HISTORY_DAYS };
    return {
      runDate: simulate({ ...params, levers: NO_LEVERS }, stream),
      eventDate: simulate({ ...params, levers: ALL_LEVERS }, stream),
    };
  }, [stream, mode]);

  const maxRows = Math.max(
    ...runDate.partitions.map((p) => p.rows),
    ...eventDate.partitions.map((p) => p.rows),
    1,
  );

  const hive = readability.probes.find((p) => p.reader === "duckdb hive_partitioning");
  const arrow = readability.probes.find((p) => p.reader === "pyarrow.dataset hive");
  const filter = readability.probes.find((p) => p.reader === "duckdb filter on the event date");
  const flat = readability.probes.find((p) => p.reader === "duckdb hive_partitioning off");

  return (
    <div {...auto.handoffProps}>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          {(["daily", "backfill"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => {
                setManual(m);
                auto.takeOver(m === "daily" ? 0 : 1);
              }}
              aria-pressed={mode === m}
              className={`rounded-md border px-3 py-1.5 text-12 transition-colors duration-200 ${
                mode === m
                  ? "border-accent bg-accent-soft text-accent"
                  : "border-hairline bg-surface text-muted hover:text-ink"
              }`}
            >
              {m === "daily" ? "90 daily runs" : "one backfill of 90 days"}
            </button>
          ))}
        </div>
        <CyclingBadge cycling={auto.cycling} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel className="px-4 py-4">
          <PartitionHistogram
            bars={runDate.partitions}
            slot="1"
            max={maxRows}
            label="Partitioned on the run date, as written"
          />
          <p className="mono mt-1 truncate text-12 text-faint">
            {runDate.partitions[0]?.partition ?? ""}
          </p>
        </Panel>
        <Panel className="px-4 py-4">
          <PartitionHistogram
            bars={eventDate.partitions}
            slot="2"
            max={maxRows}
            label="Partitioned on the post's own date"
          />
          <p className="mono mt-1 truncate text-12 text-faint">
            {eventDate.partitions[0]?.partition ?? ""}
          </p>
        </Panel>
      </div>

      <p className="mt-4 max-w-[76ch] text-14 text-muted">
        {mode === "daily" ? (
          <>
            On the daily schedule both layouts produce{" "}
            <span className="tnum text-ink">{runDate.partitions.length}</span>{" "}
            partitions, which is why nothing looks wrong in normal operation. The
            difference is what is inside them: on the left each partition holds
            about seven days of posts, all filed under the day the pipeline ran.
          </>
        ) : (
          <>
            One backfill, ninety days of history, one run. On the left the entire
            archive lands in{" "}
            <span className="tnum text-ink">{runDate.partitions.length}</span>{" "}
            partition holding{" "}
            <span className="tnum text-ink">
              {Math.max(...runDate.partitions.map((p) => p.rows)).toLocaleString("en-US")}
            </span>{" "}
            rows. On the right the same rows spread across{" "}
            <span className="tnum text-ink">{eventDate.partitions.length}</span>{" "}
            partitions.{" "}
            <Mono className="text-ink">catchup=False</Mono> is the only thing
            hiding this in the repo as it stands.
          </>
        )}
      </p>

      {/* The stronger half of the finding: the partition key collides with a column. */}
      <div className="mt-8 rounded-xl border border-st-retry/40 bg-st-retry-bg p-4">
        <h3 className="text-16 font-semibold text-ink">
          There are two fields called <Mono className="text-16 text-ink">day</Mono>, and
          they disagree
        </h3>
        <p className="mt-2 max-w-[76ch] text-14 text-muted">
          <Mono className="text-ink">transform</Mono> adds a string column{" "}
          <Mono className="text-ink">day</Mono> holding the post&apos;s own date.{" "}
          <Mono className="text-ink">load</Mono> writes into a directory named{" "}
          <Mono className="text-ink">day=</Mono> holding the run&apos;s day of
          month. Hive style partition discovery turns that directory into a column
          of the same name, so the dataset carries the name twice with two types
          and two meanings. This is measured, by pointing four readers at the
          output of <Mono className="text-ink">run_etl</Mono> on the repo&apos;s
          own fixture.
        </p>

        <div className="scroll-x mt-4">
          <table className="w-full min-w-[560px] text-12">
            <thead>
              <tr className="border-b border-hairline text-left text-faint">
                <th className="py-2 pr-3 font-medium">Reader</th>
                <th className="py-2 pr-3 font-medium">Result</th>
                <th className="py-2 font-medium">What comes back as day</th>
              </tr>
            </thead>
            <tbody className="mono">
              <tr className="border-b border-hairline">
                <td className="py-2 pr-3 text-ink">pyarrow.dataset, hive</td>
                <td className="py-2 pr-3 text-st-failed">✕ refuses to open</td>
                <td className="py-2 text-muted">{arrow?.error ?? ""}</td>
              </tr>
              <tr className="border-b border-hairline">
                <td className="py-2 pr-3 text-ink">duckdb, hive_partitioning</td>
                <td className="py-2 pr-3 text-st-retry">↻ opens, wrong column</td>
                <td className="py-2 text-muted">
                  {JSON.stringify(hive?.detail?.day_values ?? [])} as{" "}
                  {hive?.detail?.day_type ?? ""}, the run&apos;s day of month
                </td>
              </tr>
              <tr className="border-b border-hairline">
                <td className="py-2 pr-3 text-ink">duckdb, filter day = &apos;2026-01-15&apos;</td>
                <td className="py-2 pr-3 text-st-failed">✕ type error</td>
                <td className="py-2 text-muted">{filter?.error ?? ""}</td>
              </tr>
              <tr>
                <td className="py-2 pr-3 text-ink">duckdb, partitioning off</td>
                <td className="py-2 pr-3 text-st-success">✓ opens</td>
                <td className="py-2 text-muted">
                  {JSON.stringify(flat?.detail?.day_values ?? [])} as{" "}
                  {flat?.detail?.day_type ?? ""}, the post&apos;s own date
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <p className="mt-3 max-w-[76ch] text-14 text-muted">
          The event date column is not merely unused by the partitioning. In any
          reader that materialises partition keys, it is shadowed by an integer of
          the same name, and the only way to see the value{" "}
          <Mono className="text-ink">transform</Mono> computed is to throw the
          partition keys away. Renaming either one fixes it.
        </p>
        <p className="mono mt-3 text-12 text-faint">
          measured {readability.measured_at} · pyarrow {readability.environment.pyarrow} ·
          duckdb {readability.environment.duckdb} · web/python/readability.py
        </p>
      </div>
    </div>
  );
}
