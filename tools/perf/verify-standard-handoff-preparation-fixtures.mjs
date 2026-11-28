import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { removePathWithRetry } from './test-git-fixture-lib.mjs';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createFreshStandardWorkflowFixture } from './standard-workflow-fixture-lib.mjs';
import { createStandardWorkflowOperations } from '../../src/application/runtime/standard-workflow-operations.mjs';
import { createStandardWorkflowArtifacts } from '../../src/application/runtime/standard-workflow-artifacts.mjs';
import { createStandardHandoffPreparation } from '../../src/application/runtime/standard-handoff-preparation.mjs';
import { createStandardWorkflowGitCheckpoint } from '../../src/application/runtime/standard-workflow-git-checkpoint.mjs';
import { runSyncDbFirstSelectiveUseCase } from '../../src/application/runtime/sync-db-first-selective-use-case.mjs';
import { createLocalGitAdapter } from '../../src/adapters/runtime/local-git-adapter.mjs';
import { createLocalProcessAdapter } from '../../src/adapters/runtime/local-process-adapter.mjs';
import { assertModeWorkDecisionOutput } from '../../src/core/workflow/standard-mode-work-continuation.mjs';
import { handoffPreparationPaths } from '../../src/core/workflow/standard-handoff-preparation.mjs';
import { shadowHash as H } from '../../src/core/workflow/shadow-json.mjs';
export async function verifyStandardHandoffPreparationPorts({ modes = ['dual', 'db-only'] } = {}) {
  const owned = [], retained = new Set(), checks = [], hash = 'a'.repeat(64);
  const op = label => 'op_' + H(label).slice(0, 40), git = (root, ...args) => execFileSync('git', ['--no-optional-locks', '-C', root, ...args], { encoding: 'utf8', windowsHide: true });
  const check = (name, condition) => { assert(condition, name); checks.push(name); };
  try {
  for (const mode of modes) {
    const target = createFreshStandardWorkflowFixture(mode, owned), ops = createStandardWorkflowOperations({ targetRoot: target }), artifacts = createStandardWorkflowArtifacts({ targetRoot: target });
    const selected = { session_id: 'S001', session_branch: 'S001-standard', objective: 'Verify governed handoff preparation' };
    const initialized = await ops.prepareSession(selected), initializedOutput = await ops.initializeSession(initialized, { write: true, expectPlan: initialized.plan_sha256 });
    check(mode + ': actual v2 initialization', initializedOutput.outcome === 'completed');
    const modePlan = await ops.prepareMode({ session_id: 'S001', mode: 'THINKING' });
    check(mode + ': actual THINKING selection', (await ops.applyMode(modePlan, { write: true, expectPlan: modePlan.plan_sha256 })).outcome === 'completed');
    const startPlan = await ops.prepareStart({ session_id: 'S001' }), startOutput = await ops.finalizeStart(startPlan, { write: true, expectPlan: startPlan.plan_sha256 });
    check(mode + ': actual session start hook', startOutput.outcome === 'completed');
    // Actor identity/acceptance is an explicit fixture capability. All business
    // effects below use the actual source Git, artifact, hook and sync ports.
    const instance = { instance_id: 'fixture-handoff', instance_sha256: hash }, accepted = new Map();
    let revokeDuringSummary = false, revokeDuringCheckpoint = false, authorityRevoked = false;
    const verifyPermission = () => { if (authorityRevoked) throw Object.assign(new Error('FIXTURE_AUTHORIZATION_REVOKED'), { code: 'FIXTURE_AUTHORIZATION_REVOKED' }); };
    const observeRevocation = async apply => { try { const output = await apply(); return { returned: true, outcome: output.outcome, effect_status: output.effect_status }; }
      catch (cause) { return { returned: false, code: cause.code, effect_status: cause.effect_status }; } };
    const decisionId = op(mode + ':decision'), summaryId = op(mode + ':summary'), gitId = op(mode + ':git'), prepareId = op(mode + ':prepare');
    const decisionOutput = assertModeWorkDecisionOutput({ contract_version: 'standard-mode-work-decision-output.v2', operation_ref: 'mode_work_continue_decision',
      outcome: 'completed', effect_status: 'no_effect', facts: { mode_work_continue_requested: false, mode_analysis_completed: false, mode_work_handoff_requested: true },
      observations: { question_sha256: hash, review_sha256: hash, source_sha256: hash, current_context_sha256: H({ session_id: 'S001' }), choice: 'handoff',
        product_effects_authorized: false, retention_authorized: false, native_authority_renewed: false, inbox_id: 'decision_' + 'a'.repeat(40), source_ref: 'fixture-handoff',
        handoff: { contract_version: 'standard-handoff-publication-input.v1', next_agent_role: 'coordinator', next_agent_action: 'reanchor',
          next_agent_goal: 'Resume the same bounded analysis after reanchor', handoff_note: 'Fixture qualification', from_agent_role: 'coordinator', from_agent_action: 'relay' } }, evidence_refs: [] });
    accepted.set(decisionId, { binding: 'mode_work_continue_decision', record: { operation_id: decisionId, preview: { prepared: { current_context: { session_id: 'S001' }, review: { session_id: 'S001' } } } }, output: decisionOutput });
    const readAccepted = (_instance, id, binding) => { if (revokeDuringCheckpoint) authorityRevoked = true; const found = accepted.get(id); assert(found, 'retained source'); assert.equal(found.binding, binding); return structuredClone(found); };
    let decisionContext = { session_id: "S001" };
    const preparation = createStandardHandoffPreparation({ targetRoot: target, readAccepted, readCurrent: () => instance, readDecisionContext: () => { if (revokeDuringSummary) authorityRevoked = true; return structuredClone(decisionContext); }, observeScope: ops.observeScope });
    const canonical = () => artifacts.readMany(handoffPreparationPaths('S001'), { includeMetadata: true }).map(({ path, sha256, metadata_sha256 }) => ({ path, sha256, metadata_sha256 }));
    const original = canonical(), status = git(target, 'status', '--porcelain');
    const input = { session_id: 'S001', decision_operation_id: decisionId }, summary = await preparation.prepareSummary(instance, input, summaryId);
    check(mode + ': summary preview has no canonical or Git effect', H(canonical()) === H(original) && git(target, 'status', '--porcelain') === status);
    assert.equal(summary.can_apply, true, JSON.stringify(summary));
    await assert.rejects(preparation.applySummary(instance, summary), /EXPLICIT_EFFECT_REQUIRED/);
    decisionContext = { session_id: "S001", changed: true };
    await assert.rejects(preparation.applySummary(instance, summary, { write: true, expectPlan: summary.plan_sha256, assertAuthorized() {}, assertCurrent() {} }), { code: "STANDARD_HANDOFF_DECISION_CONTEXT_CHANGED" });
    check(mode + ": changed current H subject refuses before canonical summary", H(canonical()) === H(original) && artifacts.ownerPending() === false);
    decisionContext = { session_id: "S001" };
    revokeDuringSummary = true;
    const summaryRevoked = await observeRevocation(() => preparation.applySummary(instance, summary, { write: true, expectPlan: summary.plan_sha256, assertAuthorized: verifyPermission, assertCurrent() {} }));
    console.log(JSON.stringify({ authorization_revocation_probe: 'summary', mode, result: summaryRevoked, canonical_unchanged: H(canonical()) === H(original), owner_pending: artifacts.ownerPending() }));
    check(mode + ': permission revoked during summary preparation refuses before write', !summaryRevoked.returned && summaryRevoked.code === 'FIXTURE_AUTHORIZATION_REVOKED'
      && summaryRevoked.effect_status === 'no_effect' && H(canonical()) === H(original) && artifacts.ownerPending() === false && git(target, 'status', '--porcelain') === status);
    revokeDuringSummary = false; authorityRevoked = false;
    const summaryOutput = await preparation.applySummary(instance, summary, { write: true, expectPlan: summary.plan_sha256, assertAuthorized() {}, assertCurrent() {} });
    check(mode + ': summary uses canonical metadata CAS', summaryOutput.outcome === 'completed' && artifacts.read('CURRENT-STATE.md').content.includes('- Relay intent: coordinator/reanchor'));
    accepted.set(summaryId, { binding: 'handoff_summary_prepare', record: { operation_id: summaryId, preview: { input, prepared: summary } }, output: summaryOutput });
    const checkpoint = createStandardWorkflowGitCheckpoint({ targetRoot: target, readCurrent: () => instance, readContext: () => ({
      context_plan: summary.plan, context_output: summaryOutput, start_operation_id: op(mode + ':start'), start_output: startOutput,
      initialization: { operation_id: op(mode + ':initialize'), plan: initialized.plan, output: initializedOutput } }) }, { handoff: true });
    const gitInput = { summary_operation_id: summaryId }, gitPlan = await checkpoint.prepare(instance, gitInput, gitId);
    assert.equal(gitPlan.can_apply, true, JSON.stringify(gitPlan));
    check(mode + ': Git scope is exactly four canonical metadata documents', H(gitPlan.plan.documents.map(row => row.path)) === H(handoffPreparationPaths('S001')));
    const gitOutput = await checkpoint.apply(instance, gitPlan, { write: true, expectPlan: gitPlan.plan_sha256, assertAuthorized() {} });
    console.log(JSON.stringify({ handoff_git_checkpoint_result: mode, output: gitOutput, git_status: git(target, 'status', '--porcelain') }));
    check(mode + ': actual governed Git checkpoint', gitOutput.outcome === 'completed' && gitOutput.facts.handoff_git_checkpoint_completed === true && git(target, 'status', '--porcelain') === '');
    accepted.set(gitId, { binding: 'handoff_git_checkpoint', record: { operation_id: gitId, preview: { input: gitInput, prepared: gitPlan } }, output: gitOutput });
    if (mode !== 'files') {
      const visible = path.join(target, 'docs/audit/CURRENT-STATE.md'), beforeBytes = fs.readFileSync(visible), beforeCanonical = canonical();
      fs.appendFileSync(visible, '\n<!-- independently stale fixture projection -->\n');
      await assert.rejects(runSyncDbFirstSelectiveUseCase({ args: { stateMode: mode, strict: true, forceInFiles: false, auditRoot: 'docs/audit',
        sqliteFile: '.aidn/runtime/index/workflow-index.sqlite', fallbackFull: false }, targetRoot: target, gitAdapter: createLocalGitAdapter(), processAdapter: createLocalProcessAdapter(), importIntent: false }), { code: 'SYNC_IMPORTS_NOT_AUTHORIZED' });
      check(mode + ': restricted sync rejects before canonical import or repair', H(canonical()) === H(beforeCanonical));
      fs.writeFileSync(visible, beforeBytes);
    }
    const prepInput = { summary_operation_id: summaryId, git_operation_id: gitId }, prepared = await preparation.prepareCheckpoint(instance, prepInput, prepareId), beforePreparation = canonical();
    assert.equal(prepared.can_apply, true, JSON.stringify(prepared));
    check(mode + ': checkpoint preview preserves canonical content and metadata', H(canonical()) === H(beforePreparation));
    revokeDuringCheckpoint = true;
    const checkpointRevoked = await observeRevocation(() => preparation.applyCheckpoint(instance, prepared, { write: true, expectPlan: prepared.plan_sha256, assertAuthorized: verifyPermission, assertCurrent() {} }));
    const diagnosticCreated = fs.existsSync(path.join(target, '.aidn/runtime/context/handoff', prepareId));
    console.log(JSON.stringify({ authorization_revocation_probe: 'checkpoint', mode, result: checkpointRevoked, canonical_unchanged: H(canonical()) === H(beforePreparation), diagnostic_created: diagnosticCreated, owner_pending: artifacts.ownerPending() }));
    check(mode + ': permission revoked during checkpoint preparation refuses before diagnostics', !checkpointRevoked.returned && checkpointRevoked.code === 'FIXTURE_AUTHORIZATION_REVOKED'
      && checkpointRevoked.effect_status === 'no_effect' && H(canonical()) === H(beforePreparation) && !diagnosticCreated && artifacts.ownerPending() === false);
    revokeDuringCheckpoint = false; authorityRevoked = false;
    const output = await preparation.applyCheckpoint(instance, prepared, { write: true, expectPlan: prepared.plan_sha256, assertAuthorized() {}, assertCurrent() {} });
    console.log(JSON.stringify({ handoff_preparation_result: mode, output }));
    assert.equal(output.outcome, 'completed', JSON.stringify(output));
    check(mode + ': real preparation and canonical runtime digest complete', output.facts.handoff_preparation_completed === true && artifacts.read('RUNTIME-STATE.md').content.includes('runtime_state_mode: ' + mode));
    check(mode + ': source session and snapshot metadata are preserved', H(canonical().slice(2)) === H(beforePreparation.slice(2)));
    check(mode + ': owner and resource fence are released', artifacts.ownerPending() === false && artifacts.resourceFence().read().record.state === 'released');
    if (mode === 'files') {
      check(mode + ': optional hook hydration and sync reported separately', H(output.observations.skipped_stages) === H(['hook', 'hydration', 'sync']));
      const digest = artifacts.read('RUNTIME-STATE.md').content;
      check(mode + ': skipped diagnostics are absent from required runtime reads', !digest.includes('/hydrated-context.json') && !digest.includes('/codex-context.json'));
    }
    else check(mode + ': actual strict hook hydration and non-importing sync are retained', H(output.observations.completed_stages) === H(['hook', 'hydration', 'sync', 'current', 'runtime']) && output.evidence_refs.some(row => row.ref.endsWith('/hydrated-context.json')));
    if (mode === 'files') {
      const lateDecisionId = op(mode + ':late-decision'), lateId = op(mode + ':late-summary');
      decisionContext = { session_id: 'S001', revision: 2 };
      const lateDecision = structuredClone(decisionOutput); lateDecision.observations.current_context_sha256 = H(decisionContext);
      lateDecision.observations.handoff.next_agent_goal = 'Explicit second relay intent for the final authorization scope fixture';
      accepted.set(lateDecisionId, { binding: 'mode_work_continue_decision', record: { operation_id: lateDecisionId, preview: { prepared: { current_context: decisionContext, review: { session_id: 'S001' } } } }, output: lateDecision });
      const lateSummary = await preparation.prepareSummary(instance, { session_id: 'S001', decision_operation_id: lateDecisionId }, lateId);
      assert.equal(lateSummary.can_apply, true); let injected = false;
      const interrupted = await preparation.applySummary(instance, lateSummary, { write: true, expectPlan: lateSummary.plan_sha256, assertCurrent() {},
        assertAuthorized() {
          if (!injected && artifacts.read('CURRENT-STATE.md').sha256 === lateSummary.plan.after_sha256) {
            git(target, '-c', 'core.hooksPath=' + (process.platform === 'win32' ? 'NUL' : '/dev/null'), 'commit', '--allow-empty', '-m', 'foreign scope fixture'); injected = true;
          }
        } });
      check(mode + ': HEAD changes during final authorization retain UNKNOWN and owner', injected && interrupted.outcome === 'reconciliation_required'
        && interrupted.effect_status === 'unknown' && H(interrupted.facts) === H({}) && artifacts.ownerPending() === true);
      retained.add(target);
      console.log(JSON.stringify({ final_authorization_scope_probe: true, outcome: interrupted.outcome, owner_retained: true, fixture: target, replayed: false }));
    }
    console.log(JSON.stringify({ handoff_preparation_port: mode, checks: checks.length, project: target, human_control: 'fixture-capabilities', actual_native_clients: 0, complete_standard_workflow: false }));
  }
  const temporary = fs.realpathSync(os.tmpdir()), cleanup = [];
  for (const target of owned) {
    const resolved = fs.realpathSync(target);
    assert.equal(path.dirname(resolved), temporary); assert(path.basename(resolved).startsWith('aidn-standard-fresh-'));
    if (retained.has(target)) { cleanup.push({ target: resolved, removed: false, retained: "expected-UNKNOWN-scope-regression" }); continue; }
    const removed = removePathWithRetry(resolved); assert.equal(removed.ok, true); assert.equal(fs.existsSync(resolved), false);
    cleanup.push({ target: resolved, removed: true });
  }
  return { checks, cleanup, actual_native_clients: 0, proof_class: 'source-installed-physical-ports-with-fixture-actor-capabilities', complete_standard_workflow: false };
  } catch (error) { console.error(JSON.stringify({ handoff_preparation_fixture_failure: true, retained_owned_roots: owned })); throw error; }
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const mode = process.argv.find(value => value.startsWith('--mode='))?.split('=')[1];
  verifyStandardHandoffPreparationPorts(mode ? { modes: [mode] } : {}).then(result => console.log(JSON.stringify(result)))
    .catch(error => { console.error(error.stack); process.exitCode = 1; });
}
