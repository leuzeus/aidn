#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const SKILL_SPECS = [
  "start-session",
  "close-session",
  "branch-cycle-audit",
  "drift-check",
  "handoff-close",
  "cycle-create",
  "cycle-close",
  "promote-baseline",
  "requirements-delta",
  "convert-to-spike",
];

const SHARED_PATTERNS = [
  "## Pre-Write Admission",
  "Before the first durable write in this skill, run:",
  "If `admission_status` is `blocked`, STOP and continue with read-only re-anchor or repair steps only.",
];

function parseArgs(argv) {
  const args = {
    root: "template/codex",
    json: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--root") {
      args.root = String(argv[i + 1] ?? "").trim();
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
  console.log("  node tools/perf/verify-pre-write-admit-skill-coverage.mjs");
  console.log("  node tools/perf/verify-pre-write-admit-skill-coverage.mjs --root template/codex --json");
  console.log("  node tools/perf/verify-pre-write-admit-skill-coverage.mjs --root tests/fixtures/repo-installed-core/.codex/skills --json");
}

function readText(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

function checkSkill(root, skill) {
  const file = path.resolve(process.cwd(), root, skill, "SKILL.md");
  const requiredPatterns = [
    ...SHARED_PATTERNS,
    `npx aidn runtime pre-write-admit --target . --skill ${skill} --json`,
  ];

  if (!fs.existsSync(file)) {
    return {
      skill,
      file,
      pass: false,
      missing_file: true,
      missing_patterns: requiredPatterns,
    };
  }

  const text = readText(file);
  const missingPatterns = requiredPatterns.filter((pattern) => !text.includes(pattern));
  return {
    skill,
    file,
    pass: missingPatterns.length === 0,
    missing_file: false,
    missing_patterns: missingPatterns,
  };
}

function main() {
  try {
    const args = parseArgs(process.argv.slice(2));
    const checks = SKILL_SPECS.map((skill) => checkSkill(args.root, skill));
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
