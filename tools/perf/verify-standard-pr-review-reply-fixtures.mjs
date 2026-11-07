import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createFreshStandardWorkflowFixture } from './standard-workflow-fixture-lib.mjs';
import { createGithubReviewFixture } from './github-review-evidence-fixture-lib.mjs';
import { createAgenticProcessStore } from '../../src/adapters/runtime/agentic-process-store.mjs';
import { createProcessControlInboxStore } from '../../src/adapters/runtime/process-control-inbox-store.mjs';
import { createProcessOperationJournalStore } from '../../src/adapters/runtime/process-operation-journal-store.mjs';
import { createStandardHostAuthority } from '../../src/adapters/runtime/standard-host-authority.mjs';
import { createStandardProcessAuthority } from '../../src/application/runtime/standard-process-authority.mjs';
import { resolveStandardProcessInput } from '../../src/application/runtime/standard-process-inputs.mjs';
import { createStandardPrReviewControlSource } from '../../src/application/runtime/standard-session-pr-review-control-source.mjs';
import { createStandardSessionPrReviewContentObservation } from '../../src/application/runtime/standard-session-pr-review-observe.mjs';
import { loadStandardWorkflowAssets } from '../../src/application/runtime/standard-workflow-composition.mjs';
import { createStandardWorkflowOperationHost } from '../../src/application/runtime/standard-workflow-operation-host.mjs';
import { standardWorkflowOperationBindings } from '../../src/application/runtime/standard-workflow-operations.mjs';
import { advanceAgenticProcess, inspectAgenticProcess } from '../../src/core/workflow/agentic-process.mjs';
import { simulateAgenticProcess } from '../../src/core/workflow/agentic-process-simulation.mjs';
import { controlDelivery } from '../../src/core/workflow/process-control-inbox.mjs';
import { createOperationJournalSigner, operationJournalId, operationOutputRef } from '../../src/core/workflow/process-operation-journal.mjs';
import { shadowHash } from '../../src/core/workflow/shadow-json.mjs';

const { model: published } = loadStandardWorkflowAssets();
const bindings = new Map(standardWorkflowOperationBindings().map(binding => [binding.id, binding]));
const target = published.call_targets.find(row => row.model_id === 'aidn-standard-pr-review-completion');
const eventRef = 'REVIEW_fixture';
const response = 'Technical reply from the accepted fixture triage.';
const dummy = 'op_' + 'a'.repeat(40);
const pin = path => ({ path, sha256: createHash('sha256').update(fs.readFileSync(path)).digest('hex') });
const json = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const save = (file, data) => fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');

function fixtureModel(prefix) {
  const corrective = prefix === 'correction';
  const update = corrective ? 'correction_pr_redelivery_push' : 'session_pr_update_push';
  const observe = prefix + '_pr_review_observe', wait = prefix + '_pr_review_wait', receive = prefix + '_pr_review_receive';
  const select = prefix + '_pr_triage_select', triage = prefix + '_pr_triage_evaluate', call = prefix + '_pr_effects_pending';
  const node = id => published.nodes.find(row => row.id === id);
  const root = { id: 'fixture', kind: 'sequence', participant_ref: 'project', children: [update, observe, wait, receive, select, triage, call] };
  const nodes = [root, ...root.children.map(node), ...node(wait).branches.map(branch => node(branch.node_id))];
  const literal = value => ({ source: 'literal', value });
  const input = (id, fields) => ({ node_id: id, fields: Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, literal(value)])) });
  const fields = id => published.data_bindings.inputs.find(row => row.node_id === id);
  const model = { contract_version: published.contract_version, model_id: 'fixture-r08', revision: 1, participants: published.participants,
    policies: [], roles: [], entry: root.id, nodes,
    operation_pins: Object.fromEntries(nodes.filter(row => row.binding_ref).map(row => [row.binding_ref, published.operation_pins[row.binding_ref]])),
    call_targets: [target], data_bindings: { contract_version: 'process-data-bindings.v4', parameter_keys: [], inputs: [
      input(update, { contract_version: bindings.get(node(update).binding_ref).input_contract,
        ...(corrective ? { integration_operation_id: dummy, cycle_operation_id: dummy } : { checkpoint_operation_id: dummy }) }),
      fields(observe), fields(receive), fields(select),
      input(triage, { contract_version: bindings.get(node(triage).binding_ref).input_contract, report_occurrence_id: 'fixture_report' }),
      fields(call),
    ] } };
  return { model, update, observe, wait, receive, select, triage, call };
}

