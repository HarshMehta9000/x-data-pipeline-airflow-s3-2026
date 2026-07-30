import { E1RunPipeline } from "@/components/E1RunPipeline";
import { E2Sentiment } from "@/components/E2Sentiment";
import { E3Scheduler } from "@/components/E3Scheduler";
import { E4Partitions } from "@/components/E4Partitions";
import { E5Lake } from "@/components/E5Lake";
import { E6Diagnostics } from "@/components/E6Diagnostics";
import { HeroDag } from "@/components/HeroDag";
import { Section } from "@/components/ui";

export default function Home() {
  return (
    <main>
      <header className="mx-auto w-full max-w-[1200px] px-6 pb-4 pt-20 sm:pt-24">
        <p className="mono mb-4 text-12 uppercase tracking-[0.14em] text-faint">
          x_data_pipeline · airflow 2.9 · s3 · parquet
        </p>
        <h1 className="max-w-[20ch] text-44 font-semibold leading-[1.05] tracking-[-0.02em] text-ink">
          Every run is green. The data is wrong.
        </h1>
        <p className="mt-5 max-w-[62ch] text-16 text-muted">
          A three task Airflow DAG that extracts posts from X, scores them and
          writes Parquet to S3. It runs offline, it passes its tests, and it has
          never failed. This page runs the pipeline&apos;s real logic in your
          browser to show what it writes to the lake, and what ninety days of
          successful runs leave behind.
        </p>
      </header>

      <div className="mx-auto w-full max-w-[1200px] px-6 pb-6 pt-6">
        <HeroDag />
      </div>

      <Section
        id="run"
        eyebrow="Element 1"
        title="Run the pipeline"
        lede="The repo's extract, transform and load, ported to TypeScript and verified against the Python on 15,240 assertions. Pick a post from the fixture or type your own."
      >
        <E1RunPipeline />
      </Section>

      <Section
        id="sentiment"
        eyebrow="Element 2"
        title="Two scorers, one column"
        lede="transform picks VADER when it imports and a 28 word list when it does not. Both write to sentiment_score, and nothing records which one ran."
      >
        <E2Sentiment />
      </Section>

      <Section
        id="scheduler"
        eyebrow="Element 3"
        title="What a retry costs"
        lede="Task instances with attempts, backoff and duration, driven by retries and retry_delay rather than drawn. Turn failures up and watch the counters move while the run states do not."
      >
        <E3Scheduler />
      </Section>

      <Section
        id="partitions"
        eyebrow="Element 4"
        title="Where the data actually lands"
        lede="The load stage partitions on the date the pipeline ran. The transform stage computes the date the post was written, and calls it day."
      >
        <E4Partitions />
      </Section>

      <Section
        id="lake"
        eyebrow="Element 5"
        title="The lake after ninety days"
        lede="The pipeline writes one day. A platform engineer reasons about ninety. Three switches, and the duplication factor that falls out of them."
      >
        <E5Lake />
      </Section>

      <Section
        id="production"
        eyebrow="Element 6"
        title="Would this survive contact with production?"
        lede="The diagnostics an interviewer asks for, answered with measurements rather than opinions, including the ones where the answer is no."
      >
        <E6Diagnostics />
      </Section>

      <Section
        id="method"
        eyebrow="Method"
        title="How every number here was produced"
        lede="Nothing on this page is typed in by hand. Each figure is computed, and each computation is checked against the repo it describes."
      >
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="rounded-xl border border-hairline bg-surface px-4 py-4">
            <h3 className="text-14 font-semibold text-ink">The port</h3>
            <p className="mt-2 text-14 text-muted">
              extract, transform and the load stage&apos;s key construction were
              ported to TypeScript so the browser runs the pipeline&apos;s real
              logic. A generated corpus of 450 posts, including empty text, nulls,
              unicode, a byte order mark and posts sitting on the label thresholds,
              is scored by the Python and replayed through the TypeScript. Both of
              the repo&apos;s scorers are covered: the fallback run blocks the
              vaderSentiment import so the same code takes the other branch.
            </p>
            <p className="mt-2 text-14 text-muted">
              Two real differences turned up this way. Python&apos;s{" "}
              <code className="mono text-12 text-ink">dict.get(key, default)</code>{" "}
              returns a stored null rather than the default, and JavaScript&apos;s{" "}
              <code className="mono text-12 text-ink">trim()</code> strips a byte
              order mark that Python&apos;s{" "}
              <code className="mono text-12 text-ink">strip()</code> keeps. Both
              would have put wrong values on this page.
            </p>
          </div>
          <div className="rounded-xl border border-hairline bg-surface px-4 py-4">
            <h3 className="text-14 font-semibold text-ink">The gates</h3>
            <p className="mt-2 text-14 text-muted">
              <code className="mono text-12 text-ink">npm run verify</code> typechecks,
              lints, and runs every gate: parity against Python for both scorers, the
              findings re-derived from the source rather than transcribed, the
              simulation&apos;s arithmetic, the price provenance, the Parquet
              measurements, and the VADER port against the installed package.
            </p>
            <p className="mt-2 text-14 text-muted">
              The load bearing assertions are mutation tested. Breaking Python&apos;s
              banker&apos;s rounding, moving a label threshold off{" "}
              <code className="mono text-12 text-ink">0.05</code>, or partitioning on
              the wrong date each make a specific gate fail, which is how the gates
              are known to be doing work.
            </p>
          </div>
          <div className="rounded-xl border border-hairline bg-surface px-4 py-4">
            <h3 className="text-14 font-semibold text-ink">The measurements</h3>
            <p className="mt-2 text-14 text-muted">
              Parquet sizes come from writing real files with the repo&apos;s load
              stage and reading them back with pyarrow. The readability results come
              from pointing four readers at the output of{" "}
              <code className="mono text-12 text-ink">run_etl</code>. The tests matrix
              comes from mutating the repo and running its own tests. Prices come from
              the AWS Price List API with their SKUs and publication dates.
            </p>
          </div>
          <div className="rounded-xl border border-hairline bg-surface px-4 py-4">
            <h3 className="text-14 font-semibold text-ink">What is simulated</h3>
            <p className="mt-2 text-14 text-muted">
              The ninety day lake is a simulation, and it says so wherever it appears.
              The post stream is synthetic and seeded. Task durations are modelled. A
              failing load is modelled as failing after its object has landed, which
              is the case a retry makes worse, so the duplication reported is an upper
              bound rather than a typical value.
            </p>
            <p className="mt-2 text-14 text-muted">
              What is not simulated: the transform arithmetic, the object keys, the
              partition paths, the sentiment scores, the payload sizes and the
              Parquet bytes. Those are the repo&apos;s, or measured from it.
            </p>
          </div>
        </div>
      </Section>

      <footer className="mx-auto w-full max-w-[1200px] px-6 pb-20 pt-4">
        <p className="text-14 text-muted">
          Source:{" "}
          <a
            className="text-accent underline decoration-hairline-strong underline-offset-4 hover:decoration-current"
            href="https://github.com/HarshMehta9000/x-data-pipeline-airflow-s3-2026"
          >
            x-data-pipeline-airflow-s3-2026
          </a>
          . The pipeline runs offline in MOCK_MODE, and so does everything on this
          page: no X API call and no AWS call was made to build it.
        </p>
      </footer>
    </main>
  );
}
