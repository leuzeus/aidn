import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { writeFileAtomicSync } from '../../src/lib/fs/atomic-write-lib.mjs';

const fail = code => { throw new Error(code); };
export function setupHome(env = process.env) {
  const value = env.AIDN_HOME || (env.LOCALAPPDATA && path.join(env.LOCALAPPDATA, 'AIDN'));
  if (!value || !path.isAbsolute(value)) fail('ABSOLUTE_AIDN_HOME_REQUIRED');
  return path.resolve(value);
}
export const projectKey = value => path.resolve(value).replaceAll('\\', '/').replace(/\/$/, '').toLowerCase();
export function readProjects(home = setupHome()) {
  const file = path.join(home, 'projects.json');
  if (!fs.existsSync(file)) return { schema_version: 1, projects: [] };
  try {
    if (fs.lstatSync(file).isSymbolicLink()) fail('INVALID_PROJECT_REGISTRY');
    const registry = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (registry.schema_version !== 1 || !Array.isArray(registry.projects) || Object.keys(registry).some(k => !['schema_version', 'projects'].includes(k))) fail('INVALID_PROJECT_REGISTRY');
    const ids = new Set(), paths = new Set();
    for (const entry of registry.projects) {
      if (!entry || Object.keys(entry).sort().join(',') !== 'id,last_used,name,path' || !/^[a-f0-9-]{36}$/.test(entry.id)
        || typeof entry.name !== 'string' || !entry.name.trim() || /[\r\n\0]/.test(entry.name)
        || typeof entry.path !== 'string' || !path.isAbsolute(entry.path) || /[\r\n\0]/.test(entry.path)
        || typeof entry.last_used !== 'string' || !Number.isFinite(Date.parse(entry.last_used))
        || ids.has(entry.id) || paths.has(projectKey(entry.path))) fail('INVALID_PROJECT_REGISTRY');
      ids.add(entry.id); paths.add(projectKey(entry.path));
    }
    return registry;
  } catch { fail('INVALID_PROJECT_REGISTRY'); }
}
export function editProjects(home, edit) {
  fs.mkdirSync(home, { recursive: true });
  const lock = path.join(home, 'projects.lock');
  let fd;
  try { fd = fs.openSync(lock, 'wx'); } catch (error) { if (error.code === 'EEXIST') fail('PROJECT_REGISTRY_BUSY'); throw error; }
  try {
    fs.writeFileSync(fd, JSON.stringify({ pid: process.pid, created: new Date().toISOString() }));
    const registry = readProjects(home);
    edit(registry.projects);
    writeFileAtomicSync(path.join(home, 'projects.json'), JSON.stringify(registry, null, 2) + '\n');
    return registry;
  } finally { fs.closeSync(fd); fs.unlinkSync(lock); }
}
export function rememberProject(target, home = setupHome()) {
  const absolute = fs.realpathSync(target);
  if (/[\r\n\0]/.test(absolute)) fail('INVALID_PROJECT_PATH');
  return editProjects(home, entries => {
    let entry = entries.find(item => projectKey(item.path) === projectKey(absolute));
    if (!entry) { entry = { id: randomUUID(), name: path.basename(absolute), path: absolute, last_used: '' }; entries.push(entry); }
    entry.last_used = new Date().toISOString();
  });
}
export function forgetProject(id, home = setupHome()) {
  return editProjects(home, entries => {
    const index = entries.findIndex(entry => entry.id === id);
    if (index === -1) fail('PROJECT_NOT_REGISTERED');
    entries.splice(index, 1);
  });
}
