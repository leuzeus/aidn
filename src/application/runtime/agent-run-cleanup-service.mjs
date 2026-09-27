import fs from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { readAgentRunFile, agentRunPhysicalPath } from "./agent-run-configuration-service.mjs";
import { fingerprintAgentExecutionValue as fingerprint } from "../../core/agents/agent-execution-contracts.mjs";

const fail = code => { throw Object.assign(new Error(code), { code }); };
const ensure = (condition, code) => { if (!condition) fail(code); };
const same = (a, b) => fingerprint(a) === fingerprint(b);
async function verifyIntegrationHead(snapshot, git) {
  const observed = await git.inspectIntegration({ phase: "head" }), expected = snapshot.integration_head;
  ensure(expected && observed.ok === true && observed.ref === expected.ref && observed.head_sha === expected.sha
    && observed.repository_identity_sha256 === expected.repository_identity_sha256, "AGENT_RUN_CLEANUP_INTEGRATION_CHANGED");
  return observed;
}
function resourceId(runId, kind, identity) { return "resource." + fingerprint({ runId, kind, identity }); }
async function cleanupSelections(context, assembled) {
  const snapshot = context.snapshot, config = context.configuration, selections = [];
  ensure(snapshot.run.lifecycle_status === "completed" && snapshot.reservation_active === false, "AGENT_RUN_CLEANUP_RETAINS_UNSUCCESSFUL_RUN");
  for (const row of snapshot.attempts) {
    ensure(row.result?.outcome === "completed" && assembled.workerStopped(row), "AGENT_RUN_CLEANUP_WORKER_UNSAFE");
    const preparation = JSON.parse((await assembled.attempts.loadPreparedAttempt({ attempt: row.attempt, evidence: row.preparation.evidence })).toString("utf8"));
    selections.push({ resourceId: resourceId(config.run_id, "attempt", row.attempt.attempt_id), kind: "attempt_worktree",
      cwd: row.attempt.worktree.cwd, attemptId: row.attempt.attempt_id, binding: preparation.binding, termination: row.termination });
  }
  for (const row of snapshot.integration_intents) {
    ensure(row.status === "applied", "AGENT_RUN_CLEANUP_INTEGRATION_PENDING");
    selections.push({ resourceId: resourceId(config.run_id, "integration", row.intent.integration_id), kind: "integration_worktree",
      cwd: row.intent.workspace.cwd, integrationId: row.intent.integration_id, binding: { run_id: config.run_id }, termination: null });
  }
  const expectedSnapshots = new Set([
    ...snapshot.acceptances.flatMap(row => row.evidence_verification?.snapshots ?? []),
    ...(snapshot.final_validation?.evidence_verification?.snapshots ?? []),
  ].map(item => item.snapshot_sha256));
  const root = agentRunPhysicalPath(config.resources_root, { directory: true }), names = fs.readdirSync(root);
  ensure(names.length <= 10000, "AGENT_RUN_CLEANUP_RESOURCE_LIMIT");
  const found = new Set();
  for (const name of names.filter(name => /^verification-[a-f0-9]{64}\.snapshot\.json$/.test(name)).sort()) {
    const descriptor = readAgentRunFile(path.join(root, name)).value;
    if (descriptor.run_id !== config.run_id) continue;
    const digest = fingerprint(descriptor);
    ensure(expectedSnapshots.has(digest), "AGENT_RUN_CLEANUP_UNVALIDATED_SNAPSHOT");
    found.add(digest);
    selections.push({ resourceId: resourceId(config.run_id, "verification", digest), kind: "verification_worktree",
      cwd: descriptor.cwd, verificationSnapshot: descriptor, binding: { run_id: config.run_id }, termination: null });
  }
  ensure(found.size === expectedSnapshots.size, "AGENT_RUN_CLEANUP_SNAPSHOT_MISSING");
  return selections.sort((a, b) => a.resourceId < b.resourceId ? -1 : 1);
}
export async function previewNativeAgentCleanup({ context, assembled }) {
  const snapshot = context.snapshot, resources = [], blockers = [], material = {};
  ensure(snapshot?.run.lifecycle_status === "completed", "AGENT_RUN_CLEANUP_RETAINS_UNSUCCESSFUL_RUN");
  ensure(snapshot.supervision.current, "AGENT_RUN_CLEANUP_SUPERVISOR_MISSING");
  material.integration_head = await verifyIntegrationHead(snapshot, assembled.git);
  material.supervisor_stop = snapshot.supervision.current.termination ?? await assembled.stopFacts(snapshot, snapshot.supervision.current.runner);
  const previous = snapshot.cleanup?.current;
  if (previous) {
    material.cleanup_sha256 = previous.cleanup_sha256; material.cleanup_generation = previous.ownership.generation;
    if (previous.status === "completed") {
      for (const row of snapshot.cleanup.resources) {
        ensure(row.result?.outcome === "removed", "AGENT_RUN_CLEANUP_RESULT_MISSING");
        await assembled.git.inspectCleanup(row.resource, { phase: "after", run: snapshot.run, snapshot, cleanup: previous.cleanup });
      }
      material.completed = true; return { blockers, resources: previous.cleanup.resources, material };
    }
    material.cleaner_stop = previous.termination ?? await assembled.stopFacts(snapshot, previous.runner);
    for (const row of snapshot.cleanup.resources) {
      const exists = fs.existsSync(row.resource.cwd);
      await assembled.git.inspectCleanup(row.resource, { phase: exists ? "before" : "after", run: snapshot.run, snapshot, cleanup: previous.cleanup });
      resources.push(row.resource);
    }
    return { blockers, resources: resources.sort((a, b) => a.resource_id < b.resource_id ? -1 : 1), material };
  }
  const selections = await cleanupSelections(context, assembled);
  for (const selection of selections) resources.push((await assembled.git.previewCleanupRetention(selection)).resource);
  ensure(resources.length > 0, "AGENT_RUN_CLEANUP_RESOURCES_MISSING");
  material.selection_sha256 = fingerprint(selections);
  return { blockers, resources, material };
}

