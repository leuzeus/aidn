import path from "node:path";
import { fileURLToPath } from "node:url";
import { readAidnProjectConfig, resolveConfigStateMode } from "../../lib/config/aidn-config-lib.mjs";
import { readActivation } from "../install/project-activation-service.mjs";
import { resolveRuntimeProjectContext } from "./runtime-project-context-service.mjs";
import { createPublicAgentRunLifecycle } from "./agent-run-public-composition.mjs";
import { agentRunPhysicalPath, readAgentRunConfiguration, readAgentRunFile } from "./agent-run-configuration-service.mjs";
import { normalizeAgentExecutionPlan } from "../../core/agents/agent-execution-contracts.mjs";
import { shadowHash } from "../../core/workflow/shadow-json.mjs";
import { workflowInstanceFail as fail } from "../../core/workflow/workflow-instance.mjs";
import { createWorkflowInstanceStore } from "../../adapters/runtime/workflow-instance-store.mjs";
import { createWorkflowInstanceService } from "./workflow-instance-service.mjs";
import { createAgenticProcessStore } from "../../adapters/runtime/agentic-process-store.mjs";
import { createAgenticProcessService } from "./agentic-process-service.mjs";
import { agenticPolicyPins, assertAgenticProcessModel } from "../../core/workflow/agentic-process-model.mjs";
import { agenticProcessPersistence } from "./agentic-process-persistence.mjs";
import { resolveWorkflowEngine } from "../../core/workflow/workflow-engine-policy.mjs";

export function readWorkflowProjectAuthority({ targetRoot }) {
  const root = agentRunPhysicalPath(path.resolve(targetRoot), { directory: true });
  const mode = () => resolveConfigStateMode(readAidnProjectConfig(root).data) ?? "files";
  const activation = readActivation({ targetRoot: root });
  if (!activation.active || activation.state !== "active" || activation.authorization?.status !== "authorized") fail("WORKFLOW_INSTANCE_ACTIVATION_REQUIRED");
  const context = resolveRuntimeProjectContext({ targetRoot: root });
  return { stateMode: mode(), productVersion: readAgentRunFile(fileURLToPath(new URL("../../../VERSION", import.meta.url)), { json: false }).value.toString("utf8").trim(),
    scope: { target_sha256: shadowHash(process.platform === "win32" ? root.toLowerCase() : root), runtime_scope_id: context.runtime_scope_id,
      persistence_sha256: shadowHash(readAidnProjectConfig(root).data?.runtime?.persistence ?? { backend: "sqlite" }),
      activation: { authority_id: activation.authorization.authority_id, revision: activation.authorization.revision } } };
}

// Explicit compatibility composition for pinned sequential definitions.
export function createLegacyProjectWorkflowInstanceService({ targetRoot }) {
  const root = agentRunPhysicalPath(path.resolve(targetRoot), { directory: true });
  const mode = () => resolveConfigStateMode(readAidnProjectConfig(root).data) ?? "files";
  const readAuthority = () => readWorkflowProjectAuthority({ targetRoot: root });
  return createWorkflowInstanceService({ store: createWorkflowInstanceStore({ targetRoot: root, stateMode: mode() }), readAuthority,
    lifecycle: { invoke: (args, options) => createPublicAgentRunLifecycle({ workflowInstance: options.workflowInstance }).invoke(args) },
    readSegment(pending) {
      const configuration = readAgentRunConfiguration(pending.configuration_path).configuration;
      if (agentRunPhysicalPath(configuration.target_root, { directory: true }) !== root) fail("WORKFLOW_INSTANCE_TARGET_CHANGED");
      return { configuration, plan: normalizeAgentExecutionPlan(readAgentRunFile(pending.plan_path).value) };
    },
  });
}

// Default application entry: a declared agentic model, including directly authored
// JSON, uses the structured reducer. Reading a history never changes its engine.
export function createProjectWorkflowInstanceService({ targetRoot, engine } = {}) {
  const root = agentRunPhysicalPath(path.resolve(targetRoot), { directory: true });
  const options = () => ({ targetRoot: root, stateMode: resolveConfigStateMode(readAidnProjectConfig(root).data) ?? "files" });
  const selected = requested => resolveWorkflowEngine({ engine: requested ?? engine, config: readAidnProjectConfig(root).data });
  function existing(instanceId, requested) {
    if (requested != null) resolveWorkflowEngine({ engine: requested });
    const agentic = createAgenticProcessStore(options()).read(instanceId).record;
    const legacy = createWorkflowInstanceStore(options()).read(instanceId).instance;
    if (!requested && agentic && legacy) fail("WORKFLOW_ENGINE_AMBIGUOUS");
    const retainedEngine = requested ?? (agentic ? "agentic" : legacy ? "legacy" : null);
    if (!retainedEngine) fail("WORKFLOW_INSTANCE_NOT_FOUND");
    if (retainedEngine === "agentic" && agentic) return { engine: retainedEngine, record: agentic };
    if (retainedEngine === "legacy" && legacy) return { engine: retainedEngine, record: legacy };
    fail("WORKFLOW_INSTANCE_NOT_FOUND");
  }
  function agenticService(model) {
    return createAgenticProcessService({ store: createAgenticProcessStore(options()), readAuthority() {
      const authority = readWorkflowProjectAuthority({ targetRoot: root });
      const persistence = agenticProcessPersistence({ targetRoot: root });
      return { scope_id: shadowHash({ project: authority.scope, persistence: persistence.binding_sha256 }),
        model_sha256: shadowHash(model), policy_pins: agenticPolicyPins(model) };
    } });
  }
  const legacy = () => createLegacyProjectWorkflowInstanceService({ targetRoot: root });
  function legacyAction(name, input) {
    const retained = existing(input.instanceId, input.engine);
    if (retained.engine !== "legacy") fail("WORKFLOW_LEGACY_OPERATION_REQUIRED");
    return legacy()[name](input);
  }
  return Object.freeze({
    initialize(input) {
      const choice = selected(input.engine);
      const other = choice === "agentic" ? createWorkflowInstanceStore(options()).read(input.instanceId).instance
        : createAgenticProcessStore(options()).read(input.instanceId).record;
      if (other) fail("WORKFLOW_INSTANCE_ENGINE_CONFLICT");
      if (choice === "legacy") return legacy().initialize(input);
      if (input.definition != null || input.context != null) fail("WORKFLOW_AGENTIC_MODEL_REQUIRED");
      assertAgenticProcessModel(input.model);
      return agenticService(input.model).initialize(input);
    },
    inspect(instanceId, { engine: requested = engine } = {}) {
      if (requested != null) resolveWorkflowEngine({ engine: requested });
      const retained = existing(instanceId, requested);
      return retained.engine === "agentic" ? agenticService(retained.record.model).inspect(instanceId) : legacy().inspect(instanceId);
    },
    signal(input) {
      const retained = existing(input.instanceId, input.engine);
      if (retained.engine !== "agentic") fail("WORKFLOW_AGENTIC_OPERATION_REQUIRED");
      return agenticService(retained.record.model).signal(input);
    },
    decide: input => legacyAction("decide", input),
    prepareSegment: input => legacyAction("prepareSegment", input),
    reconcile: input => legacyAction("reconcile", input),
  });
}
