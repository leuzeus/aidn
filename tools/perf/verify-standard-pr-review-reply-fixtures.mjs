import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash, generateKeyPairSync, randomUUID, sign } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createFreshStandardWorkflowFixture } from './standard-workflow-fixture-lib.mjs';
import { createGithubReviewFixture } from './github-review-evidence-fixture-lib.mjs';
import { createAgenticProcessStore } from '../../src/adapters/runtime/agentic-process-store.mjs';
import { createProcessControlInboxStore } from '../../src/adapters/runtime/process-control-inbox-store.mjs';
import { createProcessDecisionInboxStore } from '../../src/adapters/runtime/process-decision-inbox-store.mjs';
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
import { decisionInboxId } from '../../src/core/workflow/process-decision-inbox.mjs';
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
  const exception = behavior.startsWith('exception-');
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
  const roots = exception || prefix === 'session' && behavior === 'normal'
    ? [rootComment, { ...rootComment, id: 'C_other' }] : [rootComment];
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
      const endpoint = args.at(-1);
      if (args[0] === 'api' && args[1] === '--hostname') {
        assert.deepEqual(args.slice(0, -1), ['api', '--hostname', 'github.com', '--method', 'GET']);
        const commit = 'repos/fixture/repository/commits/' + pr.head_oid;
        if (endpoint === commit + '/check-runs?filter=all&per_page=100') {
          const runs = [{ name: 'Required CI', node_id: state.checkId ?? 'CR_ci',
            head_sha: pr.head_oid, app: { node_id: 'A_ci' }, details_url: state.checkDetails ?? 'https://example.com/ci',
            status: state.pendingCheck ? 'in_progress' : 'completed', conclusion: state.pendingCheck ? null : 'success' }];
          return ok({ total_count: runs.length, check_runs: runs });
        }
        if (endpoint === commit + '/status?per_page=100') return ok({ sha: pr.head_oid, total_count: 0, statuses: [] });
        assert.equal(endpoint, 'repos/fixture/repository/pulls/' + pr.number);
        return ok({ node_id: pr.node_id, number: pr.number, state: 'open', draft: false, merged: false,
          head: { ref: pr.head_branch, sha: pr.head_oid, repo: { node_id: pr.repository_id } },
          base: { ref: pr.base_branch, sha: pr.base_oid, repo: { node_id: pr.repository_id } } });
      }
      const { query, variables } = JSON.parse(options.input);
      if (query.startsWith('query AidnPrMerge')) return ok({ data: { repository: {
        id: pr.repository_id, nameWithOwner: 'fixture/repository',
        pullRequest: { id: pr.node_id, number: pr.number, headRefOid: pr.head_oid, headRefName: pr.head_branch,
          baseRefName: pr.base_branch, headRepository: { id: pr.repository_id }, isDraft: false, state: 'OPEN',
          merged: false, mergedAt: null, mergeCommit: null, baseRef: { target: { oid: pr.base_oid } } },
      } } });
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
        id: 'T_' + root.id, path: 'product.mjs', line: index + 1, isResolved: state.resolved || state.resolvedThreads?.includes('T_' + root.id) === true, isOutdated: false,
        comments: connection([root, ...state.replies.filter(reply => reply.replyTo.id === root.id)]),
      }));
      const result = fixture.run(binary, args, options), value = JSON.parse(result.stdout);
      if (state.reviewChanged && value.data.repository.pullRequest.reviews)
        value.data.repository.pullRequest.reviews.nodes[0].body += ' changed';
      value.data.repository.pullRequest.headRepository = { id: pr.repository_id };
      return ok(value);
    },
    async runGithubResolution(binary, args, options) {
      assert.ok(!exception, 'Unexpected resolution during exception fixture');
      assert.equal(binary, binding.gh.path);
      assert.deepEqual(args, ['api', 'graphql', '--hostname', 'github.com', '--input', '-']);
      const { query, variables: { input } } = JSON.parse(options.input);
      assert.equal(query, 'mutation AidnPrReviewResolution($input:ResolveReviewThreadInput!) { resolveReviewThread(input:$input) { clientMutationId thread { id isResolved } } }');
      assert.deepEqual(Object.keys(input).sort(), ['clientMutationId', 'threadId']);
      assert.equal(input.threadId, 'T_C_root');
      const record = host.readJournal(input.clientMutationId);
      assert.equal(record.phase, 'dispatching');
      assert.equal(record.intent.binding_ref, 'session_pr_review_thread_resolve');
      assert.equal(record.intent.authorization_sha256, shadowHash(record.grant));
      assert.equal(record.owner.pid, process.pid);
      const { plan } = record.preview.prepared.plan.provider;
      assert.deepEqual(plan.actor, binding.actor);
      assert.equal(plan.repository_id, pr.repository_id);
      assert.equal(plan.request.thread_id, input.threadId);
      assert.deepEqual(plan.request.pull_request, { contract_version: 'github-pr-observation-request.v2', pull_request_number: pr.number,
        expected_pull_request_id: pr.node_id, expected_head_oid: pr.head_oid, expected_base_oid: pr.base_oid,
        expected_head_ref: pr.head_branch, expected_base_ref: pr.base_branch });
      assert.deepEqual(state.resolutionSends, []);
      state.resolutionSends.push(input.threadId);
      if (behavior === 'resolve-interrupted') state.resolvedThreads.push(input.threadId);
      save(providerFile, state);
      return ok({ data: { resolveReviewThread: { clientMutationId: input.clientMutationId, thread: { id: input.threadId, isResolved: true } } } });
    },
    async runGithubReply(binary, args, options) {
      assert.ok(!exception, 'Unexpected reply during exception fixture');
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
    humanSource: authority.humanSource,
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
      dispositions: roots.map(root => ({ kind: 'comment', thread_id: 'T_' + root.id, node_id: root.id,
        ...(exception && root.id === 'C_other' ? { disposition: 'not_a_finding', proposed_response: '' }
          : { disposition: 'invalid', proposed_response: response }) })) } });
    const waiting = inspect(), call = waiting.cursor.occurrences.find(row => row.node_id === graph.call);
    await host.enterCall({ instanceId, expectedSha256: waiting.record.instance_sha256, occurrenceId: call.occurrence_id,
      eventId: 'call_review', write: true });
    const premerge = await preview();
    assert.equal(premerge.input.triage_operation_id, triage);
    assert.equal((await run(premerge)).results[0].output.observations.reason_code, 'STANDARD_PR_PREMERGE_OPEN');
  }
  function observePublishedReply() {
    const date = new Date().toISOString();
    state.replies.push({ ...rootComment, id: 'R_C_root', author: { id: binding.actor.node_id, login: binding.actor.login, __typename: 'User' },
      body: response, createdAt: date, updatedAt: date, publishedAt: date, replyTo: { id: rootComment.id } });
    save(providerFile, state);
  }
  return { host, preview, stage, run, inspect, seedPrefix, observePublishedReply, state, providerFile, calls: () => calls, allow: sha => { permitted = sha; },
    signer, inbox: createProcessDecisionInboxStore(options),
    deny: value => { denied = value; }, revokeAt: value => { revokeAt = grants + value; }, interrupt: () => { crash = true; } };
}

