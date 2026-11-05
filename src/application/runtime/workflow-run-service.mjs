import path from "node:path";
import { readAidnProjectConfig } from "../../lib/config/aidn-config-lib.mjs";
import { resolveWorkflowEngine } from "../../core/workflow/workflow-engine-policy.mjs";
import { shadowHash } from "../../core/workflow/shadow-json.mjs";
import { runOwnedAgenticProcess } from "./agentic-process-owned-run.mjs";
import { agentRunPhysicalPath, readAgentRunFile } from "./agent-run-configuration-service.mjs";
import { createPublicAgentRunLifecycle } from "./agent-run-public-composition.mjs";
import { parseAgentRunArguments } from "./agent-run-lifecycle-service.mjs";
import { runStandardWorkflowEntry } from "./standard-workflow-entry.mjs";

const fail = code => { throw Object.assign(new Error(code), { code }); };
const codeOf = cause => /^[A-Z][A-Z0-9_]{0,100}$/.test(cause?.code ?? cause?.message ?? "") ? cause.code ?? cause.message : "WORKFLOW_RUN_UNAVAILABLE";
export function workflowRunEnvelope(effect = "preview") {
  return { contract_version: "runtime-workflow-run.v1", command: "aidn runtime workflow-run", effect_class: effect,
    engine: null, dry_run: true, written: false, shared_coordination_sync: false, action_sha256: null,
    can_apply: false, preview: null, result: null, requirements: [], errors: [], warnings: [] };
}

