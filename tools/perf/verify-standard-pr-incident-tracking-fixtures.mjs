#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createStandardPrIncidentTracking } from '../../src/application/runtime/standard-pr-incident-tracking.mjs';
import { createStandardWorkflowArtifacts } from '../../src/application/runtime/standard-workflow-artifacts.mjs';
import { createArtifactStore } from '../../src/adapters/runtime/artifact-store.mjs';
import { resolveRuntimeSqliteFile } from '../../src/application/runtime/runtime-persistence-service.mjs';
import { buildNextAidnProjectConfig } from '../../src/application/install/project-config-service.mjs';
import { writeAidnProjectConfig, readAidnProjectConfig } from '../../src/lib/config/aidn-config-lib.mjs';
import { artifactContentHash, artifactMetadataHash } from '../../src/core/workflow/artifact-compare-swap.mjs';
import { shadowHash } from '../../src/core/workflow/shadow-json.mjs';

const mode = process.argv.find(arg => arg.startsWith('--mode='))?.slice(7) ?? 'files';
assert(['files', 'dual', 'db-only'].includes(mode));
const recordOperation = 'session_pr_incident_record', resolveOperation = 'session_pr_incident_resolve';
const incidentId = 'INC-TMP-20261115-000000-op_' + 'a'.repeat(40), tracker = `incidents/${incidentId}.md`;
const instance = Object.freeze({ instance_id: 'tracking_fixture', instance_sha256: 'a'.repeat(64), scope_id: 'fixture_scope' });
const input = Object.freeze({ contract_version: 'standard-pr-incident-tracking-input.v1', origin_operation_id: 'op_' + 'a'.repeat(40) });
let checks = 0;
const retained = [];
async function scenario(label, execute) {
  const temporary = fs.realpathSync(os.tmpdir()), root = fs.mkdtempSync(path.join(temporary, 'aidn-pr-incident-tracking-'));
  const local = name => path.join(root, 'docs/audit', name), sqliteFile = resolveRuntimeSqliteFile({ targetRoot: root });
  const config = buildNextAidnProjectConfig({}, { store: mode === 'files' ? 'file' : 'dual-sqlite', stateMode: mode }, {});
  writeAidnProjectConfig(root, config);
  const writeFile = (name, content) => { fs.mkdirSync(path.dirname(local(name)), { recursive: true }); fs.writeFileSync(local(name), content); };
  function put(name, content, extra = {}) {
    if (mode === 'files') return writeFile(name, content);
    const store = createArtifactStore({ sqliteFile });
    try { store.upsertArtifact({ path: name, kind: name === tracker ? 'incident' : 'other', family: 'normative', content_format: 'utf8', content, ...extra }); }
    finally { store.close(); }
    if (mode === 'dual') writeFile(name, content);
  }
  put('notes/keep.md', 'Unrelated canonical bytes.\n');
  fs.writeFileSync(path.join(root, 'product.txt'), 'Protected product bytes.\n');
  const artifacts = createStandardWorkflowArtifacts({ targetRoot: root });
  let acceptedResolution = false, authorized = true, hook = () => {}, sourcePatch = {}, clock = Date.parse('2026-11-15T00:00:00Z');
  const source = operation => ({ contract_version: 'standard-pr-incident-tracking-source.v1', instance_id: instance.instance_id,
    scope_id: instance.scope_id, incident_id: incidentId, origin_operation_id: input.origin_operation_id,
    origin_receipt_sha256: 'b'.repeat(64), checkpoint_sha256: 'c'.repeat(64), session_id: 'S001', owner: 'human:fixture', severity: 'L2_MEDIUM',
    rule_pins: ['SPEC.md', 'WORKFLOW.md'].map(name => ({ path: name, sha256: 'd'.repeat(64) })),
    resolution: operation === recordOperation ? null : { completion_operation_id: 'op_' + 'b'.repeat(40), completion_receipt_sha256: 'e'.repeat(64),
      plan_sha256: 'f'.repeat(64), alignment_operation_id: 'op_' + 'c'.repeat(40), alignment_receipt_sha256: '1'.repeat(64) }, ...sourcePatch });
  const factory = operation => createStandardPrIncidentTracking({ targetRoot: root, operation, now: () => clock,
    readCurrent: () => instance, readSource: () => {
      if (operation === resolveOperation && !acceptedResolution) throw Object.assign(Error('No accepted fixture completion'), { code: 'FIXTURE_COMPLETION_NOT_ACCEPTED' });
      return source(operation);
    }, observeBoundary: () => shadowHash({ product: fs.readFileSync(path.join(root, 'product.txt'), 'utf8'),
      unrelated: artifacts.read('notes/keep.md').sha256, config: readAidnProjectConfig(root).data }) },
  { boundary: point => hook(point) });
  const apply = (service, prepared, options = {}) => service.apply(instance, input, prepared, { write: true, expectPlan: prepared.plan_sha256,
    assertAuthorized: () => { if (!authorized) throw Object.assign(Error('Fixture grant revoked'), { code: 'FIXTURE_REVOKED' }); }, ...options });
  const read = () => artifacts.read(tracker);
  const metadata = () => {
    if (mode === 'files') return null;
    const store = createArtifactStore({ sqliteFile });
    try { return store.getArtifact(tracker); } finally { store.close(); }
  };
  const f = { root, artifacts, local, put, read, metadata, factory, apply,
    resolve: () => { acceptedResolution = true; }, revoke: () => { authorized = false; }, allow: () => { authorized = true; },
    patch: value => { sourcePatch = value; }, advance: () => { clock += 100 * 86400000; }, boundary: value => { hook = value; } };
  let passed = false;
  try { await execute(f); passed = true; console.log('PASS ' + mode + ': ' + label); }
  catch (cause) {
    console.error(JSON.stringify({ fixture_failure: label, mode, root, owner_pending: artifacts.ownerPending(), code: cause.code ?? cause.name }));
    throw cause;
  }
  finally {
    if (passed && !artifacts.ownerPending()) {
      const resolved = fs.realpathSync(root), relative = path.relative(temporary, resolved);
      assert.equal(resolved, root); assert(!relative.startsWith('..') && !path.isAbsolute(relative));
      assert.match(path.basename(resolved), /^aidn-pr-incident-tracking-/);
      fs.rmSync(resolved, { recursive: true, force: true });
    } else retained.push({ root, passed, owner_pending: artifacts.ownerPending() });
  }
}

