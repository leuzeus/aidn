
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { createGithubPrMergeAsyncAdapter } from '../../src/adapters/git-provider/github-workflow-adapter.mjs';
import { loadStandardWorkflowAssets } from '../../src/application/runtime/standard-workflow-composition.mjs';
import { createStandardSessionPrMergeObservation } from '../../src/application/runtime/standard-session-pr-merge-observe.mjs';
import { advanceAgenticProcess, createAgenticProcess, inspectAgenticProcess } from '../../src/core/workflow/agentic-process.mjs';
import { simulateAgenticProcess } from '../../src/core/workflow/agentic-process-simulation.mjs';
import { resolveProcessFrameInput } from '../../src/core/workflow/process-frame-input.mjs';
import { createOperationJournalSigner, operationJournalId, operationOutputRef } from '../../src/core/workflow/process-operation-journal.mjs';
import { assertStandardOperationOutput } from '../../src/core/workflow/standard-operation-contracts.mjs';
import { shadowHash } from '../../src/core/workflow/shadow-json.mjs';

const { model: published } = loadStandardWorkflowAssets();
const H = 'a'.repeat(64), head = '1'.repeat(40), base = '2'.repeat(40), merge = '3'.repeat(40), tip = '4'.repeat(40);
const now = Date.parse('2026-11-07T18:00:00Z'), beforeMerge = new Date(now - 20000).toISOString(), mergedAt = new Date(now - 10000).toISOString();
const signer = createOperationJournalSigner(() => Buffer.alloc(32, 17));
const executableSha256 = createHash('sha256').update(fs.readFileSync(process.execPath)).digest('hex');
const link = { repository_id: 'R_fixture', node_id: 'PR_fixture', number: 7, head_branch: 'S001-fixture',
  base_branch: 'dev', head_oid: head, base_oid: base, state: 'OPEN', draft: false, url: 'https://github.com/fixture/repository/pull/7' };
const asMerged = () => ({ state: 'MERGED', merged: true, mergedAt,
  mergeCommit: { oid: merge, parents: { totalCount: 2, nodes: [{ oid: base }, { oid: head }], pageInfo: { hasNextPage: false } } },
  baseRef: { target: { oid: tip } } });

