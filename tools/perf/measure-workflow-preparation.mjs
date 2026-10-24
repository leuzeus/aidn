#!/usr/bin/env node
// Manual source-fixture benchmark. No model, shared relay or installed client.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createTrackedFixtureFilter, removePathWithRetry } from './test-git-fixture-lib.mjs';
import { isActivationFixtureSource, prepareActivationFixture } from './test-activation-fixture-lib.mjs';
import { resolveRuntimeProjectContext } from '../../src/application/runtime/runtime-project-context-service.mjs';
import { writeWorkflowAdapterConfig } from '../../src/lib/config/workflow-adapter-config-lib.mjs';
import { parseArgs } from '../codex/workflow-step.mjs';
import { resolveCliEffectClass } from '../../src/core/cli/effect-policy.mjs';
import { validateJsonSchema } from '../../src/core/contracts/json-schema-validator.mjs';
import transactionSchema from '../../src/core/contracts/cli-output/codex-workflow-step-agent-compact.v2.schema.json' with { type: 'json' };

const repo = path.resolve(import.meta.dirname, '../..');
const arg = (name, fallback) => process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : fallback;
const samples = Number(arg('--samples', '3'));
assert(Number.isSafeInteger(samples) && samples >= 1 && samples <= 20);
const out = arg('--out', '');
if (out) assert(path.isAbsolute(out) && !fs.existsSync(out), 'Use a new absolute output file');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aidn-preparation-'));
const target = path.join(root, 'client');
const hash = value => createHash('sha256').update(value).digest('hex');
const run = (exe, args, cwd = target) => {
  const result = spawnSync(exe, args, { cwd, encoding: 'utf8', windowsHide: true, timeout: 120000, maxBuffer: 16 * 1024 * 1024 });
  assert(!result.error, result.error?.message);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result;
};
const cli = args => run(process.execPath, [path.join(repo, 'bin/aidn.mjs'), ...args.slice(0, 2), '--target', target, ...args.slice(2)], repo);
const variants = {
  historical: ['--view', 'agent'],
  compact_grouped: ['--view', 'agent', '--grouped', '--projection-profile', 'compact.v2'],
  scoped_grouped: ['--view', 'agent', '--grouped', '--projection-profile', 'compact.v2', '--context-profile', 'token-efficiency.v1'],
  ...(process.argv.includes('--include-transaction') ? { transaction: ['--transaction'] } : {}),
};
const sourceCommit = run('git', ['rev-parse', 'HEAD'], repo).stdout.trim();
const sourceDiff = hash(run('git', ['diff', 'HEAD'], repo).stdout);
try {
  const source = path.join(repo, 'tests/fixtures/repo-installed-core'), tracked = createTrackedFixtureFilter(source, repo);
  fs.cpSync(source, target, { recursive: true, filter: file => tracked(file) && isActivationFixtureSource(source, file, { freshContext: true }) });
  for (const args of [['init', '-b', 'test/preparation'], ['config', 'user.name', 'AIDN fixture'], ['config', 'user.email', 'fixture@example.invalid'],
    ['add', 'docs', '.aidn/config.json'], ['commit', '-m', 'fixture']]) run('git', args);
  prepareActivationFixture(target, repo);
  fs.writeFileSync(path.join(target, '.aidn/config.json'), JSON.stringify({ version: 1, runtime: { stateMode: 'files', indexStoreMode: 'dual-sqlite' } }));
  for (const name of ['CURRENT-STATE.md', 'RUNTIME-STATE.md']) {
    const file = path.join(target, 'docs/audit', name);
    fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace(/^runtime_state_mode:.*$/m, 'runtime_state_mode: files'));
  }
  fs.unlinkSync(path.join(target, 'docs/audit/HANDOFF-PACKET.md'));
  const content = '## Required\nPreserve every admission, scope and revision check.\n';
  fs.writeFileSync(path.join(target, 'docs/audit/PERF-AUTHORITY.md'), content);
  const scope = resolveRuntimeProjectContext({ targetRoot: target });
  const adoption = JSON.parse(fs.readFileSync(path.join(repo, 'package/governance/gfd-adoption.v1.json')));
  adoption.scope = 'installed-project'; adoption.adoptionId = 'synthetic-preparation-benchmark';
  adoption.authorities = [{ id: 'fixture-authority', reference: 'PERF-AUTHORITY.md', role: 'synthetic fixture authority', scope: 'synthetic project', owner: 'project_owner', status: 'effective', effectiveFrom: '2026-10-02' }];
  adoption.sections = [{ id: 'fixture-context', disposition: 'adapted', rationale: 'Synthetic fixture only', responsibility: 'project_owner', authorities: ['fixture-authority'], controls: [] }];
  adoption.extensions = { ...adoption.extensions,
    contextUnits: [{ id: 'required', path: 'PERF-AUTHORITY.md', heading: '## Required', sourceSha256: hash(content), authority: 'fixture-authority', status: 'effective', scope: { project_id: scope.project_id, workspace_id: '*', worktree_id: '*' }, requires: [] }],
    taskContextPolicies: { schemaVersion: 1, mandatory: ['required'], skills: Object.fromEntries(['context-reload', 'branch-cycle-audit'].map(skill => [skill, { mandatory: [], optional: [], rules: [] }])) } };
  writeWorkflowAdapterConfig(target, { governanceAdoption: adoption });
  cli(['perf', 'index', '--store', 'sqlite', '--with-content', '--json']);
  const rows = [], decisions = new Map();
  // Rotate execution order; each variant sees the same unchanged canonical input.
  for (let sample = 0; sample < samples; sample++) {
    const entries = Object.entries(variants);
    for (let offset = 0; offset < entries.length; offset++) {
      const [variant, flags] = entries[(sample + offset) % entries.length];
      const started = performance.now();
      const result = cli(['codex', 'workflow-step', '--skills', 'context-reload,branch-cycle-audit', '--json', ...flags]);
      const elapsed = performance.now() - started, payload = JSON.parse(result.stdout);
      assert.equal(payload.ok, true, JSON.stringify(payload));
      const decision = { admissions: payload.admissions.map(a => ({ skill: a.skill, ok: a.ok, status: a.admission_status, blockers: a.blocking_reasons })),
        recommendation: payload.next_action.recommendation };
      if (decisions.size) assert.deepEqual(decision, decisions.values().next().value);
      decisions.set(variant, decision);
      if (payload.bundle_budget) assert.equal(payload.bundle_budget.total_bytes, Buffer.byteLength(JSON.stringify(payload)));
      if (variant === 'transaction') {
        assert.deepEqual(validateJsonSchema(payload, transactionSchema, '$'), []);
        assert.equal(payload.transaction.source_revision, payload.observation.source_revision);
        assert.equal(payload.transaction.write_authorization, false);
        assert.equal(payload.receipt, null);
        assert.equal(payload.effect_class, 'read-only');
        assert.equal(payload.bundle_budget.target_bytes, 16384);
        assert.equal(payload.bundle_budget.hard_limit_bytes, 65536);
      }
      rows.push({ variant, sample, elapsed_ms: elapsed, stdout_bytes: Buffer.byteLength(result.stdout), json_bytes: Buffer.byteLength(JSON.stringify(payload)),
        admission_count: payload.summary.admission_count, hydration_count: payload.summary.hydrate_count,
        distinct_canonical_reads: payload.observation?.distinct_reads ?? null, oracle: 'decision-parity-pass' });
    }
  }
  const controls = [];
  let native = null;
  if (process.argv.includes('--execute-native')) {
    const { measureNativeWorkflowPreparation } = await import('../verify/workflow-preparation-native-probe.mjs');
    native = await measureNativeWorkflowPreparation({ binary: arg('--binary', ''), sourceHome: arg('--codex-home', ''),
      output: arg('--native-output', ''), variants: { ...variants, historical_microsteps: null }, cli, samples: Number(arg('--native-samples', '2')) });
  }
  if (variants.transaction) {
    assert.equal(resolveCliEffectClass('aidn codex workflow-step', ['--transaction', '--json']), 'read-only');
    assert.equal(resolveCliEffectClass('aidn codex workflow-step', ['--transaction', '--write', '--json']), 'mutating');
    for (const flags of [['--view', 'full'], ['--projection-profile', 'compact.v1'], ['--history-view', 'full']])
      assert.throws(() => parseArgs(['--skills', 'context-reload', '--transaction', ...flags]), /conflicts/);
    controls.push('transaction preset and effect classification reject incompatible full selectors');
    const cache = path.join(target, '.aidn/runtime/context/hydrated-context.json'), previous = fs.readFileSync(cache);
    const refused = flags => {
      const result = spawnSync(process.execPath, [path.join(repo, 'bin/aidn.mjs'), 'codex', 'workflow-step', '--target', target,
        '--skills', 'context-reload', '--transaction', '--json', ...flags], { cwd: repo, encoding: 'utf8', windowsHide: true, timeout: 90000 });
      assert(!result.error, result.error?.message); assert.notEqual(result.status, 0);
      return JSON.parse(result.stdout);
    };
    const budgetRefusal = refused(['--bundle-target-bytes', '256']);
    assert.equal(budgetRefusal.bundle_budget.status, 'blocked');
    assert.equal(budgetRefusal.bundle_budget.hard_limit_bytes, 65536);
    assert.equal(refused(['--bundle-hard-limit-bytes', '65537']).code, 'WORKFLOW_STEP_FAILED');
    writeWorkflowAdapterConfig(target, { governanceAdoption: { ...adoption, extensions: {} } });
    const missing = refused([]);
    assert.equal(missing.selection_policy.mode, 'blocked'); assert.equal(missing.summary.hydrate_count, 0);
    assert.equal(missing.receipt, null); assert.deepEqual(fs.readFileSync(cache), previous);
    assert.deepEqual(validateJsonSchema(missing, transactionSchema, '$'), []);
    controls.push('strict missing-policy/budget refusals preserve cache, limits and null receipt');
  }
  const percentile = (values, q) => [...values].sort((a, b) => a - b)[Math.ceil(values.length * q) - 1];
  const report = { schema_version: 1, evidence: 'source-fixture-microbenchmark', source_commit: sourceCommit,
    source_diff_sha256: sourceDiff, node: process.version, platform: process.platform, samples,
    fixture: 'tracked activated files-mode client, two admitted skills, accepted one-unit policy', rows, controls,
    ...(native ? { native } : {}),
    benchmark_sha256: hash(fs.readFileSync(import.meta.filename)),
    summary: Object.fromEntries(Object.keys(variants).map(variant => { const rowsForVariant = rows.filter(r => r.variant === variant); return [variant, {
      elapsed_p50_ms: percentile(rowsForVariant.map(r => r.elapsed_ms), .5), elapsed_p95_ms: percentile(rowsForVariant.map(r => r.elapsed_ms), .95),
      min_ms: Math.min(...rowsForVariant.map(r => r.elapsed_ms)), max_ms: Math.max(...rowsForVariant.map(r => r.elapsed_ms)),
      json_bytes: rowsForVariant.map(r => r.json_bytes), hydration_count: rowsForVariant[0].hydration_count }]; })),
    unmeasured: { model_responses: null, input_tokens: null, cached_input_tokens: null, uncached_input_tokens: null, output_tokens: null,
      resident_tokens: null, db_transactions: null, db_round_trips: null, native_handoffs: null, native_new_context: null, product_oracle: null },
    limitations: [native ? 'Native measurements cover only the bounded preparation oracle, not full product development' : 'No native model call or token saving established',
      'Decision parity is not product acceptance', 'No live PostgreSQL or installed-package qualification in this benchmark', 'CLI clocks include startup; p95 with three samples is descriptive'] };
  if (out) { fs.mkdirSync(path.dirname(out), { recursive: true }); fs.writeFileSync(out, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' }); }
  console.log(JSON.stringify(report, null, 2));
} finally { removePathWithRetry(root); }
