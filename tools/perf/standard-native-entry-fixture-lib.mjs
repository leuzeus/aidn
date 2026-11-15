import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash, generateKeyPairSync, sign, randomUUID } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createFreshStandardWorkflowFixture } from './standard-workflow-fixture-lib.mjs';
import { retainFailedNativeAllocationFixture } from './native-allocation-assessment-fixture-lib.mjs';
import { CODEX_STARTUP_ENVIRONMENT_PROFILES } from '../../src/core/agents/codex-startup-arguments.mjs';
import { resolveStandardWorkflowConfiguration, runStandardWorkflowAction } from '../../src/application/runtime/standard-workflow-entry.mjs';
import { createStandardHostAuthority } from '../../src/adapters/runtime/standard-host-authority.mjs';
import { createStandardProcessAuthority } from '../../src/application/runtime/standard-process-authority.mjs';
import { loadStandardWorkflowAssets, createStandardWorkflowExecution } from '../../src/application/runtime/standard-workflow-composition.mjs';
import { createStandardWorkflowOperationHost } from '../../src/application/runtime/standard-workflow-operation-host.mjs';
import { createStandardWorkflowArtifacts } from '../../src/application/runtime/standard-workflow-artifacts.mjs';
import { readAgenticProductSnapshot } from '../../src/application/runtime/agentic-process-execution-composition.mjs';
import { shadowHash as H } from '../../src/core/workflow/shadow-json.mjs';

const script = fileURLToPath(import.meta.url), cli = fileURLToPath(new URL('../../bin/aidn.mjs', import.meta.url));
const sha = b => createHash('sha256').update(b).digest('hex'), pin = file => ({ path: file, sha256: sha(fs.readFileSync(file)) });
const lastJSON = value => JSON.parse(value.trim().split(/\r?\n/).findLast(row => row.startsWith('{')));
const environment = data => ({ ...process.env, AIDN_STANDARD_HOST_HOME: data.operator_home });
function run(data, extra = []) {
  let bytes;
  try { bytes = execFileSync(process.execPath, [cli, 'runtime', 'workflow-run', '--target', data.root, '--configuration', data.config_file, '--json', ...extra],
    { env: environment(data), windowsHide: true, maxBuffer: 16 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] }); }
  catch (error) { if (!error.stdout?.length) throw error; bytes = error.stdout; }
  const output = JSON.parse(bytes), logs = path.join(data.base, 'cli-calls'); fs.mkdirSync(logs, { recursive: true });
  fs.writeFileSync(path.join(logs, randomUUID() + '.json'), bytes, { flag: 'wx' });
  return output;
}
function apply(data, preview, selectors = []) {
  assert.deepEqual(preview.errors, [], JSON.stringify(preview)); fs.writeFileSync(data.action_file, JSON.stringify(preview.preview));
  return run(data, [...selectors, '--action-file', data.action_file, '--execute', '--expect-plan', preview.action_sha256]);
}
function runConsole(data, request, extra = []) {
  const requestFile = path.join(data.base, 'console-request.json'); fs.writeFileSync(requestFile, JSON.stringify(request)); let bytes;
  try { bytes = execFileSync(process.execPath, [cli, 'runtime', 'workflow-action', '--target', data.root, '--request', requestFile, '--json', ...extra],
    { env: environment(data), windowsHide: true, maxBuffer: 16 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] }); }
  catch (error) { if (!error.stdout?.length) throw error; bytes = error.stdout; }
  const output = JSON.parse(bytes), logs = path.join(data.base, 'console-calls'); fs.mkdirSync(logs, { recursive: true });
  fs.writeFileSync(path.join(logs, randomUUID() + '.json'), bytes, { flag: 'wx' }); return output;
}
function applyConsole(data, prepared, expectedPreview = null) {
  const request = { operation: 'run', input: { configuration: data.config_file, preparedAction: prepared.preview } }, before = canonical(data);
  const preview = runConsole(data, request); assert.deepEqual(preview.errors, [], JSON.stringify(preview));
  assert.deepEqual(preview.action.request.input.preparedAction, prepared.preview); assert.equal(canonical(data), before);
  if (expectedPreview) assert.equal(preview.action_sha256, expectedPreview);
  const applied = runConsole(data, preview.action.request, ['--execute', '--expect-plan', preview.action_sha256]);
  assert.deepEqual(applied.errors, [], JSON.stringify(applied)); return applied.result;
}

