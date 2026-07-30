/*
  XCom payloads are serialised by Airflow with Python's json, so the byte counts
  the page reports have to be Python's byte counts, not JSON.stringify's.

  Three differences matter, and all three change the size:
    - Python's default separators are ", " and ": ", so every element and every
      key costs one extra byte.
    - ensure_ascii=True is the default, so non-ASCII is escaped to \uXXXX and a
      single emoji becomes twelve bytes rather than four.
    - A float that happens to be integral prints as "1.0", not "1".

  The last one needs to know which fields are floats, because JavaScript does
  not distinguish. The pipeline has exactly two: sentiment_score and
  avg_sentiment. gates/gate1-parity.mjs asserts the byte counts match
  json.dumps on the same payloads.
*/

export const FLOAT_KEYS = new Set(["sentiment_score", "avg_sentiment"]);

const ESCAPES: Record<string, string> = {
  '"': '\\"',
  "\\": "\\\\",
  "\n": "\\n",
  "\r": "\\r",
  "\t": "\\t",
  "\b": "\\b",
  "\f": "\\f",
};

function encodeString(s: string): string {
  let out = '"';
  for (const ch of s) {
    const code = ch.codePointAt(0) as number;
    const esc = ESCAPES[ch];
    if (esc !== undefined) {
      out += esc;
    } else if (code < 0x20) {
      out += `\\u${code.toString(16).padStart(4, "0")}`;
    } else if (code < 0x7f) {
      out += ch;
    } else if (code <= 0xffff) {
      out += `\\u${code.toString(16).padStart(4, "0")}`;
    } else {
      // Python escapes astral characters as a UTF-16 surrogate pair.
      const v = code - 0x10000;
      const hi = 0xd800 + (v >> 10);
      const lo = 0xdc00 + (v & 0x3ff);
      out += `\\u${hi.toString(16).padStart(4, "0")}\\u${lo.toString(16).padStart(4, "0")}`;
    }
  }
  return `${out}"`;
}

function encodeNumber(n: number, isFloat: boolean): string {
  if (!isFloat) return String(n);
  // Python's repr of a float keeps the decimal point.
  return Number.isInteger(n) ? `${n}.0` : String(n);
}

/** json.dumps(value) with CPython's defaults. */
export function pyJsonDumps(value: unknown, floatKey = false): string {
  if (value === null || value === undefined) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") return encodeNumber(value, floatKey);
  if (typeof value === "string") return encodeString(value);
  if (Array.isArray(value)) {
    return `[${value.map((v) => pyJsonDumps(v, floatKey)).join(", ")}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>);
  const body = entries
    .map(([k, v]) => `${encodeString(k)}: ${pyJsonDumps(v, FLOAT_KEYS.has(k))}`)
    .join(", ");
  return `{${body}}`;
}

/** UTF-8 byte length of the Python serialisation. */
export function pyJsonBytes(value: unknown): number {
  return new TextEncoder().encode(pyJsonDumps(value)).length;
}
