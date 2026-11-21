import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createFreshStandardWorkflowFixture } from './standard-workflow-fixture-lib.mjs';
import { createStandardWorkflowArtifacts } from '../../src/application/runtime/standard-workflow-artifacts.mjs';
import { createStandardWorkflowOperationHost } from '../../src/application/runtime/standard-workflow-operation-host.mjs';
import { standardWorkflowOperationBindings } from '../../src/application/runtime/standard-workflow-operations.mjs';
import { createStandardHandoffContext } from '../../src/application/runtime/standard-handoff-context.mjs';
import { assertHandoffContext } from '../../src/core/workflow/standard-handoff-context.mjs';
import { resolveRuntimeSqliteFile } from '../../src/application/runtime/runtime-persistence-service.mjs';
import { shadowHash as H } from '../../src/core/workflow/shadow-json.mjs';

const mode = process.argv[2] ?? 'files'; assert(['files', 'dual', 'db-only'].includes(mode)); assert.equal(process.argv.length, 3);
const owned = [], root = createFreshStandardWorkflowFixture(mode, owned), artifacts = createStandardWorkflowArtifacts({ targetRoot: root });
const contents = { 'CURRENT-STATE.md': '# Current state\nmode: COMMITTING\nbranch_kind: cycle\nactive_session: S001\nactive_cycle: C001\ndor_state: READY\nfirst_plan_step: Preserve canonical handoff context\n',
  'sessions/S001.md': '# Session\nsession_id: S001\nsession_branch: S001-handoff\nstate: OPEN\n',
  'cycles/C001-feature/status.md': '# Cycle\ncycle_id: C001\nstate: OPEN\nsession_owner: S001\nbranch_name: C001-feature\n',
  'cycles/C001-feature/plan.md': '# Plan\n- Preserve the current checkpoint.\n' };
async function write(changes) {
  await artifacts.withLocalEffectOwner(H(changes), () => {
    const receipts = Object.entries(changes).map(([name, after]) => ({ name, after, result: artifacts.compareAndSwapPreservingMetadata({ path: name,
      before_sha256: artifacts.read(name).sha256, before_metadata_sha256: artifacts.metadataHash(name), after }) }));
    artifacts.project(Object.keys(changes));
    for (const row of receipts) {
      assert.equal(artifacts.read(row.name).sha256, createHash('sha256').update(row.after).digest('hex'));
      assert.equal(artifacts.metadataHash(row.name), row.result.metadata_sha256);
      if (mode === 'dual') assert.equal(fs.readFileSync(path.join(root, 'docs/audit', row.name), 'utf8'), row.after);
    }
    return { effect_status: 'confirmed' };
  });
}
await write(contents);
const binding = standardWorkflowOperationBindings().find(row => row.id === 'context_reload');
const model = { contract_version: 'agentic-process-model.v2', model_id: 'handoff-context-component', revision: 1,
  participants: [{ id: 'project' }], roles: [], policies: [], entry: 'observe', operation_pins: { context_reload: H(binding) },
  nodes: [{ id: 'observe', kind: 'operation', participant_ref: 'project', binding_ref: 'context_reload' }] };
