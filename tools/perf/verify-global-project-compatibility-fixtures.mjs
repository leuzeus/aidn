import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { executeInstallation } from '../../src/application/install/installation-service.mjs';
import { applyAuthorization, planAuthorization } from '../../src/application/install/project-activation-service.mjs';
import { inspectGlobalProjectCompatibility } from '../../src/application/install/global-project-compatibility.mjs';
import { preflightGlobalProjects } from '../setup/global-project-preflight.mjs';
import { rememberProject } from '../setup/project-registry.mjs';

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'aidn-global-compat-'));
const repoRoot = path.resolve(import.meta.dirname, '../..');
const root = path.join(temporary, 'projet été');
const home = path.join(temporary, 'host');
function snapshot() {
  return fs.readdirSync(temporary, { recursive: true }).sort().filter(name => fs.statSync(path.join(temporary, name)).isFile())
    .map(name => [name, createHash('sha256').update(fs.readFileSync(path.join(temporary, name))).digest('hex')]);
}
try {
  fs.mkdirSync(root);
  const install = await executeInstallation({ repoRoot, targetRoot: root, dryRun: false,
    args: { pack: 'core', initDefaults: true, projectName: 'neutral', runtimeStateMode: 'files', artifactImportStore: 'file', sourceBranch: 'dev' } });
  assert.equal(install.ok, true, JSON.stringify(install.errors));
  rememberProject(root, home);
  let before = snapshot();
  const local = await inspectGlobalProjectCompatibility({ targetRoot: root });
  assert.equal(local.compatible, true);
  assert.deepEqual(snapshot(), before);
  const registry = preflightGlobalProjects({ home, candidateRoot: repoRoot });
  assert.equal(registry.compatible, true, JSON.stringify(registry.projects));
  assert.deepEqual(snapshot(), before, 'registry and candidate subprocess inspection are read-only');
  applyAuthorization(planAuthorization({ targetRoot: root, action: 'revoke' }));
  before = snapshot();
  assert.equal((await inspectGlobalProjectCompatibility({ targetRoot: root })).activation, 'revoked');
  assert.deepEqual(snapshot(), before);
  const skill = path.join(root, '.agents/skills/aidn-context-reload/SKILL.md');
  const skillBefore = fs.readFileSync(skill);
  fs.appendFileSync(skill, '\nmodified');
  await assert.rejects(inspectGlobalProjectCompatibility({ targetRoot: root }), /ACTIVATION_ASSET_CHANGED/);
  fs.writeFileSync(skill, skillBefore);
  const configPath = path.join(root, '.aidn/config.json');
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  config.runtime = { stateMode: 'db-only', persistence: { backend: 'postgres', connectionRef: 'env:AIDN_FIXTURE_PG_URL', localProjectionPolicy: 'none' } };
  fs.writeFileSync(configPath, JSON.stringify(config));
  before = snapshot();
  await assert.rejects(inspectGlobalProjectCompatibility({ targetRoot: root }, { postgresPlan: async () => ({ blocked: false, action: 'migrate' }) }), /GLOBAL_PROJECT_DATABASE_MIGRATION_REQUIRED/);
  await assert.rejects(inspectGlobalProjectCompatibility({ targetRoot: root }, { postgresPlan: async () => { throw new Error('network unavailable'); } }), /network unavailable/);
  assert.equal((await inspectGlobalProjectCompatibility({ targetRoot: root }, { postgresPlan: async options => {
    assert.equal(options.connectionRef, 'env:AIDN_FIXTURE_PG_URL');
    return { blocked: false, action: 'noop' };
  } })).compatible, true);
  assert.deepEqual(snapshot(), before, 'injected PostgreSQL preflight makes no local writes');
  const missing = path.join(temporary, 'missing-project');
  fs.mkdirSync(missing); rememberProject(missing, home); fs.rmdirSync(missing);
  before = snapshot();
  const failed = preflightGlobalProjects({ home, candidateRoot: repoRoot }, { run: () => ({ status: 2, stderr: 'credential-containing unexpected error', stdout: '' }) });
  assert.equal(failed.compatible, false);
  assert(failed.projects.some(row => row.error === 'GLOBAL_PROJECT_UNAVAILABLE'));
  assert(!JSON.stringify(failed).includes('credential-containing'));
  assert.deepEqual(snapshot(), before);
  console.log('PASS global project compatibility: real installed fixture, candidate subprocess, revoked asset validation, inaccessible registry project, redaction, migration refusal (PostgreSQL injected, not live proof)');
} finally {
  const resolved = fs.realpathSync(temporary);
  if (path.dirname(resolved) !== fs.realpathSync(os.tmpdir()) || !path.basename(resolved).startsWith('aidn-global-compat-')) throw new Error('UNSAFE_FIXTURE_CLEANUP');
  fs.rmSync(resolved, { recursive: true, force: true });
}