function arrange(prefix, behavior) {
  const base = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), behavior.startsWith('resolve-') ? 'aidn-source121-r08-' : 'aidn-source120-r08-'));
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
  if (behavior.includes('consent')) binding.required_checks = { contract_version: 'standard-github-required-checks.v1',
    base_ref: pr.base_branch, entries: [{ name: 'Required CI', kind: 'check_run', producer_id: 'A_ci' }] };
  const key = shadowHash({ target: process.platform === 'win32' ? targetRoot.toLowerCase() : targetRoot, instance: configuration.instance_id });
  fs.mkdirSync(path.join(dirs.host, key + '.github'));
  save(path.join(dirs.host, key + '.github.json'), binding);
  save(path.join(base, 'configuration.json'), { configuration, home: dirs.host, binding, pr, prefix, behavior, submittedAt: new Date(Date.now() - 1000).toISOString() });
  save(path.join(base, 'provider.json'), { sent: [], replies: [], resolved: false, reviewChanged: false, resolvedThreads: [], resolutionSends: [] });
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
    const retainedTarget = record.model.call_targets.find(row => row.model_id === target.model_id);
    const boundary = retainedTarget.model.nodes.some(row => row.id === 'pr_checks_accept') ? 'pr_checks_accept' : 'pr_merge_observe';
    assert.equal(cursor.occurrences.find(row => row.status === 'READY')?.node_id, boundary);
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

