#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { detectStructureProfile } from "../../src/lib/workflow/structure-profile-lib.mjs";

const FIXTURES = [
  { name: "legacy", expectedKind: "legacy" },
  { name: "modern", expectedKind: "modern" },
  { name: "mixed", expectedKind: "mixed" },
];

function parseArgs(argv) {
  const args = {
    root: "tests/fixtures/perf-structure",
    json: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--root") {
      args.root = argv[i + 1] ?? "";
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
  if (!args.root) {
    throw new Error("Missing value for --root");
  }
  return args;
}

function printUsage() {
  console.log("Usage:");
  console.log("  node tools/perf/verify-structure-profile-fixtures.mjs");
  console.log("  node tools/perf/verify-structure-profile-fixtures.mjs --root tests/fixtures/perf-structure");
}

function main() {
  try {
    const args = parseArgs(process.argv.slice(2));
    const root = path.resolve(process.cwd(), args.root);
    const checks = [];

    for (const fixture of FIXTURES) {
      const auditRoot = path.join(root, fixture.name, "docs", "audit");
      if (!fs.existsSync(auditRoot)) {
        checks.push({
          fixture: fixture.name,
          expected_kind: fixture.expectedKind,
          actual_kind: null,
          pass: false,
          error: `Missing audit root: ${auditRoot}`,
        });
        continue;
      }
      const profile = detectStructureProfile(auditRoot);
      checks.push({
        fixture: fixture.name,
        expected_kind: fixture.expectedKind,
        actual_kind: profile.kind,
        confidence: profile.confidence,
        pass: profile.kind === fixture.expectedKind,
      });
    }

    const passCount = checks.filter((check) => check.pass).length;
    const output = {
      ts: new Date().toISOString(),
      fixtures_root: root,
      summary: {
        total: checks.length,
        passed: passCount,
        failed: checks.length - passCount,
      },
      checks,
    };

    if (args.json) {
      console.log(JSON.stringify(output, null, 2));
    } else {
      console.log(`Fixtures root: ${root}`);
      console.log(`Passed: ${output.summary.passed}/${output.summary.total}`);
      for (const check of checks) {
        const state = check.pass ? "PASS" : "FAIL";
        console.log(`- ${state} ${check.fixture}: expected=${check.expected_kind} actual=${check.actual_kind ?? "n/a"}${check.error ? ` (${check.error})` : ""}`);
      }
    }

    if (output.summary.failed > 0) {
      process.exit(1);
    }
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    printUsage();
    process.exit(1);
  }
}

main();