function open(base, { initializeKey = false } = {}) {
  const data = json(path.join(base, 'configuration.json'));
  const { configuration, binding, pr, prefix, behavior, submittedAt } = data;
  const instanceId = configuration.instance_id, targetRoot = configuration.target_root;
  const options = { targetRoot, stateMode: 'files' };
  const providerFile = path.join(base, 'provider.json'), state = json(providerFile);
  const fixture = createGithubReviewFixture({ workingDirectory: base, pullRequest: pr });
  const review = fixture.state.reviews[0];
  Object.assign(review, { submittedAt, updatedAt: submittedAt, author: {
    id: binding.reviewer.node_id, login: binding.reviewer.login, __typename: binding.reviewer.type,
  } });
  const author = { ...review.author };
  const rootComment = { id: 'C_root', author, body: 'Inline finding.', createdAt: submittedAt, updatedAt: submittedAt,
    publishedAt: submittedAt, state: 'SUBMITTED', isMinimized: false, commit: { oid: pr.head_oid }, originalCommit: { oid: pr.head_oid }, replyTo: null };
  const roots = prefix === 'session' ? [rootComment, { ...rootComment, id: 'C_other' }] : [rootComment];
  const connection = nodes => ({ nodes, totalCount: nodes.length, pageInfo: { hasNextPage: false, endCursor: null } });
  const ok = value => ({ status: 0, stdout: typeof value === 'string' ? value : JSON.stringify(value) });
  let permitted, denied = false, revokeAt = null, grants = 0, calls = 0, crash = false;
  const providerTransport = {
    runGithub() { assert.fail('Unexpected GitHub effect'); },
    runRemoteGit() { assert.fail('Unexpected Git transport'); },
    async runGithubRead(binary, args, options) {
      assert.equal(binary, binding.gh.path);
      calls++;
      if (args[0] === 'auth') return ok('fixture-only-token');
      if (args.at(-1) === 'user') return ok({ node_id: binding.actor.node_id, login: binding.actor.login });
      if (args.at(-1) === 'repos/fixture/repository') return ok({ node_id: pr.repository_id, full_name: 'fixture/repository' });
      const { query, variables } = JSON.parse(options.input);
      if (query.startsWith('query AidnPrReviewEvent')) {
        assert.deepEqual(variables, { id: eventRef });
        return ok({ data: { node: { __typename: 'PullRequestReview', ...review, isMinimized: false,
          repository: { id: pr.repository_id, nameWithOwner: 'fixture/repository' },
          pullRequest: { id: pr.node_id, number: pr.number, headRefOid: pr.head_oid, baseRefOid: pr.base_oid,
            headRefName: pr.head_branch, baseRefName: pr.base_branch, isDraft: false, state: 'OPEN', merged: false, mergedAt: null, mergeCommit: null,
            baseRef: { target: { oid: pr.base_oid } }, headRepository: { id: pr.repository_id }, baseRepository: { id: pr.repository_id } },
        } } });
      }
      fixture.state.threads = roots.map((root, index) => ({
        id: 'T_' + root.id, path: 'product.mjs', line: index + 1, isResolved: state.resolved, isOutdated: false,
        comments: connection([root, ...state.replies.filter(reply => reply.replyTo.id === root.id)]),
      }));
      const result = fixture.run(binary, args, options), value = JSON.parse(result.stdout);
      if (state.reviewChanged && value.data.repository.pullRequest.reviews)
        value.data.repository.pullRequest.reviews.nodes[0].body += ' changed';
      value.data.repository.pullRequest.headRepository = { id: pr.repository_id };
      return ok(value);
    },
    async runGithubReply(binary, args, options) {
      assert.equal(binary, binding.gh.path);
      assert.deepEqual(args, ['api', 'graphql', '--hostname', 'github.com', '--input', '-']);
      const { query, variables: { input } } = JSON.parse(options.input);
      assert.match(query, /^mutation AidnPrReviewReply/);
      const root = roots.find(root => input.pullRequestReviewThreadId === 'T_' + root.id);
      assert.ok(root);
      assert.equal(input.body, response);
      const record = host.readJournal(input.clientMutationId);
      assert.equal(record.phase, 'dispatching');
      assert.equal(record.preview.prepared.plan.provider.plan.request.target_comment_id, root.id);
      assert.equal(record.intent.authorization_sha256, shadowHash(record.grant));
      assert.equal(record.owner.pid, process.pid);
      assert.ok(!state.sent.includes(root.id));
      state.sent.push(root.id);
      if (behavior !== 'missing') {
        const date = new Date().toISOString();
        state.replies.push({ ...root, id: 'R_' + root.id, author: { id: binding.actor.node_id, login: binding.actor.login, __typename: 'User' },
          body: input.body, createdAt: date, updatedAt: date, publishedAt: date, replyTo: { id: root.id } });
      }
      save(providerFile, state);
      if (behavior === 'lost') throw Error('Fixture lost acknowledgement');
      return ok({ data: { addPullRequestReviewThreadReply: { clientMutationId: input.clientMutationId,
        comment: { id: 'R_' + root.id, replyTo: { id: root.id } } } } });
    },
  };
  const environment = { ...process.env, AIDN_STANDARD_HOST_HOME: data.home };
  const authority = createStandardHostAuthority({ configuration, environment }, { providerTransport });
  const { githubProvider: provider, readKey } = authority;
  if (initializeKey) authority.ensureKey();
  const signer = createOperationJournalSigner(readKey), graph = fixtureModel(prefix), { model } = graph;
  const processAuthority = createStandardProcessAuthority({ configuration, model, readSigningKey: readKey,
    readProductSha256: () => pin(path.join(targetRoot, 'AGENTS.md')).sha256 });
  const host = createStandardWorkflowOperationHost({ targetRoot, model, processAuthority, readSigningKey: readKey,
    sessionPushPort: provider.sessionPushPort, sessionPullRequestPort: provider.sessionPullRequestPort,
    sessionReviewPort: provider.sessionReviewPort, sessionReviewEventPort: provider.sessionReviewEventPort,
    authorize(input) {
      grants++;
      return authority.authorizeOperation(input, denied || grants === revokeAt ? null : permitted);
    } }, { dispatchCheckpoint(point) {
      if (crash && point === 'effect_returned') throw Object.assign(Error('Fixture interrupted owner'), { code: 'FIXTURE_DISPATCH_INTERRUPTED' });
    } });
  const instances = createAgenticProcessStore(options), journal = createProcessOperationJournalStore(options);
  const control = createProcessControlInboxStore(options);
  const inspect = () => host.inspect(instanceId), preview = (extra = {}) => {
    const { record, cursor } = inspect();
    const frame = cursor.occurrences.find(row => row.status === 'READY' || ['blocked', 'deferred'].includes(row.operation?.receipt?.outcome));
    return host.preview({ instanceId, expectedSha256: record.instance_sha256, occurrenceId: frame.occurrence_id, ...extra });
  };
  const stage = value => host.stage(value, { write: true, expectedPreviewSha256: shadowHash(value) });
  async function run(value = null) {
    value ??= await preview();
    permitted = shadowHash(value);
    const { operation_id: id } = await stage(value);
    const dispatched = await host.dispatch(id, { write: true });
    assert.equal(dispatched.status, 'receipted');
    await host.accept(id, { write: true });
    return host.readJournal(id);
  }
  // Only the upstream business receipts are seeded. Provider observations and
  // the child call, authorization, intent, owner, CAS, receipt and replay are real.
  function seed(id, output, prepared = null) {
    const before = instances.read(instanceId), { record: current } = before;
    const frame = inspectAgenticProcess(current).occurrences.find(row => row.node_id === id && row.status === 'READY');
    assert.ok(frame, id);
    const occurrenceId = frame.occurrence_id, operationId = operationJournalId(current, occurrenceId);
    const binding = bindings.get(model.nodes.find(row => row.id === id).binding_ref);
    const { input, input_resolution } = resolveStandardProcessInput({ instance: current, occurrenceId, readOperation: id => journal.read(id).record });
    const snapshot = processAuthority.snapshot();
    const preview = signer.seal({ contract_version: 'standard-operation-preview.v1', instance_id: instanceId, instance_sha256: current.instance_sha256,
      scope_id: current.scope_id, model_sha256: current.model_sha256, occurrence_id: occurrenceId, binding, input, input_resolution,
      prepared, snapshot, prepared_at_ms: Date.now() });
    const intent = { contract_version: 'process-operation-intent.v1', operation_id: operationId, binding_ref: binding.id,
      binding_sha256: shadowHash(binding), input_sha256: shadowHash(input), preconditions_sha256: shadowHash({ snapshot, prepared }),
      authorization_sha256: null, authority_id: 'standard_operation_host', scope_id: current.scope_id, instance_id: instanceId,
      instance_sha256: current.instance_sha256, model_sha256: current.model_sha256, occurrence_id: occurrenceId, instance_revision: current.revision };
    output = { contract_version: binding.output_contract, operation_ref: binding.id, outcome: 'completed', effect_status: 'no_effect',
      evidence_refs: [], ...output };
    const receipt = { contract_version: 'process-operation-receipt.v1', receipt_id: 'receipt_' + operationId,
      operation_id: operationId, intent_sha256: shadowHash(intent), authority_id: intent.authority_id, outcome: output.outcome,
      effect_status: output.effect_status, output_sha256: shadowHash(output), facts: output.facts,
      evidence_refs: [{ ref: operationOutputRef(operationId), sha256: shadowHash(output) }] };
    journal.compareAndSwap(signer.seal({ contract_version: 'process-operation-journal.v1', operation_id: operationId, revision: 3,
      phase: 'receipted', preview, intent, grant: null, owner: { generation: randomUUID(), pid: process.pid }, results: [{ output, receipt }] }), null);
    const staged = advanceAgenticProcess(current, { kind: 'operation_intent', event_id: 'intent_' + operationId, occurrence_id: occurrenceId, intent });
    const accepted = advanceAgenticProcess(staged, { kind: 'operation_result', event_id: 'result_' + operationId, occurrence_id: occurrenceId, receipt });
    instances.compareAndSwap(accepted, before.content_sha256);
    return operationId;
  }
  async function seedPrefix() {
    const initial = host.initialize({ instanceId });
    host.initialize({ instanceId, write: true, expectedResultSha256: initial.record.instance_sha256 });
    const update = seed(graph.update, { facts: { session_pr_head_confirmed: true }, observations: { pull_request: pr } },
      { plan: { prepared_at_ms: Date.parse(submittedAt) - 1000 } });
    const input = { contract_version: 'standard-session-pr-review-observe-input.v1', update_operation_id: update };
    const observerFor = reviewPort => createStandardSessionPrReviewContentObservation({ reviewPort,
      readCurrent: () => inspect().record,
      readConfirmedHead: () => ({ update_operation_id: update, pull_request: pr, head: pr.head_oid,
        session_id: 'S001', material_sha256: shadowHash(pr) }) });
    const observed = await observerFor(provider.sessionReviewPort).observe(inspect().record, input);
    assert.equal(observed.outcome, 'completed', observed.observations.reason_code);
    seed(graph.observe, observed);
    const before = instances.read(instanceId), { record, cursor } = inspect();
    const frame = cursor.occurrences.find(row => row.node_id === graph.wait);
    const request = host.prepareControl({ instanceId, expectedSha256: record.instance_sha256, occurrenceId: frame.occurrence_id });
    const adapter = createStandardPrReviewControlSource({ ...provider.sessionReviewEventPort,
      observer: observerFor(provider.sessionReviewPort), observerFor,
      readContext: () => ({ instance: record, request_sha256: shadowHash(request), input,
        reviewSubject: { repository_id: pr.repository_id, pull_request_id: pr.node_id, pull_request_number: pr.number,
          head_oid: pr.head_oid, base_oid: pr.base_oid, head_ref: pr.head_branch, base_ref: pr.base_branch,
          not_before_ms: Date.parse(submittedAt) - 1000 } }),
    });
    const { source, payload } = await adapter.readReview({ request, sourceRef: eventRef });
    const delivery = controlDelivery(request, source), id = delivery.delivery_id;
    const delivered = advanceAgenticProcess(record, { kind: 'control', event_id: id, occurrence_id: frame.occurrence_id, delivery });
    control.compareAndSwap(signer.seal({ contract_version: 'process-control-inbox.v2', inbox_id: id, source_ref: eventRef,
      request, source, payload, delivery, phase: 'delivered', delivered_instance_sha256: delivered.instance_sha256 }), null);
    instances.compareAndSwap(delivered, before.content_sha256);
    const received = seed(graph.receive, { facts: { session_pr_review_event_received: true },
      observations: { inbox_id: id, payload, delivery_sha256: shadowHash(delivery) } });
    const payload_sha256 = shadowHash(payload);
    const selected = seed(graph.select, { facts: { session_pr_triage_source_selected: true },
      observations: { received_operation_id: received, payload, payload_sha256 } });
    const triage = seed(graph.triage, { facts: { session_pr_findings_classified: true,
      session_pr_corrections_required: false, session_pr_responses_required: true },
    observations: { selection_operation_id: selected, received_operation_id: received, payload_sha256, head_oid: pr.head_oid, base_oid: pr.base_oid,
      triage_completion: 'pending-effects-and-verification', merge_authorization: 'not-established', checks_acceptance: 'not-established',
      dispositions: roots.map(root => ({ kind: 'comment', disposition: 'invalid', thread_id: 'T_' + root.id,
        node_id: root.id, proposed_response: response })) } });
    const waiting = inspect(), call = waiting.cursor.occurrences.find(row => row.node_id === graph.call);
    await host.enterCall({ instanceId, expectedSha256: waiting.record.instance_sha256, occurrenceId: call.occurrence_id,
      eventId: 'call_review', write: true });
    assert.equal((await preview()).input.triage_operation_id, triage);
  }
  return { host, preview, stage, run, inspect, seedPrefix, state, providerFile, calls: () => calls, allow: sha => { permitted = sha; },
    deny: value => { denied = value; }, revokeAt: value => { revokeAt = grants + value; }, interrupt: () => { crash = true; } };
}

