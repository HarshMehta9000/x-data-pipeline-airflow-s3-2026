/*
  Gate 4: every price and every sourced constant carries its provenance, and the
  cost arithmetic is reproduced here independently of lib/cost.ts.
*/
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { Gate } from "./assert.mjs";
import { requireLib, paths } from "./build-lib.mjs";

const require = createRequire(import.meta.url);

export function run() {
  const g = new Gate("gate 4  prices and costs");
  const cost = requireLib("cost.js");
  const prices = require(path.join(paths.webRoot, "data", "prices.json"));
  const references = require(path.join(paths.webRoot, "data", "references.json"));

  const REQUIRED = [
    "s3_standard_storage_gb_month",
    "s3_put_request",
    "s3_get_request",
    "athena_tb_scanned",
  ];

  const isoDate = /^\d{4}-\d{2}-\d{2}$/;

  for (const key of REQUIRED) {
    const p = prices.prices[key];
    g.ok(p !== undefined, `price ${key} is present`);
    if (!p) continue;
    g.ok(typeof p.value === "number" && p.value > 0, `${key} has a positive numeric value`);
    g.ok(typeof p.unit === "string" && p.unit.length > 0, `${key} states its unit`);
    g.ok(typeof p.sku === "string" && p.sku.length > 0, `${key} carries its SKU`);
    g.ok(
      typeof p.source_url === "string" && p.source_url.startsWith("https://"),
      `${key} carries a source url`,
    );
    g.ok(p.region === "us-east-1", `${key} states its region`);
    g.ok(
      typeof p.offer_published === "string" && isoDate.test(p.offer_published.slice(0, 10)),
      `${key} carries the offer publication date`,
    );
    g.ok(
      typeof p.description === "string" && p.description.length > 0,
      `${key} keeps the price list's own description`,
    );
  }

  g.ok(isoDate.test(prices.fetched_at), "the price file records when it was fetched");
  g.ok(
    prices.note.includes("lower bound"),
    "the price file states that the Athena figure is a lower bound",
  );

  // The specific values, so a silent edit to the data file fails here.
  g.eq(prices.prices.s3_standard_storage_gb_month.value, 0.023, "S3 standard storage is 0.023 per GB-month");
  g.eq(prices.prices.s3_put_request.value, 0.000005, "a PUT is 0.000005");
  g.eq(prices.prices.athena_tb_scanned.value, 5, "Athena is 5.00 per TB scanned");

  for (const [key, ref] of Object.entries(references.references)) {
    g.ok(typeof ref.statement === "string" && ref.statement.length > 0, `reference ${key} states its claim`);
    g.ok(typeof ref.source === "string" && ref.source.length > 0, `reference ${key} names its source`);
    g.ok(
      typeof ref.url === "string" && ref.url.startsWith("https://"),
      `reference ${key} carries a url`,
    );
    g.ok(isoDate.test(ref.checked), `reference ${key} records when it was checked`);
  }

  // The Airflow reference must not claim a number, because the docs give none.
  g.eq(
    references.references.airflow_xcom_guidance.value,
    null,
    "no numeric XCom ceiling is attributed to Airflow",
  );
  g.ok(
    references.references.mysql_blob_bytes.caveat.includes("not a statement about every deployment"),
    "the MySQL figure is qualified rather than presented as Airflow's limit",
  );
  g.eq(references.references.mysql_blob_bytes.value, 65535, "a MySQL BLOB holds 65,535 bytes");

  /* ---- the arithmetic, done again by hand ------------------------------ */
  const cases = [
    { bytes: 1_400_000, putRequests: 180, scanBytesPerQuery: 1_400_000, queriesPerMonth: 1000 },
    { bytes: 0, putRequests: 0, scanBytesPerQuery: 0, queriesPerMonth: 1000 },
    { bytes: 987_654_321, putRequests: 12_345, scanBytesPerQuery: 12_345_678, queriesPerMonth: 30 },
    { bytes: 5e9, putRequests: 1, scanBytesPerQuery: 5e9, queriesPerMonth: 1 },
  ];

  for (const c of cases) {
    const got = cost.computeCost(c);
    const storage = (c.bytes / 1e9) * 0.023;
    const put = c.putRequests * 0.000005;
    const perQuery = (c.scanBytesPerQuery / 1e12) * 5;
    const query = perQuery * c.queriesPerMonth;

    const tag = `cost(${c.bytes} B, ${c.putRequests} PUT, ${c.scanBytesPerQuery} B scanned)`;
    g.close(got.storageUsd, storage, 1e-12, `${tag}: storage`);
    g.close(got.putUsd, put, 1e-12, `${tag}: PUT`);
    g.close(got.perQueryUsd, perQuery, 1e-12, `${tag}: per query`);
    g.close(got.queryUsd, query, 1e-12, `${tag}: queries`);
    g.close(got.totalUsd, storage + put + query, 1e-12, `${tag}: total`);
    g.close(got.gb, c.bytes / 1e9, 1e-12, `${tag}: GB`);
  }

  // Formatting never rounds a real cost away to zero.
  g.eq(cost.usd(0), "$0.00", "zero formats as $0.00");
  g.ok(cost.usd(0.00004).startsWith("$0.0000"), "a tiny cost keeps four decimals");
  g.ok(!cost.usd(0.00004).includes("NaN"), "and is a number");
  g.eq(cost.usd(12.5), "$12.50", "a dollar cost keeps two decimals");

  // The page's stated query assumption exists in the source it is stated from.
  const e5 = fs.readFileSync(path.join(paths.webRoot, "components", "E5Lake.tsx"), "utf8");
  g.ok(
    /QUERIES_PER_MONTH\s*=\s*1000/.test(e5),
    "the queries per month assumption is a named constant",
  );
  g.ok(
    e5.includes("the assumption, stated"),
    "and the page labels it as an assumption",
  );

  return g.report();
}
