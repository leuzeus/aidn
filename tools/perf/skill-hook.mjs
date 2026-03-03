#!/usr/bin/env node
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  normalizeStateMode,
  readAidnProjectConfig,
  resolveConfigStateMode,
} from "../aidn-config-lib.mjs";

const PERF_DIR = path.dirname(fileURLToPath(import.meta.url));
const VALID_MODES = new Set(["THINKING", "EXPLORING", "COMMITTING", "UNKNOWN"]);

const SKILL_ROUTES = {
  "context-reload": { tool: "reload-check.mjs", defaultMode: "THINKING" },
  "branch-cycle-audit": { tool: "gating-evaluate.mjs", defaultMode: "COMMITTING" },
  "drift-check": { tool: "gating-evaluate.mjs", defaultMode: "COMMITTING" },
  "start-session": { tool: "workflow-hook.mjs", fixedArgs: ["--phase", "session-start"], defaultMode: "UNKNOWN" },
  "close-session": { tool: "workflow-hook.mjs", fixedArgs: ["--phase", "session-close"], defaultMode: "UNKNOWN" },
  "cycle-create": { tool: "checkpoint.mjs", defaultMode: "COMMITTING" },
  "cycle-close": { tool: "checkpoint.mjs", defaultMode: "COMMITTING" },
  "promote-baseline": { tool: "checkpoint.mjs", defaultMode: "COMMITTING" },
  "requirements-delta": { tool: "checkpoint.mjs", defaultMode: "COMMITTING" },
  "convert-to-spike": { tool: "checkpoint.mjs", defaultMode: "EXPLORING" },
};

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
  if (!SKILL_ROUTES[args.skill]) {
    throw new Error(`Unsupported --skill: ${args.skill}`);
  }
  if (args.mode && !VALID_MODES.has(args.mode)) {
    throw new Error("Invalid --mode. Expected THINKING|EXPLORING|COMMITTING|UNKNOWN");
  }
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

function resolveMode(inputMode, route) {
  if (inputMode && VALID_MODES.has(inputMode)) {
    return inputMode;
  }
  return route.defaultMode ?? "UNKNOWN";
}

function resolveEffectiveStateMode(targetRoot) {
  const envStateMode = normalizeStateMode(process.env.AIDN_STATE_MODE);
  if (envStateMode) {
    return envStateMode;
  }
  const config = readAidnProjectConfig(targetRoot);
  const configStateMode = resolveConfigStateMode(config.data);
  if (configStateMode) {
    return configStateMode;
  }
  return "files";
}

function buildToolArgs(route, targetRoot, mode, effectiveStrict) {
  const args = [...(route.fixedArgs ?? []), "--target", targetRoot, "--json"];
  if (route.tool === "checkpoint.mjs" || route.tool === "gating-evaluate.mjs" || route.tool === "workflow-hook.mjs") {
    args.push("--mode", mode);
  }
  if (route.tool === "workflow-hook.mjs" && effectiveStrict) {
    args.push("--strict");
  }
  return args;
}

function runToolJson(toolFile, args) {
  const absoluteScript = path.join(PERF_DIR, toolFile);
  const stdout = execFileSync(process.execPath, [absoluteScript, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return JSON.parse(String(stdout ?? "{}"));
}

function toErrorObject(error) {
  return {
    message: String(error?.message ?? error),
    stdout: String(error?.stdout ?? "").trim(),
    stderr: String(error?.stderr ?? "").trim(),
    status: error?.status ?? 1,
  };
}

function main() {
  try {
    const args = parseArgs(process.argv.slice(2));
    const route = SKILL_ROUTES[args.skill];
    const mode = resolveMode(args.mode, route);
    const targetRoot = path.resolve(process.cwd(), args.target);
    const stateMode = resolveEffectiveStateMode(targetRoot);
    const strictRequiredByState = stateMode === "dual" || stateMode === "db-only";
    const effectiveStrict = args.strict || strictRequiredByState;
    const toolArgs = buildToolArgs(route, targetRoot, mode, effectiveStrict);
    const startedAt = new Date().toISOString();

    try {
      const payload = runToolJson(route.tool, toolArgs);
      const out = {
        ts: startedAt,
        ok: true,
        skill: args.skill,
        tool: route.tool,
        mode,
        target: targetRoot,
        state_mode: stateMode,
        strict_requested: args.strict,
        strict_required_by_state: strictRequiredByState,
        strict: effectiveStrict,
        payload,
      };
      if (args.json) {
        console.log(JSON.stringify(out, null, 2));
      } else {
        console.log(`Skill hook: OK (${args.skill} -> ${route.tool})`);
      }
      return;
    } catch (error) {
      const err = toErrorObject(error);
      if (effectiveStrict) {
        throw new Error(`Skill hook failed for ${args.skill}: ${err.message}\n${err.stderr || err.stdout}`);
      }
      const out = {
        ts: startedAt,
        ok: false,
        skill: args.skill,
        tool: route.tool,
        mode,
        target: targetRoot,
        state_mode: stateMode,
        strict_requested: args.strict,
        strict_required_by_state: strictRequiredByState,
        strict: effectiveStrict,
        error: err,
      };
      if (args.json) {
        console.log(JSON.stringify(out, null, 2));
      } else {
        console.warn(`Skill hook: WARN (${args.skill} -> ${route.tool}) ${err.message}`);
      }
    }
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    printUsage();
    process.exit(1);
  }
}

main();
