#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { listCliEffectPolicies } from "../../src/core/cli/effect-policy.mjs";
import {
  listDispatchableCommandDescriptors,
  validateCommandRegistryDescriptors,
} from "../../src/core/cli/command-registry.mjs";

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
    const effectPolicies = listCliEffectPolicies();
    const descriptors = listDispatchableCommandDescriptors();
    const registryValidation = validateCommandRegistryDescriptors(descriptors);
    const inventoryText = readText(inventoryPath);
    const runtimeAliases = descriptors
      .filter((item) => item.group === "runtime" && item.visibility === "public")
      .map((item) => item.name)
      .sort();
    const publicRegistryCommands = new Set(
      descriptors.filter((item) => item.visibility === "public").map((item) => item.command),
    );
    const policySurfaces = new Set(effectPolicies.map((policy) => policy.surface));
    const registryCommandsWithoutEffects = [...publicRegistryCommands]
      .filter((command) => !policySurfaces.has(command))
      .sort();
    const publicPolicyIds = effectPolicies.map((policy) => policy.id);
    const internalSection = findSection(inventoryText, "## Experimental or internal");
    const stableSection = findSection(inventoryText, "## Stable public command families");
    const repairLayerLineHits = REPAIR_LAYER_COMMANDS.filter((command) => internalSection.some((line) => line.includes(`tools/runtime/${command}.mjs`)));
    const repairLayerLeakHits = REPAIR_LAYER_COMMANDS.filter((command) => stableSection.some((line) => line.includes(`aidn runtime ${command}`)));
    const repairLayerAliasHits = REPAIR_LAYER_COMMANDS.filter((command) => runtimeAliases.includes(command));
    const repairLayerPolicyHits = REPAIR_LAYER_COMMANDS.filter((command) => publicPolicyIds.includes(`runtime-${command}`));

    const checks = {
      inventory_marks_repair_layer_internal: repairLayerLineHits.length === REPAIR_LAYER_COMMANDS.length,
      inventory_does_not_promote_repair_layer: repairLayerLeakHits.length === 0,
      runtime_aliases_do_not_expose_repair_layer: repairLayerAliasHits.length === 0,
      effect_policy_does_not_publish_repair_layer: repairLayerPolicyHits.length === 0,
      dispatch_registry_is_valid: registryValidation.ok,
      public_registry_commands_have_effect_policy:
        registryCommandsWithoutEffects.length === 0,
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
    if (!checks.dispatch_registry_is_valid) {
      issues.push(...registryValidation.issues);
    }
    if (!checks.public_registry_commands_have_effect_policy) {
      issues.push(
        `public registry commands missing effect policy: ${registryCommandsWithoutEffects.join(", ")}`,
      );
    }

    const output = {
      ok: issues.length === 0,
      checks,
      repair_layer_commands: REPAIR_LAYER_COMMANDS,
      inventory_path: inventoryPath,
      registry_path: path.join(repoRoot, "src", "core", "cli", "command-registry.mjs"),
      runtime_commands_checked: runtimeAliases.length,
      public_registry_commands_checked: publicRegistryCommands.size,
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
