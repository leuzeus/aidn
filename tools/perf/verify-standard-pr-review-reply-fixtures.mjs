import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash, generateKeyPairSync, randomUUID, sign } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createFreshStandardWorkflowFixture } from './standard-workflow-fixture-lib.mjs';
import { createGithubReviewFixture } from './github-review-evidence-fixture-lib.mjs';
import { createAgenticProcessStore } from '../../src/adapters/runtime/agentic-process-store.mjs';
import { createProcessControlInboxStore } from '../../src/adapters/runtime/process-control-inbox-store.mjs';
import { createProcessDecisionInboxStore } from '../../src/adapters/runtime/process-decision-inbox-store.mjs';
import { createProcessOperationJournalStore } from '../../src/adapters/runtime/process-operation-journal-store.mjs';
import { assertStandardOperationOutput } from '../../src/core/workflow/standard-operation-contracts.mjs';
import { createStandardHostAuthority } from '../../src/adapters/runtime/standard-host-authority.mjs';
import { createStandardProcessAuthority } from '../../src/application/runtime/standard-process-authority.mjs';
import { resolveStandardProcessInput } from '../../src/application/runtime/standard-process-inputs.mjs';
import { createStandardPrReviewControlSource } from '../../src/application/runtime/standard-session-pr-review-control-source.mjs';
import { createStandardSessionPrReviewContentObservation } from '../../src/application/runtime/standard-session-pr-review-observe.mjs';
import { loadStandardWorkflowAssets } from '../../src/application/runtime/standard-workflow-composition.mjs';
import { createStandardWorkflowMixedHost } from '../../src/application/runtime/standard-workflow-mixed-composition.mjs';
import { runStandardWorkflowAction } from '../../src/application/runtime/standard-workflow-entry.mjs';
import { agenticProcessImplementationPins } from '../../src/application/runtime/agentic-process-implementation-pins.mjs';
import { CODEX_STARTUP_ENVIRONMENT_PROFILES } from '../../src/core/agents/codex-startup-arguments.mjs';
import { createStandardWorkflowOperationHost } from '../../src/application/runtime/standard-workflow-operation-host.mjs';
import { standardWorkflowOperationBindings } from '../../src/application/runtime/standard-workflow-operations.mjs';
import { advanceAgenticProcess, inspectAgenticProcess } from '../../src/core/workflow/agentic-process.mjs';
import { simulateAgenticProcess } from '../../src/core/workflow/agentic-process-simulation.mjs';
import { processModelIdentity } from '../../src/core/workflow/process-call-model.mjs';
import { controlDelivery, controlReservationId } from '../../src/core/workflow/process-control-inbox.mjs';
import { createStandardControlInbox } from '../../src/application/runtime/standard-workflow-control-inbox.mjs';
import { decisionInboxId } from '../../src/core/workflow/process-decision-inbox.mjs';
import { createOperationJournalSigner, operationJournalId, operationOutputRef } from '../../src/core/workflow/process-operation-journal.mjs';
import { shadowHash } from '../../src/core/workflow/shadow-json.mjs';
import { artifactContentHash } from '../../src/core/workflow/artifact-compare-swap.mjs';
import { renderStandardSessionPrRecord } from '../../src/core/workflow/standard-session-pr-record.mjs';
import { runStartSessionAdmitUseCase } from '../../src/application/runtime/start-session-admit-use-case.mjs';
import { runCycleCreateAdmitUseCase } from '../../src/application/runtime/cycle-create-admit-use-case.mjs';
import { readStandardPostMergeContinuity } from '../../src/application/runtime/standard-post-merge-continuity.mjs';
import { preWriteAdmit } from '../runtime/pre-write-admit.mjs';

const { model: published } = loadStandardWorkflowAssets();
const bindings = new Map(standardWorkflowOperationBindings().map(binding => [binding.id, binding]));
const target = published.call_targets.find(row => row.model_id === 'aidn-standard-pr-review-completion');
const captureTarget = published.call_targets.find(row => row.model_id === 'aidn-standard-pr-review-capture');
const pretriageTarget = published.call_targets.find(row => row.model_id === 'aidn-standard-pr-pretriage-completion');
const externalRef = 'aidn:external-merge';
const eventRef = 'REVIEW_fixture';
const response = 'Technical reply from the accepted fixture triage.';
const mergeOid = 'c'.repeat(40), baseTip = 'd'.repeat(40);
const dummy = 'op_' + 'a'.repeat(40);
const pin = path => ({ path, sha256: createHash('sha256').update(fs.readFileSync(path)).digest('hex') });
const json = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const save = (file, data) => fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');

function fixtureModel(prefix, fetchOnly, external = false, pretriage = false) {
  const corrective = prefix === 'correction';
  const update = corrective ? 'correction_pr_redelivery_push' : 'session_pr_update_push';
  const observe = prefix + '_pr_review_observe', wait = prefix + '_pr_review_wait', receive = prefix + '_pr_review_receive';
  const select = prefix + '_pr_triage_select', triage = prefix + '_pr_triage_evaluate', call = prefix + '_pr_effects_pending';
  const waitNode = captureTarget.model.nodes[0];
  const reviewNodes = captureTarget.model.nodes.slice(0, 3).map(row => {
    const rename = id => id.replace('session_pr_', prefix + '_pr_');
    return { ...row, id: rename(row.id), ...(row.branches ? { branches: row.branches.slice(0, 2)
      .map(branch => ({ ...branch, node_id: rename(branch.node_id) })) } : {}) };
  });
  const node = id => published.nodes.find(row => row.id === id) ?? reviewNodes.find(row => row.id === id);
  const literal = value => ({ source: 'literal', value });
  const input = (id, fields) => ({ node_id: id, fields: Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, literal(value)])) });
  const fields = id => published.data_bindings.inputs.find(row => row.node_id === id);
  if (pretriage) {
    const capture = prefix + '_pr_review_capture', route = prefix + '_pr_review_event_route';
    const choice = prefix + '_pr_pretriage_route', nominal = prefix + '_pr_nominal_review';
    const externalCall = prefix + '_pr_pretriage_completion';
    const root = { id: 'fixture', kind: 'sequence', participant_ref: 'project',
      children: ['session_pr_open', update, observe, capture, route, choice] };
    const nodes = [root, ...root.children.map(node), node(externalCall), { ...node(nominal), children: [receive] }, node(receive)];
    const model = { contract_version: published.contract_version, model_id: 'fixture-r08-pretriage', revision: 1,
      participants: published.participants, policies: [], roles: [], entry: root.id, nodes,
      operation_pins: Object.fromEntries(nodes.filter(row => row.binding_ref).map(row => [row.binding_ref, published.operation_pins[row.binding_ref]])),
      call_targets: [captureTarget, pretriageTarget], data_bindings: { contract_version: 'process-data-bindings.v4', parameter_keys: [], inputs: [
        input('session_pr_open', { contract_version: bindings.get('session_pr_open').input_contract, push_operation_id: dummy }),
        input(update, { contract_version: bindings.get(node(update).binding_ref).input_contract,
          ...(corrective ? { integration_operation_id: dummy, cycle_operation_id: dummy } : { checkpoint_operation_id: dummy }) }),
        ...[observe, capture, route, externalCall, receive].map(fields),
      ] } };
    return { model, update, observe, capture, wait: waitNode.id, call: externalCall, receive };
  }
  if (fetchOnly) {
    const entry = target.model.nodes.find(row => row.id === target.model.entry);
    const children = ['pr_merge_execute', ...entry.children.slice(entry.children.indexOf('pr_merge_basis'))];
    const byId = new Map(target.model.nodes.map(row => [row.id, row]));
    const subtree = id => {
      const row = byId.get(id);
      return [row, ...(row.children ?? row.branches?.map(branch => branch.node_id) ?? []).flatMap(subtree)];
    };
    const exact = children.flatMap(subtree), ids = new Set(exact.map(row => row.id));
    const child = { ...target.model, model_id: 'fixture-post-merge-target', nodes: [
      { ...entry, children }, ...exact,
    ], operation_pins: Object.fromEntries(exact.filter(row => row.binding_ref).map(row => [row.binding_ref, target.model.operation_pins[row.binding_ref]])),
    data_bindings: { ...target.model.data_bindings, inputs: [
      { node_id: 'pr_merge_execute', fields: { ...input('pr_merge_execute', {
        contract_version: 'standard-pr-merge-execute-input.v1', checks_operation_id: dummy, consent_operation_id: dummy,
      }).fields, triage_operation_id: { source: 'parameter', key: 'triage_operation_id', path: [] } } },
      ...target.model.data_bindings.inputs.filter(row => ids.has(row.node_id) && row.node_id !== 'pr_merge_execute'),
    ] } };
    const identity = processModelIdentity(child);
    const model = { contract_version: published.contract_version, model_id: 'fixture-r09', revision: 1, participants: published.participants,
      policies: [], roles: [], entry: 'fixture', nodes: [
        { id: 'fixture', kind: 'sequence', participant_ref: 'project', children: ['session_pr_open', triage, call] },
        node('session_pr_open'), node(triage), { ...node(call), target: identity },
      ], operation_pins: { session_pr_open: published.operation_pins.session_pr_open, [node(triage).binding_ref]: published.operation_pins[node(triage).binding_ref] },
      call_targets: [{ ...identity, model: child }],
      data_bindings: { contract_version: 'process-data-bindings.v4', parameter_keys: [], inputs: [
        input('session_pr_open', { contract_version: bindings.get('session_pr_open').input_contract, push_operation_id: dummy }),
        input(triage, { contract_version: bindings.get(node(triage).binding_ref).input_contract, report_occurrence_id: 'fixture_report' }),
        fields(call),
      ] } };
    return { model, triage, call };
  }
  const root = { id: 'fixture', kind: 'sequence', participant_ref: 'project', children: [...(external ? ['session_pr_open'] : []), update, observe, wait, receive, select, triage, call] };
  const nodes = [root, ...root.children.map(node), ...node(wait).branches.map(branch => node(branch.node_id))];
  const model = { contract_version: published.contract_version, model_id: 'fixture-r08', revision: 1, participants: published.participants,
    policies: [], roles: [], entry: root.id, nodes,
    operation_pins: Object.fromEntries(nodes.filter(row => row.binding_ref).map(row => [row.binding_ref, published.operation_pins[row.binding_ref]])),
    call_targets: [target], data_bindings: { contract_version: 'process-data-bindings.v4', parameter_keys: [], inputs: [
      ...(external ? [input('session_pr_open', { contract_version: bindings.get('session_pr_open').input_contract, push_operation_id: dummy })] : []),
      input(update, { contract_version: bindings.get(node(update).binding_ref).input_contract,
        ...(corrective ? { integration_operation_id: dummy, cycle_operation_id: dummy } : { checkpoint_operation_id: dummy }) }),
      fields(observe), fields(receive), fields(select),
      input(triage, { contract_version: bindings.get(node(triage).binding_ref).input_contract, report_occurrence_id: 'fixture_report' }),
      fields(call),
    ] } };
  return { model, update, observe, wait, receive, select, triage, call };
}

