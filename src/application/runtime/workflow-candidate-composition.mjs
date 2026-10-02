import path from "node:path";
import { readAidnProjectConfig, resolveConfigStateMode } from "../../lib/config/aidn-config-lib.mjs";
import { agentRunPhysicalPath } from "./agent-run-configuration-service.mjs";
import { createWorkflowRecordStore } from "../../adapters/runtime/workflow-record-store.mjs";
import { createWorkflowInstanceStore, workflowInstanceArtifactPath } from "../../adapters/runtime/workflow-instance-store.mjs";
import { assertWorkflowSelection } from "../../core/workflow/workflow-selection.mjs";
import { createProjectWorkflowInstanceService, readWorkflowProjectAuthority } from "./workflow-instance-composition.mjs";
import { createWorkflowCandidateService } from "./workflow-candidate-service.mjs";

export function createWorkflowSelectionStore(options) {
  return createWorkflowRecordStore({ ...options, descriptor: {
    pathForId: id => workflowInstanceArtifactPath(id).replace("/instances/", "/definitions/"),
    validate: assertWorkflowSelection, idOf: value => value.workflow_id,
    hashOf: value => value.selection_sha256, kind: "workflow_selection",
  } });
}

export function createProjectWorkflowCandidateService({ targetRoot }) {
  const root = agentRunPhysicalPath(path.resolve(targetRoot), { directory: true });
  const options = { targetRoot: root, stateMode: resolveConfigStateMode(readAidnProjectConfig(root).data) ?? "files" };
  const lifecycle = createProjectWorkflowInstanceService({ targetRoot: root });
  return createWorkflowCandidateService({ selections: createWorkflowSelectionStore(options), instances: createWorkflowInstanceStore(options),
    readAuthority: () => readWorkflowProjectAuthority({ targetRoot: root }), initializeInstance: request => lifecycle.initialize(request) });
}