export async function applyNativeAgentCleanup({ context, assembled, ownerId, runner, signal,
  clock = { setTimeout, clearTimeout }, coordinationTimeoutMs = 10000 }) {
  ensure(Number.isSafeInteger(coordinationTimeoutMs) && coordinationTimeoutMs > 0 && coordinationTimeoutMs <= 10000, "AGENT_RUN_CLEANUP_BUDGET_INVALID");
  const config = context.configuration, runId = config.run_id, { store: durable, git } = assembled;
  const stop = new AbortController(), controlSignal = signal ? AbortSignal.any([signal, stop.signal]) : stop.signal;
  let failure = null;
  const check = () => { if (failure) throw failure; if (controlSignal.aborted) fail("AGENT_RUN_CLEANUP_CANCELLED"); };
  const halt = cause => { failure ??= cause; stop.abort(cause); };
  const store = Object.fromEntries(["getRun", "recordSupervisorStopped", "reconcileCleanup", "beginCleanup", "renewCleanup", "inspectCleanupAuthority", "recordCleanupResult"].map(name => [name, async args => {
    check(); let timer; const deadline = performance.now() + coordinationTimeoutMs;
    try {
      const value = await Promise.race([Promise.resolve().then(() => durable[name](args)), new Promise((_, reject) => {
        timer = clock.setTimeout(() => reject(Object.assign(new Error("AGENT_RUN_CLEANUP_COORDINATION_TIMEOUT"), { code: "AGENT_RUN_CLEANUP_COORDINATION_TIMEOUT" })), coordinationTimeoutMs);
      })]);
      ensure(performance.now() < deadline, "AGENT_RUN_CLEANUP_COORDINATION_TIMEOUT");
      return value;
    } catch (cause) { halt(cause); throw cause; }
    finally { clock.clearTimeout(timer); }
  }]));
  check();
  let snapshot = await store.getRun({ runId });
  ensure(snapshot.supervision.control_revision === context.snapshot.supervision.control_revision, "AGENT_RUN_PREVIEW_CHANGED");
  const observed = await previewNativeAgentCleanup({ context: { ...context, snapshot }, assembled });
  ensure(same(observed.resources, context.resources)
    && same(observed.material, context.preconditions.native.cleanup), "AGENT_RUN_PREVIEW_CHANGED");
  if (snapshot.cleanup?.current?.status === "completed") return snapshot;
  check();
  if (!snapshot.supervision.current.termination) {
    snapshot = await store.recordSupervisorStopped({ runId, expectedSupervisor: snapshot.supervision.current.ownership,
      expectedControlRevision: snapshot.supervision.control_revision, proof: observed.material.supervisor_stop });
  }
  let cleanup = snapshot.cleanup?.current?.cleanup, previousGeneration = null;
  if (cleanup) {
    const previous = snapshot.cleanup.current;
    if (!previous.termination) snapshot = await store.reconcileCleanup({ runId, cleanupId: cleanup.cleanup_id,
      expectedOwnership: previous.ownership, expectedControlRevision: snapshot.supervision.control_revision, proof: observed.material.cleaner_stop });
    previousGeneration = snapshot.cleanup.current.ownership.generation;
  } else {
    // Preservation is a local explicit effect. Every retained byte and manifest
    // must equal the read-only preview before durable deletion ownership exists.
    const selections = await cleanupSelections({ ...context, snapshot }, assembled), retained = [];
    for (const selection of selections) { check(); retained.push(await git.prepareCleanupRetention(selection)); }
    ensure(same(retained, observed.resources), "AGENT_RUN_CLEANUP_PREIMAGE_CHANGED");
    cleanup = { contract_version: "agent-cleanup-intent.v1",
      cleanup_id: "cleanup." + fingerprint({ runId, plan_sha256: context.plan.plan_sha256, integrated_sha: snapshot.integration_head.sha }),
      run_id: runId, plan_sha256: context.plan.plan_sha256,
      repository_identity_sha256: snapshot.integration_head.repository_identity_sha256,
      integration_ref: snapshot.integration_head.ref, integrated_sha: snapshot.integration_head.sha, resources: retained };
  }
  check();
  snapshot = await store.beginCleanup({ runId, expectedControlRevision: snapshot.supervision.control_revision,
    ownerId, runner, cleanup, expectedPreviousGeneration: previousGeneration });
  const ownership = snapshot.cleanup.current.ownership;
  let timer = null, heartbeat = Promise.resolve(), ended = false;
  const renew = () => {
    if (ended) return;
    heartbeat = store.renewCleanup({ runId, cleanupId: cleanup.cleanup_id, ownership }).catch(halt)
      .finally(() => { if (!ended && !failure) timer = clock.setTimeout(renew, 10000); });
  };
  timer = clock.setTimeout(renew, 10000);
  const authority = async ({ resource, reconciliation = false }) => {
    check(); if (failure) throw failure;
    await verifyIntegrationHead(snapshot, git);
    const observed = await store.inspectCleanupAuthority({ runId, cleanupId: cleanup.cleanup_id, ownership,
      resourceId: resource.resource_id, resourceSha256: fingerprint(resource), reconciliation });
    check(); return observed;
  };
  try {
    for (const row of snapshot.cleanup.resources) {
      if (row.result) continue;
      check(); if (failure) throw failure;
      const resource = row.resource, options = { resource, cleanup, ownership, verifyAuthority: authority, run: snapshot.run, snapshot, signal: controlSignal };
      const operation = fs.existsSync(resource.cwd) ? git.removeOwnedWorktree : git.reconcileOwnedWorktreeRemoval;
      const observedResult = await operation(options);
      check(); if (failure) throw failure;
      const result = { ...observedResult, evidence: [...new Map([resource.retention, ...observedResult.evidence].map(item => [fingerprint(item), item])).values()] };
      const remaining = snapshot.cleanup.resources.filter(item => !item.result && item.resource.resource_id !== resource.resource_id);
      if (remaining.length === 0) {
        // Drain renewal before the final transaction closes cleanup ownership.
        ended = true; clock.clearTimeout(timer); await heartbeat;
        check(); if (failure) throw failure;
      }
      snapshot = await store.recordCleanupResult({ runId, cleanupId: cleanup.cleanup_id, ownership, resourceId: resource.resource_id, result });
    }
    return snapshot;
  } finally { ended = true; clock.clearTimeout(timer); await heartbeat; }
}
