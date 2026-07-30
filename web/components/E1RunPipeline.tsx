"use client";

import { useMemo, useState } from "react";
import fixtureRaw from "@/data/fixture.json";
import {
  fallbackSentimentTrace,
  loadKeys,
  normalize,
  transformPosts,
  type RawPost,
} from "@/lib/pipeline";
import { pyJsonBytes } from "@/lib/pyjson";
import { useAutopilot } from "@/lib/hooks";
import { CyclingBadge, Mono, Panel, PanelHead, Stat } from "@/components/ui";

const FIXTURE = fixtureRaw as RawPost[];

/*
  The run instant is an input, not a constant of the universe, which is the
  whole point of this element: the partition follows this control, and the
  posts' own timestamps do not move when it changes.
*/
const RUN_PRESETS = [
  { label: "2026-01-20 09:00Z", iso: "2026-01-20T09:00:00Z" },
  { label: "2026-03-02 04:15Z", iso: "2026-03-02T04:15:30Z" },
  { label: "2026-07-28 23:03Z", iso: "2026-07-28T23:03:14Z" },
];

function truncate(s: string, n: number): string {
  return s.length <= n ? s : `${s.slice(0, n - 1)}…`;
}

export function E1RunPipeline() {
  const [customText, setCustomText] = useState("");
  const [useCustom, setUseCustom] = useState(false);
  const [runIso, setRunIso] = useState(RUN_PRESETS[0]!.iso);
  const auto = useAutopilot(FIXTURE.length, 4200, !useCustom);
  const selected = auto.index;

  const rawInput = useMemo<RawPost[]>(() => {
    if (useCustom) {
      return [
        {
          id: "1850000000000000099",
          created_at: "2026-01-15T12:00:00.000Z",
          text: customText,
          source: "Twitter Web App",
          public_metrics: {
            like_count: 1200,
            retweet_count: 90,
            reply_count: 40,
            quote_count: 7,
          },
        },
      ];
    }
    const one = FIXTURE[selected];
    return one ? [one] : [];
  }, [useCustom, customText, selected]);

  const result = useMemo(() => {
    const runDt = new Date(runIso);
    const posts = rawInput.map(normalize);
    const transformed = transformPosts(posts);
    const keys = loadKeys("x-data", runDt);
    return {
      posts,
      transformed,
      keys,
      xcomExtract: pyJsonBytes(posts),
      xcomTransform: pyJsonBytes(transformed),
      trace: fallbackSentimentTrace(posts[0]?.text ?? ""),
    };
  }, [rawInput, runIso]);

  const post = result.posts[0];
  const enriched = result.transformed.posts[0];

  return (
    <div {...auto.handoffProps}>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          {FIXTURE.map((p, i) => (
            <button
              key={String(p.id)}
              type="button"
              onClick={() => {
                setUseCustom(false);
                auto.takeOver(i);
              }}
              aria-pressed={!useCustom && selected === i}
              className={`mono rounded-md border px-2.5 py-1 text-12 transition-colors duration-200 ${
                !useCustom && selected === i
                  ? "border-accent bg-accent-soft text-accent"
                  : "border-hairline bg-surface text-muted hover:text-ink"
              }`}
            >
              post {i + 1}
            </button>
          ))}
          <button
            type="button"
            onClick={() => {
              setUseCustom(true);
              auto.takeOver();
            }}
            aria-pressed={useCustom}
            className={`rounded-md border px-2.5 py-1 text-12 transition-colors duration-200 ${
              useCustom
                ? "border-accent bg-accent-soft text-accent"
                : "border-hairline bg-surface text-muted hover:text-ink"
            }`}
          >
            Type your own
          </button>
        </div>
        <CyclingBadge cycling={auto.cycling} />
      </div>

      {useCustom ? (
        <label className="mb-4 block">
          <span className="sr-only">Post text</span>
          <textarea
            value={customText}
            onChange={(e) => setCustomText(e.target.value)}
            rows={2}
            placeholder="Type a post. The lexicon only counts exact word matches, so try delayed against delay."
            className="w-full resize-y rounded-lg border border-hairline bg-surface px-3 py-2 text-14 text-ink placeholder:text-faint"
          />
        </label>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-3">
        {/* extract */}
        <Panel>
          <PanelHead
            title={
              <span className="flex items-center gap-2">
                <Mono className="rounded bg-surface-2 px-1.5 py-0.5 text-faint">1</Mono>
                extract
              </span>
            }
            right={<Mono className="text-faint">_normalize</Mono>}
          />
          <div className="px-4 py-3">
            <p className="mb-3 text-12 text-muted">
              The raw payload is flattened to eight columns. Missing metrics
              become zero, a missing source becomes <Mono>unknown</Mono>.
            </p>
            <dl className="scroll-x">
              <table className="w-full text-12">
                <tbody className="mono">
                  {post
                    ? (
                        [
                          ["id", post.id],
                          ["created_at", post.created_at],
                          ["text", truncate(post.text, 42)],
                          ["like_count", post.like_count],
                          ["retweet_count", post.retweet_count],
                          ["reply_count", post.reply_count],
                          ["quote_count", post.quote_count],
                          ["source", post.source],
                        ] as [string, string | number][]
                      ).map(([k, v]) => (
                        <tr key={k} className="border-b border-hairline last:border-0">
                          <td className="py-1.5 pr-3 align-top text-faint">{k}</td>
                          <td className="py-1.5 text-right align-top text-ink">
                            {String(v) === "" ? (
                              <span className="text-faint">&quot;&quot;</span>
                            ) : (
                              String(v)
                            )}
                          </td>
                        </tr>
                      ))
                    : null}
                </tbody>
              </table>
            </dl>
          </div>
        </Panel>

        {/* transform */}
        <Panel>
          <PanelHead
            title={
              <span className="flex items-center gap-2">
                <Mono className="rounded bg-surface-2 px-1.5 py-0.5 text-faint">2</Mono>
                transform
              </span>
            }
            right={<Mono className="text-faint">28 word lexicon</Mono>}
          />
          <div className="px-4 py-3">
            <p className="mb-2 text-12 text-muted">
              Every token, lowercased and stripped of punctuation, checked
              against the fallback lexicon.
            </p>
            <p className="mb-3 leading-7">
              {result.trace.tokens.map((t, i) => (
                <span
                  key={`${t.raw}-${i}`}
                  className={`mono mr-1 inline-block rounded px-1 py-0.5 text-12 ${
                    t.hit === "positive"
                      ? "bg-st-success-bg text-st-success"
                      : t.hit === "negative"
                        ? "bg-st-failed-bg text-st-failed"
                        : "text-faint"
                  }`}
                >
                  {t.token || t.raw}
                </span>
              ))}
              {result.trace.tokens.length === 0 ? (
                <span className="text-12 text-faint">no tokens</span>
              ) : null}
            </p>
            <div className="grid grid-cols-3 gap-3 border-t border-hairline pt-3">
              <Stat
                label="engagement_total"
                value={(enriched?.engagement_total ?? 0).toLocaleString("en-US")}
              />
              <Stat
                label="sentiment_score"
                value={(enriched?.sentiment_score ?? 0).toFixed(4)}
              />
              <Stat label="day" value={<Mono>{enriched?.day || "not set"}</Mono>} />
            </div>
            <p className="mt-3 text-12 text-muted">
              <span className="text-faint">label</span>{" "}
              <Mono
                className={
                  enriched?.sentiment_label === "positive"
                    ? "text-st-success"
                    : enriched?.sentiment_label === "negative"
                      ? "text-st-failed"
                      : "text-muted"
                }
              >
                {enriched?.sentiment_label}
              </Mono>{" "}
              <span className="text-faint">
                from {result.trace.positives} positive and{" "}
                {result.trace.negatives} negative matches, divided by 3
              </span>
            </p>
          </div>
        </Panel>

        {/* load */}
        <Panel>
          <PanelHead
            title={
              <span className="flex items-center gap-2">
                <Mono className="rounded bg-surface-2 px-1.5 py-0.5 text-faint">3</Mono>
                load
              </span>
            }
            right={<Mono className="text-faint">run date</Mono>}
          />
          <div className="px-4 py-3">
            <p className="mb-2 text-12 text-muted">The DAG runs at</p>
            <div className="mb-3 flex flex-wrap gap-1.5">
              {RUN_PRESETS.map((p) => (
                <button
                  key={p.iso}
                  type="button"
                  onClick={() => setRunIso(p.iso)}
                  aria-pressed={runIso === p.iso}
                  className={`mono rounded border px-2 py-1 text-12 transition-colors duration-200 ${
                    runIso === p.iso
                      ? "border-accent bg-accent-soft text-accent"
                      : "border-hairline bg-surface text-muted hover:text-ink"
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
            <p className="mb-1 text-12 text-faint">object key</p>
            <p className="scroll-x mono whitespace-nowrap rounded bg-surface-2 px-2 py-1.5 text-12 text-ink">
              s3://bucket/{result.keys.posts_key}
            </p>
            <p className="mb-1 mt-3 text-12 text-faint">daily summary</p>
            <p className="scroll-x mono whitespace-nowrap rounded bg-surface-2 px-2 py-1.5 text-12 text-ink">
              s3://bucket/{result.keys.summary_key}
            </p>
            <div className="mt-3 grid grid-cols-2 gap-3 border-t border-hairline pt-3">
              <Stat
                label="XCom after extract"
                value={`${result.xcomExtract} B`}
                sub="pushed to the metadata database"
              />
              <Stat
                label="XCom after transform"
                value={`${result.xcomTransform} B`}
                sub="the whole payload again"
              />
            </div>
          </div>
        </Panel>
      </div>

      <p className="mt-4 max-w-[68ch] text-14 text-muted">
        The post was written on{" "}
        <Mono className="text-ink">{enriched?.day || "not set"}</Mono> and it
        lands under{" "}
        <Mono className="text-ink">
          {result.keys.posts_key.split("/").slice(2, 5).join("/")}
        </Mono>
        . Change the run time and the partition moves. The post does not.
      </p>
    </div>
  );
}