function open(base, { initializeKey = false } = {}) {
  const configurationFile = path.join(base, 'configuration.json');
  const data = json(configurationFile);
  const { configuration, binding, pr, prefix, behavior, submittedAt, fetchFixture } = data;
  const pretriage = behavior.startsWith('external-pretriage-');
  const exception = behavior.startsWith('exception-'), external = behavior.startsWith('external-');
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
  let permitted, denied = false, revokeAt = null, grants = 0, calls = 0, crash = false, interruptCapture = false;
  const providerTransport = {
    runGithub() { assert.fail('Unexpected GitHub effect'); },
    runRemoteGit(executable, args) {
      assert.ok(fetchFixture, 'Unexpected Git transport');
      assert.equal(executable, binding.git.path);
      const separator = args.indexOf('--');
      assert.equal(args[separator + 1], 'https://github.com/fixture/repository.git');
      const localUrl = pathToFileURL(fetchFixture.remote).href;
      const request = args.at(-1);
      if (args.includes('ls-remote'))
        return ok(execFileSync(executable, ['-C', targetRoot, 'ls-remote', '--refs', '--', localUrl, request], { encoding: 'utf8', windowsHide: true }));
      assert.deepEqual(args.slice(args.indexOf('fetch'), separator), ['fetch', '--no-write-fetch-head', '--no-tags', '--no-prune',
        '--no-recurse-submodules', '--no-auto-maintenance', '--refmap=']);
      execFileSync(executable, ['-C', targetRoot, ...args.slice(args.indexOf('fetch'), separator), '--', localUrl, request],
        { encoding: 'utf8', windowsHide: true, stdio: 'pipe' });
      state.fetchSends = (state.fetchSends ?? 0) + 1;
      save(providerFile, state);
      return ok('');
    },
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
      const externalMerge = external && state.mergeVisible ? {
        state: 'MERGED', merged: true, mergedAt: state.mergedAt,
        mergeCommit: { oid: fetchFixture.merged, messageBody: 'External fixture merge',
          parents: connection(state.squashed ? [{ oid: pr.base_oid }] : [{ oid: state.wrongBase ?? pr.base_oid }, { oid: pr.head_oid }]) },
        baseRef: { target: { oid: state.advancedTip ?? fetchFixture.merged } },
      } : {};
      if (query.startsWith('query AidnPrMerge')) return ok({ data: { repository: {
        id: state.wrongRepo ?? pr.repository_id, nameWithOwner: 'fixture/repository',
        pullRequest: { id: pr.node_id, number: pr.number, headRefOid: state.wrongHead ?? pr.head_oid, headRefName: pr.head_branch,
          baseRefName: pr.base_branch, headRepository: { id: pr.repository_id }, isDraft: false, state: 'OPEN',
          merged: false, mergedAt: null, mergeCommit: null, mergeQueue: state.queued ? { url: 'https://example.com/queue' } : null,
          autoMergeRequest: null, baseRef: { target: { oid: state.baseMoved ? baseTip : pr.base_oid } },
          ...(state.mergeVisible && !external ? { state: 'MERGED', merged: true, mergedAt: state.mergedAt,
            mergedBy: { id: binding.actor.node_id, login: binding.actor.login },
            mergeCommit: { oid: mergeOid, messageBody: state.external ? 'External merge' : state.mergeBody,
              parents: connection([{ oid: pr.base_oid }, { oid: pr.head_oid }]) },
            baseRef: { target: { oid: baseTip } } } : {}),
          ...(state.closed ? { state: 'CLOSED' } : {}), ...externalMerge },
      } } });
      if (query.startsWith('query AidnPrReviewEvent')) {
        assert.deepEqual(variables, { id: eventRef });
        return ok({ data: { node: { __typename: 'PullRequestReview', ...review, isMinimized: false,
          repository: { id: pr.repository_id, nameWithOwner: 'fixture/repository' },
          pullRequest: { id: pr.node_id, number: pr.number, headRefOid: pr.head_oid, baseRefOid: pr.base_oid,
            headRefName: pr.head_branch, baseRefName: pr.base_branch, isDraft: false, state: 'OPEN', merged: false, mergedAt: null, mergeCommit: null,
            baseRef: { target: { oid: pr.base_oid } }, headRepository: { id: pr.repository_id }, baseRepository: { id: pr.repository_id }, ...externalMerge },
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
    async runGithubMerge(binary, args, options) {
      assert.equal(binary, binding.gh.path);
      assert.deepEqual(args, ['api', 'graphql', '--hostname', 'github.com', '--input', '-']);
      const { query, variables: { input } } = JSON.parse(options.input);
      assert.match(query, /^mutation AidnMergePullRequest/);
      const active = inspect().cursor.occurrences.filter(row => row.node_id === 'pr_merge_execute'
        && row.status === 'WAITING' && row.operation?.intent && !row.operation.receipt);
      assert.equal(active.length, 1);
      const record = host.readJournal(active[0].operation.intent.operation_id);
      assert.equal(record.phase, 'dispatching');
      assert.equal(record.owner.pid, process.pid);
      assert.equal(record.intent.authorization_sha256, shadowHash(record.grant));
      const plan = record.preview.prepared.plan.provider.plan;
      assert.deepEqual(input, { pullRequestId: pr.node_id, expectedHeadOid: pr.head_oid, mergeMethod: 'MERGE',
        commitBody: 'AIDN-Merge: ' + plan.correlation_id, clientMutationId: plan.correlation_id });
      assert.deepEqual(state.mergeSends, []);
      state.mergeSends.push(input.clientMutationId);
      state.mergedAt = new Date().toISOString();
      state.mergeBody = input.commitBody;
      state.mergeVisible = ['merge-consent-session', 'merge-consent-renewal'].includes(behavior);
      save(providerFile, state);
      if (!state.mergeVisible) throw Error('Fixture lost the merge acknowledgement');
      return ok({ data: { mergePullRequest: { clientMutationId: input.clientMutationId,
        pullRequest: { id: pr.node_id, merged: true, mergeCommit: { oid: mergeOid } } } } });
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
  const signer = createOperationJournalSigner(readKey), graph = fixtureModel(prefix, Boolean(fetchFixture) && !external, external, pretriage), { model } = graph;
  const wallClock = Date.now, now = () => json(configurationFile).clock_ms ?? wallClock();
  // The protected reader is synchronous. Use the same fixture time for
  // envelope authentication and the H host, while leaving process deadlines
  // and real Git/transport timing on the wall clock.
  const humanSource = data.recovery ? Object.fromEntries(['read', 'verify'].map(method => [method, input => {
    const clock = Date.now;
    try { Date.now = now; return authority.humanSource[method](input); }
    finally { Date.now = clock; }
  }])) : authority.humanSource;
  const mixed = authorize => createStandardWorkflowMixedHost({ configuration, environment, now, readSigningKey: readKey, authorize,
    humanSource, sessionReviewPort: provider.sessionReviewPort,
    ...(pretriage ? { sessionPushPort: provider.sessionPushPort, sessionPullRequestPort: provider.sessionPullRequestPort,
      sessionReviewEventPort: provider.sessionReviewEventPort } : {}) });
  const processAuthority = createStandardProcessAuthority({ configuration, model, readSigningKey: readKey,
    readProductSha256: () => data.recovery || pretriage ? shadowHash([{ path: 'fixture.mjs', present: false }]) : pin(path.join(targetRoot, 'AGENTS.md')).sha256 });
  const entry = options => runStandardWorkflowAction({ request: { fixture: 'R09' }, configuration, modelSource: null, parameters: {}, ...options },
    { authority, compose: mixed });
  const host = createStandardWorkflowOperationHost({ targetRoot, model, processAuthority, now, readSigningKey: readKey,
    humanSource,
    sessionPushPort: provider.sessionPushPort, sessionPullRequestPort: provider.sessionPullRequestPort,
    sessionReviewPort: provider.sessionReviewPort, sessionReviewEventPort: fetchFixture && !external ? null : provider.sessionReviewEventPort,
    authorize(input) {
      grants++;
      return authority.authorizeOperation(input, denied || grants === revokeAt ? null : permitted);
    } }, { dispatchCheckpoint(point) {
      if (interruptCapture && ['post_merge_decision_reserved', 'external_merge_disposition_reserved', 'pr_review_control_reserved'].includes(point)) throw Object.assign(Error('Fixture interrupted capture'), { code: 'FIXTURE_CAPTURE_INTERRUPTED' });
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
    const node = model.nodes.find(row => row.id === id) ?? model.call_targets[0].model.nodes.find(row => row.id === id);
    const binding = bindings.get(node.binding_ref);
    const { input, input_resolution } = resolveStandardProcessInput({ instance: current, occurrenceId, readOperation: id => journal.read(id).record });
    const snapshot = processAuthority.snapshot();
    const preview = signer.seal({ contract_version: 'standard-operation-preview.v1', instance_id: instanceId, instance_sha256: current.instance_sha256,
      scope_id: current.scope_id, model_sha256: current.model_sha256, occurrence_id: occurrenceId, binding, input, input_resolution,
      prepared, snapshot, prepared_at_ms: Date.now() });
    const intent = { contract_version: 'process-operation-intent.v1', operation_id: operationId, binding_ref: binding.id,
      binding_sha256: shadowHash(binding), input_sha256: shadowHash(input), preconditions_sha256: shadowHash({ snapshot, prepared }),
      authorization_sha256: null, authority_id: 'standard_operation_host', scope_id: current.scope_id, instance_id: instanceId,
      instance_sha256: current.instance_sha256, model_sha256: current.model_sha256, occurrence_id: occurrenceId, instance_revision: current.revision };
    if (typeof output === 'function') output = output(operationId);
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
  async function seedPrefix({ initialized = false, stopBeforePremerge = false, stopAtReview = false } = {}) {
    if (!initialized) {
      const initial = host.initialize({ instanceId });
      host.initialize({ instanceId, write: true, expectedResultSha256: initial.record.instance_sha256 });
    }
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
    if (graph.capture) {
      const waiting = inspect(), call = waiting.cursor.occurrences.find(row => row.node_id === graph.capture);
      await host.enterCall({ instanceId, expectedSha256: waiting.record.instance_sha256, occurrenceId: call.occurrence_id,
        eventId: 'enter_review_capture', write: true });
    }
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
    if (stopAtReview) return { request, adapter, update };
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
    if (stopBeforePremerge) return;
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
  return { host, preview, stage, run, inspect, seedPrefix, seed, graph, observePublishedReply, state, providerFile, calls: () => calls, allow: sha => { permitted = sha; },
    signer, journal, control, instances, inbox: createProcessDecisionInboxStore(options), providerTransport, entry, mixed,
    now, interruptCapture: () => { interruptCapture = true; },
    deny: value => { denied = value; }, revokeAt: value => { revokeAt = grants + value; }, interrupt: () => { crash = true; } };
}


function configureActionFixture(base, configuration, graph) {
  const model = path.join(base, 'r09-model.json'), criteria = path.join(base, 'criteria.md');
  save(model, graph.model);
  fs.writeFileSync(criteria, 'R09 question recovery fixture.\n');
  const product = path.join(configuration.target_root, 'product');
  fs.mkdirSync(product);
  Object.assign(configuration, { contract_version: 'agentic-process-execution.v1', model: pin(model), criteria: pin(criteria),
    implementation_sha256: agenticProcessImplementationPins().sha256, product_root: product, product_files: ['fixture.mjs'],
    authorities: { project: pin(path.join(configuration.target_root, 'AGENTS.md')) }, skills: {}, instructions: {}, controller: {} });
  Object.assign(configuration.native, { executable: process.execPath, sha256: pin(process.execPath).sha256,
    model: 'fixture-no-native', effort: 'medium', hook_hashes: { work: ['sha256:' + 'a'.repeat(64), 'sha256:' + 'b'.repeat(64)], review: [] },
    startup: { mcp_server_ids: [], plugin_ids: [], app_ids: [], environment_override_names: [],
      environment_names: [...CODEX_STARTUP_ENVIRONMENT_PROFILES.worker], log_dir: configuration.control_root, sqlite_home: configuration.control_root } });
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
  let fetchFixture;
  if (behavior === 'post-merge-fetch' || behavior.startsWith('external-')) {
    const baseOid = git('rev-parse', 'refs/heads/dev'), tree = git('rev-parse', 'HEAD^{tree}');
    pr.base_oid = baseOid;
    pr.head_oid = git('commit-tree', tree, '-p', baseOid, '-m', 'fixture session commit');
    const merged = git('commit-tree', tree, '-p', baseOid, '-p', pr.head_oid, '-m', 'fixture merge');
    const remote = path.join(base, 'remote.git');
    git('init', '--bare', remote);
    git('--git-dir=' + remote, 'fetch', '--no-write-fetch-head', '--', pathToFileURL(targetRoot).href, merged);
    git('--git-dir=' + remote, 'update-ref', 'refs/heads/dev', merged);
    git('switch', 'dev');
    fetchFixture = { remote, merged };
  }
  const binding = { contract_version: 'standard-host-github.v1', instance_id: configuration.instance_id, target_root: targetRoot,
    repository: { host: 'github.com', owner: 'fixture', name: 'repository', node_id: pr.repository_id },
    actor: { login: 'fixture-actor', node_id: 'U_actor' }, reviewer: { login: 'fixture-reviewer', node_id: 'U_reviewer', type: 'User' },
    git: pin(gitPath), gh: pin(fs.realpathSync(process.platform === 'win32' ? path.join(process.env.SystemRoot, 'System32', 'where.exe') : '/usr/bin/env')) };
  if (behavior.includes('consent') || behavior === 'merge-refusals' || behavior === 'external-checks') binding.required_checks = { contract_version: 'standard-github-required-checks.v1',
    base_ref: pr.base_branch, entries: [{ name: 'Required CI', kind: 'check_run', producer_id: 'A_ci' }] };
  if (['merge-consent-session', 'merge-consent-correction', 'merge-consent-renewal', 'merge-refusals', 'exception-merge-consent-correction', 'external-checks'].includes(behavior)) binding.merge_method = 'MERGE';
  const key = shadowHash({ target: process.platform === 'win32' ? targetRoot.toLowerCase() : targetRoot, instance: configuration.instance_id });
  fs.mkdirSync(path.join(dirs.host, key + '.github'));
  save(path.join(dirs.host, key + '.github.json'), binding);
  if (behavior.startsWith('external-pretriage-')) configureActionFixture(base, configuration, fixtureModel(prefix, false, true, true));
  save(path.join(base, 'configuration.json'), { configuration, home: dirs.host, binding, pr, prefix, behavior, fetchFixture,
    submittedAt: new Date(Date.now() - 1000).toISOString() });
  save(path.join(base, 'provider.json'), { sent: [], replies: [], resolved: false, reviewChanged: false, resolvedThreads: [], resolutionSends: [], mergeSends: [] });
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
  assert.equal(resumed.inspect().cursor.occurrences.find(row => row.status === 'READY').node_id, 'pr_checks_accept');
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
  if (behavior === 'exception-merge-consent-correction') {
    await qualifyConsent(base, privateKey, authority_id, { exceptionSource: sourceRef, fixture: f });
    return;
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

async function qualifyConsent(base, privateKey, authority_id, { exceptionSource, choice = 'approve_merge', fixture } = {}) {
  const { home, pr, prefix, binding, behavior } = json(path.join(base, 'configuration.json'));
  const f = fixture ?? open(base), authorityInbox = path.join(home, 'inbox'), sourceRef = 'merge_consent';
  if (!exceptionSource && !binding.merge_method) {
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
  }
  if (exceptionSource && !binding.merge_method) {
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
  if (!binding.merge_method) assert.equal((await deliver()).status, 'waiting_for_human');
  const body = { contract_version: 'standard-host-source.v1', kind: 'human', authority_id, source_ref: sourceRef,
    subject_sha256: shadowHash(question), payload: claim, issued_at_ms: Date.now(), expires_at_ms: question.expires_at_ms };
  const publish = (value = body) => save(path.join(authorityInbox, sourceRef + '.json'),
    { ...value, signature: sign(null, Buffer.from(shadowHash(value)), privateKey).toString('base64') });
  if (!binding.merge_method) {
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
  } else publish();
  save(f.providerFile, f.state);
  const approved = choice === 'approve_merge';
  if (prefix === 'correction' && !binding.merge_method) {
    const outcome = JSON.parse(execFileSync(process.execPath, [fileURLToPath(import.meta.url), '--receive-exception', base, id, sourceRef],
      { encoding: 'utf8', timeout: 240000, windowsHide: true }));
    assert.equal(outcome.outcome, 'completed');
  } else {
    assert.equal((await deliver()).status, 'receipted');
    await f.host.accept(id, { write: true });
  }
  if (approved && binding.merge_method) {
    if (behavior === 'merge-consent-renewal') {
      await qualifyMergeRenewal(f, { base, id, checks, question, sourceRef, authority_id, privateKey, authorityInbox });
      return;
    }
    await qualifyMerge(f, { base, id, checks, question, behavior, sourceFile: path.join(authorityInbox, sourceRef + '.json') });
    return;
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
  assert.equal(state.cursor.occurrences.some(row => row.node_id === 'pr_merge_execute' && row.status === 'READY'), approved);
  await resumed.host.accept(id, { write: true });
  assert.equal(resumed.inspect().record.instance_sha256, state.record.instance_sha256);
  replay(resumed);
  assert.equal(resumed.host.inspectDiagnostic('r08-' + prefix).content_sha256, state.content_sha256);
  assert.equal(resumed.calls(), 0);
  assert.deepEqual(resumed.state.sent, []);
  assert.deepEqual(resumed.state.resolutionSends, []);
  if (approved && !binding.merge_method) {
    await assert.rejects(resumed.preview, { code: 'STANDARD_PR_MERGE_METHOD_AUTHORITY_REQUIRED' });
    assert.equal(resumed.inspect().record.instance_sha256, state.record.instance_sha256);
  }
  console.log('PASS published R08 exact checks and signed ' + choice + ' at ' + prefix + ', FILES, GitHub transport doubled');
}

async function qualifyMergeRenewal(f, { base, id, checks, question, sourceRef, authority_id, privateKey, authorityInbox }) {
  const original = f.host.readJournal(id);
  const first = await f.preview();
  f.allow(shadowHash(first));
  const { operation_id: attempt } = await f.stage(first);
  const remaining = question.expires_at_ms - Date.now();
  assert.ok(remaining > 0 && remaining <= 300000);
  await new Promise(resolve => setTimeout(resolve, remaining + 20));
  const refused = await f.host.dispatch(attempt, { write: true });
  assert.equal(refused.receipt.effect_status, 'no_effect');
  await f.host.accept(attempt, { write: true });
  const expired = f.host.readJournal(attempt);
  const output = expired.results[0].output;
  assert.equal(output.observations.reason_code, 'STANDARD_PLAN_EXPIRED');
  assert.deepEqual(output.facts, { session_pr_merge_completed: false });
  assert.deepEqual(f.state.mergeSends, []);
  assert.throws(() => assertStandardOperationOutput({ ...output, facts: { session_pr_merge_completed: true } }),
    { code: 'STANDARD_OPERATION_OUTPUT_INVALID' });

  const cold = open(base);
  const prepared = await cold.preview();
  assert.equal(prepared.binding.id, 'session_pr_merge_consent');
  const { operation_id: renewed } = await cold.stage(prepared);
  const wait = await cold.host.dispatch(renewed, { write: true });
  assert.equal(wait.status, 'waiting_for_human');
  const next = wait.question;
  assert.notEqual(renewed, id);
  assert.notEqual(shadowHash(next), shadowHash(question));
  assert.ok(next.issued_at_ms >= question.expires_at_ms);
  assert.deepEqual(next.subject, question.subject);
  await assert.rejects(cold.host.receiveDecision(renewed, { sourceRef, write: true }),
    { code: 'STANDARD_HOST_SOURCE_INVALID' });
  assert.deepEqual(cold.state.mergeSends, []);

  const nextRef = 'merge_consent_renewed';
  const claim = { contract_version: 'human-pr-merge-consent.v1', source_kind: 'human', authority_id, source_event_id: nextRef,
    question_sha256: shadowHash(next), subject_sha256: shadowHash(next.subject), choice: 'approve_merge',
    rationale: 'I approve the fresh question for the exact reviewed PR.',
    evidence_refs: checks.results[0].output.evidence_refs };
  const envelope = { contract_version: 'standard-host-source.v1', kind: 'human', authority_id, source_ref: nextRef,
    subject_sha256: shadowHash(next), payload: claim, issued_at_ms: Date.now(), expires_at_ms: next.expires_at_ms };
  const sourceFile = path.join(authorityInbox, nextRef + '.json');
  save(sourceFile, { ...envelope, signature: sign(null, Buffer.from(shadowHash(envelope)), privateKey).toString('base64') });
  assert.equal((await cold.host.receiveDecision(renewed, { sourceRef: nextRef, write: true })).status, 'receipted');
  await cold.host.accept(renewed, { write: true });
  await qualifyMerge(cold, { base, id: renewed, checks, question: next, behavior: 'merge-consent-session', sourceFile });
  const final = open(base);
  const basis = (await final.run()).results[0].output;
  assert.equal(basis.outcome, 'completed');
  assert.notEqual(basis.observations.merge_operation_id, attempt);
  assert.deepEqual(final.host.readJournal(id), original);
  assert.deepEqual(final.host.readJournal(attempt), expired);
  assert.equal(final.state.mergeSends.length, 1);
  replay(final);
  console.log('PASS expired merge dispatched no effect, cold host accepted a fresh signed choice, one send and exact merge basis');
}

async function qualifyMerge(f, { base, id, checks, question, behavior, sourceFile }) {
  const initial = behavior === 'merge-consent-session', refusals = behavior === 'merge-refusals';
  const waiting = () => {
    const { cursor } = f.inspect();
    assert.notEqual(cursor.status, 'COMPLETED');
    assert.ok(['RUNNING', 'WAITING'].includes(cursor.occurrences.find(row => row.node_id.endsWith('_pr_effects_pending')).status));
    assert.ok(!cursor.occurrences.some(row => row.status === 'READY' && row.node_id.includes('cycle')));
  };
  const preview = await f.preview();
  if (refusals) waiting();
  if (refusals) {
    await assert.rejects(f.stage(preview), { code: 'STANDARD_HOST_EXACT_OPERATION_REQUIRED' });
    const tampered = structuredClone(preview);
    tampered.prepared.plan.provider.plan.request.expected_head_oid = 'e'.repeat(40);
    await assert.rejects(f.stage(tampered), { code: 'PROCESS_JOURNAL_NOT_AUTHENTICATED' });
    const envelope = json(sourceFile);
    save(sourceFile, { ...envelope, payload: { ...envelope.payload, rationale: 'Changed after signature' } });
    try {
      await assert.rejects(f.preview, { code: 'STANDARD_HOST_SOURCE_NOT_AUTHENTICATED' });
    } finally { save(sourceFile, envelope); }

    f.state.checkId = 'CR_replaced';
    const changed = (await f.run(preview)).results[0].output;
    assert.equal(changed.effect_status, 'no_effect');
    assert.equal(changed.observations.reason_code, 'STANDARD_PR_MERGE_CONSENT_SUBJECT_CHANGED');
    delete f.state.checkId;

    const beforeBase = await f.preview();
    f.state.baseMoved = true;
    const moved = (await f.run(beforeBase)).results[0].output;
    assert.equal(moved.effect_status, 'no_effect');
    assert.equal(moved.observations.reason_code, 'GITHUB_PR_SOURCE_CHANGED');
    delete f.state.baseMoved;

    f.state.queued = true;
    await assert.rejects(f.preview, { code: 'GITHUB_PR_MERGE_DIRECT_REQUIRED' });
    delete f.state.queued;
    assert.deepEqual(f.state.mergeSends, []);
    replay(f);
    console.log('PASS published R08 refused substituted plan, grant, signed consent, checks, base and queued merge with zero sends');
    return;
  }
  const applied = await f.run(preview), outcome = applied.results[0].output;
  const plan = preview.prepared.plan, provider = plan.provider.plan;
  assert.equal(preview.input.consent_operation_id, id);
  assert.equal(preview.input.checks_operation_id, checks.operation_id);
  assert.equal(provider.expires_at_ms, question.expires_at_ms);
  assert.equal(plan.consent_receipt_sha256, shadowHash(f.host.readJournal(id).results[0].receipt));
  assert.equal(plan.checks_receipt_sha256, shadowHash(checks.results[0].receipt));
  assert.equal(provider.request.expected_base_oid, question.subject.base_oid);
  assert.equal(f.state.mergeSends.length, 1);
  if (initial) {
    assert.equal(outcome.outcome, 'completed');
    assert.equal(outcome.effect_status, 'confirmed');
    assert.equal(outcome.observations.merge.confirmation, 'acknowledged');
  } else {
    assert.equal(outcome.outcome, 'reconciliation_required');
    assert.equal(outcome.effect_status, 'unknown');
    waiting();
    const operation = applied.operation_id, before = f.inspect().record.instance_sha256;
    const recover = () => JSON.parse(execFileSync(process.execPath, [fileURLToPath(import.meta.url), '--recover-merge', base, operation],
      { encoding: 'utf8', timeout: 240000, windowsHide: true }));
    assert.deepEqual(recover(), { status: 'reconciliation_required', sends: 1, results: 1, instance: before });
    f.state.mergeVisible = true;
    f.state.external = true;
    save(f.providerFile, f.state);
    assert.deepEqual(recover(), { status: 'reconciliation_required', sends: 1, results: 1, instance: before });
    delete f.state.external;
    save(f.providerFile, f.state);
    const recovered = recover();
    assert.equal(recovered.status, 'receipted');
    assert.equal(recovered.sends, 1);
    assert.equal(recovered.results, 2);
    assert.deepEqual(recover(), { ...recovered, status: 'retained_result' });
  }
  const resumed = open(base), retained = resumed.host.readJournal(applied.operation_id);
  const result = retained.results.at(-1).output, { merge } = result.observations;
  assert.equal(result.effect_status, initial ? 'confirmed' : 'no_effect');
  assert.equal(merge.confirmation, initial ? 'acknowledged' : 'observed');
  assert.deepEqual(result.facts, {});
  assert.equal(merge.provider.pull_request.merge_oid, mergeOid);
  assert.equal(merge.provider.pull_request.observed_base_tip_oid, baseTip);
  assert.deepEqual(merge.provider.pull_request.merge_parent_oids, [question.subject.base_oid, question.subject.head_oid]);
  assert.throws(() => assertStandardOperationOutput({ ...result, effect_status: 'unknown' }), { code: 'STANDARD_OPERATION_OUTPUT_INVALID' });
  assert.equal(resumed.inspect().cursor.occurrences.find(row => row.status === 'READY').node_id, 'pr_merge_basis');
  assert.equal(resumed.calls(), 0);
  replay(resumed);
  assert.equal(resumed.state.mergeSends.length, 1);
  console.log('PASS published R08 merge ' + (initial ? 'acknowledged' : 'observed after lost ACK and cold recovery' + (question.subject.resolution_expires_at_ms ? ' with documented exception' : ''))
    + ', exact postimage and R09 fetch ready, no second send');
}

function qualifyPostMergeDecision({ base, home, measurement, fetch, localBefore, merged, git, bare, tip, continuity }) {
  const authority_id = 'fixture-human-r09', { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const authorityInbox = path.join(home, 'inbox'), principalFile = path.join(home, 'principals.json');
  fs.mkdirSync(authorityInbox, { recursive: true });
  save(principalFile, { contract_version: 'standard-host-principals.v1',
    principals: [...(fs.existsSync(principalFile) ? json(principalFile).principals : []),
      { authority_id, kinds: ['human'], public_key: publicKey.export({ type: 'spki', format: 'pem' }) }] });
  return {
    async answer(choice, { negatives = false, cold = false } = {}) {
      const f = open(base), preview = await f.preview();
      assert.equal(preview.binding.id, 'session_pr_post_merge_decision');
      assert.equal(preview.input.measurement_operation_id, measurement.operation_id);
      const { alignment } = preview.prepared.subject;
      assert.equal(alignment.local_head, localBefore);
      assert.equal(alignment.remote_head, merged);
      assert.equal(alignment.fetch_operation_id, measurement.preview.input.fetch_operation_id);
      assert.equal(preview.prepared.subject.measurement_receipt_sha256, shadowHash(measurement.results[0].receipt));
      assert.equal(preview.prepared.subject.merge_receipt_sha256, fetch.merge_receipt_sha256);
      assert.equal(preview.prepared.subject.session_id, 'S001');
      assert.equal(preview.prepared.subject.pull_request_id, 'PR_fixture');
      f.allow(shadowHash(preview));
      const { operation_id: id } = await f.stage(preview);
      const { status, question } = await f.host.dispatch(id, { write: true });
      assert.equal(status, 'waiting_for_human');
      assert.deepEqual(question.choices, alignment.ahead === 0
        ? ['reconcile_manually', 'fast_forward', 'refused', 'deferred', 'cancelled']
        : ['reconcile_manually', 'refused', 'deferred', 'cancelled']);
      assert.equal(question.scope_id, f.inspect().record.scope_id);
      assert.equal(question.intent_sha256, shadowHash(f.host.readJournal(id).intent));
      const sourceRef = 'r09_' + choice;
      const claim = { contract_version: 'human-pr-post-merge-decision.v1', source_kind: 'human', authority_id,
        source_event_id: sourceRef, question_sha256: shadowHash(question), subject_sha256: shadowHash(question.subject), choice,
        rationale: 'The operator will control reconciliation separately after reviewing the source history.',
        evidence_refs: [{ ref: 'git:' + fetch.proof_ref, sha256: shadowHash(alignment) }] };
      function publish(payload, { early = false } = {}) {
        const body = { contract_version: 'standard-host-source.v1', kind: 'human', authority_id, source_ref: sourceRef,
          subject_sha256: shadowHash(question), payload, issued_at_ms: early ? question.issued_at_ms - 1 : Date.now(),
          expires_at_ms: question.expires_at_ms };
        save(path.join(authorityInbox, sourceRef + '.json'), { ...body,
          signature: sign(null, Buffer.from(shadowHash(body)), privateKey).toString('base64') });
      }
      const deliver = () => f.host.receiveDecision(id, { sourceRef, write: true });
      let moved;
      if (negatives) {
        const before = f.inspect().record.instance_sha256;
        assert.deepEqual(await deliver(), { status: 'waiting_for_human', question });
        assert.equal(f.inspect().record.instance_sha256, before);
        publish({ ...claim, rationale: ' ' });
        await assert.rejects(deliver, { code: 'STANDARD_PR_POST_MERGE_DECISION_INVALID' });
        publish({ ...claim, subject_sha256: shadowHash({ ...question.subject, session_id: 'S002' }) });
        await assert.rejects(deliver, { code: 'PROCESS_HUMAN_QUESTION_CHANGED' });
        publish(claim, { early: true });
        await assert.rejects(deliver, { code: 'STANDARD_HOST_SOURCE_INVALID' });
        publish(claim);
        const tree = git('rev-parse', merged + '^{tree}');
        moved = git('commit-tree', tree, '-p', merged, '-m', 'fixture question moves');
        git(bare, 'fetch', '--no-write-fetch-head', '--', git('rev-parse', '--show-toplevel'), moved);
        git(bare, 'update-ref', tip, moved, merged);
        await assert.rejects(deliver, { code: 'STANDARD_PR_POST_MERGE_DECISION_SUBJECT_CHANGED' });
        assert.equal(f.inbox.read(decisionInboxId(claim)).record, null);
        assert.equal(f.host.readJournal(id).phase, 'staged');
        git(bare, 'update-ref', tip, merged, moved);
      }
      publish(claim);
      if (cold) {
        const result = JSON.parse(execFileSync(process.execPath, [fileURLToPath(import.meta.url), '--receive-exception', base, id, sourceRef],
          { encoding: 'utf8', timeout: 240000, windowsHide: true }));
        assert.equal(result.outcome, 'completed');
      } else {
        assert.equal((await deliver()).status, 'receipted');
        if (negatives) {
          const sourceFile = path.join(authorityInbox, sourceRef + '.json'), original = fs.readFileSync(sourceFile);
          const envelope = JSON.parse(original);
          save(sourceFile, { ...envelope, signature: Buffer.alloc(64).toString('base64') });
          try { await assert.rejects(f.host.accept(id, { write: true }), { code: 'STANDARD_HOST_SOURCE_NOT_AUTHENTICATED' }); }
          finally { fs.writeFileSync(sourceFile, original); }
          git(bare, 'update-ref', tip, moved, merged);
          await assert.rejects(f.host.accept(id, { write: true }), { code: 'STANDARD_PR_POST_MERGE_DECISION_SUBJECT_CHANGED' });
          assert.ok(!f.inspect().record.events.some(event => event.receipt?.operation_id === id));
          git(bare, 'update-ref', tip, merged, moved);
        }
        await f.host.accept(id, { write: true });
      }
      const resumed = open(base), result = resumed.host.readJournal(id).results[0];
      const capture = resumed.inbox.read(decisionInboxId(claim)).record;
      resumed.signer.verify(capture);
      assert.equal(capture.contract_version, 'process-decision-inbox.v15');
      assert.equal(capture.phase, 'receipted');
      assert.deepEqual(capture.source, claim);
      assert.equal(capture.receipt_sha256, shadowHash(result.receipt));
      assert.equal(result.output.effect_status, 'no_effect');
      assert.deepEqual(result.output.facts, result.output.outcome === 'completed'
        ? { session_pr_post_merge_fast_forward: choice === 'fast_forward' } : {});
      assert.equal(result.output.observations.choice, choice);
      assert.equal(continuity().completion, null);
      assert.equal(git('rev-parse', 'HEAD'), localBefore);
      assert.equal(resumed.state.fetchSends, 1);
      assert.deepEqual(resumed.state.mergeSends, []);
      if (choice === 'deferred' || choice === 'refused' || choice === 'cancelled') {
        const frame = resumed.inspect().cursor.occurrences.find(row => row.node_id === 'pr_post_merge_decision');
        assert.equal(frame.status, { deferred: 'WAITING', refused: 'FAILED', cancelled: 'CANCELLED' }[choice]);
      }
      assert.equal((await resumed.host.receiveDecision(id, { sourceRef, write: true })).status, 'retained_result');
      await resumed.host.accept(id, { write: true });
      replay(resumed);
      return result.receipt.outcome;
    },
  };
}

async function qualifyQuestionRecovery({ base, scenario, git, bare, tip, merged, localBefore, continuity }) {
  const config = path.join(base, 'configuration.json');
  const setClock = clock_ms => save(config, { ...json(config), clock_ms });
  setClock(Date.now());
  const f = open(base), preview = await f.preview(), { operation_id: id } = await f.stage(preview);
  const question = f.host.prepareDecision(id), staged = f.journal.read(id);
  assert.equal(question.expires_at_ms - question.issued_at_ms, 300000);
  const expectedSha256 = f.inspect().record.instance_sha256;
  const args = { expectedSha256 };
  const prepare = () => f.host.prepareQuestionRecovery(id, args);
  const inventory = () => [git('show-ref'), git(bare, 'show-ref'), git('status', '--porcelain=v1')];
  const assertClosed = () => assert.equal(continuity().completion, null);
  const apply = (plan, host = f) => host.host.applyQuestionRecovery(plan, { write: true, expectedPlanSha256: shadowHash(plan) });
  const { publicKey, privateKey } = generateKeyPairSync('ed25519'), authority_id = 'fixture-human-r09-recovery';
  const home = json(config).home, inbox = path.join(home, 'inbox');
  fs.mkdirSync(inbox);
  save(path.join(home, 'principals.json'), { contract_version: 'standard-host-principals.v1',
    principals: [{ authority_id, kinds: ['human'], public_key: publicKey.export({ type: 'spki', format: 'pem' }) }] });
  function publish(sourceRef, subject, { invalid = false, old = false } = {}) {
    const payload = { contract_version: 'human-pr-post-merge-decision.v1', source_kind: 'human', authority_id,
      source_event_id: sourceRef, question_sha256: shadowHash(subject), subject_sha256: invalid ? '0'.repeat(64) : shadowHash(subject.subject),
      choice: 'reconcile_manually', rationale: 'The operator will control any subsequent Git operation.',
      evidence_refs: [{ ref: 'git:' + subject.subject.alignment.proof_ref, sha256: shadowHash(subject.subject.alignment) }] };
    const body = { contract_version: 'standard-host-source.v1', kind: 'human', authority_id, source_ref: sourceRef,
      subject_sha256: shadowHash(subject), payload, issued_at_ms: old ? subject.issued_at_ms : f.now(), expires_at_ms: subject.expires_at_ms };
    save(path.join(inbox, sourceRef + '.json'), { ...body,
      signature: sign(null, Buffer.from(shadowHash(body)), privateKey).toString('base64') });
    return payload;
  }
  publish('old-r09', question, { old: true });
  setClock(question.expires_at_ms - 1);
  const live = await f.entry();
  assert.equal(live.preview.kind, 'dispatch');
  assert.equal(live.can_apply, false);
  assert.deepEqual(live.preview.payload.question, question);
  if (scenario === 'recover-expired') assert.equal(await prepare(), null);
  assert.equal(f.journal.read(id).content_sha256, staged.content_sha256);
  assertClosed();
  let advanced = merged;
  if (scenario === 'recover-expired') setClock(question.expires_at_ms);
  else if (scenario === 'recover-aligned') git('merge', '--ff-only', merged);
  else {
    advanced = git('commit-tree', merged + '^{tree}', '-p', merged, '-m', 'fresh remote subject');
    git(bare, 'fetch', '--no-write-fetch-head', '--', git('rev-parse', '--show-toplevel'), advanced);
    git(bare, 'update-ref', tip, advanced, merged);
  }
  const exactGit = inventory();
  const ordinary = await f.entry();
  assert.equal(ordinary.preview.kind, 'question_recovery');
  assert.equal(ordinary.written, false);
  const plan = ordinary.preview.payload.recovery_plan;
  assert.equal(plan.reason, scenario === 'recover-expired' ? 'expired' : 'subject_changed');
  assert.equal(plan.observed_at_ms, question.expires_at_ms - (scenario === 'recover-expired' ? 0 : 1));
  assert.equal(plan.next_subject.alignment.remote_head, advanced);
  assert.equal(plan.journal_sha256, shadowHash(staged.record));
  assert.equal(f.inspect().record.instance_sha256, expectedSha256);
  assert.equal(f.journal.read(id).content_sha256, staged.content_sha256);
  await assert.rejects(f.entry({ preparedAction: ordinary.preview, execute: true, expectPlan: 'a'.repeat(64) }),
    { code: 'STANDARD_ENTRY_EXACT_ACTION_REQUIRED' });
  await assert.rejects(apply({ ...plan, reason: 'aligned_without_question' }), { code: 'PROCESS_JOURNAL_NOT_AUTHENTICATED' });
  await assert.rejects(apply(plan), { code: 'STANDARD_HOST_EXACT_OPERATION_REQUIRED' });
  await assert.rejects(f.host.prepareQuestionRecovery(id, { expectedSha256: 'a'.repeat(64) }), { code: 'PROCESS_REVISION_CONFLICT' });
  if (scenario === 'recover-moved') {
    git(bare, 'update-ref', tip, merged, advanced);
    f.allow(shadowHash(plan));
    await assert.rejects(apply(plan), { code: 'STANDARD_PR_POST_MERGE_RECOVERY_PLAN_CHANGED' });
    git(bare, 'update-ref', tip, advanced, merged);
  }
  assert.equal(f.journal.read(id).content_sha256, staged.content_sha256);
  assert.deepEqual(inventory(), exactGit);

  // Persist the disposition, then simulate a lost acknowledgement before
  // reducer acceptance. The ordinary action in a new process adopts that receipt.
  f.allow(shadowHash(plan));
  const persisted = await apply(plan);
  const disposed = f.host.readJournal(id);
  assert.deepEqual(disposed.preview, staged.record.preview);
  assert.deepEqual(disposed.intent, staged.record.intent);
  assert.deepEqual(disposed.grant, staged.record.grant);
  assert.equal(disposed.results.length, 1);
  assert.deepEqual(disposed.results[0].receipt.facts, {});
  assert.equal(disposed.results[0].output.observations.choice, undefined);
  assertClosed();
  assert.equal(f.inspect().record.instance_sha256, expectedSha256);
  const actionFile = path.join(base, 'recovery-action.json');
  save(actionFile, ordinary.preview);
  const cold = JSON.parse(execFileSync(process.execPath, [fileURLToPath(import.meta.url), '--apply-question-recovery', base, actionFile, ordinary.action_sha256],
    { encoding: 'utf8', timeout: 240000, windowsHide: true }));
  assert.equal(cold.status, 'retained_result');
  assert.equal(cold.receiptId, persisted.receipt.receipt_id);
  assert.equal(cold.outcome, scenario === 'recover-aligned' ? 'completed' : 'deferred');
  assert.deepEqual(f.host.readJournal(id), disposed);
  assertClosed();
  assert.deepEqual(inventory(), exactGit);
  await assert.rejects(apply(plan), { code: 'PROCESS_REVISION_CONFLICT' });
  await assert.rejects(f.host.receiveDecision(id, { sourceRef: 'old-r09', write: true }), { code: 'STANDARD_PR_POST_MERGE_QUESTION_DISPOSED' });
  if (scenario !== 'recover-aligned') {
    setClock(question.expires_at_ms + 1);
    const next = await f.entry(), { preview: action } = next;
    assert.equal(action.kind, 'operation');
    const successor = await f.entry({ preparedAction: action, expectPlan: next.action_sha256, execute: true });
    const nextQuestion = successor.result.details.question, nextId = nextQuestion.operation_id;
    assert.notEqual(nextId, id);
    assert.deepEqual(nextQuestion.replaces, { operation_id: id, intent_sha256: shadowHash(disposed.intent),
      disposition_receipt_sha256: shadowHash(persisted.receipt) });
    assert.equal(nextQuestion.subject.alignment.remote_head, advanced);
    assert.equal(nextQuestion.subject.alignment.local_head, localBefore);
    const submit = async sourceRef => {
      const next = await f.entry({ decisionSource: sourceRef });
      return f.entry({ decisionSource: sourceRef, preparedAction: next.preview, expectPlan: next.action_sha256, execute: true });
    };
    await assert.rejects(submit('old-r09'), { code: 'STANDARD_HOST_SOURCE_INVALID' });
    publish('bad-subject', nextQuestion, { invalid: true });
    await assert.rejects(submit('bad-subject'), { code: 'PROCESS_HUMAN_QUESTION_CHANGED' });
    const fresh = publish('fresh-r09', nextQuestion);
    const freshId = decisionInboxId(fresh);
    if (scenario === 'recover-moved') {
      const before = f.inspect().record.instance_sha256;
      f.interruptCapture();
      await assert.rejects(f.host.receiveDecision(nextId, { sourceRef: 'fresh-r09', write: true }), { code: 'FIXTURE_CAPTURE_INTERRUPTED' });
      assert.equal(f.inbox.read(freshId).record.phase, 'reserved');
      assert.equal(f.host.readJournal(nextId).phase, 'dispatching');
      assert.equal(f.host.readJournal(nextId).results.length, 0);
      await assert.rejects(f.host.prepareQuestionRecovery(nextId, { expectedSha256: before }),
        { code: 'STANDARD_PR_POST_MERGE_CAPTURE_RECONCILIATION_REQUIRED' });
      const competing = publish('competing-r09', nextQuestion);
      await assert.rejects(submit('competing-r09'), { code: 'STANDARD_PR_POST_MERGE_CAPTURE_RECONCILIATION_REQUIRED' });
      assert.equal(f.inbox.read(decisionInboxId(competing)).record, null);
    }
    const answer = await submit('fresh-r09');
    assert.equal(answer.result.operation_outcome, 'completed');
    assert.equal(f.inbox.read(freshId).record.phase, 'receipted');
    assert.deepEqual(f.inbox.read(freshId).record.source, fresh);
    await assert.rejects(f.host.prepareQuestionRecovery(nextId, { expectedSha256: f.inspect().record.instance_sha256 }),
      { code: 'STANDARD_PR_POST_MERGE_RECOVERY_WAIT_REQUIRED' });
  }
  setClock(null);
  assert.deepEqual(inventory(), exactGit);
  assertClosed();
  const calls = f.calls();
  for (const observation of ['replay', 'simulate']) {
    const observed = await f.entry({ observation });
    assert.equal(observed.result.instance_sha256, f.inspect().record.instance_sha256);
    assert.equal(observed.written, false);
  }
  assert.equal(f.calls(), calls);
  assert.equal(open(base).state.fetchSends, 1);
  console.log(JSON.stringify({ recovery: scenario, operation_id: id, receipt_id: persisted.receipt.receipt_id,
    intent_sha256: shadowHash(disposed.intent), plan_sha256: shadowHash(plan), before_instance_sha256: expectedSha256,
    after_instance_sha256: f.inspect().record.instance_sha256, git_unchanged: true, continuity_before_proof: 'blocked' }));
  return advanced;
}

function seedPrOpening(f, pr, targetRoot) {
  const link = { ...pr, contract_version: 'github-pr-link.v1', title_sha256: shadowHash('fixture title'), body_sha256: shadowHash('fixture body') };
  const openId = f.seed('session_pr_open', { facts: { session_pr_open_confirmed: true },
    observations: { session_id: 'S001', pull_request: link }, evidence_refs: [{ ref: 'github:pr/fixture', sha256: shadowHash(link) }] });
  const audit = path.join(targetRoot, 'docs/audit'), sessionPath = 'sessions/S001.md', sessionFile = path.join(audit, sessionPath);
  const fields = { state: 'CLOSED', session_id: 'S001', session_closure_status: 'completed', mode: 'COMMITTING',
    updated_at: new Date().toISOString(), session_branch: pr.head_branch, pr_status: 'none', pr_url: 'none',
    pr_number: 'none', pr_base_branch: 'none', pr_head_branch: 'none', pr_review_status: 'unknown',
    post_merge_sync_status: 'not_needed', post_merge_sync_basis: 'none' };
  const session = '# Session S001\n\n' + Object.entries(fields).map(([key, value]) => key + ': ' + value).join('\n')
    + '\n\n### Session close gate satisfied?\n- [x] Yes\n';
  const current = fs.readFileSync(path.join(audit, 'CURRENT-STATE.md'), 'utf8')
    .replace(/^active_session:.*$/m, 'active_session: S001').replace(/^mode:.*$/m, 'mode: COMMITTING')
    .replace(/^branch_kind:.*$/m, 'branch_kind: source');
  const documents = [[sessionPath, session], ['CURRENT-STATE.md', current],
    ['snapshots/context-snapshot.md', fs.readFileSync(path.join(audit, 'snapshots/context-snapshot.md'), 'utf8')]]
    .map(([path, content]) => ({ path, content, sha256: artifactContentHash(content) }));
  for (const document of renderStandardSessionPrRecord({ source: { session_id: 'S001', session_path: sessionPath,
    open_operation_id: openId, pull_request: link }, documents, preparedAt: Date.now() }))
    fs.writeFileSync(path.join(audit, document.path), document.text_chunks.join(''));
  return { openId, audit, sessionFile };
}

async function qualifyPostMergeFetch(prefix, scenario = 'reconcile') {
  const base = arrange(prefix, 'post-merge-fetch');
  const configurationFile = path.join(base, 'configuration.json');
  if (scenario.startsWith('recover-')) {
    const data = json(configurationFile), { configuration } = data;
    configureActionFixture(base, configuration, fixtureModel(prefix, true));
    save(configurationFile, { ...data, recovery: true });
  }
  const f = open(base, { initializeKey: true });
  const data = json(configurationFile), { configuration: { instance_id: instanceId, target_root: targetRoot }, binding, pr, fetchFixture } = data;
  const git = (...args) => execFileSync(binding.git.path, ['-C', targetRoot, ...args], { encoding: 'utf8', windowsHide: true }).trim();
  const bare = '--git-dir=' + fetchFixture.remote;
  const initial = f.host.initialize({ instanceId });
  f.host.initialize({ instanceId, write: true, expectedResultSha256: initial.record.instance_sha256 });
  const { openId, audit, sessionFile } = seedPrOpening(f, pr, targetRoot);
  const fastForward = scenario === 'fast-forward';
  if (fastForward) {
    fs.writeFileSync(path.join(targetRoot, 'fixture-update.txt'), 'before\n');
    fs.writeFileSync(path.join(targetRoot, 'fixture-remove.txt'), 'remove\n');
    git('add', '--', 'fixture-update.txt', 'fixture-remove.txt');
    fs.appendFileSync(path.join(targetRoot, '.git/info/exclude'), '\nfixture-ignore.txt\n');
    fs.writeFileSync(path.join(targetRoot, 'fixture-ignore.txt'), 'preserve\n');
  }
  git('add', '--', 'docs/audit');
  git('commit', '-m', 'fixture PR opening marker');
  const sourceHead = git('rev-parse', 'HEAD'), sourceTree = git('rev-parse', 'HEAD^{tree}');
  let mergedTree = sourceTree;
  if (fastForward) {
    const altIndex = path.join(base, 'remote.index');
    const alt = (...args) => execFileSync(binding.git.path, ['-C', targetRoot, ...args],
      { env: { ...process.env, GIT_INDEX_FILE: altIndex }, encoding: 'utf8', windowsHide: true }).trim();
    const blob = path.join(base, 'remote-blob');
    fs.writeFileSync(blob, 'after\n');
    const blobOid = git('hash-object', '-w', blob);
    alt('read-tree', sourceTree);
    alt('update-index', '--add', '--cacheinfo', '100644,' + blobOid + ',fixture-update.txt');
    alt('update-index', '--add', '--cacheinfo', '100644,' + blobOid + ',fixture-add.txt');
    alt('update-index', '--force-remove', '--', 'fixture-remove.txt');
    mergedTree = alt('write-tree');
  }
  const merged = git('commit-tree', mergedTree, '-p', sourceHead, '-p', pr.head_oid, '-m', 'fixture accepted merge');
  git(bare, 'fetch', '--no-write-fetch-head', '--', targetRoot, merged);
  git(bare, 'update-ref', 'refs/heads/dev', merged, fetchFixture.merged);
  fetchFixture.merged = merged;
  save(configurationFile, data);
  // The corrective case has two lines of history and therefore no FF strategy.
  const ambiguous = prefix === 'correction' && !fastForward;
  if (ambiguous) git('commit', '--allow-empty', '-m', 'fixture local-only source commit');
  if (scenario === 'nominal') git('merge', '--ff-only', merged);
  const localBefore = git('rev-parse', 'HEAD');
  git('update-ref', 'refs/remotes/origin/dev', sourceHead);
  git('config', 'remote.origin.fetch', '+refs/heads/*:refs/remotes/origin/*');
  git('branch', '--set-upstream-to=origin/dev', 'dev');
  process.env.AIDN_STANDARD_HOST_HOME = data.home;
  const start = () => runStartSessionAdmitUseCase({ targetRoot });
  const cycle = () => runCycleCreateAdmitUseCase({ targetRoot, mode: 'COMMITTING' });
  const prewrite = () => preWriteAdmit({ targetRoot, skill: 'cycle-create' }, { providerTransport: f.providerTransport });
  const continuity = (sessionId = 'S001', content = fs.readFileSync(sessionFile, 'utf8')) =>
    readStandardPostMergeContinuity({ targetRoot, sessionId, content });
  assert.equal(continuity().completion, null);
  assert.notEqual((await start()).action, 'create_session_allowed');
  assert.equal((await cycle()).reason_code, 'CYCLE_CREATE_SESSION_PR_OPEN');
  assert.equal((await prewrite()).checks.git_cycle_create_upstream_sync.pass, false);
  f.seed(f.graph.triage, { facts: {}, observations: {} });
  const beforeCall = f.inspect(), call = beforeCall.cursor.occurrences.find(row => row.node_id === f.graph.call);
  await f.host.enterCall({ instanceId, expectedSha256: beforeCall.record.instance_sha256, occurrenceId: call.occurrence_id,
    eventId: 'call_review', write: true });
  const stamp = new Date().toISOString();
  const mergeId = f.seed('pr_merge_execute', id => {
    const provider = { contract_version: 'github-pr-merge-observation.v2', observed_from: stamp, observed_until: stamp,
      repository: { node_id: pr.repository_id, owner: binding.repository.owner, name: binding.repository.name },
      pull_request: { node_id: pr.node_id, number: pr.number, head_repository_id: pr.repository_id,
        head_ref: pr.head_branch, head_oid: pr.head_oid, base_ref: pr.base_branch, observed_base_tip_oid: fetchFixture.merged,
        state: 'MERGED', is_draft: false, merged: true, merged_at: stamp, merge_oid: fetchFixture.merged,
        merge_parent_oids: [sourceHead, pr.head_oid], merged_by: binding.actor, commit_body_sha256: shadowHash('fixture marker') } };
    const merge = { operation_id: id, plan_sha256: shadowHash('merge plan'), consent_receipt_sha256: shadowHash('consent'),
      checks_receipt_sha256: shadowHash('checks'), method: 'MERGE', confirmation: 'observed', provider };
    return { facts: { session_pr_merge_completed: true }, observations: { merge }, evidence_refs: [{ ref: 'github:pr-merge/' + pr.node_id, sha256: shadowHash(merge) }] };
  });
  const mergeReceipt = f.host.readJournal(mergeId).results[0].receipt;
  await f.run(); // Select the exact accepted merge basis in the shared call.
  const preview = await f.preview();
  assert.deepEqual(preview.input, { contract_version: 'standard-pr-post-merge-fetch-input.v1', merge_operation_id: mergeId });
  assert.equal(preview.prepared.plan.merge_receipt_sha256, shadowHash(mergeReceipt));
  assert.equal(preview.prepared.plan.git.plan.merge_oid, fetchFixture.merged);
  assert.equal(preview.prepared.plan.git.plan.source_ref, 'refs/heads/dev');
  assert.equal(f.state.fetchSends ?? 0, 0);
  await assert.rejects(f.stage(preview), { code: 'STANDARD_HOST_EXACT_OPERATION_REQUIRED' });
  const interruptFetch = prefix === 'correction' && !fastForward;
  let id;
  if (!interruptFetch) {
    id = (await f.run(preview)).operation_id;
  } else {
    f.allow(shadowHash(preview));
    ({ operation_id: id } = await f.stage(preview));
    f.interrupt();
    await assert.rejects(f.host.dispatch(id, { write: true }), { code: 'FIXTURE_DISPATCH_INTERRUPTED' });
    assert.equal(f.state.fetchSends, 1);
    assert.equal(f.host.readJournal(id).phase, 'dispatching');
    const cold = JSON.parse(execFileSync(process.execPath, [fileURLToPath(import.meta.url), '--recover-post-merge-fetch', base, id],
      { encoding: 'utf8', timeout: 240000, windowsHide: true }));
    assert.deepEqual(cold, { status: 'receipted', sends: 1, reads: 0, results: 1 });
  }
  let resumed = open(base);
  const record = resumed.host.readJournal(id), output = record.results[0].output, { fetch } = output.observations;
  assert.equal(output.outcome, 'completed');
  assert.equal(output.effect_status, interruptFetch ? 'no_effect' : 'confirmed');
  assert.equal(fetch.confirmation, interruptFetch ? 'observed' : 'executed');
  assert.equal(fetch.merge_operation_id, mergeId);
  assert.equal(fetch.merge_receipt_sha256, shadowHash(mergeReceipt));
  assert.equal(fetch.fetched_head, fetchFixture.merged);
  assert.equal(fetch.ahead, ambiguous ? 1 : 0);
  assert.equal(fetch.behind, scenario === "nominal" ? 0 : 2);
  assert.deepEqual(output.facts, {});
  assert.throws(() => assertStandardOperationOutput({ ...output, facts: { post_merge_sync_complete: true } }),
    { code: 'STANDARD_OPERATION_OUTPUT_INVALID' });
  let advanced = merged;
  const tip = 'refs/heads/dev';
  const measurementPreview = await resumed.preview();
  assert.deepEqual(measurementPreview.input, { contract_version: 'standard-pr-post-merge-alignment-input.v1', fetch_operation_id: id });
  assert.equal(measurementPreview.prepared.fetch_receipt_sha256, shadowHash(record.results[0].receipt));
  const measurement = await resumed.run(measurementPreview), first = measurement.results[0].output;
  assert.equal(first.outcome, 'completed');
  assert.equal(first.effect_status, 'no_effect');
  assert.equal(first.observations.alignment.fetch_receipt_sha256, shadowHash(record.results[0].receipt));
  assert.equal(first.observations.alignment.remote_head, merged);
  assert.equal(first.observations.alignment.local_head, git('rev-parse', 'HEAD'));

  if (scenario === 'nominal') {
    assert.equal(first.observations.reason_code, 'STANDARD_PR_POST_MERGE_ALIGNED');
    assert.deepEqual(first.facts, { session_pr_post_merge_diverged: false });
    assert.equal(resumed.inspect().cursor.occurrences.find(row => row.status === 'READY').node_id, 'pr_post_merge_complete');
  } else {
    assert.equal(first.observations.reason_code, 'STANDARD_PR_POST_MERGE_DIVERGENCE');
    assert.equal(first.observations.alignment.ahead, ambiguous ? 1 : 0);
    assert.equal(first.observations.alignment.behind, 2);
    assert.deepEqual(first.facts, { session_pr_post_merge_diverged: true });
    assert.throws(() => assertStandardOperationOutput({ ...first, outcome: 'deferred' }), { code: 'STANDARD_OPERATION_OUTPUT_INVALID' });
    const historical = { ...first, contract_version: 'standard-pr-post-merge-alignment-output.v1',
      operation_ref: 'session_pr_post_merge_alignment', outcome: 'deferred', facts: {} };
    assert.deepEqual(assertStandardOperationOutput(historical), historical);
    assert.throws(() => assertStandardOperationOutput({ ...historical, outcome: 'completed' }), { code: 'STANDARD_OPERATION_OUTPUT_INVALID' });
    if (scenario.startsWith('recover-')) {
      advanced = await qualifyQuestionRecovery({ base, scenario, git, bare, tip, merged, localBefore, continuity });
      resumed = open(base);
      assert.equal(resumed.inspect().cursor.occurrences.find(row => row.status === 'READY').node_id, 'pr_post_merge_alignment');
      assert.notEqual((await start()).action, 'create_session_allowed');
      assert.equal((await cycle()).reason_code, 'CYCLE_CREATE_SESSION_PR_OPEN');
      if (scenario !== 'recover-aligned') {
        assert.equal((await resumed.run()).results[0].output.outcome, 'deferred');
        if (ambiguous) {
          git('merge', '--no-ff', '--no-edit', advanced);
          const converged = git('rev-parse', 'HEAD');
          git(bare, 'fetch', '--no-write-fetch-head', '--', targetRoot, converged);
          git(bare, 'update-ref', tip, converged, advanced);
          advanced = converged;
        } else git('merge', '--ff-only', advanced);
      }
    } else if (fastForward) {
      const human = qualifyPostMergeDecision({ base, home: data.home, measurement, fetch, localBefore, merged, git, bare, tip, continuity });
      assert.equal(await human.answer('fast_forward'), 'completed');
      resumed = open(base);
      const ff = await resumed.preview();
      assert.equal(ff.binding.id, 'session_pr_post_merge_fast_forward');
      assert.equal(ff.prepared.plan.git.source_ref, tip);
      assert.equal(ff.prepared.plan.git.local_head, localBefore);
      assert.equal(ff.prepared.plan.git.remote_head, merged);
      assert.equal(ff.prepared.plan.git.behind, 2);
      await assert.rejects(resumed.stage(ff), { code: 'STANDARD_HOST_EXACT_OPERATION_REQUIRED' });
      resumed.allow(shadowHash(ff));
      const { operation_id: effectId } = await resumed.stage(ff);
      resumed.deny(true);
      await assert.rejects(resumed.host.dispatch(effectId, { write: true }), { code: 'STANDARD_HOST_EXACT_OPERATION_REQUIRED' });
      assert.equal(git('rev-parse', 'HEAD'), localBefore);
      assert.equal(resumed.host.readJournal(effectId).phase, 'staged');
      resumed.deny(false);
      const marker = 'AIDN post-merge fast-forward ' + shadowHash(ff.prepared.plan.git);
      if (prefix === 'correction') {
        resumed.interrupt();
        await assert.rejects(resumed.host.dispatch(effectId, { write: true }), { code: 'FIXTURE_DISPATCH_INTERRUPTED' });
        assert.equal(resumed.host.readJournal(effectId).phase, 'dispatching');
        assert.equal(git('rev-parse', 'HEAD'), merged);
        const cold = JSON.parse(execFileSync(process.execPath, [fileURLToPath(import.meta.url), '--recover-post-merge-fetch', base, effectId],
          { encoding: 'utf8', timeout: 240000, windowsHide: true }));
        assert.deepEqual(cold, { status: 'receipted', sends: 1, reads: 0, results: 1 });
      } else {
        const dispatch = await resumed.host.dispatch(effectId, { write: true });
        assert.equal(dispatch.receipt.outcome, 'completed', JSON.stringify(resumed.host.readJournal(effectId).results));
        assert.equal(dispatch.receipt.effect_status, 'confirmed');
        await resumed.host.accept(effectId, { write: true });
      }
      assert.equal(git('symbolic-ref', 'HEAD'), tip);
      assert.equal(git('rev-parse', 'HEAD'), merged);
      assert.equal(git(bare, 'rev-parse', tip), merged);
      assert.equal(git('write-tree'), mergedTree);
      assert.equal(git('status', '--porcelain'), '');
      assert.equal(git('reflog', '--format=%gs', 'HEAD').split(/\r?\n/).filter(row => row === marker).length, 1);
      assert.equal(git('reflog', '--format=%gs', tip).split(/\r?\n/).filter(row => row === marker).length, 1);
      assert.equal(fs.readFileSync(path.join(targetRoot, 'fixture-update.txt'), 'utf8').trim(), 'after');
      assert.equal(fs.readFileSync(path.join(targetRoot, 'fixture-add.txt'), 'utf8').trim(), 'after');
      assert.equal(fs.existsSync(path.join(targetRoot, 'fixture-remove.txt')), false);
      assert.equal(fs.readFileSync(path.join(targetRoot, 'fixture-ignore.txt'), 'utf8'), 'preserve\n');
      assert.equal(continuity().completion, null);
      assert.equal((await cycle()).reason_code, 'CYCLE_CREATE_SESSION_PR_OPEN');
      console.log('PASS R09 ' + prefix + ' exact signed choice, separate grant, real checkout and one local ref advance');
    } else {
      const human = qualifyPostMergeDecision({ base, home: data.home, measurement, fetch, localBefore, merged, git, bare, tip, continuity });
      const outcome = await human.answer(scenario === 'reconcile' ? (ambiguous ? 'reconcile_manually' : 'deferred') : scenario,
        { negatives: scenario === 'reconcile' && !ambiguous });
      if (scenario === 'refused' || scenario === 'cancelled') {
        assert.equal(outcome, scenario === 'refused' ? 'rejected' : 'cancelled');
        assert.equal((await cycle()).reason_code, 'CYCLE_CREATE_SESSION_PR_OPEN');
        console.log('PASS R09 signed ' + scenario + ', FILES, continuity blocked');
        return;
      }
      if (outcome === 'deferred') await human.answer('reconcile_manually', { cold: true });
      resumed = open(base);
      assert.equal(resumed.inspect().cursor.occurrences.find(row => row.status === 'READY').node_id, 'pr_post_merge_alignment');
      assert.equal(continuity().completion, null);
      assert.equal((await cycle()).reason_code, 'CYCLE_CREATE_SESSION_PR_OPEN');
      assert.equal(git('rev-parse', 'HEAD'), localBefore);

      if (!ambiguous) {
        // A deleted ref and a newly advertised OID absent locally cannot prove sync.
        git(bare, 'update-ref', '-d', tip, merged);
        const absent = (await resumed.run()).results[0].output;
        assert.equal(absent.outcome, 'blocked');
        assert.equal(absent.observations.reason_code, 'WORKFLOW_POST_MERGE_REMOTE_REF_REQUIRED');
        advanced = git(bare, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid',
          'commit-tree', sourceTree, '-p', merged, '-m', 'fixture target advances');
        git(bare, 'update-ref', tip, advanced);
        const missing = (await resumed.run()).results[0].output;
        assert.equal(missing.outcome, 'deferred');
        assert.equal(missing.observations.reason_code, 'WORKFLOW_POST_MERGE_FRESH_FETCH_REQUIRED');
        git('fetch', '--no-write-fetch-head', '--refmap=', '--', pathToFileURL(fetchFixture.remote).href, advanced);
        git('merge', '--ff-only', advanced);
      } else {
        const stillDiverged = (await resumed.run()).results[0].output;
        assert.equal(stillDiverged.outcome, 'deferred');
        assert.equal(stillDiverged.observations.alignment.ahead, 1);
        assert.equal(stillDiverged.observations.alignment.behind, 2);
        // The operator merges the two tips. An independent remote fixture actor
        // then adopts the resulting history, with no push or provider mutation.
        git('merge', '--no-ff', '--no-edit', merged);
        advanced = git('rev-parse', 'HEAD');
        assert.equal(git('rev-parse', 'HEAD^1'), localBefore);
        assert.equal(git('rev-parse', 'HEAD^2'), merged);
        git(bare, 'fetch', '--no-write-fetch-head', '--', targetRoot, advanced);
        git(bare, 'update-ref', tip, advanced, merged);
      }
    }
    resumed = open(base);
    const confirmed = (await resumed.run()).results[0].output;
    assert.equal(confirmed.outcome, 'completed');
    assert.equal(confirmed.effect_status, 'no_effect');
    assert.equal(confirmed.observations.reason_code, 'STANDARD_PR_POST_MERGE_ALIGNED');
    assert.equal(confirmed.observations.alignment.fetch_receipt_sha256, shadowHash(record.results[0].receipt));
    assert.equal(confirmed.observations.alignment.local_head, advanced);
    assert.equal(confirmed.observations.alignment.remote_head, advanced);
    assert.equal(confirmed.observations.alignment.fetched_head, merged);
    assert.deepEqual(confirmed.facts, {});
  }
  const completionPreview = await resumed.preview();
  assert.equal(completionPreview.prepared.plan.opening_operation_id, openId);
  assert.equal(completionPreview.prepared.plan.merge_receipt_sha256, shadowHash(mergeReceipt));
  assert.equal(completionPreview.prepared.plan.aligned_head, advanced);
  assert.equal(continuity().completion, null);
  await assert.rejects(resumed.stage(completionPreview), { code: 'STANDARD_HOST_EXACT_OPERATION_REQUIRED' });
  resumed.allow(shadowHash(completionPreview));
  const { operation_id: completionId } = await resumed.stage(completionPreview);
  if (prefix === 'correction' && !fastForward) {
    resumed.interrupt();
    await assert.rejects(resumed.host.dispatch(completionId, { write: true }), { code: 'FIXTURE_DISPATCH_INTERRUPTED' });
  } else {
    assert.equal((await resumed.host.dispatch(completionId, { write: true })).receipt.outcome, 'completed');
    assert.equal(continuity().completion, null, 'a signed but unaccepted completion cannot admit');
    assert.notEqual((await start()).action, 'create_session_allowed');
    assert.equal((await cycle()).reason_code, 'CYCLE_CREATE_SESSION_PR_OPEN');
    const original = fs.readFileSync(sessionFile, 'utf8');
    fs.writeFileSync(sessionFile, original.replace(/^pr_status: open$/m, 'pr_status: merged')
      .replace(/^post_merge_sync_status: not_needed$/m, 'post_merge_sync_status: done'));
    try {
      assert.notEqual((await start()).action, 'create_session_allowed');
      assert.equal((await cycle()).reason_code, 'CYCLE_CREATE_POST_MERGE_SYNC_REQUIRED');
    } finally { fs.writeFileSync(sessionFile, original); }
    if (advanced !== merged) {
      git(bare, 'update-ref', tip, merged, advanced);
      await assert.rejects(resumed.host.accept(completionId, { write: true }), { code: 'STANDARD_PR_POST_MERGE_COMPLETION_ALIGNMENT_CHANGED' });
      git(bare, 'update-ref', tip, advanced, merged);
    }
  }
  const cold = JSON.parse(execFileSync(process.execPath, [fileURLToPath(import.meta.url), '--recover-post-merge-completion', base, completionId],
    { encoding: 'utf8', timeout: 240000, windowsHide: true }));
  assert.deepEqual(cold, { outcome: 'completed', result: 'COMPLETED', sends: 1 });
  resumed = open(base);
  // A later workflow's key is distinct. Admission still locates the accepted
  // result and its key from the opening journal of the origin instance.
  const successor = createStandardHostAuthority({ configuration: { ...data.configuration, instance_id: 'fixture-successor' },
    environment: process.env }, { useProvider: false });
  successor.ensureKey();
  assert.notEqual(successor.keyId(), resumed.signer.keyId);
  const proof = continuity().completion;
  assert.equal(proof?.instanceId, instanceId);
  assert.equal(proof?.plan.aligned_head, advanced);
  assert.equal((await start()).action, 'create_session_allowed');
  assert.notEqual((await cycle()).reason_code, 'CYCLE_CREATE_SESSION_PR_OPEN');
  assert.equal(git('rev-parse', 'refs/remotes/origin/dev'), sourceHead);
  assert.equal((await prewrite()).checks.git_cycle_create_upstream_sync.pass, true);
  assert.equal(git('rev-parse', 'refs/remotes/origin/dev'), sourceHead);
  assert.equal(git('status', '--porcelain'), '');
  git('update-ref', 'refs/heads/' + pr.head_branch, advanced);
  git('switch', pr.head_branch);
  assert.equal((await cycle()).action, 'proceed_r2_session_base_with_import');
  git('switch', 'dev');

  if (prefix === 'session' && scenario === 'reconcile') {
    const journalFile = path.join(audit, 'workflows/operation-records', completionId + '.json');
    const saved = fs.readFileSync(journalFile), completionRecord = JSON.parse(saved);
    const rejects = async altered => {
      save(journalFile, altered);
      try {
        assert.equal(continuity().completion, null);
        assert.notEqual((await start()).action, 'create_session_allowed');
        assert.equal((await cycle()).reason_code, 'CYCLE_CREATE_SESSION_PR_OPEN');
      } finally { fs.writeFileSync(journalFile, saved); }
    };
    await rejects({ ...completionRecord, authentication: 'f'.repeat(64) });
    await rejects(resumed.signer.seal({ ...completionRecord, preview: resumed.signer.seal({ ...completionRecord.preview, instance_id: 'other-instance' }) }));
    const retainedSession = fs.readFileSync(sessionFile, 'utf8');
    for (const text of [retainedSession.replace(pr.node_id, 'PR_other'), retainedSession.replace(openId, dummy)]) {
      fs.writeFileSync(sessionFile, text);
      try { assert.equal(continuity().completion, null); } finally { fs.writeFileSync(sessionFile, retainedSession); }
    }
    assert.equal(continuity('S002', retainedSession).completion, null);
    const witness = git('rev-parse', '--path-format=absolute', '--git-path', 'logs/' + fetch.proof_ref);
    const witnessBytes = fs.readFileSync(witness);
    fs.writeFileSync(witness, 'invalid fixture witness\n');
    try { assert.equal(continuity().completion, null); } finally { fs.writeFileSync(witness, witnessBytes); }
    git(bare, 'update-ref', 'refs/heads/dev', merged, advanced);
    assert.equal((await prewrite()).checks.git_cycle_create_upstream_sync.pass, false);
    git(bare, 'update-ref', 'refs/heads/dev', advanced, merged);
  }
  replay(resumed);
  assert.equal(resumed.state.fetchSends, 1);
  assert.equal(git('status', '--porcelain'), '');
  if (scenario === 'nominal') assert.ok(!resumed.inspect().record.events.some(event =>
    event.intent?.binding_ref === 'session_pr_post_merge_decision'));
  console.log('PASS R09 ' + prefix + ' ' + scenario + ' call, accepted canonical proof, admissions, stale tracking, refusals, cold recovery and replay');

}

async function qualifyExternalMerge(scenario) {
  const checks = scenario === 'checks', pretriage = scenario.startsWith('pretriage-');
  const nominal = scenario === 'pretriage-nominal';
  const prefix = checks || scenario === 'pretriage-session' || nominal ? 'session' : 'correction';
  const base = arrange(prefix, pretriage ? 'external-' + scenario : checks ? 'external-checks' : 'external-premerge');
  const configFile = path.join(base, 'configuration.json'), data = json(configFile);
  const { home, configuration: { target_root: targetRoot, instance_id: instanceId }, binding, pr, fetchFixture } = data;
  const git = (...args) => execFileSync(binding.git.path, ['-C', targetRoot, ...args],
    { encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const authority_id = 'fixture-human-external', { publicKey, privateKey } = generateKeyPairSync('ed25519');
  fs.mkdirSync(path.join(home, 'inbox'));
  save(path.join(home, 'principals.json'), { contract_version: 'standard-host-principals.v1',
    principals: [{ authority_id, kinds: ['human'], public_key: publicKey.export({ type: 'spki', format: 'pem' }) }] });
  let f = open(base, { initializeKey: true });
  const initial = f.host.initialize({ instanceId });
  f.host.initialize({ instanceId, write: true, expectedResultSha256: initial.record.instance_sha256 });
  const { audit, sessionFile } = seedPrOpening(f, pr, targetRoot);
  git('add', '--', 'docs/audit');
  git('commit', '-m', 'fixture PR opening marker');
  pr.base_oid = git('rev-parse', 'HEAD');
  const merged = git('commit-tree', 'HEAD^{tree}', '-p', pr.base_oid, '-p', pr.head_oid, '-m', 'fixture external merge');
  const bare = '--git-dir=' + fetchFixture.remote;
  git(bare, 'fetch', '--no-write-fetch-head', '--', targetRoot, merged);
  git(bare, 'update-ref', 'refs/heads/dev', pr.base_oid, fetchFixture.merged);
  git('update-ref', 'refs/remotes/origin/dev', pr.base_oid);
  git('config', 'remote.origin.fetch', '+refs/heads/*:refs/remotes/origin/*');
  git('branch', '--set-upstream-to=origin/dev', 'dev');
  fetchFixture.merged = merged;
  save(configFile, data);
  process.env.AIDN_STANDARD_HOST_HOME = home;
  const continuity = () => readStandardPostMergeContinuity({ targetRoot, sessionId: 'S001', content: fs.readFileSync(sessionFile, 'utf8') });
  const start = () => runStartSessionAdmitUseCase({ targetRoot });
  const cycle = () => runCycleCreateAdmitUseCase({ targetRoot, mode: 'COMMITTING' });
  const assertLocked = async () => {
    assert.equal(continuity().completion, null);
    assert.notEqual((await start()).action, 'create_session_allowed');
    assert.equal((await cycle()).reason_code, 'CYCLE_CREATE_SESSION_PR_OPEN');
  };
  git('update-ref', 'refs/heads/' + pr.head_branch, pr.head_oid);
  git('switch', pr.head_branch);
  f = open(base);
  const atReview = await f.seedPrefix({ initialized: true, stopBeforePremerge: !checks, stopAtReview: pretriage });
  const updateProvider = changes => { Object.assign(f.state, changes); save(f.providerFile, f.state); };
  const prior = f.inspect().record.events.filter(e => e.kind === 'operation_result').map(e => e.receipt);
  const controlPreview = () => f.entry({ controlSource: externalRef });
  const applyCall = async () => {
    const { record, cursor } = f.inspect();
    const call = cursor.occurrences.find(row => ['call_entry', 'call_return'].includes(row.wait_reason));
    assert.ok(call);
    const enter = call.wait_reason === 'call_entry';
    return f.host[enter ? 'enterCall' : 'returnCall']({ instanceId, expectedSha256: record.instance_sha256,
      occurrenceId: call.occurrence_id, eventId: (enter ? 'enter_' : 'return_') + call.node_id, write: true });
  };
  let observed, externalEvidence;
  if (pretriage) {
    const { request, update, adapter } = atReview, slot = controlReservationId(request);
    const readOnlyObservation = () => f.host.previewExternalMerge({ instanceId, expectedSha256: request.instance_sha256,
      occurrenceId: request.occurrence_id });
    assert.equal((await controlPreview()).preview.payload.reason, 'external_merge_open');
    assert.equal(f.control.read(slot).record, null);
    assert.equal(f.inspect().record.instance_sha256, request.instance_sha256);
    updateProvider({ closed: true });
    await assert.rejects(readOnlyObservation(), { code: 'STANDARD_PR_MERGE_CLOSED_UNMERGED' });
    updateProvider({ closed: false });
    if (nominal) {
      // The nominal review source reads and verifies the doubled provider using
      // the signed prefix's resolved delivery context. Only the prefix authority
      // is supplied by the fixture. Reserve through the actual FILES inbox.
      const inbox = createStandardControlInbox({ store: f.control, signer: f.signer, source: adapter });
      const capture = await inbox.reserveReview(request, eventRef);
      assert.equal(f.control.read(slot).record.capture_id, capture.inbox_id);
      assert.equal(capture.phase, 'reserved');
      await assert.rejects(readOnlyObservation(), { code: 'PROCESS_CONTROL_CAPTURE_RECONCILIATION_REQUIRED' });
      const delivery = await inbox.verifyDelivery(capture.inbox_id);
      const before = f.instances.read(instanceId);
      const accepted = advanceAgenticProcess(before.record, { kind: 'control', occurrence_id: request.occurrence_id,
        event_id: 'control_' + capture.inbox_id.slice(8), delivery });
      f.instances.compareAndSwap(accepted, before.content_sha256);
      inbox.acknowledge(capture.inbox_id, accepted.instance_sha256);
      await applyCall();
      const routed = await f.run();
      assert.equal(routed.results[0].receipt.facts.session_pr_pretriage_external, false);
      assert.equal((await f.preview()).binding.id, 'session_pr_review_receive');
      assert.equal(f.inspect().record.events.filter(row => row.kind === 'control').length, 1);
      replay(f);
      console.log(JSON.stringify({ verdict: 'PASS', scenario, nominal_capture: capture.inbox_id,
        incident_capture_refused: true, next: f.graph.receive }));
      return;
    }
    git(bare, 'update-ref', 'refs/heads/dev', merged, pr.base_oid);
    const mergedAt = new Date().toISOString();
    const substitutions = [{ wrongHead: 'a'.repeat(40) }, { wrongBase: 'a'.repeat(40) }, { wrongRepo: 'R_other' },
      { mergedAt: new Date(0).toISOString() }, { advancedTip: baseTip }, { squashed: true }];
    for (const changes of prefix === 'session' ? substitutions : [substitutions[0]]) {
      updateProvider({ mergeVisible: true, mergedAt, ...changes });
      await assert.rejects(readOnlyObservation(), error => /^GITHUB_|^STANDARD_PR_/.test(error.code));
      assert.equal(f.control.read(slot).record, null);
      for (const key of Object.keys(changes)) delete f.state[key];
    }
    updateProvider({ mergeVisible: true, mergedAt });
    const planned = await controlPreview();
    assert.equal(planned.preview.kind, 'control');
    assert.equal(f.control.read(slot).record, null);
    assert.equal(f.inspect().record.instance_sha256, request.instance_sha256);
    const input = { instanceId, expectedSha256: request.instance_sha256, occurrenceId: request.occurrence_id, sourceRef: externalRef };
    await assert.rejects(f.host.captureControl({ ...input, write: true }), { code: 'PROCESS_CONTROL_EXTERNAL_MERGE_EXACT_PLAN_REQUIRED' });
    await assert.rejects(f.entry({ controlSource: externalRef, preparedAction: planned.preview, expectPlan: 'f'.repeat(64), execute: true }),
      { code: 'STANDARD_ENTRY_EXACT_ACTION_REQUIRED' });
    await assert.rejects(f.host.captureControl({ ...input, write: true, expectedSubjectSha256: 'f'.repeat(64) }),
      { code: 'PROCESS_CONTROL_EXTERNAL_MERGE_PLAN_CHANGED' });
    assert.equal(f.control.read(slot).record, null);
    f.interruptCapture();
    await assert.rejects(f.host.captureControl({ ...input, expectedSubjectSha256: planned.preview.payload.merge_subject_sha256, write: true }),
      { code: 'FIXTURE_CAPTURE_INTERRUPTED' });
    const { capture_id: id } = f.control.read(slot).record;
    assert.equal(f.control.read(id).record.phase, 'reserved');
    if (prefix === 'session') {
      save(configFile, { ...data, clock_ms: Date.now() + 300001 });
      await assert.rejects(f.host.deliverControl(id, { write: true }), { code: 'STANDARD_PR_EXTERNAL_MERGE_CAPTURE_EXPIRED' });
      save(configFile, data);
      assert.equal(f.control.read(id).record.phase, 'reserved');
      assert.equal(f.inspect().record.instance_sha256, request.instance_sha256);
    }
    await assert.rejects(f.host.captureControl({ ...input, sourceRef: eventRef, write: true }),
      { code: 'PROCESS_CONTROL_CAPTURE_RECONCILIATION_REQUIRED' });
    const actionFile = path.join(base, 'pretriage-action.json');
    save(actionFile, planned.preview);
    const cold = JSON.parse(execFileSync(process.execPath, [fileURLToPath(import.meta.url), '--deliver-pretriage', base, actionFile, planned.action_sha256],
      { encoding: 'utf8', timeout: 180000, windowsHide: true }));
    assert.equal(cold.written, true);
    f = open(base);
    const capture = f.control.read(id).record;
    assert.equal(capture.phase, 'delivered');
    assert.equal(capture.payload.update_operation_id, update);
    assert.equal(f.inspect().record.events.filter(row => row.kind === 'control').length, 1);
    externalEvidence = capture.source.evidence_refs;
    await applyCall();
    assert.equal((await f.run()).results[0].receipt.facts.session_pr_pretriage_external, true);
    await applyCall();
    git('switch', 'dev');
    console.log(JSON.stringify({ scenario, captured: id, occurrence: request.occurrence_id, action_sha256: planned.action_sha256,
      transport: 'github_double', persisted: 'FILES', denied_substitution: true }));
  } else {
    git('switch', 'dev');
    if (checks) {
      f.observePublishedReply();
      f.state.resolvedThreads.push('T_C_root');
      f.state.pendingCheck = true;
      save(f.providerFile, f.state);
      // The two preceding selections are synthetic signed prefix receipts.
      f.seed('pr_reply_select', { facts: { session_pr_replies_observed: true }, observations: { selection: null } });
      f.seed('pr_resolution_select', { facts: { session_pr_threads_observed_resolved: true,
        session_pr_resolution_gate_met: true, session_pr_resolution_exception_required: false }, observations: { selection: null } });
      await f.run();
      const waiting = await f.run();
      assert.equal(waiting.results[0].output.observations.reason_code, 'STANDARD_PR_CHECK_PENDING');
      assert.equal(waiting.results[0].receipt.outcome, 'deferred');
    } else {
      updateProvider({ closed: true });
      const closed = await f.run();
      assert.equal(closed.results[0].receipt.outcome, 'blocked');
      assert.equal(closed.results[0].output.observations.reason_code, 'STANDARD_PR_MERGE_CLOSED_UNMERGED');
      updateProvider({ closed: false });
    }
    prior.splice(0, prior.length, ...f.inspect().record.events.filter(e => e.kind === 'operation_result').map(e => e.receipt));
    git(bare, 'update-ref', 'refs/heads/dev', merged, pr.base_oid);
    if (scenario === 'premerge') {
      for (const changes of [{ wrongHead: 'a'.repeat(40) }, { wrongBase: 'a'.repeat(40) }, { wrongRepo: 'R_other' },
        { mergedAt: new Date(0).toISOString() }, { advancedTip: baseTip }, { squashed: true }]) {
        updateProvider({ mergeVisible: true, mergedAt: new Date().toISOString(), ...changes });
        const rejected = (await f.run()).results[0].output;
        assert.equal(rejected.outcome, 'blocked', JSON.stringify(rejected));
        assert.deepEqual(rejected.facts, {});
        for (const key of Object.keys(changes)) delete f.state[key];
      }
    }
    updateProvider({ mergeVisible: true, mergedAt: new Date().toISOString() });
    observed = await f.run();
    assert.equal(observed.results[0].output.contract_version, 'standard-pr-external-merge-observation-output.v1', JSON.stringify(observed.results));
    assert.equal(observed.results[0].receipt.effect_status, 'no_effect');
    externalEvidence = observed.results[0].output.evidence_refs;
  }
  const preview = await f.preview();
  assert.equal(preview.binding.id, 'session_pr_external_merge_disposition');
  f.allow(shadowHash(preview));
  const { operation_id: id } = await f.stage(preview);
  const { status, question } = await f.host.dispatch(id, { write: true });
  assert.equal(status, 'waiting_for_human');
  if (pretriage) {
    assert.equal(question.contract_version, 'standard-pr-external-merge-disposition-question.v2');
    assert.equal(question.subject.update_operation_id, atReview.update);
    assert.equal(Object.hasOwn(question.subject, 'triage_operation_id'), false);
  } else assert.equal(question.subject.observation_operation_id, observed.operation_id);
  assert.equal(question.subject.merge_observation.provider.pull_request.merge_oid, merged);
  assert.equal(question.subject.incident, 'R08_PREMERGE_CONTROLS_UNESTABLISHED');
  const choice = ['refused', 'cancelled'].includes(scenario) ? scenario : 'acknowledge_external_merge_for_r09';
  const sourceRef = 'external_disposition';
  assert.equal((await f.host.receiveDecision(id, { sourceRef, write: true })).status, 'waiting_for_human');
  await assertLocked();
  const claim = { contract_version: 'human-pr-external-merge-disposition.v1', source_kind: 'human', authority_id,
    source_event_id: sourceRef, question_sha256: shadowHash(question), subject_sha256: shadowHash(question.subject), choice,
    severity: 'L2_MEDIUM', rationale: 'I reviewed the incident and its exact external postimage.',
    evidence_refs: externalEvidence };
  const body = { contract_version: 'standard-host-source.v1', kind: 'human', authority_id, source_ref: sourceRef,
    subject_sha256: shadowHash(question), payload: claim, issued_at_ms: Date.now(), expires_at_ms: question.expires_at_ms };
  const sourceFile = path.join(home, 'inbox', sourceRef + '.json');
  const signature = sign(null, Buffer.from(shadowHash(body)), privateKey).toString('base64');
  save(sourceFile, { ...body, signature: 'A'.repeat(86) + '==' });
  await assert.rejects(f.host.receiveDecision(id, { sourceRef, write: true }), { code: 'STANDARD_HOST_SOURCE_NOT_AUTHENTICATED' });
  if (pretriage) {
    const high = { ...body, payload: { ...claim, severity: 'L3_HIGH' } };
    save(sourceFile, { ...high, signature: sign(null, Buffer.from(shadowHash(high)), privateKey).toString('base64') });
    await assert.rejects(f.host.receiveDecision(id, { sourceRef, write: true }),
      { code: 'STANDARD_PR_EXTERNAL_MERGE_DECISION_INVALID' });
  }
  save(sourceFile, { ...body, signature });
  f.interruptCapture();
  await assert.rejects(f.host.receiveDecision(id, { sourceRef, write: true }), { code: 'FIXTURE_CAPTURE_INTERRUPTED' });
  assert.equal(f.host.readJournal(id).phase, 'dispatching');
  const reserved = f.inbox.read(decisionInboxId(claim));
  assert.equal(reserved.record.phase, 'reserved');
  if (scenario.startsWith('premerge')) {
    const alternateRef = 'alternate_disposition', journal = f.journal.read(id);
    const alternate = { ...body, source_ref: alternateRef, payload: { ...claim, source_event_id: alternateRef } };
    save(path.join(home, 'inbox', alternateRef + '.json'), { ...alternate,
      signature: sign(null, Buffer.from(shadowHash(alternate)), privateKey).toString('base64') });
    await assert.rejects(f.host.receiveDecision(id, { sourceRef: alternateRef, write: true }),
      { code: 'STANDARD_PR_EXTERNAL_MERGE_CAPTURE_RECONCILIATION_REQUIRED' });
    assert.equal(f.journal.read(id).content_sha256, journal.content_sha256);
    assert.equal(f.inbox.read(decisionInboxId(claim)).content_sha256, reserved.content_sha256);
    assert.equal(f.inbox.read(decisionInboxId(alternate.payload)).record, null);
  }
  const cold = JSON.parse(execFileSync(process.execPath, [fileURLToPath(import.meta.url), '--receive-exception', base, id, sourceRef],
    { encoding: 'utf8', timeout: 180000, windowsHide: true }));
  assert.equal(cold.outcome, choice === 'refused' ? 'rejected' : choice === 'cancelled' ? 'cancelled' : 'completed');
  f = open(base);
  const disposition = f.host.readJournal(id), receipt = disposition.results[0].receipt;
  assert.equal(disposition.results.length, 1);
  assert.deepEqual(receipt.facts, {});
  await assertLocked();
  if (choice === 'acknowledge_external_merge_for_r09') {
    assert.equal((await f.run()).results[0].output.observations.merge_operation_id, id);
    if (scenario === 'premerge-boundary' || scenario === 'pretriage-correction') {
      const next = await f.preview();
      assert.equal(next.binding.id, 'session_pr_post_merge_fetch');
      assert.equal(next.input.merge_operation_id, id);
      assert.equal(next.prepared.plan.merge_receipt_sha256, shadowHash(receipt));
      assert.equal(next.prepared.plan.git.plan.merge_oid, merged);
      assert.equal(f.state.fetchSends ?? 0, 0);
    } else {
      const fetch = (await f.run()).results[0].output.observations.fetch;
      assert.equal(fetch.merge_receipt_sha256, shadowHash(receipt));
      assert.equal(fetch.merge_oid, merged);
      const measurement = await f.run();
      assert.equal(measurement.results[0].output.facts.session_pr_post_merge_diverged, true);
      await assertLocked();
      const decision = qualifyPostMergeDecision({ base, home, measurement, fetch, localBefore: pr.base_oid,
        merged, git, bare, tip: 'refs/heads/dev', continuity });
      await decision.answer('reconcile_manually');
      git('merge', '--ff-only', merged);
      f = open(base);
      await f.run(); // Fresh zero/zero alignment.
      await assertLocked();
      const completePlan = await f.preview();
      f.allow(shadowHash(completePlan));
      const { operation_id: completionId } = await f.stage(completePlan);
      assert.equal((await f.host.dispatch(completionId, { write: true })).receipt.outcome, 'completed');
      await assertLocked();
      await f.host.accept(completionId, { write: true });
      assert.equal(continuity().completion?.plan.merge_receipt_sha256, shadowHash(receipt));
      assert.equal((await start()).action, 'create_session_allowed');
      assert.notEqual((await cycle()).reason_code, 'CYCLE_CREATE_SESSION_PR_OPEN');
      assert.equal(f.state.fetchSends, 1);
    }
  }
  if (pretriage && prefix === 'session') await applyCall();
  const record = f.inspect().record;
  if (pretriage) assert.ok(!record.events.some(e => ['session_pr_review_receive', 'session_pr_triage_evaluate', 'session_pr_checks_accept'].includes(e.intent?.binding_ref)));
  assert.deepEqual(record.events.filter(e => e.kind === 'operation_result').slice(0, prior.length).map(e => e.receipt), prior);
  assert.ok(!record.events.some(event => ['session_pr_merge_consent', 'session_pr_merge_execute'].includes(event.intent?.binding_ref)));
  assert.deepEqual(f.state.mergeSends, []);
  assert.deepEqual(f.state.sent, []);
  assert.deepEqual(f.state.resolutionSends, []);
  replay(f);
  console.log(JSON.stringify({ verdict: 'PASS', scenario, instance_sha256: record.instance_sha256, revision: record.revision, audit }));
}

async function qualifyNominalConsent(prefix, choice, behavior = 'consent-session') {
  const base = arrange(prefix, behavior), f = open(base, { initializeKey: true });
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

if (process.argv[2] === '--deliver-pretriage') {
  const [, , , base, actionFile, expectPlan] = process.argv;
  const result = await open(base).entry({ controlSource: externalRef, actionFile, expectPlan, execute: true });
  console.log(JSON.stringify({ written: result.written }));
} else if (/^--case=external-(checks|premerge|premerge-boundary|refused|cancelled|pretriage-session|pretriage-correction|pretriage-nominal)$/.test(process.argv[2])) {
  await qualifyExternalMerge(process.argv[2].slice('--case=external-'.length));
} else if (process.argv[2] === '--finish-external-call') {
  const f = open(process.argv[3]), before = f.inspect();
  const call = before.cursor.occurrences.find(row => row.node_id === f.graph.call && row.wait_reason === 'call_return');
  assert.ok(call, 'Expected a finished R09 child awaiting its call return');
  const completed = await f.host.returnCall({ instanceId: before.record.instance_id, expectedSha256: before.record.instance_sha256,
    occurrenceId: call.occurrence_id, eventId: 'return_external_r09', write: true });
  assert.equal(completed.cursor.status, 'COMPLETED');
  replay(f);
  assert.equal(f.calls(), 0);
  console.log(JSON.stringify({ verdict: 'PASS', result: completed.cursor.status, revision: completed.record.revision,
    instance_sha256: completed.record.instance_sha256, provider_reads: 0 }));
} else if (/^--case=post-merge-recover-(expired|moved|aligned)$/.test(process.argv[2])) {
  const mode = process.argv[2].slice('--case=post-merge-'.length);
  await qualifyPostMergeFetch(mode === 'recover-moved' ? 'correction' : 'session', mode);
} else if (process.argv[2] === '--apply-question-recovery') {
  const [, , , base, actionFile, expectPlan] = process.argv;
  const result = await open(base).entry({ actionFile, expectPlan, execute: true });
  assert.equal(result.result.action_kind, 'question_recovery');
  assert.equal(result.result.effect_status, 'no_effect');
  assert.equal(result.result.native_started, false);
  assert.equal(result.result.workflow_completed, false);
  console.log(JSON.stringify({ status: result.result.details.status, outcome: result.result.operation_outcome,
    receiptId: result.result.details.receipt.receipt_id }));
} else if (/^--case=post-merge-fast-forward-(session|correction)$/.test(process.argv[2])) {
  await qualifyPostMergeFetch(process.argv[2].split('-').at(-1), 'fast-forward');
} else if (/^--case=post-merge-fetch-(session|correction|nominal|refused|cancelled)$/.test(process.argv[2])) {
  const mode = process.argv[2].slice('--case=post-merge-fetch-'.length);
  await qualifyPostMergeFetch(mode === 'correction' ? 'correction' : 'session',
    ['session', 'correction'].includes(mode) ? 'reconcile' : mode);
} else if (['--case=merge-consent-session', '--case=merge-consent-correction', '--case=merge-consent-renewal', '--case=merge-refusals'].includes(process.argv[2])) {
  await qualifyNominalConsent(process.argv[2].endsWith('correction') ? 'correction' : 'session', 'approve_merge', process.argv[2].slice('--case='.length));
} else if (process.argv[2] === '--case=exception-merge-consent-correction') {
  await qualifyException('exception-merge-consent-correction');
} else if (['--case=consent-session', '--case=consent-refused', '--case=consent-correction'].includes(process.argv[2])) {
  await qualifyNominalConsent(process.argv[2] === '--case=consent-correction' ? 'correction' : 'session',
    process.argv[2] === '--case=consent-refused' ? 'refused' : 'approve_merge');
} else if (/^--case=exception-(session|correction|consent-correction|refused|deferred|cancelled)$/.test(process.argv[2])) {
  await qualifyException(process.argv[2].slice('--case='.length));
} else if (process.argv[2] === '--receive-exception') {
  const [, , , base, id, sourceRef] = process.argv, f = open(base);
  const before = f.host.readJournal(id);
  if (before.intent.binding_ref === 'session_pr_external_merge_disposition') {
    assert.equal(before.phase, 'dispatching');
    assert.match(before.decision_claim_sha256, /^[a-f0-9]{64}$/);
  } else assert.equal((await f.host.dispatch(id, { write: true })).status, 'waiting_for_human');
  const { status, receipt } = await f.host.receiveDecision(id, { sourceRef, write: true });
  assert.equal(status, 'receipted');
  await f.host.accept(id, { write: true });
  console.log(JSON.stringify({ outcome: receipt.outcome }));
} else if (['--case=resolve-missing', '--case=resolve-interrupted'].includes(process.argv[2])) {
  await qualifyResolution(process.argv[2].slice('--case='.length));
} else if (process.argv[2] === '--verify-retained') {
  verifyRetained(process.argv[3]);
} else if (process.argv[2] === '--recover-post-merge-completion') {
  const f = open(process.argv[3]), id = process.argv[4], before = f.host.readJournal(id);
  f.allow(shadowHash(before.preview));
  const dispatched = await f.host.dispatch(id, { write: true });
  assert.ok(['retained_result', 'receipted'].includes(dispatched.status));
  const result = await f.host.accept(id, { write: true });
  const after = f.host.readJournal(id);
  assert.deepEqual(after.grant, before.grant);
  assert.deepEqual(after.owner, before.owner);
  assert.deepEqual(after.intent, before.intent);
  assert.deepEqual(after.results.slice(0, before.results.length), before.results);
  const call = result.cursor.occurrences.find(row => row.wait_reason === 'call_return');
  assert.equal(call?.node_id, f.graph.call);
  const returned = await f.host.returnCall({ instanceId: result.record.instance_id, expectedSha256: result.record.instance_sha256,
    occurrenceId: call.occurrence_id, eventId: 'return_review', write: true });
  replay(f);
  console.log(JSON.stringify({ outcome: dispatched.receipt.outcome, result: returned.cursor.status, sends: f.state.fetchSends }));
} else if (['--recover-merge', '--recover-post-merge-fetch'].includes(process.argv[2])) {
  const f = open(process.argv[3]), id = process.argv[4], before = f.host.readJournal(id);
  f.allow(shadowHash(before.preview));
  const result = await f.host.dispatch(id, { write: true });
  if (result.status === 'receipted') await f.host.accept(id, { write: true });
  const after = f.host.readJournal(id);
  assert.deepEqual(after.owner, before.owner);
  assert.deepEqual(after.intent, before.intent);
  assert.deepEqual(after.grant, before.grant);
  assert.deepEqual(after.results.slice(0, before.results.length), before.results);
  replay(f);
  console.log(JSON.stringify(process.argv[2] === '--recover-merge' ? { status: result.status, sends: f.state.mergeSends.length,
    results: after.results.length, instance: f.inspect().record.instance_sha256 }
    : { status: result.status, sends: f.state.fetchSends, reads: f.calls(), results: after.results.length }));
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
      assert.equal(f.inspect().cursor.occurrences.find(row => row.status === 'READY').node_id, 'pr_checks_accept');
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
