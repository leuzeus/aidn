import { shadowHash } from '../../core/workflow/shadow-json.mjs';
import { validateJsonSchema } from '../../core/contracts/json-schema-validator.mjs';
import linkSchema from '../../core/contracts/workflow-definition/github-pr-link.v1.schema.json' with { type: 'json' };
import { assertStandardOperationOutput } from '../../core/workflow/standard-operation-contracts.mjs';
import { alignedReason, assertPostMergeAlignmentOutput, assertPostMergeMeasureOutput, postMergeAlignmentOperation, postMergeMeasureOperation } from '../../core/workflow/standard-pr-post-merge-fetch.mjs';
import { assertPostMergeCompleteOutput, assertPostMergeCompletePlan, postMergeCompleteOperation } from '../../core/workflow/standard-pr-post-merge-complete.mjs';
import { readSourceBranch, parseSessionMetadata } from '../../lib/workflow/session-context-lib.mjs';
import { readWorkflowProjectExecutionAuthority } from './workflow-instance-composition.mjs';

const fail = code => { throw Object.assign(Error(code), { code, effect_status: 'no_effect' }); };
const required = 'STANDARD_PR_POST_MERGE_COMPLETION_SOURCE_REQUIRED';
const exact = (left, right) => shadowHash(left) === shadowHash(right);

