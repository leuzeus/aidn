import { isDbBackedStateMode } from "../state-mode/state-mode-policy.mjs";

export const VALID_SKILL_HOOK_MODES = new Set(["THINKING", "EXPLORING", "COMMITTING", "UNKNOWN"]);

export const SKILL_ROUTES = {
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

export const MUTATING_SKILLS = new Set([
  "start-session",
  "close-session",
  "cycle-create",
  "cycle-close",
  "promote-baseline",
  "requirements-delta",
  "convert-to-spike",
]);

export function assertSupportedSkill(skill) {
  if (!SKILL_ROUTES[skill]) {
    throw new Error(`Unsupported --skill: ${skill}`);
  }
}

export function assertValidSkillMode(mode) {
  if (mode && !VALID_SKILL_HOOK_MODES.has(mode)) {
    throw new Error("Invalid --mode. Expected THINKING|EXPLORING|COMMITTING|UNKNOWN");
  }
}

export function getSkillRoute(skill) {
  assertSupportedSkill(skill);
  return SKILL_ROUTES[skill];
}

export function resolveSkillHookMode(inputMode, route) {
  if (inputMode && VALID_SKILL_HOOK_MODES.has(inputMode)) {
    return inputMode;
  }
  return route.defaultMode ?? "UNKNOWN";
}

export function shouldForceStrictForSkillState(stateMode) {
  return isDbBackedStateMode(stateMode);
}

export function shouldAutoDbSyncForSkill(skill) {
  return MUTATING_SKILLS.has(skill);
}
