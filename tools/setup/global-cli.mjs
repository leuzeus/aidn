#!/usr/bin/env node
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { globalHome } from '../../src/application/install/global-runtime-store.mjs';
import { readProjects } from './project-registry.mjs';
import { executeGlobalUpdate, resumeGlobalUpdate } from './global-update.mjs';
import { executeGlobalMigration, resumeGlobalMigration } from './global-migrate.mjs';
import { addGlobalProject, removeGlobalProject, globalDoctor, resolveProjectTarget } from './global-project.mjs';
import { recoverGlobalLocks } from './global-recovery.mjs';
import { resolveCliEffectClass } from '../../src/core/cli/effect-policy.mjs';

const actions = ['setup', 'update', 'rollback', 'doctor', 'project-add', 'project-migrate', 'project-list', 'project-remove'];
const allowed = {
  setup: ['release', 'packagePath', 'packageSha256'], update: ['release', 'packagePath', 'packageSha256', 'check', 'resume', 'recoverLocks'],
  rollback: ['resume'], doctor: [], 'project-add': ['pack', 'connectionRef', 'resume', 'postgresMode', 'postgresVersion', 'adminConnectionRef'], 'project-migrate': ['resume'],
  'project-list': [], 'project-remove': ['id'],
};
export function parseArgs(argv) {
  const values = { '--target': 'target', '--release': 'release', '--package': 'packagePath', '--sha256': 'packageSha256',
    '--expect-plan': 'expectedPlanId', '--id': 'id', '--pack': 'pack', '--connection-ref': 'connectionRef',
    '--postgres-mode': 'postgresMode', '--postgres-version': 'postgresVersion', '--admin-connection-ref': 'adminConnectionRef' };
  const flags = { '--write': 'write', '--check': 'check', '--resume': 'resume', '--recover-locks': 'recoverLocks', '--json': 'json', '--help': 'help', '-h': 'help' };
  const [action, ...args] = argv;
  if (!actions.includes(action)) throw new Error('GLOBAL_COMMAND_INVALID');
  const options = { action };
  for (let i = 0; i < args.length; i++) {
    const token = args[i], key = values[token] ?? flags[token];
    if (!key || Object.hasOwn(options, key)) throw new Error('GLOBAL_ARGUMENT_INVALID');
    if (values[token]) {
      if (!args[i + 1] || args[i + 1].startsWith('--')) throw new Error('GLOBAL_ARGUMENT_VALUE_REQUIRED');
      options[key] = args[++i];
    } else options[key] = true;
  }
  for (const key of Object.keys(options)) if (!['action', 'target', 'json', 'help', 'write', 'expectedPlanId', ...allowed[action]].includes(key)) throw new Error('GLOBAL_ARGUMENT_INVALID');
  if (options.write && (options.check || ['doctor', 'project-list'].includes(action))) throw new Error('GLOBAL_READ_ONLY_COMMAND');
  if (options.write && !options.expectedPlanId && !options.help) throw new Error('GLOBAL_EXPECT_PLAN_REQUIRED');
  if (options.connectionRef && !/^env:[A-Za-z_][A-Za-z0-9_]*$/.test(options.connectionRef)) throw new Error('GLOBAL_CONNECTION_REFERENCE_REQUIRED');
  if (options.postgresMode && options.postgresMode !== 'install') throw new Error('GLOBAL_POSTGRES_MODE_INVALID');
  if ((options.postgresVersion || options.adminConnectionRef) && options.postgresMode !== 'install' && !options.resume) throw new Error('GLOBAL_POSTGRES_INSTALL_OPTIONS_REQUIRED');
  return options;
}
const command = action => `aidn ${action.startsWith('project-') ? action.replace('project-', 'project ') : action}`;
const help = action => `${command(action)} [--target PATH] [--json]\nMutations: --write --expect-plan PLAN_ID\nupdate: --check | --release latest|VERSION | --package FILE --sha256 HASH --release VERSION\nproject add: --pack PROFILE [--connection-ref env:NAME]\nLocal PostgreSQL: --postgres-mode install --postgres-version VERSION --connection-ref env:AIDN_PG_PROJECT --admin-connection-ref env:AIDN_PG_ADMIN\nproject remove: --id ID; project add/migrate/update/rollback: --resume\nsetup: interactive wizard; --json prints a non-interactive preview.\n`;
export async function runGlobalCommand(options) {
  if (options.help) return { written: false, help: help(options.action) };
  const input = { ...options, home: options.home ?? globalHome() };
  if (options.recoverLocks) return recoverGlobalLocks(input);
  if (options.action === 'project-list') return { written: false, ...readProjects(input.home) };
  if (options.action === 'project-remove') return removeGlobalProject(input);
  if (options.action === 'doctor') return globalDoctor(input);
  if (options.action === 'project-add') return addGlobalProject(input);
  if (options.action === 'project-migrate') {
    input.target = resolveProjectTarget(input.target);
    return options.resume ? resumeGlobalMigration(input) : executeGlobalMigration(input);
  }
  if (options.action === 'setup' && !options.json) {
    const { globalWizard } = await import('./global-wizard.mjs');
    return globalWizard(input);
  }
  input.rollback = options.action === 'rollback';
  return options.resume ? resumeGlobalUpdate(input) : executeGlobalUpdate(input);
}
// Public output never serializes receipt preimages, connection values or private
// backup contents. Plans expose affected paths/actions, not file bytes.
export function publicGlobalResult(result) {
  const output = {};
  for (const key of ['status', 'phase', 'version', 'installed_version', 'installation_id', 'plan_id', 'written', 'target', 'integration', 'help', 'removed']) {
    if (result[key] !== undefined) output[key] = result[key];
  }
  if (result.projects) output.projects = result.projects;
  if (result.project) output.project = result.project;
  if (result.inventory) output.inventory = result.inventory.entries.map(({ path, action }) => ({ path, action }));
  if (result.operations) output.operations = result.operations.map(({ path, action, kind }) => ({ path, action, kind }));
  if (result.external_effects) output.external_effects = result.external_effects.map(({ id, state, policy, package: name, version, interactive, connection_ref, admin_connection_ref }) =>
    ({ id, state, policy, package: name, version, interactive, connection_ref, admin_connection_ref }));
  if (result.conflicts) output.conflicts = result.conflicts.map(item => typeof item === 'string' ? { code: item } : { code: item.code, path: item.path });
  return output;
}
export async function main(argv = process.argv.slice(2)) {
  let options, result, error;
  try { options = parseArgs(argv); result = await runGlobalCommand(options); }
  catch (failure) { error = /^[A-Z][A-Z0-9_]+$/.test(failure.message) ? failure.message : 'GLOBAL_OPERATION_FAILED'; }
  const ok = !error && result?.ok !== false && !(result?.conflicts?.length);
  const action = options?.action ?? argv[0] ?? 'unknown';
  const effect = actions.includes(action) ? resolveCliEffectClass(command(action), argv.slice(1)) : 'preview';
  const payload = { contract_version: 'global-management.v1', command: command(action), effect_class: effect,
    ok, written: result?.written === true, errors: error ? [error] : ok ? [] : ['GLOBAL_PLAN_BLOCKED'], result: result ? publicGlobalResult(result) : {} };
  if (argv.includes('--json')) process.stdout.write(JSON.stringify(payload) + '\n');
  else if (result?.help) process.stdout.write(result.help);
  else process.stdout.write(JSON.stringify(payload, null, 2) + '\n');
  if (!ok) process.exitCode = 2;
  return payload;
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) await main();
