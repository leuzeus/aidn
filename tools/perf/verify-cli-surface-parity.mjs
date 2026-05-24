#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getCliEffectPolicy, listCliEffectPolicies } from "../../src/core/cli/effect-policy.mjs";

function parseArgs(argv) {
  const args = {
    json: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--json") {
      args.json = true;
    } else if (token === "--help" || token === "-h") {
      printUsage();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${token}`);
    }
  }
  return args;
}

function printUsage() {
  console.log("Usage:");
  console.log("  node tools/perf/verify-cli-surface-parity.mjs");
  console.log("  node tools/perf/verify-cli-surface-parity.mjs --json");
}

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

function readText(relativePath) {
  return fs.readFileSync(path.join(REPO_ROOT, relativePath), "utf8");
}

function mustContain(haystack, needle, label, issues) {
  if (!haystack.includes(needle)) {
    issues.push(`${label}: missing "${needle}"`);
  }
}

function mustMatch(regex, text, label, issues) {
  if (!regex.test(text)) {
    issues.push(`${label}: missing ${regex}`);
  }
}

function verifyRuntimeStateSurface(issues) {
  const source = readText("tools/runtime/project-runtime-state.mjs");
  mustContain(source, '"--write"', "project-runtime-state parser", issues);
  mustContain(source, "const shouldWrite = Boolean(write) && !dryRun;", "project-runtime-state write guard", issues);
  if (source.includes("--sync-relay")) {
    issues.push("project-runtime-state: unexpected --sync-relay support");
  }
}

function verifyHandoffPacketSurface(issues) {
  const source = readText("tools/runtime/project-handoff-packet.mjs");
  mustContain(source, '"--write"', "project-handoff-packet parser", issues);
  mustContain(source, '"--sync-relay"', "project-handoff-packet parser", issues);
  mustContain(source, "const shouldSyncRelay = Boolean(syncRelay) && !dryRun;", "project-handoff-packet sync guard", issues);
  mustContain(source, "requested: true", "project-handoff-packet explicit sync result", issues);
  mustContain(source, "requested: Boolean(syncRelay)", "project-handoff-packet not-requested result", issues);
}

function verifyDocsSurface(issues) {
  const inventory = readText("docs/CLI_SURFACE_INVENTORY.md");
  const readme = readText("README.md");
  mustContain(inventory, "aidn runtime project-runtime-state --json` and `--write`", "CLI inventory runtime-state", issues);
  mustContain(inventory, "aidn runtime project-handoff-packet --json`, `--write` for projection writes, and `--sync-relay` for shared relay sync writes", "CLI inventory handoff", issues);
  mustContain(inventory, "Advanced public command families", "CLI inventory advanced classification", issues);
  mustContain(inventory, "aidn runtime shared-coordination-backup --json", "CLI inventory advanced shared coordination", issues);
  mustContain(inventory, "aidn runtime coordinator-dispatch-execute --json", "CLI inventory advanced coordinator", issues);
  mustContain(readme, "pass `--write` explicitly when you want to update Markdown projections and `--sync-relay` when you want to append shared relay state.", "README runtime digest projector guidance", issues);
  mustContain(readme, "stable/advanced/internal classification", "README CLI surface classification", issues);
}

function verifyEffectPolicy(issues) {
  const runtimeState = getCliEffectPolicy("runtime-project-runtime-state");
  const handoffPacket = getCliEffectPolicy("runtime-project-handoff-packet");
  if (!runtimeState) {
    issues.push("effect policy missing runtime-project-runtime-state");
  } else {
    mustContain(runtimeState.command, "project-runtime-state --json", "effect policy runtime-state command", issues);
    mustContain(runtimeState.notes, "--write", "effect policy runtime-state notes", issues);
  }
  if (!handoffPacket) {
    issues.push("effect policy missing runtime-project-handoff-packet");
  } else {
    mustContain(handoffPacket.command, "project-handoff-packet --json", "effect policy handoff command", issues);
    mustContain(handoffPacket.notes, "--sync-relay", "effect policy handoff notes", issues);
  }
  const missingStablePolicies = listCliEffectPolicies().filter((policy) => policy.stability === "stable" && !policy.command.startsWith("aidn "));
  if (missingStablePolicies.length > 0) {
    issues.push(`effect policy has invalid stable commands: ${missingStablePolicies.map((policy) => policy.id).join(", ")}`);
  }
}

function verifyBinUsage(issues) {
  const binText = readText("bin/aidn.mjs");
  mustContain(binText, "aidn runtime project-runtime-state --target . --write --json", "bin usage runtime-state", issues);
  mustContain(binText, "aidn runtime project-handoff-packet --target . --write --sync-relay --json", "bin usage handoff", issues);
}

function verifyContracts(issues) {
  const contract = readText("src/core/contracts/cli-output/runtime-project-handoff-packet.v1.schema.json");
  mustContain(contract, '"sync_relay"', "handoff contract top-level sync_relay", issues);
  mustContain(contract, '"requested"', "handoff contract requested sync flag", issues);
  mustContain(contract, '"shared_coordination_sync"', "handoff contract sync object", issues);
  mustMatch(/"write": \{ "type": "boolean" \}/, contract, "handoff contract write flag", issues);
}

function main() {
  try {
    const args = parseArgs(process.argv.slice(2));
    const issues = [];
    verifyDocsSurface(issues);
    verifyEffectPolicy(issues);
    verifyBinUsage(issues);
    verifyRuntimeStateSurface(issues);
    verifyHandoffPacketSurface(issues);
    verifyContracts(issues);

    const output = {
      ok: issues.length === 0,
      checked_surfaces: 6,
      issues,
    };

    if (args.json) {
      console.log(JSON.stringify(output, null, 2));
    } else {
      console.log(`CLI surface parity: ${output.ok ? "PASS" : "FAIL"}`);
      for (const issue of issues) {
        console.log(`- ${issue}`);
      }
    }

    if (!output.ok) {
      process.exit(1);
    }
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    printUsage();
    process.exit(1);
  }
}

main();
