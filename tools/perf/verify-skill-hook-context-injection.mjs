#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const SKILLS = [
  { name: "context-reload", mode: "<THINKING|EXPLORING|COMMITTING>" },
  { name: "branch-cycle-audit", mode: "COMMITTING" },
  { name: "drift-check", mode: "COMMITTING" },
  { name: "start-session", mode: "<THINKING|EXPLORING|COMMITTING>" },
  { name: "close-session", mode: "<THINKING|EXPLORING|COMMITTING>" },
  { name: "pr-orchestrate", mode: "<THINKING|EXPLORING|COMMITTING>" },
  { name: "cycle-create", mode: "COMMITTING" },
  { name: "cycle-close", mode: "COMMITTING" },
  { name: "handoff-close", mode: "<THINKING|EXPLORING|COMMITTING>" },
  { name: "promote-baseline", mode: "COMMITTING" },
  { name: "requirements-delta", mode: "COMMITTING" },
  { name: "convert-to-spike", mode: "EXPLORING" },
];

function parseArgs(argv) {
  const args = {
    root: "scaffold/codex",
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
  console.log("  node tools/perf/verify-skill-hook-context-injection.mjs");
  console.log("  node tools/perf/verify-skill-hook-context-injection.mjs --root scaffold/codex --json");
}

function checkSkill(root, spec) {
  const file = path.resolve(process.cwd(), root, spec.name, "SKILL.md");
  if (!fs.existsSync(file)) {
    return {
      skill: spec.name,
      file,
      pass: false,
      missing_file: true,
      missing_patterns: [],
      forbidden_patterns: [],
    };
  }
  const text = fs.readFileSync(file, "utf8");
  const requiredPatterns = [
    `npx aidn codex run-json-hook --skill ${spec.name} --mode ${spec.mode} --target . --json`,
    ".aidn/runtime/context/codex-context.json",
  ];
  const forbiddenPatterns = [
    `npx aidn perf skill-hook --skill ${spec.name} --target . --mode ${spec.mode} --json`,
  ];
  const missingPatterns = requiredPatterns.filter((pattern) => !text.includes(pattern));
  const presentForbidden = forbiddenPatterns.filter((pattern) => text.includes(pattern));
  return {
    skill: spec.name,
    file,
    pass: missingPatterns.length === 0 && presentForbidden.length === 0,
    missing_file: false,
    missing_patterns: missingPatterns,
    forbidden_patterns: presentForbidden,
  };
}

function main() {
  try {
    const args = parseArgs(process.argv.slice(2));
    const checks = SKILLS.map((spec) => checkSkill(args.root, spec));
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
        if (item.forbidden_patterns.length > 0) {
          console.log(`  Forbidden present: ${item.forbidden_patterns.join(" | ")}`);
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
