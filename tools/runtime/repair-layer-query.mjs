#!/usr/bin/env node
import path from "node:path";
import { runRepairLayerQueryUseCase } from "../../src/application/runtime/repair-layer-query-use-case.mjs";

function parseArgs(argv) {
  const args = {
    target: ".",
    indexFile: ".aidn/runtime/index/workflow-index.sqlite",
    backend: "auto",
    query: "baseline-context",
    sessionId: "",
    cycleId: "",
    minRelationConfidence: 0.65,
    relationThresholds: {},
    allowAmbiguousLinks: false,
    json: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--target") {
      args.target = String(argv[i + 1] ?? "").trim();
      i += 1;
    } else if (token === "--index-file") {
      args.indexFile = String(argv[i + 1] ?? "").trim();
      i += 1;
    } else if (token === "--backend") {
      args.backend = String(argv[i + 1] ?? "").trim().toLowerCase();
      i += 1;
    } else if (token === "--query") {
      args.query = String(argv[i + 1] ?? "").trim().toLowerCase();
      i += 1;
    } else if (token === "--session-id") {
      args.sessionId = String(argv[i + 1] ?? "").trim();
      i += 1;
    } else if (token === "--cycle-id") {
      args.cycleId = String(argv[i + 1] ?? "").trim();
      i += 1;
    } else if (token === "--min-relation-confidence") {
      args.minRelationConfidence = Number(argv[i + 1] ?? 0.65);
      i += 1;
    } else if (token === "--relation-threshold") {
      const raw = String(argv[i + 1] ?? "").trim();
      i += 1;
      const [relationType, value] = raw.split("=", 2);
      const key = String(relationType ?? "").trim();
      const n = Number(value);
      if (!key || !Number.isFinite(n) || n < 0 || n > 1) {
        throw new Error("Invalid --relation-threshold. Expected relation=value with value between 0 and 1.");
      }
      args.relationThresholds[key] = n;
    } else if (token === "--allow-ambiguous-links") {
      args.allowAmbiguousLinks = true;
    } else if (token === "--json") {
      args.json = true;
    } else if (token === "--help" || token === "-h") {
      printUsage();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${token}`);
    }
  }

  if (!["auto", "json", "sqlite", "postgres"].includes(args.backend)) {
    throw new Error("Invalid --backend. Expected auto|json|sqlite|postgres");
  }
  if (![
    "relevant-cycles-for-session",
    "relevant-sessions-for-cycle",
    "baseline-context",
    "snapshot-context",
    "session-continuity",
  ].includes(args.query)) {
    throw new Error("Invalid --query.");
  }
  if (args.query === "relevant-cycles-for-session" && !args.sessionId) {
    throw new Error("Missing --session-id for query relevant-cycles-for-session");
  }
  if (args.query === "session-continuity" && !args.sessionId) {
    throw new Error("Missing --session-id for query session-continuity");
  }
  if (args.query === "relevant-sessions-for-cycle" && !args.cycleId) {
    throw new Error("Missing --cycle-id for query relevant-sessions-for-cycle");
  }
  return args;
}

function printUsage() {
  console.log("Usage:");
  console.log("  node tools/runtime/repair-layer-query.mjs --target . --query baseline-context --json");
  console.log("  node tools/runtime/repair-layer-query.mjs --target . --query relevant-cycles-for-session --session-id S101 --json");
  console.log("  node tools/runtime/repair-layer-query.mjs --target . --query relevant-sessions-for-cycle --cycle-id C101 --allow-ambiguous-links --relation-threshold attached_cycle=0.35 --json");
  console.log("  node tools/runtime/repair-layer-query.mjs --target . --query session-continuity --session-id S102 --json");
}

function printHuman(output) {
  console.log(`Target: ${output.target_root}`);
  console.log(`Query: ${output.query}`);
  console.log(`Backend: ${output.backend}`);
  if (Array.isArray(output.result)) {
    console.log(`Rows: ${output.result.length}`);
  } else {
    console.log(`Artifact: ${output.result?.artifact?.path ?? "n/a"}`);
  }
}

async function main() {
  try {
    const args = parseArgs(process.argv.slice(2));
    const targetRoot = path.resolve(process.cwd(), args.target);
    const output = await runRepairLayerQueryUseCase({ args, targetRoot });
    if (args.json) {
      console.log(JSON.stringify(output, null, 2));
    } else {
      printHuman(output);
    }
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    printUsage();
    process.exit(1);
  }
}

await main();