// Common execution entry, independent of XML authoring. JSON/preview never
// allocates a native session. Execution retains the owned host and its budgets.
export async function runProjectWorkflow({ targetRoot, engine, configuration, authorization, plan,
  actionFile = null, preparedAction = null, decisionSource = null, controlSource = null, observation = null,
  execute = false, syncRelay = false, expectPlan = null } = {}, { runOwned = runOwnedAgenticProcess, lifecycle = createPublicAgentRunLifecycle } = {}) {
  const output = workflowRunEnvelope(execute ? "executor" : "preview");
  try {
    if (typeof execute !== "boolean" || typeof syncRelay !== "boolean" || !execute && (syncRelay || expectPlan)) fail("WORKFLOW_RUN_EXPLICIT_EFFECT_REQUIRED");
    const root = agentRunPhysicalPath(path.resolve(targetRoot ?? "."), { directory: true });
    output.engine = resolveWorkflowEngine({ engine, config: readAidnProjectConfig(root).data });
    if (!configuration) {
      if (preparedAction !== null) fail("WORKFLOW_RUN_STANDARD_CONFIGURATION_REQUIRED");
      output.requirements = ["WORKFLOW_CONFIGURATION_REQUIRED", "EXPLICIT_EXECUTION_AUTHORIZATION_REQUIRED"];
      if (execute) fail("WORKFLOW_RUN_CONFIGURATION_REQUIRED");
      return output;
    }
    if (output.engine === "legacy") {
      if (actionFile || preparedAction !== null || decisionSource || controlSource || observation) fail("WORKFLOW_RUN_LEGACY_ARGUMENT_CONFLICT");
      if (authorization) fail("WORKFLOW_RUN_LEGACY_AUTHORIZATION_INVALID");
      const args = ["--target", root, "--configuration", path.resolve(configuration), ...(plan ? ["--plan", path.resolve(plan)] : []),
        ...(execute ? ["--execute", "--expect-plan", expectPlan ?? "", ...(syncRelay ? ["--sync-relay"] : [])] : [])];
      const result = await lifecycle().invoke(parseAgentRunArguments("agent-run", args));
      output.action_sha256 = result.action_sha256 ?? null;
      output.can_apply = result.can_apply === true;
      if (execute) { output.result = result; output.dry_run = result.dry_run; output.written = result.written === true; output.shared_coordination_sync = result.shared_coordination_sync === true; }
      else output.preview = result;
      output.errors.push(...(result.errors ?? []));
      return output;
    }
    if (plan || syncRelay) fail("WORKFLOW_RUN_AGENTIC_ARGUMENT_CONFLICT");
    const config = readAgentRunFile(path.resolve(configuration), { maxBytes: 1048576 }).value;
    if (config.contract_version === "standard-workflow-execution.v1") {
      if (agentRunPhysicalPath(config.execution?.target_root, { directory: true }) !== root) fail("WORKFLOW_RUN_TARGET_CHANGED");
      const consent = authorization ? readAgentRunFile(path.resolve(authorization), { maxBytes: 16384 }).value : null;
      if (execute) output.dry_run = false;
      const result = await runStandardWorkflowEntry({ request: config, actionFile, preparedAction, decisionSource, controlSource, observation,
        authorization: consent, execute, expectPlan });
      output.preview = result.preview; output.action_sha256 = result.action_sha256; output.can_apply = result.can_apply;
      output.result = result.result; output.requirements = result.requirements;
      output.written = result.written; output.dry_run = !execute;
      return output;
    }
    if (actionFile || preparedAction !== null || decisionSource || controlSource || observation) fail("WORKFLOW_RUN_STANDARD_CONFIGURATION_REQUIRED");
    if (agentRunPhysicalPath(config.target_root, { directory: true }) !== root) fail("WORKFLOW_RUN_TARGET_CHANGED");
    const preview = await runOwned({ configuration: config, execute: false });
    const consent = authorization ? readAgentRunFile(path.resolve(authorization), { maxBytes: 16384 }).value : null;
    if (authorization && (!consent || typeof consent !== "object" || Array.isArray(consent))) fail("WORKFLOW_RUN_AUTHORIZATION_INVALID");
    const consentSha = consent ? shadowHash(consent) : null;
    // Show only typed budget fields, never arbitrary authorization-file content.
    const budgets = consent ? Object.fromEntries(["authorized_at_ms", "global_deadline_ms", "workflow_deadline_ms", "max_turn_ms", "max_responses", "max_bytes"]
      .map(key => [key, Number.isSafeInteger(consent[key]) ? consent[key] : null])) : null;
    output.preview = { ...preview, authorization: consent ? { sha256: consentSha, ...budgets,
      approved: consent.approved === true, model_allowed: consent.model_allowed === true } : null };
    output.action_sha256 = shadowHash({ engine: output.engine, target: root, configuration_sha256: shadowHash(config),
      authorization_sha256: consentSha, preview });
    output.can_apply = consent != null;
    if (!authorization) output.requirements.push("EXPLICIT_EXECUTION_AUTHORIZATION_REQUIRED");
    if (!execute) return output;
    if (expectPlan !== output.action_sha256) fail("WORKFLOW_RUN_PREVIEW_CHANGED");
    if (!authorization) fail("WORKFLOW_RUN_AUTHORIZATION_REQUIRED");
    output.dry_run = false;
    output.can_apply = false;
    output.result = await runOwned({ configuration: config, authorization: consent, execute: true });
    // Worker summaries account for retained state even when closure fails.
    output.written = (output.result.worker_result?.bytes_retained ?? 0) > 0
      || (output.result.worker_result?.persistence?.canonical_payload_bytes_acknowledged ?? 0) > 0;
    if (output.result.worker_result?.bytes_retained == null) output.warnings.push("WORKFLOW_RUN_WRITE_OUTCOME_UNCERTAIN_INSPECT_BEFORE_RETRY");
    output.can_apply = false;
    if (output.result.status !== "COMPLETED") output.errors.push(output.result.first_failure ?? "WORKFLOW_RUN_INCOMPLETE");
  } catch (cause) {
    output.errors.push(codeOf(cause)); output.can_apply = false;
    if (!output.dry_run) output.warnings.push("WORKFLOW_RUN_OUTCOME_UNCERTAIN_INSPECT_BEFORE_RETRY");
  }
  return output;
}