function recoverProcess(base, id) {
  return JSON.parse(execFileSync(process.execPath, [fileURLToPath(import.meta.url), '--recover', base, id],
    { encoding: 'utf8', timeout: 180000, windowsHide: true }));
}

async function qualifyResolution(behavior) {
  const prefix = behavior === 'resolve-interrupted' ? 'correction' : 'session';
  const base = arrange(prefix, behavior), f = open(base, { initializeKey: true });
  await f.seedPrefix();
  f.observePublishedReply();
  assert.equal((await f.run()).results[0].output.facts.session_pr_replies_observed, true);
  const selected = await f.run();
  assert.equal(selected.results[0].output.observations.selection.thread_id, 'T_C_root');
  const plan = await f.preview();
  const chosen = selected.results[0].output.observations.selection;
  assert.equal(plan.prepared.plan.reply_proof_sha256, chosen.reply_proof_sha256);
  assert.equal(plan.prepared.plan.provider.plan.request.basis_sha256, chosen.basis_sha256);
  let applied = plan;
  if (behavior === 'resolve-missing') {
    f.allow(shadowHash(plan));
    f.revokeAt(5); // stage, intent, dispatch, port admission, protected send edge
    const { operation_id: refusedId } = await f.stage(plan);
    const refusal = await f.host.dispatch(refusedId, { write: true });
    assert.equal(refusal.receipt.effect_status, 'no_effect');
    await f.host.accept(refusedId, { write: true });
    assert.equal(f.host.readJournal(refusedId).results[0].output.observations.reason_code, 'STANDARD_HOST_EXACT_OPERATION_REQUIRED');
    assert.deepEqual(f.state.resolutionSends, []);

    const changed = await f.preview();
    f.state.reviewChanged = true;
    const blocked = await f.run(changed);
    assert.equal(blocked.results[0].output.observations.reason_code, 'STANDARD_PR_EFFECTS_REVIEW_CHANGED');
    assert.deepEqual(f.state.resolutionSends, []);
    f.state.reviewChanged = false;
    applied = await f.preview();
  }
  f.allow(shadowHash(applied));
  const { operation_id: id } = await f.stage(applied);
  if (behavior === 'resolve-interrupted') {
    f.interrupt();
    await assert.rejects(f.host.dispatch(id, { write: true }), { code: 'FIXTURE_DISPATCH_INTERRUPTED' });
    assert.equal(f.host.readJournal(id).phase, 'dispatching');
  } else {
    assert.equal((await f.host.dispatch(id, { write: true })).receipt.effect_status, 'unknown');
    await f.host.accept(id, { write: true });
    const before = f.inspect().record.instance_sha256;
    const absent = recoverProcess(base, id);
    assert.deepEqual(absent, { status: 'reconciliation_required', effect_status: 'unknown', count: 0, resolution_count: 1,
      result_count: 1, instance: before });
    f.state.resolvedThreads.push('T_C_root'); // A later read can finally prove the exact postimage.
    save(f.providerFile, f.state);
  }
  assert.deepEqual(f.state.resolutionSends, ['T_C_root']);
  const recovered = recoverProcess(base, id), again = recoverProcess(base, id);
  assert.equal(recovered.status, 'receipted');
  assert.equal(recovered.effect_status, 'confirmed');
  assert.equal(recovered.resolution_count, 1);
  assert.equal(recovered.result_count, behavior === 'resolve-missing' ? 2 : 1);
  assert.deepEqual(again, { ...recovered, status: 'retained_result' });
  const resumed = open(base);
  const result = resumed.host.readJournal(id).results.at(-1).output.observations.resolution;
  assert.equal(result.action, 'recovered');
  assert.equal(result.thread_id, 'T_C_root');
  assert.equal((await resumed.run()).results[0].output.facts.session_pr_threads_observed_resolved, true);
  assert.equal((await resumed.run()).results[0].output.facts.session_pr_review_effects_verified, true);
  assert.equal(resumed.inspect().cursor.occurrences.find(row => row.status === 'READY').node_id, 'pr_merge_observe');
  replay(resumed);
  console.log('PASS published R08 resolution ' + prefix + ' ' + behavior + ' with seeded signed upstream receipts and real FILES operation ports');
}

