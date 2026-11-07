import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createCorrectionRealPortFixture, bindCorrectionRealPorts, acceptFixtureReopen, correctionFixtureSigner as signer,
  fixtureOp, fixtureHash as H } from './standard-pr-correction-real-port-fixture-lib.mjs';
import { createStandardWorkflowArtifacts } from '../../src/application/runtime/standard-workflow-artifacts.mjs';
import { createAgenticProcess, advanceAgenticProcess, inspectAgenticProcess } from '../../src/core/workflow/agentic-process.mjs';
import { simulateAgenticProcess } from '../../src/core/workflow/agentic-process-simulation.mjs';
import { agenticPolicyPins } from '../../src/core/workflow/agentic-process-model.mjs';
import { standardWorkflowOperationBindings } from '../../src/application/runtime/standard-workflow-operations.mjs';
import { shadowHash } from '../../src/core/workflow/shadow-json.mjs';
import { preWriteAdmit } from '../runtime/pre-write-admit.mjs';
import { createProjectArtifactStore } from '../../src/application/runtime/project-artifact-store-service.mjs';
import { artifactMetadataHash } from '../../src/core/workflow/artifact-compare-swap.mjs';

const git = (root, ...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: 'pipe', windowsHide: true }).trim();
const here = fileURLToPath(import.meta.url), temporary = fs.realpathSync(os.tmpdir()), owned = [], evidence = [];
const mode = process.argv.find(arg => arg.startsWith('--mode='))?.slice(7) ?? 'files';
const positiveOnly = process.argv.includes('--positive-only'), retain = process.argv.includes('--retain-always');
const grantOnly = process.argv.includes('--grant-only');
assert.ok(['files', 'dual', 'db-only'].includes(mode), 'FIXTURE_STATE_MODE_INVALID');
const projectionCases = mode === 'db-only' ? [] : ['projection'];
const canonicalCases = mode === 'files' ? [] : ['canonical', 'metadata'];
const notApplicable = mode === 'db-only' && !positiveOnly && !grantOnly
  ? ['before-effect', 'after-first-CAS'].map(phase => ({ phase, probe: 'projection', status: 'N/A',
    reason: 'DB-only has no physical business projection; canonical content/metadata and foreign Git probes remain required' })) : [];
const child = process.argv.find(arg => arg.startsWith('--child='));
if (child) {
  const saved = signer.verify(JSON.parse(fs.readFileSync(child.slice(8), 'utf8'))), f = bindCorrectionRealPorts(saved.fixture);
  let result;
  if (saved.action === 'checkpoint') result = await f.checkpoint.prepare(f.instance, saved.input, fixtureOp(6));
  else result = await f.port.prepare(f.instance, f.input);
  console.log(JSON.stringify(result)); process.exit(0);
}
const snapshot = f => f.names.map(name => ({ path: name, sha256: f.artifacts.read(name, { required: true }).sha256, metadata_sha256: f.artifacts.metadataHash(name) }));
const save = (f, name, body) => {
  const directory = path.join(f.root, '.aidn/runtime/standard-workflow/correction-real-port-preflight'); fs.mkdirSync(directory, { recursive: true });
  const file = path.join(directory, name + '.json'); fs.writeFileSync(file, JSON.stringify(signer.seal(body), null, 2) + '\n'); return file;
};
const cold = (f, action, input) => JSON.parse(execFileSync(process.execPath,
  [here, '--child=' + save(f, 'cold-' + action, { fixture: f.saved, action, input: input ?? null })],
  { encoding: 'utf8', stdio: 'pipe', windowsHide: true, timeout: 180000, maxBuffer: 1048576 }));
