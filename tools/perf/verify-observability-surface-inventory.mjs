#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import {
  OBSERVABILITY_SEPARATION_STATES,
  listObservabilitySurfaceScripts,
  summarizeObservabilitySurface,
} from "../../src/application/observability/observability-surface-inventory.mjs";

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
  console.log("  node tools/perf/verify-observability-surface-inventory.mjs");
  console.log("  node tools/perf/verify-observability-surface-inventory.mjs --json");
}

function listActualPerfSurface(repoRoot) {
  const perfRoot = path.join(repoRoot, "tools", "perf");
  return fs
    .readdirSync(perfRoot, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .filter((name) => /^(render|report)-.*\.mjs$/.test(name))
    .sort();
}

function difference(left, right) {
  const rightSet = new Set(right);
  return left.filter((item) => !rightSet.has(item));
}

function main() {
  try {
    const args = parseArgs(process.argv.slice(2));
    const repoRoot = process.cwd();
    const inventory = listObservabilitySurfaceScripts();
    const inventoryScripts = inventory.map((entry) => entry.script).sort();
    const actualScripts = listActualPerfSurface(repoRoot);
    const duplicateScripts = inventoryScripts.filter((script, index) => inventoryScripts.indexOf(script) !== index);
    const missingFromInventory = difference(actualScripts, inventoryScripts);
    const staleInventoryEntries = difference(inventoryScripts, actualScripts);
    const invalidStates = inventory.filter((entry) => !Object.hasOwn(OBSERVABILITY_SEPARATION_STATES, entry.separation_state));
    const missingTargetUseCases = inventory.filter((entry) => !entry.target_use_case);
    const missingCategories = inventory.filter((entry) => !["render", "report"].includes(entry.category));
    const missingExtractedUseCaseFiles = inventory
      .filter((entry) => entry.separation_state === "wrapper-extracted")
      .filter((entry) => !fs.existsSync(path.join(repoRoot, "src", "application", "observability", `${entry.target_use_case}.mjs`)));
    const repairLayerEntry = inventory.find((entry) => entry.script === "render-repair-layer-triage-summary.mjs");
    const repairLayerUseCaseExists = fs.existsSync(
      path.join(repoRoot, "src", "application", "observability", "repair-layer-triage-summary-use-case.mjs"),
    );
    const summary = summarizeObservabilitySurface(inventory);
    const checks = {
      actual_surface_listed: missingFromInventory.length === 0,
      inventory_entries_exist: staleInventoryEntries.length === 0,
      no_duplicate_scripts: duplicateScripts.length === 0,
      separation_states_registered: invalidStates.length === 0,
      categories_valid: missingCategories.length === 0,
      target_use_cases_named: missingTargetUseCases.length === 0,
      extracted_use_case_files_exist: missingExtractedUseCaseFiles.length === 0,
      repair_layer_triage_extracted: repairLayerEntry?.separation_state === "wrapper-extracted" && repairLayerUseCaseExists,
      extraction_state_accounted_for: summary.extracted_count + summary.remaining_legacy_count === summary.total,
    };
    const pass = Object.values(checks).every((value) => value === true);
    const output = {
      ts: new Date().toISOString(),
      checks,
      summary,
      missing_from_inventory: missingFromInventory,
      stale_inventory_entries: staleInventoryEntries,
      duplicate_scripts: duplicateScripts,
      invalid_states: invalidStates.map((entry) => entry.script),
      missing_target_use_cases: missingTargetUseCases.map((entry) => entry.script),
      missing_extracted_use_case_files: missingExtractedUseCaseFiles.map((entry) => entry.target_use_case),
      invalid_categories: missingCategories.map((entry) => entry.script),
      pass,
    };

    if (args.json) {
      console.log(JSON.stringify(output, null, 2));
    } else {
      console.log(`Observability surface scripts: ${actualScripts.length}`);
      console.log(`Inventory version: ${summary.version}`);
      for (const [name, value] of Object.entries(checks)) {
        console.log(`${value ? "PASS" : "FAIL"} ${name}`);
      }
      console.log(`Extracted: ${summary.extracted_count}`);
      console.log(`Legacy remaining: ${summary.remaining_legacy_count}`);
      console.log(`Result: ${pass ? "PASS" : "FAIL"}`);
    }

    if (!pass) {
      process.exit(1);
    }
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    printUsage();
    process.exit(1);
  }
}

main();