const canonical = data => H(createStandardWorkflowArtifacts({ targetRoot: data.root }).observeInventory());
function transport(body, privateKey) { return { ...body, signature: sign(null, Buffer.from(H(body)), privateKey).toString('base64') }; }
async function produce(mode, file) {
  const retained = [], root = createFreshStandardWorkflowFixture(mode, retained);
  const base = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'aidn-public-native-entry-'));
  const directories = Object.fromEntries(['control', 'review', 'home', 'authority', 'issuer'].map(name => { const p = path.join(base, name); fs.mkdirSync(p); return [name, p]; }));
  const product = path.join(root, 'product'); fs.mkdirSync(product); fs.writeFileSync(path.join(product, 'app.mjs'), 'export const value = 1;\n');
  const criteria = path.join(base, 'criteria.md'); fs.writeFileSync(criteria, 'Qualify public Native resource recovery without launching Native.\n');
  const human = generateKeyPairSync('ed25519'), resource = generateKeyPairSync('ed25519'), nativePrivate = path.join(directories.issuer, 'resource-owner.pem');
  fs.writeFileSync(nativePrivate, resource.privateKey.export({ type: 'pkcs8', format: 'pem' }));
  fs.mkdirSync(path.join(directories.authority, 'inbox'));
  fs.writeFileSync(path.join(directories.authority, 'principals.json'), JSON.stringify({ contract_version: 'standard-host-principals.v1', principals: [
    { authority_id: 'fixture_human', kinds: ['human'], public_key: human.publicKey.export({ type: 'spki', format: 'pem' }) },
    { authority_id: 'fixture_native_owner', kinds: ['native-renewal'], public_key: resource.publicKey.export({ type: 'spki', format: 'pem' }) }] }));
  const request = { contract_version: 'standard-workflow-execution.v1', execution: { instance_id: 'public-native-entry', target_root: root,
    product_root: product, product_files: ['app.mjs'], control_root: directories.control, review_root: directories.review, criteria: pin(criteria),
    authorities: { project: pin(path.join(root, 'AGENTS.md')) }, instructions: {}, controller: {},
    native: { executable: process.execPath, sha256: pin(process.execPath).sha256, home: directories.home, tool_roots: [], protected_roots: [directories.authority],
      hook_hashes: { work: ['sha256:' + 'a'.repeat(64), 'sha256:' + 'b'.repeat(64)], review: [] }, model: 'fixture-no-native', effort: 'medium',
      startup: { mcp_server_ids: [], plugin_ids: [], app_ids: [], environment_override_names: [], environment_names: [...CODEX_STARTUP_ENVIRONMENT_PROFILES.worker],
        log_dir: directories.control, sqlite_home: directories.control } } },
    parameters: { session: { session_id: 'S001', session_branch: 'S001-public-native-entry', objective: 'Public Native recovery fixture' },
      cycle: { cycle_id: 'C001', cycle_type: 'FEATURE', title: 'Unused cycle', objective: 'No retained cycle' } } };
  const data = { root, base, mode, operator_home: directories.authority, resource_private_key: nativePrivate, request,
    config_file: path.join(base, 'configuration.json'), action_file: path.join(base, 'action.json') };
  fs.writeFileSync(data.config_file, JSON.stringify(request));
  let ready;
  for (let n = 0; n < 32; n++) {
    const next = run(data); assert.deepEqual(next.errors, [], JSON.stringify(next));
    if (next.preview.kind === 'native') { ready = next; break; }
    if (next.preview.kind === 'dispatch' && next.preview.payload.question) {
      const question = next.preview.payload.question, ref = 'fixture-thinking';
      const source = { contract_version: 'human-mode-decision.v1', source_kind: 'human', authority_id: 'fixture_human', source_event_id: randomUUID(),
        subject_sha256: H('fixture-subject'), question_sha256: H(question), choice: 'THINKING', evidence_refs: [{ ref: 'fixture:synthetic-thinking-consent', sha256: H(question) }] };
      const now = Date.now(), envelope = { contract_version: 'standard-host-source.v1', kind: 'human', authority_id: source.authority_id, source_ref: ref,
        subject_sha256: H(question), payload: source, issued_at_ms: now, expires_at_ms: now + 3600000 };
      fs.writeFileSync(path.join(directories.authority, 'inbox', ref + '.json'), JSON.stringify(transport(envelope, human.privateKey)));
      assert.deepEqual(apply(data, run(data, ['--decision-source', ref]), ['--decision-source', ref]).errors, []);
    } else assert.deepEqual(apply(data, next).errors, []);
  }
  assert.ok(ready, 'published startup must reach its actual Native activity');
  const { configuration, modelSource } = resolveStandardWorkflowConfiguration(request), assets = loadStandardWorkflowAssets();
  const local = createStandardHostAuthority({ configuration, environment: environment(data) }, { useProvider: false });
  const key = () => local.readKey(), productSnapshot = () => readAgenticProductSnapshot(configuration.product_root, configuration.product_files);
  const authority = createStandardProcessAuthority({ configuration, model: assets.model, modelSource, readSigningKey: key,
    humanSource: local.humanSource, readProductSnapshot: productSnapshot, readProductSha256: () => H(productSnapshot()), environment: environment(data) });
  const hostOptions = { targetRoot: root, model: assets.model, modelSource, readSigningKey: key, authorize: async () => null,
    processAuthority: authority, reconciliationConfiguration: configuration, humanSource: local.humanSource };
  const host = createStandardWorkflowOperationHost(hostOptions), instance = host.inspect(configuration.instance_id).record;
  const artifacts = createStandardWorkflowArtifacts({ targetRoot: root });
  const fixture = await retainFailedNativeAllocationFixture({ mode, retained, root, privateRoot: base, configuration, key, model: assets.model,
    productSnapshot, authority, hostOptions, host, instance, artifacts, retainAuthorization: true });
  const saved = { ...data, configuration, model_source: modelSource, input: fixture.input,
    original_journal_sha256: artifacts.read('workflows/native-allocations/' + fixture.journalId + '.json').sha256,
    original_dispatch_sha256: artifacts.read('workflows/native-dispatches/' + fixture.dispatch.dispatch_id + '.json').sha256 };
  fs.writeFileSync(file, JSON.stringify(saved), { flag: 'wx' });
  console.log(JSON.stringify({ status: 'PUBLISHED_PREFIX_AND_SYNTHETIC_NO_ASSIGNMENT_FAILURE_RETAINED', file, root, base, Native_calls: 0 }));
}
function worker(args, expected = 0) {
  const result = spawnSync(process.execPath, [script, ...args], { encoding: 'utf8', windowsHide: true, maxBuffer: 16 * 1024 * 1024 });
  assert.equal(result.status, expected, result.stderr || result.stdout); return lastJSON(result.stdout);
}
function issue(data, action, ref, forged = false) {
  const reconciliation = action.kind === 'native_allocation_reconcile', request = reconciliation ? action.payload.preparation.request : action.payload.request;
  const now = Date.now(); let grant;
  if (reconciliation) {
    const artifacts = createStandardWorkflowArtifacts({ targetRoot: data.root }), journal = JSON.parse(artifacts.read('workflows/native-allocations/' + request.journal_id + '.json').content);
    const entry = journal.allocations[request.generation - 1], bytes = fs.statSync(entry.checkpoint.path).size + fs.statSync(entry.closure_ref.path).size;
    grant = { contract_version: 'native-allocation-reconciliation-grant.v1', authority_id: 'fixture_native_owner', source_event_id: randomUUID(), request_sha256: H(request),
      consumption: { responses_observed: 0, response_sha256: [], storage_debit_bytes: Math.max(bytes, request.minimum_consumption.storage_debit_bytes), native_usage_sha256: null },
      evidence_refs: [{ ref: 'fixture:measured-checkpoint-and-closure', sha256: H({ bytes }) }] };
  } else grant = { contract_version: 'native-authorization-epoch-grant.v1', authority_id: 'fixture_native_owner', source_event_id: randomUUID(), request_sha256: H(request),
    authorization: { approved: true, model_allowed: true, configuration_sha256: request.configuration_sha256, authorized_at_ms: now, global_deadline_ms: now + 600000,
      workflow_deadline_ms: now + 600000, max_turn_ms: 60000, max_responses: 3, max_bytes: Math.max(8388608, request.consumption.bytes + 1048576) },
    evidence_refs: [{ ref: 'fixture:synthetic-explicit-finite-epoch-consent', sha256: H(request) }] };
  grant.closure = { contract_version: 'native-resource-closure.v1', request_sha256: H(request), inventory_sha256: H(request.resources), observed_at_ms: now,
    complete: true, active_resources: 0, evidence_class: 'fixture', resources: request.resources.map(resource => ({ resource_sha256: H(resource), state: 'closed',
      evidence_refs: [{ ref: 'fixture:synthetic-native-scope-closure', sha256: H(resource) }] })) };
  const envelope = { contract_version: 'standard-host-source.v1', kind: 'native-renewal', authority_id: grant.authority_id, source_ref: ref, subject_sha256: H(request),
    payload: grant, issued_at_ms: now, expires_at_ms: now + 3600000 };
  const signed = transport(envelope, fs.readFileSync(data.resource_private_key));
  if (forged) signed.signature = Buffer.alloc(64).toString('base64');
  fs.writeFileSync(path.join(data.operator_home, 'inbox', ref + '.json'), JSON.stringify(signed)); return grant;
}
function selectSource(data, prepared, ref) {
  const action = structuredClone(prepared.preview); action.payload.source_ref = ref;
  fs.writeFileSync(data.action_file, JSON.stringify(action));
  const before = canonical(data), preview = run(data, ['--action-file', data.action_file]);
  assert.deepEqual(preview.errors, [], JSON.stringify(preview)); assert.deepEqual(preview.preview, action); assert.equal(canonical(data), before);
  assert.equal(preview.action_sha256, H(action)); assert.equal(preview.can_apply, true); return preview;
}
async function interruptAfterNativeCAS(data, action) {
  const local = createStandardHostAuthority({ configuration: data.configuration, environment: environment(data) }, { useProvider: false });
  const compose = (authorize, dispositionSource, sources) => createStandardWorkflowExecution({ configuration: data.configuration, readSigningKey: () => local.readKey(),
    authorize, environment: environment(data), humanSource: local.humanSource, controlSource: local.controlSource, nativeAuthorizationSource: local.nativeAuthorizationSource,
    dispositionSource, nativeOwnerDispositionSource: sources.owner, nativeReconciliationSource: sources.reconciliation }, { nativeReconciliationBoundary(name) {
      if (name === 'native_reconciliation_journal_cas') throw Object.assign(Error('FIXTURE_PUBLIC_NATIVE_CAS_INTERRUPT'), { code: 'FIXTURE_PUBLIC_NATIVE_CAS_INTERRUPT' });
    } });
  try {
    await runStandardWorkflowAction({ request: data.request, configuration: data.configuration, parameters: data.request.parameters, modelSource: data.model_source,
      preparedAction: action, execute: true, expectPlan: H(action) }, { authority: local, compose });
    assert.fail('named interruption must occur');
  } catch (error) { if (error.code !== 'FIXTURE_PUBLIC_NATIVE_CAS_INTERRUPT') throw error; }
  console.log(JSON.stringify({ status: 'PUBLIC_ACTION_INTERRUPTED_AFTER_REAL_NATIVE_JOURNAL_CAS', Native_calls: 0 }));
}
async function revokeEpochSourceAfterVerification(data, action) {
  const local = createStandardHostAuthority({ configuration: data.configuration, environment: environment(data) }, { useProvider: false });
  const sourceFile = path.join(data.operator_home, 'inbox', action.payload.source_ref + '.json'), before = fs.readFileSync(sourceFile);
  const original = H(createStandardWorkflowArtifacts({ targetRoot: data.root }).observeInventory().rows.find(row => row.path.startsWith('workflows/native-allocations/')).content);
  let observed = false;
  const source = { ...local.nativeAuthorizationSource, async verify(input) {
    const verified = local.nativeAuthorizationSource.verify(input); observed = true;
    const envelope = JSON.parse(before); envelope.signature = Buffer.alloc(64).toString('base64'); fs.writeFileSync(sourceFile, JSON.stringify(envelope));
    return verified;
  } };
  const compose = (authorize, dispositionSource, sources) => createStandardWorkflowExecution({ configuration: data.configuration, readSigningKey: () => local.readKey(),
    authorize, environment: environment(data), humanSource: local.humanSource, controlSource: local.controlSource, nativeAuthorizationSource: source,
    dispositionSource, nativeOwnerDispositionSource: sources.owner, nativeReconciliationSource: sources.reconciliation });
  try {
    await assert.rejects(runStandardWorkflowAction({ request: data.request, configuration: data.configuration, parameters: data.request.parameters,
      modelSource: data.model_source, preparedAction: action, execute: true, expectPlan: H(action) }, { authority: local, compose }),
    { code: 'STANDARD_HOST_SOURCE_NOT_AUTHENTICATED' });
    assert.equal(observed, true);
    const current = createStandardWorkflowArtifacts({ targetRoot: data.root }).observeInventory().rows.find(row => row.path.startsWith('workflows/native-allocations/')).content;
    assert.equal(H(current), original);
  } finally { fs.writeFileSync(sourceFile, before); }
  console.log(JSON.stringify({ status: 'EPOCH_SOURCE_REVOKED_AFTER_VERIFICATION_REFUSED_BEFORE_NATIVE_CAS', Native_calls: 0, original_native_journal_exact: true }));
}

