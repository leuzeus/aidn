import assert from 'node:assert/strict';
import { assertGithubRequiredChecksPolicy, observeGithubRequiredChecks } from '../../src/adapters/git-provider/github-required-checks.mjs';
import { createStandardPrMergeConsent } from '../../src/application/runtime/standard-session-pr-merge-consent.mjs';
import { assertMergeConsentOutput, assertRequiredChecksOutput, mergeConsentOutput, mergeConsentQuestion } from '../../src/core/workflow/standard-pr-merge-consent.mjs';
import { assertDecisionInbox, decisionInboxId } from '../../src/core/workflow/process-decision-inbox.mjs';
import { shadowHash } from '../../src/core/workflow/shadow-json.mjs';

const sha = 'a'.repeat(64), head = '1'.repeat(40), base = '2'.repeat(40), op = 'op_' + 'c'.repeat(40);
const repository = { owner: 'fixture', name: 'repository', node_id: 'R_repo' };
const request = { pull_request_number: 7, expected_pull_request_id: 'PR_subject', expected_head_oid: head,
  expected_base_oid: base, expected_head_ref: 'session', expected_base_ref: 'dev' };
const entries = [{ name: 'Review CI', kind: 'check_run', producer_id: 'A_ci' },
  { name: 'Legacy CI', kind: 'commit_status', producer_id: 'U_ci' }];
const policy = { contract_version: 'standard-github-required-checks.v1', base_ref: 'dev', entries };
const endpoints = ['commits/' + head + '/check-runs?filter=all&per_page=100', 'commits/' + head + '/status?per_page=100', 'pulls/7']
  .map(suffix => 'repos/fixture/repository/' + suffix);
const run = { node_id: 'CR_result', name: 'Review CI', head_sha: head, app: { node_id: 'A_ci' }, status: 'completed', conclusion: 'success' };
const status = { node_id: 'S_result', context: 'Legacy CI', creator: { node_id: 'U_ci' }, state: 'success' };
const pr = { node_id: 'PR_subject', number: 7, state: 'open', draft: false, merged: false,
  head: { sha: head, ref: 'session', repo: { node_id: 'R_repo' } }, base: { sha: base, ref: 'dev', repo: { node_id: 'R_repo' } } };

function fixture(change = () => {}, suppliedPolicy = policy, { qualifyBase = false, comparison } = {}) {
  const responses = structuredClone([{ total_count: 1, check_runs: [run] }, { sha: head, total_count: 1, statuses: [status] }, pr]);
  change(...responses);
  const calls = [];
  if (comparison !== undefined) responses.push(comparison);
  const expected = comparison === undefined ? endpoints : [...endpoints, 'repos/fixture/repository/compare/' + base + '...' + responses[2].base.sha + '?per_page=1'];
  return { calls, observe: () => observeGithubRequiredChecks({ repository, policy: assertGithubRequiredChecksPolicy(suppliedPolicy), request, qualifyBase,
    async get(endpoint) {
      assert.equal(endpoint, expected[calls.length]);
      calls.push(endpoint);
      return responses[calls.length - 1];
    } }) };
}

const nominal = fixture();
const checks = await nominal.observe();
assert.deepEqual(nominal.calls, endpoints);
assert.deepEqual(checks, [{ ...entries[1], result_id: 'S_result', result_sha256: shadowHash(status) },
  { ...entries[0], result_id: 'CR_result', result_sha256: shadowHash(run) }]);
const changedEvidence = await fixture(runs => { runs.check_runs[0].details_url = 'https://example.com/changed'; }).observe();
assert.notEqual(changedEvidence[1].result_sha256, checks[1].result_sha256);
let passed = 1;
const successor = '3'.repeat(40), moved = (_runs, _statuses, pull) => { pull.base.sha = successor; };
const advance = { status: 'ahead', ahead_by: 2, behind_by: 0, base_commit: { sha: base }, merge_base_commit: { sha: base } };
assert.deepEqual(await fixture(undefined, policy, { qualifyBase: true }).observe(), { checks, base_oid: base, base_ahead_by: 0 });
assert.deepEqual(await fixture(moved, policy, { qualifyBase: true, comparison: advance }).observe(),
  { checks, base_oid: successor, base_ahead_by: 2 });
