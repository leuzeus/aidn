#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { detectStructureProfile } from "./structure-profile-lib.mjs";

function parseArgs(argv) {
  const args = {
    target: ".",
    json: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--target") {
      args.target = argv[i + 1] ?? "";
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

  if (!args.target) {
    throw new Error("Missing value for --target");
  }
  return args;
}

function printUsage() {
  console.log("Usage:");
  console.log("  node tools/perf/structure-profile.mjs --target ../client-repo");
  console.log("  node tools/perf/structure-profile.mjs --target ../client-repo --json");
}

function main() {
  try {
    const args = parseArgs(process.argv.slice(2));
    const targetRoot = path.resolve(process.cwd(), args.target);
    const auditRoot = path.join(targetRoot, "docs", "audit");
    if (!fs.existsSync(auditRoot)) {
      throw new Error(`Missing audit root: ${auditRoot}`);
    }

    const profile = detectStructureProfile(auditRoot);
    const output = {
      ts: new Date().toISOString(),
      target_root: targetRoot,
      audit_root: auditRoot,
      profile,
    };

    if (args.json) {
      console.log(JSON.stringify(output, null, 2));
      return;
    }

    console.log(`Target: ${targetRoot}`);
    console.log(`Structure profile: ${profile.kind} (confidence=${profile.confidence})`);
    console.log(`Declared workflow_version: ${profile.declared_workflow_version ?? "n/a"}`);
    console.log(`Observed version hint: ${profile.observed_version_hint}`);
    console.log(`Required artifacts policy: ${profile.recommended_required_artifacts.join(", ")}`);
    if (profile.notes.length > 0) {
      console.log("Notes:");
      for (const note of profile.notes) {
        console.log(`- ${note}`);
      }
    }
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    printUsage();
    process.exit(1);
  }
}

main();
