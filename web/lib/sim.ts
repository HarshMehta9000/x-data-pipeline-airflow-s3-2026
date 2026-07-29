/*
  The scheduler simulation. Everything on the page that talks about more than
  one run reads this: the hero, the retry Gantt, the partition tree and the
  ninety day lake are four views of one state machine.

  It runs the repo's real transform and load key construction from
  lib/pipeline.ts rather than a paraphrase, so a change to the port shows up
  here too.

  Accounting rule, which the numbers depend on: an object is identified by its
  key. Writing the same key twice replaces the first object, exactly as S3
  does. So "rows in the lake" is the sum over distinct keys, while "PUT
  requests" counts every write including the ones that were later replaced.
  Those are different numbers and the page reports both.
*/

import {
  eventPartitionPath,
  loadKeys,
  normalize,
  objectStamp,
  transformPosts,
  type EnrichedPost,
  type RawPost,
} from "./pipeline";
import { pyJsonBytes } from "./pyjson";
import parquetModelJson from "../data/parquet-bytes.json";

/* ------------------------------------------------------------------- prng */

/** mulberry32. Seeded so a rerun of the page produces the same lake. */
export function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ---------------------------------------------------------- the post stream */

const SUBJECTS = [
  "the launch", "the update", "the rollout", "the migration", "the release",
  "the deploy", "the cutover", "the backfill",
];
const OPENERS = [
  "Shipping", "Watching", "Reviewing", "Testing", "Rolling out", "Planning",
];
const POSITIVE_TAILS = [
  "This is an amazing result for the team.",
  "Huge win, and the best numbers we have seen.",
  "Incredible progress today, everyone is excited.",
  "Great success, love the work here.",
  "Wonderful outcome and a happy team.",
];
const NEGATIVE_TAILS = [
  "This is a problem and the rollback was awful.",
  "Terrible timing, the worst possible week.",
  "A disaster, and the build is broken again.",
  "Sad to report another fail, the delay is bad.",
  "Angry about the wrong call here.",
];
const NEUTRAL_TAILS = [
  "Status report to follow tonight.",
  "The delayed window is now the current window.",
  "Notes are in the doc, disappointing turnaround aside.",
  "Numbers attached, no further comment.",
  "Timeline unchanged from the last note.",
];

export const DAY_MS = 86_400_000;

export interface StreamPost extends RawPost {
  id: string;
  created_at: string;
  text: string;
}

/**
 * A reproducible stream of posts across `days` days at `postsPerDay` posts a
 * day, starting at `startMs`. Sentiment is mixed on purpose so the daily
 * summary has something to average.
 */
export function makePostStream(
  startMs: number,
  days: number,
  postsPerDay: number,
  seed: number,
): StreamPost[] {
  const rng = makeRng(seed);
  const posts: StreamPost[] = [];
  let n = 0;
  for (let d = 0; d < days; d += 1) {
    for (let k = 0; k < postsPerDay; k += 1) {
      const r = rng();
      const tail =
        r < 0.38
          ? POSITIVE_TAILS[Math.floor(rng() * POSITIVE_TAILS.length)]
          : r < 0.66
            ? NEUTRAL_TAILS[Math.floor(rng() * NEUTRAL_TAILS.length)]
            : NEGATIVE_TAILS[Math.floor(rng() * NEGATIVE_TAILS.length)];
      const opener = OPENERS[Math.floor(rng() * OPENERS.length)] as string;
      const subject = SUBJECTS[Math.floor(rng() * SUBJECTS.length)] as string;
      // Spread through the day, never exactly on the boundary.
      const at = startMs + d * DAY_MS + Math.floor(rng() * (DAY_MS - 2000)) + 1000;
      n += 1;
      posts.push({
        id: `19${String(100000000000000 + n).padStart(15, "0")}`,
        created_at: new Date(at).toISOString(),
        text: `${opener} ${subject}. ${tail}`,
        source: "Twitter Web App",
        public_metrics: {
          like_count: Math.floor(rng() * 90000),
          retweet_count: Math.floor(rng() * 9000),
          reply_count: Math.floor(rng() * 4000),
          quote_count: Math.floor(rng() * 900),
        },
      });
    }
  }
  posts.sort((a, b) => (a.created_at < b.created_at ? -1 : 1));
  return posts;
}

