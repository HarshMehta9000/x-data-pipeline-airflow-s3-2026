"use client";

import { useEffect, useMemo, useState } from "react";
import {
  DAY_MS,
  DEFAULT_PARAMS,
  makePostStream,
  simulate,
  type Levers,
  type SimResult,
} from "@/lib/sim";
import { computeCost, PRICES, usd } from "@/lib/cost";
import { LineChart } from "@/components/charts";
import { useOnScreen } from "@/lib/hooks";
import { Mono, Panel, Stat } from "@/components/ui";

const DAYS = 90;
const QUERIES_PER_MONTH = 1000;

const LEVER_COPY: { key: keyof Levers; title: string; detail: string }[] = [
  {
    key: "eventDatePartition",
    title: "Partition on the event date",
    detail: "year=/month=/day= from the post's own created_at, not from datetime.now.",
  },
  {
    key: "deterministicKey",
    title: "Make load idempotent",
    detail: "Key the object on the data window rather than a fresh timestamp, so a retry overwrites.",
  },
  {
    key: "watermark",
    title: "Add a watermark",
    detail: "Read only posts newer than the last successful run, instead of a fixed seven day window.",
  },
];

/*
  The simulation runs in a frame callback rather than during render, which keeps
  the timing measurement out of the render path and lets the runtime be an
  honest number rather than an estimate.
*/
function useTimedSimulation(levers: Levers, postsPerDay: number, failureProb: number) {
  const [state, setState] = useState<{ result: SimResult; ms: number } | null>(null);
  const stream = useMemo(
    () => makePostStream(DEFAULT_PARAMS.startMs, DAYS, postsPerDay, 7),
    [postsPerDay],
  );

  useEffect(() => {
    let raf = 0;
    raf = requestAnimationFrame(() => {
      const t0 = performance.now();
      const result = simulate({ ...DEFAULT_PARAMS, days: DAYS, failureProb, levers }, stream);
      setState({ result, ms: performance.now() - t0 });
    });
    return () => cancelAnimationFrame(raf);
  }, [stream, levers, failureProb]);

  return state;
}