async function qualifyException(behavior) {
  const prefix = behavior.includes('correction') ? 'correction' : 'session';
  const choice = ['refused', 'deferred', 'cancelled'].find(value => behavior === 'exception-' + value) ?? 'accept_resolution_exception';
  const base = arrange(prefix, behavior), f = open(base, { initializeKey: true });
  const { home, pr } = json(path.join(base, 'configuration.json'));
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const authority_id = 'fixture-human-r08', sourceRef = 'documented_exception';
  const authorityInbox = path.join(home, 'inbox');
  fs.mkdirSync(authorityInbox);
  save(path.join(home, 'principals.json'), { contract_version: 'standard-host-principals.v1',
    principals: [{ authority_id, kinds: ['human'], public_key: publicKey.export({ type: 'spki', format: 'pem' }) }] });

  await f.seedPrefix();
  f.observePublishedReply();
  f.state.resolvedThreads.push('T_C_root');
  save(f.providerFile, f.state);
  assert.equal((await f.run()).results[0].output.facts.session_pr_replies_observed, true);
  const selection = await f.run();
  assert.deepEqual(selection.results[0].output.facts, { session_pr_threads_observed_resolved: false,
    session_pr_resolution_exception_required: true, session_pr_resolution_gate_met: false });
  const { operation_id: id } = await f.stage(await f.preview());
  const { status, question } = await f.host.dispatch(id, { write: true });
  assert.equal(status, 'waiting_for_human');
  assert.equal(question.selection_operation_id, selection.operation_id);
  assert.equal(question.subject.head_oid, pr.head_oid);
  assert.equal(question.subject.base_oid, pr.base_oid);
  assert.equal(question.subject.head_ref, pr.head_branch);
  assert.equal(question.subject.base_ref, pr.base_branch);
  assert.equal(question.subject.repository_id, pr.repository_id);
  assert.equal(question.subject.pull_request_id, pr.node_id);
  assert.equal(question.subject.pull_request_number, pr.number);
  assert.deepEqual(question.subject.unresolved_thread_ids, ['T_C_other']);
  assert.equal(shadowHash(question.subject), selection.results[0].output.observations.exception_subject_sha256);
  const deliver = () => f.host.receiveDecision(id, { sourceRef, write: true });
  const claim = { contract_version: 'human-pr-review-resolution-exception.v1', source_kind: 'human', authority_id,
    source_event_id: 'r08_fixture_decision', question_sha256: shadowHash(question), subject_sha256: shadowHash(question.subject),
    choice, rationale: 'The remaining inline note is an informational duplicate documented by triage.',
    evidence_refs: [{ ref: 'github:pr-review-thread/T_C_other', sha256: question.subject.thread_observation_sha256 }] };
  function publish(payload, { subject = question, expired = false } = {}) {
    const now = Date.now(), body = { contract_version: 'standard-host-source.v1', kind: 'human', authority_id,
      source_ref: sourceRef, subject_sha256: shadowHash(subject), payload, issued_at_ms: now - 2000, expires_at_ms: expired ? now - 1000 : now + 300000 };
    save(path.join(authorityInbox, sourceRef + '.json'), { ...body,
      signature: sign(null, Buffer.from(shadowHash(body)), privateKey).toString('base64') });
  }
  if (behavior === 'exception-session') {
    assert.equal((await deliver()).status, 'waiting_for_human');
    publish({ ...claim, rationale: '  \n  ' });
    await assert.rejects(deliver, { code: 'STANDARD_PR_RESOLUTION_EXCEPTION_DECISION_INVALID' });
    publish(claim, { expired: true });
    await assert.rejects(deliver, { code: 'STANDARD_HOST_SOURCE_INVALID' });
    publish({ ...claim, subject_sha256: shadowHash({ ...question.subject, head_oid: 'e'.repeat(40) }) });
    await assert.rejects(deliver, { code: 'PROCESS_HUMAN_QUESTION_CHANGED' });
    publish(claim);
    f.state.resolvedThreads.length = 0;
    await assert.rejects(deliver, { code: 'STANDARD_PR_RESOLUTION_EXCEPTION_STALE' });
    f.state.resolvedThreads.push('T_C_root');
    assert.equal(f.inbox.read(decisionInboxId(claim)).record, null);
    assert.equal(f.host.readJournal(id).phase, 'staged');
  }
  publish(claim);
  if (behavior === 'exception-correction') {
    const accepted = JSON.parse(execFileSync(process.execPath, [fileURLToPath(import.meta.url), '--receive-exception', base, id, sourceRef],
      { encoding: 'utf8', timeout: 240000, windowsHide: true }));
    assert.equal(accepted.outcome, 'completed');
  } else {
    assert.equal((await deliver()).status, 'receipted');
    await f.host.accept(id, { write: true });
  }
  const resumed = open(base), { record, cursor } = resumed.inspect();
  const result = resumed.host.readJournal(id).results[0], capture = resumed.inbox.read(decisionInboxId(claim)).record;
  resumed.signer.verify(capture);
  assert.equal(capture.contract_version, 'process-decision-inbox.v13');
  assert.equal(capture.phase, 'receipted');
  assert.deepEqual(capture.source, claim);
  assert.equal(capture.receipt_sha256, shadowHash(result.receipt));
  assert.equal(result.output.contract_version, 'standard-pr-review-resolution-exception-output.v1');
  assert.equal(result.output.effect_status, 'no_effect');
  const approved = choice === 'accept_resolution_exception';
  assert.deepEqual(result.output.facts, approved ? {
    session_pr_resolution_exception_accepted: true, session_pr_resolution_gate_met: true,
  } : {});
  assert.equal(result.receipt.outcome, approved ? 'completed' : choice === 'refused' ? 'rejected' : choice);
  assert.equal(cursor.occurrences.some(row => row.node_id === 'pr_checks_accept' && row.status === 'READY'), approved);
  assert.deepEqual(resumed.state.sent, []);
  assert.deepEqual(resumed.state.resolutionSends, []);
  assert.deepEqual(resumed.state.resolvedThreads, ['T_C_root']);
  assert.ok(!record.events.some(row => row.intent?.binding_ref === 'session_pr_review_effects_verify'));
  assert.equal((await resumed.host.receiveDecision(id, { sourceRef, write: true })).status, 'retained_result');
  await resumed.host.accept(id, { write: true });
  assert.equal(resumed.inspect().record.instance_sha256, record.instance_sha256);
  replay(resumed);
  assert.equal(resumed.calls(), 0);
  console.log('PASS published R08 ' + prefix + ' ' + choice + ', signed authority, FILES inbox/journal, offline replay');
  if (behavior === 'exception-consent-correction') await qualifyConsent(base, privateKey, authority_id, { exceptionSource: sourceRef });
}

