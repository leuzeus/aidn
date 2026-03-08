#!/usr/bin/env node
import path from "node:path";
import { createHookContextStoreAdapter } from "../../src/adapters/codex/hook-context-store-adapter.mjs";
import { runHydrateContextUseCase } from "../../src/application/codex/hydrate-context-use-case.mjs";

function parseArgs(argv) {
  const args = {
    target: ".",
    contextFile: ".aidn/runtime/context/codex-context.json",
    out: ".aidn/runtime/context/hydrated-context.json",
    skill: "",
    historyLimit: 20,
    includeArtifacts: true,
    indexFile: ".aidn/runtime/index/workflow-index.sqlite",
    backend: "auto",
    maxArtifactBytes: 4096,
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
    } else if (token === "--context-file") {
      args.contextFile = String(argv[i + 1] ?? "").trim();
      i += 1;
    } else if (token === "--out") {
      args.out = String(argv[i + 1] ?? "").trim();
      i += 1;
    } else if (token === "--skill") {
      args.skill = String(argv[i + 1] ?? "").trim();
      i += 1;
    } else if (token === "--history-limit") {
      args.historyLimit = Number(argv[i + 1] ?? 20);
      i += 1;
    } else if (token === "--index-file") {
      args.indexFile = String(argv[i + 1] ?? "").trim();
      i += 1;
    } else if (token === "--backend") {
      args.backend = String(argv[i + 1] ?? "").trim().toLowerCase();
      i += 1;
    } else if (token === "--max-artifact-bytes") {
      args.maxArtifactBytes = Number(argv[i + 1] ?? 4096);
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
    } else if (token === "--no-artifacts") {
      args.includeArtifacts = false;
    } else if (token === "--json") {
      args.json = true;
    } else if (token === "--help" || token === "-h") {
      printUsage();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${token}`);
    }
  }
  if (!args.target) {
    throw new Error("Missing value for --target");
  }
  if (!args.contextFile) {
    throw new Error("Missing value for --context-file");
  }
  if (!Number.isFinite(args.historyLimit) || args.historyLimit < 1) {
    throw new Error("Invalid --history-limit. Expected a positive integer.");
  }
  if (!["auto", "json", "sqlite"].includes(args.backend)) {
    throw new Error("Invalid --backend. Expected auto|json|sqlite");
  }
  if (!Number.isFinite(args.maxArtifactBytes) || args.maxArtifactBytes < 128) {
    throw new Error("Invalid --max-artifact-bytes. Expected at least 128.");
  }
  if (!Number.isFinite(args.minRelationConfidence) || args.minRelationConfidence < 0 || args.minRelationConfidence > 1) {
    throw new Error("Invalid --min-relation-confidence. Expected a number between 0 and 1.");
  }
  return args;
}

function printUsage() {
  console.log("Usage:");
  console.log("  npx aidn codex hydrate-context --target . --json");
  console.log("  npx aidn codex hydrate-context --target . --skill context-reload --history-limit 10");
  console.log("  npx aidn codex hydrate-context --target . --relation-threshold attached_cycle=0.35 --allow-ambiguous-links --json");
}

function main() {
  try {
    const args = parseArgs(process.argv.slice(2));
    const hookContextStore = createHookContextStoreAdapter();
    const targetRoot = path.resolve(process.cwd(), args.target);
    const hydrated = runHydrateContextUseCase({
      args,
      hookContextStore,
      targetRoot,
    });

    if (args.json) {
      console.log(JSON.stringify(hydrated, null, 2));
    } else {
      console.log(`Hydrated context: state_mode=${hydrated.state_mode} history=${hydrated.recent_history.length} artifacts=${hydrated.artifacts.length}`);
      if (hydrated.output_file) {
        console.log(`Output: ${hydrated.output_file}`);
      }
    }
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    printUsage();
    process.exit(1);
  }
}

main();
