import { win32 as windows } from "node:path";
import { fingerprintAgentExecutionValue as fingerprint } from "./agent-execution-contracts.mjs";

// Pure preparation records only. No inventory collector, approval transport,
// process launcher, filesystem authority or native qualification lives here.
export const MANAGED_SANDBOX_RESOURCE_KINDS = Object.freeze([
  "local_account", "local_group", "filesystem", "filesystem_acl", "wfp_rule",
  "firewall_rule", "desktop", "device_acl", "local_policy", "service", "registry",
]);
export const MANAGED_SANDBOX_ROOT_ROLES = Object.freeze([
  "profile", "sandbox_state", "sandbox_secrets", "sandbox_bin", "snapshots", "scratch", "supervisor", "runtime",
]);
const HASH = /^[a-f0-9]{64}$/u;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const APPROVAL_MAX_AGE_MS = 300000;
const REASON = /^[A-Z][A-Z0-9_]{0,95}$/u;
const DEVICE = /^(?:con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/iu;
const VERSIONS = Object.freeze({
  manifest: "codex-managed-sandbox-effects.v1", inventory: "codex-managed-sandbox-inventory.v1",
  plan: "codex-managed-sandbox-preparation-plan.v1", approval: "codex-managed-sandbox-preparation-approval.v1",
  comparison: "codex-managed-sandbox-comparison.v1",
});
const fail = code => { throw Object.assign(new Error(`MANAGED_SANDBOX_${code}`), { code: `MANAGED_SANDBOX_${code}` }); };
const ensure = (condition, code) => { if (!condition) fail(code); };
const object = value => value !== null && typeof value === "object" && !Array.isArray(value);
const exact = (value, keys) => object(value) && Object.keys(value).sort().join("|") === [...keys].sort().join("|");
const copy = value => structuredClone(value);
const key = value => value.toLowerCase();
const resourceKey = row => `${row.kind}\0${key(row.id)}`;
const same = (a, b) => fingerprint(a) === fingerprint(b);
const list = (value, minimum, maximum) => Array.isArray(value) && value.length >= minimum && value.length <= maximum;
const identifier = value => typeof value === "string" && ID.test(value);
function json(value) { try { fingerprint(value); } catch { fail("JSON_INVALID"); } }
function freeze(value) { if (value && typeof value === "object") { Object.values(value).forEach(freeze); Object.freeze(value); } return value; }
function text(value, maximum) {
  return typeof value === "string" && value.length > 0 && value.length <= maximum && value.trim() === value
    && value.normalize("NFC") === value && !/[\x00-\x1f\x7f]/u.test(value);
}
function absolute(value) {
  return text(value, 4096) && /^[A-Za-z]:\\/u.test(value) && windows.normalize(value) === value && !value.endsWith("\\")
    && value.slice(3).split("\\").every(part => part.length > 0 && part.length <= 255 && part !== "." && part !== ".."
      && !/[<>:"/|?*]/u.test(part) && !/[. ]$/u.test(part) && !DEVICE.test(part));
}
function inside(root, target) {
  const relative = windows.relative(key(root), key(target));
  return relative === "" || !windows.isAbsolute(relative) && relative !== ".." && !relative.startsWith("..\\");
}
function timestamp(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value)) return false;
  const number = Date.parse(value);
  return Number.isFinite(number) && new Date(number).toISOString() === value;
}
function resourceIdentity(row) {
  if (!MANAGED_SANDBOX_RESOURCE_KINDS.includes(row.kind) || !text(row.id, 4096)) return false;
  if (["filesystem", "filesystem_acl"].includes(row.kind)) return absolute(row.id);
  return row.id.length <= 512 && !/[?*]/u.test(row.id)
    && row.id.split(/[\\/]/u).every(part => part && part !== "." && part !== ".." && part.trim() === part && !part.endsWith("."));
}
function pin(value) { return exact(value, ["executable", "sha256"]) && absolute(value.executable) && HASH.test(value.sha256); }

export function assertManagedSandboxEffectsManifest(manifest) {
  json(manifest);
  ensure(exact(manifest, ["contract_version", "mode", "platform", "host_id", "client", "setup", "command_runner", "profile_root", "roots", "resources", "protected_resources"])
    && manifest.contract_version === VERSIONS.manifest && manifest.mode === "managed-elevated" && manifest.platform === "win32"
    && identifier(manifest.host_id) && pin(manifest.client) && pin(manifest.setup) && pin(manifest.command_runner)
    && absolute(manifest.profile_root), "MANIFEST_INVALID");
  ensure(list(manifest.roots, 4, 32) && manifest.roots.every(row => exact(row, ["role", "path"])
    && MANAGED_SANDBOX_ROOT_ROLES.includes(row.role) && absolute(row.path)), "ROOTS_INVALID");
  ensure(new Set(manifest.roots.map(row => key(row.path))).size === manifest.roots.length, "ROOTS_AMBIGUOUS");
  for (const role of MANAGED_SANDBOX_ROOT_ROLES.filter(role => role !== "runtime")) {
    const rows = manifest.roots.filter(row => row.role === role);
    ensure(rows.length <= 1 && (!["profile", "snapshots", "scratch", "supervisor"].includes(role) || rows.length === 1), "ROOTS_AMBIGUOUS");
  }
  const root = role => manifest.roots.find(row => row.role === role)?.path;
  ensure(key(root("profile")) === key(manifest.profile_root), "PROFILE_ROOT_MISMATCH");
  ensure(!inside(root("profile"), root("supervisor")) && !inside(root("supervisor"), root("profile"))
    && !inside(root("snapshots"), root("scratch")) && !inside(root("scratch"), root("snapshots"))
    && !inside(root("profile"), root("snapshots")) && !inside(root("snapshots"), root("profile"))
    && !inside(root("profile"), root("scratch")) && !inside(root("scratch"), root("profile"))
    && !inside(root("snapshots"), root("supervisor")) && !inside(root("scratch"), root("supervisor")), "ROOT_OVERLAP");
  for (const [role, directory] of [["sandbox_state", ".sandbox"], ["sandbox_secrets", ".sandbox-secrets"], ["sandbox_bin", ".sandbox-bin"]]) {
    if (root(role)) ensure(key(root(role)) === key(windows.join(manifest.profile_root, directory)), "SANDBOX_ROOT_MISMATCH");
  }
  ensure(list(manifest.resources, 1, 256) && manifest.resources.every(row => exact(row, ["kind", "id", "operations"])
    && resourceIdentity(row) && list(row.operations, 1, 2) && new Set(row.operations).size === row.operations.length
    && row.operations.every(operation => ["create", "update"].includes(operation))), "RESOURCE_INVALID");
  ensure(list(manifest.protected_resources, 1, 256) && manifest.protected_resources.every(row => exact(row, ["kind", "id"]) && resourceIdentity(row)), "PROTECTED_RESOURCE_INVALID");
  const all = [...manifest.resources, ...manifest.protected_resources];
  ensure(new Set(all.map(resourceKey)).size === all.length, "RESOURCE_AMBIGUOUS");
  for (const row of manifest.resources.filter(row => ["filesystem", "filesystem_acl"].includes(row.kind))) {
    ensure(manifest.roots.some(value => inside(value.path, row.id)), "RESOURCE_OUTSIDE_ROOTS");
  }
  const pins = new Map();
  for (const executable of [manifest.client, manifest.setup, manifest.command_runner]) {
    ensure(!pins.has(key(executable.executable)) || pins.get(key(executable.executable)) === executable.sha256, "EXECUTABLE_PIN_CONFLICT");
    pins.set(key(executable.executable), executable.sha256);
    ensure(manifest.protected_resources.some(row => row.kind === "filesystem" && key(row.id) === key(executable.executable)), "EXECUTABLE_NOT_PROTECTED");
  }
  return true;
}
export function fingerprintManagedSandboxEffectsManifest(manifest) { assertManagedSandboxEffectsManifest(manifest); return fingerprint(manifest); }

function assertInventory(manifest, inventory) {
  json(inventory);
  ensure(exact(inventory, ["contract_version", "host_id", "client_sha256", "manifest_sha256", "observed_at", "coverage", "resources", "protected_resources"])
    && inventory.contract_version === VERSIONS.inventory && inventory.host_id === manifest.host_id
    && inventory.client_sha256 === manifest.client.sha256 && inventory.manifest_sha256 === fingerprint(manifest)
    && timestamp(inventory.observed_at), "INVENTORY_BINDING_INVALID");
  ensure(list(inventory.coverage, MANAGED_SANDBOX_RESOURCE_KINDS.length, MANAGED_SANDBOX_RESOURCE_KINDS.length)
    && new Set(inventory.coverage.map(row => row?.kind)).size === MANAGED_SANDBOX_RESOURCE_KINDS.length
    && inventory.coverage.every(row => exact(row, ["kind", "scope_id", "scope_sha256", "complete", "outside_authority_sha256", "reason_code"])
      && MANAGED_SANDBOX_RESOURCE_KINDS.includes(row.kind) && identifier(row.scope_id) && HASH.test(row.scope_sha256)
      && (row.complete === true && HASH.test(row.outside_authority_sha256) && row.reason_code === null
        || row.complete === false && row.outside_authority_sha256 === null && REASON.test(row.reason_code))), "INVENTORY_COVERAGE_INVALID");
  for (const field of ["resources", "protected_resources"]) {
    const rows = inventory[field], declared = new Set(manifest[field].map(resourceKey));
    ensure(list(rows, declared.size, declared.size) && rows.every(row => exact(row, ["kind", "id", "sha256"])
      && resourceIdentity(row) && (row.sha256 === null || HASH.test(row.sha256)) && declared.has(resourceKey(row)))
      && new Set(rows.map(resourceKey)).size === rows.length, "INVENTORY_RESOURCE_SET_CHANGED");
  }
}
const incomplete = inventory => MANAGED_SANDBOX_RESOURCE_KINDS.filter(kind => !inventory.coverage.find(row => row.kind === kind).complete);

export function buildManagedSandboxPreparationPlan({ manifest, inventory }) {
  assertManagedSandboxEffectsManifest(manifest); assertInventory(manifest, inventory);
  const missing = incomplete(inventory);
  if (!missing.includes("filesystem")) for (const pin of [manifest.client, manifest.setup, manifest.command_runner]) {
    ensure(inventory.protected_resources.find(row => row.kind === "filesystem" && key(row.id) === key(pin.executable)).sha256 === pin.sha256, "EXECUTABLE_CHANGED");
  }
  const plan = {
    contract_version: VERSIONS.plan, status: missing.length ? "PREPARATION_BLOCKED" : "PREPARED_NOT_AUTHORIZED",
    native: false, execution_available: false, qualification: "NOT_RUN",
    host_id: manifest.host_id, client_sha256: manifest.client.sha256,
    manifest_sha256: fingerprint(manifest), inventory_sha256: fingerprint(inventory),
    manifest: copy(manifest), inventory: copy(inventory), effects: copy(manifest.resources), incomplete_categories: missing,
  };
  return freeze({ ...plan, plan_sha256: fingerprint(plan) });
}

export function assertManagedSandboxPreparationApproval({ plan, expectPlan, execute, approval, at }) {
  json(plan);
  ensure(object(plan), "PLAN_INVALID");
  const rebuilt = buildManagedSandboxPreparationPlan({ manifest: plan.manifest, inventory: plan.inventory });
  ensure(same(plan, rebuilt), "PLAN_CHANGED");
  ensure(plan.status === "PREPARED_NOT_AUTHORIZED", "INVENTORY_INCOMPLETE");
  ensure(execute === true, "EXECUTE_REQUIRED");
  ensure(HASH.test(expectPlan) && expectPlan === plan.plan_sha256, "EXPECT_PLAN_MISMATCH");
  ensure(timestamp(at), "APPROVAL_TIME_REQUIRED");
  json(approval);
  ensure(exact(approval, ["contract_version", "approval_id", "plan_sha256", "host_id", "client_sha256", "manifest_sha256", "inventory_sha256", "decision", "valid_from", "valid_until", "approver"])
    && approval.contract_version === VERSIONS.approval && identifier(approval.approval_id) && approval.decision === "approve"
    && exact(approval.approver, ["kind", "reference"]) && approval.approver.kind === "user" && text(approval.approver.reference, 1024)
    && timestamp(approval.valid_from) && timestamp(approval.valid_until), "APPROVAL_REQUIRED");
  ensure(["plan_sha256", "host_id", "client_sha256", "manifest_sha256", "inventory_sha256"].every(field => approval[field] === plan[field]), "APPROVAL_BINDING_INVALID");
  const start = Date.parse(approval.valid_from), end = Date.parse(approval.valid_until), now = Date.parse(at);
  const observed = Date.parse(plan.inventory.observed_at);
  ensure(observed <= now && now - observed <= APPROVAL_MAX_AGE_MS, "INVENTORY_STALE_OR_FUTURE");
  ensure(end > start && end - start <= APPROVAL_MAX_AGE_MS && start >= observed
    && now >= start && now - start <= APPROVAL_MAX_AGE_MS && now < end, "APPROVAL_EXPIRED_OR_INVALID");
  // Validating the supplied record does not authenticate its user provenance,
  // consume a consent, qualify a backend, or authorize any system operation.
  return freeze({ status: "APPROVAL_RECORD_VALID", native: false, execution_available: false, qualification: "NOT_RUN",
    plan_sha256: plan.plan_sha256, approval_sha256: fingerprint(approval) });
}

export function compareManagedSandboxInventory({ manifest, before, after }) {
  assertManagedSandboxEffectsManifest(manifest); assertInventory(manifest, before); assertInventory(manifest, after);
  const missing = MANAGED_SANDBOX_RESOURCE_KINDS.filter(kind => incomplete(before).includes(kind) || incomplete(after).includes(kind));
  const changes = [], violations = [];
  const issue = (code, row) => violations.push({ code, ...(row ? { kind: row.kind, ...(row.id ? { id: row.id } : {}) } : {}) });
  if (Date.parse(after.observed_at) < Date.parse(before.observed_at)) issue("INVENTORY_TIME_REVERSED");
  for (const first of before.coverage) {
    const next = after.coverage.find(row => row.kind === first.kind);
    if (first.scope_id !== next.scope_id || first.scope_sha256 !== next.scope_sha256) issue("OBSERVATION_SCOPE_CHANGED", first);
    if (first.complete && next.complete && first.outside_authority_sha256 !== next.outside_authority_sha256) issue("OUTSIDE_AUTHORITY_CHANGED", first);
  }
  // A null digest denotes observed absence only for a completely observed
  // category. Partial inventory never supplies a preservation conclusion.
  for (const field of ["resources", "protected_resources"]) for (const first of before[field]) {
    if (missing.includes(first.kind)) continue;
    const next = after[field].find(row => resourceKey(row) === resourceKey(first));
    if (first.sha256 === next.sha256) continue;
    if (field === "protected_resources") { issue("PROTECTED_RESOURCE_CHANGED", first); continue; }
    if (next.sha256 === null) { issue("DELETE_FORBIDDEN", first); continue; }
    const operation = first.sha256 === null ? "create" : "update";
    const declared = manifest.resources.find(row => resourceKey(row) === resourceKey(first));
    changes.push({ kind: first.kind, id: first.id, operation, before_sha256: first.sha256, after_sha256: next.sha256 });
    if (!declared.operations.includes(operation)) issue(operation === "create" ? "CREATE_NOT_DECLARED" : "UPDATE_NOT_DECLARED", first);
  }
  return freeze({ contract_version: VERSIONS.comparison,
    status: violations.length ? "REFUSED" : missing.length ? "COMPARISON_BLOCKED" : changes.length ? "DECLARED_EFFECTS_OBSERVED" : "UNCHANGED",
    native: false, execution_available: false, confinement: "NOT_ASSESSED", manifest_sha256: fingerprint(manifest),
    before_sha256: fingerprint(before), after_sha256: fingerprint(after), incomplete_categories: missing, changes, violations });
}
