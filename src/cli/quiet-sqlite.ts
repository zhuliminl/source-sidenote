// Node 22 flags the built-in node:sqlite as experimental and prints a warning on every run.
// It is stable enough for this tool's simple queries, so that one warning is dropped; every
// other warning still reaches Node's own printer. Imported first by main.ts, before node:sqlite.
const printers = process.listeners("warning");
process.removeAllListeners("warning");
process.on("warning", (warning) => {
  if (
    warning.name === "ExperimentalWarning" &&
    warning.message.includes("SQLite")
  )
    return;
  for (const print of printers) print(warning);
});
