#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createStandardIncidentClosure } from '../../src/application/runtime/standard-incident-closure.mjs';
import { createStandardWorkflowArtifacts } from '../../src/application/runtime/standard-workflow-artifacts.mjs';
import { createArtifactStore } from '../../src/adapters/runtime/artifact-store.mjs';
import { resolveRuntimeSqliteFile } from '../../src/application/runtime/runtime-persistence-service.mjs';
import { buildNextAidnProjectConfig } from '../../src/application/install/project-config-service.mjs';
import { writeAidnProjectConfig, readAidnProjectConfig } from '../../src/lib/config/aidn-config-lib.mjs';
import { shadowHash } from '../../src/core/workflow/shadow-json.mjs';
import { artifactContentHash } from '../../src/core/workflow/artifact-compare-swap.mjs';

const mode = process.argv.find(arg => arg.startsWith('--mode='))?.slice(7) ?? 'files';
assert(['files', 'dual', 'db-only'].includes(mode));
const incidentId = 'INC-TMP-20261115-000000-fixture';
const incidentPath = `incidents/${incidentId}.md`;
const sessionPath = 'sessions/S001.md', snapshotPath = 'snapshots/context-snapshot.md';
const H = 'a'.repeat(64), instance = { instance_id: 'incident_fixture', scope_id: 'fixture_scope', instance_sha256: H };
const coldSelector = process.argv.find(arg => arg.startsWith('--closure-child='));
const coldReceipts = [];
function fixtureEvidence(subject, incidentSha, sourcePatch = {}) {
  return { contract_version: 'standard-incident-close-evidence.v1', incident_id: incidentId,
    incident_sha256: incidentSha, instance_id: subject.instance_id, scope_id: subject.scope_id, instance_sha256: subject.instance_sha256,
    checkpoint_sha256: 'b'.repeat(64), resolution_verified: true, resolution_ref: { ref: 'fixture:resolution', sha256: 'c'.repeat(64) },
    resume_confirmed: true, resume_ref: { ref: 'fixture:resume', sha256: 'd'.repeat(64) }, stop_observed: false,
    workflow_rules_changed: false, rule_authorization: null, ...sourcePatch };
}
async function runColdChild(file) {
  const temporary = fs.realpathSync(os.tmpdir()), relative = path.relative(temporary, path.resolve(file));
  assert(!path.isAbsolute(relative) && !relative.startsWith('..'));
  const parts = relative.split(path.sep);
  assert.match(parts[0], /^aidn-incident-closure-/);
  assert.equal(parts.slice(1, -1).join('/'), '.aidn/runtime/perf/incident-closure-fixture');
  assert(['preparation.json', 'tampered-preparation.json'].includes(parts.at(-1)));
  const bytes = fs.readFileSync(file), saved = JSON.parse(bytes);
  const targetRoot = path.join(temporary, parts[0]);
  assert.equal(path.resolve(saved.target_root), targetRoot);
  assert.equal(saved.fixture_version, 'incident_closure_child.v1');
  assert.equal(saved.mode, mode); assert.notEqual(process.pid, saved.parent_pid);
  assert.equal(process.ppid, saved.parent_pid);
  const controls = () => JSON.parse(fs.readFileSync(path.join(path.dirname(file), 'controls.json'), 'utf8'));
  const artifacts = createStandardWorkflowArtifacts({ targetRoot });
  const service = createStandardIncidentClosure({ targetRoot, readCurrent: () => saved.instance,
    readEvidence: ({ incident_sha256 }) => fixtureEvidence(saved.instance, incident_sha256, controls().source_patch),
    observeBoundary: () => shadowHash({ product: fs.readFileSync(path.join(targetRoot, 'product.txt'), 'utf8'),
      unrelated: artifacts.read('notes/keep.md').sha256, config: readAidnProjectConfig(targetRoot).data }) },
  { boundary: point => { if (point === controls().stop) throw Object.assign(new Error('controlled child interruption'), { code: 'FIXTURE_ACK_LOST' }); } });
  const receipt = { pid: process.pid, parent_pid: process.ppid, preparation_file_sha256: artifactContentHash(bytes),
    plan_sha256: saved.prepared.plan_sha256, state_mode: artifacts.describe().state_mode };
  try {
    receipt.result = await service.apply(saved.instance, saved.prepared, { write: true, expectPlan: saved.prepared.plan_sha256,
      assertAuthorized: () => { if (!controls().authorized) throw Object.assign(new Error('revoked fixture authority'), { code: 'FIXTURE_REVOKED' }); } });
  } catch (cause) { receipt.error = { code: cause.code ?? 'FIXTURE_CHILD_ERROR', effect_status: cause.effect_status ?? null }; }
  receipt.owner_pending = artifacts.ownerPending();
  console.log(JSON.stringify(receipt));
}
let assertions = 0;
async function scenario(label, execute) {
  const targetRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aidn-incident-closure-'));
  let successful = false;
  const local = name => path.join(targetRoot, 'docs/audit', name);
  const sqliteFile = resolveRuntimeSqliteFile({ targetRoot });
  const writeFile = (name, content) => { fs.mkdirSync(path.dirname(local(name)), { recursive: true }); fs.writeFileSync(local(name), content); };
  const config = buildNextAidnProjectConfig({}, { store: mode === 'files' ? 'file' : 'dual-sqlite', stateMode: mode }, {});
  writeAidnProjectConfig(targetRoot, config);
  function put(name, content, extra = {}) {
    if (mode === 'files') return writeFile(name, content);
    const store = createArtifactStore({ sqliteFile });
    try { store.upsertArtifact({ path: name, kind: name === sessionPath ? 'session' : name === incidentPath ? 'incident' : 'other',
      family: 'normative', content_format: 'utf8', content, ...(name === sessionPath ? { session_id: 'S001', entity_confidence: 0.75 } : {}), ...extra }); }
    finally { store.close(); }
    if (mode === 'dual') writeFile(name, content);
  }
  function document(status = 'RESOLVED', severity = 'L2_MEDIUM') {
    return `incident_id: ${incidentId}\nstatus: ${status}\nlifecycle_status: closed\nseverity: ${severity}\nsession: S001\nowner: fixture\n`;
  }
  const originals = { [incidentPath]: document(), [sessionPath]: 'session_id: S001\nstate: OPEN\n',
    [snapshotPath]: '# Context snapshot\n', 'notes/keep.md': 'Unrelated canonical data\n' };
  for (const [name, content] of Object.entries(originals)) put(name, content);
  fs.writeFileSync(path.join(targetRoot, 'product.txt'), 'Product bytes must stay unchanged.');
  const artifacts = createStandardWorkflowArtifacts({ targetRoot });
  let sourcePatch = {}, authorized = true, boundaryHook = () => {};
  const evidence = ({ incident_sha256 }) => fixtureEvidence(instance, incident_sha256, sourcePatch);
  const factory = () => createStandardIncidentClosure({ targetRoot, readEvidence: evidence,
    readCurrent: () => instance,
    observeBoundary: () => shadowHash({ product: fs.readFileSync(path.join(targetRoot, 'product.txt'), 'utf8'),
      unrelated: artifacts.read('notes/keep.md').sha256, config }),
    now: () => Date.now() - 2 * 86400000 }, { boundary: point => boundaryHook(point) });
  const consent = () => { if (!authorized) throw Object.assign(new Error('FIXTURE_REVOKED'), { code: 'FIXTURE_REVOKED' }); };
  const apply = (service, prepared, options = {}) => service.apply(instance, prepared,
    { write: true, expectPlan: prepared.plan_sha256, assertAuthorized: consent, ...options });
  let persistedPreparation;
  function coldApply(prepared, { stop = null, authorized: childAuthorized = true, tamper = false } = {}) {
    const folder = path.join(targetRoot, '.aidn/runtime/perf/incident-closure-fixture');
    const file = path.join(folder, 'preparation.json');
    if (!persistedPreparation) {
      fs.mkdirSync(folder, { recursive: true });
      const body = { fixture_version: 'incident_closure_child.v1', mode, target_root: targetRoot,
        parent_pid: process.pid, instance, prepared };
      fs.writeFileSync(file, JSON.stringify(body) + '\n', { flag: 'wx' });
      persistedPreparation = { sha256: artifactContentHash(fs.readFileSync(file)), plan_sha256: prepared.plan_sha256 };
    }
    assert.equal(prepared.plan_sha256, persistedPreparation.plan_sha256);
    assert.equal(artifactContentHash(fs.readFileSync(file)), persistedPreparation.sha256);
    fs.writeFileSync(path.join(folder, 'controls.json'), JSON.stringify({ authorized: childAuthorized, source_patch: sourcePatch, stop }) + '\n');
    let requested = file;
    if (tamper) {
      const changed = JSON.parse(fs.readFileSync(file, 'utf8'));
      changed.prepared.plan.traces[0].after += '\nforged serialized plan';
      requested = path.join(folder, 'tampered-preparation.json');
      fs.writeFileSync(requested, JSON.stringify(changed) + '\n', { flag: 'wx' });
    }
    const child = spawnSync(process.execPath, [fileURLToPath(import.meta.url), '--mode=' + mode, '--closure-child=' + requested],
      { encoding: 'utf8', stdio: 'pipe', shell: false, windowsHide: true, maxBuffer: 1048576 });
    assert.equal(child.status, 0, String(child.stderr ?? '').slice(-4096));
    assert.equal(child.signal, null);
    const output = JSON.parse(child.stdout);
    assert.equal(output.pid, child.pid); assert.notEqual(output.pid, process.pid);
    assert.equal(output.parent_pid, process.pid); assert.equal(output.state_mode, mode);
    assert.equal(output.preparation_file_sha256, artifactContentHash(fs.readFileSync(requested)));
    assert.equal(artifactContentHash(fs.readFileSync(file)), persistedPreparation.sha256);
    coldReceipts.push({ scenario: label, launch: coldReceipts.length + 1, ...output });
    return output;
  }
  const bytes = () => {
    const rows = [];
    function walk(at) { for (const entry of fs.readdirSync(at, { withFileTypes: true })) {
      const file = path.join(at, entry.name); assert(!entry.isSymbolicLink());
      if (entry.isDirectory()) walk(file); else rows.push([path.relative(targetRoot, file), artifactContentHash(fs.readFileSync(file))]);
    } }
    walk(targetRoot); return rows.sort((a, b) => a[0].localeCompare(b[0]));
  };
  try {
    await execute({ targetRoot, local, put, document, artifacts, originals, factory, apply, bytes, coldApply,
      setSource: patch => { sourcePatch = patch; }, revoke: () => { authorized = false; },
      allow: () => { authorized = true; }, hook: callback => { boundaryHook = callback; } });
    assert.equal(fs.readFileSync(path.join(targetRoot, 'product.txt'), 'utf8'), 'Product bytes must stay unchanged.');
    assert.equal(artifacts.read('notes/keep.md').content, originals['notes/keep.md']);
    assert.equal(artifacts.ownerPending(), false);
    successful = true; assertions++;
  } finally {
    if (successful) {
      assert.equal(path.dirname(path.resolve(targetRoot)), path.resolve(os.tmpdir()));
      assert.match(path.basename(targetRoot), /^aidn-incident-closure-/); fs.rmSync(targetRoot, { recursive: true, force: true });
    } else console.error(`Retained incident fixture: ${targetRoot} (${label})`);
  }
}

