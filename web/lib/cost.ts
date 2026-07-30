/*
  The cost model. Four prices, all from the AWS Price List API and all carrying
  their SKU and publication date in data/prices.json, and no arithmetic that the
  gate cannot reproduce.

  The Athena figure answers one specific question, because a cost is meaningless
  without the query it pays for: "give me the posts written on one particular
  day". Under the layout the repo writes, that query cannot prune by the post's
  own date, so it scans the whole posts dataset. Under event date partitioning
  it scans one partition.
*/

import prices from "../data/prices.json";

export const PRICES = prices;

const P = prices.prices;

export interface CostInput {
  /** Total bytes standing in the lake at the end of the period. */
  bytes: number;
  /** Every PUT that landed, including the ones later replaced. */
  putRequests: number;
  /** Bytes an event date query has to scan under this layout. */
  scanBytesPerQuery: number;
  /** How many such queries a month, an assumption the page states. */
  queriesPerMonth: number;
}

export interface CostBreakdown {
  storageUsd: number;
  putUsd: number;
  queryUsd: number;
  totalUsd: number;
  perQueryUsd: number;
  gb: number;
  scanTb: number;
}

export function computeCost(input: CostInput): CostBreakdown {
  const gb = input.bytes / 1e9;
  const storageUsd = gb * P.s3_standard_storage_gb_month.value;
  const putUsd = input.putRequests * P.s3_put_request.value;
  const scanTb = input.scanBytesPerQuery / 1e12;
  const perQueryUsd = scanTb * P.athena_tb_scanned.value;
  const queryUsd = perQueryUsd * input.queriesPerMonth;
  return {
    storageUsd,
    putUsd,
    queryUsd,
    totalUsd: storageUsd + putUsd + queryUsd,
    perQueryUsd,
    gb,
    scanTb,
  };
}

export function usd(v: number): string {
  if (v === 0) return "$0.00";
  if (v < 0.01) return `$${v.toFixed(4)}`;
  if (v < 1) return `$${v.toFixed(3)}`;
  return `$${v.toFixed(2)}`;
}
