/*
  Mutation testing for the gates themselves.

  A test that passes under both the right and the wrong implementation is not a
  test. Each entry below breaks one load bearing thing on purpose, asserts that
  a specific gate fails, and restores the file. Run with `npm run mutate`.

  Nothing here is left behind: every mutation is applied to a file that is
  restored from memory in a finally block, and the run ends by asserting the
  whole suite is green again.
*/
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(here, "..");
const repoRoot = path.resolve(webRoot, "..");

const MUTATIONS = [
  {
    name: "python rounding becomes half away from zero",
    file: "web/lib/pyround.ts",
    from: "else if (twice === den && q % 2n === 1n) q += 1n; // exact tie: round half to even",
    to: "else if (twice === den) q += 1n;",
    expect: "gate 1",
  },
  {
    name: "the label threshold moves off 0.05",
    file: "web/lib/pipeline.ts",
    from: 'if (score >= 0.05) return "positive";',
    to: 'if (score > 0.05) return "positive";',
    expect: "gate 1",
  },
  {
    name: "the partition uses the wrong month",
    file: "web/lib/pipeline.ts",
    from: "  const m = pad(runDt.getUTCMonth() + 1);\n  const d = pad(runDt.getUTCDate());\n  return `${prefix}/posts/year=${pad(y, 4)}/month=${m}/day=${d}`;",
    to: "  const m = pad(runDt.getUTCMonth() + 2);\n  const d = pad(runDt.getUTCDate());\n  return `${prefix}/posts/year=${pad(y, 4)}/month=${m}/day=${d}`;",
    expect: "gate 1",
  },
  {
    name: "the object key loses its timestamp",
    file: "web/lib/pipeline.ts",
    from: "    posts_key: `${partitionPath(prefix, runDt)}/posts_${ts}.parquet`,",
    to: "    posts_key: `${partitionPath(prefix, runDt)}/posts.parquet`,",
    expect: "gate 1",
  },
  {
    name: "VADER stops halving the clause before but",
    file: "web/lib/vader.ts",
    from: "      sentiments.splice(si, 0, sentiment * 0.5);",
    to: "      sentiments.splice(si, 0, sentiment * 0.6);",
    expect: "gate 6",
  },
  {
    name: "VADER's punctuation amplifier changes",
    file: "web/lib/vader.ts",
    from: "  return count * 0.292;",
    to: "  return count * 0.3;",
    expect: "gate 6",
  },
  {
    name: "the DAG's retries change",
    file: "dags/x_data_pipeline.py",
    from: '"retries": 2,',
    to: '"retries": 3,',
    expect: "gate 2",
  },
  {
    name: "catchup is turned on",
    file: "dags/x_data_pipeline.py",
    from: "catchup=False,",
    to: "catchup=True,",
    expect: "gate 2",
  },
  {
    name: "a lexicon word is added",
    file: "pipeline/transform.py",
    from: '    "fail", "disaster", "angry", "wrong", "problem", "delay",',
    to: '    "fail", "disaster", "angry", "wrong", "problem", "delay", "delayed",',
    expect: "gate 2",
  },
  {
    name: "load starts partitioning on the event date",
    file: "pipeline/load.py",
    from: '        f"year={run_dt:%Y}/month={run_dt:%m}/day={run_dt:%d}"',
    to: '        f"year={run_dt:%Y}/month={run_dt:%m}/day=01"',
    expect: "gate 2",
  },
  {
    name: "the simulation double counts a replaced object",
    file: "web/lib/sim.ts",
    from: "      rowsInLake += o.rows;",
    to: "      rowsInLake += o.rows * o.writes;",
    expect: "gate 3",
  },
  {
    name: "the watermark advances even when a run fails",
    file: "web/lib/sim.ts",
    from: "    if (!runFailed) watermarkMs = windowEndMs;",
    to: "    watermarkMs = windowEndMs;",
    expect: "gate 3",
  },
  {
    name: "the deterministic key stops being deterministic",
    file: "web/lib/sim.ts",
    from: '        ? "posts.parquet"',
    to: '        ? `posts_${runIdx}.parquet`',
    expect: "gate 3",
  },
  {
    name: "a price is quietly edited",
    file: "web/data/prices.json",
    from: '"value": 0.023,',
    to: '"value": 0.05,',
    expect: "gate 4",
  },
  {
    name: "a measured parquet size is edited",
    file: "web/data/parquet-bytes.json",
    from: '"bytes": 11331',
    to: '"bytes": 11999',
    expect: "gate 5",
  },
  {
    name: "an em dash appears in the copy",
    file: "web/app/page.tsx",
    from: "Every run is green. The data is wrong.",
    // Built at runtime: a literal one here would be found by the very check
    // this mutation exists to exercise.
    to: `Every run is green ${String.fromCharCode(8212)} the data is wrong.`,
    expect: "gate 7",
  },
];

function runGates() {
  try {
    const out = execFileSync(process.execPath, [path.join(here, "run-all.mjs")], {
      cwd: webRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { passed: true, out };
  } catch (err) {
    return { passed: false, out: `${err.stdout ?? ""}${err.stderr ?? ""}` };
  }
}

console.log("Baseline");
const baseline = runGates();
if (!baseline.passed) {
  console.error("The gates are not green before mutating. Fix that first.\n", baseline.out);
  process.exit(1);
}
console.log(`  ${baseline.out.trim().split("\n").pop()}\n`);

let survived = 0;
for (const m of MUTATIONS) {
  const target = path.join(repoRoot, m.file);
  const original = fs.readFileSync(target, "utf8");
  if (!original.includes(m.from)) {
    console.log(`  SKIP    ${m.name}: pattern not found in ${m.file}`);
    survived += 1;
    continue;
  }
  try {
    fs.writeFileSync(target, original.replace(m.from, m.to));
    const result = runGates();
    if (result.passed) {
      console.log(`  SURVIVED ${m.name}  (expected ${m.expect} to fail)`);
      survived += 1;
    } else {
      const failing = [...result.out.matchAll(/FAIL {2}(gate \d)/g)].map((x) => x[1]);
      const hit = failing.includes(m.expect);
      console.log(
        `  ${hit ? "caught  " : "WRONG GATE"} ${m.name}  ->  ${failing.join(", ") || "build error"}`,
      );
      if (!hit) survived += 1;
    }
  } finally {
    fs.writeFileSync(target, original);
  }
}

console.log("\nRestored");
const after = runGates();
if (!after.passed) {
  console.error("The gates are not green after restoring. Something was left behind.");
  process.exit(1);
}
console.log(`  ${after.out.trim().split("\n").pop()}`);

console.log(
  `\n${survived === 0 ? "ALL MUTATIONS CAUGHT" : `${survived} MUTATION(S) SURVIVED`}: ${MUTATIONS.length} tested\n`,
);
process.exit(survived === 0 ? 0 : 1);
