import { homedir } from "node:os";
import { join } from "node:path";
import { mkdirSync, chmodSync } from "node:fs";
export function dataDir(): string {
  const dir =
    process.env.SIDENOTE_HOME ||
    join(homedir(), ".local", "share", "source-sidenote");
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  chmodSync(dir, 0o700);
  return dir;
}
