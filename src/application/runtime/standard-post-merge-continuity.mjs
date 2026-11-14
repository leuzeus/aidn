import fs from 'node:fs';
import path from 'node:path';
import { readStandardHostInstance } from '../../adapters/runtime/standard-host-authority.mjs';
import { createStandardGithubProviderHost } from '../../adapters/runtime/standard-github-provider-host.mjs';
import { createAgenticProcessStore } from '../../adapters/runtime/agentic-process-store.mjs';
import { createProcessControlInboxStore } from '../../adapters/runtime/process-control-inbox-store.mjs';
import { createPretriageMergeSource } from './standard-session-pr-pretriage-merge.mjs';
import { createProcessOperationJournalStore } from '../../adapters/runtime/process-operation-journal-store.mjs';
import { createOperationJournalSigner, operationJournalId } from '../../core/workflow/process-operation-journal.mjs';
import { assertPostMergeCompleteInput, assertPostMergeCompleteOutput, postMergeCompleteOperation } from '../../core/workflow/standard-pr-post-merge-complete.mjs';
import { shadowHash } from '../../core/workflow/shadow-json.mjs';
import { assertStandardOperationOutput } from '../../core/workflow/standard-operation-contracts.mjs';
import { agentRunPhysicalPath } from './agent-run-configuration-service.mjs';
import { createStandardWorkflowArtifacts } from './standard-workflow-artifacts.mjs';
import { createStandardSessionPrPostMergeFetch } from './standard-session-pr-post-merge-fetch.mjs';
import { latestIntent, postMergeCompletionSource, postMergeProjectScope, readPrOpeningLocator } from './standard-session-pr-post-merge-completion.mjs';

const required = 'STANDARD_PR_POST_MERGE_COMPLETION_PROOF_REQUIRED';
const fail = () => { throw Object.assign(Error(required), { code: required }); };
const exact = (left, right) => shadowHash(left) === shadowHash(right);

export const hasPrOpeningLocator = content => /^## Process PR opening[ \t]*\r?$/m.test(content ?? '');

function authenticatedJournal(journal, signer) {
  return id => {
    const record = journal.read(id).record;
    if (!record) fail();
    signer.verify(record);
    signer.verify(record.preview);
    return record;
  };
}

function acceptedOperation(read, instance, id, binding) {
  const record = read(id), result = record?.results.at(-1), intent = record?.intent, preview = record?.preview;
  if (record?.phase !== 'receipted' || intent.binding_ref !== binding || preview.binding.id !== binding
    || intent.instance_id !== instance.instance_id || intent.scope_id !== instance.scope_id || intent.model_sha256 !== instance.model_sha256
    || ['instance_id', 'scope_id', 'model_sha256', 'occurrence_id', 'instance_sha256'].some(field => preview[field] !== intent[field])
    || operationJournalId(intent, intent.occurrence_id) !== id
    || intent.binding_sha256 !== shadowHash(preview.binding) || intent.input_sha256 !== shadowHash(preview.input)
    || intent.preconditions_sha256 !== shadowHash({ snapshot: preview.snapshot, prepared: preview.prepared })
    || result?.receipt.outcome !== 'completed'
    || !instance.events.some(event => event.kind === 'operation_intent' && exact(event.intent, intent))
    || !instance.events.some(event => event.kind === 'operation_result' && exact(event.receipt, result.receipt))) fail();
  return { record, output: result.output };
}

// FILES delivery journals stay in the checkout when Git switches from the PR
// branch back to its base. Discover openings whose session artifact has not
// arrived yet. Database authority continues through the canonical session store.
export function hasInvisibleStandardPrOpening({ targetRoot, sourceBranch, environment = process.env }) {
  try {
    const artifacts = createStandardWorkflowArtifacts({ targetRoot, env: environment });
    const state = artifacts.describe();
    if (state.database) return false;
    const directory = agentRunPhysicalPath(path.join(artifacts.root, 'docs/audit/workflows/process-instances'), { missing: true });
    if (!fs.existsSync(directory)) return false;
    const entries = fs.readdirSync(directory, { withFileTypes: true }).filter(entry => entry.name.endsWith('.json'));
    if (entries.length > 1024 || entries.some(entry => !entry.isFile() || !/^[a-z][a-z0-9_-]{0,95}\.json$/.test(entry.name))) fail();
    const options = { targetRoot: artifacts.root, stateMode: state.state_mode, env: environment };
    const instances = createAgenticProcessStore(options), journals = createProcessOperationJournalStore(options);
    for (const { name } of entries) {
      const instance = instances.read(name.slice(0, -5)).record;
      if (!instance) fail();
      const opening = latestIntent(instance, 'session_pr_open');
      if (!opening || !instance.events.some(event => event.kind === 'operation_result'
        && event.receipt.operation_id === opening.operation_id && event.receipt.outcome === 'completed')) continue;
      const host = readStandardHostInstance({ targetRoot: artifacts.root, instanceId: instance.instance_id, environment });
      const read = authenticatedJournal(journals, createOperationJournalSigner(host.readKey));
      const accepted = acceptedOperation(read, instance, opening.operation_id, 'session_pr_open');
      const { observations: { session_id: sessionId, pull_request: link }, facts } = assertStandardOperationOutput(accepted.output);
      if (!/^S[0-9]{3,6}$/.test(sessionId ?? '') || link?.state !== 'OPEN' || link.draft || facts.session_pr_open_confirmed !== true) fail();
      if (link.base_branch !== sourceBranch) continue;
      const session = artifacts.read('sessions/' + sessionId + '.md');
      const marker = readPrOpeningLocator(session.content);
      if (!marker || marker.open_operation_id !== opening.operation_id || marker.observation_sha256 !== shadowHash(link)) return true;
    }
    return false;
  } catch {
    return true;
  }
}

