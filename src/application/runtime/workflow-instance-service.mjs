import { createWorkflowInstance, inspectWorkflowInstance, assertCurrentWorkflowCompilation,
  decideWorkflowInstance, prepareWorkflowInstanceSegment, reconcileWorkflowInstanceSegment,
  workflowInstanceFail as fail } from "../../core/workflow/workflow-instance.mjs";
import { shadowHash } from "../../core/workflow/shadow-json.mjs";

// Trusted ports, like the existing agent lifecycle. Production composition is
// fixed; JSON definitions never select modules or grant admission.
export function createWorkflowInstanceService({ store, readAuthority, readSegment, lifecycle }) {
  function current(id, expected) {
    const retained = store.read(id);
    if (!retained.instance) fail("WORKFLOW_INSTANCE_NOT_FOUND");
    if (expected !== undefined && retained.instance.instance_sha256 !== expected) fail("WORKFLOW_INSTANCE_REVISION_CONFLICT");
    return retained;
  }
  function authority(instance, productive = true) {
    const observed = readAuthority();
    if (shadowHash(observed.scope) !== shadowHash(instance.scope) || observed.stateMode !== instance.compilation.context.state_mode)
      fail("WORKFLOW_INSTANCE_AUTHORITY_CHANGED");
    if (productive) {
      assertCurrentWorkflowCompilation(instance);
      if (observed.productVersion !== instance.compilation.context.product_version) fail("WORKFLOW_INSTANCE_CONTEXT_CHANGED");
    }
    return observed;
  }
  function commit(instance, previous, write, productive = true) {
    if (typeof write !== "boolean") fail("WORKFLOW_INSTANCE_EXPLICIT_EFFECT_REQUIRED");
    authority(instance, productive);
    if (!write) return { written: false, instance, cursor: inspectWorkflowInstance(instance) };
    authority(instance, productive);
    const result = store.compareAndSwap(instance, previous.content_sha256);
    if (result.projection === "pending") {
      try { store.materialize(instance.instance_id, { write: true }); result.projection = "materialized"; }
      catch { result.projection = "reconciliation_required"; }
    }
    return { ...result, cursor: inspectWorkflowInstance(instance) };
  }
  function selected(instance) {
    const pending = inspectWorkflowInstance(instance).pending;
    if (!pending) fail("WORKFLOW_INSTANCE_NO_PENDING_SEGMENT");
    const data = readSegment(pending);
    if (data.configuration.run_id !== pending.run_id || shadowHash(data.configuration) !== pending.configuration_sha256
      || data.plan.plan_sha256 !== pending.plan_sha256) fail("WORKFLOW_INSTANCE_SEGMENT_CHANGED");
    return { pending, data };
  }
  return Object.freeze({
    inspect(id) { const retained = current(id); return { ...retained, cursor: inspectWorkflowInstance(retained.instance) }; },
    initialize({ instanceId, definition, context, write = false }) {
      const observed = readAuthority();
      const retained = store.read(instanceId);
      if (retained.instance) fail("WORKFLOW_INSTANCE_ALREADY_EXISTS");
      const instance = createWorkflowInstance({ instanceId, definition, context, scope: observed.scope });
      return commit(instance, retained, write);
    },
    decide({ instanceId, expectedSha256, outcome, evidence, write = false }) {
      if (!expectedSha256) fail("WORKFLOW_INSTANCE_EXPECTED_REVISION_REQUIRED");
      const previous = current(instanceId, expectedSha256);
      return commit(decideWorkflowInstance(previous.instance, { outcome, evidence }), previous, write);
    },
    prepareSegment({ instanceId, expectedSha256, configurationPath, planPath, write = false }) {
      if (!expectedSha256) fail("WORKFLOW_INSTANCE_EXPECTED_REVISION_REQUIRED");
      const previous = current(instanceId, expectedSha256);
      const { configuration, plan } = readSegment({ configuration_path: configurationPath, plan_path: planPath });
      return commit(prepareWorkflowInstanceSegment(previous.instance, { configuration, plan, configurationPath, planPath }), previous, write);
    },
    async segment({ instanceId, expectedSha256, command = "agent-run-status", expectPlan = null, execute = false, syncRelay = false }) {
      if (!["agent-run", "agent-run-status", "agent-run-resume", "agent-run-cancel"].includes(command)) fail("WORKFLOW_INSTANCE_COMMAND_UNSUPPORTED");
      if (!expectedSha256 || command === "agent-run-status" && (execute || syncRelay || expectPlan)
        || execute && (!expectPlan || !syncRelay) || syncRelay && !execute) fail("WORKFLOW_INSTANCE_EXPLICIT_EFFECT_REQUIRED");
      if (typeof execute !== "boolean" || typeof syncRelay !== "boolean") fail("WORKFLOW_INSTANCE_EXPLICIT_EFFECT_REQUIRED");
      const { instance } = current(instanceId, expectedSha256), { pending, data } = selected(instance);
      // Historical status/cancel survive revoked activation and compiler drift.
      // All productive work additionally reuses the existing lifecycle admission.
      const args = { command, target: data.configuration.target_root,
        configuration: pending.configuration_path, plan: command === "agent-run" ? pending.plan_path : null,
        run: command === "agent-run" ? null : pending.run_id, expectPlan, execute, syncRelay,
        write: false, json: true, dryRun: false, help: false };
      if (command === "agent-run") authority(instance);
      if (command === "agent-run-resume") {
        const observation = await lifecycle.invoke({ ...args, command: "agent-run-status", expectPlan: null, execute: false, syncRelay: false }, { workflowInstance: pending });
        if (observation.errors?.length || observation.status?.cancellation?.status !== "requested") authority(instance);
      }
      return lifecycle.invoke(args, { workflowInstance: pending });
    },
    async reconcile({ instanceId, expectedSha256, write = false }) {
      if (!expectedSha256) fail("WORKFLOW_INSTANCE_EXPECTED_REVISION_REQUIRED");
      const previous = current(instanceId, expectedSha256);
      const result = await this.segment({ instanceId, expectedSha256 });
      if (result.errors?.length || !result.status) fail("WORKFLOW_INSTANCE_RECONCILIATION_REQUIRED");
      // This is observation only; uncertainty cannot call an executor. The CAS
      // writer retains the canonical reservation fence until the run releases it.
      return commit(reconcileWorkflowInstanceSegment(previous.instance, result.status), previous, write, false);
    },
  });
}