async function qualifyConsent(base, privateKey, authority_id, { exceptionSource, choice = 'approve_merge' } = {}) {
  const { home, pr, prefix } = json(path.join(base, 'configuration.json'));
  const f = open(base), authorityInbox = path.join(home, 'inbox'), sourceRef = 'merge_consent';
  if (!exceptionSource) {
    f.state.pendingCheck = true;
    const pending = (await f.run()).results[0].output;
    assert.equal(pending.outcome, 'deferred');
    assert.equal(pending.observations.reason_code, 'STANDARD_PR_CHECK_PENDING');
    assert.deepEqual(pending.facts, {});
    f.state.pendingCheck = false;
  }
  const checks = await f.run(), evidence = checks.results[0].output;
  assert.equal(evidence.outcome, 'completed', evidence.observations.reason_code);
  assert.deepEqual(evidence.facts, { session_pr_required_checks_accepted: true });
  if (exceptionSource) {
    assert.ok(evidence.observations.subject.resolution_expires_at_ms > evidence.observations.observed_at_ms);
    assert.equal(f.host.readJournal(evidence.observations.subject.resolution_operation_id).intent.binding_ref,
      'session_pr_review_resolution_exception');
    const file = path.join(authorityInbox, exceptionSource + '.json'), envelope = json(file);
    const { signature, ...body } = envelope;
    const expired = { ...body, issued_at_ms: Date.now() - 2000, expires_at_ms: Date.now() - 1000 };
    save(file, { ...expired, signature: sign(null, Buffer.from(shadowHash(expired)), privateKey).toString('base64') });
    const before = f.inspect().record.instance_sha256;
    try {
      await assert.rejects(f.preview, { code: 'STANDARD_HOST_SOURCE_INVALID' });
      assert.equal(f.inspect().record.instance_sha256, before);
    } finally {
      save(file, envelope);
    }
    replay(f);
    assert.deepEqual(f.state.sent, []);
    assert.deepEqual(f.state.resolutionSends, []);
    console.log('PASS published R08 corrective checks refuse an expired signed source and bind an active documented exception');
    return;
  }
  const { operation_id: id } = await f.stage(await f.preview());
  const { status, question } = await f.host.dispatch(id, { write: true });
  assert.equal(status, 'waiting_for_human');
  assert.equal(question.checks_operation_id, checks.operation_id);
  assert.deepEqual(question.subject, evidence.observations.subject);
  for (const [key, value] of Object.entries({ head_oid: pr.head_oid, base_oid: pr.base_oid, head_ref: pr.head_branch,
    base_ref: pr.base_branch, repository_id: pr.repository_id, pull_request_id: pr.node_id, actor_id: 'U_actor' }))
    assert.equal(question.subject[key], value);
  assert.deepEqual(question.subject.checks.map(({ result_sha256, ...check }) => {
    assert.match(result_sha256, /^[a-f0-9]{64}$/);
    return check;
  }), [{ name: 'Required CI', kind: 'check_run', producer_id: 'A_ci', result_id: 'CR_ci' }]);
  assert.equal(question.subject.resolution_expires_at_ms !== null, Boolean(exceptionSource));
  const claim = { contract_version: 'human-pr-merge-consent.v1', source_kind: 'human', authority_id,
    source_event_id: 'r08_fixture_merge_consent', question_sha256: shadowHash(question), subject_sha256: shadowHash(question.subject),
    choice, rationale: 'I reviewed the exact published checks and R08 proof.',
    evidence_refs: evidence.evidence_refs };
  const deliver = () => f.host.receiveDecision(id, { sourceRef, write: true });
  assert.equal((await deliver()).status, 'waiting_for_human');
  const body = { contract_version: 'standard-host-source.v1', kind: 'human', authority_id, source_ref: sourceRef,
    subject_sha256: shadowHash(question), payload: claim, issued_at_ms: Date.now(), expires_at_ms: question.expires_at_ms };
  const publish = (value = body) => save(path.join(authorityInbox, sourceRef + '.json'),
    { ...value, signature: sign(null, Buffer.from(shadowHash(value)), privateKey).toString('base64') });
  {
    publish({ ...body, issued_at_ms: question.issued_at_ms - 1 });
    await assert.rejects(deliver, { code: 'STANDARD_HOST_SOURCE_INVALID' });
    publish({ ...body, payload: { ...claim, subject_sha256: shadowHash({ ...question.subject, head_oid: 'e'.repeat(40) }) } });
    await assert.rejects(deliver, { code: 'PROCESS_HUMAN_QUESTION_CHANGED' });
    publish();
    f.state.checkDetails = 'https://example.com/changed';
    await assert.rejects(deliver, { code: 'STANDARD_PR_MERGE_CONSENT_SUBJECT_CHANGED' });
    assert.equal(f.inbox.read(decisionInboxId(claim)).record, null);
    assert.equal(f.host.readJournal(id).phase, 'staged');
    delete f.state.checkDetails;
  }
  save(f.providerFile, f.state);
  const approved = choice === 'approve_merge';
  if (prefix === 'correction') {
    const outcome = JSON.parse(execFileSync(process.execPath, [fileURLToPath(import.meta.url), '--receive-exception', base, id, sourceRef],
      { encoding: 'utf8', timeout: 240000, windowsHide: true }));
    assert.equal(outcome.outcome, 'completed');
  } else {
    assert.equal((await deliver()).status, 'receipted');
    await f.host.accept(id, { write: true });
  }
  const resumed = open(base), capture = resumed.inbox.read(decisionInboxId(claim)).record;
  const result = resumed.host.readJournal(id).results[0];
  resumed.signer.verify(capture);
  assert.equal(capture.contract_version, 'process-decision-inbox.v14');
  assert.equal(capture.receipt_sha256, shadowHash(result.receipt));
  assert.equal(result.output.outcome, approved ? 'completed' : 'rejected');
  assert.deepEqual(result.output.facts, approved ? { session_pr_merge_consent_accepted: true } : {});
  assert.equal(result.output.effect_status, 'no_effect');
  assert.equal(result.output.observations.expires_at_ms, question.expires_at_ms);
  const state = resumed.inspect();
  assert.equal(state.cursor.occurrences.some(row => row.node_id === 'pr_merge_observe' && row.status === 'READY'), approved);
  await resumed.host.accept(id, { write: true });
  assert.equal(resumed.inspect().record.instance_sha256, state.record.instance_sha256);
  replay(resumed);
  assert.equal(resumed.host.inspectDiagnostic('r08-' + prefix).content_sha256, state.content_sha256);
  assert.equal(resumed.calls(), 0);
  assert.deepEqual(resumed.state.sent, []);
  assert.deepEqual(resumed.state.resolutionSends, []);
  if (approved) {
    const barrier = (await resumed.run()).results[0].output;
    assert.equal(barrier.outcome, 'deferred');
    assert.deepEqual(barrier.facts, {});
    assert.equal(barrier.observations.reason_code, 'STANDARD_PR_MERGE_AWAITING_PROVIDER');
  }
  console.log('PASS published R08 exact checks and signed ' + choice + ' at ' + prefix + ', FILES, GitHub transport doubled');
}