export function E5Lake() {
  const [ref, onScreen] = useOnScreen<HTMLDivElement>();
  const [levers, setLevers] = useState<Levers>({
    eventDatePartition: false,
    deterministicKey: false,
    watermark: false,
  });
  const [postsPerDay, setPostsPerDay] = useState(12);
  const [failureProb, setFailureProb] = useState(0.1);

  const state = useTimedSimulation(levers, postsPerDay, failureProb);
  const sim = state?.result;
  const T = sim?.totals;

  const cost = useMemo(() => {
    if (!sim || !T) return null;
    // One day of posts. Without event date partitioning there is no partition
    // to prune on, so the query reads the whole posts dataset.
    const postsBytes = sim.objects
      .filter((o) => o.dataset === "posts")
      .reduce((a, o) => a + o.bytes, 0);
    const oneDay = levers.eventDatePartition
      ? Math.max(
          ...sim.partitions.map((p) =>
            sim.objects
              .filter((o) => o.dataset === "posts" && o.partition === p.partition)
              .reduce((a, o) => a + o.bytes, 0),
          ),
          0,
        )
      : postsBytes;
    return computeCost({
      bytes: T.postsBytes,
      putRequests: T.putRequests,
      scanBytesPerQuery: oneDay,
      queriesPerMonth: QUERIES_PER_MONTH,
    });
  }, [sim, T, levers.eventDatePartition]);

  const allOn = levers.eventDatePartition && levers.deterministicKey && levers.watermark;

  return (
    <div ref={ref}>
      <div className="grid gap-4 lg:grid-cols-3">
        {LEVER_COPY.map((l) => {
          const on = levers[l.key];
          return (
            <button
              key={l.key}
              type="button"
              onClick={() => setLevers((cur) => ({ ...cur, [l.key]: !cur[l.key] }))}
              aria-pressed={on}
              className={`rounded-xl border px-4 py-3 text-left transition-colors duration-200 ${
                on
                  ? "border-accent bg-accent-soft"
                  : "border-hairline bg-surface hover:border-hairline-strong"
              }`}
            >
              <span className="flex items-center justify-between gap-3">
                <span className={`text-14 font-semibold ${on ? "text-accent" : "text-ink"}`}>
                  {l.title}
                </span>
                <span
                  aria-hidden="true"
                  className={`flex h-5 w-9 shrink-0 items-center rounded-full px-0.5 transition-colors duration-200 ${
                    on ? "justify-end bg-accent" : "justify-start bg-surface-3"
                  }`}
                >
                  <span className="h-4 w-4 rounded-full bg-surface" />
                </span>
              </span>
              <span className="mt-1.5 block text-12 text-muted">{l.detail}</span>
            </button>
          );
        })}
      </div>

      <div className="mt-4 flex flex-wrap items-end gap-6">
        <label className="min-w-[180px] flex-1">
          <span className="flex items-baseline justify-between gap-2 text-12">
            <span className="text-muted">posts a day</span>
            <span className="mono tnum text-ink">{postsPerDay}</span>
          </span>
          <input
            type="range"
            min={2}
            max={40}
            step={1}
            value={postsPerDay}
            onChange={(e) => setPostsPerDay(Number(e.target.value))}
            className="mt-1.5 w-full accent-[var(--accent)]"
          />
        </label>
        <label className="min-w-[180px] flex-1">
          <span className="flex items-baseline justify-between gap-2 text-12">
            <span className="text-muted">task failure probability</span>
            <span className="mono tnum text-ink">{Math.round(failureProb * 100)}%</span>
          </span>
          <input
            type="range"
            min={0}
            max={0.5}
            step={0.05}
            value={failureProb}
            onChange={(e) => setFailureProb(Number(e.target.value))}
            className="mt-1.5 w-full accent-[var(--accent)]"
          />
        </label>
        <p className="mono text-12 text-faint">
          {state ? `${DAYS} runs simulated in ${state.ms.toFixed(0)} ms` : "simulating"}
        </p>
      </div>

      {sim && T ? (
        <>
          <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Panel className="px-4 py-3">
              <Stat
                label="Duplication factor"
                value={`${T.duplicationFactor.toFixed(2)}x`}
                tone={allOn && T.duplicationFactor === 1 ? "success" : "accent"}
                sub={allOn && T.duplicationFactor === 1 ? "exactly one copy of each post" : "rows per distinct post"}
              />
            </Panel>
            <Panel className="px-4 py-3">
              <Stat
                label="Rows in the lake"
                value={T.rowsInLake.toLocaleString("en-US")}
                sub={`${T.distinctPosts.toLocaleString("en-US")} distinct posts`}
              />
            </Panel>
            <Panel className="px-4 py-3">
              <Stat
                label="Objects"
                value={T.objects.toLocaleString("en-US")}
                sub={`avg ${Math.round(T.postsBytes / Math.max(T.objects, 1) / 1024)} kB each`}
              />
            </Panel>
            <Panel className="px-4 py-3">
              <Stat
                label="Runs succeeded"
                value={`${T.successfulRuns} of ${T.runs}`}
                tone="success"
                sub={`${T.retries} retries fired`}
              />
            </Panel>
          </div>

          <Panel className="mt-4 px-4 py-4">
            <h3 className="mb-1 text-14 font-semibold text-ink">
              Rows in the lake against distinct posts
            </h3>
            <p className="mb-3 text-12 text-muted">
              The gap between the two lines is the waste. It opens on day seven,
              when the first overlapping window is written a second time.
            </p>
            <LineChart
              series={[
                { name: "rows in the lake", points: sim.series.map((s) => s.rowsInLake), slot: "1" },
                { name: "distinct posts", points: sim.series.map((s) => s.distinctPosts), slot: "2" },
              ]}
              xLabels={sim.series.map((s) =>
                new Date(DEFAULT_PARAMS.startMs + (s.runIdx + 1) * DAY_MS).toISOString().slice(0, 10),
              )}
              xLabel="run date"
              yLabel="rows"
            />
          </Panel>

          {cost ? (
            <Panel className="mt-4 px-4 py-4">
              <h3 className="text-14 font-semibold text-ink">What ninety days costs</h3>
              <p className="mt-1 max-w-[76ch] text-12 text-muted">
                One query: give me the posts written on a single day. Without event
                date partitioning there is no partition to prune on, so it reads the
                whole posts dataset, every time.
              </p>
              <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <Stat
                  label="Storage, one month"
                  value={usd(cost.storageUsd)}
                  sub={`${cost.gb.toFixed(3)} GB at ${PRICES.prices.s3_standard_storage_gb_month.value}/GB-mo`}
                />
                <Stat
                  label="PUT requests"
                  value={usd(cost.putUsd)}
                  sub={`${T.putRequests.toLocaleString("en-US")} writes`}
                />
                <Stat
                  label="Per event date query"
                  value={usd(cost.perQueryUsd)}
                  sub={`${(cost.scanTb * 1e6).toFixed(1)} MB scanned`}
                />
                <Stat
                  label={`Queries, ${QUERIES_PER_MONTH.toLocaleString("en-US")} a month`}
                  value={usd(cost.queryUsd)}
                  tone="accent"
                  sub="the assumption, stated"
                />
              </div>
              <p className="mt-4 border-t border-hairline pt-3 text-12 text-faint">
                us-east-1 on demand list prices from the AWS Price List API, fetched{" "}
                {PRICES.fetched_at}. S3 storage SKU{" "}
                <Mono>{PRICES.prices.s3_standard_storage_gb_month.sku}</Mono>, offer
                published {PRICES.prices.s3_standard_storage_gb_month.offer_published?.slice(0, 10)}.
                Athena at ${PRICES.prices.athena_tb_scanned.value} per TB scanned, SKU{" "}
                <Mono>{PRICES.prices.athena_tb_scanned.sku}</Mono>. No per query
                minimum is applied, so the query figure is a lower bound. The
                absolute numbers are small at this posting rate; the ratio between
                the two configurations is the point.
              </p>
            </Panel>
          ) : null}

          <div
            className={`mt-4 rounded-lg border px-4 py-3 text-14 ${
              allOn ? "border-st-success/40 bg-st-success-bg text-ink" : "border-hairline bg-surface-2 text-muted"
            }`}
          >
            {allOn ? (
              <>
                All three on, at{" "}
                <span className="tnum">{Math.round(failureProb * 100)}%</span> task
                failure: duplication{" "}
                <span className="tnum font-semibold">{T.duplicationFactor.toFixed(2)}x</span>,{" "}
                {T.rowsInLake.toLocaleString("en-US")} rows for{" "}
                {T.distinctPosts.toLocaleString("en-US")} posts. Every post lands in
                the partition matching its own timestamp, once.
              </>
            ) : (
              <>
                Turn all three on. The watermark closes the overlap, the
                deterministic key stops retries adding copies, and the event date
                partition puts each post where a reader would look for it.
              </>
            )}
          </div>
        </>
      ) : (
        <p className="mt-6 text-14 text-faint">
          {onScreen ? "Simulating ninety runs." : "Scroll to run the simulation."}
        </p>
      )}
    </div>
  );
}
