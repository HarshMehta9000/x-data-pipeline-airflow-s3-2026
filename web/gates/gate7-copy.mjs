/*
  Gate 7: the copy obeys the rules the page is written under.

  No em or en dashes anywhere, no AI attribution anywhere, no secret in any
  tracked file, and every number the page states as a headline is one the other
  gates have already re-derived.
*/
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { Gate } from "./assert.mjs";
import { requireLib, paths } from "./build-lib.mjs";
import { REPO_ROOT } from "./python.mjs";

const require = createRequire(import.meta.url);

const SKIP_DIRS = new Set([
  "node_modules",
  ".next",
  ".git",
  "tmp",
  ".venv",
  "out",
  "__pycache__",
]);

function walk(dir, acc = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      walk(path.join(dir, entry.name), acc);
    } else {
      acc.push(path.join(dir, entry.name));
    }
  }
  return acc;
}

// The lexicon is a third party data file and its contents are not this page's
// prose, so it is checked for secrets but not for typography.
const DATA_EXCEPTIONS = new Set(["vader-lexicon.json"]);

export function run() {
  const g = new Gate("gate 7  copy, typography and hygiene");

  /*
    The detector holds the patterns it searches for, so scanning itself would
    always fail. Excluded by name, and only this file.
  */
  const files = walk(paths.webRoot).filter(
    (f) => /\.(tsx?|mjs|css|md|json|py)$/.test(f) && path.basename(f) !== "gate7-copy.mjs",
  );
  g.ok(files.length > 20, `found ${files.length} files to check`);

  /* ---- no em or en dashes --------------------------------------------- */
  const DASHES = /[‒–—―]/;
  for (const file of files) {
    if (DATA_EXCEPTIONS.has(path.basename(file))) continue;
    const source = fs.readFileSync(file, "utf8");
    const line = source.split("\n").findIndex((l) => DASHES.test(l));
    g.ok(
      line === -1,
      `${path.relative(paths.webRoot, file)} has no em or en dashes`,
      line === -1 ? "" : `line ${line + 1}: ${source.split("\n")[line].trim().slice(0, 80)}`,
    );
  }

  /* ---- no AI attribution ---------------------------------------------- */
  const ATTRIBUTION = [
    /co-authored-by:\s*claude/i,
    /generated with .{0,20}claude/i,
    /\banthropic\b/i,
    /🤖/u,
    /as an ai\b/i,
  ];
  for (const file of files) {
    if (DATA_EXCEPTIONS.has(path.basename(file))) continue;
    const source = fs.readFileSync(file, "utf8");
    for (const pattern of ATTRIBUTION) {
      g.ok(
        !pattern.test(source),
        `${path.relative(paths.webRoot, file)} carries no AI attribution (${pattern})`,
      );
    }
  }

  /* ---- no secrets ------------------------------------------------------ */
  const SECRETS = [/ghp_[A-Za-z0-9]{16,}/, /sk-[A-Za-z0-9]{16,}/, /vcp_[A-Za-z0-9]{16,}/, /AKIA[0-9A-Z]{12,}/];
  for (const file of [...files, ...walk(path.join(REPO_ROOT, "pipeline")), ...walk(path.join(REPO_ROOT, "dags"))]) {
    const source = fs.readFileSync(file, "utf8");
    for (const pattern of SECRETS) {
      g.ok(!pattern.test(source), `${path.basename(file)} holds no secret matching ${pattern}`);
    }
  }

  /* ---- headline numbers on the page are the computed ones -------------- */
  const page = fs.readFileSync(path.join(paths.webRoot, "app", "page.tsx"), "utf8");

  // The page states an assertion count in prose. It has to be the real one.
  const claimed = /([\d,]+) assertions/.exec(page);
  g.ok(claimed !== null, "the page states how many parity assertions there are");
  if (claimed) {
    const stated = Number(claimed[1].replace(/,/g, ""));
    const actual = Number(process.env.XDP_GATE1_COUNT ?? "0");
    if (actual > 0) {
      g.eq(stated, actual, "the stated parity assertion count is the one gate 1 ran");
    }
  }

  /* ---- the matrix the page renders is the measured one ----------------- */
  const matrix = require(path.join(paths.webRoot, "data", "tests-matrix.json"));
  g.ok(matrix.baseline_all_pass, "the tests matrix was drawn from a green baseline");
  g.eq(matrix.tests.length, 4, "the matrix covers all four tests");
  g.eq(
    matrix.summary.detected,
    matrix.rows.filter((r) => r.detected).length,
    "the matrix summary matches its rows",
  );
  g.eq(
    matrix.summary.changed_output_but_undetected,
    matrix.rows.filter((r) => r.detected === false && r.changes_offline_output).length,
    "the count of undetected but output changing mutations matches its rows",
  );
  for (const row of matrix.rows) {
    g.ok(row.applied, `mutation ${row.id} actually applied to the source`);
    g.eq(
      Object.keys(row.results).length,
      4,
      `mutation ${row.id} was run against all four tests`,
    );
  }

  /* ---- generated media matches the copy it quotes ---------------------- */
  /*
    On a previous build the media was generated in parallel with the page and
    carried a headline the copy had already moved past. The card draws its
    headline in two lines, so both have to still be in page.tsx.
  */
  const card = fs.readFileSync(path.join(paths.webRoot, "media", "card.mjs"), "utf8");
  for (const line of ["Every run is green.", "The data is wrong."]) {
    g.ok(card.includes(line), `the social card draws "${line}"`);
    g.ok(page.includes(line), `and page.tsx still says "${line}"`);
  }

  const publicDir = path.join(paths.webRoot, "public");
  if (fs.existsSync(path.join(publicDir, "og.png"))) {
    const layout = fs.readFileSync(path.join(paths.webRoot, "app", "layout.tsx"), "utf8");
    g.ok(layout.includes("/og.png"), "the card is referenced as the Open Graph image");
    g.ok(layout.includes("metadataBase"), "metadataBase is set, so it does not resolve to localhost");
    const gif = path.join(publicDir, "hero.gif");
    if (fs.existsSync(gif)) {
      const mb = fs.statSync(gif).size / 1e6;
      g.ok(mb < 5, `hero.gif is ${mb.toFixed(2)} MB, small enough for a README`);
      const readme = fs.readFileSync(path.join(paths.webRoot, "README.md"), "utf8");
      g.ok(readme.includes("hero.gif"), "the README leads with the GIF");
      const firstProse = readme.indexOf("## What it is");
      g.ok(
        readme.indexOf("hero.gif") < firstProse,
        "and the GIF comes before the prose",
      );
    }
  }

  /* ---- claims that must stay hedged ------------------------------------ */
  const componentDir = path.join(paths.webRoot, "components");
  const all = fs
    .readdirSync(componentDir)
    .map((f) => fs.readFileSync(path.join(componentDir, f), "utf8"))
    .join("\n") + page;

  g.ok(
    /upper bound/.test(all),
    "the page says the duplication figure is an upper bound",
  );
  g.ok(
    /simulat/i.test(all),
    "the page says the ninety day lake is simulated",
  );
  g.ok(
    !/\bAthena (fails|refuses|cannot read)\b/i.test(all),
    "the page does not claim a result for Athena, which was never run",
  );
  g.ok(
    !/\bSpark\b/i.test(all),
    "the page does not claim a result for Spark, which was never run",
  );

  return g.report();
}