await scenario('actual canonical creation, explicit grant, no-age apply and no-effect replay', async f => {
  const service = f.factory(recordOperation), before = f.read(), plan = await service.prepare(instance, input);
  assert.equal(before.content, null); checks++;
  await assert.rejects(f.apply(service, plan, { write: false }), { code: 'STANDARD_PR_INCIDENT_EXPLICIT_WRITE_REQUIRED' }); checks++;
  assert.equal(f.read().content, null); checks++;
  f.revoke(); const denied = await f.apply(service, plan);
  assert.equal(denied.effect_status, 'no_effect'); assert.equal(denied.outcome, 'blocked'); assert.equal(f.read().content, null); checks++;
  f.allow(); f.advance();
  const result = await f.apply(service, plan);
  assert.equal(result.outcome, 'completed', JSON.stringify(result)); assert.equal(result.effect_status, 'confirmed');
  assert.equal(result.facts.session_pr_incident_tracking_recorded, true); assert.match(f.read().content, /^status: OPEN$/m); checks++;
  const retained = f.read();
  assert.equal((await f.apply(f.factory(recordOperation), plan)).effect_status, 'no_effect'); assert.deepEqual(f.read(), retained); checks++;
  assert.equal(fs.existsSync(f.local(tracker)), mode !== 'db-only'); checks++;
  if (mode !== 'files') { assert.equal(f.metadata().kind, 'incident'); assert.equal(f.metadata().session_id, 'S001'); checks++; }
});

await scenario('resolution requires its accepted source and preserves canonical metadata and notes', async f => {
  const service = f.factory(recordOperation); await f.apply(service, await service.prepare(instance, input));
  const recorded = f.read(), resolver = f.factory(resolveOperation);
  await assert.rejects(resolver.prepare(instance, input), { code: 'FIXTURE_COMPLETION_NOT_ACCEPTED' });
  assert.deepEqual(f.read(), recorded); checks++;
  const priorMetadata = f.metadata();
  const extra = mode === 'files' ? {} : { ...Object.fromEntries(['kind', 'family', 'subtype', 'gate_relevance', 'classification_reason',
    'session_id', 'cycle_id', 'source_mode', 'entity_confidence', 'legacy_origin', 'updated_at'].map(key => [key, priorMetadata[key]])),
    entity_confidence: 0.875, classification_reason: 'fixture-preserved-owner', updated_at: '2028-01-01T00:00:00.000Z' };
  f.put(tracker, recorded.content + '\nPreserve this existing incident note.\n', extra);
  f.resolve(); const plan = await resolver.prepare(instance, input), oldMeta = f.metadata();
  const result = await f.apply(resolver, plan);
  assert.equal(result.outcome, 'completed'); assert.equal(result.facts.session_pr_incident_resolution_verified, true);
  assert.match(f.read().content, /^status: RESOLVED$/m); assert.match(f.read().content, /Preserve this existing incident note/); checks++;
  assert.equal(artifactContentHash(f.read().content), result.observations.tracker_sha256); checks++;
  if (mode !== 'files') {
    assert.equal(f.metadata().entity_confidence, 0.875); assert.equal(f.metadata().classification_reason, oldMeta.classification_reason);
    assert.equal(f.metadata().updated_at, oldMeta.updated_at); checks++;
  }
  const after = f.read(); assert.equal((await f.apply(f.factory(resolveOperation), plan)).effect_status, 'no_effect'); assert.deepEqual(f.read(), after); checks++;
});

