import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { preparePostgres } from './windows-postgres.mjs';
import { projectRoot } from './installed-project.mjs';
import { readProjects, rememberProject, forgetProject } from './project-registry.mjs';
import { acquireGlobalRuntime, resolveGlobalRuntime, checkedHostPath } from '../../src/application/install/global-runtime-store.mjs';
import { planInstallation, executeInstallation } from '../../src/application/install/installation-service.mjs';
import { inspectGlobalProjectCompatibility } from '../../src/application/install/global-project-compatibility.mjs';
import { resolveActivationTarget } from '../../src/application/install/project-activation-service.mjs';

const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function resolveProjectTarget(target) {
  return projectRoot(target ?? resolveActivationTarget({ cwd: process.cwd() }).target_root);
}
export async function addGlobalProject(options) {
  const targetRoot = resolveProjectTarget(options.target);
  const lease = options.write ? acquireGlobalRuntime({ home: options.home }) : null;
  try {
    const runtime = lease ?? resolveGlobalRuntime({ home: options.home });
    readProjects(options.home);
    if (fs.existsSync(checkedHostPath(path.join(targetRoot, '.aidn/install/receipt.json'))) && !options.resume) throw new Error('GLOBAL_EXISTING_PROJECT_USE_MIGRATE');
    const args = { pack: options.pack ?? 'core', initDefaults: true, projectName: path.basename(targetRoot),
      runtimeStateMode: options.connectionRef ? 'db-only' : 'files', artifactImportStore: 'file',
      ...(options.connectionRef ? { runtimePersistenceBackend: 'postgres', runtimePersistenceConnectionRef: options.connectionRef,
        runtimePersistenceLocalProjectionPolicy: 'none' } : {}), persistencePolicy: 'verify-only' };
    const input = { repoRoot: runtime.packageRoot, targetRoot, globalHome: options.home, args,
      ...(options.resume ? { action: 'resume' } : {}) };
    const plan = await planInstallation(input);
    if (!options.write) return plan;
    if (!options.expectedPlanId || options.expectedPlanId !== plan.plan_id) throw new Error('GLOBAL_PLAN_MISMATCH');
    if (options.connectionRef) {
      const { Client } = createRequire(path.join(runtime.packageRoot, 'package.json'))('pg');
      await preparePostgres({ connectionString: process.env[options.connectionRef.slice(4)], create: false }, {
        clientFactory: connectionString => new Client({ connectionString, connectionTimeoutMillis: 10000, query_timeout: 30000 }),
      });
    }
    const result = await executeInstallation({ ...input, dryRun: false, expectedPlanId: options.expectedPlanId });
    if (result.ok && !result.pending) {
      await inspectGlobalProjectCompatibility({ targetRoot });
      rememberProject(targetRoot, options.home);
    }
    return result;
  } finally { lease?.release(); }
}
export function removeGlobalProject(options) {
  const registry = readProjects(options.home);
  const entry = registry.projects.find(item => item.id === options.id);
  if (!entry) throw new Error('PROJECT_NOT_REGISTERED');
  const plan = { action: 'remove', home: options.home, registry, id: options.id };
  const plan_id = hash(plan);
  if (options.write) {
    if (options.expectedPlanId !== plan_id) throw new Error('GLOBAL_PLAN_MISMATCH');
    // The registry writer serializes edits; verify its preimage under the lock.
    forgetProject(options.id, options.home, hash(registry));
  }
  return { plan_id, written: options.write === true, project: entry };
}
export async function globalDoctor(options) {
  const runtime = resolveGlobalRuntime({ home: options.home });
  const targetRoot = resolveProjectTarget(options.target);
  const project = await inspectGlobalProjectCompatibility({ targetRoot });
  const receipt = JSON.parse(fs.readFileSync(path.join(targetRoot, '.aidn/install/receipt.json')));
  return { written: false, target: targetRoot, version: runtime.version, installation_id: runtime.state.installation_id,
    project, integration: receipt.global_runtime ? 'global' : 'local-migration-required',
    installed_version: receipt.installation?.version ?? null };
}
