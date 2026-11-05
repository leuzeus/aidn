import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { register } from 'node:module';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
// The delay/snapshot and clock/authority are controlled doubles. Collector,
// checkpoint, Git adapter and synchronous cache writer remain production code.
// No SQLite, actual actor or full checkpoint qualification is claimed.
if (!process.argv.includes('--child')) {
 const child = spawnSync(process.execPath, [import.meta.filename, '--child', ...process.argv.slice(2)],
  { encoding: 'utf8', windowsHide: true, timeout: 60000, maxBuffer: 1048576 });
 process.stdout.write(child.stdout ?? ''); process.stderr.write(child.stderr ?? '');
 if (child.error) throw child.error;
 process.exit(child.status ?? 1);
}
const sourceRoot = path.resolve(import.meta.dirname, '../..');
const moduleAt = name => pathToFileURL(path.join(sourceRoot, name));
const snapshotUrl = moduleAt('src/application/runtime/runtime-snapshot-service.mjs').href;
register('data:text/javascript,' + encodeURIComponent(`
export async function resolve(specifier, context, next) {
 const result = await next(specifier, context);
 if (result.url !== ${JSON.stringify(snapshotUrl)}) return result;
 return { url: 'data:text/javascript,' + encodeURIComponent(${JSON.stringify(`export * from ${JSON.stringify(snapshotUrl + '?cache-fence-original')};
export const readRuntimeSnapshot = options => globalThis.cacheFenceProbe.snapshot(options);`)}), shortCircuit: true };
}`), import.meta.url);
const { runReloadCheckUseCase } = await import(moduleAt('src/application/runtime/reload-check-use-case.mjs'));
const { runCheckpointUseCase } = await import(moduleAt('src/application/runtime/checkpoint-use-case.mjs'));
const { defaultCycleCloseHookArguments } = await import(moduleAt('src/application/runtime/cycle-close-hook-use-case.mjs'));
const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'aidn-reload-cache-fence-')));
const runtimeDir = path.join(sourceRoot, 'tools/perf');
const git = spawnSync('git', ['-C', root, '-c', 'core.hooksPath=NUL', 'init', '-b', 'fixture'], { windowsHide: true, encoding: 'utf8', timeout: 15000 });
assert.equal(git.status, 0, git.stderr);
const indexFile = path.join(root, 'index.sqlite');
// Placeholder exists only to keep checkpoint from starting an index writer.
// Snapshot authority/async delay are explicit doubles, never SQLite proof.
fs.writeFileSync(indexFile, 'controlled-snapshot-placeholder\n');
const results = [];
for (const kind of ['revoked', 'expired', 'nominal', 'preview']) {
 for (const existing of kind === 'revoked' || kind === 'expired' ? [false, true] : [false]) {
  const cache = path.join(root, `${kind}-${existing}.json`);
  const prefix = Buffer.from('{"preserved":"exact bytes and trailing space"}\r\n ');
  if (existing) fs.writeFileSync(cache, prefix);
  let active = true, clock = 100, reads = 0, authorizations = 0;
  const authorize = async () => { authorizations++; assert.equal(active, true, 'CACHE_AUTHORITY_REVOKED'); assert.ok(clock <= 300100, 'CACHE_AUTHORITY_EXPIRED'); };
  globalThis.cacheFenceProbe = { async snapshot(options) {
   reads++;
   await new Promise(resolve => setImmediate(resolve));
   if (kind === 'revoked') active = false;
   if (kind === 'expired') clock = 300101;
   return { absolute: options.indexFile, payload: { artifacts: [], cycles: [], structure_profile: { kind: 'fixture', recommended_required_artifacts: [], optional_tracked_artifacts: [] } } };
  } };
  let error = null, payload;
  try {
   if (kind === 'preview') payload = await runReloadCheckUseCase({ targetRoot: root, assertEffectAuthorized: authorize,
    args: { stateMode: 'db-only', stateModeExplicit: true, cache, indexFile, indexBackend: 'sqlite', writeCache: false } });
   else payload = await runCheckpointUseCase({ targetRoot: root, runtimeDir, completionCycleId: 'C001', assertEffectAuthorized: authorize,
    args: { ...defaultCycleCloseHookArguments(runtimeDir), stateMode: 'db-only', indexStore: 'sqlite', indexStoreExplicit: true,
     cache, indexSqliteOutput: indexFile, skipGateEvaluate: true, indexSyncCheck: false, emitSummaryEvent: false } });
  } catch (cause) { error = cause; }
  const after = fs.existsSync(cache) ? fs.readFileSync(cache) : null;
  const observation = { case: `${kind}-${existing ? 'prefix' : 'absent'}`, reads, authorizations, error: error?.message ?? null,
   before_bytes: existing ? prefix.length : null, after_bytes: after?.length ?? null, unchanged: existing ? after?.equals(prefix) === true : after === null };
  try {
   assert.equal(reads, 1);
   if (kind === 'revoked' || kind === 'expired') { assert.ok(error, 'cache effect must refuse changed authority'); assert.equal(observation.unchanged, true, 'cache bytes changed after authority refusal'); assert.equal(authorizations, 2); }
   if (kind === 'nominal') { assert.equal(error, null); assert.ok(after); assert.equal(JSON.parse(after).target_root, root); assert.equal(authorizations, 2); }
   if (kind === 'preview') { assert.equal(error, null); assert.equal(payload.cache_written, false); assert.equal(authorizations, 0); assert.equal(observation.unchanged, true); }
   observation.status = 'PASS';
  } catch (cause) { observation.status = 'FAIL'; observation.assertion = cause.message; }
  results.push(observation);
 }
}
// Ordinary CLI remains capability-free: JSON does not write, explicit cache
// intent still writes using the actual file collector without snapshot doubles.
for (const name of ['baseline/current.md', 'snapshots/context-snapshot.md', 'WORKFLOW.md', 'SPEC.md']) {
 const file = path.join(root, 'docs/audit', name); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, '# Fixture\n');
}
const cliCache = path.join(root, 'cli.json');
for (const write of [false, true]) {
 const result = spawnSync(process.execPath, [path.join(sourceRoot, 'tools/perf/reload-check.mjs'), '--target', root,
  '--state-mode', 'files', '--cache', cliCache, '--json', ...(write ? ['--write-cache'] : [])],
  { encoding: 'utf8', windowsHide: true, timeout: 15000 });
 assert.equal(result.status, 0, result.stderr); const payload = JSON.parse(result.stdout);
 assert.notEqual(payload.decision, 'stop'); assert.equal(payload.cache_written, write); assert.equal(fs.existsSync(cliCache), write);
 results.push({ case: write ? 'CLI-explicit-write' : 'CLI-json-preview', status: 'PASS' });
}
console.log(JSON.stringify({ scope: 'controlled snapshot/clock/authority doubles; real checkpoint, reload collector, Git and cache writer; no canonical storage/native actor claim', root, results }, null, 2));
process.exitCode = results.some(row => row.status === 'FAIL') ? 1 : 0;

if (process.exitCode !== 1 && !process.argv.includes('--retain-always')) {
 assert.equal(path.dirname(root), fs.realpathSync(os.tmpdir())); assert.ok(path.basename(root).startsWith('aidn-reload-cache-fence-')); fs.rmSync(root, { recursive: true, force: true });
}
