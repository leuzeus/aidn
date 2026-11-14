import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createFreshStandardWorkflowFixture } from './standard-workflow-fixture-lib.mjs';
import { createStandardWorkflowOperations } from '../../src/application/runtime/standard-workflow-operations.mjs';
import { createStandardWorkflowArtifacts } from '../../src/application/runtime/standard-workflow-artifacts.mjs';
import { createStandardSessionBranchIntegration } from '../../src/application/runtime/standard-session-branch-integration.mjs';
import { createStandardSessionPrAdmission } from '../../src/application/runtime/standard-session-pr-admission.mjs';
import { assertStandardOperationOutput } from '../../src/core/workflow/standard-operation-contracts.mjs';
import { validateJsonSchemaDefinition } from '../../src/core/contracts/json-schema-validator.mjs';
import { shadowHash } from '../../src/core/workflow/shadow-json.mjs';
const mode = process.argv.find(v => v.startsWith('--mode='))?.slice(7) ?? 'files';
if (!['files', 'dual', 'db-only'].includes(mode)) throw Error('FIXTURE_MODE_INVALID');
const H = 'a'.repeat(64), op = x => 'op_' + x.repeat(40), owned = [], temporary = fs.realpathSync(os.tmpdir());
const git = (root, ...args) => execFileSync('git', ['-C', root, '-c', 'core.hooksPath=NUL', ...args], { encoding: 'utf8', windowsHide: true, stdio: 'pipe' }).trim();
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
function tree(root) { const rows = []; const visit = dir => { for (const entry of fs.readdirSync(dir, { withFileTypes: true })) { const file = path.join(dir, entry.name); assert.equal(entry.isSymbolicLink(), false); if (entry.isDirectory()) visit(file); else rows.push([path.relative(root, file), hash(fs.readFileSync(file))]); if (rows.length > 15000) throw Error('FIXTURE_TREE_LIMIT'); } }; visit(root); rows.sort(([a], [b]) => a.localeCompare(b)); return { files: rows.length, sha256: hash(JSON.stringify(rows)) }; }
let checks = 0;
const test = async (name, fn) => { await fn(); checks++; console.log('PASS ' + name); };
await test('fresh private PR admission contracts use supported schema vocabulary', () => {
  for (const kind of ['input', 'output']) { const name = 'standard-session-pr-admission-' + kind + '.v1', schema = JSON.parse(fs.readFileSync(new URL('../../src/core/contracts/workflow-definition/' + name + '.schema.json', import.meta.url)));
    assert.equal(schema.$id, 'aidn://contracts/workflow-definition/' + name); assert.deepEqual(validateJsonSchemaDefinition(schema, '#', { contractKind: 'workflow-definition' }), []); }
});
await test('read-only admission facts distinguish push/open without claiming any external effect', () => {
  const output = { contract_version: 'standard-session-pr-admission-output.v1', operation_ref: 'session_pr_admit', outcome: 'completed', effect_status: 'no_effect', observations: {},
    facts: { session_pr_admitted: true, session_push_required: true, session_pr_open_required: false }, evidence_refs: [{ ref: 'aidn:session-integration/' + op('e'), sha256: H }] };
  assertStandardOperationOutput(output); assertStandardOperationOutput({ ...output, facts: { session_pr_admitted: true, session_push_required: false, session_pr_open_required: true } });
  for (const change of [x => x.effect_status = 'confirmed', x => x.facts.session_pr_open_required = true, x => x.facts.session_push_required = false, x => x.facts.merged = true, x => x.evidence_refs = []]) {
    const bad = structuredClone(output); change(bad); assert.throws(() => assertStandardOperationOutput(bad), { code: 'STANDARD_OPERATION_OUTPUT_INVALID' });
  }
  assertStandardOperationOutput({ ...output, outcome: 'blocked', facts: {}, evidence_refs: [] });
});
if (process.argv.includes('--contract-only')) { console.log(JSON.stringify({ status: 'PASS', checks, proof: 'private-contract-only', application: 'NOT_RUN' })); process.exit(0); }
try {
  const root = createFreshStandardWorkflowFixture(mode, owned), operations = createStandardWorkflowOperations({ targetRoot: root }), artifacts = createStandardWorkflowArtifacts({ targetRoot: root });
  const sessionBranch = 'S001-pr-admission', cycleBranch = 'feature/C001-pr-admission', cyclePath = 'cycles/C001-feature-pr-admission/status.md';
  let prepared = await operations.prepareSession({ session_id: 'S001', session_branch: sessionBranch, objective: 'Qualify read-only context after local delivery' });
  assert.equal((await operations.initializeSession(prepared, { write: true, expectPlan: prepared.plan_sha256 })).outcome, 'completed');
  prepared = await operations.prepareMode({ session_id: 'S001', mode: 'COMMITTING' });
  assert.equal((await operations.applyMode(prepared, { write: true, expectPlan: prepared.plan_sha256 })).outcome, 'completed');
  // Explicit fixture closure source: no actual R07 or human identity is claimed.
  // Actual creation, canonical stores, Git integration, reload and PR admission
  // remain real. The composed model authenticates the separate closure chain.
  await artifacts.withLocalEffectOwner('b'.repeat(64), async () => {
    const row = artifacts.read('sessions/S001.md', { required: true }); assert.match(row.content, /^state: OPEN$/m);
    let after = row.content.replace(/^state: OPEN$/m, 'state: CLOSED').replace(/(### Session close gate satisfied\?\r?\n)- \[ \] Yes/, '$1- [x] Yes');
    assert.notEqual(after, row.content); after += '\nsession_closure_status: completed\n';
    artifacts.compareAndSwapPreservingMetadata({ path: row.path, before_sha256: row.sha256, before_metadata_sha256: artifacts.metadataHash(row.path), after });
    artifacts.compareAndSwap({ path: cyclePath, before_sha256: null, after: 'state: DONE\nsession_owner: S001\nbranch_name: ' + cycleBranch + '\n' });
    artifacts.project([row.path, cyclePath]); return { effect_status: 'confirmed' };
  });
  git(root, 'switch', '-c', cycleBranch); git(root, 'add', '.');
  // DB-only canonical writes may have no physical postimage. Keep that real
  // no-commit/equal-HEAD case instead of exporting state or inventing a commit.
  if (git(root, 'status', '--porcelain')) git(root, 'commit', '-m', 'test: prepare explicit closed fixture delivery');
  const head = git(root, 'rev-parse', 'HEAD'), marker = path.join(root, '.git/FILTER_EXECUTED');
  fs.writeFileSync(path.join(root, '.git/info/attributes'), 'docs/audit/** filter=tripwire\n'); git(root, 'config', 'filter.tripwire.clean', 'echo forbidden >> .git/FILTER_EXECUTED; cat'); git(root, 'config', 'filter.tripwire.required', 'true');
  execFileSync('git', ['-C', root, 'hash-object', '--path=docs/audit/sessions/S001.md', '--stdin'], { input: 'probe\n', stdio: 'pipe', windowsHide: true }); assert.equal(fs.existsSync(marker), true); fs.unlinkSync(marker);
  const instance = { instance_id: 'fixture_pr_admission', instance_sha256: H }, names = ['sessions/S001.md', cyclePath, 'CURRENT-STATE.md', 'snapshots/context-snapshot.md'];
  let decisionPlan;
  const readSource = async () => ({ session_id: 'S001', session_path: names[0], cycle_id: 'C001', cycle_path: cyclePath, source_branch: cycleBranch, target_branch: sessionBranch,
    delivery_operation_id: op('a'), delivery_output_sha256: H, closure_operation_id: op('b'), closure_output_sha256: H, material_sha256: H, delivery_head: head,
    documents: names.map(name => ({ ref: 'audit:' + name, sha256: artifacts.read(name, { required: true }).sha256, metadata_sha256: artifacts.metadataHash(name) })) });
  const integrate = createStandardSessionBranchIntegration({ targetRoot: root, readSource, readCurrent: () => instance,
    readDecision: async () => ({ decision_operation_id: op('d'), choice: 'integrate-to-session', source_sha256: H, plan: decisionPlan }) });
  const selection = await integrate.prepareDecision(instance, { contract_version: 'standard-session-branch-integration-review-input.v1', delivery_operation_id: op('a'), closure_operation_id: op('b') }); decisionPlan = selection.plan;
  const plan = await integrate.prepare(instance, { contract_version: 'standard-session-branch-integrate-input.v1', decision_operation_id: op('d') }, op('e'));
  const integrated = await integrate.apply(instance, plan, { write: true, expectPlan: plan.plan_sha256, assertAuthorized() {} }); assert.equal(integrated.outcome, 'completed', JSON.stringify(integrated));
  let accepted = { integration_operation_id: op('e'), plan_sha256: plan.plan_sha256, plan: plan.plan, output: integrated };
  const input = { contract_version: 'standard-session-pr-admission-input.v1', integration_operation_id: op('e') }, admission = createStandardSessionPrAdmission({ targetRoot: root, readIntegration: async () => structuredClone(accepted) });
  await test('actual integration provides an unchanged context; read-only preparation preserves every project byte', async () => {
    const before = tree(root); assert.equal((await admission.prepare(instance, input)).can_apply, true); assert.deepEqual(tree(root), before); assert.equal(fs.existsSync(marker), false);
  });
  await test('actual reload and PR admission re-anchor on the session branch with no filter, cache, canonical or Git write', async () => {
    const before = tree(root), result = await admission.observe(instance, input); assert.equal(result.outcome, 'completed', JSON.stringify(result)); assertStandardOperationOutput(result);
    assert.deepEqual(result.facts, { session_pr_admitted: true, session_push_required: true, session_pr_open_required: false });
    assert.equal(result.observations.reload.cache_written, false); assert.equal(result.observations.reload.branch, sessionBranch); assert.equal(result.observations.admission.action, 'push_session_branch');
    assert.deepEqual(tree(root), before); assert.equal(fs.existsSync(marker), false); assert.equal(artifacts.ownerPending(), false);
  });
  await test('unknown integration, ref changes and a replaced filter context cannot grant PR admission', async () => {
    const original = structuredClone(accepted); accepted.output.effect_status = 'unknown'; let before = tree(root); assert.equal((await admission.observe(instance, input)).outcome, 'blocked'); assert.deepEqual(tree(root), before); accepted = original;
    git(root, 'symbolic-ref', 'HEAD', 'refs/heads/' + cycleBranch); before = tree(root); assert.equal((await admission.observe(instance, input)).outcome, 'blocked'); assert.deepEqual(tree(root), before); git(root, 'symbolic-ref', 'HEAD', 'refs/heads/' + sessionBranch);
    git(root, 'config', 'filter.tripwire.clean', 'echo substituted >> .git/FILTER_EXECUTED; cat'); before = tree(root); assert.equal((await admission.observe(instance, input)).outcome, 'blocked'); assert.deepEqual(tree(root), before); assert.equal(fs.existsSync(marker), false);
  });
  console.log(JSON.stringify({ status: 'PASS', checks, state_mode: mode, git_integration_reload_pr_admission: 'ACTUAL', stores: mode === 'files' ? 'ACTUAL_FILES' : 'ACTUAL_SQLITE', accepted_human_and_closure_sources: 'FIXTURE', remote_effects: 0, native: 'NOT_RUN', installed_archive: 'NOT_RUN' }));
} finally { for (const root of owned.reverse()) { const real = fs.realpathSync(root); assert.equal(path.dirname(real), temporary); assert.ok(path.basename(real).startsWith('aidn-standard-fresh-')); fs.rmSync(real, { recursive: true, force: true }); } }
