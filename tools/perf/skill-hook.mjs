#!/usr/bin/env node
import fs from "node:fs";
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
    noAutoSkipGate: false,
    failOnRepairBlock: false,
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
    } else if (token === "--no-auto-skip-gate") {
      args.noAutoSkipGate = true;
    } else if (token === "--fail-on-repair-block") {
      args.failOnRepairBlock = true;
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
  console.log("  node tools/perf/skill-hook.mjs --skill close-session --target . --mode COMMITTING --no-auto-skip-gate");
  console.log("  node tools/perf/skill-hook.mjs --skill close-session --target . --mode COMMITTING --fail-on-repair-block");
}

function printRuntimeDigestHint(targetRoot, repairLayerStatus) {
  const status = String(repairLayerStatus ?? "").trim().toLowerCase();
  if (!["warn", "block"].includes(status)) {
    return;
  }
  const runtimeStateFile = path.join(targetRoot, "docs", "audit", "RUNTIME-STATE.md");
  if (!fs.existsSync(runtimeStateFile)) {
    return;
  }
  console.log("Runtime digest: docs/audit/RUNTIME-STATE.md");
}

function printCurrentStateStaleHint(targetRoot) {
  const runtimeStateFile = path.join(targetRoot, "docs", "audit", "RUNTIME-STATE.md");
  if (!fs.existsSync(runtimeStateFile)) {
    return;
  }
  const text = fs.readFileSync(runtimeStateFile, "utf8");
  if (!text.includes("current_state_freshness: stale")) {
    return;
  }
  console.log("Current state stale: docs/audit/CURRENT-STATE.md");
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
    } else {
      const status = out.ok ? "OK" : "WARN";
      const summary = `${args.skill} -> ${out.tool}`;
      if (out.ok) {
        console.log(`Skill hook: ${status} (${summary})`);
      } else {
        console.warn(`Skill hook: ${status} (${summary}) ${out.error?.message ?? "unknown error"}`);
      }
      if (Number(out.repair_layer_open_count ?? 0) > 0) {
        console.log(`Repair findings: ${out.repair_layer_open_count} open${out.repair_layer_blocking ? " (blocking)" : ""}`);
        if (out.repair_layer_status) {
          console.log(`Repair status: ${out.repair_layer_status}`);
        }
        if (out.repair_layer_advice) {
          console.log(`Repair advice: ${out.repair_layer_advice}`);
        }
        printRuntimeDigestHint(targetRoot, out.repair_layer_status);
        printCurrentStateStaleHint(targetRoot);
      }
    }
    if (args.failOnRepairBlock && String(out.repair_layer_status ?? "") === "block") {
      process.exit(1);
    }
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    printUsage();
    process.exit(1);
  }
}

main();