async function qualifyNominalConsent(prefix, choice) {
  const base = arrange(prefix, 'consent-session'), f = open(base, { initializeKey: true });
  const { home } = json(path.join(base, 'configuration.json'));
  const authority_id = 'fixture-human-r08', { publicKey, privateKey } = generateKeyPairSync('ed25519');
  fs.mkdirSync(path.join(home, 'inbox'));
  save(path.join(home, 'principals.json'), { contract_version: 'standard-host-principals.v1',
    principals: [{ authority_id, kinds: ['human'], public_key: publicKey.export({ type: 'spki', format: 'pem' }) }] });
  await f.seedPrefix();
  f.observePublishedReply();
  f.state.resolvedThreads.push('T_C_root');
  save(f.providerFile, f.state);
  assert.equal((await f.run()).results[0].output.facts.session_pr_replies_observed, true);
  assert.equal((await f.run()).results[0].output.facts.session_pr_threads_observed_resolved, true);
  assert.equal((await f.run()).results[0].output.facts.session_pr_review_effects_verified, true);
  await qualifyConsent(base, privateKey, authority_id, { choice });
}

if (['--case=consent-session', '--case=consent-refused', '--case=consent-correction'].includes(process.argv[2])) {
  await qualifyNominalConsent(process.argv[2] === '--case=consent-correction' ? 'correction' : 'session',
    process.argv[2] === '--case=consent-refused' ? 'refused' : 'approve_merge');
} else if (/^--case=exception-(session|correction|consent-correction|refused|deferred|cancelled)$/.test(process.argv[2])) {
  await qualifyException(process.argv[2].slice('--case='.length));
} else if (process.argv[2] === '--receive-exception') {
  const [, , , base, id, sourceRef] = process.argv, f = open(base);
  assert.equal((await f.host.dispatch(id, { write: true })).status, 'waiting_for_human');
  const { status, receipt } = await f.host.receiveDecision(id, { sourceRef, write: true });
  assert.equal(status, 'receipted');
  await f.host.accept(id, { write: true });
  console.log(JSON.stringify({ outcome: receipt.outcome }));
} else if (['--case=resolve-missing', '--case=resolve-interrupted'].includes(process.argv[2])) {
  await qualifyResolution(process.argv[2].slice('--case='.length));
} else if (process.argv[2] === '--verify-retained') {
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
    count: f.state.sent.length, resolution_count: f.state.resolutionSends?.length ?? 0, result_count: after.results.length, instance: f.inspect().record.instance_sha256 }));
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
      f.state.resolved = true;
      assert.equal((await f.run()).results[0].output.facts.session_pr_threads_observed_resolved, true);
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
