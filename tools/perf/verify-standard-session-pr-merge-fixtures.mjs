
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createAgenticProcessStore } from '../../src/adapters/runtime/agentic-process-store.mjs';
import { createGithubReviewFixture } from './github-review-evidence-fixture-lib.mjs';
import { createGithubPrMergeAsyncAdapter, createGithubPrReviewEffectsAsyncAdapter } from '../../src/adapters/git-provider/github-workflow-adapter.mjs';
import { standardWorkflowOperationBindings } from '../../src/application/runtime/standard-workflow-operations.mjs';
import { loadStandardWorkflowAssets } from '../../src/application/runtime/standard-workflow-composition.mjs';
import { createStandardPrReviewEffectsVerification } from '../../src/application/runtime/standard-session-pr-review-effects.mjs';
import { createStandardSessionPrMergeObservation } from '../../src/application/runtime/standard-session-pr-merge-observe.mjs';
import { advanceAgenticProcess, createAgenticProcess, inspectAgenticProcess } from '../../src/core/workflow/agentic-process.mjs';
import { simulateAgenticProcess } from '../../src/core/workflow/agentic-process-simulation.mjs';
import { processFrameModel, processFrameNode } from '../../src/core/workflow/process-call-model.mjs';
import { resolveProcessCallData } from '../../src/core/workflow/process-call-data.mjs';
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