function arrange(prefix, behavior) {
  const base = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'aidn-source120-r08-'));
  const targetRoot = createFreshStandardWorkflowFixture('files');
  const dirs = Object.fromEntries(['host', 'control', 'review', 'native'].map(name => {
    const dir = path.join(base, name);
    fs.mkdirSync(dir);
    return [name, dir];
  }));
  const configuration = { instance_id: 'r08-' + prefix, target_root: targetRoot, control_root: dirs.control, review_root: dirs.review,
    native: { home: dirs.native, tool_roots: [], protected_roots: [dirs.host] } };
  const gitPath = fs.realpathSync(execFileSync(process.platform === 'win32' ? 'where.exe' : 'which', ['git'],
    { encoding: 'utf8', windowsHide: true }).split(/\r?\n/).find(Boolean));
  const git = (...args) => execFileSync(gitPath, ['-C', targetRoot, ...args], { encoding: 'utf8', windowsHide: true }).trim();
  git('config', 'remote.origin.url', 'https://github.com/fixture/repository.git');
  git('switch', '-c', 'S001-r08');
  const head_oid = git('rev-parse', 'HEAD'), head_branch = git('branch', '--show-current');
  const pr = { repository_id: 'R_fixture', node_id: 'PR_fixture', number: 7, head_oid, base_oid: 'b'.repeat(40),
    head_branch, base_branch: 'dev', state: 'OPEN', draft: false, url: 'https://github.com/fixture/repository/pull/7' };
  const binding = { contract_version: 'standard-host-github.v1', instance_id: configuration.instance_id, target_root: targetRoot,
    repository: { host: 'github.com', owner: 'fixture', name: 'repository', node_id: pr.repository_id },
    actor: { login: 'fixture-actor', node_id: 'U_actor' }, reviewer: { login: 'fixture-reviewer', node_id: 'U_reviewer', type: 'User' },
    git: pin(gitPath), gh: pin(fs.realpathSync(process.platform === 'win32' ? path.join(process.env.SystemRoot, 'System32', 'where.exe') : '/usr/bin/env')) };
  const key = shadowHash({ target: process.platform === 'win32' ? targetRoot.toLowerCase() : targetRoot, instance: configuration.instance_id });
  fs.mkdirSync(path.join(dirs.host, key + '.github'));
  save(path.join(dirs.host, key + '.github.json'), binding);
  save(path.join(base, 'configuration.json'), { configuration, home: dirs.host, binding, pr, prefix, behavior, submittedAt: new Date(Date.now() - 1000).toISOString() });
  save(path.join(base, 'provider.json'), { sent: [], replies: [], resolved: false, reviewChanged: false });
  console.log(JSON.stringify({ evidence: base, project: targetRoot, prefix, behavior }));
  return base;
}