/* ----------------------------------------------------------------- levers */

export interface Levers {
  /** Partition on the post's own created_at instead of the run date. */
  eventDatePartition: boolean;
  /** Derive the object key from the data window instead of the wall clock. */
  deterministicKey: boolean;
  /** Only read posts newer than the last successful run. */
  watermark: boolean;
}

export const NO_LEVERS: Levers = {
  eventDatePartition: false,
  deterministicKey: false,
  watermark: false,
};

export const ALL_LEVERS: Levers = {
  eventDatePartition: true,
  deterministicKey: true,
  watermark: true,
};

export interface SimParams {
  /** Number of scheduled runs, one per day. */
  days: number;
  postsPerDay: number;
  /** search_recent_tweets returns seven days. */
  lookbackDays: number;
  /** Per attempt probability that a task fails. */
  failureProb: number;
  /** default_args["retries"] */
  retries: number;
  /** default_args["retry_delay"], in minutes. */
  retryDelayMin: number;
  seed: number;
  levers: Levers;
  startMs: number;
  prefix: string;
  /*
    Serialising every run's payload the way Python would costs more than the
    rest of the simulation put together, and only the elements that display a
    payload size need it. Off by default so a ninety day run stays inside a
    frame budget; the elements that show XCom turn it on.
  */
  measureXcom?: boolean;
  /*
    Which day the first run happens on, counted from start_date. Normally 1,
    because a daily schedule runs the interval that just closed. A backfill
    replays history from a run that happens after it, so it sets this to the
    length of the history and reads all of it in one window.
  */
  firstRunOffsetDays?: number;
}

export const DEFAULT_PARAMS: SimParams = {
  days: 90,
  postsPerDay: 12,
  lookbackDays: 7,
  failureProb: 0,
  retries: 2,
  retryDelayMin: 2,
  seed: 7,
  levers: NO_LEVERS,
  // start_date=datetime(2026, 1, 1) in dags/x_data_pipeline.py
  startMs: Date.UTC(2026, 0, 1),
  prefix: "x-data",
};

/* ------------------------------------------------------------ task instances */

export type TaskState = "success" | "failed" | "up_for_retry" | "running" | "queued";
export type TaskId = "extract" | "transform" | "load";
export const TASK_IDS: TaskId[] = ["extract", "transform", "load"];

export interface TaskInstance {
  taskId: TaskId;
  attempt: number;
  state: "success" | "failed" | "up_for_retry";
  /** Minutes from the start of the run. */
  startMin: number;
  durationMin: number;
}

export interface WriteRecord {
  key: string;
  dataset: "posts" | "daily_summary";
  partition: string;
  rows: number;
  runIdx: number;
  attempt: number;
  /** True when this write replaced an object that was already there. */
  replaced: boolean;
}

export interface RunRecord {
  runIdx: number;
  /** The logical run instant, which is what load partitions on. */
  runMs: number;
  windowStartMs: number;
  windowEndMs: number;
  extracted: number;
  distinctExtracted: number;
  state: "success" | "failed";
  tasks: TaskInstance[];
  writes: WriteRecord[];
  durationMin: number;
  xcomExtractBytes: number;
  xcomTransformBytes: number;
}

export interface LakeObject {
  key: string;
  dataset: "posts" | "daily_summary";
  partition: string;
  rows: number;
  postIds: Set<string>;
  writes: number;
  /** From the measured model in data/parquet-bytes.json, not a guess. */
  bytes: number;
}

export interface SimResult {
  params: SimParams;
  runs: RunRecord[];
  objects: LakeObject[];
  /** Cumulative series, one point per run, for the diverging lines. */
  series: {
    runIdx: number;
    rowsInLake: number;
    distinctPosts: number;
    objects: number;
    putRequests: number;
  }[];
  totals: {
    runs: number;
    successfulRuns: number;
    failedRuns: number;
    taskAttempts: number;
    retries: number;
    putRequests: number;
    objects: number;
    rowsInLake: number;
    distinctPosts: number;
    postsInStream: number;
    duplicationFactor: number;
    postsBytes: number;
    summaryRows: number;
  };
  /** rows per partition for the posts dataset, sorted by partition. */
  partitions: { partition: string; rows: number; objects: number }[];
  streamLength: number;
}