export async function verifyPublicNativeEntryFixture(mode) {
  const proof = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'aidn-public-native-proof-')), file = path.join(proof, 'fixture.json');
  worker(['produce', mode, file]); const data = JSON.parse(fs.readFileSync(file, 'utf8')), original = canonical(data);
  const ownerConsole = runConsole(data, { operation: 'run', input: { configuration: data.config_file } });
  assert.deepEqual(ownerConsole.errors, [], JSON.stringify(ownerConsole)); assert.ok(ownerConsole.action.effects.includes('native_owner_retirement'));
  const owner = ownerConsole.action.preview; assert.deepEqual(ownerConsole.action.request.input.preparedAction, owner.preview);
  assert.deepEqual(owner.errors, [], JSON.stringify(owner)); assert.equal(owner.preview.kind, 'native_owner_retire');
  assert.equal(owner.preview.contract_version, 'standard-workflow-native-action.v1'); assert.equal(canonical(data), original);
  const tampered = structuredClone(owner.preview); tampered.payload.plan.authentication = '0'.repeat(64); fs.writeFileSync(data.action_file, JSON.stringify(tampered));
  assert.equal(run(data, ['--action-file', data.action_file]).errors[0], 'PROCESS_JOURNAL_NOT_AUTHENTICATED'); assert.equal(canonical(data), original);
  assert.equal(run(data, ['--execute', '--expect-plan', owner.action_sha256]).errors[0], 'STANDARD_ENTRY_EXACT_ACTION_REQUIRED'); assert.equal(canonical(data), original);
  const retired = applyConsole(data, owner, ownerConsole.action_sha256); assert.deepEqual(retired.errors, [], JSON.stringify(retired)); assert.equal(retired.result.action_kind, 'native_owner_retire');
  assert.equal(retired.result.native_started, false); assert.equal(retired.result.workflow_completed, false);
  const afterRetirement = canonical(data), ownerReplay = apply(data, owner); assert.deepEqual(ownerReplay.errors, [], JSON.stringify(ownerReplay));
  assert.equal(ownerReplay.written, false); assert.equal(canonical(data), afterRetirement);
  const missing = run(data); assert.deepEqual(missing.errors, [], JSON.stringify(missing)); assert.equal(missing.preview.kind, 'native_allocation_reconcile');
  assert.equal(missing.can_apply, false); assert.ok(missing.requirements.includes('AUTHENTICATED_NATIVE_RESOURCE_SOURCE_REQUIRED'));
  const reconciliation = selectSource(data, missing, 'fixture-reconciliation');
  const absent = apply(data, reconciliation); assert.deepEqual(absent.errors, [], JSON.stringify(absent)); assert.equal(absent.result.details.status, 'WAITING');
  assert.equal(absent.written, false); assert.equal(canonical(data), afterRetirement);
  issue(data, reconciliation.preview, 'fixture-reconciliation', true);
  assert.equal(apply(data, reconciliation).errors[0], 'STANDARD_HOST_SOURCE_NOT_AUTHENTICATED'); assert.equal(canonical(data), afterRetirement);
  issue(data, reconciliation.preview, 'fixture-reconciliation');
  if (mode === 'files') worker(['interrupt', file, data.action_file]);
  const reconciled = apply(data, reconciliation); assert.deepEqual(reconciled.errors, [], JSON.stringify(reconciled));
  assert.equal(reconciled.result.action_kind, 'native_allocation_reconcile'); assert.equal(reconciled.result.workflow_completed, false);
  const afterReconciliation = canonical(data), replay = apply(data, reconciliation); assert.deepEqual(replay.errors, [], JSON.stringify(replay));
  assert.equal(replay.written, false); assert.equal(canonical(data), afterReconciliation);
  const epoch = selectSource(data, run(data), 'fixture-new-epoch'); assert.equal(epoch.preview.kind, 'native_authorization_epoch'); issue(data, epoch.preview, 'fixture-new-epoch');
  fs.writeFileSync(data.action_file, JSON.stringify(epoch.preview)); worker(['revoke-epoch-source', file, data.action_file]);
  const activated = applyConsole(data, epoch); assert.deepEqual(activated.errors, [], JSON.stringify(activated)); assert.equal(activated.result.details.status, 'authorized');
  assert.equal(activated.result.native_started, false); assert.equal(activated.result.workflow_completed, false);
  const afterEpoch = canonical(data), epochReplay = apply(data, epoch); assert.deepEqual(epochReplay.errors, [], JSON.stringify(epochReplay));
  assert.equal(epochReplay.written, false); assert.equal(canonical(data), afterEpoch);
  const next = run(data); assert.deepEqual(next.errors, [], JSON.stringify(next)); assert.equal(next.preview.kind, 'native'); assert.equal(next.can_apply, false);
  const artifacts = createStandardWorkflowArtifacts({ targetRoot: data.root }), rows = artifacts.observeInventory().rows;
  const journal = JSON.parse(rows.find(row => row.path.startsWith('workflows/native-allocations/')).content);
  assert.equal(journal.contract_version, 'native-allocation-journal.v4'); assert.equal(journal.allocations.length, 1); assert.equal(journal.allocations[0].phase, 'failed');
  assert.equal(journal.allocations[0].limits.global_deadline_ms, 100); assert.equal(journal.epochs.length, 1); assert.equal(journal.reconciliations.length, 1);
  assert.equal(artifacts.read('workflows/native-dispatches/' + data.input.dispatchId + '.json').sha256, data.original_dispatch_sha256);
  assert.equal(artifacts.resourceFence().read().record.state, 'released');
  if (mode === 'db-only') assert.equal(fs.existsSync(path.join(data.root, 'docs/audit/workflows/native-allocation-reconciliations')), false);
  return { status: 'PASS_PUBLIC_NATIVE_RESOURCE_ACTIONS', mode, proof, target: data.root, actual_CLI_and_console_and_published_model: true,
    actual_operator_HMAC_and_source_Ed25519: true, source_revoked_after_verification_refused_before_epoch_CAS: true, actual_creator_terminated: true, FILES_post_CAS_cold_ack: mode === 'files',
    original_failure_deadline_dispatch_debits_preserved: true, native_allocations_after_authorization: 0, Native_calls: 0,
    Native_return_checkpoint_OS_closure_and_human_epoch_consent: 'SYNTHETIC_FIXTURE', genuine_human_or_Native: false, installed_archive: false, full_standard: false };
}
if (process.argv[1] && path.resolve(process.argv[1]) === script) {
  try { const [action, first, second] = process.argv.slice(2);
    if (action === 'produce') await produce(first, second);
    else if (action === 'interrupt') await interruptAfterNativeCAS(JSON.parse(fs.readFileSync(first, 'utf8')), JSON.parse(fs.readFileSync(second, 'utf8')));
    else if (action === 'revoke-epoch-source') await revokeEpochSourceAfterVerification(JSON.parse(fs.readFileSync(first, 'utf8')), JSON.parse(fs.readFileSync(second, 'utf8')));
    else if (action === 'verify') console.log(JSON.stringify(await verifyPublicNativeEntryFixture(first)));
    else throw Error('PUBLIC_NATIVE_FIXTURE_ACTION_INVALID');
  } catch (error) { console.error(error); process.exitCode = 1; }
}