function fixture(prefix = 'session', correctionsRequired = false, effects = null, { preflight = false } = {}) {
  const updateBinding = prefix === 'session' ? 'session_pr_update_push' : 'session_pr_redelivery_push';
  const target = published.call_targets.find(row => row.model_id === 'aidn-standard-pr-review-completion');
  const callSite = prefix + '_pr_effects_pending', triageNode = prefix + '_pr_triage_evaluate';
  const nodeIds = [prefix === 'session' ? updateBinding : 'correction_pr_redelivery_push',
    ...['review_receive', 'triage_select', 'triage_evaluate'].map(name => prefix + '_pr_' + name),
    effects ? callSite : prefix + '_pr_merge_observe'];
  const nodes = nodeIds.map(id => published.nodes.find(node => node.id === id));
  // Exercise the historical direct operation shape separately from the call.
  const direct = standardWorkflowOperationBindings().find(binding => binding.id === (preflight ? 'session_pr_premerge_observe' : 'session_pr_merge_observe'));
  if (!effects) nodes[nodes.length - 1] = { id: nodeIds.at(-1), kind: 'operation', participant_ref: 'project', binding_ref: direct.id };
  const terminal = effects ? published.data_bindings.inputs.find(row => row.node_id === callSite) : {
    node_id: nodeIds.at(-1), fields: { contract_version: { source: 'literal', value: 'standard-session-pr-merge-observe-input.v1' },
      triage_operation_id: { source: 'operation_id', node_id: triageNode } },
  };
  const model = { contract_version: 'agentic-process-model.v2', model_id: 'a9-fixture', revision: 1,
    participants: [{ id: 'project' }], roles: [], policies: [], entry: 'sequence',
    nodes: [{ id: 'sequence', kind: 'sequence', participant_ref: 'project', children: nodeIds }, ...nodes],
    operation_pins: Object.fromEntries(nodes.filter(node => node.kind === 'operation')
      .map(node => [node.binding_ref, node.binding_ref === direct.id ? shadowHash(direct) : published.operation_pins[node.binding_ref]])),
    ...(effects ? { call_targets: [target] } : {}),
    data_bindings: { contract_version: 'process-data-bindings.v4', parameter_keys: [],
      inputs: nodeIds.map(node_id => node_id === terminal.node_id ? terminal : { node_id, fields: {} }) } };
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
    assert.equal(processFrameNode(model, frame).binding_ref, binding);
    const id = operationJournalId(instance, frame.occurrence_id), intent = { contract_version: 'process-operation-intent.v1',
      operation_id: id, binding_ref: binding, binding_sha256: processFrameModel(model, frame).operation_pins[binding], input_sha256: shadowHash(input),
      preconditions_sha256: shadowHash(prepare ?? {}), authorization_sha256: null, authority_id: 'fixture_host', scope_id: instance.scope_id,
      instance_id: instance.instance_id, instance_sha256: instance.instance_sha256, model_sha256: instance.model_sha256,
      occurrence_id: frame.occurrence_id, instance_revision: instance.revision };
    instance = advanceAgenticProcess(instance, { event_id: 'intent_' + id, kind: 'operation_intent', occurrence_id: frame.occurrence_id, intent });
    const receipt = { contract_version: 'process-operation-receipt.v1', receipt_id: 'receipt_' + id, operation_id: id, intent_sha256: shadowHash(intent),
      authority_id: intent.authority_id, outcome: output.outcome, effect_status: output.effect_status, output_sha256: shadowHash(output),
      facts: output.facts, evidence_refs: [{ ref: operationOutputRef(id), sha256: shadowHash(output) }] };
    instance = advanceAgenticProcess(instance, { event_id: 'result_' + id, kind: 'operation_result', occurrence_id: frame.occurrence_id, receipt });
    retained.set(id, signer.seal({ record: { preview: { input, prepared_at_ms: effects?.triageAt ?? now }, intent, operation_id: id }, output, receipt }));
    return id;
  }
  function accept(binding, input, facts, observations) {
    return apply(binding, input, { outcome: 'completed', effect_status: 'no_effect', facts, observations, evidence_refs: [] });
  }
  const update = accept(updateBinding, {}, { session_pr_head_confirmed: true }, { pull_request: link });
  const payload = { event: { repository_id: link.repository_id, pull_request_id: link.node_id, pull_request_number: link.number,
    head_ref: link.head_branch, base_ref: link.base_branch, head_oid: head, base_oid: base, occurred_at: beforeMerge },
    observation: { observations: { update_operation_id: update, evidence: effects?.evidence ?? { observed_until: beforeMerge },
      threads: effects?.threads ?? { observed_until: beforeMerge } } } };
  const capture = signer.seal({ inbox_id: 'fixture_inbox', delivery: { delivery_id: 'fixture_delivery' }, payload });
  const received = accept('session_pr_review_receive', {}, { session_pr_review_event_received: true },
    { inbox_id: capture.inbox_id, delivery_sha256: shadowHash(capture.delivery), payload });
  const selection = accept('session_pr_triage_select', { received_operation_id: received }, { session_pr_triage_source_selected: true },
    { received_operation_id: received, payload, payload_sha256: shadowHash(payload) });
  const triage = accept('session_pr_triage_evaluate', {}, { session_pr_findings_classified: true,
    session_pr_corrections_required: correctionsRequired, session_pr_responses_required: true },
  { selection_operation_id: selection, received_operation_id: received, payload_sha256: shadowHash(payload),
    head_oid: head, base_oid: base, triage_completion: 'pending-effects-and-verification', merge_authorization: 'not-established',
    ...(effects ? { dispositions: effects.dispositions } : {}) });
  let callOccurrence;
  if (effects) {
    const cursor = inspectAgenticProcess(instance);
    const call = cursor.occurrences.find(row => row.node_id === callSite);
    assert.equal(call.wait_reason, 'call_entry');
    callOccurrence = call.occurrence_id;
    const data = resolveProcessCallData({ instance, cursor, occurrenceId: callOccurrence });
    assert.deepEqual(data.resolution.input, { triage_operation_id: triage });
    assert.deepEqual(data.witnesses, []);
    const event = { event_id: 'enter_pr_review', kind: 'call_enter', occurrence_id: callOccurrence, ...data };
    const forged = structuredClone(event);
    forged.resolution.input.triage_operation_id = update;
    assert.throws(() => advanceAgenticProcess(instance, forged), { code: 'PROCESS_CALL_RESOLUTION_CHANGED' });
    instance = advanceAgenticProcess(instance, event);
    // This verifier fixture starts from synthetic accepted selections. The
    // R08 FILES fixtures exercise selection, dispatch and recovery.
    accept('session_pr_premerge_observe', { contract_version: 'standard-session-pr-merge-observe-input.v1', triage_operation_id: triage },
      {}, { reason_code: 'STANDARD_PR_PREMERGE_OPEN' });
    accept('session_pr_review_reply_select', { contract_version: 'standard-pr-review-reply-select-input.v1', triage_operation_id: triage },
      { session_pr_replies_observed: true }, { selection: null });
    accept('session_pr_review_resolution_select', { contract_version: 'standard-pr-review-resolution-select-input.v1', triage_operation_id: triage },
      { session_pr_threads_observed_resolved: true, session_pr_resolution_exception_required: false,
        session_pr_resolution_gate_met: true }, { selection: null });
  }
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
  const open = (reviewPort = transport) => (effects ? createStandardPrReviewEffectsVerification : createStandardSessionPrMergeObservation)({
    now: effects ? Date.now : () => now, reviewPort,
    readAccepted, readAcceptedUpdate: (record, id) => readAccepted(record, id, updateBinding), readCurrent: () => instance,
    readDelivered: (_record, input) => { assert.equal(input.update_operation_id, update); return signer.verify(capture); },
    verifyEvent(value) {
      signer.verify(value);
      if (!provider.current) throw Object.assign(Error('fixture event revoked'), { code: 'PROCESS_CONTROL_PR_NOT_AUTHENTICATED' });
    } }, { preflight });
  const attempt = async (observer = open()) => {
    const cursor = inspectAgenticProcess(instance);
    const frame = cursor.occurrences.find(row => effects ? row.node_id === 'pr_review_effects_verify'
      && row.call_scope_id === callOccurrence : row.node_id === nodeIds.at(-1));
    const { input } = resolveProcessFrameInput({ instance, cursor, occurrenceId: frame.occurrence_id });
    assert.equal(input.triage_operation_id, triage);
    const prepared = observer.prepare(instance, input);
    const output = await observer.observe(instance, input, { sourceSha256: prepared.source_sha256 });
    const id = apply(effects ? 'session_pr_review_effects_verify' : preflight ? 'session_pr_premerge_observe' : 'session_pr_merge_observe', input, output, prepared);
    const next = inspectAgenticProcess(instance);
    if (output.outcome === 'completed') {
      const merge = next.occurrences.find(row => row.status === 'READY');
      assert.equal(merge.node_id, 'pr_checks_accept');
      assert.equal(merge.call_scope_id, callOccurrence);
      assert.deepEqual(resolveProcessFrameInput({ instance, cursor: next, occurrenceId: merge.occurrence_id }).input,
        { contract_version: 'standard-pr-checks-accept-input.v1', triage_operation_id: triage });
      assert.deepEqual(instance.events.at(-1).receipt.facts, { session_pr_review_effects_verified: true });
    } else {
      assert.equal(next.status, 'WAITING');
      assert.deepEqual(instance.events.at(-1).receipt.facts, {});
    }
    assert.equal(instance.events.at(-1).receipt.effect_status, 'no_effect');
    return { output, id };
  };
  return { provider, attempt, open, replay(cold = false) {
    instance = JSON.parse(JSON.stringify(instance));
    assert.equal(simulateAgenticProcess({ ...initial, events: instance.events }).trace.at(-1).instance_sha256, instance.instance_sha256);
    if (!cold) return;
    const parent = fs.realpathSync(os.tmpdir());
    const targetRoot = fs.mkdtempSync(path.join(parent, 'aidn-pr-review-call-'));
    try {
      fs.mkdirSync(path.join(targetRoot, '.aidn'));
      fs.writeFileSync(path.join(targetRoot, '.aidn', 'config.json'), JSON.stringify({ runtime: { stateMode: 'files' } }));
      const store = createAgenticProcessStore({ targetRoot, stateMode: 'files', env: {} });
      assert.equal(store.compareAndSwap(instance, null).written, true);
      const before = store.read(instance.instance_id).content_sha256;
      const child = spawnSync(process.execPath, ['--input-type=module', '-e', `
        import { readFileSync } from 'node:fs';
        import { createAgenticProcessStore } from ${JSON.stringify(new URL('../../src/adapters/runtime/agentic-process-store.mjs', import.meta.url).href)};
        import { createAgenticProcessService } from ${JSON.stringify(new URL('../../src/application/runtime/agentic-process-service.mjs', import.meta.url).href)};
        import { resolveProcessFrameInput } from ${JSON.stringify(new URL('../../src/core/workflow/process-frame-input.mjs', import.meta.url).href)};
        const { targetRoot, instanceId, callOccurrence } = JSON.parse(readFileSync(0, 'utf8'));
        const store = createAgenticProcessStore({ targetRoot, stateMode: 'files', env: {} });
        const { record: instance, cursor } = createAgenticProcessService({ store }).inspect(instanceId);
        const frame = cursor.occurrences.find(row => row.call_scope_id === callOccurrence && row.node_id === 'pr_review_effects_verify');
        const { input } = resolveProcessFrameInput({ instance, cursor, occurrenceId: frame.occurrence_id });
        console.log(JSON.stringify({ status: cursor.status, instance_sha256: instance.instance_sha256, input,
          call_entries: instance.events.filter(row => row.kind === 'call_enter' && row.occurrence_id === callOccurrence).length }));
      `], { input: JSON.stringify({ targetRoot, instanceId: instance.instance_id, callOccurrence }), encoding: 'utf8', windowsHide: true, timeout: 30000 });
      assert.equal(child.status, 0, child.stderr);
      assert.deepEqual(JSON.parse(child.stdout), { status: 'WAITING', instance_sha256: instance.instance_sha256,
        input: { contract_version: 'standard-session-pr-review-effects-input.v1', triage_operation_id: triage }, call_entries: 1 });
      assert.equal(store.read(instance.instance_id).content_sha256, before);
    } finally {
      const resolved = fs.realpathSync(targetRoot);
      assert.equal(resolved, targetRoot);
      assert.equal(path.dirname(resolved), parent);
      assert.ok(path.basename(resolved).startsWith('aidn-pr-review-call-'));
      fs.rmSync(resolved, { recursive: true });
    }
  } };
}

