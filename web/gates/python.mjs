import { execFileSync } from "node:child_process";
import path from "node:path";
import fs from "node:fs";
import { paths } from "./build-lib.mjs";

/* The repo's own interpreter, with pandas and pyarrow, sitting beside the
   pipeline package it imports. */
export const PYTHON =
  process.env.XDP_PYTHON ?? path.resolve(paths.webRoot, "..", ".venv", "bin", "python");

export const REPO_ROOT = path.resolve(paths.webRoot, "..");

export function pythonAvailable() {
  return fs.existsSync(PYTHON);
}

/** Run a script under python/ and parse its stdout as JSON. */
export function runPythonJson(script, args = []) {
  const out = execFileSync(PYTHON, [path.join(paths.webRoot, "python", script), ...args], {
    cwd: paths.webRoot,
    maxBuffer: 256 * 1024 * 1024,
    encoding: "utf8",
  });
  return JSON.parse(out);
}

/** Run inline Python and parse its stdout as JSON. */
export function pythonEvalJson(code) {
  const out = execFileSync(PYTHON, ["-c", code], {
    cwd: REPO_ROOT,
    maxBuffer: 64 * 1024 * 1024,
    encoding: "utf8",
  });
  return JSON.parse(out);
}
