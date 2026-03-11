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

function buildToolArgs(route, targetRoot, mode, effectiveStrict, noAutoSkipGate) {
  const args = [...(route.fixedArgs ?? []), "--target", targetRoot, "--json"];
  if (
    route.tool === "checkpoint.mjs"
    || route.tool === "gating-evaluate.mjs"
    || route.tool === "workflow-hook.mjs"
    || route.tool === "start-session-hook.mjs"
    || route.tool === "branch-cycle-audit-hook.mjs"
    || route.tool === "close-session-hook.mjs"
    || route.tool === "cycle-create-hook.mjs"
    || route.tool === "requirements-delta-hook.mjs"
  ) {
    args.push("--mode", mode);
  }
  if ((route.tool === "workflow-hook.mjs" || route.tool === "start-session-hook.mjs" || route.tool === "close-session-hook.mjs") && effectiveStrict) {
    args.push("--strict");
  }
  if (
    (route.tool === "checkpoint.mjs"
      || route.tool === "workflow-hook.mjs"
      || route.tool === "start-session-hook.mjs"
      || route.tool === "close-session-hook.mjs"
      || route.tool === "cycle-create-hook.mjs"
      || route.tool === "requirements-delta-hook.mjs")
    && noAutoSkipGate
  ) {
    args.push("--no-auto-skip-gate");
  }
  return args;
}

function extractRepairLayerSummary(payload) {
  const summary = payload?.summary && typeof payload.summary === "object" ? payload.summary : {};
  const checkpointSummary = payload?.checkpoint?.summary && typeof payload.checkpoint.summary === "object"
    ? payload.checkpoint.summary
    : {};
  return {
    repair_layer_open_count: Number(summary.repair_layer_open_count ?? checkpointSummary.repair_layer_open_count ?? 0),
    repair_layer_blocking: (summary.repair_layer_blocking ?? checkpointSummary.repair_layer_blocking) === true,
    repair_layer_status: summary.repair_layer_status ?? checkpointSummary.repair_layer_status ?? null,
    repair_layer_advice: summary.repair_layer_advice ?? checkpointSummary.repair_layer_advice ?? null,
    repair_layer_top_findings: Array.isArray(summary.repair_layer_top_findings)
      ? summary.repair_layer_top_findings
      : (Array.isArray(checkpointSummary.repair_layer_top_findings) ? checkpointSummary.repair_layer_top_findings : []),
  };
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
  const toolArgs = buildToolArgs(route, targetRoot, mode, effectiveStrict, args.noAutoSkipGate === true);
  const startedAt = new Date().toISOString();

  try {
    const payload = processAdapter.runJsonNodeScript(path.join(perfDir, route.tool), toolArgs);
    const repairLayer = extractRepairLayerSummary(payload);
    const payloadOk = (
      route.tool === "start-session-hook.mjs"
      || route.tool === "branch-cycle-audit-hook.mjs"
      || route.tool === "close-session-hook.mjs"
      || route.tool === "cycle-create-hook.mjs"
      || route.tool === "requirements-delta-hook.mjs"
    ) && typeof payload?.ok === "boolean"
      ? payload.ok
      : true;
    return {
      ts: startedAt,
      ok: payloadOk,
      skill: args.skill,
      tool: route.tool,
      mode,
      target: targetRoot,
      state_mode: stateMode,
      strict_requested: args.strict,
      strict_required_by_state: strictRequiredByState,
      strict: effectiveStrict,
      repair_layer_open_count: repairLayer.repair_layer_open_count,
      repair_layer_blocking: repairLayer.repair_layer_blocking,
      repair_layer_status: repairLayer.repair_layer_status,
      repair_layer_advice: repairLayer.repair_layer_advice,
      repair_layer_top_findings: repairLayer.repair_layer_top_findings,
      action: payload?.action ?? null,
      result: payload?.result ?? null,
      reason_code: payload?.reason_code ?? null,
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