/* ------------------------------------------------------- parquet size model */

/*
  Bytes are not guessed. python/measure_parquet.py runs the repo's real load
  stage through pyarrow at a range of row counts and fits these two numbers,
  and gate 5 re-derives them. See data/parquet-bytes.json for the measurement
  and its provenance.
*/
/*
  Interpolate the measured points rather than using a straight line fit. The
  relationship is strongly non linear at the bottom, which is the interesting
  part: a one row file is 7,680 bytes and a five row file is 8,304, so the
  least squares intercept of about 8.4kB would overstate every small object the
  pipeline writes, and small objects are the whole story here. Beyond the
  largest measured point the last measured segment's slope is extended, and the
  page says so wherever an extrapolated figure appears.
*/
const PQ_POINTS = {
  posts: parquetModelJson.posts.points as { rows: number; bytes: number }[],
  daily_summary: parquetModelJson.daily_summary.points as { rows: number; bytes: number }[],
};

export const PARQUET_MEASUREMENT = parquetModelJson;

export function parquetBytes(dataset: "posts" | "daily_summary", rows: number): number {
  if (rows <= 0) return 0;
  const pts = PQ_POINTS[dataset];
  const first = pts[0] as { rows: number; bytes: number };
  if (rows <= first.rows) return first.bytes;

  for (let i = 1; i < pts.length; i += 1) {
    const a = pts[i - 1] as { rows: number; bytes: number };
    const b = pts[i] as { rows: number; bytes: number };
    if (rows <= b.rows) {
      const t = (rows - a.rows) / (b.rows - a.rows);
      return Math.round(a.bytes + t * (b.bytes - a.bytes));
    }
  }

  const last = pts[pts.length - 1] as { rows: number; bytes: number };
  const prev = pts[pts.length - 2] as { rows: number; bytes: number };
  const slope = (last.bytes - prev.bytes) / (last.rows - prev.rows);
  return Math.round(last.bytes + slope * (rows - last.rows));
}

/** True when the row count is past the largest measured point. */
export function isExtrapolated(dataset: "posts" | "daily_summary", rows: number): boolean {
  const pts = PQ_POINTS[dataset];
  return rows > (pts[pts.length - 1] as { rows: number }).rows;
}

/* -------------------------------------------------------------- the scheduler */

function hashJitter(seed: number, runIdx: number, taskIdx: number, attempt: number): number {
  // Deterministic per task instance, so the Gantt does not reshuffle on rerender.
  const rng = makeRng(seed * 7919 + runIdx * 131 + taskIdx * 17 + attempt * 3);
  return rng();
}

const BASE_DURATION_MIN: Record<TaskId, number> = {
  extract: 1.4,
  transform: 0.6,
  load: 2.2,
};

/**
 * Run the DAG on its schedule and account for every object it writes.
 *
 * A failing task is modelled as failing after its side effect, which for load
 * means the object has already landed when the retry starts. That is the case
 * the finding is about, and it is the worst case, so the duplication this
 * reports is an upper bound rather than a typical value. Stated on the page.
 */
