"use client";

import { useEffect, useMemo, useState } from "react";
import matrix from "@/data/tests-matrix.json";
import parquet from "@/data/parquet-bytes.json";
import references from "@/data/references.json";
import { normalize, transformPosts } from "@/lib/pipeline";
import { pyJsonBytes } from "@/lib/pyjson";
import { makePostStream, DEFAULT_PARAMS } from "@/lib/sim";
import { Mono, Panel, PanelHead } from "@/components/ui";
import { formatCompact } from "@/components/charts";

const POST_COUNTS = [5, 50, 100, 500, 1000, 5000, 10000];
const BLOB_LIMIT = references.references.mysql_blob_bytes.value as number;

function useXcomGrowth() {
  const [rows, setRows] = useState<{ posts: number; extract: number; transform: number }[]>([]);

  useEffect(() => {
    // Serialising ten thousand posts is real work, so it happens in a frame
    // callback rather than during render.
    const raf = requestAnimationFrame(() => {
      const stream = makePostStream(DEFAULT_PARAMS.startMs, 400, 25, 7);
      const out = POST_COUNTS.map((n) => {
        const posts = stream.slice(0, n).map(normalize);
        return {
          posts: n,
          extract: pyJsonBytes(posts),
          transform: pyJsonBytes(transformPosts(posts)),
        };
      });
      setRows(out);
    });
    return () => cancelAnimationFrame(raf);
  }, []);

  return rows;
}

function bytes(n: number): string {
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)} MB`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)} kB`;
  return `${n} B`;
}

