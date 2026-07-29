"use client";

import { useEffect, useMemo, useState } from "react";
import {
  fallbackSentimentTrace,
  labelFor,
  pyRound4,
  type SentimentLabel,
} from "@/lib/pipeline";
import { Vader, type VaderData } from "@/lib/vader";
import { useAutopilot } from "@/lib/hooks";
import { CyclingBadge, Mono, Panel, PanelHead } from "@/components/ui";

/*
  The lexicon is 250kB, so it loads as its own chunk on first sight rather than
  in the page bundle. Until it arrives the fallback side is fully usable, which
  is the honest ordering: the fallback is what the repo runs by default.
*/
let vaderPromise: Promise<Vader> | null = null;
function loadVader(): Promise<Vader> {
  if (!vaderPromise) {
    vaderPromise = import("@/data/vader-lexicon.json").then(
      (mod) => new Vader((mod.default ?? mod) as unknown as VaderData),
    );
  }
  return vaderPromise;
}

const SAMPLES = [
  {
    text: "The launch was delayed again. This is a problem and pretty disappointing.",
    note: "From the repo's own fixture. The lexicon holds delay but not delayed, and disappointing is not in it at all.",
  },
  {
    text: "This is an amazing milestone for the team. Huge win and I am so excited!",
    note: "Four matches, so the fallback saturates at its ceiling while VADER reads the exclamation mark too.",
  },
  {
    text: "Not a great result and honestly not the best week.",
    note: "The fallback has no idea what not means. It counts great and best as positive.",
  },
  {
    text: "Some servers went down. Working on a fix now.",
    note: "No lexicon word at all, so the fallback returns exactly zero and calls it neutral.",
  },
  {
    text: "The rollout is going well, but the outage was terrible.",
    note: "VADER halves what comes before but and boosts what comes after. The fallback just counts.",
  },
];

function LabelChip({ label }: { label: SentimentLabel }) {
  const style =
    label === "positive"
      ? "bg-st-success-bg text-st-success"
      : label === "negative"
        ? "bg-st-failed-bg text-st-failed"
        : "bg-surface-2 text-muted";
  return <span className={`mono rounded px-1.5 py-0.5 text-12 ${style}`}>{label}</span>;
}

