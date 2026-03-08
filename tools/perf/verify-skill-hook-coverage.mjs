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
    const mandatoryDbLine = "in dual/db-only, this hook is mandatory and must be run in strict mode (`--strict`).";
    const contextInjectionLine = "read `.aidn/runtime/context/codex-context.json` and use these signals to drive the next action.";
    const wrap = (skill, mode) => `npx aidn codex run-json-hook --skill ${skill} --mode ${mode} --target . --json`;
    const checks = [
      checkOne(args.root, "context-reload/SKILL.md", [wrap("context-reload", "<THINKING|EXPLORING|COMMITTING>"), contextInjectionLine, stateModeLine, mandatoryDbLine]),
      checkOne(args.root, "branch-cycle-audit/SKILL.md", [wrap("branch-cycle-audit", "COMMITTING"), contextInjectionLine, stateModeLine, mandatoryDbLine]),
      checkOne(args.root, "drift-check/SKILL.md", [wrap("drift-check", "COMMITTING"), contextInjectionLine, stateModeLine, mandatoryDbLine]),
      checkOne(args.root, "start-session/SKILL.md", [wrap("start-session", "<THINKING|EXPLORING|COMMITTING>"), contextInjectionLine, stateModeLine, mandatoryDbLine]),
      checkOne(args.root, "close-session/SKILL.md", [wrap("close-session", "<THINKING|EXPLORING|COMMITTING>"), contextInjectionLine, stateModeLine, mandatoryDbLine]),
      checkOne(args.root, "cycle-create/SKILL.md", [wrap("cycle-create", "COMMITTING"), contextInjectionLine, stateModeLine, mandatoryDbLine]),
      checkOne(args.root, "cycle-close/SKILL.md", [wrap("cycle-close", "COMMITTING"), contextInjectionLine, stateModeLine, mandatoryDbLine]),
      checkOne(args.root, "promote-baseline/SKILL.md", [wrap("promote-baseline", "COMMITTING"), contextInjectionLine, stateModeLine, mandatoryDbLine]),
      checkOne(args.root, "requirements-delta/SKILL.md", [wrap("requirements-delta", "COMMITTING"), contextInjectionLine, stateModeLine, mandatoryDbLine]),
      checkOne(args.root, "convert-to-spike/SKILL.md", [wrap("convert-to-spike", "EXPLORING"), contextInjectionLine, stateModeLine, mandatoryDbLine]),
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
