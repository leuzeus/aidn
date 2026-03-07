import path from "node:path";
import { resolveEffectiveStateMode } from "./runtime-mode-service.mjs";

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

export function assertSupportedSkill(skill) {
  if (!SKILL_ROUTES[skill]) {
    throw new Error(`Unsupported --skill: ${skill}`);
  }
}

export function assertValidSkillMode(mode) {
  if (mode && !VALID_MODES.has(mode)) {
    throw new Error("Invalid --mode. Expected THINKING|EXPLORING|COMMITTING|UNKNOWN");
  }
}

function resolveMode(inputMode, route) {
  if (inputMode && VALID_MODES.has(inputMode)) {
    return inputMode;
  }
  return route.defaultMode ?? "UNKNOWN";
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

function toErrorObject(error) {
  return {
    message: String(error?.message ?? error),
    stdout: String(error?.stdout ?? "").trim(),
    stderr: String(error?.stderr ?? "").trim(),
    status: error?.status ?? 1,
  };
}

export function runSkillHookUseCase({ args, perfDir, targetRoot, processAdapter }) {
  const route = SKILL_ROUTES[args.skill];
  const mode = resolveMode(args.mode, route);
  const stateMode = resolveEffectiveStateMode({
    targetRoot,
    stateMode: "",
  });
  const strictRequiredByState = stateMode === "dual" || stateMode === "db-only";
  const effectiveStrict = args.strict || strictRequiredByState;
  const toolArgs = buildToolArgs(route, targetRoot, mode, effectiveStrict);
  const startedAt = new Date().toISOString();

  try {
    const payload = processAdapter.runJsonNodeScript(path.join(perfDir, route.tool), toolArgs);
    return {
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
  } catch (error) {
    const err = toErrorObject(error);
    if (effectiveStrict) {
      throw new Error(`Skill hook failed for ${args.skill}: ${err.message}\n${err.stderr || err.stdout}`);
    }
    return {
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
  }
}
