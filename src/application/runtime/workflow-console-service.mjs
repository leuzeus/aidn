import { inspectWorkflowInstance, assertCurrentWorkflowCompilation, workflowInstanceFail as fail } from "../../core/workflow/workflow-instance.mjs";
import { assertWorkflowSelection } from "../../core/workflow/workflow-selection.mjs";
import { getWorkflowShadowRegistry } from "../../core/workflow/workflow-shadow-compiler.mjs";
import { shadowHash, checkShadowJson } from "../../core/workflow/shadow-json.mjs";

const operations = Object.freeze({
  initialize: ["instanceId", "definition", "context"],
  decide: ["instanceId", "expectedSha256", "outcome", "evidence"],
  "prepare-segment": ["instanceId", "expectedSha256", "configurationPath", "planPath"],
  reconcile: ["instanceId", "expectedSha256"],
  propose: ["definition", "explanation", "baseInstanceId"],
  activate: ["definition", "explanation", "baseInstanceId", "expectedPreviewSha256", "review"],
  "initialize-selected": ["workflowId", "instanceId", "expectedSelectionSha256"],
  run: ["command", "configuration", "plan", "run"],
});
export const workflowConsoleCode = cause => {
  const value = cause?.code ?? cause?.message;
  return typeof value === "string" && /^[A-Z][A-Z0-9_]{0,100}$/.test(value) ? value : "WORKFLOW_CONSOLE_UNAVAILABLE";
};
export function validateWorkflowConsoleRequest(request) {
  if (checkShadowJson(request) || !request || Array.isArray(request) || Object.keys(request).some(k => !["operation", "input"].includes(k))
    || !Object.hasOwn(operations, request.operation) || !request.input || Array.isArray(request.input) || typeof request.input !== "object"
    || Object.keys(request.input).some(k => !operations[request.operation].includes(k))) fail("WORKFLOW_CONSOLE_REQUEST_INVALID");
  if (request.operation === "run" && !["agent-run", "agent-run-resume", "agent-run-cancel", "agent-run-cleanup"].includes(request.input.command)) fail("WORKFLOW_CONSOLE_REQUEST_INVALID");
  return structuredClone(request);
}
export function workflowConsoleEnvelope(name, effect = "read-only") {
  return { contract_version: `runtime-workflow-${name}.v1`, command: `aidn runtime workflow-${name}`, effect_class: effect,
    dry_run: true, written: false, shared_coordination_sync: false, errors: [], warnings: [],
    ...(name === "inspect" ? { view: null } : name === "action" ? { action_sha256: null, action: null, can_apply: false, result: null } : { listening: false, url: null, token: null }) };
}

