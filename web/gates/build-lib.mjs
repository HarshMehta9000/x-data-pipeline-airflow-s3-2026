/*
  Node 20 has no --experimental-strip-types, so the gates cannot import the
  site's TypeScript directly. Compile lib/ to CommonJS in tmp/lib once per run
  and require it from the gates through createRequire. The gates then exercise
  exactly the code the browser runs, not a transcription of it.
*/
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";

const here = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(here, "..");
const outDir = path.join(webRoot, "tmp", "lib");

let built = false;

export function buildLib() {
  if (built) return outDir;
  execFileSync(
    process.execPath,
    [
      path.join(webRoot, "node_modules", "typescript", "bin", "tsc"),
      "-p",
      path.join(here, "tsconfig.gate.json"),
    ],
    { stdio: "inherit", cwd: webRoot },
  );
  // CommonJS output under a package.json that has "type" unset by default;
  // pin it so require() cannot be reinterpreted as ESM.
  fs.writeFileSync(
    path.join(webRoot, "tmp", "package.json"),
    JSON.stringify({ type: "commonjs" }),
  );
  built = true;
  return outDir;
}

export function requireLib(name) {
  buildLib();
  const require = createRequire(import.meta.url);
  return require(path.join(outDir, "lib", name));
}

export const paths = { webRoot, outDir };
