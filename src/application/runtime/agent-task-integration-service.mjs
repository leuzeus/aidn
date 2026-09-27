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
  const owner = supervisor => ({ owner_id: supervisor.owner_id, generation: supervisor.generation, lease_id: supervisor.lease_id });
  function strictCapabilities() {
    if (typeof store.recordIntegrationIntent !== "function" || typeof git.allocateIntegrationWorkspace !== "function"
      || typeof git.inspectLocalIntegration !== "function") fail("AGENT_GIT_INTENT_CAPABILITY_REQUIRED");
  }
  async function recordPrepared(local, { intent, intentSha256, supervisor, expectedControlRevision, reconciliation = false }) {
    if (local.status !== "prepared") return local;
    const prepared = structuredClone(assertAgentExecutionContract("integration-prepared", local.prepared));
    if (prepared.intent_sha256 !== intentSha256) fail("AGENT_GIT_INTENT_MISMATCH");
    const durable = await store.prepareIntegration({ runId: intent.run_id, supervisor, expectedControlRevision,
      integration: prepared, intentSha256, reconciliation });
    if (durable.prepared_sha256 !== fingerprintAgentExecutionValue(prepared)) fail("AGENT_GIT_PREPARED_PROOF_MISMATCH");
    return { status: "prepared", prepared, prepared_sha256: durable.prepared_sha256,
      control_revision: durable.control_revision, workspace: local.workspace, intent, intent_sha256: intentSha256 };
  }
  async function recordIntent(intent, supervisor, expectedControlRevision) {
    const digest = fingerprintAgentExecutionValue(intent);
    const durable = await store.recordIntegrationIntent({ runId: intent.run_id, supervisor, expectedControlRevision, intent });
    if (durable.intent_sha256 !== digest || fingerprintAgentExecutionValue(durable.intent) !== digest
      || !Number.isSafeInteger(durable.control_revision)) fail("AGENT_GIT_INTENT_MISMATCH");
    return durable;
  }
  const service = {
    async prepare({ runId, planSha256, taskId, attemptId, acceptanceSha256, sequence,
      integrationId, sourceSha, parentSha, supervisor, expectedControlRevision, commitIdentity, verification = null }) {
      supervisor = structuredClone(supervisor); commitIdentity = structuredClone(commitIdentity);
      if (verification !== null) {
        strictCapabilities();
        const observed = await git.inspectIntegration({}, { phase: "head" });
        if (observed.head_sha !== parentSha) fail("AGENT_GIT_REF_DIVERGED");
        const intent = assertAgentExecutionContract("integration-intent", {
          contract_version: "agent-integration-intent.v1", integration_id: integrationId,
          run_id: runId, plan_sha256: planSha256, task_id: taskId, attempt_id: attemptId,
          acceptance_sha256: acceptanceSha256, sequence, ref: observed.ref,
          repository_identity_sha256: observed.repository_identity_sha256, source_sha: sourceSha, parent_sha: parentSha,
          created_by: owner(supervisor), workspace: git.allocateIntegrationWorkspace({ integrationId }), commit_identity: commitIdentity,
        });
        const durable = await recordIntent(intent, supervisor, expectedControlRevision);
        const local = await git.prepareIntegration({ intent, intentSha256: durable.intent_sha256, preparedBy: owner(supervisor) });
        return recordPrepared(local, { intent, intentSha256: durable.intent_sha256, supervisor, expectedControlRevision: durable.control_revision });
      }
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
    async resumePreparation({ intent, intentSha256, supervisor, expectedControlRevision, reconciliation = false }) {
      strictCapabilities(); intent = structuredClone(assertAgentExecutionContract("integration-intent", intent)); supervisor = structuredClone(supervisor);
      if (fingerprintAgentExecutionValue(intent) !== intentSha256) fail("AGENT_GIT_INTENT_MISMATCH");
      let local = await git.inspectLocalIntegration({ intent, intentSha256 });
      // Inspection/adoption never replays Git. A partial index or conflict remains
      // diagnostic evidence; only total absence permits an explicit fresh prepare.
      if (local.status === "absent" && !reconciliation) {
        const durable = await recordIntent(intent, supervisor, expectedControlRevision);
        expectedControlRevision = durable.control_revision;
        local = await git.prepareIntegration({ intent, intentSha256, preparedBy: owner(supervisor) });
      }
      return recordPrepared(local, { intent, intentSha256, supervisor, expectedControlRevision, reconciliation });
    },
    async applyPrepared({ prepared, preparedSha256, supervisor, expectedControlRevision, intent = null }) {
      prepared = structuredClone(prepared); supervisor = structuredClone(supervisor);
      if (intent !== null) {
        intent = structuredClone(assertAgentExecutionContract("integration-intent", intent));
        if (fingerprintAgentExecutionValue(intent) !== prepared.intent_sha256) fail("AGENT_GIT_INTENT_MISMATCH");
      }
      assertAgentExecutionContract("integration-prepared", prepared);
      if (fingerprintAgentExecutionValue(prepared) !== preparedSha256) fail("AGENT_GIT_PREPARED_PROOF_MISMATCH");
      // Idempotent replay is the canonical/ownership check immediately before
      // CAS. getRun or a heartbeat alone does not establish this authority.
      const fresh = await store.prepareIntegration({ runId: prepared.run_id, supervisor,
        expectedControlRevision, integration: prepared, ...(prepared.intent_sha256 ? { intentSha256: prepared.intent_sha256 } : {}) });
      if (fresh.prepared_sha256 !== preparedSha256 || !Number.isSafeInteger(fresh.control_revision)) fail("AGENT_GIT_PREPARED_PROOF_MISMATCH");
      const observed = await git.compareAndSwapIntegration({ prepared, intent });
      if (!["applied", "already_applied"].includes(observed.status) || observed.observed_sha !== prepared.result_sha) fail("AGENT_GIT_REF_DIVERGED");
      const applied = await store.recordIntegrationApplied({ runId: prepared.run_id, supervisor,
        expectedControlRevision: fresh.control_revision, integrationId: prepared.integration_id,
        preparedSha256, proof: { evidence: observed.evidence } });
      return { status: "applied", result_sha: prepared.result_sha, observed, applied };
    },
  };
  return Object.freeze(service);
}
