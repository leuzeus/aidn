import fs from "node:fs";
import path from "node:path";
import { readAidnProjectConfig, resolveConfigStateMode } from "../../lib/config/aidn-config-lib.mjs";
import { resolveEffectiveRuntimePersistence, resolveRuntimeSqliteFile } from "./runtime-persistence-service.mjs";
import { agentRunPhysicalPath } from "./agent-run-configuration-service.mjs";
import { createProjectArtifactStore } from "./project-artifact-store-service.mjs";
import { createWorkflowInstanceStore, workflowInstanceArtifactPath } from "../../adapters/runtime/workflow-instance-store.mjs";
import { createWorkflowSelectionStore, createProjectWorkflowCandidateService } from "./workflow-candidate-composition.mjs";
import { createProjectWorkflowInstanceService, readWorkflowProjectAuthority } from "./workflow-instance-composition.mjs";
import { createPublicAgentRunLifecycle } from "./agent-run-public-composition.mjs";
import { parseAgentRunArguments } from "./agent-run-lifecycle-service.mjs";
import { shadowHash } from "../../core/workflow/shadow-json.mjs";
import { createWorkflowConsoleService } from "./workflow-console-service.mjs";

export function createProjectWorkflowConsole({ targetRoot }) {
  const root = agentRunPhysicalPath(path.resolve(targetRoot), { directory: true });
  // Resolve mode/backend on every request, never retain an old store across a
  // dashboard lifetime or silently fall back after a configured backend fails.
  function readRecords({ instanceId, workflowId }) {
    const stateMode = resolveConfigStateMode(readAidnProjectConfig(root).data) ?? "files";
    const persistence = resolveEffectiveRuntimePersistence({ targetRoot: root });
    if (stateMode !== "files" && persistence.backend === "sqlite" && !fs.existsSync(resolveRuntimeSqliteFile({ targetRoot: root }))) throw new Error("WORKFLOW_CONSOLE_CANONICAL_STORE_UNAVAILABLE");
    const options = { targetRoot: root, stateMode }, found = { instances: [], selections: [], truncated: false };
    const exact = (id, type) => {
      const value = type === "instances" ? createWorkflowInstanceStore(options).read(id).instance : createWorkflowSelectionStore(options).read(id).record;
      if (!value) throw new Error("WORKFLOW_CONSOLE_RECORD_NOT_FOUND");
      found[type].push(value);
    };
    if (instanceId || workflowId) { if (instanceId) exact(instanceId, "instances"); if (workflowId) exact(workflowId, "selections"); return found; }
    if (stateMode !== "files" || persistence.backend === "postgres") {
      const store = createProjectArtifactStore({ targetRoot: root, readOnly: true });
      try {
        const rows = store.listArtifacts(10000); found.truncated = rows.length >= 10000;
        for (const row of rows) {
          const match = /^workflows\/(instances|definitions)\/([a-z][a-z0-9_-]{0,95})\.json$/.exec(row.path);
          if (!match) continue;
          workflowInstanceArtifactPath(match[2]);
          if (row.content_format !== "utf8" || typeof row.content !== "string") throw new Error("WORKFLOW_CONSOLE_ARTIFACT_INVALID");
          const value = JSON.parse(row.content);
          if ((match[1] === "instances" ? value.instance_id : value.workflow_id) !== match[2]) throw new Error("WORKFLOW_CONSOLE_ARTIFACT_ID_CHANGED");
          found[match[1] === "instances" ? "instances" : "selections"].push(value);
        }
      } finally { store.close(); }
    } else for (const folder of ["instances", "definitions"]) {
      const location = agentRunPhysicalPath(path.join(root, "docs/audit/workflows", folder), { missing: true });
      if (!fs.existsSync(location)) continue;
      const names = fs.readdirSync(location).filter(name => name.endsWith(".json")).sort();
      found.truncated ||= names.length > 256;
      for (const name of names.slice(0, 256)) exact(name.slice(0, -5), folder === "instances" ? "instances" : "selections");
    }
    for (const type of ["instances", "selections"]) found[type].sort((a, b) => (a.instance_id ?? a.workflow_id).localeCompare(b.instance_id ?? b.workflow_id, "en"));
    return found;
  }
  const instances = new Proxy({}, { get: (_, key) => (...args) => createProjectWorkflowInstanceService({ targetRoot: root })[key](...args) });
  const candidates = new Proxy({}, { get: (_, key) => (...args) => createProjectWorkflowCandidateService({ targetRoot: root })[key](...args) });
  async function lifecycle(input, { apply = false, expectPlan = null } = {}) {
    const argv = ["--target", root, "--configuration", input.configuration, ...(input.plan ? ["--plan", input.plan] : []), ...(input.run ? ["--run", input.run] : []),
      ...(apply ? [input.command === "agent-run-cleanup" ? "--write" : "--execute", "--expect-plan", expectPlan, "--sync-relay"] : [])];
    return createPublicAgentRunLifecycle().invoke(parseAgentRunArguments(input.command, argv));
  }
  return createWorkflowConsoleService({ targetIdentity: shadowHash(process.platform === "win32" ? root.toLowerCase() : root), readRecords, instances, candidates,
    readAuthority: () => readWorkflowProjectAuthority({ targetRoot: root }),
    readRun: input => lifecycle({ ...input, command: "agent-run-status" }), invokeRun: lifecycle });
}
