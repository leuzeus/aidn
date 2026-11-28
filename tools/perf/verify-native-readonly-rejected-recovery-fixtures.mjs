import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fork, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { runProjectWorkflow } from '../../src/application/runtime/workflow-run-service.mjs';
import { runStandardNativeOwnerRecoveryEntry } from '../../src/application/runtime/standard-native-owner-recovery-entry.mjs';
import { createStandardWorkflowArtifacts } from '../../src/application/runtime/standard-workflow-artifacts.mjs';
import { shadowHash as H } from '../../src/core/workflow/shadow-json.mjs';
import { validateJsonSchema } from '../../src/core/contracts/json-schema-validator.mjs';
import envelope from '../../src/core/contracts/cli-output/runtime-workflow-run.v1.schema.json' with { type: 'json' };

const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
if (process.argv[2] === '--interrupt') {
  const data = read(process.argv[3]);
  process.env.AIDN_STANDARD_HOST_HOME = data.operator_home;
  await assert.rejects(runStandardNativeOwnerRecoveryEntry({ request: read(process.argv[4]), action: read(process.argv[5]),
    execute: true, expectPlan: process.argv[6] }, { onBoundary(name) {
      if (name === 'native_disposition_intent') throw Object.assign(Error('FIXTURE_RECOVERY_INTERRUPTED'), { code: 'FIXTURE_RECOVERY_INTERRUPTED' });
    } }), { code: 'FIXTURE_RECOVERY_INTERRUPTED', recovery_written: true });
  console.log(JSON.stringify({ status: 'INTERRUPTED_AFTER_INTENT', written: true, native_started: false }));
} else if (process.argv[2] === '--replay') {
  const data = read(process.argv[3]);
  process.env.AIDN_STANDARD_HOST_HOME = data.operator_home;
  const output = await runProjectWorkflow({ targetRoot: data.root, configuration: process.argv[4],
    actionFile: process.argv[5], execute: true, expectPlan: process.argv[6] });
  assert.deepEqual(output.errors, []); console.log(JSON.stringify(output));
} else {
  const home = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'aidn-readonly-report-'));
  const fixture = path.join(home, 'fixture.json'), configFile = path.join(home, 'request.json'), actionFile = path.join(home, 'action.json');
  const child = fork(fileURLToPath(new URL('./verify-agentic-process-execution-fixtures.mjs', import.meta.url)),
    ['--native-readonly-rejected-create=db-only', fixture], { stdio: ['ignore', 'pipe', 'pipe', 'ipc'], windowsHide: true });
  let log = ''; child.stdout.on('data', data => { log = (log + data).slice(-8192); }); child.stderr.on('data', data => { log = (log + data).slice(-8192); });
  const exited = once(child, 'exit'); let data, passed = false;
  const priorHome = process.env.AIDN_STANDARD_HOST_HOME;
  try {
    const [ready] = await Promise.race([once(child, 'message'), exited.then(([code]) => { throw Error('CREATOR_FAILED_' + code + ': ' + log); })]);
    assert.equal(ready.ready, 'read_only_rejected_owner_active');
    data = read(fixture); process.env.AIDN_STANDARD_HOST_HOME = home;
    fs.writeFileSync(configFile, JSON.stringify(data.request), { flag: 'wx' });
    const artifacts = createStandardWorkflowArtifacts({ targetRoot: data.root });
    const originals = () => Object.fromEntries([
      ['instance', 'workflows/process-instances/' + data.request.instance_id + '.json'],
      ['journal', 'workflows/native-allocations/' + data.journal_id + '.json'],
      ['dispatch', 'workflows/native-dispatches/' + data.request.dispatch_id + '.json'],
    ].map(([key, name]) => [key, artifacts.read(name, { required: true }).content]));
    const before = originals(), inventory = H(artifacts.observeInventory());
    const invoke = more => runProjectWorkflow({ targetRoot: data.root, configuration: configFile, ...more });
    const active = await invoke({});
    assert.deepEqual(active.errors, ['STANDARD_NATIVE_OWNER_RECOVERY_REJECTED_READONLY_REQUIRED']);
    assert.equal(H(artifacts.observeInventory()), inventory);
    console.log('PASS active creator refuses without writes');
    child.send('finish'); const [exitCode] = await exited; assert.equal(exitCode, 0, log);
    const preview = await invoke({}); assert.deepEqual(preview.errors, []);
    assert.equal(preview.can_apply, true); assert.equal(preview.written, false);
    assert.equal(H(preview.preview), preview.action_sha256);
    assert.deepEqual(validateJsonSchema(preview, envelope), []);
    assert.equal(H(artifacts.observeInventory()), inventory);
    fs.writeFileSync(actionFile, JSON.stringify(preview.preview), { flag: 'wx' });
    console.log('PASS SQL public preview is read-only and contract-valid');
    const wrong = await invoke({ actionFile, execute: true, expectPlan: '0'.repeat(64) });
    assert.deepEqual(wrong.errors, ['STANDARD_NATIVE_OWNER_RECOVERY_EXACT_ACTION_REQUIRED']);
    const missing = await invoke({ execute: true, expectPlan: preview.action_sha256 });
    assert.deepEqual(missing.errors, ['STANDARD_NATIVE_OWNER_RECOVERY_CONTRACT_INVALID']);
    assert.deepEqual(originals(), before); assert.equal(H(artifacts.observeInventory()), inventory);
    const product = path.join(data.configuration.product_root, 'app.mjs'), bytes = fs.readFileSync(product);
    fs.appendFileSync(product, '\n// changed product\n');
    const changed = await invoke({ actionFile, execute: true, expectPlan: preview.action_sha256 });
    assert(changed.errors.length > 0); assert.equal(changed.written, false);
    fs.writeFileSync(product, bytes);
    assert.deepEqual(originals(), before); assert.equal(H(artifacts.observeInventory()), inventory);
    console.log('PASS missing action, changed exact consent and product refuse before writes');
    const interrupted = spawnSync(process.execPath, [fileURLToPath(import.meta.url), '--interrupt', fixture, configFile, actionFile, preview.action_sha256],
      { encoding: 'utf8', windowsHide: true, timeout: 120000, maxBuffer: 1048576 });
    assert.equal(interrupted.status, 0, interrupted.stderr || interrupted.stdout);
    assert.deepEqual(JSON.parse(interrupted.stdout), { status: 'INTERRUPTED_AFTER_INTENT', written: true, native_started: false });
    assert.deepEqual(originals(), before); assert.equal(artifacts.ownerPending(), true);
    console.log('PASS interrupted retirement reports its separate write and keeps the original owner');
    const applied = await invoke({ actionFile, execute: true, expectPlan: preview.action_sha256 });
    assert.deepEqual(applied.errors, []); assert.equal(applied.result.status, 'owner_retirement_confirmed');
    assert.equal(applied.written, true); assert.equal(applied.result.native_started, false);
    for (const key of ['accounting_reconciled', 'permits_resume', 'permits_native_renewal', 'complete_resource_closure'])
      assert.equal(applied.result.receipt[key], false);
    assert.equal(artifacts.ownerPending(), false); assert.deepEqual(originals(), before);
    const after = H(artifacts.observeInventory());
    const replay = spawnSync(process.execPath, [fileURLToPath(import.meta.url), '--replay', fixture, configFile, actionFile, preview.action_sha256],
      { encoding: 'utf8', windowsHide: true, timeout: 120000, maxBuffer: 1048576 });
    assert.equal(replay.status, 0, replay.stderr || replay.stdout);
    const retained = JSON.parse(replay.stdout); assert.equal(retained.result.status, 'retained_confirmation');
    assert.equal(retained.written, false); assert.deepEqual(retained.result.receipt, applied.result.receipt);
    assert.equal(H(artifacts.observeInventory()), after); assert.deepEqual(originals(), before);
    assert.equal(JSON.parse(before.instance).events.at(-1).kind, 'assign');
    assert.equal(JSON.parse(before.journal).allocations.at(-1).phase, 'failed');
    console.log('PASS exact owner retirement and cold replay preserve failed assignment and accounting');
    passed = true;
  } finally {
    if (child.connected) child.send('finish');
    if (priorHome === undefined) delete process.env.AIDN_STANDARD_HOST_HOME; else process.env.AIDN_STANDARD_HOST_HOME = priorHome;
    if (passed) {
      const temp = fs.realpathSync(os.tmpdir());
      for (const directory of [data.root, path.dirname(data.private_root), home]) {
        const owned = fs.realpathSync(directory);
        assert.equal(path.dirname(owned), temp); assert(path.basename(owned).startsWith('aidn-'));
        fs.rmSync(owned, { recursive: true, force: true });
      }
      console.log(JSON.stringify({ status: 'PASS', backend: 'sqlite', mode: 'db-only', native_calls: 0,
        original_failure: 'PROCESS_SESSION_ANSWER_INVALID', history_preserved: true, owner_only: true,
        cold_receipt_replay: true, cleanup: 'PASS', live_postgres_retirement: 'SKIP' }));
    } else console.error('Retained failed fixture: ' + home);
  }
}
