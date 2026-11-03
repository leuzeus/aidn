import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createFreshStandardWorkflowFixture } from './standard-workflow-fixture-lib.mjs';
import { createStandardWorkflowOperations } from '../../src/application/runtime/standard-workflow-operations.mjs';
import { createStandardWorkflowArtifacts } from '../../src/application/runtime/standard-workflow-artifacts.mjs';
import { createStandardSessionPrRecord } from '../../src/application/runtime/standard-session-pr-record.mjs';
import { sessionPrRecordPaths } from '../../src/core/workflow/standard-session-pr-record.mjs';
import { createGithubPrOpenTransportFixture } from './github-pr-open-fixture-lib.mjs';
import { createStandardSessionPrSuccessorAuthority } from '../../src/application/runtime/standard-session-pr-successor-authority.mjs';
import { createStandardSessionPrCheckpoint } from '../../src/application/runtime/standard-session-pr-checkpoint.mjs';
import { createStandardSessionPrUpdatePush } from '../../src/application/runtime/standard-session-pr-update-push.mjs';
import { createLocalWorkflowSessionPush } from '../../src/adapters/runtime/local-workflow-session-push.mjs';
const H = 'a'.repeat(64), operation = 'op_' + '1'.repeat(40);
const git = (root, ...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', windowsHide: true, stdio: 'pipe' }).trim();
export async function createPrSuccessorFixture(selectedMode, owned, temporary) {
  const root = createFreshStandardWorkflowFixture(selectedMode, owned), ops = createStandardWorkflowOperations({ targetRoot: root }), artifacts = createStandardWorkflowArtifacts({ targetRoot: root });
  let prepared = await ops.prepareSession({ session_id: 'S001', session_branch: 'S001-record', objective: 'Record the explicit fixture PR lifecycle' });
  assert.equal((await ops.initializeSession(prepared, { write: true, expectPlan: prepared.plan_sha256 })).outcome, 'completed');
  prepared = await ops.prepareMode({ session_id: 'S001', mode: 'COMMITTING' });
  assert.equal((await ops.applyMode(prepared, { write: true, expectPlan: prepared.plan_sha256 })).outcome, 'completed');
  // Canonical closure and accepted PR evidence are injected fixture sources;
  // this arrangement does not claim an authenticated R07 or a real GitHub PR.
  await artifacts.withLocalEffectOwner(H, async () => {
    const row = artifacts.read('sessions/S001.md', { required: true });
    const after = row.content.replace(/^state: OPEN$/m, 'state: CLOSED') + '\nsession_closure_status: completed\n';
    artifacts.compareAndSwapPreservingMetadata({ path: row.path, before_sha256: row.sha256, before_metadata_sha256: artifacts.metadataHash(row.path), after });
    artifacts.project([row.path]); return { effect_status: 'confirmed' };
  });
  git(root, 'add', '.'); if (git(root, 'status', '--porcelain')) git(root, '-c', 'core.hooksPath=NUL', 'commit', '-m', 'test: arrange closed canonical fixture');
  const head = git(root, 'rev-parse', 'HEAD'), names = sessionPrRecordPaths('sessions/S001.md');
  const source = { open_operation_id: operation, session_id: 'S001', session_path: names[0], material_sha256: H,
    pull_request: { contract_version: 'github-pr-link.v1', repository_id: 'R_fixture', node_id: 'PR_fixture', number: 1, head_branch: 'S001-record', base_branch: 'dev',
      head_oid: head, base_oid: git(root, 'rev-parse', 'HEAD^'), state: 'OPEN', draft: false, url: 'https://github.com/fixture/repository/pull/1', title_sha256: H, body_sha256: H },
    documents: names.map(name => ({ path: name, sha256: artifacts.read(name, { required: true }).sha256, metadata_sha256: artifacts.metadataHash(name) })) };
  const instance = { instance_id: 'pr-record-fixture', instance_sha256: H }, input = { contract_version: 'standard-session-pr-record-input.v1', open_operation_id: operation };
  const base = fs.mkdtempSync(path.join(temporary, 'aidn-standard-pr-successor-')); owned.push(base);
  const remote = path.join(base, 'remote.git'); fs.mkdirSync(remote); git(remote, 'init', '--bare');
  git(root, '-c', 'core.hooksPath=NUL', 'push', '--', remote, 'HEAD^:refs/heads/dev', 'HEAD:refs/heads/S001-record');
  const provider = createGithubPrOpenTransportFixture({ remoteRoot: remote, controlRoot: base });
  const request = { contract_version: 'github-pr-open-request.v1', head_branch: 'S001-record', base_branch: 'dev', head_oid: head, title: 'Session S001', body: 'Fixture delivery' };
  const openPlan = await provider.port.prepare(request, operation);
  const openResult = await provider.port.apply(openPlan, { write: true, expectPlan: openPlan.plan_sha256, assertAuthorized() {} });
  source.pull_request = openResult.pull_request;
  const port = createStandardSessionPrRecord({ targetRoot: root, readSource: async () => structuredClone(source), readCurrent: () => instance });
  prepared = await port.prepare(instance, input); const output = await port.apply(instance, prepared, { write: true, expectPlan: prepared.plan_sha256, assertAuthorized() {} });
  assert.equal(output.outcome, 'completed', JSON.stringify(output));
  const recordId = 'op_' + '2'.repeat(40), checkpointId = 'op_' + '3'.repeat(40);
  const recorded = { record: { operation_id: recordId, intent: { binding_ref: 'session_pr_record' }, preview: { input, prepared } }, output };
  const records = new Map([[recordId, recorded]]);
  const history = { open: { record: { operation_id: operation, preview: { prepared: { plan: { provider: { plan: { request } } } } } } },
    review: { session_id: 'S001', session_path: names[0] }, documents: structuredClone(source.documents), link: structuredClone(source.pull_request), sources: [], events: [] };
  const authority = createStandardSessionPrSuccessorAuthority({ targetRoot: root, readAcceptedOperation(_instance, id, binding) {
    const selected = records.get(id); if (selected?.record.intent.binding_ref !== binding) throw Error('accepted source unavailable'); return structuredClone(selected);
  }, historyAuthority: { readHistory() { return structuredClone(history); } } });
  const checkpoint = createStandardSessionPrCheckpoint({ targetRoot: root, readSource: authority.readSource, readCurrent: () => instance });
  const pushPort = createLocalWorkflowSessionPush({ targetRoot: root, remoteRoot: remote });
  const update = extra => createStandardSessionPrUpdatePush({ targetRoot: root, readCheckpoint: authority.readCheckpoint, readCurrent: () => instance, pushPort, pullRequestPort: provider.port, ...extra });
  return { root, artifacts, source, instance, input, port, head, names, records, recorded, history, authority, checkpoint, recordId, checkpointId, provider, remote, pushPort, update,
    checkpointInput: { record_operation_id: recordId }, updateInput: { contract_version: 'standard-session-pr-update-push-input.v1', checkpoint_operation_id: checkpointId } };
}
