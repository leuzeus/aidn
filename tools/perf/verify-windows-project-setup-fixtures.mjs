import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createSetupPlan, parseArguments, applySetup, isReusableWingetExit } from '../setup/windows-project-setup.mjs';
import { preparePostgres, validateConnections } from '../setup/windows-postgres.mjs';
import { removePathWithRetry } from './test-git-fixture-lib.mjs';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aidn-windows-setup-'));
const source = path.resolve(import.meta.dirname, '../..');
const version = fs.readFileSync(path.join(source, 'VERSION'), 'utf8').trim();
const checks = [];
const secret = 'fixture-only-password';
const runtimeUrl = `postgresql://aidn_demo:${secret}@127.0.0.1:5432/aidn_demo`;
const adminUrl = 'postgresql://postgres:fixture-admin@127.0.0.1:5432/postgres';
function treeDigest(dir) {
  const entries = [];
  function visit(current) {
    for (const item of fs.readdirSync(current, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const file = path.join(current, item.name);
      if (item.isDirectory()) visit(file);
      else entries.push([path.relative(dir, file), createHash('sha256').update(fs.readFileSync(file)).digest('hex')]);
    }
  }
  visit(dir);
  return entries;
}
try {
  const target = path.join(root, 'client espace é'); fs.mkdirSync(target);
  assert.equal(spawnSync('git', ['init', '--quiet', target], { encoding: 'utf8' }).status, 0);
  const tarball = path.join(root, 'candidate.tgz'); fs.writeFileSync(tarball, 'fixture tarball');
  const sha = createHash('sha256').update(fs.readFileSync(tarball)).digest('hex');
  const options = { target, packagePath: tarball, packageSha256: sha, postgresMode: 'existing',
    connectionEnv: 'AIDN_DEMO_PG', adminConnectionEnv: 'AIDN_SETUP_PG_ADMIN' };
  const before = treeDigest(target);
  const plan = createSetupPlan(options);
  assert.deepEqual(treeDigest(target), before);
  assert.throws(() => createSetupPlan({ ...options, packageSha256: '0'.repeat(64) }), /HASH_MISMATCH/);
  assert.throws(() => createSetupPlan({ ...options, postgresMode: 'install' }), /EXPLICIT_POSTGRES/);
  assert.throws(() => createSetupPlan({ ...options, connectionEnv: 'PATH' }), /CONNECTION_VARIABLES/);
  assert.throws(() => parseArguments(['--write', '--write']), /DUPLICATE/);
  assert.throws(() => parseArguments(['--json']), /INVALID_ARGUMENT/);
  assert(isReusableWingetExit(0x8a150061)); assert(isReusableWingetExit(0x8a15002b | 0));
  assert(!isReusableWingetExit(1)); assert(!isReusableWingetExit(null)); assert(!isReusableWingetExit(0x8a150011));
  let calls = [];
  await assert.rejects(applySetup(plan, { run: () => calls.push('unexpected') }), /WRITE_REQUIRED/);
  assert.equal(calls.length, 0);
  await assert.rejects(applySetup({ ...plan, write: true }, { platform: 'win32', env: {}, run: () => calls.push('unexpected') }), /POSTGRES_URL_INVALID/);
  assert.equal(calls.length, 0, 'missing credentials fail before npm or host mutation');
  checks.push('preview-is-local-and-read-only; explicit-write-hash-version-env-preflight');

  if (process.platform === 'win32') {
    const ps = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'RemoteSigned', '-File', path.join(source, 'scripts/setup-project.ps1'),
      '-Target', target, '-PackagePath', tarball, '-PackageSha256', sha, '-PostgresMode', 'existing'], { encoding: 'utf8', timeout: 30000 });
    assert.equal(ps.status, 0, ps.stdout + ps.stderr);
    assert(ps.stdout.includes('PREVIEW:'));
    assert.deepEqual(treeDigest(target), before);
    checks.push('actual-windows-powershell-5-preview-unicode-path-no-prompt-no-write');
  } else checks.push('SKIP: Windows PowerShell entry point (non-Windows host)');

  const installed = path.join(target, 'node_modules/aidn-workflow');
  fs.mkdirSync(installed, { recursive: true });
  fs.writeFileSync(path.join(installed, 'VERSION'), version);
  fs.writeFileSync(path.join(installed, 'package.json'), '{"name":"aidn-workflow"}');
  const env = { AIDN_DEMO_PG: runtimeUrl, AIDN_SETUP_PG_ADMIN: adminUrl };
  function runner(command, args, context) {
    assert.equal(context.env.AIDN_SETUP_PG_ADMIN, undefined);
    assert(!JSON.stringify(args).includes(secret));
    calls.push({ command, args, stage: context.stage });
    if (context.stage === 'package-install' || context.stage === 'postgres-install') assert.equal(context.env.AIDN_DEMO_PG, undefined);
    if (context.stage === 'bootstrap-preview') return JSON.stringify({ ok: true, installation_plan: { plan_id: 'reviewed' } });
    if (context.stage === 'bootstrap-apply') assert(args.includes('reviewed'));
    if (context.stage === 'diagnose') return JSON.stringify({ ok: true, activation: { active: true }, capabilities: { installation: { missing: [] } } });
    if (context.stage === 'persistence-status') return JSON.stringify({ runtime_persistence: { backend: 'postgres' }, exists: true,
      operations: { schema_status: 'ready' }, runtime_backend_adoption_plan: { action: 'noop' } });
    return '{"ok":true}';
  }
  calls = [];
  let databaseCalls = [];
  const database = async (options) => { databaseCalls.push(options); };
  const deps = { platform: 'win32', env, run: runner, database, pgFactory: () => {}, log: () => {} };
  const result = await applySetup({ ...plan, write: true }, deps);
  assert.equal(result.native, 'unverified');
  assert(!calls.some((call) => call.command === 'winget.exe'));
  assert.equal(databaseCalls[0].create, false);
  assert(calls.find((c) => c.stage === 'bootstrap-apply').args.includes('env:AIDN_DEMO_PG'));
  calls = []; databaseCalls = [];
  const local = createSetupPlan({ ...options, postgresMode: 'install', postgresVersion: '17.11-3', write: true });
  await applySetup(local, deps);
  const winget = calls.find((c) => c.command === 'winget.exe');
  assert(winget.args.includes('--interactive') && winget.args.includes('--no-upgrade') && winget.args.includes('17.11-3'));
  assert.equal(databaseCalls[0].create, true);
  calls = [];
  await assert.rejects(applySetup({ ...plan, write: true }, { ...deps, database: async () => { throw new Error(`failed ${runtimeUrl}`); } }), /POSTGRES_CONNECTION_OR_PROVISIONING_FAILED/);
  assert(!calls.some((c) => c.stage === 'bootstrap-apply'));
  await assert.rejects(applySetup({ ...plan, write: true }, { ...deps, run: (command, args, context) => context.stage === 'persistence-status'
    ? '{"runtime_persistence":{"backend":"postgres"},"exists":true,"operations":{"schema_status":"target-unavailable"}}' : runner(command, args, context) }), /POSTGRES_RUNTIME_NOT_READY/);
  calls = [];
  await assert.rejects(applySetup({ ...plan, write: true }, { ...deps, run: (command, args, context) => context.stage === 'bootstrap-preview' ? '{"ok":false}' : runner(command, args, context) }), /BOOTSTRAP_PREVIEW_REFUSED/);
  assert(!calls.some((c) => c.stage === 'bootstrap-apply'));
  const none = createSetupPlan({ ...options, postgresMode: 'none', write: true });
  calls = []; databaseCalls = [];
  await applySetup(none, deps);
  assert.equal(databaseCalls.length, 0); assert(!calls.some((c) => c.command === 'winget.exe'));
  checks.push('injected-apply-existing-local-none; exact-bootstrap-plan; no-admin-in-children; failure-stops-and-redacts; native-remains-unverified');

  let roleExists = false, dbExists = false, owner = 'aidn_demo', badRole = false, queries = [];
  const factory = () => ({ connect: async () => {}, end: async () => {}, query: async (sql, params) => {
    queries.push({ sql, params });
    if (sql === 'SHOW server_version_num') return { rows: [{ server_version_num: '170011' }] };
    if (sql.startsWith('SELECT rolname')) return { rows: roleExists ? [{ rolname: 'aidn_demo', rolsuper: badRole }] : [] };
    if (sql.startsWith('SELECT pg_get_userbyid')) return { rows: dbExists ? [{ owner }] : [] };
    if (sql.startsWith('CREATE ROLE')) { roleExists = true; return { rows: [] }; }
    if (sql.startsWith('CREATE DATABASE')) { dbExists = true; return { rows: [] }; }
    return { rows: [{ role: 'aidn_demo', database: 'aidn_demo', owner, rolsuper: badRole }] };
  } });
  await preparePostgres({ connectionString: runtimeUrl, adminConnectionString: adminUrl, create: true, expectedServerVersion: 170011 }, { clientFactory: factory });
  assert.equal(queries.filter((q) => q.sql.startsWith('CREATE ')).length, 2);
  assert(!JSON.stringify(queries).includes(secret));
  assert(queries.some((q) => q.sql.includes('SCRAM-SHA-256$')));
  queries = [];
  await preparePostgres({ connectionString: runtimeUrl, adminConnectionString: adminUrl, create: true, expectedServerVersion: 170011 }, { clientFactory: factory });
  assert(!queries.some((q) => /CREATE|ALTER|DROP/.test(q.sql)), 'retry never rotates or recreates existing resources');
  owner = 'someone_else'; queries = [];
  await assert.rejects(preparePostgres({ connectionString: runtimeUrl, adminConnectionString: adminUrl, create: true, expectedServerVersion: 170011 }, { clientFactory: factory }), /OWNER_CONFLICT/);
  assert(!queries.some((q) => q.sql.startsWith('CREATE ')));
  owner = 'aidn_demo'; badRole = true;
  await assert.rejects(preparePostgres({ connectionString: runtimeUrl, adminConnectionString: adminUrl, create: true, expectedServerVersion: 170011 }, { clientFactory: factory }), /ROLE_PRIVILEGES_INVALID/);
  await assert.rejects(preparePostgres({ connectionString: runtimeUrl, create: false }, { clientFactory: factory }), /DATABASE_PRIVILEGES_INVALID/);
  assert.throws(() => validateConnections({ connectionString: runtimeUrl.replace('127.0.0.1', 'remote.example'), adminConnectionString: adminUrl, create: true }), /ENDPOINT_MISMATCH/);
  checks.push('injected-postgres-provisioning-idempotence-owner-role-boundary-no-cleartext-sql');
  console.log(JSON.stringify({ ok: true, proof_class: 'fixture', checks, live_postgres: 'SKIP: not requested', winget_install: 'SKIP: host mutation not requested', native_approval: 'unverified' }, null, 2));
} finally {
  const cleanup = removePathWithRetry(root);
  if (!cleanup.ok) throw cleanup.error;
}
