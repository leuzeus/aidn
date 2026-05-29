#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { listCliEffectPolicies } from "../../src/core/cli/effect-policy.mjs";

const REPAIR_LAYER_COMMANDS = [
  "repair-layer",
  "repair-layer-query",
  "repair-layer-resolve",
  "repair-layer-triage",
  "repair-layer-autofix",
];

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
  console.log("  node tools/perf/verify-cli-surface-inventory.mjs");
  console.log("  node tools/perf/verify-cli-surface-inventory.mjs --json");
}

function readText(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

function parseRuntimeAliases(binText) {
  const match = binText.match(/const RUNTIME_ALIASES = \{([\s\S]*?)\n\};/);
  if (!match) {
    throw new Error("Unable to parse RUNTIME_ALIASES from bin/aidn.mjs");
  }
  return [...match[1].matchAll(/"([a-z0-9-]+)": \{ file:/g)].map((item) => item[1]).sort();
}

function findSection(text, heading) {
  const lines = String(text).split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim() === heading);
  if (start < 0) {
    return [];
  }
  const out = [];
  for (let i = start + 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (/^##\s+/.test(line) || /^###\s+/.test(line)) {
      break;
    }
    out.push(line);
  }
  return out;
}

function main() {
  try {
    const args = parseArgs(process.argv.slice(2));
    const repoRoot = process.cwd();
    const inventoryPath = path.join(repoRoot, "docs", "CLI_SURFACE_INVENTORY.md");
    const binPath = path.join(repoRoot, "bin", "aidn.mjs");
    const effectPolicies = listCliEffectPolicies();
    const inventoryText = readText(inventoryPath);
    const binText = readText(binPath);
    const runtimeAliases = parseRuntimeAliases(binText);
    const publicPolicyIds = effectPolicies.map((policy) => policy.id);
    const internalSection = findSection(inventoryText, "## Experimental or internal");
    const stableSection = findSection(inventoryText, "## Stable public command families");
    const repairLayerLineHits = REPAIR_LAYER_COMMANDS.filter((command) => internalSection.some((line) => line.includes(`aidn runtime ${command}`)));
    const repairLayerLeakHits = REPAIR_LAYER_COMMANDS.filter((command) => stableSection.some((line) => line.includes(`aidn runtime ${command}`)));
    const repairLayerAliasHits = REPAIR_LAYER_COMMANDS.filter((command) => runtimeAliases.includes(command));
    const repairLayerPolicyHits = REPAIR_LAYER_COMMANDS.filter((command) => publicPolicyIds.includes(`runtime-${command}`));

    const checks = {
      inventory_marks_repair_layer_internal: repairLayerLineHits.length === REPAIR_LAYER_COMMANDS.length,
      inventory_does_not_promote_repair_layer: repairLayerLeakHits.length === 0,
      runtime_aliases_do_not_expose_repair_layer: repairLayerAliasHits.length === 0,
      effect_policy_does_not_publish_repair_layer: repairLayerPolicyHits.length === 0,
    };
    const issues = [];
    if (!checks.inventory_marks_repair_layer_internal) {
      issues.push(`missing internal inventory entries: ${REPAIR_LAYER_COMMANDS.filter((command) => !repairLayerLineHits.includes(command)).join(", ")}`);
    }
    if (!checks.inventory_does_not_promote_repair_layer) {
      issues.push(`repair-layer commands appear in stable public inventory: ${repairLayerLeakHits.join(", ")}`);
    }
    if (!checks.runtime_aliases_do_not_expose_repair_layer) {
      issues.push(`repair-layer commands exposed in bin/aidn runtime aliases: ${repairLayerAliasHits.join(", ")}`);
    }
    if (!checks.effect_policy_does_not_publish_repair_layer) {
      issues.push(`repair-layer commands published in effect policy: ${repairLayerPolicyHits.join(", ")}`);
    }

    const output = {
      ok: issues.length === 0,
      checks,
      repair_layer_commands: REPAIR_LAYER_COMMANDS,
      inventory_path: inventoryPath,
      bin_path: binPath,
      runtime_aliases_checked: runtimeAliases.length,
      issues,
    };

    if (args.json) {
      console.log(JSON.stringify(output, null, 2));
    } else {
      console.log(`CLI surface inventory: ${output.ok ? "PASS" : "FAIL"}`);
      for (const [name, value] of Object.entries(checks)) {
        console.log(`${value ? "PASS" : "FAIL"} ${name}`);
      }
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