if (coldSelector) {
  await runColdChild(coldSelector.slice('--closure-child='.length));
} else {
await scenario('admission', async f => {
  for (const status of ['OPEN', 'AUTH_PENDING', 'DEFERRED']) {
    f.put(incidentPath, f.document(status)); const before = f.bytes();
    await assert.rejects(f.factory().prepare(instance, { incident_id: incidentId }), /STANDARD_INCIDENT_NOT_RESOLVED/);
    assert.deepEqual(f.bytes(), before); assertions++;
  }
  f.put(incidentPath, f.document('RESOLVED', 'L3_HIGH'));
  await assert.rejects(f.factory().prepare(instance, { incident_id: incidentId }), /STANDARD_INCIDENT_STOP_REQUIRED/); assertions++;
  f.setSource({ stop_observed: true, workflow_rules_changed: true });
  await assert.rejects(f.factory().prepare(instance, { incident_id: incidentId }), /STANDARD_INCIDENT_RULE_AUTHORIZATION_REQUIRED/); assertions++;
  f.setSource({ stop_observed: true, workflow_rules_changed: true, rule_authorization: { ref: 'fixture:human-rule-authorization', sha256: H } });
  const before = f.bytes(), prepared = await f.factory().prepare(instance, { incident_id: incidentId });
  assert.deepEqual(f.bytes(), before); assertions++;
  const forged = structuredClone(prepared); forged.plan.foreign_permission = true;
  await assert.rejects(f.apply(f.factory(), forged), /STANDARD_INCIDENT_PLAN_INVALID/); assertions++;
  await assert.rejects(f.apply(f.factory(), prepared, { write: false }), /STANDARD_INCIDENT_EXPLICIT_EFFECT_REQUIRED/);
  assert.deepEqual(f.bytes(), before); assertions++;
  f.revoke(); const refused = await f.apply(f.factory(), prepared);
  assert.equal(refused.outcome, 'incomplete'); assert.equal(refused.effect_status, 'no_effect');
  assert.deepEqual(refused.evidence_refs, []);
  for (const name of [incidentPath, sessionPath, snapshotPath]) assert.equal(f.artifacts.read(name).sha256,
    name === incidentPath ? prepared.plan.incident_sha256 : prepared.plan.traces.find(t => t.path === name).before_sha256); assertions++;
});

for (const stop of ['after_trace_0', 'after_canonical_delete', 'none']) await scenario(stop, async f => {
  const prepared = await f.factory().prepare(instance, { incident_id: incidentId });
  let fired = false;
  f.hook(point => { if (!fired && point === stop) { fired = true; throw Object.assign(new Error('controlled interruption'), { code: 'FIXTURE_ACK_LOST' }); } });
  const first = await f.apply(f.factory(), prepared);
  assert.equal(first.outcome, stop === 'none' ? 'completed' : 'incomplete');
  assert.equal(first.effect_status, 'confirmed');
  assert.equal(first.evidence_refs.length, stop === 'after_trace_0' ? 1 : 2);
  if (stop !== 'none') assert.deepEqual(first.facts, {});
  if (stop === 'after_trace_0') assert.equal(f.artifacts.read(incidentPath).sha256, prepared.plan.incident_sha256);
  if (stop === 'after_canonical_delete') assert.equal(f.artifacts.read(incidentPath).content, null);
  assert.equal(f.artifacts.ownerPending(), false); assertions++;
  const resumed = await f.apply(f.factory(), prepared);
  assert.equal(resumed.outcome, 'completed');
  assert.equal(f.artifacts.read(incidentPath).content, null); assert.equal(fs.existsSync(f.local(incidentPath)), false);
  for (const trace of prepared.plan.traces) {
    const actual = f.artifacts.read(trace.path);
    assert.equal(actual.sha256, trace.after_sha256);
    assert.equal(actual.content.split('<!-- aidn:incident-closure:').length - 1, 1);
    if (mode === 'db-only') assert.equal(fs.existsSync(f.local(trace.path)), false);
    else assert.equal(artifactContentHash(fs.readFileSync(f.local(trace.path))), trace.after_sha256);
  }
  const replayed = await f.apply(f.factory(), prepared);
  assert.equal(replayed.outcome, 'completed'); assert.equal(replayed.effect_status, 'no_effect'); assertions += 2;
  if (mode === 'dual' && stop === 'none') {
    fs.unlinkSync(f.local(sessionPath));
    const repaired = await f.apply(f.factory(), prepared);
    assert.equal(repaired.effect_status, 'confirmed');
    assert(repaired.committed.includes('projection:' + sessionPath)); assertions++;
  }
});

await scenario('stale-plan', async f => {
  const prepared = await f.factory().prepare(instance, { incident_id: incidentId });
  f.put(sessionPath, f.originals[sessionPath] + 'Foreign canonical change\n');
  const result = await f.apply(f.factory(), prepared);
  assert.equal(result.outcome, 'incomplete'); assert.equal(result.effect_status, 'no_effect');
  assert.equal(f.artifacts.read(incidentPath).sha256, prepared.plan.incident_sha256);
  assert(f.artifacts.read(sessionPath).content.endsWith('Foreign canonical change\n')); assertions++;
});

await scenario('revoked-between-writes', async f => {
  const prepared = await f.factory().prepare(instance, { incident_id: incidentId });
  f.hook(point => { if (point === 'after_trace_0') f.revoke(); });
  const partial = await f.apply(f.factory(), prepared);
  assert.equal(partial.outcome, 'incomplete'); assert.equal(partial.effect_status, 'confirmed');
  assert.equal(partial.evidence_refs.length, 1);
  assert.equal(f.artifacts.read(snapshotPath).sha256, prepared.plan.traces[1].before_sha256);
  assert.equal(f.artifacts.read(incidentPath).sha256, prepared.plan.incident_sha256);
  f.hook(() => {}); f.allow();
  assert.equal((await f.apply(f.factory(), prepared)).outcome, 'completed'); assertions++;
});

if (mode !== 'files') await scenario('metadata-conflict', async f => {
  const prepared = await f.factory().prepare(instance, { incident_id: incidentId });
  f.put(sessionPath, f.originals[sessionPath], { classification_reason: 'foreign metadata owner' });
  const result = await f.apply(f.factory(), prepared);
  assert.equal(result.outcome, 'incomplete'); assert.equal(result.effect_status, 'no_effect');
  assert.equal(f.artifacts.read(incidentPath).sha256, prepared.plan.incident_sha256); assertions++;
});

await scenario('evidence-contract-and-binding', async f => {
  for (const [patch, reason] of [[{ resolution_verified: false }, /STANDARD_INCIDENT_EVIDENCE_INVALID/],
    [{ incident_sha256: 'f'.repeat(64) }, /STANDARD_INCIDENT_EVIDENCE_UNBOUND/],
    [{ permission: 'all' }, /STANDARD_INCIDENT_EVIDENCE_INVALID/],
    [{ scope_id: 'foreign' }, /STANDARD_INCIDENT_EVIDENCE_UNBOUND/]]) {
    f.setSource(patch); const before = f.bytes();
    await assert.rejects(f.factory().prepare(instance, { incident_id: incidentId }), reason);
    assert.deepEqual(f.bytes(), before); assertions++;
  }
});

if (mode === 'dual') await scenario('foreign-tracker-projection', async f => {
  const prepared = await f.factory().prepare(instance, { incident_id: incidentId });
  fs.writeFileSync(f.local(incidentPath), 'Foreign visible copy must be preserved.');
  const result = await f.apply(f.factory(), prepared);
  assert.equal(result.outcome, 'incomplete'); assert.equal(result.effect_status, 'confirmed');
  assert.equal(f.artifacts.read(incidentPath).content, null);
  assert.equal(fs.readFileSync(f.local(incidentPath), 'utf8'), 'Foreign visible copy must be preserved.');
  assert.deepEqual(result.facts, {});
  // Explicit fixture repair; the production service never replaces the foreign copy.
  fs.writeFileSync(f.local(incidentPath), f.originals[incidentPath]);
  assert.equal((await f.apply(f.factory(), prepared)).outcome, 'completed'); assertions++;
});


await scenario('large-trace-documents', async f => {
  f.put(sessionPath, f.originals[sessionPath] + 'x'.repeat(32768));
  const prepared = await f.factory().prepare(instance, { incident_id: incidentId });
  assert(Object.isFrozen(prepared.plan.traces[0]));
  assert(prepared.plan.traces[0].after.length > 16384);
  assert.equal((await f.apply(f.factory(), prepared)).outcome, 'completed'); assertions++;
});

await scenario('caller-mutation-after-authorization-await', async f => {
  const prepared = await f.factory().prepare(instance, { incident_id: incidentId });
  const mutable = structuredClone(prepared);
  const result = await f.factory().apply(instance, mutable, { write: true, expectPlan: prepared.plan_sha256,
    assertAuthorized: async () => { await Promise.resolve(); mutable.plan.traces[0].path = 'notes/keep.md'; } });
  assert.equal(result.outcome, 'completed');
  assert.equal(f.artifacts.read(sessionPath).sha256, prepared.plan.traces[0].after_sha256);
  assert.equal(f.artifacts.read('notes/keep.md').content, f.originals['notes/keep.md']); assertions++;
});

for (const stop of ['after_trace_0', 'after_canonical_delete']) await scenario('fresh-process-' + stop, async f => {
  const prepared = await f.factory().prepare(instance, { incident_id: incidentId });
  const first = f.coldApply(prepared, { stop });
  assert.equal(first.error, undefined); assert.equal(first.result.outcome, 'incomplete');
  assert.equal(first.result.effect_status, 'confirmed'); assert.equal(first.owner_pending, false);
  const business = () => [incidentPath, sessionPath, snapshotPath].map(name => ({ path: name,
    sha256: f.artifacts.read(name).sha256, metadata: f.artifacts.metadataHash(name) }));
  const partial = business();
  const denied = f.coldApply(prepared, { authorized: false });
  assert.equal(denied.result.outcome, 'incomplete'); assert.equal(denied.result.effect_status, 'no_effect');
  assert.equal(denied.owner_pending, false); assert.deepEqual(business(), partial);
  const tampered = f.coldApply(prepared, { tamper: true });
  assert.equal(tampered.error.code, 'STANDARD_INCIDENT_PLAN_INVALID');
  assert.equal(tampered.error.effect_status, 'no_effect'); assert.equal(tampered.owner_pending, false);
  assert.deepEqual(business(), partial); assertions += 3;
  const resumed = f.coldApply(prepared);
  assert.equal(resumed.result.outcome, 'completed'); assert.equal(resumed.owner_pending, false);
  assert.equal(f.artifacts.read(incidentPath).content, null); assert.equal(fs.existsSync(f.local(incidentPath)), false);
  for (const trace of prepared.plan.traces) {
    const actual = f.artifacts.read(trace.path);
    assert.equal(actual.sha256, trace.after_sha256);
    assert.equal(actual.content.split('<!-- aidn:incident-closure:').length - 1, 1);
    assert.equal(f.artifacts.metadataHash(trace.path), trace.after_metadata_sha256);
    if (mode === 'db-only') assert.equal(fs.existsSync(f.local(trace.path)), false);
    else assert.equal(artifactContentHash(fs.readFileSync(f.local(trace.path))), trace.after_sha256);
  }
  const replayed = f.coldApply(prepared);
  assert.equal(replayed.result.outcome, 'completed'); assert.equal(replayed.result.effect_status, 'no_effect');
  assert.equal(replayed.owner_pending, false); assertions += 2;
});

console.log(JSON.stringify({ status: 'PASS', mode, assertions, storage: mode === 'files' ? 'actual-filesystem' : 'actual-SQLite',
  resources: 'actual-local-owner-fence', cold_process_receipts: coldReceipts, process_exit: 'normal-confirmed-partial-not-abrupt-crash',
  evidence_source: 'CONTROLLED_CALLBACKS', production_resolution_resume_reader: 'NOT_RUN',
  published_incident_route: 'NOT_RUN', native: 'NOT_RUN', installed_archive: 'NOT_RUN', full_standard_workflow: 'NOT_COMPLETE' }));
}
