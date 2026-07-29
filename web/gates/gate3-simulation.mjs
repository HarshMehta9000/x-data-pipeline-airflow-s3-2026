/*
  Gate 3: the simulation is arithmetically sound.

  A simulation that produces a persuasive chart and does not balance is worse
  than no simulation. These are conservation checks, run across a grid of
  parameters rather than on the one configuration the page happens to show.
*/
import { Gate } from "./assert.mjs";
import { requireLib } from "./build-lib.mjs";

export function run() {
  const g = new Gate("gate 3  the simulation balances");
  const sim = requireLib("sim.js");

  const grid = [];
  for (const days of [1, 7, 30, 90]) {
    for (const postsPerDay of [1, 12, 30]) {
      for (const failureProb of [0, 0.15, 0.4]) {
        for (const seed of [3, 7]) {
          grid.push({ days, postsPerDay, failureProb, seed });
        }
      }
    }
  }

  for (const cfg of grid) {
    const stream = sim.makePostStream(
      sim.DEFAULT_PARAMS.startMs,
      Math.max(cfg.days + 8, 16),
      cfg.postsPerDay,
      cfg.seed,
    );
    const label = `days=${cfg.days} rate=${cfg.postsPerDay} p=${cfg.failureProb} seed=${cfg.seed}`;

    for (const [name, levers] of [
      ["as written", sim.NO_LEVERS],
      ["all levers", sim.ALL_LEVERS],
    ]) {
      const r = sim.simulate(
        { ...sim.DEFAULT_PARAMS, ...cfg, levers },
        stream,
      );
      const T = r.totals;
      const tag = `${label} ${name}`;

      // Rows in the lake equal the sum over distinct objects.
      const summed = r.objects
        .filter((o) => o.dataset === "posts")
        .reduce((a, o) => a + o.rows, 0);
      g.eq(T.rowsInLake, summed, `${tag}: rows in the lake equal the sum over objects`);

      // Distinct posts can never exceed rows.
      g.ok(
        T.distinctPosts <= T.rowsInLake,
        `${tag}: distinct posts do not exceed rows`,
        `${T.distinctPosts} > ${T.rowsInLake}`,
      );

      // Nothing is invented: every post in the lake came from the stream.
      g.ok(
        T.distinctPosts <= stream.length,
        `${tag}: distinct posts do not exceed the stream`,
      );

      // Every PUT is accounted for, and a replaced object is still a PUT.
      const writes = r.runs.reduce((a, run) => a + run.writes.length, 0);
      g.eq(T.putRequests, writes, `${tag}: PUT requests equal the writes recorded`);
      g.ok(T.putRequests >= T.objects, `${tag}: PUTs are at least the object count`);
      const writeSum = r.objects.reduce((a, o) => a + o.writes, 0);
      g.eq(writeSum, T.putRequests, `${tag}: per object write counts sum to the PUTs`);

      // Retries only ever add attempts.
      g.ok(
        T.taskAttempts >= T.runs * 3 - (T.failedRuns * 3),
        `${tag}: attempts are at least three per completed run`,
      );
      g.eq(
        T.retries,
        r.runs.reduce((a, run) => a + run.tasks.filter((t) => t.attempt > 1).length, 0),
        `${tag}: retry count equals attempts beyond the first`,
      );

      // The series is monotonic: a lake never shrinks.
      for (let i = 1; i < r.series.length; i += 1) {
        const prev = r.series[i - 1];
        const cur = r.series[i];
        g.ok(cur.rowsInLake >= prev.rowsInLake, `${tag}: rows never decrease at run ${i}`);
        g.ok(
          cur.distinctPosts >= prev.distinctPosts,
          `${tag}: distinct posts never decrease at run ${i}`,
        );
        g.ok(cur.putRequests >= prev.putRequests, `${tag}: PUTs never decrease at run ${i}`);
      }

      // The final series point is the totals.
      const last = r.series[r.series.length - 1];
      if (last) {
        g.eq(last.rowsInLake, T.rowsInLake, `${tag}: final series point matches the total rows`);
        g.eq(last.distinctPosts, T.distinctPosts, `${tag}: final series point matches distinct`);
        g.eq(last.putRequests, T.putRequests, `${tag}: final series point matches PUTs`);
      }

      if (name === "all levers" && T.distinctPosts > 0) {
        /*
          Completeness, not just the absence of duplicates. A duplication factor
          of 1.0 is also what you get by losing data: one copy of half the posts
          reads exactly the same in that ratio. Mutation testing found this gap,
          by advancing the watermark past a failed run and watching every other
          assertion here stay green while posts silently went missing.
        */
        /*
          Coverage is bounded on both sides rather than pinned to one number.
          Everything up to the last successful run must be present, because the
          watermark only advances on success. A run that failed may still have
          left complete output behind, since load is modelled as failing after
          its write, so the lake can legitimately hold a little more than that.
        */
        const upTo = (endMs) =>
          stream.filter((p) => {
            const t = Date.parse(p.created_at);
            return t > sim.DEFAULT_PARAMS.startMs && t <= endMs;
          }).length;

        const lastGood = [...r.runs].reverse().find((run) => run.state === "success");
        const mustHave = lastGood ? upTo(lastGood.windowEndMs) : 0;
        const couldHave = upTo(r.runs[r.runs.length - 1].windowEndMs);

        g.ok(
          T.distinctPosts >= mustHave,
          `${tag}: nothing up to the last successful run was lost`,
          `have ${T.distinctPosts}, need at least ${mustHave}`,
        );
        g.ok(
          T.distinctPosts <= couldHave,
          `${tag}: nothing was invented beyond the last window`,
          `have ${T.distinctPosts}, at most ${couldHave}`,
        );

        // The claim the page makes, at every point on the grid.
        g.eq(
          T.duplicationFactor,
          1,
          `${tag}: duplication factor is exactly 1.0 with all three levers`,
        );
        g.eq(
          T.rowsInLake,
          T.distinctPosts,
          `${tag}: one row per post with all three levers`,
        );

        // And every post sits in the partition matching its own timestamp.
        for (const o of r.objects) {
          if (o.dataset !== "posts") continue;
          const m = /year=(\d{4})\/month=(\d{2})\/day=(\d{2})$/.exec(o.partition);
          g.ok(m !== null, `${tag}: partition ${o.partition} is a date partition`);
          if (!m) continue;
          const partitionDay = `${m[1]}-${m[2]}-${m[3]}`;
          for (const id of o.postIds) {
            const post = stream.find((p) => p.id === id);
            g.eq(
              post?.created_at.slice(0, 10),
              partitionDay,
              `${tag}: post ${id} sits in the partition for its own date`,
            );
          }
        }
      }

      if (name === "as written" && cfg.failureProb === 0 && cfg.days >= 30) {
        // The overlap is structural, so it should be close to the lookback.
        g.ok(
          T.duplicationFactor > 5 && T.duplicationFactor <= cfg.days,
          `${tag}: duplication reflects the seven day overlap`,
          `got ${T.duplicationFactor}`,
        );
      }
    }
  }

  /* ---- the backfill collapse ------------------------------------------ */
  const history = 90;
  const stream = sim.makePostStream(sim.DEFAULT_PARAMS.startMs, history, 12, 7);
  const backfill = {
    ...sim.DEFAULT_PARAMS,
    days: 1,
    lookbackDays: history + 1,
    firstRunOffsetDays: history + 1,
  };
  const collapsed = sim.simulate({ ...backfill, levers: sim.NO_LEVERS }, stream);
  const spread = sim.simulate({ ...backfill, levers: sim.ALL_LEVERS }, stream);

  g.eq(collapsed.partitions.length, 1, "a backfill on the run date lands in one partition");
  g.eq(
    collapsed.partitions[0].rows,
    stream.length,
    "and that partition holds the entire history",
  );
  g.eq(
    spread.partitions.length,
    history,
    "the same backfill on the event date spreads across the history",
  );
  g.eq(
    spread.partitions.reduce((a, p) => a + p.rows, 0),
    stream.length,
    "with the same number of rows in total",
  );
  for (const p of spread.partitions) {
    g.eq(p.rows, 12, `event date partition ${p.partition} holds one day of posts`);
  }

  /* ---- parquet sizing is the measurement, not a curve ------------------ */
  const measured = sim.PARQUET_MEASUREMENT;
  for (const point of measured.posts.points) {
    g.eq(
      sim.parquetBytes("posts", point.rows),
      point.bytes,
      `parquet size at ${point.rows} rows is the measured value`,
    );
  }
  g.ok(
    sim.parquetBytes("posts", 1) < sim.parquetBytes("posts", 5000),
    "parquet size increases with rows",
  );
  g.ok(sim.isExtrapolated("posts", 100000), "beyond the measurements is flagged as extrapolated");
  g.ok(!sim.isExtrapolated("posts", 100), "inside the measurements is not");

  return g.report();
}