function remote(root, branch) {
  const directory = fs.mkdtempSync(path.join(temporary, 'aidn-correction-remote-')); owned.push(directory);
  git(directory, 'init', '--bare'); git(root, '-c', 'core.hooksPath=NUL', '-c', 'protocol.file.allow=always', 'push', directory, branch + ':refs/heads/' + branch);
  return directory;
}
const fixture = async () => {
  const f = await createCorrectionRealPortFixture(mode, owned, remote);
  assertProjectionScope(f); return f;
};
function mutate(f, kind) {
  const fileMutation = (file, bytes) => { const before = fs.readFileSync(file); fs.writeFileSync(file, bytes ?? Buffer.concat([before, Buffer.from('\nforeign\n')])); return () => fs.writeFileSync(file, before); };
  if (kind === 'provider') { const old = f.provider.state.reviews[0].body; f.provider.state.reviews[0].body += ' Changed finding.'; return () => { f.provider.state.reviews[0].body = old; }; }
  if (kind === 'event') { f.state.eventCurrent = false; return () => { f.state.eventCurrent = true; }; }
  if (kind === 'source') { const old = structuredClone(f.saved.rows[fixtureOp(1)]); f.saved.rows[fixtureOp(1)].output.observations.corrections[0].correction += ' tampered'; return () => { f.saved.rows[fixtureOp(1)] = old; }; }
  if (kind === 'prefix') { f.state.prefix = 'b'.repeat(64); return () => { f.state.prefix = f.instance.instance_sha256; }; }
  if (kind === 'product') return fileMutation(path.join(f.root, 'fixture-product.txt'));
  if (kind === 'projection') return fileMutation(path.join(f.root, 'docs/audit', f.names[0]));
  if (kind === 'canonical' || kind === 'metadata') {
    assert.notEqual(mode, 'files');
    const store = createProjectArtifactStore({ targetRoot: f.root, existingOnly: true });
    let previous, changed;
    try {
      previous = store.getArtifact(f.names[0]); assert.ok(previous);
      // Deliberate competing canonical writer, independent of the held owner.
      // Preserve the exact historical row for before-effect fixture restoration;
      // never alter a prepared plan or an authorization timestamp.
      const artifact = kind === 'canonical'
        ? { ...previous, content: previous.content + '\nforeign canonical content\n', sha256: undefined, size_bytes: undefined, canonical_json: undefined }
        : { ...previous, classification_reason: previous.classification_reason + '-foreign' };
      store.compareAndSwapArtifact({ artifact, expectedSha256: previous.sha256, expectedMetadataSha256: artifactMetadataHash(previous) });
      changed = store.getArtifact(f.names[0]);
    } finally { store.close(); }
    return () => {
      const restore = createProjectArtifactStore({ targetRoot: f.root, existingOnly: true });
      try { restore.compareAndSwapArtifact({ artifact: previous, expectedSha256: changed.sha256, expectedMetadataSha256: artifactMetadataHash(changed) }); }
      finally { restore.close(); }
    };
  }
  if (kind === 'foreign') { const file = path.join(f.root, 'unapproved.txt'); fs.writeFileSync(file, 'foreign'); return () => fs.unlinkSync(file); }
  if (kind === 'index') {
    const file = path.resolve(f.root, git(f.root, 'rev-parse', '--git-path', 'index')), bytes = fs.readFileSync(file);
    git(f.root, 'update-index', '--chmod=+x', 'fixture-product.txt'); return () => fs.writeFileSync(file, bytes);
  }
  if (kind === 'head') { git(f.root, 'update-ref', 'refs/heads/' + f.p.head_branch, f.p.base_oid); return () => git(f.root, 'update-ref', 'refs/heads/' + f.p.head_branch, f.p.head_oid); }
  if (kind === 'ref') { git(f.root, 'symbolic-ref', 'HEAD', 'refs/heads/dev'); return () => git(f.root, 'symbolic-ref', 'HEAD', 'refs/heads/' + f.p.head_branch); }
  if (kind === 'remote') { git(f.remoteRoot, 'update-ref', 'refs/heads/' + f.p.head_branch, f.p.base_oid); return () => git(f.remoteRoot, 'update-ref', 'refs/heads/' + f.p.head_branch, f.p.head_oid); }
  if (kind.endsWith('-lock')) {
    const selected = { 'index-lock': 'index.lock', 'ref-lock': 'refs/heads/' + f.p.head_branch + '.lock', 'head-lock': 'HEAD.lock', 'packed-lock': 'packed-refs.lock' }[kind];
    const file = path.resolve(f.root, git(f.root, 'rev-parse', '--git-path', selected)); fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, 'fixture concurrent Git owner', { flag: 'wx' }); return () => fs.unlinkSync(file);
  }
  if (kind === 'owner') {
    const file = path.join(f.root, '.aidn/runtime/standard-workflow/effects.lock'), value = JSON.parse(fs.readFileSync(file, 'utf8'));
    fs.writeFileSync(file, JSON.stringify({ ...value, plan_sha256: 'b'.repeat(64) })); return () => {};
  }
  throw Error('FIXTURE_UNKNOWN_MUTATION_' + kind);
}
let checks = 0;
const test = async (name, fn) => { await fn(); checks++; console.log('PASS ' + name); };
const physicalPreimages = new WeakMap();
const assertProjectionScope = f => {
  if (mode !== 'db-only') return;
  assert.equal(f.artifacts.describe().database, true);
  const physical = f.names.map(name => {
    const file = path.join(f.root, 'docs/audit', name);
    return { path: name, bytes: fs.existsSync(file) ? fs.readFileSync(file).toString('base64') : null };
  });
  // Minimal restart anchors can already exist in a DB-only source installation.
  // Their retained bytes must not become projections of these canonical writes.
  if (!physicalPreimages.has(f)) physicalPreimages.set(f, physical);
  assert.deepEqual(physical, physicalPreimages.get(f), 'DB-only must preserve existing physical anchors and absence');
  for (const name of f.names) {
    assert.equal(f.artifacts.read(name, { required: true }).source, 'sqlite');
    if (name.startsWith('sessions/')) assert.equal(fs.existsSync(path.join(f.root, 'docs/audit', name)), false,
      'DB-only must not fabricate a detailed session projection');
  }
};
// A tiny preflight IR consumes the ACTUAL outputs with explicitly fixture-made
// receipts. This checks the common reducer only, not the production dispatcher,
// native producer, long standard graph or checkpoint ack-loss recovery chain.
function replay(outputs) {
  const ids = outputs.map(row => row.operation_ref), bindings = standardWorkflowOperationBindings().filter(row => ids.includes(row.id));
  const model = { contract_version: 'agentic-process-model.v2', model_id: 'correction-real-port-preflight', revision: 1,
    participants: [{ id: 'project' }], roles: [], policies: [], operation_pins: Object.fromEntries(bindings.map(row => [row.id, shadowHash(row)])), entry: 'root',
    nodes: [{ id: 'root', kind: 'sequence', participant_ref: 'project', children: ids.map((_, i) => 'step' + i) },
      ...ids.map((id, i) => ({ id: 'step' + i, kind: 'operation', participant_ref: 'project', binding_ref: id }))] };
  let state = createAgenticProcess({ instanceId: 'preflight', model, scopeId: 'fixture-preflight', policyPins: agenticPolicyPins(model) });
  for (const [i, output] of outputs.entries()) {
    const occurrence = inspectAgenticProcess(state).ready[0], binding = bindings.find(row => row.id === output.operation_ref);
    const intent = { contract_version: 'process-operation-intent.v1', operation_id: 'preflight_' + i, binding_ref: binding.id, binding_sha256: shadowHash(binding),
      input_sha256: H, preconditions_sha256: H, authorization_sha256: H, authority_id: 'fixture_only', scope_id: state.scope_id, instance_id: state.instance_id,
      instance_sha256: state.instance_sha256, model_sha256: state.model_sha256, occurrence_id: occurrence, instance_revision: state.revision };
    state = advanceAgenticProcess(state, { event_id: 'intent_' + i, kind: 'operation_intent', occurrence_id: occurrence, intent });
    const receipt = { contract_version: 'process-operation-receipt.v1', receipt_id: 'receipt_' + i, operation_id: intent.operation_id,
      intent_sha256: shadowHash(intent), authority_id: intent.authority_id, outcome: output.outcome, effect_status: output.effect_status, output_sha256: shadowHash(output),
      facts: output.facts, evidence_refs: [{ ref: 'fixture:actual-output/' + i, sha256: shadowHash(output) }] };
    state = advanceAgenticProcess(state, { event_id: 'result_' + i, kind: 'operation_result', occurrence_id: occurrence, receipt });
  }
  const sim = simulateAgenticProcess({ instanceId: state.instance_id, model, scopeId: state.scope_id, policyPins: state.policy_pins, events: state.events });
  assert.equal(sim.trace.at(-1).instance_sha256, state.instance_sha256); assert.deepEqual(sim.trace.at(-1).cursor, inspectAgenticProcess(state));
  return state;
}
try {
  const f = await fixture(), original = snapshot(f), product = fs.readFileSync(path.join(f.root, 'fixture-product.txt'));
  let prepared = await f.port.prepare(f.instance, f.input); assert.equal(prepared.can_apply, true);
  save(f, 'initial', { fixture: f.saved, prepared, original });
  await test(mode + ': fresh and cold preparation authenticate fixture source through real local/remote Git ports', async () => {
    assert.equal(cold(f, 'reopen').can_apply, true); assert.deepEqual(snapshot(f), original);
    assertProjectionScope(f);
    assert.throws(() => f.push.observeOwned(f.p.head_branch, { assertLocal: true }));
    assert.throws(() => f.push.observeOwned(f.p.head_branch, { clean: true, approved_paths: f.names }));
  });
  if (!positiveOnly) {
    for (const kind of grantOnly ? [] : ['provider', 'event', 'source', 'prefix', 'product', ...projectionCases, ...canonicalCases, 'foreign', 'index', 'head', 'ref', 'remote', 'index-lock', 'ref-lock', 'head-lock', 'packed-lock']) {
      await test(mode + ': before-effect ' + kind + ' refuses without owned CAS', async () => {
        prepared = await f.port.prepare(f.instance, f.input); assert.equal(prepared.can_apply, true);
        const restore = mutate(f, kind), before = snapshot(f); let result, error;
        try { result = await f.port.apply(f.instance, prepared, { write: true, expectPlan: prepared.plan_sha256, assertAuthorized() {} }); } catch (cause) { error = cause; }
        save(f, 'before-' + kind, { kind, result: result ?? null, error: error?.code ?? error?.message ?? null });
        assert.ok(error || result?.outcome === 'blocked');
        assert.ok(Date.now() - prepared.plan.prepared_at_ms < 300000, 'fault must not be explained by plan expiry');
        assert.notEqual(error?.code ?? result?.observations?.reason_code, 'STANDARD_PR_CORRECTION_EXPLICIT_WRITE_REQUIRED');
        if (result) assert.equal(result.effect_status, 'no_effect');
        assert.deepEqual(snapshot(f), before); assert.equal(f.artifacts.ownerPending(), false);
        restore(); assert.deepEqual(snapshot(f), original);
        assertProjectionScope(f);
      });
    }
    if (!grantOnly) await test(mode + ': provider wait retains owner, concurrent/cold observer waits, cancellation releases only before-effect owner', async () => {
      prepared = await f.port.prepare(f.instance, f.input);
      let release, entered; const waiting = new Promise(resolve => { release = resolve; }), atWait = new Promise(resolve => { entered = resolve; });
      f.state.beforeReview = async () => { entered(); await waiting; };
      const abort = new AbortController();
      const pending = f.port.apply(f.instance, prepared, { write: true, expectPlan: prepared.plan_sha256, assertAuthorized() {}, signal: abort.signal });
      await atWait;
      assert.equal((await f.port.prepare(f.instance, f.input)).can_apply, false);
      assert.equal(cold(f, 'reopen').can_apply, false);
      abort.abort(); release(); await assert.rejects(pending, { code: 'STANDARD_PR_CORRECTION_ABORTED' });
      f.state.beforeReview = null; assert.deepEqual(snapshot(f), original); assert.equal(f.artifacts.ownerPending(), false);
    });
    await test(mode + ': a changed prior receipt at the same prefix is refused before the first CAS', async () => {
      prepared = await f.port.prepare(f.instance, f.input);
      assert.equal(prepared.can_apply, true);
      const prior = signer.seal({ receipt: { outcome: 'completed' } });
      const remoteHead = git(f.remoteRoot, 'rev-parse', 'refs/heads/' + f.p.head_branch);
      let observations = 0;
      f.state.verifyHistory = () => signer.verify(prior);
      f.state.afterOwnedObservation = () => {
        if (++observations === 2) prior.receipt.outcome = 'blocked';
      };
      try {
        const result = await f.port.apply(f.instance, prepared, { write: true, expectPlan: prepared.plan_sha256, assertAuthorized() {} });
        assert.equal(observations, 2);
        assert.equal(f.state.prefix, f.instance.instance_sha256);
        assert.equal(result.outcome, 'blocked');
        assert.equal(result.effect_status, 'no_effect');
        assert.equal(result.observations.reason_code, 'PROCESS_JOURNAL_NOT_AUTHENTICATED');
        assert.deepEqual(result.observations.committed, []);
        assert.deepEqual(snapshot(f), original);
        assert.equal(f.artifacts.ownerPending(), false);
        assert.equal(git(f.remoteRoot, 'rev-parse', 'refs/heads/' + f.p.head_branch), remoteHead);
      } finally {
        f.state.verifyHistory = null;
        f.state.afterOwnedObservation = null;
      }
    });
    await test(mode + ': grant revoked during provider await is rechecked before the first CAS', async () => {
      prepared = await f.port.prepare(f.instance, f.input); let revoked = false, observed = false;
      f.state.beforeReview = async () => { if (!f.state.readingSource) { observed = true; revoked = true; } };
      const result = await f.port.apply(f.instance, prepared, { write: true, expectPlan: prepared.plan_sha256,
        assertAuthorized() { if (revoked) throw Object.assign(Error('revoked during provider'), { code: 'FIXTURE_GRANT_REVOKED' }); } });
      save(f, 'provider-grant-revoked', { prepared, output: result, observed });
      assert.equal(observed, true); assert.equal(result.outcome, 'blocked'); assert.equal(result.effect_status, 'no_effect');
      assert.equal(result.observations.reason_code, 'FIXTURE_GRANT_REVOKED'); assert.deepEqual(snapshot(f), original);
      assert.equal(f.artifacts.ownerPending(), false); f.state.beforeReview = null;
    });
  }
  if (!grantOnly) {
  let output, checkpointInput, checkpointPlan;
  await test(mode + ': all three exact postimages complete, strict push still refuses dirty checkout', async () => {
    prepared = await f.port.prepare(f.instance, f.input); assert.equal(prepared.can_apply, true);
    output = await f.port.apply(f.instance, prepared, { write: true, expectPlan: prepared.plan_sha256, assertAuthorized() {} });
    save(f, 'reopen-result', { prepared, output });
    assert.equal(output.outcome, 'completed', JSON.stringify(output)); assert.equal(output.effect_status, 'confirmed');
    assert.equal(output.observations.postimages.length, 3); assert.deepEqual(snapshot(f), output.observations.postimages);
    assert.equal(f.artifacts.ownerPending(), false); assert.equal(git(f.root, 'rev-parse', 'HEAD'), f.p.head_oid);
    assert.match(f.artifacts.read(f.names[0]).content, /closure report retained verbatim/);
    assert.match(f.artifacts.read(f.names[0]).content, /completion retained verbatim/);
    assert.match(f.artifacts.read(f.names[1]).content, /^active_cycle: none$/m);
    assert.deepEqual(fs.readFileSync(path.join(f.root, 'fixture-product.txt')), product);
    assertProjectionScope(f);
    if (mode !== 'db-only') {
      assert.throws(() => f.push.inspect(f.p.head_branch), { code: 'WORKFLOW_PUSH_LOCAL_CONTEXT_BLOCKED' });
      await assert.rejects(f.push.push({ branch: f.p.head_branch }, { write: true, assertAuthorized() {} }), { code: 'WORKFLOW_PUSH_LOCAL_CONTEXT_BLOCKED' });
    } else assert.equal(git(f.root, 'status', '--porcelain'), '');
    const admission = await preWriteAdmit({ targetRoot: f.root, skill: 'start-session', nativeRequest: { tool_name: 'apply_patch', cwd: f.root,
      tool_input: { command: '*** Begin Patch\n*** Add File: correction.txt\n+unauthorized\n*** End Patch' } } });
    assert.equal(admission.write_decision.outcome, 'deny'); assert.equal(fs.existsSync(path.join(f.root, 'correction.txt')), false);
  });
  await test(mode + ': accepted fixture reopening prepares in new Node and applies actual metadata checkpoint', async () => {
    checkpointInput = acceptFixtureReopen(f, prepared, output);
    checkpointPlan = cold(f, 'checkpoint', checkpointInput); assert.equal(checkpointPlan.can_apply, true);
    const before = snapshot(f), count = git(f.root, 'rev-list', '--count', 'HEAD');
    const result = await f.checkpoint.apply(f.instance, checkpointPlan, { write: true, expectPlan: checkpointPlan.plan_sha256, assertAuthorized() {} });
    save(f, 'checkpoint-result', { fixture: f.saved, input: checkpointInput, prepared: checkpointPlan, output: result });
    assert.equal(result.outcome, 'completed', JSON.stringify(result)); assert.deepEqual(snapshot(f), before);
    assert.equal(Number(git(f.root, 'rev-list', '--count', 'HEAD')) - Number(count), mode === 'db-only' ? 0 : 1);
    assert.equal(git(f.remoteRoot, 'rev-parse', 'refs/heads/' + f.p.head_branch), f.p.head_oid);
    const head = git(f.root, 'rev-parse', 'HEAD'), state = replay([output, result]); assert.equal(inspectAgenticProcess(state).status, 'COMPLETED');
    save(f, 'reducer', { instance: state, proof: 'tiny-preflight-IR-fixture-receipts-actual-outputs', production_dispatcher: 'NOT_RUN' });
    assert.equal(git(f.root, 'rev-parse', 'HEAD'), head); assert.deepEqual(snapshot(f), before);
    assertProjectionScope(f);
  });
  if (!positiveOnly) {
    for (const kind of ['provider', 'event', 'source', 'prefix', 'product', ...projectionCases, ...canonicalCases, 'foreign', 'index', 'head', 'ref', 'remote', 'index-lock', 'ref-lock', 'head-lock', 'packed-lock', 'owner', 'grant', 'cancel']) {
      await test(mode + ': after-first-CAS ' + kind + ' retains UNKNOWN/owner and cold refusal', async () => {
        const partial = await fixture(), p = await partial.port.prepare(partial.instance, partial.input), controller = new AbortController(); let mutated = false;
        const result = await partial.port.apply(partial.instance, p, { write: true, expectPlan: p.plan_sha256, signal: controller.signal,
          assertAuthorized() { if (!mutated && partial.artifacts.read(p.plan.changes[0].path).sha256 === p.plan.changes[0].after_sha256) {
            mutated = true;
            if (kind === 'grant') throw Error('FIXTURE_GRANT_REVOKED');
            if (kind === 'cancel') controller.abort(); else mutate(partial, kind);
          } } });
        save(partial, 'partial-result', { fixture: partial.saved, prepared: p, output: result, kind });
        assert.equal(result.outcome, 'reconciliation_required', JSON.stringify(result)); assert.equal(result.effect_status, 'unknown');
        assert.equal(result.observations.committed.length, 1); assert.deepEqual(result.facts, {}); assert.equal(partial.artifacts.ownerPending(), true);
        const before = snapshot(partial), lock = fs.readFileSync(path.join(partial.root, '.aidn/runtime/standard-workflow/effects.lock'));
        assert.equal((await partial.port.prepare(partial.instance, partial.input)).can_apply, false); assert.equal(cold(partial, 'reopen').can_apply, false);
        assert.deepEqual(snapshot(partial), before); assert.deepEqual(fs.readFileSync(path.join(partial.root, '.aidn/runtime/standard-workflow/effects.lock')), lock);
        assertProjectionScope(partial);
        const state = replay([result]); assert.equal(inspectAgenticProcess(state).status, 'WAITING');
        save(partial, 'reducer', { instance: state, proof: 'unknown-retained-tiny-preflight-IR-fixture-receipt' });
      });
    }
  }
  }
  for (const row of notApplicable) console.log('N/A ' + mode + ': ' + row.phase + ' ' + row.probe + ': ' + row.reason);
  evidence.push({ status: 'PASS', checks, mode, positiveOnly, grantOnly, not_applicable: notApplicable, skipped: [],
    projection_scope: mode === 'db-only' ? 'detailed session absent; existing minimal anchors unchanged; canonical SQLite required; no Git commit witness' : 'physical projection required',
    proof: 'real-application-canonical-metadata-Git-SQLite-with-authenticated-fixture-triage',
    fixture_key: 'public-key127', model_calls: 0, native_client: 'NOT_RUN', provider_transport: 'FIXTURE', production_dispatcher: 'NOT_RUN',
    full_standard_workflow: false, installed_archive: 'NOT_RUN', postgres: 'NOT_RUN', roots: owned });
  console.log(JSON.stringify(evidence.at(-1)));
} finally {
  if (retain) console.log(JSON.stringify({ fixture_cleanup: 'retained', roots: owned }));
  else {
    for (const root of owned.reverse()) {
      const real = fs.realpathSync(root); assert.equal(path.dirname(real), temporary);
      assert.ok(/^aidn-(standard-fresh|correction-remote)-/.test(path.basename(real)));
      fs.rmSync(real, { recursive: true, force: true });
    }
    console.log(JSON.stringify({ fixture_cleanup: 'completed' }));
  }
}
