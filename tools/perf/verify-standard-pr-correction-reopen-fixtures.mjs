import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createFreshStandardWorkflowFixture } from './standard-workflow-fixture-lib.mjs';
import { createStandardWorkflowOperations } from '../../src/application/runtime/standard-workflow-operations.mjs';
import { createStandardWorkflowArtifacts } from '../../src/application/runtime/standard-workflow-artifacts.mjs';
import { createStandardPrCorrectionReopen } from '../../src/application/runtime/standard-pr-correction-reopen.mjs';
import { renderPrCorrectionReopen, prCorrectionReopenPaths } from '../../src/core/workflow/standard-pr-correction-reopen.mjs';
import { validateJsonSchemaDefinition } from '../../src/core/contracts/json-schema-validator.mjs';
import { preWriteAdmit } from '../runtime/pre-write-admit.mjs';
import { shadowHash } from '../../src/core/workflow/shadow-json.mjs';
import { artifactContentHash } from '../../src/core/workflow/artifact-compare-swap.mjs';
import { assertStandardOperationInput, assertStandardOperationOutput, assertStandardPrCorrectionPlan } from '../../src/core/workflow/standard-operation-contracts.mjs';
import { agenticProcessImplementationPins } from '../../src/application/runtime/agentic-process-implementation-pins.mjs';
const H = 'a'.repeat(64), op = 'op_' + '1'.repeat(40), owned = [], temporary = fs.realpathSync(os.tmpdir());
const mode = process.argv.find(x => x.startsWith('--mode='))?.slice(7) ?? 'files';
const git = (root, ...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', windowsHide: true, stdio: 'pipe' }).trim();
const set = (text, key, value) => {
  const re = new RegExp('^([ \\t]*-?[ \\t]*)' + key + ':[^\\r\\n]*$', 'gm');
  return re.test(text) ? text.replace(re, (_all, prefix) => prefix + key + ': ' + value) : text.replace(/^(# [^\n]*\n)/, '$1\n' + key + ': ' + value + '\n');
};
let checks = 0;
const test = async (name, fn) => { await fn(); checks++; console.log('PASS ' + name); };
async function fixture(selectedMode) {
  const root = createFreshStandardWorkflowFixture(selectedMode, owned), artifacts = createStandardWorkflowArtifacts({ targetRoot: root });
  const ops = createStandardWorkflowOperations({ targetRoot: root });
  let prepared = await ops.prepareSession({ session_id: 'S001', session_branch: 'S001-correction', objective: 'Scoped review correction fixture' });
  assert.equal((await ops.initializeSession(prepared, { write: true, expectPlan: prepared.plan_sha256 })).outcome, 'completed');
  prepared = await ops.prepareMode({ session_id: 'S001', mode: 'COMMITTING' });
  assert.equal((await ops.applyMode(prepared, { write: true, expectPlan: prepared.plan_sha256 })).outcome, 'completed');
  const names = prCorrectionReopenPaths('S001');
  await artifacts.withLocalEffectOwner(H, async () => {
    for (const name of names) {
      const row = artifacts.read(name, { required: true }); let after = row.content;
      if (name === names[0]) {
        for (const [key, value] of Object.entries({ state: 'CLOSED', lifecycle_status: 'closed', session_closure_status: 'completed', pr_status: 'open', pr_review_status: 'pending' })) after = set(after, key, value);
        after += '\n## Process session closure\n\n```json\n{"prior":"closure report retained verbatim"}\n```\n\n## Process session closure completion\n\n```json\n{"prior":"completion retained verbatim"}\n```\n';
      } else if (name === names[1]) {
        for (const [key, value] of Object.entries({ session_closure_status: 'completed', session_pr_status: 'open', session_pr_review_status: 'pending' })) after = set(after, key, value);
      } else after = set(after, 'updated_at', new Date().toISOString());
      artifacts.compareAndSwapPreservingMetadata({ path: name, before_sha256: row.sha256, before_metadata_sha256: artifacts.metadataHash(name), after });
    }
    artifacts.project(names); return { effect_status: 'confirmed' };
  });
  git(root, 'add', '.'); if (git(root, 'status', '--porcelain')) git(root, '-c', 'core.hooksPath=NUL', 'commit', '-m', 'test: arrange closed correction owner');
  const head = git(root, 'rev-parse', 'HEAD'), instance = { instance_id: 'correction-component', instance_sha256: H };
  const source = { triage_operation_id: op, triage_output_sha256: H, session_id: 'S001', selection_operation_id: op, received_operation_id: op, update_operation_id: op,
    payload_sha256: H, product_sha256: H, source_material_sha256: H,
    pull_request: { contract_version: 'github-pr-link.v1', repository_id: 'R_fixture', node_id: 'PR_fixture', number: 1, head_branch: 'S001-correction', base_branch: 'dev',
      head_oid: head, base_oid: git(root, 'rev-parse', 'HEAD^'), state: 'OPEN', draft: false, url: 'https://github.com/fixture/repository/pull/1', title_sha256: H, body_sha256: H },
    corrections: [{ kind: 'review', node_id: 'REVIEW_fixture', thread_id: null, correction: 'Correct the selected product boundary and validate the new HEAD.' }] };
  const input = { contract_version: 'standard-pr-correction-reopen-input.v1', triage_operation_id: op }, state = { externalChanged: false };
  const authority = { readSource: async () => structuredClone(source), verifySource: async () => {
    if (state.externalChanged) throw Object.assign(Error('provider changed'), { code: 'STANDARD_PR_CORRECTION_PROVIDER_CHANGED' });
    return { origin_source_sha256: shadowHash(source), proof_class: 'fixture-source-double' };
  } };
  const port = createStandardPrCorrectionReopen({ targetRoot: root, authority, readCurrent: () => instance });
  return { root, artifacts, source, instance, input, port, head, names, state };
}
try {
  await test('three private schemas validate with supported keywords', () => {
    for (const kind of ['input', 'plan', 'output']) assert.deepEqual(validateJsonSchemaDefinition(JSON.parse(fs.readFileSync(new URL('../../src/core/contracts/workflow-definition/standard-pr-correction-reopen-' + kind + '.v1.schema.json', import.meta.url))), '#', { contractKind: 'workflow-definition' }), []);
  });
  await test('registered input and direct byte pins include every correction authority, writer, renderer and contract', () => {
    const paths = ['src/application/runtime/standard-pr-correction-authority.mjs', 'src/application/runtime/standard-pr-correction-reopen.mjs',
      'src/core/workflow/standard-pr-correction-reopen.mjs', ...['input', 'plan', 'output'].map(kind => 'src/core/contracts/workflow-definition/standard-pr-correction-reopen-' + kind + '.v1.schema.json')];
    const pins = agenticProcessImplementationPins(), read = fs.readFileSync;
    for (const name of paths) {
      assert.equal(pins.files.filter(row => row.path === name).length, 1, name);
      try {
        fs.readFileSync = (file, ...args) => String(file).endsWith('/' + name) ? Buffer.concat([read(file, ...args), Buffer.from('\n')]) : read(file, ...args);
        assert.notEqual(agenticProcessImplementationPins().sha256, pins.sha256, name);
      } finally { fs.readFileSync = read; }
    }
    assert.deepEqual(agenticProcessImplementationPins(), pins);
    assertStandardOperationInput('session_pr_correction_reopen', { contract_version: 'standard-pr-correction-reopen-input.v1', triage_operation_id: op });
    assert.throws(() => assertStandardOperationInput('session_pr_correction_reopen', { contract_version: 'standard-pr-correction-reopen-input.v1', triage_operation_id: op, payload: {} }));
  });
  const f = await fixture(mode), rows = () => f.names.map(name => f.artifacts.read(name, { required: true }));
  const original = rows(), bytes = original.map(row => row.sha256), product = fs.readFileSync(path.join(f.root, 'docs/audit/CURRENT-STATE.md'));
  let prepared;
  await test('read-only preparation binds exact canonical preimages, source and Git without writes', async () => {
    prepared = await f.port.prepare(f.instance, f.input); assert.equal(prepared.can_apply, true);
    assertStandardPrCorrectionPlan(prepared.plan);
    assert.throws(() => assertStandardPrCorrectionPlan({ ...prepared.plan, source_sha256: H }));
    assert.deepEqual(rows().map(row => row.sha256), bytes); assert.equal(f.artifacts.ownerPending(), false);
    await assert.rejects(f.port.apply(f.instance, prepared, { write: true, expectPlan: H, assertAuthorized() {} }));
    const forged = structuredClone(prepared); forged.plan.changes[0].text_chunks.push('\nUnreviewed data\n');
    forged.plan.changes[0].after_sha256 = artifactContentHash(forged.plan.changes[0].text_chunks.join(''));
    forged.plan_sha256 = shadowHash(forged.plan);
    await assert.rejects(f.port.apply(f.instance, forged, { write: true, expectPlan: forged.plan_sha256, assertAuthorized() {} }), { code: 'STANDARD_PR_CORRECTION_PREVIEW_CHANGED' });
    assert.deepEqual(rows().map(row => row.sha256), bytes);
  });
  await test('lost external freshness refuses before any canonical transition', async () => {
    f.state.externalChanged = true;
    const result = await f.port.apply(f.instance, prepared, { write: true, expectPlan: prepared.plan_sha256, assertAuthorized() {} });
    assert.equal(result.outcome, 'blocked'); assert.deepEqual(result.facts, {}); assert.equal(f.artifacts.ownerPending(), false);
    assert.deepEqual(rows().map(row => row.sha256), bytes); f.state.externalChanged = false;
  });
  await test('canonical reopening preserves closure bodies, leaves no cycle and grants no product admission', async () => {
    const result = await f.port.apply(f.instance, prepared, { write: true, expectPlan: prepared.plan_sha256, assertAuthorized() {} });
    assert.equal(result.outcome, 'completed', JSON.stringify(result)); assert.equal(result.effect_status, 'confirmed');
    assertStandardOperationOutput(result);
    assert.throws(() => assertStandardOperationOutput({ ...result, effect_status: 'no_effect' }));
    assert.deepEqual(result.facts, { session_pr_correction_context_open: true, session_pr_correction_cycle_required: true });
    const session = rows()[0].content;
    assert.match(session, /^state: OPEN$/m); assert.match(session, /^session_closure_status: correction_pending$/m);
    assert.match(session, /"prior":"closure report retained verbatim"/); assert.match(session, /"prior":"completion retained verbatim"/);
    assert.ok(!/^## Process session closure\s*$/m.test(session)); assert.match(rows()[1].content, /^active_cycle: none$/m);
    assert.equal(git(f.root, 'rev-parse', 'HEAD'), f.head); assert.equal(f.artifacts.ownerPending(), false);
    for (const row of result.observations.postimages) { assert.equal(f.artifacts.read(row.path).sha256, row.sha256); assert.equal(f.artifacts.metadataHash(row.path), row.metadata_sha256); }
    const native = await preWriteAdmit({ targetRoot: f.root, skill: 'start-session', nativeRequest: { tool_name: 'apply_patch', cwd: f.root,
      tool_input: { command: '*** Begin Patch\n*** Add File: app.mjs\n+export const value = 2;\n*** End Patch' } } });
    assert.equal(native.write_decision.outcome, 'deny');
    assert.ok(native.write_decision.reasons.some(row => ['ACTIVE_CYCLE_REQUIRED', 'PHASE_EXCLUDES_IMPLEMENTATION'].includes(row.code)));
    assert.equal(fs.existsSync(path.join(f.root, 'app.mjs')), false);
    if (mode === 'db-only') assert.deepEqual(fs.readFileSync(path.join(f.root, 'docs/audit/CURRENT-STATE.md')), product);
    await assert.rejects(f.port.prepare(f.instance, f.input));
  });
  await test('renderer refuses no correction, an already active owner and a broken closure history', () => {
    assert.throws(() => renderPrCorrectionReopen({ source: { ...f.source, corrections: [] }, documents: original, preparedAt: Date.now() }));
    assert.throws(() => renderPrCorrectionReopen({ source: f.source, documents: rows(), preparedAt: Date.now() }));
    const broken = structuredClone(original); broken[0].content = broken[0].content.replace('## Process session closure completion', '## Missing completion');
    broken[0].sha256 = artifactContentHash(broken[0].content);
    assert.throws(() => renderPrCorrectionReopen({ source: f.source, documents: broken, preparedAt: Date.now() }), { code: 'STANDARD_PR_CORRECTION_CLOSURE_HISTORY_REQUIRED' });
  });
  if (mode === 'files') await test('authority lost after the first CAS retains unknown state and owner without retry', async () => {
    const partial = await fixture('files'), p = await partial.port.prepare(partial.instance, partial.input); let grants = 0;
    const result = await partial.port.apply(partial.instance, p, { write: true, expectPlan: p.plan_sha256, assertAuthorized() { if (++grants >= 3) throw Error('grant lost'); } });
    assert.equal(result.outcome, 'reconciliation_required'); assert.equal(result.effect_status, 'unknown'); assert.deepEqual(result.facts, {});
    assert.equal(partial.artifacts.ownerPending(), true); assert.equal((await partial.port.prepare(partial.instance, partial.input)).can_apply, false);
  });
  console.log(JSON.stringify({ status: 'PASS', checks, mode, canonical_cas_projection_git_admission: 'ACTUAL', accepted_triage_and_external_source: 'DOUBLED',
    source_factory: 'SEPARATE_SUITE', host_ir_binding: 'NOT_EXERCISED_BY_THIS_SUITE', native_corrections: 'NOT_RUN', full_standard: false, installed_archive: 'NOT_RUN' }));
} finally {
  for (const root of owned.reverse()) { const real = fs.realpathSync(root); assert.equal(path.dirname(real), temporary); assert.ok(path.basename(real).startsWith('aidn-standard-fresh-')); fs.rmSync(real, { recursive: true, force: true }); }
  console.log(JSON.stringify({ fixture_cleanup: 'completed', independent_process_inventory: 'NOT_CAPTURED' }));
}
