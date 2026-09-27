import { assertAgentGitIntegration } from "../../core/ports/agent-git-integration-port.mjs";
import { assertAgentExecutionContract, fingerprintAgentExecutionValue } from "../../core/agents/agent-execution-contracts.mjs";

function fail(code) { throw Object.assign(new Error(code), { code }); }

// PostgreSQL owns the immutable intent. Git owns only the observed objects/ref.
// An interrupted operation is returned to reconciliation; never reset or replay
// cherry-pick on a fresh result after a prepared intent already exists.
export function createAgentTaskIntegrationService({ git, store } = {}) {
  assertAgentGitIntegration(git);
  if (typeof store?.prepareIntegration !== "function" || typeof store?.recordIntegrationApplied !== "function") {
    throw new TypeError("AgentTaskIntegration requires the durable integration store");
  }
  return Object.freeze({
    async prepare({ runId, planSha256, taskId, attemptId, acceptanceSha256, sequence,
      integrationId, sourceSha, parentSha, supervisor, expectedControlRevision, commitIdentity }) {
      supervisor = structuredClone(supervisor); commitIdentity = structuredClone(commitIdentity);
      const local = await git.prepareIntegration({ integrationId, sourceSha, expectedParent: parentSha, commitIdentity });
      if (local.status === "conflict") return local;
      const prepared = assertAgentExecutionContract("integration-prepared", {
        contract_version: "agent-integration-prepared.v1", integration_id: integrationId,
        run_id: runId, plan_sha256: planSha256, task_id: taskId, attempt_id: attemptId,
        acceptance_sha256: acceptanceSha256, sequence, ref: local.ref,
        repository_identity_sha256: local.repository_identity_sha256,
        source_sha: local.source_sha, parent_sha: local.parent_sha, result_sha: local.result_sha,
        prepared_by: { owner_id: supervisor.owner_id, generation: supervisor.generation, lease_id: supervisor.lease_id },
        evidence: local.evidence,
      });
      const durable = await store.prepareIntegration({ runId, supervisor, expectedControlRevision, integration: prepared });
      return { status: "prepared", prepared, prepared_sha256: fingerprintAgentExecutionValue(prepared),
        control_revision: durable.control_revision, workspace: local.workspace };
    },
    async applyPrepared({ prepared, preparedSha256, supervisor, expectedControlRevision }) {
      prepared = structuredClone(prepared); supervisor = structuredClone(supervisor);
      assertAgentExecutionContract("integration-prepared", prepared);
      if (fingerprintAgentExecutionValue(prepared) !== preparedSha256) fail("AGENT_GIT_PREPARED_PROOF_MISMATCH");
      // Idempotent replay is the canonical/ownership check immediately before
      // CAS. getRun or a heartbeat alone does not establish this authority.
      const fresh = await store.prepareIntegration({ runId: prepared.run_id, supervisor,
        expectedControlRevision, integration: prepared });
      if (fresh.prepared_sha256 !== preparedSha256 || !Number.isSafeInteger(fresh.control_revision)) fail("AGENT_GIT_PREPARED_PROOF_MISMATCH");
      const observed = await git.compareAndSwapIntegration({ prepared });
      if (!["applied", "already_applied"].includes(observed.status) || observed.observed_sha !== prepared.result_sha) fail("AGENT_GIT_REF_DIVERGED");
      const applied = await store.recordIntegrationApplied({ runId: prepared.run_id, supervisor,
        expectedControlRevision: fresh.control_revision, integrationId: prepared.integration_id,
        preparedSha256, proof: { evidence: observed.evidence } });
      return { status: "applied", result_sha: prepared.result_sha, observed, applied };
    },
  });
}