export function simulate(params: SimParams, stream: StreamPost[]): SimResult {
  const { days, lookbackDays, failureProb, retries, retryDelayMin, seed, levers, prefix } = params;
  const rng = makeRng(seed + 1013);

  const objects = new Map<string, LakeObject>();
  const runs: RunRecord[] = [];
  const series: SimResult["series"] = [];

  let putRequests = 0;
  let taskAttempts = 0;
  let retryCount = 0;
  let watermarkMs = -Infinity;

  // Airflow runs the daily interval [d, d+1) once d+1 has passed, so run N
  // covers the day that just ended.
  for (let runIdx = 0; runIdx < days; runIdx += 1) {
    const runMs = params.startMs + (runIdx + (params.firstRunOffsetDays ?? 1)) * DAY_MS;
    const windowEndMs = runMs;
    const windowStartMs = levers.watermark
      ? Math.max(watermarkMs, params.startMs)
      : runMs - lookbackDays * DAY_MS;

    const inWindow = stream.filter((p) => {
      const t = Date.parse(p.created_at);
      return t > windowStartMs && t <= windowEndMs;
    });

    const tasks: TaskInstance[] = [];
    const writes: WriteRecord[] = [];
    let cursorMin = 0;
    let runFailed = false;

    const normalized = inWindow.map(normalize);
    const transformed = transformPosts(normalized);

    for (let t = 0; t < TASK_IDS.length && !runFailed; t += 1) {
      const taskId = TASK_IDS[t] as TaskId;
      let succeeded = false;

      for (let attempt = 1; attempt <= retries + 1; attempt += 1) {
        taskAttempts += 1;
        if (attempt > 1) retryCount += 1;

        const jitter = hashJitter(seed, runIdx, t, attempt);
        const scale = 1 + (inWindow.length / 120) * 0.9;
        const durationMin = Number(
          (BASE_DURATION_MIN[taskId] * scale * (0.75 + jitter * 0.6)).toFixed(2),
        );
        const failed = rng() < failureProb;

        // The load task's side effect happens before the failure is reported.
        if (taskId === "load" && inWindow.length > 0) {
          for (const w of writeObjects(
            params,
            runIdx,
            runMs,
            windowStartMs,
            windowEndMs,
            attempt,
            transformed.posts,
            objects,
            prefix,
          )) {
            writes.push(w);
            putRequests += 1;
          }
        }

        tasks.push({
          taskId,
          attempt,
          state: failed ? (attempt <= retries ? "up_for_retry" : "failed") : "success",
          startMin: cursorMin,
          durationMin,
        });
        cursorMin += durationMin;

        if (!failed) {
          succeeded = true;
          break;
        }
        if (attempt <= retries) cursorMin += retryDelayMin;
      }

      if (!succeeded) runFailed = true;
    }

    if (!runFailed) watermarkMs = windowEndMs;

    const distinctExtracted = new Set(normalized.map((p) => p.id)).size;
    runs.push({
      runIdx,
      runMs,
      windowStartMs,
      windowEndMs,
      extracted: inWindow.length,
      distinctExtracted,
      state: runFailed ? "failed" : "success",
      tasks,
      writes,
      durationMin: cursorMin,
      xcomExtractBytes: params.measureXcom ? pyJsonBytes(normalized) : -1,
      xcomTransformBytes: params.measureXcom ? pyJsonBytes(transformed) : -1,
    });

    const snap = summarize(objects);
    series.push({
      runIdx,
      rowsInLake: snap.rowsInLake,
      distinctPosts: snap.distinctPosts,
      objects: objects.size,
      putRequests,
    });
  }

  const snap = summarize(objects);
  const partitionMap = new Map<string, { rows: number; objects: number }>();
  for (const o of objects.values()) {
    if (o.dataset !== "posts") continue;
    const cur = partitionMap.get(o.partition) ?? { rows: 0, objects: 0 };
    cur.rows += o.rows;
    cur.objects += 1;
    partitionMap.set(o.partition, cur);
  }

  const successfulRuns = runs.filter((r) => r.state === "success").length;

  return {
    params,
    runs,
    objects: [...objects.values()],
    series,
    totals: {
      runs: runs.length,
      successfulRuns,
      failedRuns: runs.length - successfulRuns,
      taskAttempts,
      retries: retryCount,
      putRequests,
      objects: objects.size,
      rowsInLake: snap.rowsInLake,
      distinctPosts: snap.distinctPosts,
      postsInStream: stream.length,
      duplicationFactor: snap.distinctPosts === 0 ? 0 : snap.rowsInLake / snap.distinctPosts,
      postsBytes: [...objects.values()].reduce((a, o) => a + o.bytes, 0),
      summaryRows: snap.summaryRows,
    },
    partitions: [...partitionMap.entries()]
      .map(([partition, v]) => ({ partition, rows: v.rows, objects: v.objects }))
      .sort((a, b) => (a.partition < b.partition ? -1 : 1)),
    streamLength: stream.length,
  };
}

function summarize(objects: Map<string, LakeObject>) {
  let rowsInLake = 0;
  let summaryRows = 0;
  const distinct = new Set<string>();
  for (const o of objects.values()) {
    if (o.dataset === "posts") {
      rowsInLake += o.rows;
      for (const id of o.postIds) distinct.add(id);
    } else {
      summaryRows += o.rows;
    }
  }
  return { rowsInLake, distinctPosts: distinct.size, summaryRows };
}

