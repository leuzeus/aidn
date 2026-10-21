import fs from "node:fs";
import path from "node:path";
import { AsyncLocalStorage } from "node:async_hooks";
import { captureContextIdentity } from "../../adapters/codex/context-provenance.mjs";
import { readActivation } from "../install/project-activation-service.mjs";
import { sha256, stableContextJson } from "../../core/context/working-memory-policy.mjs";

// Private to one grouped consultation. No serialized observation can activate
// this scope, and no write/admission path consumes it as an authorization.
const scopes = new AsyncLocalStorage();
const fail = code => { const scope = scopes.getStore(); if (scope) scope.invalidated = true; throw Object.assign(new Error(code), { code }); };
const digest = value => sha256(stableContextJson(value));
export function workflowObservationActive(targetRoot) {
  const scope = scopes.getStore();
  if (!scope) return false;
  if (scope.targetRoot !== path.resolve(targetRoot)) fail("WORKFLOW_OBSERVATION_SCOPE_MISMATCH");
  if (scope.closed) fail("WORKFLOW_OBSERVATION_CLOSED");
  return true;
}

export function canonicalWorkflowRevision(snapshot) {
  const { generated_at, summary, ...payload } = snapshot?.payload ?? {};
  // SQLite generated_at is observation time. All actual artifacts, entity rows,
  // runtime heads and scope bindings remain in the revision.
  return digest({ exists: snapshot?.exists, warning: snapshot?.warning, payload,
    runtimeHeads: snapshot?.runtimeHeads, scope_key: snapshot?.scope_key,
    backend: snapshot?.backend });
}

export async function observeWorkflowRead({ targetRoot, key, binding = null, load, revision = digest }) {
  if (!workflowObservationActive(targetRoot)) return await load();
  const scope = scopes.getStore(), bound = digest(binding);
  let entry = scope.reads.get(key);
  if (entry && entry.binding !== bound) fail("WORKFLOW_OBSERVATION_BINDING_CHANGED");
  if (!entry) {
    entry = { binding: bound, load, revision, value: Promise.resolve().then(load) };
    scope.reads.set(key, entry);
  }
  // Consumers cannot mutate another consumer's snapshot.
  return structuredClone(await entry.value);
}

function captureInputs(targetRoot, contextFile) {
  const identity = captureContextIdentity({ targetRoot });
  if (identity.status !== "captured") fail("WORKFLOW_OBSERVATION_LOCAL_REVISION_UNAVAILABLE");
  const file = path.resolve(targetRoot, contextFile);
  const activation = readActivation({ targetRoot });
  const audit = [], budget = { bytes: 0 };
  const walk = relative => {
    const file = path.join(targetRoot, relative);
    if (!fs.existsSync(file)) { audit.push([relative, null]); return; }
    const stat = fs.lstatSync(file);
    if (stat.isSymbolicLink()) fail("WORKFLOW_OBSERVATION_UNSAFE_AUDIT_INPUT");
    if (stat.isDirectory()) {
      audit.push([relative, "directory"]);
      for (const name of fs.readdirSync(file).sort()) walk(path.join(relative, name));
    } else {
      if (!stat.isFile() || (budget.bytes += stat.size) > 64 * 1024 * 1024) fail("WORKFLOW_OBSERVATION_AUDIT_LIMIT");
      const bytes = fs.readFileSync(file);
      if (bytes.length !== stat.size) fail("WORKFLOW_OBSERVATION_INVALIDATED");
      audit.push([relative, sha256(bytes)]);
    }
  };
  // Local workflow artifacts may be intentionally ignored by Git. Their bytes
  // and directory membership must still invalidate a files/dual observation.
  walk("docs/audit");
  return digest({ identity, activation, audit,
    hook_context: fs.existsSync(file) ? sha256(fs.readFileSync(file)) : null });
}

export async function withWorkflowObservation({ targetRoot, contextFile }, action) {
  if (scopes.getStore()) fail("WORKFLOW_OBSERVATION_NESTED");
  const root = path.resolve(targetRoot), before = captureInputs(root, contextFile);
  const scope = { targetRoot: root, reads: new Map(), closed: false };
  try {
    return await scopes.run(scope, async () => {
      const value = await action();
      if (scope.invalidated) fail("WORKFLOW_OBSERVATION_INVALIDATED");
      // Fresh backend reads run outside the cache. A change or unavailable
      // backend refuses publication; no stale successful result is returned.
      for (const entry of scope.reads.values()) {
        const original = await entry.value;
        const fresh = await entry.load();
        if (entry.revision(original) !== entry.revision(fresh)) fail("WORKFLOW_OBSERVATION_INVALIDATED");
      }
      if (before !== captureInputs(root, contextFile)) fail("WORKFLOW_OBSERVATION_INVALIDATED");
      return { value, observation: { scope: "invocation-common", write_authorization: false,
        source_revision: digest({ before, reads: await Promise.all([...scope.reads].map(async ([key, entry]) =>
          [key, entry.revision(await entry.value)])) }),
        distinct_reads: scope.reads.size, fence_status: "unchanged" } };
    });
  } finally { scope.closed = true; }
}
