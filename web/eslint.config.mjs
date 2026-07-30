/*
  Flat config, imported directly.

  eslint-config-next 16 ships real flat configs under its own export map. Going
  through FlatCompat instead makes eslintrc try to validate a flat config as a
  legacy one, which throws "Converting circular structure to JSON" out of the
  config validator before a single file is linted. The compat shim is for
  configs that have not migrated; this one has.
*/
import coreWebVitals from "eslint-config-next/core-web-vitals";
import typescript from "eslint-config-next/typescript";

const config = [
  ...coreWebVitals,
  ...typescript,
  {
    ignores: [
      ".next/**",
      "node_modules/**",
      "public/**",
      "tmp/**",
      "media/out/**",
      "next-env.d.ts",
    ],
  },
];

export default config;