function replay(f) {
  const { record } = f.inspect(), calls = f.calls();
  const result = simulateAgenticProcess({ instanceId: record.instance_id, scopeId: record.scope_id, model: record.model,
    policyPins: record.policy_pins, parameters: record.initial_parameters, events: record.events });
  assert.equal(result.trace.at(-1).instance_sha256, record.instance_sha256);
  assert.equal(f.calls(), calls);
}

function verifyRetained(base) {
  const { prefix, behavior } = json(path.join(base, 'configuration.json')), f = open(base);
  const before = f.inspect(), { record, cursor } = before;
  const rows = record.events.filter(event => event.kind === 'operation_intent' && event.intent.binding_ref === 'session_pr_review_reply_publish')
    .map(event => f.host.readJournal(event.intent.operation_id));
  const replies = rows.flatMap(row => row.results.filter(result => result.receipt.effect_status === 'confirmed'));
  assert.equal(record.events.filter(event => event.kind === 'call_enter').length, 1);
  assert.deepEqual(f.state.sent, behavior === 'normal' ? ['C_root', 'C_other'] : ['C_root']);
  assert.equal(f.state.replies.length, behavior === 'missing' ? 0 : f.state.sent.length);
  assert.equal(replies.length, f.state.replies.length);
  if (behavior === 'normal') {
    assert.equal(cursor.occurrences.find(row => row.status === 'READY')?.node_id, 'pr_merge_observe');
    assert.deepEqual(rows.flatMap(row => row.results.filter(result => result.receipt.outcome === 'blocked')
      .map(result => result.output.observations.reason_code)),
    ['STANDARD_HOST_EXACT_OPERATION_REQUIRED', 'STANDARD_PR_EFFECTS_REVIEW_CHANGED']);
  } else {
    assert.equal(rows.length, 1);
    assert.equal(rows[0].results.length, behavior === 'lost' ? 2 : 1);
    if (behavior === 'missing' || behavior === 'lost') assert.equal(rows[0].results[0].receipt.effect_status, 'unknown');
    if (behavior === 'missing') assert.equal(cursor.status, 'WAITING');
    else {
      assert.equal(replies[0].output.observations.reply.action, 'recovered');
      assert.equal(cursor.occurrences.find(row => row.status === 'READY')?.node_id, 'pr_reply_select');
    }
  }
  replay(f);
  const diagnostic = f.host.inspectDiagnostic('r08-' + prefix);
  assert.deepEqual(diagnostic.native, { journal: null, checkpoint: null, written: false, native_started: false });
  assert.equal(diagnostic.content_sha256, before.content_sha256);
  assert.equal(f.inspect().content_sha256, before.content_sha256);
  assert.equal(f.calls(), 0);
  console.log('PASS published R08 ' + prefix + ' ' + behavior + ' with seeded signed upstream receipts and real FILES operation ports');
}

