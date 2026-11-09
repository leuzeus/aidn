import fs from "node:fs";
import path from "node:path";
import { agentRunPhysicalPath, readAgentRunFile } from "./agent-run-configuration-service.mjs";
import { exactFileIdentity } from "../../lib/fs/exact-file-identity.mjs";
import { shadowHash } from "../../core/workflow/shadow-json.mjs";
import { observeLocalProcessOwner } from "../../adapters/runtime/local-process-identity.mjs";

const originalPath = ".aidn/runtime/standard-workflow/effects.lock";
const fail = code => { throw Object.assign(Error(code), { code }); };
const same = (left, right) => shadowHash(left) === shadowHash(right);
const afterRename = ({ ctime_ns, ...stable }) => stable;

function location(targetRoot, operationId) {
  if (!/^op_[a-f0-9]{40}$/.test(operationId ?? "")) fail("PROCESS_DISPOSITION_ID_INVALID");
  return path.join(targetRoot, path.dirname(originalPath), "retired-" + operationId + ".lock");
}

function read(file) {
  const checked = agentRunPhysicalPath(file, { missing: true });
  let before;
  try { before = fs.lstatSync(checked, { bigint: true }); }
  catch (cause) { if (cause.code === "ENOENT") return null; throw cause; }
  if (!before.isFile() || before.nlink !== 1n) fail("PROCESS_INTERRUPTED_REOPEN_OWNER_CHANGED");
  const identity = exactFileIdentity(before);
  const found = readAgentRunFile(checked, { maxBytes: 4096 });
  if (!same(exactFileIdentity(fs.lstatSync(found.path, { bigint: true })), identity))
    fail("PROCESS_INTERRUPTED_REOPEN_OWNER_CHANGED");
  return { ...found, identity };
}

// An already authenticated dispatch supplies owner and identity. An archived
// witness is admissible only from an owning disposition with a durable intent.
// The original dispatch/receipt retain their original lock and fence status.
export function inspectInterruptedReopenLock(targetRoot, operationId, intention, lease, { allowRetired = false } = {}) {
  if (intention?.lock_path !== originalPath || !lease?.physical_identity || !lease.owner || !intention.owner
    || !same(intention.owner, lease.owner)) fail("PROCESS_INTERRUPTED_REOPEN_OWNER_CHANGED");
  const lock = read(path.join(targetRoot, originalPath)), archive = read(location(targetRoot, operationId));
  if ((lock === null) === (archive === null) || archive && allowRetired !== true)
    fail("PROCESS_INTERRUPTED_REOPEN_OWNER_CHANGED");
  const witness = lock ?? archive;
  const exact = lock ? same(witness.identity, lease.physical_identity)
    : same(afterRename(witness.identity), afterRename(lease.physical_identity));
  if (!exact || !same(witness.value, lease.owner)) fail("PROCESS_INTERRUPTED_REOPEN_OWNER_CHANGED");
  return { ...witness, retired: archive !== null };
}

// Called with the freshly acquired disposition fence after durable intent.
// The synchronous permit must recheck current consent and the exact scope.
// Every retry verifies the preserved witness. Absence of the old lock alone
// cannot establish release, and a second lock is always a refusal.
export function retireInterruptedReopenLock({ targetRoot, operationId, intention, originalLease, fence, dispositionLease,
  expectedLockSha256, assertPermit, write = false }) {
  const currentOwner = dispositionLease?.record?.process_identity;
  if (write !== true || typeof assertPermit !== "function" || !/^[a-f0-9]{64}$/.test(expectedLockSha256 ?? "")
    || currentOwner?.pid !== process.pid || observeLocalProcessOwner(currentOwner) !== "active"
    || observeLocalProcessOwner(originalLease?.resource_fence?.process_identity) !== "terminated")
    fail("PROCESS_INTERRUPTED_REOPEN_RETIREMENT_REQUIRED");
  const assertCurrent = () => {
    if (assertPermit() !== undefined) fail("PROCESS_INTERRUPTED_REOPEN_RETIREMENT_REQUIRED");
    fence.assert(dispositionLease);
    if (same(dispositionLease.record, originalLease.resource_fence)) fail("PROCESS_INTERRUPTED_REOPEN_RETIREMENT_REQUIRED");
  };
  const observe = () => {
    const result = inspectInterruptedReopenLock(targetRoot, operationId, intention, originalLease, { allowRetired: true });
    if (result.sha256 !== expectedLockSha256) fail("PROCESS_INTERRUPTED_REOPEN_OWNER_CHANGED");
    return result;
  };
  assertCurrent();
  const before = observe();
  if (!before.retired) {
    const destination = agentRunPhysicalPath(location(targetRoot, operationId), { missing: true });
    fs.renameSync(before.path, destination);
  }
  const after = observe();
  if (!after.retired) fail("PROCESS_INTERRUPTED_REOPEN_OWNER_CHANGED");
  assertCurrent();
  return { lock_sha256: after.sha256, retired_identity_sha256: shadowHash(after.identity), retired: true };
}