/** The load stage's writes for one attempt, honouring the levers. */
function writeObjects(
  params: SimParams,
  runIdx: number,
  runMs: number,
  windowStartMs: number,
  windowEndMs: number,
  attempt: number,
  rows: EnrichedPost[],
  objects: Map<string, LakeObject>,
  prefix: string,
): WriteRecord[] {
  const { levers } = params;
  const runDt = new Date(runMs);
  const out: WriteRecord[] = [];

  // Group into the partitions this configuration writes.
  const groups = new Map<string, EnrichedPost[]>();
  if (levers.eventDatePartition) {
    for (const r of rows) {
      const g = groups.get(r.day);
      if (g) g.push(r);
      else groups.set(r.day, [r]);
    }
  } else {
    groups.set("", rows);
  }

  for (const [day, groupRows] of groups) {
    const partition = levers.eventDatePartition
      ? eventPartitionPath(prefix, day)
      : loadKeys(prefix, runDt).posts_key.split("/").slice(0, -1).join("/");

    /*
      The repo stamps the key with the wall clock, so every attempt writes a new
      object.

      The deterministic lever keys the object on the data instead. Which data
      matters, and gate 3 is what settled it: keying on the run's window is not
      enough. A run that fails does not advance the watermark, so the next run
      covers a wider window, produces a different key, and leaves the failed
      run's object behind holding a subset of the same rows. That is a real
      1.14x, not a rounding error.

      Keying on the event date partition instead makes the object a function of
      the data it holds: whoever writes a given day writes the same key, so a
      failed run's output is replaced rather than accumulated. Without event
      date partitioning there is no such key available, and the window is the
      best that can be done, which is why the three levers only reach 1.0
      together.
    */
    const name = levers.deterministicKey
      ? levers.eventDatePartition
        ? "posts.parquet"
        : `posts_${isoDay(windowStartMs)}_${isoDay(windowEndMs)}.parquet`
      : `posts_${objectStamp(new Date(runMs + attempt * 1000))}.parquet`;

    const key = `${partition}/${name}`;
    const existing = objects.get(key);
    objects.set(key, {
      key,
      dataset: "posts",
      partition,
      rows: groupRows.length,
      postIds: new Set(groupRows.map((r) => r.id)),
      writes: (existing?.writes ?? 0) + 1,
      bytes: parquetBytes("posts", groupRows.length),
    });
    out.push({
      key,
      dataset: "posts",
      partition,
      rows: groupRows.length,
      runIdx,
      attempt,
      replaced: existing !== undefined,
    });
  }

  // The daily_summary dataset, always partitioned on run_date by the repo.
  const summaryPartition = loadKeys(prefix, runDt).summary_key.split("/").slice(0, -1).join("/");
  const summaryName = levers.deterministicKey
    ? `summary_${isoDay(windowStartMs)}_${isoDay(windowEndMs)}.parquet`
    : `summary_${objectStamp(new Date(runMs + attempt * 1000))}.parquet`;
  const summaryKey = `${summaryPartition}/${summaryName}`;
  const days = new Set(rows.map((r) => r.day)).size;
  const existingSummary = objects.get(summaryKey);
  objects.set(summaryKey, {
    key: summaryKey,
    dataset: "daily_summary",
    partition: summaryPartition,
    rows: days,
    postIds: new Set(),
    writes: (existingSummary?.writes ?? 0) + 1,
    bytes: parquetBytes("daily_summary", days),
  });
  out.push({
    key: summaryKey,
    dataset: "daily_summary",
    partition: summaryPartition,
    rows: days,
    runIdx,
    attempt,
    replaced: existingSummary !== undefined,
  });

  return out;
}

function isoDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/*
  XCom bytes are measured, not modelled: the payload the DAG would push is
  serialised with Python's own json rules and counted. lib/pyjson.ts is gated
  against json.dumps in gate 1, so these are the bytes Airflow would store.
*/
export function xcomBytes(payload: unknown): number {
  return pyJsonBytes(payload);
}