if (process.argv[2] === '--verify-retained') {
  verifyRetained(process.argv[3]);
} else if (process.argv[2] === '--recover') {
  const f = open(process.argv[3]), id = process.argv[4], before = f.host.readJournal(id);
  f.allow(shadowHash(before.preview));
  const result = await f.host.dispatch(id, { write: true });
  if (result.status === 'receipted') await f.host.accept(id, { write: true });
  const after = f.host.readJournal(id);
  assert.deepEqual(after.owner, before.owner);
  assert.deepEqual(after.results.slice(0, before.results.length), before.results);
  assert.deepEqual(after.intent, before.intent);
  assert.deepEqual(after.grant, before.grant);
  replay(f);
  console.log(JSON.stringify({ status: result.status, effect_status: after.results.at(-1)?.receipt.effect_status ?? null,
    count: f.state.sent.length, result_count: after.results.length, instance: f.inspect().record.instance_sha256 }));
} else {
  const cases = [['session', 'normal'], ['correction', 'lost'], ['correction', 'missing'], ['correction', 'interrupted']];
  const selected = process.argv[2] ? cases.filter(([, behavior]) => process.argv[2] === '--case=' + behavior) : cases;
  assert.ok(selected.length && process.argv.length <= 3, 'Invalid R08 fixture case');
  for (const [prefix, behavior] of selected) {
    const base = arrange(prefix, behavior), f = open(base, { initializeKey: true });
    await f.seedPrefix();
    const select = await f.run();
    assert.equal(select.results[0].output.facts.session_pr_replies_observed, false);
    assert.equal(select.results[0].output.observations.selection.target_comment_id, 'C_root');
    await assert.rejects(f.preview({ input: { body: 'untrusted' } }), { code: 'PROCESS_INPUT_OVERRIDE_FORBIDDEN' });
    const publish = await f.preview();
    f.deny(true);
    await assert.rejects(f.stage(publish), { code: 'STANDARD_HOST_EXACT_OPERATION_REQUIRED' });
    f.deny(false);
    f.allow(shadowHash(publish));
    if (behavior === 'normal') {
      // stage and intent verification take two grants. The next checks are
      // dispatch, provider preparation, pre-send and the protected send edge.
      f.revokeAt(6);
      const { operation_id: refusedId } = await f.stage(publish);
      assert.equal((await f.host.dispatch(refusedId, { write: true })).receipt.effect_status, 'no_effect');
      await f.host.accept(refusedId, { write: true });
      assert.deepEqual(f.state.sent, []);
      f.revokeAt(10000);
      await f.run();
      assert.deepEqual(f.state.sent, ['C_root']);
      assert.equal((await f.run()).results[0].output.observations.selection.target_comment_id, 'C_other');
      const second = await f.preview();
      f.state.reviewChanged = true;
      const refused = await f.run(second);
      assert.equal(refused.results[0].output.observations.reason_code, 'STANDARD_PR_EFFECTS_REVIEW_CHANGED');
      assert.deepEqual(f.state.sent, ['C_root']);
      f.state.reviewChanged = false;
      await f.run();
      assert.deepEqual(f.state.sent, ['C_root', 'C_other']);
      assert.equal((await f.run()).results[0].output.facts.session_pr_replies_observed, true);
      assert.equal((await f.run()).results[0].output.observations.reason_code, 'STANDARD_PR_EFFECTS_RESOLUTION_REQUIRED');
      f.state.resolved = true;
      assert.equal((await f.run()).results[0].output.facts.session_pr_review_effects_verified, true);
      assert.equal(f.inspect().cursor.occurrences.find(row => row.status === 'READY').node_id, 'pr_merge_observe');
    } else {
      const { operation_id: id } = await f.stage(publish);
      if (behavior === 'interrupted') {
        f.interrupt();
        await assert.rejects(f.host.dispatch(id, { write: true }), { code: 'FIXTURE_DISPATCH_INTERRUPTED' });
        assert.equal(f.host.readJournal(id).phase, 'dispatching');
      } else {
        assert.equal((await f.host.dispatch(id, { write: true })).receipt.effect_status, 'unknown');
        await f.host.accept(id, { write: true });
      }
      assert.deepEqual(f.state.sent, ['C_root']);
      const before = f.inspect().record.instance_sha256;
      for (let attempt = 0; attempt < 2; attempt++) {
        const result = JSON.parse(execFileSync(process.execPath, [fileURLToPath(import.meta.url), '--recover', base, id],
          { encoding: 'utf8', timeout: 120000, windowsHide: true }));
        assert.equal(result.count, 1);
        if (behavior === 'missing') {
          assert.equal(result.status, 'reconciliation_required');
          assert.equal(result.effect_status, 'unknown');
          assert.equal(result.result_count, 1);
          assert.equal(result.instance, before);
        } else {
          assert.equal(result.status, attempt ? 'retained_result' : 'receipted');
          assert.equal(result.effect_status, 'confirmed');
          assert.equal(result.result_count, behavior === 'lost' ? 2 : 1);
        }
      }
    }
    verifyRetained(base);
  }
}
