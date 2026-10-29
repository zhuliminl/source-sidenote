#!/usr/bin/env node
// The entry point stays tiny: the warning filter must be installed before node:sqlite is loaded,
// and static imports would load it first. Everything else lives in run.ts.
import "./quiet-sqlite.js";

await import("./run.js");
