/* A tiny assertion harness. Counts every check so the gate can report how many
   assertions actually ran, and fails loudly with the first few diffs rather
   than a wall of them. */

export class Gate {
  constructor(name) {
    this.name = name;
    this.count = 0;
    this.failures = [];
  }

  ok(cond, message, detail) {
    this.count += 1;
    if (!cond) this.failures.push({ message, detail });
    return cond;
  }

  eq(actual, expected, message) {
    return this.ok(
      Object.is(actual, expected) || actual === expected,
      message,
      `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    );
  }

  deepEq(actual, expected, message) {
    const a = JSON.stringify(actual);
    const e = JSON.stringify(expected);
    return this.ok(a === e, message, `expected ${e}, got ${a}`);
  }

  close(actual, expected, tol, message) {
    const d = Math.abs(actual - expected);
    return this.ok(
      d <= tol,
      message,
      `expected ${expected} +/- ${tol}, got ${actual} (delta ${d})`,
    );
  }

  report() {
    const failed = this.failures.length;
    if (failed === 0) {
      console.log(`  PASS  ${this.name}: ${this.count} assertions`);
      return { name: this.name, count: this.count, failed: 0 };
    }
    console.log(`  FAIL  ${this.name}: ${failed} of ${this.count} assertions failed`);
    for (const f of this.failures.slice(0, 12)) {
      console.log(`        - ${f.message}`);
      if (f.detail) console.log(`          ${f.detail}`);
    }
    if (failed > 12) console.log(`        ... and ${failed - 12} more`);
    return { name: this.name, count: this.count, failed };
  }
}