await assert.rejects(fixture(moved).observe, { code: 'STANDARD_PR_CHECK_SUBJECT_CHANGED' });
passed += 3;
for (const comparison of [{ ...advance, status: 'diverged' }, { ...advance, behind_by: 1 }, { ...advance, ahead_by: 0 },
  { ...advance, merge_base_commit: { sha: successor } }, null]) {
  await assert.rejects(fixture(moved, policy, { qualifyBase: true, comparison }).observe, { code: 'STANDARD_PR_TARGET_ADVANCE_UNPROVEN' });
  passed++;
}
for (const [code, change] of [
  ['INVENTORY_INVALID', runs => { runs.total_count = 2; }],
  ['INVENTORY_INVALID', runs => { runs.check_runs[0].head_sha = base; }],
  ['INVENTORY_INVALID', (_, statuses) => { statuses.sha = base; }],
  ['INVENTORY_INVALID', (_, statuses) => { statuses.total_count = 2; }],
  ['SUBJECT_CHANGED', (_, __, pr) => { pr.head.sha = base; }],
  ['SUBJECT_CHANGED', (_, __, pr) => { pr.base.ref = 'main'; }],
  ['SUBJECT_CHANGED', (_, __, pr) => { pr.head.repo.node_id = 'R_fork'; }],
  ['SUBJECT_CHANGED', (_, __, pr) => { pr.merged = true; }],
  ['MISSING', runs => { runs.check_runs = []; runs.total_count = 0; }],
  ['AMBIGUOUS', runs => { runs.check_runs.push({ ...run, node_id: 'CR_other' }); runs.total_count = 2; }],
  ['AMBIGUOUS', (_, statuses) => { statuses.statuses[0].context = 'Review CI'; }],
  ['PRODUCER_CHANGED', runs => { runs.check_runs[0].app.node_id = 'A_other'; }],
  ['PRODUCER_CHANGED', (_, statuses) => { statuses.statuses[0].creator.node_id = 'U_other'; }],
  ['PENDING', runs => { runs.check_runs[0].status = 'in_progress'; }],
  ['PENDING', (_, statuses) => { statuses.statuses[0].state = 'pending'; }],
  ['FAILED', runs => { runs.check_runs[0].conclusion = 'neutral'; }],
  ['FAILED', (_, statuses) => { statuses.statuses[0].state = 'failure'; }],
]) {
  await assert.rejects(fixture(change).observe, { code: 'STANDARD_PR_CHECK_' + code });
  passed++;
}
await assert.rejects(fixture(undefined, { ...policy, base_ref: 'main' }).observe, { code: 'STANDARD_PR_CHECK_POLICY_BASE_REQUIRED' });
for (const bad of [{ ...policy, entries: [] }, { ...policy, entries: [entries[0], entries[0]] }, { ...policy, head_oid: head }])
  assert.throws(() => assertGithubRequiredChecksPolicy(bad), { code: 'STANDARD_GITHUB_CHECK_POLICY_INVALID' });
passed += 4;
const absent = await createStandardPrMergeConsent({ now: Date.now }).acceptChecks({}, {});
assert.equal(absent.observations.reason_code, 'STANDARD_PR_CHECK_POLICY_REQUIRED');
assert.deepEqual(absent.facts, {});
assert.throws(() => assertRequiredChecksOutput({ ...absent, outcome: 'completed' }));
passed++;

for (const second of [
  { actor_id: 'U_other', policy_sha256: sha, checks },
  { actor_id: 'U_actor', policy_sha256: 'b'.repeat(64), checks },
  { actor_id: 'U_actor', policy_sha256: sha, checks: changedEvidence },
]) {
  const first = { actor_id: 'U_actor', policy_sha256: sha, checks };
  const app = createStandardPrMergeConsent({
    now: Date.now, reviewPort: { observeRequiredChecks: async () => second }, readCurrent: () => ({}),
    resolution: { readGate: async () => ({ before: first, decision: null, expires: null, observed: { actor: { node_id: 'U_actor' } } }) },
  });
  const output = await app.acceptChecks({}, {});
  assert.equal(output.observations.reason_code, 'STANDARD_PR_CHECK_EVIDENCE_CHANGED');
  assert.deepEqual(output.facts, {});
  passed++;
}


