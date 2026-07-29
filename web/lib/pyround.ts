/*
  Python's round(x, n) is not JavaScript's Math.round(x * 10**n) / 10**n.

  CPython rounds the *exact* binary value of the double to n decimal places,
  breaking exact ties to even. Multiplying by 1e4 first introduces a rounding
  error of its own, and toFixed breaks ties away from zero. Both disagree with
  Python on values that are exactly representable at the tie point, and those
  are reachable here: an average sentiment of exactly 1/32 = 0.03125 rounds to
  0.0312 in Python and 0.0313 in JavaScript.

  So decompose the double into an exact integer mantissa and a power of two,
  scale by 10**n as a rational, and round the quotient half to even.
*/

const buf = new ArrayBuffer(8);
const f64 = new Float64Array(buf);
const u32 = new Uint32Array(buf);

/** Exact decomposition of a finite double into { mantissa, exponent } with value = mantissa * 2**exponent. */
function decompose(x: number): { m: bigint; e: number } {
  f64[0] = x;
  const lo = u32[0] as number;
  const hi = u32[1] as number;
  const rawExp = (hi >>> 20) & 0x7ff;
  const frac = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
  if (rawExp === 0) {
    // Subnormal: no implicit leading bit.
    return { m: frac, e: -1074 };
  }
  return { m: frac | (1n << 52n), e: rawExp - 1075 };
}

function pow10(n: number): bigint {
  let r = 1n;
  for (let i = 0; i < n; i += 1) r *= 10n;
  return r;
}

/**
 * Faithful port of CPython's round(x, ndigits) for finite doubles.
 * Ties are broken to even, on the exact value of x.
 */
export function pyRound(x: number, ndigits: number): number {
  if (!Number.isFinite(x)) return x;
  if (x === 0) return x; // preserves -0 exactly as Python does
  const neg = x < 0;
  const ax = neg ? -x : x;

  const { m, e } = decompose(ax);
  const scale = pow10(ndigits);

  let q: bigint;
  if (e >= 0) {
    q = m * scale * (1n << BigInt(e)); // already an integer, nothing to round
  } else {
    const den = 1n << BigInt(-e);
    const num = m * scale;
    q = num / den;
    const r = num % den;
    const twice = r * 2n;
    if (twice > den) q += 1n;
    else if (twice === den && q % 2n === 1n) q += 1n; // exact tie: round half to even
  }

  const out = Number(q) / Number(scale);
  return neg ? -out : out;
}
