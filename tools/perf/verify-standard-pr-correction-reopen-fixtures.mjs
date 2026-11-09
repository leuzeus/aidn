import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createFreshStandardWorkflowFixture } from './standard-workflow-fixture-lib.mjs';
import { createStandardWorkflowOperations } from '../../src/application/runtime/standard-workflow-operations.mjs';
import { createStandardWorkflowArtifacts } from '../../src/application/runtime/standard-workflow-artifacts.mjs';
import { createStandardPrCorrectionReopen } from '../../src/application/runtime/standard-pr-correction-reopen.mjs';
import { createLocalWorkflowGitCheckpoint } from '../../src/adapters/runtime/local-workflow-git-checkpoint.mjs';
import { renderPrCorrectionReopen, prCorrectionReopenPaths } from '../../src/core/workflow/standard-pr-correction-reopen.mjs';
import { validateJsonSchemaDefinition } from '../../src/core/contracts/json-schema-validator.mjs';
import { preWriteAdmit } from '../runtime/pre-write-admit.mjs';
import { shadowHash } from '../../src/core/workflow/shadow-json.mjs';
import { artifactContentHash } from '../../src/core/workflow/artifact-compare-swap.mjs';
import { assertStandardOperationInput, assertStandardOperationOutput, assertStandardPrCorrectionPlan } from '../../src/core/workflow/standard-operation-contracts.mjs';
import { agenticProcessImplementationPins } from '../../src/application/runtime/agentic-process-implementation-pins.mjs';
import { createPrCorrectionReopenFixture } from './standard-pr-correction-fixture-lib.mjs';
import { createStandardOperationDisposition } from '../../src/application/runtime/standard-operation-disposition.mjs';
import { createOperationJournalSigner } from '../../src/core/workflow/process-operation-journal.mjs';
const fixture = selectedMode => createPrCorrectionReopenFixture(selectedMode, owned);
const H = 'a'.repeat(64), op = 'op_' + '1'.repeat(40), owned = [], temporary = fs.realpathSync(os.tmpdir());
const mode = process.argv.find(x => x.startsWith('--mode='))?.slice(7) ?? 'files';
const git = (root, ...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', windowsHide: true, stdio: 'pipe' }).trim();
const set = (text, key, value) => {
  const re = new RegExp('^([ \\t]*-?[ \\t]*)' + key + ':[^\\r\\n]*$', 'gm');
  return re.test(text) ? text.replace(re, (_all, prefix) => prefix + key + ': ' + value) : text.replace(/^(# [^\n]*\n)/, '$1\n' + key + ': ' + value + '\n');
};
let checks = 0;
const test = async (name, fn) => { await fn(); checks++; console.log('PASS ' + name); };

const fixtureSigner = createOperationJournalSigner(() => Buffer.alloc(32, 68));
function reopenDisposition(root, artifacts, readOperation) {
  return createStandardOperationDisposition({ targetRoot: root, stateMode: 'files', signer: fixtureSigner, artifacts,
    readAuthority: () => ({ fixture: 'reopen-observer' }), readOperation,
    readContext: () => ({ head: git(root, 'rev-parse', 'HEAD'), documents: prCorrectionReopenPaths('S001').map(name => artifacts.read(name).sha256) }),
  });
}
if (process.argv[2] === '--expired-owner-worker') {
  const { root, plan, instance } = JSON.parse(fs.readFileSync(process.argv[3], 'utf8'));
  const artifacts = createStandardWorkflowArtifacts({ targetRoot: root });
  let clock = plan.plan.prepared_at_ms, grants = 0;
  const source = plan.plan.source, sourceHash = shadowHash(source);
  const writer = createStandardPrCorrectionReopen({ targetRoot: root, readCurrent: () => instance, now: () => clock,
    authority: { readSource: async () => source, verifySource: async () => ({ origin_source_sha256: sourceHash }) } });
  const binding = 'session_pr_correction_reopen';
  const record = fixtureSigner.seal({ operation_id: op, phase: 'dispatching', preview: fixtureSigner.seal({ prepared: plan }),
    intent: { binding_ref: binding, instance_id: instance.instance_id, scope_id: 'fixture', model_sha256: H },
    owner: { pid: process.pid, generation: 'fixture-cold-owner' }, results: [] });
  const disposition = reopenDisposition(root, artifacts, () => ({ record }));
  const result = await disposition.run(record, () => writer.apply(instance, plan, { write: true, expectPlan: plan.plan_sha256,
    assertAuthorized() { if (++grants === 8) clock += 300001; } }));
  assert.equal(result.effect_status, 'unknown');
  const receipted = fixtureSigner.seal({ ...record, phase: 'receipted', results: [{ output: result, receipt: {
    effect_status: 'unknown', outcome: 'reconciliation_required', output_sha256: shadowHash(result),
  } }] });
  process.stdout.write(JSON.stringify(receipted));
} else try {
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
  if (mode === 'files') await test('reopened snapshot cannot be hidden in the ordinary session checkpoint or bypass new-cycle admission', async () => {
    const checkpoint = createLocalWorkflowGitCheckpoint({ targetRoot: f.root }), before = checkpoint.inspect();
    assert.ok(before.changes.some(row => row.path === 'docs/audit/snapshots/context-snapshot.md'));
    const ordinary = new Set(['docs/audit/CURRENT-STATE.md', 'docs/audit/RUNTIME-STATE.md', 'docs/audit/sessions/S001.md']);
    const plan = { operation_id: 'op_' + '2'.repeat(40), plan_sha256: H, prepared_at_ms: Date.now(), observed: before,
      files: before.changes.filter(row => ordinary.has(row.path)).map(row => ({ path: row.path,
        sha256: f.artifacts.read(row.path.slice('docs/audit/'.length), { required: true }).sha256 })) };
    await assert.rejects(checkpoint.commit(plan, { assertAuthorized() {} }), { code: 'WORKFLOW_GIT_FOREIGN_CHANGES', effect_status: 'no_effect' });
    const admitted = await f.ops.admitCycle();
    assert.equal(admitted.outcome, 'blocked', JSON.stringify(admitted)); assert.deepEqual(admitted.facts, {});
    assert.equal(git(f.root, 'rev-parse', 'HEAD'), f.head);
    assert.deepEqual(checkpoint.inspect().changes, before.changes);
    assert.match(f.artifacts.read('CURRENT-STATE.md', { required: true }).content, /^active_cycle: none$/m);
  });
  if (mode === 'files') await test('authority lost after the first CAS retains unknown state and owner without retry', async () => {
    const partial = await fixture('files'), p = await partial.port.prepare(partial.instance, partial.input); let grants = 0;
    const result = await partial.port.apply(partial.instance, p, { write: true, expectPlan: p.plan_sha256,
      assertAuthorized() { if (++grants >= 4) throw Error('grant lost'); } });
    assert.equal(result.outcome, 'reconciliation_required'); assert.equal(result.effect_status, 'unknown'); assert.deepEqual(result.facts, {});
    assert.deepEqual(result.observations.committed.map(row => row.path), [partial.names[0]]);
    assert.equal(partial.artifacts.ownerPending(), true); assert.equal((await partial.port.prepare(partial.instance, partial.input)).can_apply, false);
  });
  if (mode === 'files') await test('expired reopening with three postimages is observable without repeating writes', async () => {
    const stopped = await fixture('files');
    const exclusion = '/docs/audit/workflows/dispatch-records/';
    const scaffold = fs.readFileSync(new URL('../../scaffold/root/.gitignore.append', import.meta.url), 'utf8');
    assert.ok(scaffold.split(/\r?\n/).includes(exclusion));
    fs.appendFileSync(path.join(stopped.root, '.git/info/exclude'), '\n' + exclusion + '\n');
    assert.equal(git(stopped.root, 'check-ignore', '--', exclusion.slice(1) + op + '.json'), exclusion.slice(1) + op + '.json');
    const observer = stopped.port;
    const plan = await observer.prepare(stopped.instance, stopped.input);
    const control = fs.mkdtempSync(path.join(temporary, 'aidn-reopen-fixture-control-'));
    const fixtureFile = path.join(control, 'reopen-observer-fixture.json');
    let record;
    try {
      fs.writeFileSync(fixtureFile, JSON.stringify({ root: stopped.root, plan, instance: stopped.instance }), { flag: 'wx' });
      assert.equal(git(stopped.root, 'status', '--porcelain'), '');
      record = JSON.parse(execFileSync(process.execPath, [fileURLToPath(import.meta.url), '--expired-owner-worker', fixtureFile],
        { encoding: 'utf8', timeout: 180000, windowsHide: true, maxBuffer: 1048576 }));
    } finally {
      if (fs.existsSync(fixtureFile)) fs.unlinkSync(fixtureFile);
      fs.rmdirSync(control);
    }
    const result = record.results[0].output;
    assert.equal(result.effect_status, 'unknown');
    assert.equal(result.observations.reason_code, 'STANDARD_PLAN_EXPIRED');
    assert.equal(result.observations.committed.length, 3);
    const file = name => path.join(stopped.root, 'docs/audit', name);
    const witness = () => stopped.names.map(name => fs.readFileSync(file(name)));
    const before = witness();
    const disposition = reopenDisposition(stopped.root, stopped.artifacts);
    const owner = disposition.observeInterruptedReopen(record);
    const assertOwner = () => assert.deepEqual(disposition.observeInterruptedReopen(record), owner);
    const observe = (output = result, options = {}) => observer.observeInterrupted(stopped.instance, plan, output, { assertOwner, ...options });
    await assert.rejects(observe({ ...result, observations: { ...result.observations, committed: result.observations.committed.slice(0, 2) } }),
      { code: 'STANDARD_PR_CORRECTION_POSTIMAGES_INCOMPLETE' });
    await assert.rejects(observe(result, { assertOwner() { throw Object.assign(Error('owner differs'), { code: 'FIXTURE_OWNER_CHANGED' }); } }),
      { code: 'FIXTURE_OWNER_CHANGED' });
    const foreign = file(stopped.names[1]);
    try {
      fs.appendFileSync(foreign, '\nForeign write\n');
      await assert.rejects(observe(), { code: 'PROCESS_INTERRUPTED_REOPEN_CONTEXT_CHANGED' });
      await assert.rejects(observe(result, { assertOwner() {} }), { code: 'STANDARD_PR_CORRECTION_DOCUMENT_CHANGED' });
    } finally { fs.writeFileSync(foreign, before[1]); }
    stopped.state.externalChanged = true;
    await assert.rejects(observe(), { code: 'STANDARD_PR_CORRECTION_PROVIDER_CHANGED' });
    stopped.state.externalChanged = false;
    const observed = await observe();
    assert.deepEqual(observed.postimages, result.observations.committed);
    assert.equal(observed.plan_sha256, plan.plan_sha256);
    assert.deepEqual(witness(), before);
    assert.equal(stopped.artifacts.ownerPending(), true);
    const lock = path.join(stopped.root, '.aidn/runtime/standard-workflow/effects.lock');
    const text = fs.readFileSync(lock);
    fs.renameSync(lock, lock + '.fixture-original');
    fs.writeFileSync(lock, text, { flag: 'wx' });
    assert.throws(() => disposition.observeInterruptedReopen(record), { code: 'PROCESS_INTERRUPTED_REOPEN_OWNER_CHANGED' });
  });
  console.log(JSON.stringify({ status: 'PASS', checks, mode, canonical_cas_projection_git_admission: 'ACTUAL', accepted_triage_and_external_source: 'DOUBLED',
    source_factory: 'SEPARATE_SUITE', host_ir_binding: 'NOT_EXERCISED_BY_THIS_SUITE', native_corrections: 'NOT_RUN', full_standard: false, installed_archive: 'NOT_RUN' }));
} finally {
  for (const root of owned.reverse()) { const real = fs.realpathSync(root); assert.equal(path.dirname(real), temporary); assert.ok(path.basename(real).startsWith('aidn-standard-fresh-')); fs.rmSync(real, { recursive: true, force: true }); }
  console.log(JSON.stringify({ fixture_cleanup: 'completed', independent_process_inventory: 'NOT_CAPTURED' }));
}
