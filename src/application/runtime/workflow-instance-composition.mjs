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

// Internal opt-in API. No automatic selection, CLI entry or client installation.
export function createProjectWorkflowInstanceService({ targetRoot }) {
  const root = agentRunPhysicalPath(path.resolve(targetRoot), { directory: true });
  const mode = () => resolveConfigStateMode(readAidnProjectConfig(root).data) ?? "files";
  function readAuthority() {
    const activation = readActivation({ targetRoot: root });
    if (!activation.active || activation.state !== "active" || activation.authorization?.status !== "authorized") fail("WORKFLOW_INSTANCE_ACTIVATION_REQUIRED");
    const context = resolveRuntimeProjectContext({ targetRoot: root });
    return { stateMode: mode(), productVersion: readAgentRunFile(fileURLToPath(new URL("../../../VERSION", import.meta.url)), { json: false }).value.toString("utf8").trim(),
      scope: { target_sha256: shadowHash(process.platform === "win32" ? root.toLowerCase() : root), runtime_scope_id: context.runtime_scope_id,
        persistence_sha256: shadowHash(readAidnProjectConfig(root).data?.runtime?.persistence ?? { backend: "sqlite" }),
        activation: { authority_id: activation.authorization.authority_id, revision: activation.authorization.revision } } };
  }
  return createWorkflowInstanceService({ store: createWorkflowInstanceStore({ targetRoot: root, stateMode: mode() }), readAuthority,
    lifecycle: { invoke: (args, options) => createPublicAgentRunLifecycle({ workflowInstance: options.workflowInstance }).invoke(args) },
    readSegment(pending) {
      const configuration = readAgentRunConfiguration(pending.configuration_path).configuration;
      if (agentRunPhysicalPath(configuration.target_root, { directory: true }) !== root) fail("WORKFLOW_INSTANCE_TARGET_CHANGED");
      return { configuration, plan: normalizeAgentExecutionPlan(readAgentRunFile(pending.plan_path).value) };
    },
  });
}
