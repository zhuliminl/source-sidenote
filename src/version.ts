import { readFileSync } from "node:fs";

// dist/version.js -> ../package.json; src/version.ts -> ../package.json (same depth).
export const VERSION: string = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
).version;
