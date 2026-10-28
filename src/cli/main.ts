#!/usr/bin/env node
import { parseArgs } from "node:util";
import { dataDir } from "../infrastructure/paths.js";
import { ApiClient } from "./client.js";
import { commands, usage } from "./commands.js";

async function main() {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: {
      "no-open": { type: "boolean", default: false },
      port: { type: "string" },
      refresh: { type: "boolean", default: false },
      wait: { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
  });
  const [name = "help", ...args] = positionals;
  const command = values.help ? undefined : commands[name];
  if (!command) return console.log(usage);
  const home = dataDir();
  await command({
    home,
    api: new ApiClient(home),
    args,
    flags: {
      open: !values["no-open"],
      port: values.port,
      refresh: values.refresh,
      wait: values.wait,
    },
  });
}

main().catch((e: Error) => {
  console.error(e.message);
  process.exitCode = 1;
});
