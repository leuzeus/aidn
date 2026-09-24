import { isDbBackedStateMode } from "../state-mode/state-mode-policy.mjs";

export const VALID_SKILL_HOOK_MODES = new Set(["THINKING", "EXPLORING", "COMMITTING", "UNKNOWN"]);

export const SKILL_IDENTITIES = Object.freeze([
  Object.freeze({"id":"context-reload","publicName":"aidn-context-reload","route":{"tool":"reload-check.mjs","defaultMode":"THINKING"}}),
  Object.freeze({"id":"branch-cycle-audit","publicName":"aidn-branch-cycle-audit","route":{"tool":"branch-cycle-audit-hook.mjs","defaultMode":"COMMITTING"}}),
  Object.freeze({"id":"drift-check","publicName":"aidn-drift-check","route":{"tool":"gating-evaluate.mjs","defaultMode":"COMMITTING"}}),
  Object.freeze({"id":"start-session","publicName":"aidn-start-session","route":{"tool":"start-session-hook.mjs","defaultMode":"UNKNOWN"}}),
  Object.freeze({"id":"close-session","publicName":"aidn-close-session","route":{"tool":"close-session-hook.mjs","defaultMode":"UNKNOWN"}}),
  Object.freeze({"id":"pr-orchestrate","publicName":"aidn-pr-orchestrate","route":{"tool":"pr-orchestrate-hook.mjs","defaultMode":"UNKNOWN"}}),
  Object.freeze({"id":"cycle-create","publicName":"aidn-cycle-create","route":{"tool":"cycle-create-hook.mjs","defaultMode":"COMMITTING"}}),
  Object.freeze({"id":"cycle-close","publicName":"aidn-cycle-close","route":{"tool":"cycle-close-hook.mjs","defaultMode":"COMMITTING"}}),
  Object.freeze({"id":"promote-baseline","publicName":"aidn-promote-baseline","route":{"tool":"promote-baseline-hook.mjs","defaultMode":"COMMITTING"}}),
  Object.freeze({"id":"requirements-delta","publicName":"aidn-requirements-delta","route":{"tool":"requirements-delta-hook.mjs","defaultMode":"COMMITTING"}}),
  Object.freeze({"id":"convert-to-spike","publicName":"aidn-convert-to-spike","route":{"tool":"convert-to-spike-hook.mjs","defaultMode":"EXPLORING"}}),
  Object.freeze({"id":"handoff-close","publicName":"aidn-handoff-close","route":{"tool":"handoff-close-hook.mjs","defaultMode":"UNKNOWN"}}),
  Object.freeze({"id":"crash-recovery","publicName":"aidn-crash-recovery","route":null}),
]);

export const SKILL_ROUTES = Object.freeze(Object.fromEntries(
  SKILL_IDENTITIES.filter((skill) => skill.route).map((skill) => [skill.id, Object.freeze(skill.route)]),
));

export function resolveSkillId(value) {
  return SKILL_IDENTITIES.find((skill) => skill.id === value || skill.publicName === value)?.id ?? null;
}

export function getPublicSkillName(value) {
  return SKILL_IDENTITIES.find((skill) => skill.id === value || skill.publicName === value)?.publicName ?? null;
}

export const MUTATING_SKILLS = new Set([
  "start-session",
  "close-session",
  "pr-orchestrate",
  "cycle-create",
  "cycle-close",
  "promote-baseline",
  "requirements-delta",
  "convert-to-spike",
  "handoff-close",
]);

export function assertSupportedSkill(skill) {
  if (!SKILL_ROUTES[resolveSkillId(skill)]) {
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
  return SKILL_ROUTES[resolveSkillId(skill)];
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
  return MUTATING_SKILLS.has(resolveSkillId(skill));
}
