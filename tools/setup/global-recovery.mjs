import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { checkedHostPath, hostExecutionIdentity } from '../../src/application/install/global-runtime-store.mjs';
import { projectRoot } from './installed-project.mjs';

// PID death is not proof that a Windows descendant finished. Reboot establishes
// that every process from the recorded boot ended. Never infer this from a clock
// age or kill an operation on the user's behalf.
export function recoverGlobalLocks(options, { identity = hostExecutionIdentity } = {}) {
  const current = identity();
  if (!/^(windows:\d{15,20}|linux:[a-f0-9-]{36})$/.test(current.boot_id ?? '')) throw new Error('GLOBAL_BOOT_ID_UNAVAILABLE');
  if (!options.write) return recoverUnderBarrier(options, current);
  // A boot-specific exclusive barrier serializes recovery itself. Without it,
  // two recoverers could compare an old lock and one could unlink its successor.
  // Never reclaim a barrier from this boot; a later boot uses another name.
  const barrier = checkedHostPath(path.join(options.home, `.recovery-${current.boot_id.replace(':', '-')}.lock`));
  const token = randomUUID();
  let fd;
  try { fd = fs.openSync(barrier, 'wx', 0o600); }
  catch (error) { if (error.code === 'EEXIST') throw new Error('GLOBAL_RECOVERY_BUSY'); throw error; }
  try {
    fs.writeFileSync(fd, JSON.stringify({ ...current, token }));
    fs.fsyncSync(fd);
    return recoverUnderBarrier(options, current);
  } finally {
    fs.closeSync(fd);
    if (JSON.parse(fs.readFileSync(checkedHostPath(barrier))).token === token) fs.unlinkSync(barrier);
  }
}
function recoverUnderBarrier(options, current) {
  const files = ['update.lock', 'admission.lock', 'projects.lock'].map(name => path.join(options.home, name));
  const leases = checkedHostPath(path.join(options.home, 'leases'));
  const preparations = checkedHostPath(path.join(options.home, 'preparations'));
  if (fs.existsSync(preparations)) for (const name of fs.readdirSync(preparations).filter(name => name.endsWith('.lock'))) {
    if (!/^[a-f0-9]{64}\.json\.lock$/.test(name)) throw new Error('GLOBAL_RECOVERY_UNKNOWN_PROVISION_LOCK');
    files.push(path.join(preparations, name));
  }
  if (fs.existsSync(leases)) {
    for (const name of fs.readdirSync(leases)) {
      if (!/^[a-f0-9-]{36}\.json$/.test(name)) throw new Error('GLOBAL_RECOVERY_UNKNOWN_LEASE');
      files.push(path.join(leases, name));
    }
  }
  if (options.target) files.push(path.join(projectRoot(options.target), '.aidn/install/global-migration.json.lock'));
  const entries = [];
  for (const file of files) {
    checkedHostPath(file);
    if (!fs.existsSync(file)) continue;
    const raw = fs.readFileSync(file), record = JSON.parse(raw);
    const boot = record.boot_id;
    if (!Number.isInteger(record.pid) || record.pid <= 0 || !/^(windows:\d{15,20}|linux:[a-f0-9-]{36})$/.test(boot ?? '')) throw new Error('GLOBAL_RECOVERY_OWNER_UNKNOWN');
    if (boot === current.boot_id) throw new Error('GLOBAL_RECOVERY_REQUIRES_REBOOT');
    entries.push({ path: file, sha256: createHash('sha256').update(raw).digest('hex') });
  }
  const plan_id = createHash('sha256').update(JSON.stringify({ home: options.home, boot: current.boot_id, entries })).digest('hex');
  if (options.write) {
    if (options.expectedPlanId !== plan_id) throw new Error('GLOBAL_PLAN_MISMATCH');
    for (const entry of entries) {
      if (createHash('sha256').update(fs.readFileSync(checkedHostPath(entry.path))).digest('hex') !== entry.sha256) throw new Error('GLOBAL_RECOVERY_OWNER_CHANGED');
      fs.unlinkSync(entry.path);
    }
  }
  return { status: options.write ? 'complete' : 'recovery-proposed', written: options.write === true, plan_id, operations: entries.map(entry => ({ path: entry.path, action: 'remove-stale-lock' })) };
}
