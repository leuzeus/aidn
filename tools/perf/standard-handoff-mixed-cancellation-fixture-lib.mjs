import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { createFreshStandardWorkflowFixture } from './standard-workflow-fixture-lib.mjs';
import { createStandardWorkflowMixedHost } from '../../src/application/runtime/standard-workflow-mixed-composition.mjs';
import { standardWorkflowOperationBindings } from '../../src/application/runtime/standard-workflow-operations.mjs';
import { agenticProcessImplementationPins } from '../../src/application/runtime/agentic-process-implementation-pins.mjs';
import { createStandardWorkflowArtifacts } from '../../src/application/runtime/standard-workflow-artifacts.mjs';
import { CODEX_STARTUP_ENVIRONMENT_PROFILES } from '../../src/core/agents/codex-startup-arguments.mjs';
import { shadowHash as H } from '../../src/core/workflow/shadow-json.mjs';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
function tree(roots) {
  const rows = [];
  function walk(at, base, label) {
    for (const e of fs.readdirSync(at, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const file = path.join(at, e.name), relative = label + ':' + path.relative(base, file);
      if (e.isSymbolicLink()) rows.push([relative, 'link', fs.readlinkSync(file)]);
      else if (e.isDirectory()) { rows.push([relative, 'directory']); walk(file, base, label); }
      else rows.push([relative, 'file', sha(fs.readFileSync(file))]);
    }
  }
  roots.forEach((root, index) => walk(root, root, String(index))); return rows;
}

// Actual mixed composition, canonical stores, inventory, publisher and reducer.
// The independent seven-domain observer is controlled. No Native client starts.
export async function verifyHandoffMixedCancellation(mode) {
  const owned = [], root = createFreshStandardWorkflowFixture(mode, owned, { absentOptionalDocuments: ['HANDOFF-PACKET.md'] });
  const privateRoot = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'aidn-handoff-mixed-cancel-')); owned.push(privateRoot);
  const directories = { product: path.join(root, 'product'), control: path.join(privateRoot, 'control'), review: path.join(privateRoot, 'review'), home: path.join(privateRoot, 'home') };
  for (const dir of Object.values(directories)) fs.mkdirSync(dir);
  fs.writeFileSync(path.join(directories.product, 'app.mjs'), 'export const value = 1;\n');
  const put = (name, bytes) => { const file = path.join(privateRoot, name); fs.writeFileSync(file, bytes); return { path: file, sha256: sha(bytes) }; };
  const binding = standardWorkflowOperationBindings().find(row => row.id === 'handoff_packet_publish'); assert(binding);
  const model = { contract_version: 'agentic-process-model.v2', model_id: 'handoff-mixed-cancellation-component', revision: 1,
    participants: [{ id: 'project' }], roles: [], policies: [], entry: 'publish', operation_pins: { handoff_packet_publish: H(binding) },
    nodes: [{ id: 'publish', kind: 'operation', participant_ref: 'project', binding_ref: 'handoff_packet_publish' }] };
  const configuration = { contract_version: 'agentic-process-execution.v1', instance_id: 'handoff-mixed-cancel', target_root: root,
    implementation_sha256: agenticProcessImplementationPins().sha256, product_root: directories.product, product_files: ['app.mjs'],
    control_root: directories.control, review_root: directories.review, model: put('model.json', JSON.stringify(model)),
    criteria: put('criteria.md', 'Cancellation must stop before source verification, grant, intent, owner or packet write.\n'),
    authorities: { project: { path: path.join(root, 'AGENTS.md'), sha256: sha(fs.readFileSync(path.join(root, 'AGENTS.md'))) } },
    skills: {}, instructions: {}, activity_outputs: {}, native: { executable: process.execPath, sha256: sha(fs.readFileSync(process.execPath)),
      home: directories.home, tool_roots: [], hook_hashes: { work: ['sha256:' + 'a'.repeat(64), 'sha256:' + 'b'.repeat(64)], review: [] },
      model: 'fixture-model', effort: 'medium', startup: { mcp_server_ids: [], plugin_ids: [], app_ids: [], environment_override_names: [],
        environment_names: [...CODEX_STARTUP_ENVIRONMENT_PROFILES.worker], log_dir: directories.control, sqlite_home: directories.control } } };
  const artifacts = createStandardWorkflowArtifacts({ targetRoot: root }), seed = artifacts.read('CURRENT-STATE.md', { required: true });
  const thinking = seed.content.replace(/^mode:.*$/mi, 'mode: THINKING'); assert.notEqual(thinking, seed.content);
  await artifacts.withLocalEffectOwner(H({ fixture: 'explicit mixed THINKING setup' }), () => {
    artifacts.compareAndSwapPreservingMetadata({ path: 'CURRENT-STATE.md', before_sha256: seed.sha256, before_metadata_sha256: artifacts.metadataHash('CURRENT-STATE.md'), after: thinking });
    artifacts.project(['CURRENT-STATE.md']); return { effect_status: 'confirmed' };
  });
  let grants = 0, nativeCalls = 0, reads = 0, verifications = 0, lastSignal = null, abortDuringRead = null;
  const source = {
    async read({ request, signal }) {
      reads++; lastSignal = signal; abortDuringRead?.abort();
      return { contract_version: 'standard-handoff-resource-observation.v1', authority_id: 'fixture_handoff_discovery', request_sha256: H(request),
        observed_at_ms: Date.now(), evidence_class: 'fixture', evidence_refs: [{ ref: 'fixture:mixed-cancellation', sha256: H(request) }],
        domains: ['deterministic', 'native', 'human', 'control', 'process', 'git', 'provider'].map(domain => ({ domain, complete: true, active_resources: 0, state: 'closed', evidence_refs: [{ ref: 'fixture:' + domain, sha256: H({ request, domain }) }] })) };
    },
    async verify({ request, observation }) { verifications++; return { outcome: 'verified', authority_id: observation.authority_id, request_sha256: H(request), observation_sha256: H(observation), evidence_class: 'fixture' }; },
    assertCurrent() {},
  };
  const host = createStandardWorkflowMixedHost({ configuration, readSigningKey: () => Buffer.alloc(32, 167), handoffResourceSource: source,
    environment: { ...process.env, GIT_OPTIONAL_LOCKS: '0' }, authorize() { grants++; throw Error('UNEXPECTED_MIXED_CANCELLATION_GRANT'); } },
    { controllerFactory() { nativeCalls++; throw Error('UNEXPECTED_MIXED_CANCELLATION_NATIVE'); } });
  const initial = host.initialize({}); host.initialize({ write: true, expectedResultSha256: initial.record.instance_sha256 });
  const input = { contract_version: 'standard-handoff-publication-input.v1', next_agent_role: 'coordinator', next_agent_action: 'reanchor',
    next_agent_goal: 'Resume only from the exact cancelled preparation checkpoint.', handoff_note: 'Retain each original outcome.', from_agent_role: 'coordinator', from_agent_action: 'relay' };
  const roots = [root, privateRoot]; let checks = 0;
  const baseline = tree(roots), beforeSha = host.inspect().record.instance_sha256;
  // Positive control ensures the same real path can prepare, and that refusal
  // below cannot be mistaken for invalid configuration or missing capabilities.
  const positive = await host.step({ input }); assert.equal(positive.kind, 'operation_preview'); assert.equal(positive.preview.prepared.can_apply, true);
  assert(reads > 0 && verifications > 0); assert.deepEqual(tree(roots), baseline); checks++;
  console.log('PASS mixed handoff preview uses actual composition without grant, Native or writes');
  for (const write of [false, true]) {
    const controller = new AbortController(); controller.abort(); const before = { reads, verifications };
    await assert.rejects(host.step({ input, write, signal: controller.signal }), { code: 'STANDARD_HANDOFF_PUBLICATION_ABORTED' });
    assert.deepEqual({ reads, verifications }, before); assert.deepEqual(tree(roots), baseline); checks++;
    console.log('PASS already cancelled mixed handoff write=' + write + ' refuses before observation, staging or canonical effect');
  }
  const controller = new AbortController(); abortDuringRead = controller; const beforeVerify = verifications, beforeRead = reads;
  await assert.rejects(host.step({ input, write: true, signal: controller.signal }), { code: 'STANDARD_HANDOFF_RESOURCE_OBSERVATION_ABORTED' });
  assert.equal(lastSignal, controller.signal); assert.equal(reads, beforeRead + 1); assert.equal(verifications, beforeVerify);
  assert.deepEqual(tree(roots), baseline); assert.equal(host.inspect().record.instance_sha256, beforeSha);
  assert.equal(host.inspectAllocations(), null); assert.equal(artifacts.ownerPending(), false); assert.equal(artifacts.read('HANDOFF-PACKET.md').sha256, null);
  assert.deepEqual({ grants, nativeCalls }, { grants: 0, nativeCalls: 0 }); checks++;
  console.log('PASS cancellation during actual source await stops before verification, grant, intent, owner and packet mutation');
  return { checks, root, privateRoot, Native_calls: nativeCalls, source: 'CONTROLLED_FIXTURE', full_published_IR: 'NOT_RUN' };
}
