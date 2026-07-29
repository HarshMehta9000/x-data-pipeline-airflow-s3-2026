/*
  A line for line port of the repo's extract._normalize, transform.transform_posts
  and load path construction, so the browser runs the pipeline's real logic
  rather than a mock of it.

  Every deviation from the Python would be a lie on the page, so the port is
  gated against the source in gates/gate1-parity.mjs on several hundred
  generated posts. Where Python semantics are subtle, the comment says which
  Python rule is being reproduced.
*/

import { pyRound } from "./pyround";
import { pyJsonBytes } from "./pyjson";

export interface RawPost {
  id?: string | number;
  created_at?: string | null;
  text?: string;
  source?: string;
  public_metrics?: {
    like_count?: number;
    retweet_count?: number;
    reply_count?: number;
    quote_count?: number;
  } | null;
}

export interface NormalizedPost {
  id: string;
  /* Nullable, because dict.get(key, default) returns the stored None when the
     key is present and null, rather than the default. */
  created_at: string | null;
  text: string;
  like_count: number;
  retweet_count: number;
  reply_count: number;
  quote_count: number;
  source: string | null;
}

export interface EnrichedPost extends NormalizedPost {
  engagement_total: number;
  sentiment_score: number;
  sentiment_label: SentimentLabel;
  day: string;
}

export type SentimentLabel = "positive" | "neutral" | "negative";

export interface DailySummaryRow {
  day: string;
  post_count: number;
  total_engagement: number;
  avg_sentiment: number;
  positive: number;
  neutral: number;
  negative: number;
}

export interface Transformed {
  posts: EnrichedPost[];
  daily_summary: DailySummaryRow[];
}

/* ---------------------------------------------------------------- lexicon */

// pipeline/transform.py, verbatim and in source order.
export const POS_WORDS = [
  "good", "great", "love", "excellent", "amazing", "happy", "win", "best",
  "awesome", "incredible", "excited", "success", "wonderful", "huge",
] as const;

export const NEG_WORDS = [
  "bad", "terrible", "hate", "awful", "sad", "lose", "worst", "broken",
  "fail", "disaster", "angry", "wrong", "problem", "delay",
] as const;

const POS = new Set<string>(POS_WORDS);
const NEG = new Set<string>(NEG_WORDS);