const host = createStandardWorkflowOperationHost({ targetRoot: root, model, readSigningKey: () => Buffer.alloc(32, 119), authorize: async () => null });
for (const instanceId of ['context-case', 'other-case']) {
  const preview = host.initialize({ instanceId }); host.initialize({ instanceId, write: true, expectedResultSha256: preview.record.instance_sha256 });
}
const readCurrent = () => host.inspect('context-case').record;
const observer = createStandardHandoffContext({ targetRoot: root, readCurrent });
const sha = b => createHash('sha256').update(b).digest('hex');
function tree() {
  const rows = {}; const walk = at => {
    for (const row of fs.readdirSync(at, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const file = path.join(at, row.name), key = path.relative(root, file);
      if (row.isSymbolicLink()) rows[key] = 'LINK:' + fs.readlinkSync(file);
      else if (row.isDirectory()) { rows[key + path.sep] = 'DIRECTORY'; walk(file); }
      else rows[key] = sha(fs.readFileSync(file));
    }
  }; walk(root); return rows;
}
let checks = 0;
function readonly(name, run) { const before = tree(), value = run(); assert.deepEqual(tree(), before, name); checks++; console.log('PASS ' + name); return value; }
const initial = readonly('actual canonical backend selects exact session, cycle, plan, content and metadata without writes', () => {
  const value = observer.inspect(); assertHandoffContext(value);
  assert.equal(value.state_mode, mode); assert.equal(value.canonical_source, mode === 'files' ? 'files' : 'sqlite');
  assert.equal(value.instance_sha256, readCurrent().instance_sha256); assert.equal(value.current.active_session, 'S001');
  assert.deepEqual(value.selected, { session_path: 'sessions/S001.md', cycle_status_path: 'cycles/C001-feature/status.md', cycle_plan_path: 'cycles/C001-feature/plan.md' });
  for (const [name, content] of Object.entries(contents)) {
    const row = value.documents.find(row => row.path === name); assert.equal(row.sha256, sha(Buffer.from(content)));
    assert.equal(row.metadata_sha256, artifacts.metadataHash(name));
  }
  for (const name of ['permits_effects', 'permits_handoff', 'complete_resource_closure', 'written']) assert.equal(value[name], false);
  return value;
});
readonly('context and process identity are stable over independent unchanged reads', () => assert.deepEqual(observer.inspect(), initial));
readonly('closed data contract refuses extra permission, missing canonical rules and altered fingerprints', () => {
  for (const change of [v => { v.permits_handoff = true; }, v => { v.permits_effects = true; }, v => { v.complete_resource_closure = true; },
    v => { v.documents = v.documents.filter(row => row.path !== 'SPEC.md'); }, v => { v.documents[0].sha256 = H('foreign'); },
    v => { v.selected.session_path = 'sessions/foreign.md'; }]) {
    const value = structuredClone(initial); change(value); assert.throws(() => assertHandoffContext(value), { code: 'STANDARD_HANDOFF_CONTEXT_INVALID' });
  }
});
if (mode !== 'files') {
  const visible = path.join(root, 'docs/audit/CURRENT-STATE.md'), before = fs.readFileSync(visible);
  fs.writeFileSync(visible, '# Stale projection\nactive_session: S999\n');
  readonly('stale visible CURRENT-STATE cannot replace canonical database context', () => assert.deepEqual(observer.inspect(), initial));
  fs.writeFileSync(visible, before);
  // Isolate the canonical artifact refusal from the upstream process-store
  // refusal: its prefix was authenticated immediately before taking the DB
  // away, and cannot establish permission or replace the missing documents.
  const authenticatedPrefix = readCurrent();
  const unavailable = createStandardHandoffContext({ targetRoot: root, readCurrent: () => authenticatedPrefix });
  const database = path.resolve(resolveRuntimeSqliteFile({ targetRoot: root })), temporary = database + '.fixture-unavailable';
  assert(database.startsWith(path.resolve(root) + path.sep)); assert(!fs.existsSync(temporary));
  fs.renameSync(database, temporary);
  try { readonly('unavailable canonical database refuses despite available visible documents', () => assert.throws(() => unavailable.inspect(), { code: 'STANDARD_CANONICAL_STORE_UNAVAILABLE' })); }
  finally { fs.renameSync(temporary, database); }
}
const normalizedCurrent = contents['CURRENT-STATE.md'].replace('active_session: S001', 'Active Session: `S001`').replace('active_cycle: C001', 'Active Cycle: `C001`');
await write({ 'CURRENT-STATE.md': normalizedCurrent });
readonly('canonical spaced labels and quoted values select the same exact session and cycle', () => {
  const value = observer.inspect(); assert.deepEqual(value.selected, initial.selected); assert.deepEqual(value.current, initial.current);
  assert.notEqual(value.context_sha256, initial.context_sha256, 'raw canonical document fingerprints remain distinct');
  assert.equal(value.documents.find(row => row.path === 'CURRENT-STATE.md').sha256, sha(Buffer.from(normalizedCurrent)));
});
await write({ 'CURRENT-STATE.md': contents['CURRENT-STATE.md'].replace('active_session: S001', 'Active Session:').replace('active_cycle: C001', 'Active Cycle:') });
readonly('explicitly empty canonical owner fields remain unknown without selecting a document', () => {
  const value = observer.inspect(); assert.equal(value.current.active_session, 'unknown'); assert.equal(value.current.active_cycle, 'unknown');
  assert.deepEqual(value.selected, { session_path: null, cycle_status_path: null, cycle_plan_path: null });
});
await write({ 'CURRENT-STATE.md': contents['CURRENT-STATE.md'] });
await write({ 'cycles/C001-feature/plan.md': contents['cycles/C001-feature/plan.md'] + '- Retain original UNKNOWN.\n' });
readonly('canonical plan revision changes context rather than reusing a stale digest', () => assert.notEqual(observer.inspect().context_sha256, initial.context_sha256));
await write({ 'CURRENT-STATE.md': contents['CURRENT-STATE.md'].replace('active_session: S001', 'active_session: S999') });
readonly('missing canonical active session refuses instead of selecting another session', () => assert.throws(() => observer.inspect(), { code: 'STANDARD_HANDOFF_CONTEXT_SESSION_REQUIRED' }));
await write({ 'CURRENT-STATE.md': contents['CURRENT-STATE.md'] });
readonly('different authenticated process between captures refuses without modifying either instance', () => {
  let count = 0;
  const changed = createStandardHandoffContext({ targetRoot: root, readCurrent: () => host.inspect(++count === 1 ? 'context-case' : 'other-case').record });
  assert.throws(() => changed.inspect(), { code: 'STANDARD_HANDOFF_CONTEXT_CHANGED' });
});
console.log(JSON.stringify({ status: 'PASS', checks, mode, root, scope: 'ACTUAL_CANONICAL_HANDOFF_CONTEXT_READER_COMPONENT',
  actual_canonical_store_signer_process_and_CAS: true, actual_mixed_method: 'SEPARATE_FIXTURE_REQUIRED', packet_writer_admission_resource_closure: 'NOT_PROVEN',
  genuine_Native_Human_installed_full_STANDARD: 'NOT_RUN' }));
