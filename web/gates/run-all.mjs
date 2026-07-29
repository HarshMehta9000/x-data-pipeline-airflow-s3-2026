import { pythonAvailable, PYTHON } from "./python.mjs";

const GATES = [
  "./gate1-parity.mjs",
  "./gate2-findings.mjs",
  "./gate3-simulation.mjs",
  "./gate4-costs.mjs",
  "./gate5-parquet.mjs",
  "./gate6-vader.mjs",
  "./gate7-copy.mjs",
];

if (!pythonAvailable()) {
  console.error(`No interpreter at ${PYTHON}. Set XDP_PYTHON or create the venv.`);
  process.exit(1);
}

const results = [];
for (const spec of GATES) {
  let mod;
  try {
    mod = await import(spec);
  } catch (err) {
    if (err?.code === "ERR_MODULE_NOT_FOUND" && String(err.message).includes(spec.slice(2))) {
      continue; // gate not written yet
    }
    throw err;
  }
  results.push(mod.run());
}

const total = results.reduce((a, r) => a + r.count, 0);
const failed = results.reduce((a, r) => a + r.failed, 0);
console.log(
  `\n${failed === 0 ? "ALL GATES PASS" : "GATES FAILED"}: ${total} assertions, ${failed} failed\n`,
);
process.exit(failed === 0 ? 0 : 1);
