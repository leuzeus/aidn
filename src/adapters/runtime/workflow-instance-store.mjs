import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { createProjectArtifactStore } from "../../application/runtime/project-artifact-store-service.mjs";
import { resolveEffectiveRuntimePersistence } from "../../application/runtime/runtime-persistence-service.mjs";
import { assertProjectArtifactCompareSwap } from "../../core/ports/project-artifact-store-port.mjs";
import { agentRunPhysicalPath, readAgentRunFile } from "../../application/runtime/agent-run-configuration-service.mjs";
import { writeFileAtomicSync } from "../../lib/fs/atomic-write-lib.mjs";
import { artifactContentHash } from "../../core/workflow/artifact-compare-swap.mjs";
import { assertWorkflowInstance, workflowInstanceFail as fail } from "../../core/workflow/workflow-instance.mjs";

export function workflowInstanceArtifactPath(id) {
  if (typeof id !== "string" || !/^[a-z][a-z0-9_-]{0,95}$/.test(id) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/.test(id)) fail("WORKFLOW_INSTANCE_ID_INVALID");
  return `workflows/instances/${id}.json`;
}

// A lock abandoned by process termination is retained for explicit operator
// reconciliation. Never infer owner death from a PID or automatically replay.
export function createWorkflowInstanceStore({ targetRoot, stateMode }) {
  const root = agentRunPhysicalPath(path.resolve(targetRoot), { directory: true });
  if (!["files", "dual", "db-only"].includes(stateMode)) fail("WORKFLOW_INSTANCE_STATE_MODE_INVALID");
  const database = stateMode !== "files" || resolveEffectiveRuntimePersistence({ targetRoot: root }).backend === "postgres";
  const location = id => agentRunPhysicalPath(path.join(root, "docs/audit", workflowInstanceArtifactPath(id)), { missing: true });
  function read(id) {
    let text = null;
    if (!database) {
      const file = location(id);
      if (fs.existsSync(file)) text = readAgentRunFile(file, { json: false }).value.toString("utf8");
    } else {
      const store = createProjectArtifactStore({ targetRoot: root, readOnly: true });
      try { const row = store.getArtifact(workflowInstanceArtifactPath(id));
        if (row && (row.content_format !== "utf8" || typeof row.content !== "string")) fail("WORKFLOW_INSTANCE_ARTIFACT_INVALID");
        text = row?.content ?? null;
      } finally { store.close(); }
    }
    const instance = text === null ? null : JSON.parse(text);
    if (instance) { assertWorkflowInstance(instance); if (instance.instance_id !== id) fail("WORKFLOW_INSTANCE_ID_CHANGED"); }
    return { instance, content_sha256: text === null ? null : artifactContentHash(text) };
  }
  return Object.freeze({
    read,
    compareAndSwap(instance, expectedContentHash) {
      assertWorkflowInstance(instance);
      const artifact = { path: workflowInstanceArtifactPath(instance.instance_id), kind: "workflow_instance", family: "runtime",
        content_format: "utf8", content: JSON.stringify(instance) + "\n" };
      if (database) {
        const store = assertProjectArtifactCompareSwap(createProjectArtifactStore({ targetRoot: root, existingOnly: true }));
        try { store.compareAndSwapArtifact({ artifact, expectedSha256: expectedContentHash }); }
        finally { store.close(); }
        // Canonical commit precedes its derived projection. A failed projection
        // must be reported as written and repaired explicitly, never replayed.
        return { instance, written: true, projection: stateMode !== "db-only" ? "pending" : "not_requested" };
      }
      const file = location(instance.instance_id), lock = file + ".lock";
      agentRunPhysicalPath(lock, { missing: true });
      fs.mkdirSync(path.dirname(file), { recursive: true });
      let fd;
      try { fd = fs.openSync(lock, "wx"); } catch (cause) {
        if (cause.code === "EEXIST") fail("WORKFLOW_INSTANCE_LOCK_RECONCILIATION_REQUIRED");
        throw cause;
      }
      try {
        fs.writeFileSync(fd, JSON.stringify({ token: randomUUID(), pid: process.pid, expected_content_sha256: expectedContentHash }));
        fs.fsyncSync(fd);
        if (read(instance.instance_id).content_sha256 !== expectedContentHash) fail("WORKFLOW_INSTANCE_REVISION_CONFLICT");
        writeFileAtomicSync(file, artifact.content);
        return { instance, written: true, projection: "canonical" };
      } finally { fs.closeSync(fd); fs.unlinkSync(lock); }
    },
    materialize(id, { write = false } = {}) {
      const { instance } = read(id);
      if (!instance) fail("WORKFLOW_INSTANCE_NOT_FOUND");
      if (!database || stateMode === "db-only") fail("WORKFLOW_INSTANCE_PROJECTION_NOT_REQUIRED");
      const file = location(id);
      if (write) writeFileAtomicSync(file, JSON.stringify(instance) + "\n");
      return { written: write, instance_sha256: instance.instance_sha256, projection: write ? "materialized" : "preview" };
    },
  });
}
