import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createFreshStandardWorkflowFixture } from './standard-workflow-fixture-lib.mjs';
import { createStandardWorkflowOperations } from '../../src/application/runtime/standard-workflow-operations.mjs';
import { createStandardWorkflowArtifacts } from '../../src/application/runtime/standard-workflow-artifacts.mjs';
import { createStandardSessionPrRecord } from '../../src/application/runtime/standard-session-pr-record.mjs';
import { sessionPrRecordPaths } from '../../src/core/workflow/standard-session-pr-record.mjs';
import { validateJsonSchemaDefinition } from '../../src/core/contracts/json-schema-validator.mjs';
import { assertStandardOperationOutput } from '../../src/core/workflow/standard-operation-contracts.mjs';
import { shadowHash } from '../../src/core/workflow/shadow-json.mjs';
const temporary = fs.realpathSync(os.tmpdir()), owned = [], H = 'a'.repeat(64), operation = 'op_' + '1'.repeat(40);
const mode = process.argv.find(x => x.startsWith('--mode='))?.slice(7) ?? 'files';
const git = (root, ...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', windowsHide: true, stdio: 'pipe' }).trim();
let checks = 0;
const test = async (name, fn) => { await fn(); checks++; console.log('PASS ' + name); };
async function fixture(selectedMode) {
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
  const port = createStandardSessionPrRecord({ targetRoot: root, readSource: async () => structuredClone(source), readCurrent: () => instance });
  return { root, artifacts, source, instance, input, port, head, names };
}
try {
  await test('private record contracts require new postimage proof and keep checkpoint/review separate', () => {
    for (const kind of ['input', 'plan', 'output']) {
      const schema = JSON.parse(fs.readFileSync(new URL('../../src/core/contracts/workflow-definition/standard-session-pr-record-' + kind + '.v1.schema.json', import.meta.url)));
      assert.deepEqual(validateJsonSchemaDefinition(schema, '#', { contractKind: 'workflow-definition' }), []);
    }
    const value = { contract_version: 'standard-session-pr-record-output.v1', operation_ref: 'session_pr_record', outcome: 'completed', effect_status: 'confirmed',
      facts: { session_pr_lifecycle_recorded: true, session_pr_checkpoint_required: true }, observations: {}, evidence_refs: [1, 2, 3].map(n => ({ ref: 'docs/audit/' + n, sha256: H })) };
    assertStandardOperationOutput(value); const bad = structuredClone(value); bad.facts.session_pr_merged = true; assert.throws(() => assertStandardOperationOutput(bad));
  });
  const f = await fixture(mode), physical = () => f.names.map(name => { const file = path.join(f.root, 'docs/audit', name); return fs.existsSync(file) ? fs.readFileSync(file).toString('base64') : null; });
  let prepared;
  await test('preparation binds original canonical bytes/metadata and exact Git identity without mutation', async () => {
    const before = shadowHash(f.source), files = physical(); prepared = await f.port.prepare(f.instance, f.input);
    assert.equal(prepared.can_apply, true); assert.equal(shadowHash(f.source), before); assert.deepEqual(physical(), files); assert.equal(f.artifacts.ownerPending(), false);
  });
  await test('wrong exact grant or a changed delivery preimage refuses before canonical writes', async () => {
    await assert.rejects(f.port.apply(f.instance, prepared, { write: true, expectPlan: 'b'.repeat(64), assertAuthorized() {} }));
    const original = f.source.documents[0].sha256; f.source.documents[0].sha256 = 'c'.repeat(64);
    await assert.rejects(f.port.apply(f.instance, prepared, { write: true, expectPlan: prepared.plan_sha256, assertAuthorized() {} })); f.source.documents[0].sha256 = original;
    assert.equal(f.artifacts.read(f.names[0], { required: true }).sha256, original); assert.equal(f.artifacts.ownerPending(), false);
  });
  await test('actual canonical CAS/project writes PR lifecycle with CLOSED retained and no Git checkpoint or push', async () => {
    const files = physical(), sourceHash = shadowHash(f.source); prepared = await f.port.prepare(f.instance, f.input);
    const result = await f.port.apply(f.instance, prepared, { write: true, expectPlan: prepared.plan_sha256, assertAuthorized() {} });
    assert.equal(result.outcome, 'completed', JSON.stringify(result)); assertStandardOperationOutput(result);
    assert.deepEqual(result.facts, { session_pr_lifecycle_recorded: true, session_pr_checkpoint_required: true });
    const session = f.artifacts.read(f.names[0], { required: true }).content, current = f.artifacts.read('CURRENT-STATE.md', { required: true }).content;
    assert.match(session, /^state: CLOSED$/m); assert.match(session, /pr_status: open/); assert.match(session, /pr_review_status: pending/);
    assert.match(current, /^active_session: S001$/m); assert.match(current, /session_pr_status: open/); assert.match(current, /session_pr_review_status: pending/);
    assert.equal(shadowHash(f.source), sourceHash); assert.equal(git(f.root, 'rev-parse', 'HEAD'), f.head); assert.equal(f.artifacts.ownerPending(), false);
    for (const row of result.observations.postimages) { assert.equal(f.artifacts.read(row.path, { required: true }).sha256, row.sha256); assert.equal(f.artifacts.metadataHash(row.path), row.metadata_sha256); }
    if (mode === 'db-only') { assert.deepEqual(physical(), files); assert.equal(git(f.root, 'status', '--porcelain'), ''); }
    else { assert.notEqual(git(f.root, 'status', '--porcelain'), ''); }
    await assert.rejects(f.port.prepare(f.instance, f.input));
  });
  if (mode === 'files') await test('lost authority after the first real canonical write retains partial state as unknown', async () => {
    const partial = await fixture('files'), plan = await partial.port.prepare(partial.instance, partial.input); let grants = 0;
    const result = await partial.port.apply(partial.instance, plan, { write: true, expectPlan: plan.plan_sha256, assertAuthorized() { if (++grants >= 3) throw Error('grant lost'); } });
    assert.equal(result.outcome, 'reconciliation_required'); assert.equal(result.effect_status, 'unknown'); assert.deepEqual(result.facts, {}); assertStandardOperationOutput(result);
    assert.equal(partial.artifacts.ownerPending(), true); assert.notEqual(partial.artifacts.read(partial.names[0], { required: true }).sha256, partial.source.documents[0].sha256);
    assert.equal(partial.artifacts.read(partial.names[1], { required: true }).sha256, partial.source.documents[1].sha256);
    assert.equal((await partial.port.prepare(partial.instance, partial.input)).can_apply, false);
  });
  console.log(JSON.stringify({ status: 'PASS', checks, state_mode: mode, canonical_cas_projection_git: 'ACTUAL', accepted_closure_pr_sources: 'INJECTED_FIXTURE',
    full_standard_composition: 'NOT_RUN', checkpoint_push_review: 'NOT_RUN', real_github: 'NOT_RUN', native: 'NOT_RUN', installed_archive: 'NOT_RUN' }));
} finally { for (const root of owned.reverse()) { const real = fs.realpathSync(root); assert.equal(path.dirname(real), temporary); assert.ok(path.basename(root).startsWith('aidn-standard-fresh-')); fs.rmSync(real, { recursive: true, force: true }); } console.log(JSON.stringify({ cleanup_completed: true })); }