function completionPort({ host, targetRoot, instanceId }, environment, providerTransport) {
  const provider = createStandardGithubProviderHost({ configuration: { target_root: targetRoot, instance_id: instanceId },
    home: host.home, identity: host.identity, environment }, providerTransport);
  if (!provider) fail();
  return provider.sessionReviewPort.postMergeFetch;
}

// Lookup is canonical and local. The locator cannot select a store, key
// location, repository, operation type or a substitute instance.
export function readStandardPostMergeContinuity({ targetRoot, sessionId, sessionPath, sourceBranch, content, environment = process.env }) {
  if (!hasPrOpeningLocator(content)) return { managed: false };
  try {
    if (!/^S[0-9]{3,6}$/.test(sessionId)) fail();
    const artifacts = createStandardWorkflowArtifacts({ targetRoot, env: environment });
    const target = artifacts.root, options = { targetRoot: target, stateMode: artifacts.describe().state_mode, env: environment };
    const name = 'sessions/' + sessionId + '.md';
    if (sessionPath !== undefined && sessionPath !== name) fail();
    const session = artifacts.read(name, { required: true });
    const marker = readPrOpeningLocator(session.content);
    if (!marker || !exact(marker, readPrOpeningLocator(content))) fail();
    const journal = createProcessOperationJournalStore(options), opening = journal.read(marker.open_operation_id).record;
    if (!opening || opening.intent.binding_ref !== 'session_pr_open') fail();
    const instanceId = opening.intent.instance_id;
    const host = readStandardHostInstance({ targetRoot: target, instanceId, environment });
    const signer = createOperationJournalSigner(host.readKey);
    const read = authenticatedJournal(journal, signer);
    const instance = createAgenticProcessStore(options).read(instanceId).record;
    if (!instance || !exact(read(marker.open_operation_id), opening)) fail();
    const completionIntent = latestIntent(instance, postMergeCompleteOperation);
    if (!completionIntent) fail();
    const { record, output } = acceptedOperation(read, instance, completionIntent.operation_id, postMergeCompleteOperation);
    if (record.preview.binding.effect_class !== 'mutating' || !record.grant || record.intent.authorization_sha256 !== shadowHash(record.grant)
      || record.grant.authorized !== true) fail();

    // Resolve upstream records from the prefix that existed before completion.
    const prefixEnd = instance.events.findIndex(event => event.kind === 'operation_intent' && event.intent.operation_id === completionIntent.operation_id);
    const prefix = { ...instance, events: instance.events.slice(0, prefixEnd) };
    const readAccepted = (state, id, binding) => {
      if (latestIntent(state, binding)?.operation_id !== id) fail();
      return acceptedOperation(read, state, id, binding);
    };
    const inbox = createProcessControlInboxStore(options);
    const { readPretriage } = createPretriageMergeSource({ readAcceptedUpdate: readAccepted, readControl(id) {
      const capture = inbox.read(id).record;
      if (!capture) fail();
      signer.verify(capture);
      return capture;
    } });
    // The checked completion prefix is a slice for operation order. Use the
    // already authenticated full reducer instance to resolve its control frames.
    const { alignmentSource } = createStandardSessionPrPostMergeFetch({ readAccepted,
      readPretriage: (_prefix, input, occurrenceId) => readPretriage(instance, input, occurrenceId) });
    const { plan, git } = postMergeCompletionSource({ instance: prefix,
      input: assertPostMergeCompleteInput(record.preview.input), readAccepted, readAlignmentSource: alignmentSource, artifacts,
      scopeSha: () => postMergeProjectScope(target, environment) });
    assertPostMergeCompleteOutput(output);
    if (plan.session_id !== sessionId || plan.opening_operation_id !== opening.operation_id || record.preview.prepared?.can_apply !== true
      || sourceBranch !== undefined && plan.source_ref !== 'refs/heads/' + sourceBranch
      || !exact(plan, record.preview.prepared.plan) || shadowHash(plan) !== record.preview.prepared.plan_sha256
      || output.observations.plan_sha256 !== record.preview.prepared.plan_sha256
      || output.evidence_refs[0].ref !== 'aidn:post-merge-completion/' + plan.opening_operation_id) fail();
    const completion = { plan, git, host: { home: host.home, identity: host.identity }, instanceId, targetRoot: target };
    completionPort(completion, environment).verifyCompletedSource(git, { expectPlan: git.plan_sha256, alignedHead: plan.aligned_head });
    return { managed: true, completion };
  } catch {
    return { managed: true, completion: null };
  }
}

// For source-branch pre-write, use the protected remote rather than a cached
// tracking ref. This is a read-only fence, separate from the historical receipt.
export async function verifyStandardPostMergePreWrite({ completion, environment = process.env }, { providerTransport } = {}) {
  const { plan, git } = completion, port = completionPort(completion, environment, providerTransport);
  const observed = await port.observeAlignment(git, { expectPlan: git.plan_sha256 });
  if (observed.source_ref !== plan.source_ref || observed.merge_oid !== plan.merge_oid || observed.local_head !== observed.remote_head
    || observed.ahead !== 0 || observed.behind !== 0) fail();
  port.verifyCompletedSource(git, { expectPlan: git.plan_sha256, alignedHead: plan.aligned_head, expectedHead: observed.local_head });
  return observed.local_head;
}