function fixture(prefix = 'session', correctionsRequired = false) {
  const updateBinding = prefix === 'session' ? 'session_pr_update_push' : 'session_pr_redelivery_push';
  const nodeIds = [prefix === 'session' ? updateBinding : 'correction_pr_redelivery_push',
    ...['review_receive', 'triage_select', 'triage_evaluate', 'merge_observe'].map(name => prefix + '_pr_' + name)];
  const nodes = nodeIds.map(id => published.nodes.find(node => node.id === id));
  const model = { contract_version: 'agentic-process-model.v2', model_id: 'a9-fixture', revision: 1,
    participants: [{ id: 'project' }], roles: [], policies: [], entry: 'sequence',
    nodes: [{ id: 'sequence', kind: 'sequence', participant_ref: 'project', children: nodeIds }, ...nodes],
    operation_pins: Object.fromEntries(nodes.map(node => [node.binding_ref, published.operation_pins[node.binding_ref]])),
    data_bindings: { contract_version: 'process-data-bindings.v4', parameter_keys: [],
      inputs: nodeIds.map(node_id => node_id === nodeIds.at(-1)
        ? published.data_bindings.inputs.find(row => row.node_id === node_id) : { node_id, fields: {} }) } };
  const initial = { instanceId: 'merge-fixture', scopeId: 'fixture-scope', model, policyPins: {}, facts: {}, parameters: {} };
  let instance = createAgenticProcess(initial);
  const retained = new Map(), provider = {
    repo: { id: link.repository_id, nameWithOwner: 'fixture/repository' },
    pr: { id: link.node_id, number: link.number, headRefOid: head, headRefName: link.head_branch, baseRefName: link.base_branch,
      headRepository: { id: link.repository_id }, isDraft: false, state: 'OPEN', merged: false, mergedAt: null,
      mergeCommit: null, baseRef: { target: { oid: base } } },
    calls: 0, onRead() {}, current: true,
  };
  function apply(binding, input, output, prepare) {
    const cursor = inspectAgenticProcess(instance);
    const frame = cursor.occurrences.find(row => row.status === 'READY' || row.operation?.receipt?.outcome === 'deferred' || row.operation?.receipt?.outcome === 'blocked');
    assert.equal(nodes.find(node => node.id === frame.node_id).binding_ref, binding);
    const id = operationJournalId(instance, frame.occurrence_id), intent = { contract_version: 'process-operation-intent.v1',
      operation_id: id, binding_ref: binding, binding_sha256: model.operation_pins[binding], input_sha256: shadowHash(input),
      preconditions_sha256: shadowHash(prepare ?? {}), authorization_sha256: null, authority_id: 'fixture_host', scope_id: instance.scope_id,
      instance_id: instance.instance_id, instance_sha256: instance.instance_sha256, model_sha256: instance.model_sha256,
      occurrence_id: frame.occurrence_id, instance_revision: instance.revision };
    instance = advanceAgenticProcess(instance, { event_id: 'intent_' + id, kind: 'operation_intent', occurrence_id: frame.occurrence_id, intent });
    const receipt = { contract_version: 'process-operation-receipt.v1', receipt_id: 'receipt_' + id, operation_id: id, intent_sha256: shadowHash(intent),
      authority_id: intent.authority_id, outcome: output.outcome, effect_status: output.effect_status, output_sha256: shadowHash(output),
      facts: output.facts, evidence_refs: [{ ref: operationOutputRef(id), sha256: shadowHash(output) }] };
    instance = advanceAgenticProcess(instance, { event_id: 'result_' + id, kind: 'operation_result', occurrence_id: frame.occurrence_id, receipt });
    retained.set(id, signer.seal({ record: { preview: { input }, intent, operation_id: id }, output, receipt }));
    return id;
  }
  function accept(binding, input, facts, observations) {
    return apply(binding, input, { outcome: 'completed', effect_status: 'no_effect', facts, observations, evidence_refs: [] });
  }
  const update = accept(updateBinding, {}, { session_pr_head_confirmed: true }, { pull_request: link });
  const payload = { event: { repository_id: link.repository_id, pull_request_id: link.node_id, pull_request_number: link.number,
    head_ref: link.head_branch, base_ref: link.base_branch, head_oid: head, base_oid: base, occurred_at: beforeMerge },
    observation: { observations: { update_operation_id: update, evidence: { observed_until: beforeMerge }, threads: { observed_until: beforeMerge } } } };
  const capture = signer.seal({ inbox_id: 'fixture_inbox', delivery: { delivery_id: 'fixture_delivery' }, payload });
  const received = accept('session_pr_review_receive', {}, { session_pr_review_event_received: true },
    { inbox_id: capture.inbox_id, delivery_sha256: shadowHash(capture.delivery), payload });
  const selection = accept('session_pr_triage_select', { received_operation_id: received }, { session_pr_triage_source_selected: true },
    { received_operation_id: received, payload, payload_sha256: shadowHash(payload) });
  const triage = accept('session_pr_triage_evaluate', {}, { session_pr_findings_classified: true,
    session_pr_corrections_required: correctionsRequired, session_pr_responses_required: true },
  { selection_operation_id: selection, received_operation_id: received, payload_sha256: shadowHash(payload),
    head_oid: head, base_oid: base, triage_completion: 'pending-effects-and-verification', merge_authorization: 'not-established' });
  const transport = createGithubPrMergeAsyncAdapter({ executable: process.execPath, executableSha256, workingDirectory: os.tmpdir(),
    repository: { owner: 'fixture', name: 'repository', node_id: link.repository_id } }, { now: () => now,
    async run(_bin, args, options) {
      assert.deepEqual(args, ['api', 'graphql', '--hostname', 'github.com', '--input', '-']);
      const query = JSON.parse(options.input);
      assert.match(query.query, /^query AidnPrMerge/); assert.doesNotMatch(query.query, /mutation|reviewThreads/);
      assert.deepEqual(query.variables, { owner: 'fixture', name: 'repository', number: 7 });
      provider.calls++; provider.onRead();
      return { status: 0, stdout: JSON.stringify({ data: { repository: { ...provider.repo, pullRequest: provider.pr } } }) };
    } });
  const readAccepted = (record, id, binding) => {
    const row = signer.verify(retained.get(id));
    assert.equal(row.record.intent.binding_ref, binding);
    assert.ok(record.events.some(event => event.kind === 'operation_result' && shadowHash(event.receipt) === shadowHash(row.receipt)));
    return row;
  };
  const open = (reviewPort = transport) => createStandardSessionPrMergeObservation({ now: () => now, reviewPort,
    readAccepted, readAcceptedUpdate: (record, id) => readAccepted(record, id, updateBinding), readCurrent: () => instance,
    readDelivered: (_record, input) => { assert.equal(input.update_operation_id, update); return signer.verify(capture); },
    verifyEvent(value) {
      signer.verify(value);
      if (!provider.current) throw Object.assign(Error('fixture event revoked'), { code: 'PROCESS_CONTROL_PR_NOT_AUTHENTICATED' });
    } });
  const attempt = async (observer = open()) => {
    const cursor = inspectAgenticProcess(instance), frame = cursor.occurrences.find(row => row.node_id === nodeIds.at(-1));
    const { input } = resolveProcessFrameInput({ instance, cursor, occurrenceId: frame.occurrence_id });
    assert.equal(input.triage_operation_id, triage);
    const prepared = observer.prepare(instance, input);
    const output = await observer.observe(instance, input, { sourceSha256: prepared.source_sha256 });
    const id = apply('session_pr_merge_observe', input, output, prepared);
    assert.equal(inspectAgenticProcess(instance).status, 'WAITING');
    assert.deepEqual(instance.events.at(-1).receipt.facts, {});
    assert.equal(instance.events.at(-1).receipt.effect_status, 'no_effect');
    return { output, id };
  };
  return { provider, attempt, open, replay() {
    instance = JSON.parse(JSON.stringify(instance));
    assert.equal(simulateAgenticProcess({ ...initial, events: instance.events }).trace.at(-1).instance_sha256, instance.instance_sha256);
  } };
}

