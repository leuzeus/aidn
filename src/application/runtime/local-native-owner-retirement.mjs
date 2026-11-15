import fs from 'node:fs';
import path from 'node:path';
import { agentRunPhysicalPath, readAgentRunFile } from './agent-run-configuration-service.mjs';
import { exactFileIdentity } from '../../lib/fs/exact-file-identity.mjs';
import { observeLocalProcessOwner } from '../../adapters/runtime/local-process-identity.mjs';
import { nativeDispatchPath } from '../../core/workflow/native-dispatch-record.mjs';
import { shadowHash as H } from '../../core/workflow/shadow-json.mjs';

const original = '.aidn/runtime/standard-workflow/effects.lock';
const fail = code => { throw Object.assign(Error(code), { code }); };
const stableIdentity = ({ ctime_ns, ...value }) => value;
export function nativeRetiredOwnerRelativePath(dispatchId) {
  nativeDispatchPath(dispatchId);
  return '.aidn/runtime/standard-workflow/retired-' + dispatchId + '.lock';
}
function read(file) {
  const checked = agentRunPhysicalPath(file, { missing: true });
  let stat;
  try { stat = fs.lstatSync(checked, { bigint: true }); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  if (!stat.isFile() || stat.nlink !== 1n) fail('NATIVE_OWNER_PHYSICAL_LOCK_CHANGED');
  const identity = exactFileIdentity(stat), observed = readAgentRunFile(checked, { maxBytes: 4096 });
  if (H(exactFileIdentity(fs.lstatSync(checked, { bigint: true }))) !== H(identity)) fail('NATIVE_OWNER_PHYSICAL_LOCK_CHANGED');
  return { ...observed, identity };
}
// Original owner/lease provenance must already be authenticated by the fixed
// Native disposition host. An archive requires its separate durable intention.
export function inspectNativeOwnerLock({ targetRoot, dispatchId, intention, lease, allowRetired = false }) {
  if (intention?.lock_path !== original || !lease?.physical_identity || !intention.owner
    || H(intention.owner) !== H(lease.owner)) fail('NATIVE_OWNER_PHYSICAL_LOCK_CHANGED');
  const lock = read(path.join(targetRoot, original)), retired = read(path.join(targetRoot, nativeRetiredOwnerRelativePath(dispatchId)));
  if ((lock === null) === (retired === null) || retired && !allowRetired) fail('NATIVE_OWNER_PHYSICAL_LOCK_CHANGED');
  const found = lock ?? retired;
  if (H(found.value) !== H(lease.owner) || (lock ? H(found.identity) !== H(lease.physical_identity)
    : H(stableIdentity(found.identity)) !== H(stableIdentity(lease.physical_identity)))) fail('NATIVE_OWNER_PHYSICAL_LOCK_CHANGED');
  return { ...found, retired: retired !== null };
}
export function retireNativeOwnerLock({ targetRoot, dispatchId, intention, originalLease, fence, dispositionLease,
  expectedLockSha256, assertPermit, write = false }) {
  const self = dispositionLease?.record?.process_identity;
  if (!write || typeof assertPermit !== 'function' || !/^[a-f0-9]{64}$/.test(expectedLockSha256 ?? '')
    || self?.pid !== process.pid || observeLocalProcessOwner(self) !== 'active'
    || observeLocalProcessOwner(originalLease?.resource_fence?.process_identity) !== 'terminated')
    fail('NATIVE_OWNER_RETIREMENT_AUTHORITY_REQUIRED');
  const permit = () => {
    if (assertPermit() !== undefined) fail('NATIVE_OWNER_RETIREMENT_AUTHORITY_REQUIRED');
    fence.assert(dispositionLease);
    if (H(dispositionLease.record) === H(originalLease.resource_fence)) fail('NATIVE_OWNER_RETIREMENT_AUTHORITY_REQUIRED');
  };
  const observe = () => {
    const found = inspectNativeOwnerLock({ targetRoot, dispatchId, intention, lease: originalLease, allowRetired: true });
    if (found.sha256 !== expectedLockSha256) fail('NATIVE_OWNER_PHYSICAL_LOCK_CHANGED');
    return found;
  };
  permit(); const before = observe();
  if (!before.retired) fs.renameSync(before.path, agentRunPhysicalPath(path.join(targetRoot, nativeRetiredOwnerRelativePath(dispatchId)), { missing: true }));
  const after = observe();
  if (!after.retired) fail('NATIVE_OWNER_PHYSICAL_LOCK_CHANGED');
  permit();
  return { lock_sha256: after.sha256, retired_identity_sha256: H(after.identity), retired: true };
}

// Historical admission may run while a later legitimate writer owns effects.lock.
// Observe only the retained old archive, against its exact signed witness.
export function inspectRetiredNativeOwnerWitness({ targetRoot, dispatchId, originalLease, expectedLockSha256, expectedIdentitySha256 }) {
  const found = read(path.join(targetRoot, nativeRetiredOwnerRelativePath(dispatchId)));
  if (!found || !/^[a-f0-9]{64}$/.test(expectedLockSha256 ?? '') || !/^[a-f0-9]{64}$/.test(expectedIdentitySha256 ?? '')
    || found.sha256 !== expectedLockSha256 || H(found.value) !== H(originalLease?.owner)
    || H(stableIdentity(found.identity)) !== H(stableIdentity(originalLease?.physical_identity ?? {}))
    || H(found.identity) !== expectedIdentitySha256) fail('NATIVE_OWNER_RETIRED_WITNESS_CHANGED');
  return { sha256: found.sha256, identity_sha256: H(found.identity) };
}