const subject = { triage_operation_id: op, update_operation_id: op, source_sha256: sha, repository_id: 'R_repo',
  pull_request_id: 'PR_subject', pull_request_number: 7, head_oid: head, base_oid: base, head_ref: 'session', base_ref: 'dev',
  actor_id: 'U_actor', resolution_operation_id: op, resolution_receipt_sha256: sha, resolution_expires_at_ms: 8000, policy_sha256: sha, checks };
const record = { operation_id: op, intent: { instance_id: 'fixture', scope_id: 'fixture', occurrence_id: 'fixture' },
  preview: { input: { triage_operation_id: op, checks_operation_id: op }, prepared: { prepared_at_ms: 2000, expires_at_ms: 8000, subject } } };
const question = mergeConsentQuestion(record);
assert.throws(() => mergeConsentQuestion({ ...record, preview: { ...record.preview, prepared: { ...record.preview.prepared, expires_at_ms: 8001 } } }));
const source = { contract_version: 'human-pr-merge-consent.v1', source_kind: 'human', authority_id: 'fixture',
  source_event_id: 'fixture_event', question_sha256: shadowHash(question), subject_sha256: shadowHash(subject),
  rationale: 'Reviewed the exact check evidence.', evidence_refs: [{ ref: 'github:pr-required-checks/PR_subject', sha256: sha }] };
for (const [choice, outcome] of [['approve_merge', 'completed'], ['refused', 'rejected'], ['deferred', 'deferred'], ['cancelled', 'cancelled']]) {
  const capture = { source: { ...source, choice }, inbox_id: 'decision_' + 'a'.repeat(40), source_ref: 'fixture' };
  const output = mergeConsentOutput(question, capture);
  assert.equal(output.outcome, outcome);
  assert.deepEqual(output.facts, outcome === 'completed' ? { session_pr_merge_consent_accepted: true } : {});
  assert.throws(() => assertMergeConsentOutput({ ...output, outcome: 'blocked' }));
  assert.throws(() => mergeConsentOutput({ ...question, subject: { ...subject, head_oid: base } }, capture),
    { code: 'PROCESS_HUMAN_QUESTION_CHANGED' });
  passed++;
}
const current = mergeConsentQuestion({ ...record, preview: { input: record.preview.input,
  binding: { output_contract: 'standard-pr-merge-consent-output.v2' }, prepared: { prepared_at_ms: 2000, subject } } });
assert.equal(current.contract_version, 'standard-pr-merge-consent-question.v2');
assert.equal(Object.hasOwn(current, 'expires_at_ms'), false);
assert.deepEqual(current.subject, { repository_id: 'R_repo', pull_request_id: 'PR_subject', pull_request_number: 7,
  head_oid: head, base_ref: 'dev' });
assert.deepEqual(current.qualification, subject);
const currentSource = { ...source, choice: 'approve_merge', question_sha256: shadowHash(current), subject_sha256: shadowHash(current.subject) };
const currentCapture = { contract_version: 'process-decision-inbox.v18', operation_id: op, inbox_id: decisionInboxId(currentSource),
  source: currentSource, source_ref: 'fixture', grant_sha256: sha, phase: 'reserved', receipt_sha256: null,
  key_id: sha, authentication: sha };
assert.deepEqual(assertDecisionInbox(currentCapture), currentCapture);
const currentOutput = mergeConsentOutput(current, currentCapture);
assert.equal(currentOutput.observations.grant_sha256, sha);
assert.equal(Object.hasOwn(currentOutput.observations, 'expires_at_ms'), false);
const { grant_sha256, ...withoutGrant } = currentCapture;
assert.throws(() => assertDecisionInbox(withoutGrant), { code: 'PROCESS_DECISION_INBOX_INVALID' });
assert.throws(() => mergeConsentOutput(current, withoutGrant), { code: 'STANDARD_OPERATION_OUTPUT_INVALID' });
passed++;
console.log(JSON.stringify({ status: 'PASS', checks: passed, scope: 'offline-provider-inventory-and-consent-contract' }));