for (const prefix of ['session', 'correction']) {
  const f = fixture(prefix);
  const pending = await f.attempt();
  assert.equal(pending.output.observations.reason_code, 'STANDARD_PR_MERGE_AWAITING_PROVIDER');
  f.replay();
  Object.assign(f.provider.pr, asMerged());
  const observed = await f.attempt();
  const proof = observed.output.observations.merge_observation;
  assert.equal(observed.output.observations.reason_code, 'STANDARD_PR_MERGE_REVIEW_EFFECTS_REQUIRED');
  assert.equal(proof.pre_merge_base_oid, base); assert.equal(proof.provider.pull_request.observed_base_tip_oid, tip);
  assert.equal(proof.provider.pull_request.merge_oid, merge); assert.equal(f.provider.calls, 4);
  assert.notEqual(observed.id, pending.id);
  assert.throws(() => assertStandardOperationOutput({ ...observed.output, outcome: 'completed' }), { code: 'STANDARD_OPERATION_OUTPUT_INVALID' });
  f.replay();
  console.log('PASS ' + prefix + ' OPEN wait, fresh MERGED proof, new receipt and exact reducer replay');
}
for (const [label, change, code] of [
  ['closed without merge', f => { f.provider.pr.state = 'CLOSED'; }, 'STANDARD_PR_MERGE_CLOSED_UNMERGED'],
  ['other repository', f => { f.provider.repo.id = 'R_other'; }, 'GITHUB_PR_SOURCE_CHANGED'],
  ['fork', f => { f.provider.pr.headRepository.id = 'R_other'; }, 'STANDARD_PR_MERGE_SUBJECT_CHANGED'],
  ['other PR', f => { f.provider.pr.id = 'PR_other'; }, 'GITHUB_PR_SOURCE_CHANGED'],
  ['other HEAD', f => { f.provider.pr.headRefOid = tip; }, 'GITHUB_PR_SOURCE_CHANGED'],
  ['other branch', f => { f.provider.pr.baseRefName = 'other'; }, 'GITHUB_PR_SOURCE_CHANGED'],
  ['changed base tip while open', f => { f.provider.pr.baseRef.target.oid = tip; }, 'GITHUB_PR_SOURCE_CHANGED'],
  ['different merge base', f => { Object.assign(f.provider.pr, asMerged()); f.provider.pr.mergeCommit.parents.nodes[0].oid = '5'.repeat(40); }, 'GITHUB_PR_SOURCE_CHANGED'],
  ['wrong second parent', f => { Object.assign(f.provider.pr, asMerged()); f.provider.pr.mergeCommit.parents.nodes[1].oid = tip; }, 'GITHUB_PR_MERGE_OBSERVATION_INVALID'],
  ['incomplete ancestry', f => { Object.assign(f.provider.pr, asMerged()); f.provider.pr.mergeCommit.parents.pageInfo.hasNextPage = true; }, 'GITHUB_PR_MERGE_OBSERVATION_INVALID'],
  ['merge predates review', f => { Object.assign(f.provider.pr, asMerged(), { mergedAt: new Date(now - 40000).toISOString() }); }, 'STANDARD_PR_MERGE_SUBJECT_CHANGED'],
  ['changing provider state', f => { f.provider.onRead = () => { if (f.provider.calls === 2) Object.assign(f.provider.pr, asMerged()); }; }, 'STANDARD_PR_MERGE_OBSERVATION_CHANGED'],
  ['revoked human/provider event', f => { f.provider.onRead = () => { f.provider.current = false; }; }, 'PROCESS_CONTROL_PR_NOT_AUTHENTICATED'],
]) {
  const f = fixture(); change(f);
  const { output } = await f.attempt();
  assert.equal(output.outcome, 'blocked'); assert.deepEqual(output.observations, { reason_code: code });
  assert.deepEqual(output.evidence_refs, []);
  console.log('PASS ' + label + ' refused without a merge proof');
}
const squash = fixture();
Object.assign(squash.provider.pr, asMerged());
squash.provider.pr.mergeCommit.parents = { totalCount: 1, nodes: [{ oid: base }], pageInfo: { hasNextPage: false } };
assert.equal((await squash.attempt()).output.observations.merge_observation.provider.pull_request.merge_oid, merge);
console.log('PASS a single-parent merge with the exact pre-merge base is observed');
const due = fixture('correction', true);
assert.equal((await due.attempt()).output.observations.reason_code, 'STANDARD_PR_MERGE_REVIEW_EFFECTS_REQUIRED');
assert.equal(due.provider.calls, 0);
const offline = fixture();
assert.equal((await offline.attempt(offline.open(null))).output.observations.reason_code, 'STANDARD_PR_MERGE_PROVIDER_REQUIRED');
assert.equal(offline.provider.calls, 0);
console.log('PASS a new correction or a missing observation port retains its wait without provider calls');
console.log(JSON.stringify({ status: 'PASS', proof: 'published-bindings-reducer-and-authenticated-fixture-receipts',
  provider_transport_and_event_authority: 'DOUBLED', installed: 'NOT_RUN', complete_standard_workflow: false }));
