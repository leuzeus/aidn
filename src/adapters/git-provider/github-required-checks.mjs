import policySchema from '../../core/contracts/workflow-definition/standard-github-required-checks.v1.schema.json' with { type: 'json' };
import { validateJsonSchema } from '../../core/contracts/json-schema-validator.mjs';
import { checkShadowJson, shadowHash } from '../../core/workflow/shadow-json.mjs';

const fail = code => { throw Object.assign(Error(code), { code, effect_status: 'no_effect' }); };
const oid = /^[a-f0-9]{40}$/;
const nodeId = /^[A-Za-z0-9_=-]{1,256}$/;
const validId = value => typeof value === 'string' && nodeId.test(value);

export function assertGithubRequiredChecksPolicy(policy) {
  if (checkShadowJson(policy) || validateJsonSchema(policy, policySchema, '$', { contractKind: 'workflow-definition' }).length
    || new Set(policy.entries.map(entry => entry.name)).size !== policy.entries.length)
    fail('STANDARD_GITHUB_CHECK_POLICY_INVALID');
  return policy;
}

export async function observeGithubRequiredChecks({ get, repository, policy, request }) {
  if (policy.base_ref !== request.expected_base_ref) fail('STANDARD_PR_CHECK_POLICY_BASE_REQUIRED');
  const head = request.expected_head_oid, number = request.pull_request_number;
  if (!oid.test(head) || !Number.isSafeInteger(number) || number < 1) fail('STANDARD_PR_CHECK_SUBJECT_CHANGED');
  const endpoint = 'repos/' + repository.owner + '/' + repository.name;
  const runs = await get(endpoint + '/commits/' + head + '/check-runs?filter=all&per_page=100');
  const statuses = await get(endpoint + '/commits/' + head + '/status?per_page=100');
  // Refuse truncation and conflicts even if a first page contains a success.
  if (!Array.isArray(runs?.check_runs) || runs.total_count !== runs.check_runs.length || runs.check_runs.length >= 100
    || statuses?.sha !== head || !Array.isArray(statuses.statuses)
    || statuses.total_count !== statuses.statuses.length || statuses.statuses.length >= 100
    || runs.check_runs.some(row => row?.head_sha !== head || typeof row.name !== 'string')
    || statuses.statuses.some(row => typeof row?.context !== 'string')) fail('STANDARD_PR_CHECK_INVENTORY_INVALID');
  const pr = await get(endpoint + '/pulls/' + number);
  if (pr?.node_id !== request.expected_pull_request_id || pr.number !== number || pr.state !== 'open'
    || pr.draft !== false || pr.merged !== false || pr.head?.repo?.node_id !== repository.node_id
    || pr.base?.repo?.node_id !== repository.node_id || pr.head.sha !== head || pr.base.sha !== request.expected_base_oid
    || pr.head.ref !== request.expected_head_ref || pr.base.ref !== request.expected_base_ref)
    fail('STANDARD_PR_CHECK_SUBJECT_CHANGED');

  const accepted = [];
  for (const requirement of policy.entries) {
    const checkRuns = runs.check_runs.filter(row => row.name === requirement.name);
    const contexts = statuses.statuses.filter(row => row.context === requirement.name);
    if (checkRuns.length + contexts.length > 1) fail('STANDARD_PR_CHECK_AMBIGUOUS');
    const run = requirement.kind === 'check_run', row = run ? checkRuns[0] : contexts[0];
    if (!row) fail('STANDARD_PR_CHECK_MISSING');
    const producer = run ? row.app?.node_id : row.creator?.node_id;
    if (producer !== requirement.producer_id || !validId(row.node_id)) fail('STANDARD_PR_CHECK_PRODUCER_CHANGED');
    if (run ? row.status !== 'completed' : row.state === 'pending') fail('STANDARD_PR_CHECK_PENDING');
    if ((run ? row.conclusion : row.state) !== 'success') fail('STANDARD_PR_CHECK_FAILED');
    if (checkShadowJson(row)) fail('STANDARD_PR_CHECK_INVENTORY_INVALID');
    accepted.push({ ...requirement, result_id: row.node_id, result_sha256: shadowHash(row) });
  }
  return accepted.sort((a, b) => a.name < b.name ? -1 : 1);
}