await scenario('known partial canonical write retains one exact preparation and finishes without rewriting metadata', async f => {
  const service = f.factory(recordOperation), plan = await service.prepare(instance, input);
  f.boundary(() => { throw Object.assign(Error('Controlled acknowledgement loss'), { code: 'FIXTURE_ACK_LOST' }); });
  const partial = await f.apply(service, plan);
  assert.equal(partial.outcome, 'blocked'); assert.equal(partial.effect_status, 'confirmed'); assert.equal(f.artifacts.ownerPending(), false); checks++;
  const content = f.read(), metaHash = f.metadata() ? artifactMetadataHash(f.metadata()) : null;
  f.boundary(() => {}); const result = await f.apply(f.factory(recordOperation), plan);
  assert.equal(result.outcome, 'completed'); assert.deepEqual(f.read(), content); checks++;
  assert.equal(f.metadata() ? artifactMetadataHash(f.metadata()) : null, metaHash); checks++;
});

await scenario('stale canonical and foreign projections cannot be overwritten or imported', async f => {
  const service = f.factory(recordOperation), plan = await service.prepare(instance, input);
  if (mode === 'files') {
    f.put(tracker, 'Foreign canonical tracker.\n'); const before = f.read();
    const result = await f.apply(service, plan); assert.equal(result.effect_status, 'no_effect'); assert.deepEqual(f.read(), before); checks++;
  } else if (mode === 'dual') {
    fs.mkdirSync(path.dirname(f.local(tracker)), { recursive: true }); fs.writeFileSync(f.local(tracker), 'Foreign visible tracker.\n');
    const result = await f.apply(service, plan); assert.equal(result.effect_status, 'no_effect'); assert.equal(f.read().content, null);
    assert.equal(fs.readFileSync(f.local(tracker), 'utf8'), 'Foreign visible tracker.\n'); checks++;
  } else {
    fs.mkdirSync(path.dirname(f.local(tracker)), { recursive: true }); fs.writeFileSync(f.local(tracker), 'Foreign visible tracker.\n');
    f.resolve(); await assert.rejects(f.factory(resolveOperation).prepare(instance, input), /STANDARD_PR_INCIDENT_RESOLUTION_REQUIRED/);
    assert.equal(f.read().content, null); assert.equal(fs.readFileSync(f.local(tracker), 'utf8'), 'Foreign visible tracker.\n'); checks++;
  }
});

await scenario('unknown canonical postimage retains the actual effect owner and original preparation', async f => {
  const service = f.factory(recordOperation), plan = await service.prepare(instance, input);
  f.boundary(() => { f.put(tracker, 'Concurrent canonical replacement.\n'); throw Object.assign(Error('Controlled foreign postimage'), { code: 'FIXTURE_FOREIGN_POSTIMAGE' }); });
  const result = await f.apply(service, plan);
  assert.equal(result.outcome, 'reconciliation_required'); assert.equal(result.effect_status, 'unknown');
  assert.equal(f.artifacts.ownerPending(), true); assert.equal(f.read().content, 'Concurrent canonical replacement.\n'); checks++;
});
console.log(JSON.stringify({ status: 'PASS', mode, checks, canonical: mode === 'files' ? 'actual files' : 'actual SQLite',
  source_and_grants: 'CONTROLLED; production Human/R09 evidence tested separately through actual host',
  native_calls: 0, new_reader_fresh_OS: 'NOT_RUN', published_R10: 'NOT_RUN', live_PostgreSQL: 'NOT_RUN', retained }));
