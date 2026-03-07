import path from "node:path";
import { resolveEffectiveStateMode } from "../../core/state-mode/state-mode-policy.mjs";
import {
  assertSupportedSkill,
  assertValidSkillMode,
  getSkillRoute,
  resolveSkillHookMode,
  shouldForceStrictForSkillState,
} from "../../core/skills/skill-policy.mjs";

export { assertSupportedSkill, assertValidSkillMode };

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
  const route = getSkillRoute(args.skill);
  const mode = resolveSkillHookMode(args.mode, route);
  const stateMode = resolveEffectiveStateMode({
    targetRoot,
    stateMode: "",
  });
  const strictRequiredByState = shouldForceStrictForSkillState(stateMode);
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