for (const prefix of ['session', 'correction']) {
  const premature = fixture(prefix, false, null, { preflight: true });
  Object.assign(premature.provider.pr, asMerged());
  const deferred = (await premature.attempt()).output;
  assert.equal(deferred.outcome, 'deferred');
  assert.equal(deferred.observations.merge_observation.provider.pull_request.merge_oid, merge);
  assert.deepEqual(deferred.facts, {});
  premature.replay();

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
async function reviewEffects(prefix, { correctionsRequired = false, disposition = 'invalid' } = {}) {
  const github = createGithubReviewFixture({ workingDirectory: os.tmpdir(), pullRequest: link });
  const date = new Date(Date.now() - 30000).toISOString(), author = { id: 'U_reviewer', login: 'fixture-reviewer', __typename: 'User' };
  const actor = { node_id: 'U_reply', login: 'fixture-actor' }, response = 'Technical rationale grounded in the fixture source.';
  const root = { id: 'C_root', author, body: 'Please fix this behavior.', commit: { oid: head }, originalCommit: { oid: head },
    createdAt: date, updatedAt: date, state: 'SUBMITTED', isMinimized: false, replyTo: null, publishedAt: date };
  const thread = { id: 'T_fixture', path: 'example.mjs', line: 1, isResolved: false, isOutdated: false,
    comments: { nodes: [root], totalCount: 1, pageInfo: { hasNextPage: false, endCursor: null } } };
  github.state.threads.push(thread);
  const request = { contract_version: 'github-pr-observation-request.v2', pull_request_number: link.number,
    expected_pull_request_id: link.node_id, expected_head_oid: head, expected_base_oid: base,
    expected_head_ref: link.head_branch, expected_base_ref: link.base_branch };
  const threads = await github.port.observePrContent(request);
  const evidence = await github.port.observeReviewContent({ ...request, contract_version: 'github-review-evidence-request.v1' });
  const config = { executable: process.execPath, executableSha256, workingDirectory: os.tmpdir(),
    repository: { owner: 'fixture', name: 'repository', node_id: link.repository_id } };
  const read = createGithubPrReviewEffectsAsyncAdapter(config, { async run(...args) {
    const response = github.run(...args), parsed = JSON.parse(response.stdout);
    parsed.data.repository.pullRequest.headRepository = { id: link.repository_id };
    return { ...response, stdout: JSON.stringify(parsed) };
  } });
  const triageAt = Date.now(), effects = { threads, evidence, triageAt, dispositions: [
    { kind: 'comment', node_id: root.id, thread_id: thread.id, disposition, proposed_response: response },
  ] };
  const component = fixture(prefix, correctionsRequired, effects);
  const port = { ...read, reviewEffectActor: actor, observeReviewContent: github.port.observeReviewContent };
  function reply(overrides = {}) {
    const published = new Date().toISOString();
    const value = { ...root, id: 'C_reply_' + thread.comments.totalCount, replyTo: { id: root.id },
      author: { id: actor.node_id, login: actor.login, __typename: 'User' }, body: response,
      createdAt: published, updatedAt: published, publishedAt: published, ...overrides };
    thread.comments.nodes.push(value); thread.comments.totalCount++;
    return value;
  }
  return { ...component, attempt: (observer = component.open(port)) => component.attempt(observer), github, reply, thread, root };
}

for (const prefix of ['session', 'correction']) {
  const f = await reviewEffects(prefix);
  const waiting = await f.attempt();
  assert.equal(waiting.output.outcome, 'deferred');
  assert.equal(waiting.output.observations.reason_code, 'STANDARD_PR_EFFECTS_REPLY_REQUIRED');
  const calls = f.github.calls.length;
  f.replay(true);
  assert.equal(f.github.calls.length, calls);
  f.reply();
  assert.equal((await f.attempt()).output.observations.reason_code, 'STANDARD_PR_EFFECTS_RESOLUTION_REQUIRED');
  f.thread.isResolved = true;
  f.replay();
  const { output, id } = await f.attempt();
  assert.equal(output.outcome, 'completed');
  assert.notEqual(id, waiting.id);
  assert.equal(output.observations.proof.head_oid, head);
  assert.equal(output.observations.proof.reply_count, 1);
  assert.equal(output.observations.proof.resolved_thread_count, 1);
  assert.throws(() => assertStandardOperationOutput({ ...output, outcome: 'deferred' }), { code: 'STANDARD_OPERATION_OUTPUT_INVALID' });
  assert.throws(() => assertStandardOperationOutput({ ...output, evidence_refs: [] }), { code: 'STANDARD_OPERATION_OUTPUT_INVALID' });
  f.replay();
  console.log('PASS ' + prefix + ' R08 waits for reply and resolution, replays without reads and advances with both');
}
for (const [label, change, code] of [
  ['wrong actor', f => f.reply({ author: f.root.author }), 'STANDARD_PR_EFFECTS_REVIEW_CHANGED'],
  ['wrong target', f => f.reply({ replyTo: { id: 'C_other' } }), 'STANDARD_PR_EFFECTS_REVIEW_CHANGED'],
  ['changed reply', f => f.reply({ body: 'different rationale' }), 'STANDARD_PR_EFFECTS_REVIEW_CHANGED'],
  ['minimized reply', f => f.reply({ isMinimized: true }), 'STANDARD_PR_EFFECTS_REPLY_REQUIRED'],
  ['draft reply', f => f.reply({ state: 'PENDING', publishedAt: null }), 'STANDARD_PR_EFFECTS_REPLY_REQUIRED'],
  ['reply before triage', f => f.reply({ createdAt: f.root.createdAt, publishedAt: f.root.publishedAt }), 'STANDARD_PR_EFFECTS_REPLY_REQUIRED'],
  ['duplicate reply', f => { f.reply(); f.reply(); }, 'STANDARD_PR_EFFECTS_REPLY_AMBIGUOUS'],
  ['edited source comment', f => { f.reply(); f.root.body = 'amended finding'; }, 'STANDARD_PR_EFFECTS_REVIEW_CHANGED'],
  ['edited review', f => { f.reply(); f.github.state.reviews[0].body = 'amended review'; }, 'STANDARD_PR_EFFECTS_REVIEW_CHANGED'],
  ['head moved', f => { f.github.state.pullRequest.head_oid = '5'.repeat(40); }, 'GITHUB_PR_SOURCE_CHANGED'],
  ['event revoked', f => { f.provider.current = false; }, 'PROCESS_CONTROL_PR_NOT_AUTHENTICATED'],
]) {
  const f = await reviewEffects('session');
  f.thread.isResolved = true;
  change(f);
  const { output } = await f.attempt();
  assert.notEqual(output.outcome, 'completed');
  assert.equal(output.observations.reason_code, code);
  assert.deepEqual(output.facts, {});
  console.log('PASS R08 ' + label + ' retains the gate');
}
const noReply = await reviewEffects('session', { disposition: 'not_a_finding' });
noReply.thread.isResolved = true;
const providerCalls = noReply.github.calls.length;
assert.equal((await noReply.attempt(noReply.open(null))).output.observations.reason_code, 'STANDARD_PR_EFFECTS_PROVIDER_REQUIRED');
assert.equal(noReply.github.calls.length, providerCalls);
const resolved = (await noReply.attempt()).output;
assert.equal(resolved.outcome, 'completed');
assert.equal(resolved.observations.proof.reply_count, 0);
assert.equal(resolved.observations.proof.resolved_thread_count, 1);
console.log('PASS R08 defers without a provider and accepts a resolved thread with no reply obligation');

const inconsistent = await reviewEffects('session');
inconsistent.reply();
inconsistent.thread.isResolved = true;
let threadReads = 0;
inconsistent.github.state.beforeCall = ({ query }) => {
  if (query.startsWith('query AidnReviewThreads') && ++threadReads === 2) inconsistent.thread.isResolved = false;
};
assert.equal((await inconsistent.attempt()).output.observations.reason_code, 'STANDARD_PR_EFFECTS_REVIEW_CHANGED');
console.log('PASS R08 a thread reopened between samples retains the gate');

const pendingCorrection = await reviewEffects('correction', { correctionsRequired: true, disposition: 'valid' });
const beforeCalls = pendingCorrection.github.calls.length;
assert.equal((await pendingCorrection.attempt()).output.observations.reason_code, 'STANDARD_PR_EFFECTS_CORRECTION_OR_TRIAGE_REQUIRED');
assert.equal(pendingCorrection.github.calls.length, beforeCalls);
console.log('PASS R08 outstanding correction defers before provider reads');
console.log(JSON.stringify({ status: 'PASS', proof: 'published-bindings-reducer-and-authenticated-fixture-receipts',
  provider_transport_and_event_authority: 'DOUBLED', installed: 'NOT_RUN', complete_standard_workflow: false }));