export function E2Sentiment() {
  const [custom, setCustom] = useState<string | null>(null);
  const auto = useAutopilot(SAMPLES.length, 5200, custom === null);
  const [vader, setVader] = useState<Vader | null>(null);

  useEffect(() => {
    let live = true;
    loadVader().then((v) => {
      if (live) setVader(v);
    });
    return () => {
      live = false;
    };
  }, []);

  const sample = SAMPLES[auto.index] as (typeof SAMPLES)[number];
  const text = custom ?? sample.text;

  const fallback = useMemo(() => {
    const trace = fallbackSentimentTrace(text);
    const score = pyRound4(trace.score);
    return { trace, score, label: labelFor(score) };
  }, [text]);

  const vaderResult = useMemo(() => {
    if (!vader) return null;
    const scores = vader.polarityScores(text);
    const score = pyRound4(scores.compound);
    return { scores, score, label: labelFor(score) };
  }, [vader, text]);

  const disagrees = vaderResult !== null && vaderResult.label !== fallback.label;
  const delta = vaderResult ? Math.abs(vaderResult.score - fallback.score) : 0;

  return (
    <div {...auto.handoffProps}>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          {SAMPLES.map((s, i) => (
            <button
              key={s.text}
              type="button"
              onClick={() => {
                setCustom(null);
                auto.takeOver(i);
              }}
              aria-pressed={custom === null && auto.index === i}
              className={`mono rounded-md border px-2.5 py-1 text-12 transition-colors duration-200 ${
                custom === null && auto.index === i
                  ? "border-accent bg-accent-soft text-accent"
                  : "border-hairline bg-surface text-muted hover:text-ink"
              }`}
            >
              text {i + 1}
            </button>
          ))}
        </div>
        <CyclingBadge cycling={auto.cycling} />
      </div>

      <label className="mb-4 block">
        <span className="sr-only">Post text</span>
        <textarea
          value={text}
          onChange={(e) => {
            setCustom(e.target.value);
            auto.takeOver();
          }}
          rows={2}
          className="w-full resize-y rounded-lg border border-hairline bg-surface px-3 py-2 text-14 text-ink"
        />
      </label>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel>
          <PanelHead
            title="The 28 word fallback"
            right={<Mono className="text-faint">no dependency</Mono>}
          />
          <div className="px-4 py-3">
            <p className="mb-3 min-h-[3.5rem] leading-7">
              {fallback.trace.tokens.map((t, i) => (
                <span
                  key={`${t.raw}-${i}`}
                  className={`mono mr-1 inline-block rounded px-1 py-0.5 text-12 ${
                    t.hit === "positive"
                      ? "bg-st-success-bg text-st-success"
                      : t.hit === "negative"
                        ? "bg-st-failed-bg text-st-failed"
                        : "text-faint line-through decoration-hairline-strong"
                  }`}
                >
                  {t.token || t.raw}
                </span>
              ))}
            </p>
            <div className="flex items-baseline justify-between gap-3 border-t border-hairline pt-3">
              <span className="tnum text-28 font-semibold text-ink">
                {fallback.score.toFixed(4)}
              </span>
              <LabelChip label={fallback.label} />
            </div>
            <p className="mt-2 text-12 text-muted">
              {fallback.trace.positives} positive minus {fallback.trace.negatives} negative,
              divided by 3, clamped to one. Struck through words were checked and
              missed.
            </p>
          </div>
        </Panel>

        <Panel>
          <PanelHead
            title="VADER"
            right={
              <Mono className="text-faint">
                {vader ? `${vader.lexiconSize.toLocaleString("en-US")} entries` : "loading"}
              </Mono>
            }
          />
          <div className="px-4 py-3">
            {vaderResult ? (
              <>
                <div className="mb-3 min-h-[3.5rem]">
                  <div className="flex h-6 overflow-hidden rounded">
                    {(
                      [
                        ["pos", vaderResult.scores.pos, "bg-st-success"],
                        ["neu", vaderResult.scores.neu, "bg-st-none"],
                        ["neg", vaderResult.scores.neg, "bg-st-failed"],
                      ] as const
                    ).map(([name, v, cls]) =>
                      v <= 0 ? null : (
                        <div
                          key={name}
                          className={`${cls} flex items-center justify-center transition-all duration-300`}
                          style={{ width: `${v * 100}%` }}
                          title={`${name} ${v}`}
                        >
                          <span className="mono px-1 text-12 text-white mix-blend-luminosity">
                            {v >= 0.16 ? name : ""}
                          </span>
                        </div>
                      ),
                    )}
                  </div>
                  <p className="mono mt-2 text-12 text-faint">
                    pos {vaderResult.scores.pos} · neu {vaderResult.scores.neu} · neg{" "}
                    {vaderResult.scores.neg}
                  </p>
                </div>
                <div className="flex items-baseline justify-between gap-3 border-t border-hairline pt-3">
                  <span className="tnum text-28 font-semibold text-ink">
                    {vaderResult.score.toFixed(4)}
                  </span>
                  <LabelChip label={vaderResult.label} />
                </div>
                <p className="mt-2 text-12 text-muted">
                  Valence per word, then negation, boosters, capitalisation and
                  punctuation, normalised to the compound score.
                </p>
              </>
            ) : (
              <p className="py-8 text-center text-14 text-faint">
                Loading the lexicon.
              </p>
            )}
          </div>
        </Panel>
      </div>

      <div
        className={`mt-4 rounded-lg border px-4 py-3 text-14 ${
          disagrees ? "border-st-retry/40 bg-st-retry-bg text-ink" : "border-hairline bg-surface-2 text-muted"
        }`}
      >
        {vaderResult ? (
          <>
            <span className="tnum font-semibold">
              {delta.toFixed(4)}
            </span>{" "}
            apart on the same text, and{" "}
            {disagrees ? (
              <>
                they disagree on the label: <LabelChip label={fallback.label} /> against{" "}
                <LabelChip label={vaderResult.label} />.
              </>
            ) : (
              <>they agree on the label this time.</>
            )}{" "}
            {custom === null ? sample.note : null}
          </>
        ) : (
          "Both scorers write to the same sentiment_score column."
        )}
      </div>

      <p className="mt-4 max-w-[68ch] text-14 text-muted">
        <code className="mono text-12 text-ink">transform._make_scorer</code> tries
        to import <code className="mono text-12 text-ink">vaderSentiment</code> and
        falls back to the 28 word list when the import raises. Nothing in the DAG,
        the config or the tests records which one ran. Two workers in one cluster
        can write different values into the same column, and the file gives no way
        to tell which is which.
      </p>
    </div>
  );
}
