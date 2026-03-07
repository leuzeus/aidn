#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeHookPayload } from "../../src/application/codex/normalize-hook-payload.mjs";

function parseArgs(argv) {
  const args = {
    inputFile: "",
    skill: "",
    mode: "",
    stateMode: "",
    strictRequested: false,
    command: "",
    json: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--in") {
      args.inputFile = argv[i + 1] ?? "";
      i += 1;
    } else if (token === "--skill") {
      args.skill = argv[i + 1] ?? "";
      i += 1;
    } else if (token === "--mode") {
      args.mode = argv[i + 1] ?? "";
      i += 1;
    } else if (token === "--state-mode") {
      args.stateMode = argv[i + 1] ?? "";
      i += 1;
    } else if (token === "--strict-requested") {
      args.strictRequested = true;
    } else if (token === "--command") {
      args.command = argv[i + 1] ?? "";
      i += 1;
    } else if (token === "--json") {
      args.json = true;
    } else if (token === "--help" || token === "-h") {
      printUsage();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${token}`);
    }
  }
  if (!args.inputFile) {
    throw new Error("Missing value for --in");
  }
  return args;
}

function printUsage() {
  console.log("Usage:");
  console.log("  npx aidn codex normalize-hook-payload --in .aidn/runtime/context/raw/context-reload-latest.json --json");
}

function main() {
  try {
    const args = parseArgs(process.argv.slice(2));
    const absolute = path.resolve(process.cwd(), args.inputFile);
    if (!fs.existsSync(absolute)) {
      throw new Error(`Input file not found: ${absolute}`);
    }
    const raw = JSON.parse(fs.readFileSync(absolute, "utf8"));
    const normalized = normalizeHookPayload(raw, {
      skill: args.skill || undefined,
      mode: args.mode || undefined,
      stateMode: args.stateMode || undefined,
      strictRequested: args.strictRequested,
      command: args.command || undefined,
    });
    if (args.json) {
      console.log(JSON.stringify(normalized, null, 2));
    } else {
      console.log(`ok=${normalized.ok} skill=${normalized.skill} mode=${normalized.mode} decision=${normalized.decision ?? "n/a"} action=${normalized.action ?? "n/a"}`);
    }
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    printUsage();
    process.exit(1);
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main();
}

