import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readInstallationContext } from '../../src/application/install/codex-assets-service.mjs';
import { createActivationGitEnvironment } from '../../src/application/install/project-activation-service.mjs';
import { isAidnProductVersion } from '../../src/lib/config/aidn-config-lib.mjs';

export function compareVersions(left, right) {
  if (!isAidnProductVersion(left) || !isAidnProductVersion(right)) throw new Error('INVALID_PRODUCT_VERSION');
  const parse = v => { const clean = v.split('+')[0], dash = clean.indexOf('-'); return {
    main: (dash < 0 ? clean : clean.slice(0, dash)).split('.').map(BigInt), pre: dash < 0 ? undefined : clean.slice(dash + 1),
  }; };
  const a = parse(left), b = parse(right);
  for (let i = 0; i < 3; i++) if (a.main[i] !== b.main[i]) return a.main[i] > b.main[i] ? 1 : -1;
  if (a.pre === b.pre) return 0;
  if (!a.pre || !b.pre) return !a.pre ? 1 : -1;
  const ap = a.pre.split('.'), bp = b.pre.split('.');
  for (let i = 0; i < Math.max(ap.length, bp.length); i++) {
    if (ap[i] === bp[i]) continue;
    if (ap[i] === undefined || bp[i] === undefined) return ap[i] === undefined ? -1 : 1;
    const an = /^\d+$/.test(ap[i]), bn = /^\d+$/.test(bp[i]);
    if (an !== bn) return an ? -1 : 1;
    return (an ? BigInt(ap[i]) > BigInt(bp[i]) : ap[i] > bp[i]) ? 1 : -1;
  }
  return 0;
}
export function projectRoot(target) {
  const root = fs.realpathSync(path.resolve(target));
  const git = spawnSync('git', ['-C', root, 'rev-parse', '--show-toplevel'], { encoding: 'utf8', windowsHide: true,
    env: createActivationGitEnvironment(process.env), timeout: 10000 });
  if (!fs.existsSync(path.join(root, '.git')) || git.status !== 0 || fs.realpathSync(git.stdout.trim()).toLowerCase() !== root.toLowerCase()) throw new Error('GIT_PROJECT_ROOT_REQUIRED');
  if (root.toLowerCase() === path.resolve(import.meta.dirname, '../..').toLowerCase()) throw new Error('PACKAGE_SOURCE_IS_NOT_A_CLIENT');
  const packageFile = path.join(root, 'package.json');
  if (fs.existsSync(packageFile) && JSON.parse(fs.readFileSync(packageFile, 'utf8')).name === 'aidn-workflow') throw new Error('PACKAGE_SOURCE_IS_NOT_A_CLIENT');
  return root;
}
export function inspectProject(target) {
  const root = projectRoot(target);
  const result = { target: root, state: 'absent', packageVersion: null, recordedVersion: null, receiptVersion: null, connectionRef: null };
  const read = name => fs.existsSync(path.join(root, name)) ? JSON.parse(fs.readFileSync(path.join(root, name), 'utf8')) : null;
  try {
    const config = read('.aidn/config.json');
    const adapter = read('.aidn/project/workflow.adapter.json');
    const packageJson = read('node_modules/aidn-workflow/package.json');
    const receiptFile = path.join(root, '.aidn/install/receipt.json');
    const pending = fs.existsSync(path.join(root, '.aidn/install/pending.json'));
    result.recordedVersion = config?.install?.aidnVersion ?? null;
    result.packageVersion = packageJson ? fs.readFileSync(path.join(root, 'node_modules/aidn-workflow/VERSION'), 'utf8').trim() : null;
    const context = readInstallationContext({ targetRoot: root });
    result.receiptVersion = context.receipt?.installation?.version ?? null;
    const ref = config?.runtime?.persistence?.connectionRef;
    result.connectionRef = typeof ref === 'string' && /^env:[A-Za-z_][A-Za-z0-9_]*$/.test(ref) ? ref : null;
    result.backend = config?.runtime?.persistence?.backend ?? 'sqlite';
    if (pending) result.state = 'interrupted';
    else if (!config && !packageJson && !fs.existsSync(receiptFile)) result.state = 'absent';
    else if ([result.recordedVersion, result.receiptVersion, result.packageVersion].filter(Boolean).some(v => !isAidnProductVersion(v))) result.state = 'inconsistent';
    else if (!result.recordedVersion || !result.receiptVersion) result.state = 'unknown';
    else if (!packageJson) result.state = 'package-missing';
    else if (packageJson.name !== 'aidn-workflow' || packageJson.version !== result.packageVersion || result.packageVersion !== result.recordedVersion || result.receiptVersion !== result.recordedVersion) result.state = 'inconsistent';
    else result.state = 'installed';
    // Bind confirmation to installed metadata, without disclosing its contents.
    result.fingerprint = createHash('sha256').update(JSON.stringify([config, adapter, context.receipt, packageJson, result.packageVersion, pending])).digest('hex');
  } catch { result.state = 'inconsistent'; }
  return result;
}
export function updateStatus(installation, targetVersion) {
  if (installation.state === 'absent') return 'install-available';
  if (installation.state !== 'installed') return 'diagnostic-required';
  const order = compareVersions(installation.recordedVersion, targetVersion);
  return order === 0 ? 'up-to-date' : order > 0 ? 'local-newer' : 'update-available';
}
