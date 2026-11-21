import fs from 'node:fs';
import path from 'node:path';
import { freezeShadow, shadowHash } from '../../core/workflow/shadow-json.mjs';
import { assertPrIncidentCloseInput, assertPrIncidentClosePlan, assertPrIncidentCloseOutput,
  prIncidentCloseIntentPrefix, prIncidentCloseReconciliationPrefix, prIncidentCloseOperation, encodePrIncidentClosurePlan, decodePrIncidentClosurePlan } from '../../core/workflow/standard-pr-incident-close.mjs';
import { createStandardWorkflowArtifacts, STANDARD_ARTIFACT_MAX_BYTES } from './standard-workflow-artifacts.mjs';
import { agentRunPhysicalPath, readAgentRunFile } from './agent-run-configuration-service.mjs';
import { currentStandardDispatchContext } from './standard-dispatch-context.mjs';
import { createStandardIncidentClosure } from './standard-incident-closure.mjs';

const fail = code => { throw Object.assign(Error(code), { code, effect_status: 'no_effect' }); };
const same = (left, right) => shadowHash(left) === shadowHash(right);

// Capabilities are fixed by the operation host, never supplied in action JSON.
// The private closure port keeps its original pre-intent plan and all CAS/fence
// checks. This adapter recognizes only the exact current own-intent successor.
export function createStandardPrIncidentClose({ targetRoot, readCurrent, readClaimed,
  createEvidenceReader, observeBoundary, now = Date.now }, { boundary = () => {} } = {}) {
  if (![readCurrent, readClaimed, createEvidenceReader, observeBoundary].every(value => typeof value === 'function'))
    fail('STANDARD_PR_INCIDENT_CLOSE_CAPABILITY_REQUIRED');
  const artifacts = createStandardWorkflowArtifacts({ targetRoot });
  const port = (current, readEvidence, continuationBoundary = null) => createStandardIncidentClosure({ targetRoot, now,
    readCurrent: current, readEvidence, observeBoundary }, { boundary: continuationBoundary
      ? async point => { await boundary(point); await continuationBoundary(point); } : boundary });
  function source(reader, instance, input) {
    const value = reader.resolution(instance, input.origin_operation_id);
    if (value.severity !== 'L2_MEDIUM' || value.resolution === null) fail('STANDARD_PR_INCIDENT_CLOSE_SOURCE_REQUIRED');
    return value;
  }
  function matchEvidence(plan, material, instance) {
    const evidence = plan.evidence, resolution = material.resolution;
    const expected = { contract_version: 'standard-incident-close-evidence.v1', incident_id: material.incident_id,
      incident_sha256: plan.incident_sha256, instance_id: instance.instance_id, scope_id: instance.scope_id,
      instance_sha256: instance.instance_sha256, checkpoint_sha256: material.checkpoint_sha256,
      resolution_verified: true, resolution_ref: { ref: 'aidn:operation-receipt/' + resolution.alignment_operation_id,
        sha256: resolution.alignment_receipt_sha256 }, resume_confirmed: true,
      resume_ref: { ref: 'aidn:operation-receipt/' + resolution.completion_operation_id, sha256: resolution.completion_receipt_sha256 },
      stop_observed: false, workflow_rules_changed: false, rule_authorization: null };
    if (!same(evidence, expected)) fail('STANDARD_PR_INCIDENT_CLOSE_EVIDENCE_CHANGED');
    return evidence;
  }

  function continuationContext(instance, record, { allowCompleted = false } = {}) {
    instance = freezeShadow(structuredClone(instance)); record = freezeShadow(structuredClone(record));
    const claimed = readClaimed(record.operation_id), claimedSha = shadowHash(claimed);
    if (!same(claimed, record)) fail('STANDARD_PR_INCIDENT_CLOSE_CLAIM_CHANGED');
    const prefix = prIncidentCloseReconciliationPrefix(instance, record), input = assertPrIncidentCloseInput(record.preview.input);
    const prepared = record.preview.prepared, plan = assertPrIncidentClosePlan(prepared?.plan), inner = decodePrIncidentClosurePlan(plan);
    if (prepared.can_apply !== true || prepared.plan_sha256 !== shadowHash(plan) || !same(input, plan.input)
      || inner.instance_sha256 !== prefix.instance_sha256) fail('STANDARD_PR_INCIDENT_CLOSE_PREFIX_CHANGED');
    const original = assertPrIncidentCloseOutput(record.results[0].output);
    if (original.outcome !== 'reconciliation_required' || original.effect_status !== 'unknown'
      || original.observations.incident_id !== inner.incident_id || original.observations.plan_sha256 !== plan.closure_plan_sha256)
      fail('STANDARD_PR_INCIDENT_CLOSE_PARTIAL_REQUIRED');
    // This is a fixed read capability, never a replacement current instance.
    const current = id => {
      if (id !== instance.instance_id || !same(readCurrent(id), instance)
        || shadowHash(readClaimed(record.operation_id)) !== claimedSha) fail('STANDARD_PR_INCIDENT_CLOSE_CURRENT_CHANGED');
      return prefix;
    };
    if (!allowCompleted && instance.events.at(-1)?.receipt?.effect_status !== 'unknown')
      fail('STANDARD_PR_INCIDENT_CLOSE_PARTIAL_REQUIRED');
    const reader = createEvidenceReader(current), owned = [inner.incident_path, ...inner.traces.map(change => change.path)];
    const authenticate = () => {
      current(instance.instance_id);
      const material = source(reader, prefix, input);
      if (!same(material, plan.source)) fail('STANDARD_PR_INCIDENT_CLOSE_SOURCE_CHANGED');
      const evidence = matchEvidence(inner, material, prefix);
      if (shadowHash(artifacts.describe()) !== inner.selection_sha256 || observeBoundary(owned) !== inner.boundary_sha256)
        fail('STANDARD_PR_INCIDENT_CLOSE_SOURCE_CHANGED');
      current(instance.instance_id); return evidence;
    };
    const projection = name => {
      const file = agentRunPhysicalPath(path.join(artifacts.root, 'docs/audit', name), { missing: true });
      return fs.existsSync(file) ? readAgentRunFile(file, { json: false, maxBytes: STANDARD_ARTIFACT_MAX_BYTES }).sha256 : null;
    };
    const inspect = () => {
      authenticate();
      const rows = owned.map(name => ({ path: name, sha256: artifacts.read(name).sha256,
        metadata_sha256: artifacts.metadataHash(name), projection_sha256: projection(name) }));
      const tracker = rows[0];
      const trackerState = tracker.sha256 === inner.incident_sha256 && tracker.metadata_sha256 === inner.incident_metadata_sha256
        ? 'before' : tracker.sha256 === null && tracker.metadata_sha256 === null ? 'after' : 'conflict';
      const states = inner.traces.map((change, index) => {
        const row = rows[index + 1];
        return row.sha256 === change.after_sha256 && row.metadata_sha256 === change.after_metadata_sha256 ? 'after'
          : row.sha256 === change.before_sha256 && row.metadata_sha256 === change.before_metadata_sha256 ? 'before' : 'conflict';
      });
      if (trackerState === 'conflict' || states.includes('conflict') || states[0] !== 'after'
        || trackerState === 'after' && states.some(state => state !== 'after'))
        fail('STANDARD_PR_INCIDENT_CLOSE_PARTIAL_CHANGED');
      if (![null, inner.incident_sha256].includes(tracker.projection_sha256)) fail('STANDARD_PR_INCIDENT_CLOSE_PROJECTION_CHANGED');
      const mode = artifacts.describe().state_mode;
      if (mode !== 'db-only') for (const [index, change] of inner.traces.entries()) {
        if (![null, change.before_sha256, change.after_sha256].includes(rows[index + 1].projection_sha256))
          fail('STANDARD_PR_INCIDENT_CLOSE_PROJECTION_CHANGED');
      }
      authenticate(); return { mode, rows, states: [trackerState, ...states] };
    };
    const state = inspect(), expected = assertPrIncidentCloseOutput({ contract_version: 'standard-pr-incident-close-output.v1',
      operation_ref: prIncidentCloseOperation, outcome: 'completed', effect_status: 'confirmed',
      facts: { session_pr_incident_cleanup_completed: true },
      observations: { incident_id: inner.incident_id, plan_sha256: plan.closure_plan_sha256, reason_code: null },
      evidence_refs: inner.traces.map(change => ({ ref: 'docs/audit/' + change.path, sha256: change.after_sha256 })) });
    const continuation = { profile: 'standard-pr-incident-close-known-partial.v1', original_receipt_sha256: shadowHash(record.results[0].receipt),
      closure_plan_sha256: plan.closure_plan_sha256, source_sha256: plan.source_sha256, boundary_sha256: inner.boundary_sha256,
      state_sha256: shadowHash(state), owned_paths: owned, expected_output_sha256: shadowHash(expected), expected_output: expected };
    return { instance, record, prefix, plan, inner, current, reader, owned, authenticate, inspect, state, continuation };
  }
  return Object.freeze({
    prepareContinuation(instance, record) {
      return freezeShadow(continuationContext(instance, record).continuation);
    },
    confirmsContinuation(instance, record, output) {
      const context = continuationContext(instance, record, { allowCompleted: true });
      output = assertPrIncidentCloseOutput(output);
      return same(output, context.continuation.expected_output)
        && port(context.current, () => context.authenticate()).matchesCompletedArtifacts(context.prefix,
          { can_apply: true, plan: context.inner, plan_sha256: context.plan.closure_plan_sha256 });
    },
    async prepare(instance, input) {
      input = freezeShadow(structuredClone(assertPrIncidentCloseInput(input)));
      const reader = createEvidenceReader(readCurrent), material = source(reader, instance, input);
      const prepared = await port(readCurrent, request => reader.read(request)).prepare(instance, { incident_id: material.incident_id });
      if (!same(source(reader, instance, input), material)) fail('STANDARD_PR_INCIDENT_CLOSE_SOURCE_CHANGED');
      matchEvidence(prepared.plan, material, instance);
      const encoded = encodePrIncidentClosurePlan(prepared.plan);
      if (encoded.closure_plan_sha256 !== prepared.plan_sha256) fail('STANDARD_PR_INCIDENT_CLOSE_PLAN_INVALID');
      const plan = assertPrIncidentClosePlan({ contract_version: 'standard-pr-incident-close-plan.v1', operation_ref: prIncidentCloseOperation,
        input, source: material, source_sha256: shadowHash(material), ...encoded });
      return freezeShadow({ can_apply: true, plan, plan_sha256: shadowHash(plan) });
    },
    confirmsOriginal(instance, record, output) {
      instance = freezeShadow(structuredClone(instance));
      const claimed = readClaimed(record.operation_id), claimedSha = shadowHash(claimed);
      if (!same(claimed, record)) fail('STANDARD_PR_INCIDENT_CLOSE_CLAIM_CHANGED');
      const input = assertPrIncidentCloseInput(record.preview.input), prepared = record.preview.prepared;
      const plan = assertPrIncidentClosePlan(prepared?.plan);
      if (prepared.can_apply !== true || prepared.plan_sha256 !== shadowHash(plan) || !same(input, plan.input))
        fail('STANDARD_PR_INCIDENT_CLOSE_PLAN_INVALID');
      output = assertPrIncidentCloseOutput(output);
      if (output.outcome !== 'completed' || output.observations.incident_id !== plan.source.incident_id
        || output.observations.plan_sha256 !== plan.closure_plan_sha256) return false;
      const completed = record.phase === 'receipted' && record.results.length === 1
        && same(record.results[0].output, output)
        && record.results[0].receipt.output_sha256 === shadowHash(output)
        && record.results[0].receipt.intent_sha256 === shadowHash(record.intent)
        && record.results[0].receipt.outcome === 'completed'
        && record.results[0].receipt.effect_status === output.effect_status
        && same(record.results[0].receipt.facts, output.facts);
      if (!(record.phase === 'dispatching' && record.results.length === 0 || completed)) return false;
      // The current journal MAC and full body remain the authenticated claim.
      // This ephemeral pre-receipt view only feeds the original structural
      // own-intent check before acceptance. No record or history is rewritten.
      const originalClaim = completed ? { ...record, phase: 'dispatching', results: [] } : record;
      const prefix = prIncidentCloseIntentPrefix(instance, originalClaim), inner = decodePrIncidentClosurePlan(plan);
      if (inner.instance_sha256 !== prefix.instance_sha256) fail('STANDARD_PR_INCIDENT_CLOSE_PREFIX_CHANGED');
      function current(id) {
        const actual = readCurrent(id);
        if (id !== instance.instance_id || !same(actual, instance) || shadowHash(readClaimed(record.operation_id)) !== claimedSha)
          fail('STANDARD_PR_INCIDENT_CLOSE_CURRENT_CHANGED');
        return prefix;
      }
      const reader = createEvidenceReader(current), material = source(reader, prefix, input);
      if (!same(material, plan.source)) fail('STANDARD_PR_INCIDENT_CLOSE_SOURCE_CHANGED');
      matchEvidence(inner, material, prefix);
      const expectedRefs = inner.traces.map(change => ({ ref: 'docs/audit/' + change.path, sha256: change.after_sha256 }));
      if (!same(output.evidence_refs, expectedRefs)) return false;
      const matches = port(current, request => reader.read(request)).matchesCompletedArtifacts(prefix,
        { can_apply: true, plan: inner, plan_sha256: plan.closure_plan_sha256 });
      if (!same(source(reader, prefix, input), material)) fail('STANDARD_PR_INCIDENT_CLOSE_SOURCE_CHANGED');
      current(instance.instance_id);
      return matches;
    },

    async applyContinuation(instance, record, continuation, { write = false, expectedContinuationSha256, assertAuthorized,
      onBoundary = async () => {} } = {}) {
      let context = continuationContext(instance, record), floor = context.state;
      const borrowed = currentStandardDispatchContext()?.artifactContinuation;
      if (write !== true || expectedContinuationSha256 !== shadowHash(continuation)
        || !same(context.continuation, continuation) || typeof assertAuthorized !== 'function'
        || borrowed?.operation_id !== record.operation_id || borrowed.plan_sha256 !== context.plan.closure_plan_sha256
        || typeof borrowed.assertCurrent !== 'function') fail('STANDARD_PR_INCIDENT_CLOSE_EXPLICIT_EFFECT_REQUIRED');
      borrowed.assertCurrent();
      const check = () => {
        const fresh = continuationContext(instance, record), next = fresh.state;
        for (let index = 0; index < floor.states.length; index++) {
          if (floor.states[index] === 'after' && next.states[index] !== 'after') fail('STANDARD_PR_INCIDENT_CLOSE_PREFIX_REGRESSED');
          if (index > 0 && (next.mode === 'db-only'
            ? next.rows[index].projection_sha256 !== floor.rows[index].projection_sha256
            : floor.rows[index].projection_sha256 === context.inner.traces[index - 1].after_sha256
              && next.rows[index].projection_sha256 !== floor.rows[index].projection_sha256))
            fail('STANDARD_PR_INCIDENT_CLOSE_PROJECTION_CHANGED');
        }
        if (floor.rows[0].projection_sha256 === null && next.rows[0].projection_sha256 !== null)
          fail('STANDARD_PR_INCIDENT_CLOSE_PROJECTION_CHANGED');
        context = fresh; floor = next; borrowed.assertCurrent();
      };
      const evidence = request => {
        check();
        if (request.instance_id !== context.prefix.instance_id || request.incident_id !== context.inner.incident_id
          || request.incident_sha256 !== context.inner.incident_sha256) fail('STANDARD_PR_INCIDENT_CLOSE_EVIDENCE_CHANGED');
        const expected = context.authenticate();
        if (artifacts.read(context.inner.incident_path).sha256 !== null) {
          const actual = context.reader.read(request);
          if (!same(actual, expected)) fail('STANDARD_PR_INCIDENT_CLOSE_EVIDENCE_CHANGED');
        } else if (floor.states.slice(1).some(state => state !== 'after')) fail('STANDARD_PR_INCIDENT_CLOSE_RETAINED_TRACE_REQUIRED');
        return expected;
      };
      const unresolved = reason => assertPrIncidentCloseOutput({ contract_version: 'standard-pr-incident-close-output.v1',
        operation_ref: prIncidentCloseOperation, outcome: 'reconciliation_required', effect_status: 'unknown', facts: {},
        observations: { incident_id: context.inner.incident_id, plan_sha256: context.plan.closure_plan_sha256,
          reason_code: /^[A-Z][A-Z0-9_]{0,127}$/.test(reason ?? '') ? reason : 'STANDARD_PR_INCIDENT_CLOSE_CONTINUATION_UNKNOWN' }, evidence_refs: [] });
      try {
        const result = await port(context.current, evidence, async point => {
          check(); await onBoundary(point, record.operation_id); check();
        }).apply(context.prefix, { can_apply: true, plan: context.inner, plan_sha256: context.plan.closure_plan_sha256 }, {
          write: true, expectPlan: context.plan.closure_plan_sha256,
          assertAuthorized: async () => { await assertAuthorized(); check(); },
        });
        check();
        if (result.outcome === 'completed') {
          if (!port(context.current, evidence).matchesCompletedArtifacts(context.prefix,
            { can_apply: true, plan: context.inner, plan_sha256: context.plan.closure_plan_sha256 }))
            fail('STANDARD_PR_INCIDENT_CLOSE_RETAINED_TRACE_REQUIRED');
          // This is a new confirmation of the original operation's postconditions,
          // including an already committed prefix; it is never a captured old success.
          return { output: context.continuation.expected_output, effect_knowledge: 'known_prefix' };
        }
        return { output: unresolved(result.reason_code), effect_knowledge: result.effect_status === 'unknown' ? 'unknown' : 'known_prefix' };
      } catch (cause) {
        return { output: unresolved(cause.code), effect_knowledge: 'unknown' };
      }
    },
    async apply(instance, input, prepared, { operationId, assertAuthorized } = {}) {
      input = freezeShadow(structuredClone(assertPrIncidentCloseInput(input)));
      instance = freezeShadow(structuredClone(instance));
      const plan = freezeShadow(structuredClone(assertPrIncidentClosePlan(prepared?.plan)));
      if (prepared.can_apply !== true || prepared.plan_sha256 !== shadowHash(plan)
        || !same(input, plan.input) || typeof assertAuthorized !== 'function') fail('STANDARD_PR_INCIDENT_CLOSE_EXPLICIT_EFFECT_REQUIRED');
      // readClaimed authenticates the retained MAC and preview, not JSON claims.
      const claimed = readClaimed(operationId), claimedSha = shadowHash(claimed);
      if (claimed.operation_id !== operationId || !same(claimed.preview.prepared, prepared)
        || !same(claimed.preview.input, input)) fail('STANDARD_PR_INCIDENT_CLOSE_CLAIM_CHANGED');
      const prefix = prIncidentCloseIntentPrefix(instance, claimed);
      const inner = freezeShadow(decodePrIncidentClosurePlan(plan));
      if (inner.instance_sha256 !== prefix.instance_sha256) fail('STANDARD_PR_INCIDENT_CLOSE_PREFIX_CHANGED');
      function current(id) {
        const actual = readCurrent(id);
        if (id !== instance.instance_id || !same(actual, instance) || shadowHash(readClaimed(operationId)) !== claimedSha)
          fail('STANDARD_PR_INCIDENT_CLOSE_CURRENT_CHANGED');
        return prefix;
      }
      const reader = createEvidenceReader(current);
      const authenticateSource = () => {
        current(instance.instance_id);
        const material = source(reader, prefix, input);
        if (!same(material, plan.source)) fail('STANDARD_PR_INCIDENT_CLOSE_SOURCE_CHANGED');
        return matchEvidence(inner, material, prefix);
      };
      const readEvidence = request => {
        const evidence = authenticateSource();
        if (request.instance_id !== prefix.instance_id || request.incident_id !== inner.incident_id
          || request.incident_sha256 !== inner.incident_sha256) fail('STANDARD_PR_INCIDENT_CLOSE_EVIDENCE_CHANGED');
        const tracker = artifacts.read(inner.incident_path);
        if (tracker.sha256 !== null) {
          const observed = reader.read(request);
          if (!same(observed, evidence)) fail('STANDARD_PR_INCIDENT_CLOSE_EVIDENCE_CHANGED');
          return observed;
        }
        // The original tracker digest comes from the authenticated preparation.
        // A missing tracker alone is never proof: both exact canonical traces
        // must already exist, with their original metadata CAS postimages.
        for (const change of inner.traces) {
          if (artifacts.read(change.path, { required: true }).sha256 !== change.after_sha256
            || artifacts.metadataHash(change.path) !== change.after_metadata_sha256)
            fail('STANDARD_PR_INCIDENT_CLOSE_RETAINED_TRACE_REQUIRED');
        }
        current(instance.instance_id); return evidence;
      };
      authenticateSource();
      const result = await port(current, readEvidence).apply(prefix,
        { can_apply: true, plan: inner, plan_sha256: plan.closure_plan_sha256 }, {
          write: true, expectPlan: plan.closure_plan_sha256,
          assertAuthorized: async () => { await assertAuthorized(); authenticateSource(); },
        });
      // A known committed prefix is not a no-effect block or a completed operation.
      // Keep the generic receipt unresolved until a separately authorized continuation.
      const partial = result.outcome === 'incomplete' && result.effect_status === 'confirmed';
      return assertPrIncidentCloseOutput({ contract_version: 'standard-pr-incident-close-output.v1', operation_ref: prIncidentCloseOperation,
        outcome: partial ? 'reconciliation_required' : result.outcome === 'incomplete' ? 'blocked' : result.outcome,
        effect_status: partial ? 'unknown' : result.effect_status,
        facts: result.outcome === 'completed' ? { session_pr_incident_cleanup_completed: true } : {},
        observations: { incident_id: result.incident_id, plan_sha256: result.plan_sha256, reason_code: result.reason_code },
        evidence_refs: partial ? [] : result.evidence_refs });
    },
  });
}