export function E6Diagnostics() {
  const growth = useXcomGrowth();

  const crossing = useMemo(() => {
    const over = growth.find((r) => r.transform > BLOB_LIMIT);
    if (!over) return null;
    const under = [...growth].reverse().find((r) => r.transform <= BLOB_LIMIT);
    if (!under) return over;
    // Linear interpolation between the two measured points.
    const t = (BLOB_LIMIT - under.transform) / (over.transform - under.transform);
    return { posts: Math.round(under.posts + t * (over.posts - under.posts)) };
  }, [growth]);

  const drift = parquet.schema_drift as Record<string, Record<string, string>>;
  const typical = drift.typical_batch as Record<string, string>;
  const driftRows = Object.entries(drift)
    .filter(([name]) => name !== "typical_batch")
    .map(([name, schema]) => ({
      name,
      diffs: Object.entries(schema).filter(([col, type]) => typical[col] !== type),
    }));

  return (
    <div className="space-y-4">
      {/* XCom */}
      <Panel>
        <PanelHead
          title="Every payload travels through the metadata database"
          right={<Mono className="text-faint">finding 4g</Mono>}
        />
        <div className="px-4 py-4">
          <p className="mb-4 max-w-[76ch] text-14 text-muted">
            <Mono className="text-ink">_extract</Mono> pushes the whole list of
            posts and <Mono className="text-ink">_transform</Mono> pushes the whole
            enriched payload plus the summary. These are the real serialised sizes,
            measured with Python&apos;s own JSON rules, not an estimate.
          </p>
          <div className="scroll-x">
            <table className="w-full min-w-[440px] text-12">
              <thead>
                <tr className="border-b border-hairline text-left text-faint">
                  <th className="py-2 pr-3 font-medium">posts in the window</th>
                  <th className="py-2 pr-3 text-right font-medium">after extract</th>
                  <th className="py-2 pr-3 text-right font-medium">after transform</th>
                  <th className="py-2 text-right font-medium">against a BLOB column</th>
                </tr>
              </thead>
              <tbody className="mono">
                {growth.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="py-3 text-faint">
                      measuring
                    </td>
                  </tr>
                ) : (
                  growth.map((r) => {
                    const over = r.transform > BLOB_LIMIT;
                    return (
                      <tr key={r.posts} className="border-b border-hairline last:border-0">
                        <td className="py-2 pr-3 tabular-nums text-ink">
                          {formatCompact(r.posts)}
                        </td>
                        <td className="py-2 pr-3 text-right tabular-nums text-muted">
                          {bytes(r.extract)}
                        </td>
                        <td className="py-2 pr-3 text-right tabular-nums text-ink">
                          {bytes(r.transform)}
                        </td>
                        <td
                          className={`py-2 text-right tabular-nums ${over ? "text-st-failed" : "text-st-success"}`}
                        >
                          {over ? "✕ " : "✓ "}
                          {(r.transform / BLOB_LIMIT).toFixed(over ? 0 : 2)}x
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
          <p className="mt-3 max-w-[76ch] text-12 text-muted">
            {crossing ? (
              <>
                The transform payload passes 65,535 bytes at roughly{" "}
                <span className="tnum text-ink">{crossing.posts.toLocaleString("en-US")}</span>{" "}
                posts.{" "}
              </>
            ) : null}
            Airflow&apos;s documentation gives no numeric ceiling: it says XComs are
            for small amounts of data and that the default backend stores them in
            the metadata database. What actually bounds the payload is that
            database&apos;s column, and a MySQL BLOB holds {BLOB_LIMIT.toLocaleString("en-US")}{" "}
            bytes. On Postgres it will not fail, it will just put the dataset in the
            scheduler&apos;s database. The pattern that avoids the question is to
            push the object key and let the next task read from storage.
          </p>
          <p className="mono mt-2 text-12 text-faint">
            <a
              href={references.references.mysql_blob_bytes.url}
              className="underline decoration-dotted underline-offset-2 hover:text-ink"
              target="_blank"
              rel="noreferrer"
            >
              {references.references.mysql_blob_bytes.source}
            </a>{" "}
            · checked {references.references.mysql_blob_bytes.checked}
          </p>
        </div>
      </Panel>

      {/* schema drift */}
      <Panel>
        <PanelHead
          title="The Parquet schema is whatever the batch happened to contain"
          right={<Mono className="text-faint">finding 4h</Mono>}
        />
        <div className="px-4 py-4">
          <p className="mb-4 max-w-[76ch] text-14 text-muted">
            <Mono className="text-ink">pd.DataFrame(rows)</Mono> infers dtypes per
            batch and no schema is declared anywhere. These are real schemas, read
            back out of files written by the repo&apos;s own load stage.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            {driftRows.map((d) => (
              <div key={d.name} className="rounded-lg border border-hairline bg-surface-2 px-3 py-2.5">
                <p className="mono text-12 text-ink">{d.name.replace(/_/g, " ")}</p>
                {d.diffs.length === 0 ? (
                  <p className="mt-1 text-12 text-muted">same schema as a typical batch</p>
                ) : (
                  d.diffs.map(([col, type]) => (
                    <p key={col} className="mono mt-1 text-12">
                      <span className="text-faint">{col}</span>{" "}
                      <span className="text-muted">{typical[col]}</span>{" "}
                      <span className="text-faint">becomes</span>{" "}
                      <span className="text-st-failed">{type}</span>
                    </p>
                  ))
                )}
              </div>
            ))}
          </div>
          <p className="mt-3 max-w-[76ch] text-12 text-muted">
            A partition whose <Mono className="text-ink">source</Mono> is null
            throughout, or whose batch is missing one engagement count, writes
            different column types than the partition beside it. A reader that spans
            both has to reconcile them, and pyarrow already refuses this dataset for
            a different reason.
          </p>
          <p className="mono mt-2 text-12 text-faint">
            measured {parquet.measured_at} · pandas {parquet.environment.pandas} ·
            pyarrow {parquet.environment.pyarrow}
          </p>
        </div>
      </Panel>

      {/* truncation */}
      <Panel>
        <PanelHead
          title="A config value the pipeline cannot honour"
          right={<Mono className="text-faint">finding 4f</Mono>}
        />
        <div className="px-4 py-4">
          <div className="scroll-x">
            <pre className="mono w-full rounded-lg bg-surface-2 px-3 py-2.5 text-12 text-ink">
{`X_MAX_RESULTS=1000        # accepted by Config without complaint
max_results=min(cfg.x_max_results, 100)   # extract.py, no pagination
→ 100 rows, no warning, no error`}
            </pre>
          </div>
          <p className="mt-3 max-w-[76ch] text-14 text-muted">
            The X API caps a single recent search request at 100 results and
            paginates beyond that. The clamp is correct; the silence is not. Ask for
            a thousand and you get a hundred, and nothing in the run says so.
          </p>
          <p className="mono mt-2 text-12 text-faint">
            <a
              href={references.references.x_api_recent_search_max_results.url}
              className="underline decoration-dotted underline-offset-2 hover:text-ink"
              target="_blank"
              rel="noreferrer"
            >
              {references.references.x_api_recent_search_max_results.source}
            </a>{" "}
            · checked {references.references.x_api_recent_search_max_results.checked}
          </p>
        </div>
      </Panel>

      {/* the matrix */}
      <Panel>
        <PanelHead
          title="What the four tests can see"
          right={<Mono className="text-faint">computed by mutation</Mono>}
        />
        <div className="px-4 py-4">
          <p className="mb-4 max-w-[76ch] text-14 text-muted">
            The tests are not wrong and they are not badly written. The question is
            what they can distinguish. For each finding the repo is copied, the
            change is applied, and all four tests are run against it. A test that
            passes both before and after cannot tell the two apart.
          </p>

          <div className="scroll-x">
            <table className="w-full min-w-[620px] text-12">
              <thead>
                <tr className="border-b border-hairline text-left text-faint">
                  <th className="py-2 pr-3 font-medium">change applied to the repo</th>
                  <th className="py-2 pr-3 font-medium">changes what it writes</th>
                  <th className="py-2 pr-3 text-center font-medium" colSpan={4}>
                    the four tests
                  </th>
                  <th className="py-2 font-medium">noticed</th>
                </tr>
              </thead>
              <tbody>
                {matrix.rows.map((r) => (
                  <tr key={r.id} className="border-b border-hairline last:border-0">
                    <td className="py-2 pr-3">
                      <span className="text-ink">{r.title}</span>
                      <br />
                      <Mono className="text-faint">{r.file}</Mono>
                    </td>
                    <td className="py-2 pr-3">
                      {r.changes_offline_output ? (
                        <span className="text-st-retry">yes</span>
                      ) : (
                        <span className="text-faint">not on this fixture</span>
                      )}
                    </td>
                    {matrix.tests.map((t) => (
                      <td key={t} className="py-2 text-center" title={t}>
                        <span
                          className={
                            (r.results as Record<string, boolean>)[t]
                              ? "text-st-success"
                              : "text-st-failed"
                          }
                        >
                          {(r.results as Record<string, boolean>)[t] ? "✓" : "✕"}
                        </span>
                      </td>
                    ))}
                    <td className="py-2 pl-3">
                      {r.detected ? (
                        <span className="text-st-success">caught</span>
                      ) : (
                        <span className="text-st-failed">no</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="mt-4 max-w-[76ch] text-14 text-muted">
            <span className="tnum text-ink">
              {matrix.summary.detected} of {matrix.summary.mutations}
            </span>{" "}
            changes are noticed by the suite.{" "}
            <span className="tnum text-ink">{matrix.summary.changed_output_but_undetected}</span>{" "}
            of them change what the pipeline writes to disk and every test still
            passes. The other{" "}
            <span className="tnum text-ink">{matrix.summary.no_offline_effect}</span>{" "}
            have no effect on this fixture at all, which is its own result: five
            posts across two days, all with complete metrics, cannot exercise
            deduplication, stemming, pagination or schema inference. Green tests and
            correct data are different claims.
          </p>
          <p className="mono mt-2 text-12 text-faint">
            {matrix.tests.join(" · ")} · measured {matrix.measured_at} ·
            web/python/tests_matrix.py
          </p>
        </div>
      </Panel>
    </div>
  );
}