// Both transports use this application port. No browser-supplied module, SQL,
// scope, target or effect flag can select a different implementation.
export function createWorkflowConsoleService({ targetIdentity, readRecords, readAuthority, instances, candidates, readRun, invokeRun }) {
  async function invoke(request, apply = false, delegatedHash = null, expectedResultSha256 = null) {
    const input = request.input;
    const checkpoint = { ...input, write: apply, expectedResultSha256 };
    switch (request.operation) {
      case "initialize": return instances.initialize(checkpoint);
      case "decide": return instances.decide(checkpoint);
      case "prepare-segment": return instances.prepareSegment(checkpoint);
      case "reconcile": return instances.reconcile(checkpoint);
      case "propose": return candidates.propose(input);
      case "activate": return candidates.activate({ ...input, write: apply });
      case "initialize-selected": return candidates.initializeSelected(checkpoint);
      case "run": return invokeRun(input, { apply, expectPlan: delegatedHash });
    }
  }
  return Object.freeze({
    async inspect({ instanceId = null, workflowId = null, configuration = null, run = null } = {}) {
      const output = { ...workflowConsoleEnvelope("inspect"), view: null };
      try {
        if (Boolean(configuration) !== Boolean(run)) fail("WORKFLOW_CONSOLE_RUN_SELECTOR_REQUIRED");
        const records = readRecords({ instanceId, workflowId });
        let authority = null, admission = { status: "unavailable", blockers: [] };
        try { authority = readAuthority(); admission.status = "observed"; }
        catch (cause) { admission.blockers.push(workflowConsoleCode(cause)); }
        const selections = records.selections.map(selection => {
          assertWorkflowSelection(selection);
          return { workflow_id: selection.workflow_id, selection_sha256: selection.selection_sha256, revision: selection.revision,
            definitions: [selection.seed.compilation.definition, ...selection.activations.map(row => row.proposal.compilation.definition)],
            reviews: selection.activations.map(row => row.review) };
        });
        const rows = records.instances.map(instance => {
          const cursor = inspectWorkflowInstance(instance), blockers = [...admission.blockers];
          if (authority && (shadowHash(authority.scope) !== shadowHash(instance.scope) || authority.stateMode !== instance.compilation.context.state_mode
            || authority.productVersion !== instance.compilation.context.product_version)) blockers.push("WORKFLOW_INSTANCE_AUTHORITY_CHANGED");
          try { assertCurrentWorkflowCompilation(instance); } catch (cause) { blockers.push(workflowConsoleCode(cause)); }
          if (cursor.status === "handler_unavailable") blockers.push("WORKFLOW_INSTANCE_HANDLER_UNAVAILABLE");
          if (cursor.pending) blockers.push("WORKFLOW_INSTANCE_RECONCILIATION_REQUIRED");
          return { instance_id: instance.instance_id, instance_sha256: instance.instance_sha256, revision: instance.revision,
            definition: instance.compilation.definition, compilation_sha256: instance.compilation.compilation_sha256,
            context: instance.compilation.context, scope: instance.scope, cursor, blockers,
            steps: instance.compilation.steps, transitions: instance.compilation.transitions,
            evidence: instance.events.filter(event => event.kind === "human").map(event => ({ step_id: event.step_id, outcome: event.outcome, evidence: event.evidence })),
            runs: instance.events.filter(event => event.kind === "segment_intent").map(event => ({ run_id: event.run_id, plan_sha256: event.plan_sha256,
              configuration_sha256: event.configuration_sha256, step_id: event.step_id,
              observation: "retained_checkpoint", status: instance.events.find(row => row.kind === "segment_result" && row.run_id === event.run_id)?.status ?? null })) };
        });
        const live = configuration ? await readRun({ configuration, run }) : null;
        const view = { contract_version: "workflow-console-view.v1", authority: "derived", consistency: "per_record",
          registry: getWorkflowShadowRegistry(), admission, selections, instances: rows, live_run: live,
          limits: ["SPEC_REMAINS_RULE_AUTHORITY", "NO_AUTOMATIC_INSTANCE_MIGRATION", "RETAINED_RUN_STATUS_IS_NOT_LIVE",
            "NATIVE_QUALIFICATION_NOT_INFERRED", "EXECUTION_ACCEPTANCE_INTEGRATION_VALIDATION_CLEANUP_ARE_DISTINCT",
            ...(records.truncated ? ["CATALOG_TRUNCATED_USE_EXACT_SELECTORS"] : [])] };
        output.view = { ...view, view_sha256: shadowHash(view) };
      } catch (cause) { output.errors.push(workflowConsoleCode(cause)); }
      return output;
    },
    async action(raw, { write = false, execute = false, syncRelay = false, expectPlan = null } = {}) {
      const output = { ...workflowConsoleEnvelope("action", write ? "mutating" : execute ? "executor" : "preview"),
        action_sha256: null, can_apply: false, action: null, result: null };
      try {
        const request = validateWorkflowConsoleRequest(raw);
        const run = request.operation === "run", cleanup = run && request.input.command === "agent-run-cleanup", apply = write || execute;
        if ([write, execute, syncRelay].some(value => typeof value !== "boolean") || write && execute
          || run && (cleanup ? execute : write) || !run && (execute || syncRelay)
          || apply && (!/^[a-f0-9]{64}$/.test(expectPlan ?? "") || run && !syncRelay)
          || !apply && (syncRelay || expectPlan) || request.operation === "propose" && apply) fail("WORKFLOW_CONSOLE_EXPLICIT_EFFECT_REQUIRED");
        const preview = await invoke(request);
        const action = { request, target_sha256: targetIdentity, preview,
          effects: request.operation === "propose" ? [] : run ? [cleanup ? "retained_run_cleanup" : "supervised_run_command", "explicit_shared_sync"] : ["canonical_workflow_checkpoint"] };
        output.action = action; output.action_sha256 = shadowHash(action);
        output.can_apply = request.operation !== "propose" && !preview.errors?.length && (preview.can_apply ?? true);
        if (!apply) return output;
        if (expectPlan !== output.action_sha256) fail("WORKFLOW_CONSOLE_PREVIEW_CHANGED");
        if (!output.can_apply) fail("WORKFLOW_CONSOLE_PRECONDITIONS_FAILED");
        // Dedicated services recheck current authority/CAS and the supervisor
        // repeats its exact delegated action hash before any execution effect.
        output.result = await invoke(request, true, preview.action_sha256, preview.instance?.instance_sha256 ?? null);
        output.written = output.result.written === true;
        output.shared_coordination_sync = output.result.shared_coordination_sync === true;
        output.dry_run = false; output.can_apply = false;
        output.errors.push(...(output.result.errors ?? []));
      } catch (cause) { output.errors.push(workflowConsoleCode(cause)); output.can_apply = false; }
      return output;
    },
  });
}
