#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const MUTATING_SKILLS = [
  "start-session",
  "close-session",
  "cycle-create",
  "cycle-close",
  "promote-baseline",
  "requirements-delta",
  "convert-to-spike",
];

function parseArgs(argv) {
  const args = {
    root: "template/codex",
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
  console.log("  node tools/perf/verify-db-first-sync-coverage.mjs");
  console.log("  node tools/perf/verify-db-first-sync-coverage.mjs --root template/codex --json");
}

function checkSkill(root, skill) {
  const file = path.resolve(process.cwd(), root, skill, "SKILL.md");
  if (!fs.existsSync(file)) {
    return {
      skill,
      file,
      pass: false,
      missing_file: true,
      missing_patterns: [],
    };
  }
  const text = fs.readFileSync(file, "utf8");
  const required = [
    "DB runtime sync (mandatory in dual/db-only; optional in files):",
    "node tools/runtime/sync-db-first-selective.mjs --target . --json",
    "falls back to full sync when needed",
    "node tools/runtime/db-first-artifact.mjs --target . --path <relative-audit-path> --source-file <file> --json",
  ];
  const missing = required.filter((pattern) => !text.includes(pattern));
  return {
    skill,
    file,
    pass: missing.length === 0,
    missing_file: false,
    missing_patterns: missing,
  };
}

function main() {
  try {
    const args = parseArgs(process.argv.slice(2));
    const checks = MUTATING_SKILLS.map((skill) => checkSkill(args.root, skill));
    const pass = checks.every((item) => item.pass === true);
    const output = {
      ts: new Date().toISOString(),
      root: path.resolve(process.cwd(), args.root),
      checks,
      pass,
    };
    if (args.json) {
      console.log(JSON.stringify(output, null, 2));
    } else {
      console.log(`Root: ${output.root}`);
      for (const item of checks) {
        console.log(`${item.pass ? "PASS" : "FAIL"} ${item.skill} -> ${item.file}`);
        if (item.missing_patterns.length > 0) {
          console.log(`  Missing: ${item.missing_patterns.join(" | ")}`);
        }
      }
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