export function readPrOpeningLocator(content) {
  const headings = [...(content ?? '').matchAll(/^## Process PR opening[ \t]*\r?$/gm)];
  if (!headings.length) return null;
  if (headings.length !== 1) fail(required);
  const match = /^\r?\n\r?\n\x60{3}json\r?\n([\s\S]{1,4096}?)\r?\n\x60{3}[ \t]*(?:\r?\n|$)/.exec(content.slice(headings[0].index + headings[0][0].length));
  if (!match) fail(required);
  let locator;
  try { locator = JSON.parse(match[1]); } catch { fail(required); }
  if (!/^op_[a-f0-9]{40}$/.test(locator?.open_operation_id ?? '')) fail(required);
  return locator;
}

export function latestIntent(instance, binding) {
  return instance.events.findLast(event => event.kind === 'operation_intent' && event.intent.binding_ref === binding)?.intent;
}

export function postMergeProjectScope(targetRoot, env) {
  const { project, persistence } = readWorkflowProjectExecutionAuthority({ targetRoot, env });
  return shadowHash({ project: project.scope, state_mode: project.stateMode, persistence: persistence.binding_sha256 });
}

// The opening marker supplies a lookup key. The accepted opening supplies
// identity, including the original delivery (which can differ after correction).
export function postMergeSessionSource({ instance, readAccepted, artifacts }) {
  const openId = latestIntent(instance, 'session_pr_open')?.operation_id;
  if (!openId) fail(required);
  const opening = readAccepted(instance, openId, 'session_pr_open', required);
  const { session_id: sessionId, pull_request: link } = assertStandardOperationOutput(opening.output).observations;
  if (!/^S[0-9]{3,6}$/.test(sessionId ?? '') || validateJsonSchema(link, linkSchema, '$', { contractKind: 'workflow-definition' }).length
    || link.state !== 'OPEN' || link.draft || opening.output.facts.session_pr_open_confirmed !== true)
    fail(required);
  const session = artifacts.read('sessions/' + sessionId + '.md', { required: true });
  const metadata = parseSessionMetadata(session.content), marker = readPrOpeningLocator(session.content);
  const sourceBranch = readSourceBranch(artifacts.root);
  if (!marker || marker.open_operation_id !== openId || marker.repository_id !== link.repository_id || marker.pull_request_id !== link.node_id
    || marker.observation_sha256 !== shadowHash(link) || marker.observed_delivery_head !== link.head_oid
    || metadata.close_gate_satisfied !== true || !['open', 'merged'].includes(metadata.pr_status)
    || metadata.session_branch !== link.head_branch || metadata.pr_head_branch !== link.head_branch || metadata.pr_base_branch !== sourceBranch
    || link.base_branch !== sourceBranch || Number(metadata.pr_number) !== link.number || metadata.pr_url !== link.url)
    fail(required);

  return { openId, opening, sessionId, link, sourceBranch };
}

export function assertPostMergeSessionLink({ link, sourceBranch }, merge, measured) {
  const pull = merge.provider.pull_request;
  const repositoryUrl = 'https://github.com/' + merge.provider.repository.owner + '/' + merge.provider.repository.name + '/pull/' + pull.number;
  if (link.repository_id !== merge.provider.repository.node_id || link.node_id !== pull.node_id
    || link.number !== pull.number || link.url.toLowerCase() !== repositoryUrl.toLowerCase()
    || link.head_branch !== pull.head_ref || link.base_branch !== pull.base_ref || measured.source_ref !== 'refs/heads/' + sourceBranch)
    fail(required);
}

export function postMergeCompletionSource({ instance, input, readAccepted, readAlignmentSource, artifacts, scopeSha }) {
  const session = postMergeSessionSource({ instance, readAccepted, artifacts });
  const { openId, opening, sessionId, link } = session;
  const measurement = latestIntent(instance, postMergeMeasureOperation)?.operation_id === input.alignment_operation_id;
  const alignment = readAccepted(instance, input.alignment_operation_id, measurement ? postMergeMeasureOperation : postMergeAlignmentOperation, required);
  const checkOutput = measurement ? assertPostMergeMeasureOutput : assertPostMergeAlignmentOutput;
  const { observations: { reason_code, alignment: measured } } = checkOutput(alignment.output);
  if (reason_code !== alignedReason || !measured || alignment.record.preview.input.fetch_operation_id !== measured.fetch_operation_id
    || alignment.record.preview.prepared.fetch_receipt_sha256 !== measured.fetch_receipt_sha256) fail(required);
  const { git, fetch, receiptSha, merge } = readAlignmentSource(instance, alignment.record.preview.input);
  assertPostMergeSessionLink(session, merge, measured);
  if (measured.fetch_receipt_sha256 !== receiptSha || ['source_ref', 'merge_oid', 'fetched_head', 'proof_ref'].some(key => measured[key] !== fetch[key]))
    fail(required);

  const ids = [openId, fetch.merge_operation_id, measured.fetch_operation_id, input.alignment_operation_id];
  const positions = ids.map(id => instance.events.findIndex(event => event.kind === 'operation_intent' && event.intent.operation_id === id));
  if (positions.some((index, i) => index < 0 || i && index <= positions[i - 1])) fail(required);

  const plan = assertPostMergeCompletePlan({ contract_version: 'standard-pr-post-merge-complete-plan.v1',
    project_scope_sha256: scopeSha(), session_id: sessionId, opening_operation_id: openId,
    opening_receipt_sha256: shadowHash(opening.record.results.at(-1).receipt),
    merge_receipt_sha256: fetch.merge_receipt_sha256, fetch_receipt_sha256: receiptSha,
    alignment_operation_id: input.alignment_operation_id, alignment_receipt_sha256: shadowHash(alignment.record.results.at(-1).receipt),
    source_ref: measured.source_ref, merge_oid: measured.merge_oid, aligned_head: measured.remote_head });
  return { plan, git, measured, alignment, link };
}

export function createStandardPostMergeCompletion({ readCurrent, reviewPort, now, ...authority }) {
  const port = reviewPort?.postMergeFetch;
  const source = (instance, input) => postMergeCompletionSource({ instance, input, ...authority });
  function checked(instance, input, prepared) {
    const observed = source(instance, input);
    if (prepared?.can_apply !== true || prepared.plan_sha256 !== shadowHash(observed.plan) || !exact(prepared.plan, observed.plan))
      fail('STANDARD_PR_POST_MERGE_COMPLETION_PLAN_CHANGED');
    return observed;
  }
  async function confirm(instance, input, prepared, { signal, assertAuthorized }) {
    const { git, measured } = checked(instance, input, prepared);
    if (typeof port?.observeAlignment !== 'function') fail('STANDARD_PR_POST_MERGE_COMPLETION_HOST_REQUIRED');
    await assertAuthorized?.();
    const current = await port.observeAlignment(git, { expectPlan: git.plan_sha256, signal });
    const { fetch_operation_id, fetch_receipt_sha256, ...expected } = measured;
    if (!exact(current, expected)) fail('STANDARD_PR_POST_MERGE_COMPLETION_ALIGNMENT_CHANGED');
    await assertAuthorized?.();
    if (signal?.aborted || readCurrent(instance.instance_id).instance_sha256 !== instance.instance_sha256)
      fail('STANDARD_PR_POST_MERGE_COMPLETION_CONTEXT_CHANGED');
    checked(instance, input, prepared);
  }
  async function apply(instance, input, prepared, options) {
    await confirm(instance, input, prepared, options);
    return assertPostMergeCompleteOutput({ contract_version: 'standard-pr-post-merge-complete-output.v1',
      operation_ref: postMergeCompleteOperation, outcome: 'completed', effect_status: 'no_effect', facts: {},
      observations: { plan_sha256: prepared.plan_sha256, verified_at_ms: now() },
      evidence_refs: [{ ref: 'aidn:post-merge-completion/' + prepared.plan.opening_operation_id, sha256: prepared.plan_sha256 }] });
  }
  return Object.freeze({
    prepare(instance, input) {
      const { plan } = source(instance, input);
      return { can_apply: true, plan, plan_sha256: shadowHash(plan) };
    },
    confirm,
    apply,
    async recover(instance, input, prepared, options) {
      try { return await apply(instance, input, prepared, options); }
      catch (cause) { return { reason_code: cause.code }; }
    },
  });
}
