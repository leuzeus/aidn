import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fork, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { createNativeOwnerDispositionFixtureHost, createNativeOwnerDispositionFixtureAuthority } from './native-owner-disposition-fixture-lib.mjs';
import { createStandardWorkflowArtifacts } from '../../src/application/runtime/standard-workflow-artifacts.mjs';
import { observeReadOnlyNativeStorageStop } from '../../src/application/runtime/native-readonly-storage-interruption.mjs';
import { createOperationJournalSigner } from '../../src/core/workflow/process-operation-journal.mjs';
import { readAgenticProductSnapshot } from '../../src/application/runtime/agentic-process-execution-composition.mjs';
import { shadowHash as H } from '../../src/core/workflow/shadow-json.mjs';

const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const mode = process.argv[2] ?? 'db-only';
const key = () => Buffer.alloc(32, 73);

function original(data) {
  const artifacts = createStandardWorkflowArtifacts({ targetRoot: data.root });
  return Object.fromEntries([
    ['journal', 'workflows/native-allocations/' + data.journal_id + '.json'],
    ['dispatch', 'workflows/native-dispatches/' + data.input.dispatchId + '.json'],
    ['instance', 'workflows/process-instances/' + data.configuration.instance_id + '.json'],
  ].map(([name, file]) => [name, artifacts.read(file, { required: true }).content]));
}

if (mode === '--replay') {
  const data = read(process.argv[3]), plan = read(process.argv[4]);
  const result = await createNativeOwnerDispositionFixtureHost(data, plan).applyNativeOwnerDisposition(plan,
    { write: true, expectedPlanSha256: H(plan) });
  console.log(JSON.stringify(result));
} else {
  assert(['dual', 'db-only'].includes(mode));
  const home = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'aidn-readonly-storage-stop-'));
  const fixture = path.join(home, 'fixture.json'), planFile = path.join(home, 'plan.json');
  const creator = fileURLToPath(new URL('./verify-agentic-process-execution-fixtures.mjs', import.meta.url));
  const child = fork(creator, ['--native-readonly-storage-create=' + mode, fixture],
    { stdio: ['ignore', 'pipe', 'pipe', 'ipc'], windowsHide: true });
  let output = '';
  child.stdout.on('data', data => { output += data; });
  child.stderr.on('data', data => { output += data; });
  const exited = once(child, 'exit');
  try {
    const [ready] = await Promise.race([once(child, 'message'), exited.then(([code]) => { throw Error('CREATOR_FAILED_' + code + ': ' + output); })]);
    assert.equal(ready.ready, 'read_only_storage_owner_active');
    const data = read(fixture);
    createNativeOwnerDispositionFixtureAuthority(data).ensureKey();
    const artifacts = createStandardWorkflowArtifacts({ targetRoot: data.root });
    const before = original(data);
    const host = createNativeOwnerDispositionFixtureHost(data, null);
    assert.throws(() => host.prepareNativeOwnerDisposition(data.configuration.instance_id, data.input),
      { code: 'NATIVE_ALLOCATION_CHECKPOINT_UNAVAILABLE' });
    console.log('PASS active original creator refuses retirement');
    child.send('finish');
    const [code] = await exited;
    assert.equal(code, 0, output);
    const observed = createNativeOwnerDispositionFixtureHost(data, null);
    const assessment = observed.prepareNativeAllocationAssessment(data.configuration.instance_id, data.input);
    assert.equal(assessment.assessment.checkpoint, null);
    assert.equal(assessment.assessment.native_accounting_known, false);
    assert.equal(assessment.assessment.business_effect, 'unknown');
    assert(assessment.readOnlyStorageStop);
    console.log('PASS terminated read-only storage stop yields diagnostic evidence with unknown accounting');
    const plan = observed.prepareNativeOwnerDisposition(data.configuration.instance_id, data.input);
    fs.writeFileSync(planFile, JSON.stringify(plan), { flag: 'wx' });

    const journal = JSON.parse(before.journal), instance = JSON.parse(before.instance);
    const proof = { instance, journal, configuration: data.configuration, artifacts,
      signer: createOperationJournalSigner(key),
      productSha256: H(readAgenticProductSnapshot(data.configuration.product_root, data.configuration.product_files)) };
    assert(observeReadOnlyNativeStorageStop(proof));
    for (const altered of [
      { ...proof, productSha256: H('foreign-product') },
      { ...proof, journal: { ...journal, allocations: [...journal.allocations.slice(0, -1), { ...journal.allocations.at(-1), tree_closed: false }] } },
      { ...proof, journal: { ...journal, allocations: [...journal.allocations.slice(0, -1), { ...journal.allocations.at(-1), first_failure: 'PROCESS_EXECUTION_CANCELLED' }] } },
    ]) assert.equal(observeReadOnlyNativeStorageStop(altered), null);
    const missing = createNativeOwnerDispositionFixtureHost(data, plan, { profile: 'missing' });
    await assert.rejects(missing.applyNativeOwnerDisposition(plan, { write: true, expectedPlanSha256: H(plan) }),
      { code: 'NATIVE_OWNER_DISPOSITION_AUTHORITY_UNAVAILABLE' });
    assert.deepEqual(original(data), before);
    console.log('PASS changed product, unconfirmed tree and missing permission refuse retirement');

    const product = path.join(data.configuration.product_root, 'app.mjs'), bytes = fs.readFileSync(product);
    fs.appendFileSync(product, '\n// changed product\n');
    await assert.rejects(createNativeOwnerDispositionFixtureHost(data, plan).applyNativeOwnerDisposition(plan,
      { write: true, expectedPlanSha256: H(plan) }));
    fs.writeFileSync(product, bytes);
    const result = await createNativeOwnerDispositionFixtureHost(data, plan).applyNativeOwnerDisposition(plan,
      { write: true, expectedPlanSha256: H(plan) });
    assert.equal(result.status, 'owner_retirement_confirmed');
    assert.equal(result.receipt.accounting_reconciled, false);
    assert.equal(result.receipt.permits_resume, false);
    assert.equal(result.receipt.permits_native_renewal, false);
    assert.equal(result.receipt.complete_resource_closure, false);
    assert.equal(artifacts.ownerPending(), false);
    assert.deepEqual(original(data), before);
    console.log('PASS physical owner retired while original records remain exact');
    const replay = spawnSync(process.execPath, [fileURLToPath(import.meta.url), '--replay', fixture, planFile],
      { encoding: 'utf8', windowsHide: true, timeout: 60000, maxBuffer: 1048576 });
    assert.equal(replay.status, 0, replay.stderr);
    assert.deepEqual(JSON.parse(replay.stdout).receipt, result.receipt);
    assert.deepEqual(original(data), before);
    assert.equal(JSON.parse(before.journal).allocations.at(-1).consumption, null);
    console.log(JSON.stringify({ status: 'PASS', mode, model_calls: 0, original_failure: 'PROCESS_EXECUTION_STORAGE_LIMIT',
      accounting: 'unknown', owner_retired: true, cold_receipt_replay: true, native_client: 'NOT_RUN',
      original_history_preserved: true, retained_fixture: fixture }));
  } finally {
    if (child.connected) child.send('finish');
  }
}