/*
  Python's str.split() with no argument splits on runs of Unicode whitespace as
  defined by Py_UNICODE_ISSPACE, which is not the same set as JavaScript's \s:
  Python includes U+001C to U+001F and U+0085 but excludes U+FEFF, and \s does
  the reverse. Spell the set out so the two agree on unicode input.
*/
const PY_SPACE =
  /[\t\n\v\f\r\x1c\x1d\x1e\x1f \x85\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+/;

const STRIP_CHARS = new Set([".", ",", "!", "?", ";", ":", '"', "'"]);

/** Python's str.strip(".,!?;:\"'"): both ends, any of those characters. */
function stripPunct(token: string): string {
  let start = 0;
  let end = token.length;
  while (start < end && STRIP_CHARS.has(token[start] as string)) start += 1;
  while (end > start && STRIP_CHARS.has(token[end - 1] as string)) end -= 1;
  return token.slice(start, end);
}

export function tokenize(text: string): string[] {
  // Python drops leading and trailing whitespace runs rather than yielding "".
  const parts = text.split(PY_SPACE).filter((t) => t.length > 0);
  return parts.map((t) => stripPunct(t).toLowerCase());
}

export interface LexiconTrace {
  tokens: { token: string; raw: string; hit: "positive" | "negative" | null }[];
  positives: number;
  negatives: number;
  raw_score: number;
  score: number;
}

/** transform._fallback_sentiment, plus the per token trace the page draws. */
export function fallbackSentimentTrace(text: string): LexiconTrace {
  const rawParts = text.split(PY_SPACE).filter((t) => t.length > 0);
  const tokens = rawParts.map((raw) => {
    const token = stripPunct(raw).toLowerCase();
    const hit = POS.has(token) ? "positive" : NEG.has(token) ? "negative" : null;
    return { token, raw, hit: hit as "positive" | "negative" | null };
  });
  const positives = tokens.filter((t) => t.hit === "positive").length;
  const negatives = tokens.filter((t) => t.hit === "negative").length;
  const rawScore = positives - negatives;
  // The Python computes the score first and only then returns 0.0 for an empty
  // token list, which is the same result by a different route.
  const score = tokens.length === 0 ? 0 : Math.max(-1, Math.min(1, rawScore / 3));
  return { tokens, positives, negatives, raw_score: rawScore, score };
}

export function fallbackSentiment(text: string): number {
  return fallbackSentimentTrace(text).score;
}

/** The rounding the pipeline applies before labelling, exposed for the gate. */
export function pyRound4(score: number): number {
  return pyRound(score, 4);
}

/** transform._label: thresholds at +0.05 and -0.05, inclusive. */
export function labelFor(score: number): SentimentLabel {
  if (score >= 0.05) return "positive";
  if (score <= -0.05) return "negative";
  return "neutral";
}

/* --------------------------------------------------------------- extract */

function toInt(v: unknown): number {
  // Python int() on the fixture's JSON numbers; the fixture only ever holds ints.
  if (typeof v === "number") return Math.trunc(v);
  if (typeof v === "string" && v.trim() !== "") return Math.trunc(Number(v));
  return 0;
}

/*
  extract._normalize.

  raw.get("source", "unknown") is not the same as raw.source ?? "unknown".
  Python only substitutes the default when the key is absent, so a post that
  carries an explicit null keeps the null all the way into the Parquet file.
  Reproduce that distinction rather than tidying it up, because the page claims
  this is the repo's own normalisation.
*/
export function normalize(raw: RawPost): NormalizedPost {
  const has = (k: keyof RawPost) => Object.prototype.hasOwnProperty.call(raw, k);
  const metrics = raw.public_metrics ?? {}; // Python's `or {}` also swallows None
  return {
    id: !has("id") ? "" : pyStr(raw.id),
    created_at: !has("created_at") ? "" : (raw.created_at as string | null),
    text: !has("text") ? "" : (raw.text as string),
    like_count: toInt(metrics.like_count ?? 0),
    retweet_count: toInt(metrics.retweet_count ?? 0),
    reply_count: toInt(metrics.reply_count ?? 0),
    quote_count: toInt(metrics.quote_count ?? 0),
    source: !has("source") ? "unknown" : (raw.source as string | null),
  };
}

/** Python's str(). JavaScript spells None and True differently. */
function pyStr(v: unknown): string {
  if (v === null || v === undefined) return "None";
  if (v === true) return "True";
  if (v === false) return "False";
  return String(v);
}

/* ------------------------------------------------------------- transform */

export type Scorer = (text: string) => number;

/** transform.transform_posts. The scorer is injectable because the repo's own
 *  choice of scorer depends on whether vaderSentiment imports. */
export function transformPosts(
  posts: NormalizedPost[],
  scorer: Scorer = fallbackSentiment,
): Transformed {
  const enriched: EnrichedPost[] = posts.map((p) => {
    const engagement =
      p.like_count + p.retweet_count + p.reply_count + p.quote_count;
    const sentiment = pyRound(scorer(p.text), 4);
    return {
      ...p,
      engagement_total: engagement,
      sentiment_score: sentiment,
      sentiment_label: labelFor(sentiment),
      day: (p.created_at || "").slice(0, 10),
    };
  });

  const buckets = new Map<string, EnrichedPost[]>();
  for (const row of enriched) {
    const b = buckets.get(row.day);
    if (b) b.push(row);
    else buckets.set(row.day, [row]);
  }

  // Python iterates sorted(buckets.items()), so day order is lexicographic.
  const days = [...buckets.keys()].sort();
  const summary: DailySummaryRow[] = days.map((day) => {
    const rows = buckets.get(day) as EnrichedPost[];
    const n = rows.length;
    // Float addition is order dependent, so sum in the same order Python does.
    let scoreSum = 0;
    let engagementSum = 0;
    for (const r of rows) {
      engagementSum += r.engagement_total;
      scoreSum += r.sentiment_score;
    }
    return {
      day,
      post_count: n,
      total_engagement: engagementSum,
      avg_sentiment: pyRound(scoreSum / n, 4),
      positive: rows.filter((r) => r.sentiment_label === "positive").length,
      neutral: rows.filter((r) => r.sentiment_label === "neutral").length,
      negative: rows.filter((r) => r.sentiment_label === "negative").length,
    };
  });

  return { posts: enriched, daily_summary: summary };
}

/* ------------------------------------------------------------------ load */

function pad(n: number, width = 2): string {
  return String(n).padStart(width, "0");
}

/** load._partition_path: the run date, not the event date. */
export function partitionPath(prefix: string, runDt: Date): string {
  const y = runDt.getUTCFullYear();
  const m = pad(runDt.getUTCMonth() + 1);
  const d = pad(runDt.getUTCDate());
  return `${prefix}/posts/year=${pad(y, 4)}/month=${m}/day=${d}`;
}

/** load._summary_path */
export function summaryPath(prefix: string, runDt: Date): string {
  const y = pad(runDt.getUTCFullYear(), 4);
  const m = pad(runDt.getUTCMonth() + 1);
  const d = pad(runDt.getUTCDate());
  return `${prefix}/daily_summary/run_date=${y}-${m}-${d}`;
}

/** The %Y%m%dT%H%M%SZ stamp that makes every object key unique. */
export function objectStamp(runDt: Date): string {
  const y = pad(runDt.getUTCFullYear(), 4);
  return (
    `${y}${pad(runDt.getUTCMonth() + 1)}${pad(runDt.getUTCDate())}T` +
    `${pad(runDt.getUTCHours())}${pad(runDt.getUTCMinutes())}${pad(runDt.getUTCSeconds())}Z`
  );
}

export interface LoadKeys {
  posts_key: string;
  summary_key: string;
}

/** load.load_data's key construction, both datasets. */
export function loadKeys(prefix: string, runDt: Date): LoadKeys {
  const ts = objectStamp(runDt);
  return {
    posts_key: `${partitionPath(prefix, runDt)}/posts_${ts}.parquet`,
    summary_key: `${summaryPath(prefix, runDt)}/summary_${ts}.parquet`,
  };
}

/** What the event date partition would have been, for the comparison in E4. */
export function eventPartitionPath(prefix: string, day: string): string {
  const [y, m, d] = day.split("-");
  return `${prefix}/posts/year=${y ?? ""}/month=${m ?? ""}/day=${d ?? ""}`;
}

/* ---------------------------------------------------------------- driver */

export interface EtlResult {
  posts: NormalizedPost[];
  transformed: Transformed;
  keys: LoadKeys;
  xcom_extract_bytes: number;
  xcom_transform_bytes: number;
}

/** pipeline.run_etl, with the XCom payload sizes the DAG would actually push. */
export function runEtl(raw: RawPost[], runDt: Date, prefix = "x-data", scorer?: Scorer): EtlResult {
  const posts = raw.map(normalize);
  const transformed = transformPosts(posts, scorer);
  return {
    posts,
    transformed,
    keys: loadKeys(prefix, runDt),
    xcom_extract_bytes: jsonBytes(posts),
    xcom_transform_bytes: jsonBytes(transformed),
  };
}

export function jsonBytes(value: unknown): number {
  return pyJsonBytes(value);
}
