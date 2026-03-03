#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

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
  console.log("  node tools/perf/verify-skill-hook-coverage.mjs");
  console.log("  node tools/perf/verify-skill-hook-coverage.mjs --root template/codex");
  console.log("  node tools/perf/verify-skill-hook-coverage.mjs --json");
}

function readText(filePath) {
  if (!fs.existsSync(filePath)) {
    return { exists: false, text: "" };
  }
  return { exists: true, text: String(fs.readFileSync(filePath, "utf8")) };
}

function checkOne(root, relativePath, patterns) {
  const absolute = path.resolve(process.cwd(), root, relativePath);
  const input = readText(absolute);
  if (!input.exists) {
    return {
      file: absolute,
      ok: false,
      missing_file: true,
      missing_patterns: patterns,
    };
  }

  const missingPatterns = patterns.filter((pattern) => !input.text.includes(pattern));
  return {
    file: absolute,
    ok: missingPatterns.length === 0,
    missing_file: false,
    missing_patterns: missingPatterns,
  };
}

function main() {
  try {
    const args = parseArgs(process.argv.slice(2));
    const stateModeLine = "state mode is resolved via `.aidn/config.json` (`runtime.stateMode`) or `AIDN_STATE_MODE` (`files|dual|db-only`).";
    const checks = [
      checkOne(args.root, "context-reload/SKILL.md", ["npx aidn perf skill-hook --skill context-reload --target . --mode <THINKING|EXPLORING|COMMITTING> --json", stateModeLine]),
      checkOne(args.root, "branch-cycle-audit/SKILL.md", ["npx aidn perf skill-hook --skill branch-cycle-audit --target . --mode COMMITTING --json", stateModeLine]),
      checkOne(args.root, "drift-check/SKILL.md", ["npx aidn perf skill-hook --skill drift-check --target . --mode COMMITTING --json", stateModeLine]),
      checkOne(args.root, "start-session/SKILL.md", ["npx aidn perf skill-hook --skill start-session --target . --mode <THINKING|EXPLORING|COMMITTING> --json", stateModeLine]),
      checkOne(args.root, "close-session/SKILL.md", ["npx aidn perf skill-hook --skill close-session --target . --mode <THINKING|EXPLORING|COMMITTING> --json", stateModeLine]),
      checkOne(args.root, "cycle-create/SKILL.md", ["npx aidn perf skill-hook --skill cycle-create --target . --mode COMMITTING --json", stateModeLine]),
      checkOne(args.root, "cycle-close/SKILL.md", ["npx aidn perf skill-hook --skill cycle-close --target . --mode COMMITTING --json", stateModeLine]),
      checkOne(args.root, "promote-baseline/SKILL.md", ["npx aidn perf skill-hook --skill promote-baseline --target . --mode COMMITTING --json", stateModeLine]),
      checkOne(args.root, "requirements-delta/SKILL.md", ["npx aidn perf skill-hook --skill requirements-delta --target . --mode COMMITTING --json", stateModeLine]),
      checkOne(args.root, "convert-to-spike/SKILL.md", ["npx aidn perf skill-hook --skill convert-to-spike --target . --mode EXPLORING --json", stateModeLine]),
    ];

    const pass = checks.every((item) => item.ok === true);
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
        const label = item.ok ? "PASS" : "FAIL";
        console.log(`${label} ${item.file}`);
        if (!item.ok && item.missing_patterns.length > 0) {
          console.log(`  Missing patterns: ${item.missing_patterns.join(" | ")}`);
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
