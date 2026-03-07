#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createLocalProcessAdapter } from "../../src/adapters/runtime/local-process-adapter.mjs";
import {
  assertSupportedSkill,
  assertValidSkillMode,
  runSkillHookUseCase,
} from "../../src/application/runtime/skill-hook-use-case.mjs";

const PERF_DIR = path.dirname(fileURLToPath(import.meta.url));

function parseArgs(argv) {
  const args = {
    target: ".",
    skill: "",
    mode: "",
    strict: false,
    json: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--target") {
      args.target = argv[i + 1] ?? "";
      i += 1;
    } else if (token === "--skill") {
      args.skill = String(argv[i + 1] ?? "").trim();
      i += 1;
    } else if (token === "--mode") {
      args.mode = String(argv[i + 1] ?? "").trim().toUpperCase();
      i += 1;
    } else if (token === "--strict") {
      args.strict = true;
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
  if (!args.skill) {
    throw new Error("Missing value for --skill");
  }
  assertSupportedSkill(args.skill);
  assertValidSkillMode(args.mode);
  return args;
}

function printUsage() {
  console.log("Usage:");
  console.log("  node tools/perf/skill-hook.mjs --skill context-reload --target .");
  console.log("  node tools/perf/skill-hook.mjs --skill branch-cycle-audit --target . --mode COMMITTING");
  console.log("  node tools/perf/skill-hook.mjs --skill start-session --target . --mode EXPLORING");
  console.log("  node tools/perf/skill-hook.mjs --skill cycle-create --target . --mode COMMITTING --json");
  console.log("  node tools/perf/skill-hook.mjs --skill convert-to-spike --target . --strict");
}

function main() {
  try {
    const args = parseArgs(process.argv.slice(2));
    const processAdapter = createLocalProcessAdapter();
    const targetRoot = path.resolve(process.cwd(), args.target);
    const out = runSkillHookUseCase({
      args,
      perfDir: PERF_DIR,
      targetRoot,
      processAdapter,
    });
    if (args.json) {
      console.log(JSON.stringify(out, null, 2));
    } else if (out.ok) {
      console.log(`Skill hook: OK (${args.skill} -> ${out.tool})`);
    } else {
      console.warn(`Skill hook: WARN (${args.skill} -> ${out.tool}) ${out.error?.message ?? "unknown error"}`);
    }
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    printUsage();
    process.exit(1);
  }
}

main();
