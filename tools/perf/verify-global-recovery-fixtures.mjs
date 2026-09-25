import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { recoverGlobalLocks } from '../setup/global-recovery.mjs';
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'aidn-global-recovery-'));
const boot = 'windows:639000000000000000';
const deps = { identity: () => ({ pid: process.pid, boot_id: boot }) };
try {
  const lock = path.join(home, 'update.lock');
  fs.writeFileSync(lock, JSON.stringify({ pid: 42, boot_id: boot }));
  assert.throws(() => recoverGlobalLocks({ home }, deps), /GLOBAL_RECOVERY_REQUIRES_REBOOT/);
  assert.throws(() => recoverGlobalLocks({ home }, { identity: () => ({ boot_id: null }) }), /GLOBAL_BOOT_ID_UNAVAILABLE/);
  fs.writeFileSync(lock, JSON.stringify({ pid: 42, boot_id: 'windows:638000000000000000' }));
  const before = fs.readFileSync(lock);
  const plan = recoverGlobalLocks({ home }, deps);
  assert.deepEqual(fs.readFileSync(lock), before);
  assert.throws(() => recoverGlobalLocks({ home, write: true, expectedPlanId: 'wrong' }, deps), /GLOBAL_PLAN_MISMATCH/);
  assert(fs.existsSync(lock));
  const barrier = path.join(home, `.recovery-${boot.replace(':', '-')}.lock`);
  fs.writeFileSync(barrier, '{}');
  assert.throws(() => recoverGlobalLocks({ home, write: true, expectedPlanId: plan.plan_id }, deps), /GLOBAL_RECOVERY_BUSY/);
  assert.deepEqual(fs.readFileSync(lock), before);
  fs.unlinkSync(barrier);
  recoverGlobalLocks({ home, write: true, expectedPlanId: plan.plan_id }, deps);
  assert(!fs.existsSync(lock));
  console.log('PASS global recovery fixtures: same-boot and unknown-boot refusal, preview immutability and exact-plan recovery after simulated reboot (OS identity injected)');
} finally {
  if (path.dirname(fs.realpathSync(home)) !== fs.realpathSync(os.tmpdir()) || !path.basename(home).startsWith('aidn-global-recovery-')) throw new Error('UNSAFE_FIXTURE_CLEANUP');
  fs.rmSync(home, { recursive: true, force: true });
}
