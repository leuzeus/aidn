import assert from "node:assert/strict";
import fs from "node:fs";
import childProcess from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
import { fingerprintAgentExecutionValue as hash } from "../../src/core/agents/agent-execution-contracts.mjs";
import { MANAGED_SANDBOX_RESOURCE_KINDS as kinds, buildManagedSandboxPreparationPlan } from "../../src/core/agents/codex-managed-sandbox-contracts.mjs";
import { assessManagedSandboxOperationAdequacy as assess, getManagedSandboxOperationPolicy as policy } from "../../src/core/agents/codex-managed-sandbox-operation-policy.mjs";

const H = "a".repeat(64), H2 = "b".repeat(64), NOW = "2026-09-27T12:02:00.000Z", checks = [];
const clone = value => structuredClone(value);
const code = expected => error => error.code === `MANAGED_OPERATION_${expected}`;
async function check(name, fn) { try { await fn(); checks.push({ name, status: "PASS" }); }
  catch (error) { checks.push({ name, status: "FAIL", detail: String(error.stack ?? error).slice(0, 2200) }); } }
const lower = value => value.toLowerCase();

// These deliberately synthetic receipts describe data sufficient for a review.
// They are not signatures, a Windows observer, permission or native evidence.
function fixture() {
  const spec = policy(), home = "C:\\Codex Équipe", runtime = "C:\\Program Files\\Codex", owner = "G:\\Fixture Supervisor";
  const manifest = { contract_version: "codex-managed-sandbox-effects.v1", mode: "managed-elevated", platform: "win32", host_id: "fixture-host",
    client: { executable: `${runtime}\\codex.exe`, sha256: spec.client_sha256 }, setup: { executable: `${runtime}\\setup.exe`, sha256: spec.setup_sha256 },
    command_runner: { executable: `${runtime}\\runner.exe`, sha256: spec.command_runner_sha256 }, profile_root: home,
    roots: [{ role: "profile", path: home }, { role: "supervisor", path: owner }, { role: "snapshots", path: `${owner}\\snapshots` },
      { role: "scratch", path: `${owner}\\scratch` }, { role: "runtime", path: runtime }],
    resources: [{ kind: "local_account", id: "CodexSandboxOffline", operations: ["create", "update"] }],
    protected_resources: ["codex.exe", "setup.exe", "runner.exe"].map(name => ({ kind: "filesystem", id: `${runtime}\\${name}` })) };
  const inventory = { contract_version: "codex-managed-sandbox-inventory.v1", host_id: manifest.host_id, client_sha256: manifest.client.sha256,
    manifest_sha256: hash(manifest), observed_at: "2026-09-27T12:00:00.000Z",
    coverage: kinds.map(kind => ({ kind, scope_id: `fixture.${kind}.v1`, scope_sha256: H, complete: false,
      outside_authority_sha256: null, reason_code: "LEGACY_PROJECTION_INCOMPLETE" })), resources: [], protected_resources: [] };
  const operation = { contract_version: "codex-managed-sandbox-operation.v1", policy_id: spec.policy_id, manifest_sha256: hash(manifest),
    request: { mode: "elevated", cwd: `${owner}\\snapshots` }, configuration: { configuration_sha256: H, permission_profile_sha256: H,
      environment_sha256: H, registered_core_requested: false, service_enabled: false,
      network: { allow_local_binding: false, proxy_ports: [] }, read_roots: [home], write_roots: [`${owner}\\snapshots`],
      deny_read_paths: [owner], prior_deny_read_paths: [], deny_write_paths: [], runtime_paths: [runtime] },
    control: { method: "pre-elevated-job", launcher_sha256: H, controller_sha256: H } };
  const input = { manifest, inventory, operation, observation: null, at: NOW };
  function initialRows() {
    inventory.resources = manifest.resources.map(row => ({ kind: row.kind, id: row.id, sha256: H }));
    inventory.protected_resources = [manifest.client, manifest.setup, manifest.command_runner].map(pin => ({ kind: "filesystem", id: pin.executable, sha256: pin.sha256 }));
  }
  initialRows();
  const requirements = assess(input).information.requirements;
  manifest.resources = requirements.filter(row => row.kind !== "control").flatMap(row => row.scope.selectors
    .filter(id => !manifest.protected_resources.some(protectedRow => protectedRow.kind === row.kind && protectedRow.id === id))
    .map(id => ({ kind: row.kind, id, operations: ["create", "update"] })));
  inventory.manifest_sha256 = operation.manifest_sha256 = hash(manifest); initialRows();
  const absence = (profile, id) => profile === "wfp-filter.v1" || id.endsWith("\\setup_marker.json") || id.endsWith("\\setup_error.json")
    || id.endsWith("\\.sandbox\\sandbox_users.json") || id.endsWith("allow_loopback_proxy");
  for (const requirement of requirements) for (const id of requirement.scope.selectors) if (absence(requirement.profile_id, id)) {
    const row = inventory.resources.find(value => value.kind === requirement.kind && value.id === id); if (row) row.sha256 = null;
  }
  const context = { contract_version: "codex-managed-sandbox-observer-context.v1", state: "observed", host_id: manifest.host_id,
    user_sid_sha256: H, token_projection_sha256: H, integrity_sid: "S-1-16-12288", elevation_type: "full", elevated: true,
    is_app_container: false, has_restrictions: false, restricted_sid_count: 0, process_bitness: 64, os_bitness: 64,
    powershell_version: "7.5.0", selected_modules: [{ name: "NetSecurity", manifest_path_sha256: H, manifest_sha256: H }] };
  const observation = { contract_version: "codex-managed-sandbox-operation-observation.v1", operation_sha256: hash(operation), inventory_sha256: hash(inventory),
    observer: { observer_id: "fixture-observer", script_sha256: H, executable_sha256: H, host_id: manifest.host_id, context_sha256: hash(context) },
    observer_context: context, observed_at: "2026-09-27T12:01:00.000Z", receipts: [], evidence: [] };
  for (const requirement of requirements) {
    const document = { contract_version: "codex-managed-sandbox-projection.v1", profile_id: requirement.profile_id,
      observer_context_sha256: hash(context), inventory_scope_sha256: inventory.coverage.find(row => row.kind === requirement.kind)?.scope_sha256 ?? null,
      scope: clone(requirement.scope), scope_sha256: hash(requirement.scope), status: "complete", rows: [], outside_sha256: requirement.kind === "control" ? null : H,
      truncated: false, errors: [] };
    for (const id of requirement.scope.selectors) {
      const row = [...inventory.resources, ...inventory.protected_resources].find(value => value.kind === requirement.kind && value.id === id);
      const dimensions = absence(requirement.profile_id, id) ? { exists: false, absence_reason: "not_found" }
        : { exists: true, ...Object.fromEntries(requirement.dimensions.map(name => [name, dimension(name, id, input)])) };
      document.rows.push({ id, sha256: requirement.kind === "control" ? hash(dimensions) : row.sha256, dimensions });
    }
    observation.evidence.push({ sha256: hash(document), document });
    observation.receipts.push({ profile_id: requirement.profile_id, scope_sha256: document.scope_sha256, evidence_sha256: hash(document), status: document.status });
  }
  input.observation = observation; return input;
}
function dimension(name, id, input) {
  const { manifest, operation } = input, config = operation.configuration;
  if (name === "content_sha256") return id.endsWith("\\sandbox_users.json") ? null
    : [manifest.client, manifest.setup, manifest.command_runner].find(pin => pin.executable === id)?.sha256 ?? H;
  if (name === "configuration_sha256") return config.configuration_sha256;
  if (name === "client_sha256") return manifest.client.sha256;
  if (name === "setup_sha256") return manifest.setup.sha256;
  if (name === "launcher_sha256" || name === "controller_sha256") return operation.control[name];
  if (name === "runtime_paths_sha256") return hash(config.runtime_paths);
  if (name === "prior_deny_read_paths_sha256") return hash(config.prior_deny_read_paths);
  if (name === "network_sha256") return hash(config.network);
  if (name.endsWith("_sha256")) return H;
  if (["registered_core_requested", "service_enabled"].includes(name)) return config[name];
  if (["enabled", "persistent", "launcher_elevated", "job_tree_control", "runtime_expansion_complete", "prior_deny_read_expansion_complete"].includes(name)) return true;
  if (["members", "descendant_paths", "log_rotation_victims", "outside_read_acl_helper_pids", "conditions"].includes(name)) return [];
  if (["flags", "attributes", "control_flags", "protocol", "value_data"].includes(name)) return 0;
  if (name === "password_last_set") return "2026-09-27T10:00:00.000Z";
  if (name === "physical_path") return id;
  if (name === "registry_view") return "Registry64";
  return "fixture-value";
}
function editDocument(input, profile, edit) {
  const entry = input.observation.evidence.find(row => row.document.profile_id === profile); edit(entry.document);
  entry.sha256 = hash(entry.document); const receipt = input.observation.receipts.find(row => row.profile_id === profile);
  receipt.scope_sha256 = entry.document.scope_sha256; receipt.evidence_sha256 = entry.sha256; receipt.status = entry.document.status;
}
function editControl(input, change) { editDocument(input, "setup-control.v1", document => { change(document.rows[0].dimensions); document.rows[0].sha256 = hash(document.rows[0].dimensions); }); }
function rebind(input) {
  input.inventory.manifest_sha256 = input.operation.manifest_sha256 = hash(input.manifest);
  input.inventory.client_sha256 = input.manifest.client.sha256;
  input.observation.operation_sha256 = hash(input.operation); input.observation.inventory_sha256 = hash(input.inventory);
}
const gap = (report, expected) => report.information.missing_requirements.some(row => row.code === expected);
function frozen(value) { if (value && typeof value === "object") { Object.values(value).forEach(frozen); Object.freeze(value); } return value; }

await check("fixed complete receipts describe a review without granting execution or changing v1", () => {
  const input = fixture(), before = clone(input), report = assess(frozen(input));
  assert.equal(report.status, "REVIEWABLE"); assert.equal(report.information.status, "ADEQUATE_FOR_REVIEW");
  assert.equal(report.control.status, "DESCRIBED_NOT_QUALIFIED"); assert.equal(report.approval.status, "NOT_AUTHORIZED");
  assert.equal(report.execution_available, false); assert.equal(report.native, false); assert.equal(report.qualification, "NOT_RUN");
  assert.equal(report.assessment, "STRUCTURAL_NOT_AUTHENTICATED"); assert.equal(report.confinement, "NOT_ASSESSED");
  assert.equal(report.legacy_preparation_status, "PREPARATION_BLOCKED");
  assert.equal(buildManagedSandboxPreparationPlan(input).status, "PREPARATION_BLOCKED"); assert.deepEqual(input, before);
  assert(Object.isFrozen(report.information.requirements[0].scope));
  const { report_sha256, ...unsigned } = report; assert.equal(report_sha256, hash(unsigned)); assert.equal(assess(input).report_sha256, report_sha256);
});
await check("requirements and N/A explanations cannot be supplied by the caller", () => {
  assert(Object.isFrozen(policy().profiles[0].dimensions)); assert.throws(() => policy("other"), code("POLICY_UNSUPPORTED"));
  for (const field of ["required_dimensions", "non_applicable", "execution_available"]) {
    const input = fixture(); input.operation[field] = true; assert.throws(() => assess(input), code("OPERATION_BINDING_INVALID"));
  }
});
await check("missing observation remains an explicit review gap", () => {
  const input = fixture(); input.observation = null; const report = assess(input);
  assert.equal(report.status, "REVIEWABLE_WITH_GAPS"); assert(gap(report, "OBSERVATION_REQUIRED")); assert.equal(report.execution_available, false);
});
await check("self asserted complete coverage without receipts is not adequate", () => {
  const input = fixture(); input.inventory.coverage.forEach(row => Object.assign(row, { complete: true, outside_authority_sha256: H, reason_code: null }));
  input.observation.receipts = []; input.observation.evidence = []; rebind(input); const report = assess(input);
  assert.equal(report.legacy_preparation_status, "PREPARED_NOT_AUTHORIZED"); assert.equal(report.information.status, "INCOMPLETE");
  assert(gap(report, "PROJECTION_REQUIRED")); assert.equal(report.execution_available, false);
});
for (const [name, change, expected] of [
  ["unknown policy", input => { input.operation.policy_id = "unknown"; }, "POLICY_UNSUPPORTED"],
  ["service route", input => { input.operation.configuration.service_enabled = true; }, "SERVICE_ROUTE_UNSUPPORTED"],
  ["registered core route", input => { input.operation.configuration.registered_core_requested = true; }, "SERVICE_ROUTE_UNSUPPORTED"],
  ["unknown route", input => { input.operation.configuration.service_enabled = null; }, "ROUTE_UNKNOWN"],
  ["stale inventory", input => { input.inventory.observed_at = "2020-01-01T00:00:00.000Z"; }, "INVENTORY_STALE_OR_FUTURE"],
  ["future inventory", input => { input.inventory.observed_at = "2026-09-27T12:03:00.000Z"; }, "INVENTORY_STALE_OR_FUTURE"],
  ["stale observation", input => { input.observation.observed_at = "2020-01-01T00:00:00.000Z"; }, "OBSERVATION_STALE_OR_FUTURE"],
  ["future observation", input => { input.observation.observed_at = "2026-09-27T12:03:00.000Z"; }, "OBSERVATION_STALE_OR_FUTURE"],
]) await check(`${name} is a review gap`, () => { const input = fixture(); change(input); rebind(input); const report = assess(input); assert(gap(report, expected)); assert.equal(report.execution_available, false); });
for (const pin of ["client", "setup", "command_runner"]) await check(`fixed ${pin} hash is mandatory`, () => {
  const input = fixture(); input.manifest[pin].sha256 = H2;
  input.inventory.protected_resources.find(row => row.id === input.manifest[pin].executable).sha256 = H2;
  editDocument(input, "filesystem-state.v1", doc => { const row = doc.rows.find(value => value.id === input.manifest[pin].executable); row.sha256 = H2; row.dimensions.content_sha256 = H2; });
  rebind(input); assert(gap(assess(input), pin === "client" ? "CLIENT_UNQUALIFIED" : "SIDECAR_UNQUALIFIED"));
});
for (const [name, change, expected] of [
  ["missing explicit time", input => { delete input.at; }, "TIME_REQUIRED"],
  ["coerced policy", input => { input.operation.policy_id = 12; }, "OPERATION_BINDING_INVALID"],
  ["relative cwd", input => { input.operation.request.cwd = "."; }, "REQUEST_INVALID"],
  ["Windows alias", input => { input.operation.request.cwd = "C:\\AUX"; }, "REQUEST_INVALID"],
  ["traversal", input => { input.operation.configuration.read_roots = ["C:\\a\\..\\b"]; }, "CONFIGURATION_INVALID"],
  ["glob", input => { input.operation.configuration.read_roots = ["C:\\a\\*"]; }, "CONFIGURATION_INVALID"],
  ["case alias", input => { input.operation.configuration.read_roots.push(input.operation.configuration.read_roots[0].toUpperCase()); }, "CONFIGURATION_INVALID"],
  ["invalid network port", input => { input.operation.configuration.network.proxy_ports = [0]; }, "NETWORK_INVALID"],
  ["duplicate network port", input => { input.operation.configuration.network.proxy_ports = [8080, 8080]; }, "NETWORK_INVALID"],
  ["unknown network setting", input => { input.operation.configuration.network.implicit = true; }, "NETWORK_INVALID"],
  ["foreign operation", input => { input.observation.operation_sha256 = H2; }, "OBSERVATION_BINDING_INVALID"],
  ["foreign inventory", input => { input.observation.inventory_sha256 = H2; }, "OBSERVATION_BINDING_INVALID"],
  ["foreign observer host", input => { input.observation.observer.host_id = "other"; }, "OBSERVER_INVALID"],
  ["forged observer context", input => { input.observation.observer_context.elevated = false; }, "OBSERVER_CONTEXT_INVALID"],
  ["extra context field", input => { input.observation.observer_context.raw_user_sid = "private"; }, "OBSERVER_CONTEXT_INVALID"],
  ["duplicate receipt", input => { input.observation.receipts.push(clone(input.observation.receipts[0])); }, "RECEIPTS_AMBIGUOUS"],
  ["tampered evidence", input => { input.observation.evidence[0].document.status = "partial"; }, "EVIDENCE_HASH_MISMATCH"],
  ["unused evidence", input => { input.observation.receipts.pop(); }, "UNREFERENCED_EVIDENCE"],
]) await check(`rejects ${name}`, () => { const input = fixture(); change(input); assert.throws(() => assess(input), code(expected)); });
for (const [name, change, expected] of [
  ["foreign scope", doc => { doc.scope.selectors = []; doc.scope_sha256 = hash(doc.scope); }, "PROJECTION_SCOPE_INVALID"],
  ["foreign inventory scope", doc => { doc.inventory_scope_sha256 = H2; }, "INVENTORY_SCOPE_MISMATCH"],
  ["foreign context", doc => { doc.observer_context_sha256 = H2; }, "PROJECTION_SCOPE_INVALID"],
  ["foreign row hash", doc => { doc.rows[0].sha256 = H2; }, "PROJECTION_ROW_BINDING_INVALID"],
  ["unknown dimension", doc => { doc.rows[0].dimensions.extra = true; }, "DIMENSION_UNKNOWN"],
  ["numeric row identity", doc => { doc.rows[0].id = 42; }, "PROJECTION_INVALID"],
  ["object row identity", doc => { doc.rows[0].id = {}; }, "PROJECTION_INVALID"],
  ["null row", doc => { doc.rows[0] = null; }, "PROJECTION_INVALID"],
  ["duplicate row", doc => { doc.rows.push(clone(doc.rows[0])); }, "PROJECTION_INVALID"],
]) await check(`projection rejects ${name}`, () => { const input = fixture(); editDocument(input, "accounts-public.v1", change); assert.throws(() => assess(input), code(expected)); });
for (const [name, change, expected] of [
  ["missing dimension", doc => { delete doc.rows[0].dimensions.flags; }, "DIMENSIONS_INADEQUATE"],
  ["mistyped dimension", doc => { doc.rows[0].dimensions.flags = "0"; }, "DIMENSIONS_INADEQUATE"],
  ["missing resource", doc => { doc.rows.pop(); }, "RESOURCE_PROJECTION_REQUIRED"],
  ["partial status", doc => { doc.status = "partial"; }, "PROJECTION_INCOMPLETE"],
  ["truncation", doc => { doc.truncated = true; }, "PROJECTION_INCOMPLETE"],
  ["collector error", doc => { doc.errors = ["ACCESS_DENIED"]; }, "PROJECTION_INCOMPLETE"],
  ["outside not observed", doc => { doc.outside_sha256 = null; }, "OUTSIDE_PROJECTION_REQUIRED"],
]) await check(`${name} cannot satisfy a required projection`, () => { const input = fixture(); editDocument(input, "accounts-public.v1", change); assert(gap(assess(input), expected)); });
for (const [name, change, expected] of [
  ["unelevated launcher", row => { row.launcher_elevated = false; }, "UAC_OUTSIDE_JOB_UNSUPPORTED"],
  ["no Job control", row => { row.job_tree_control = false; }, "JOB_CONTROL_UNAVAILABLE"],
  ["outside read ACL helper", row => { row.outside_read_acl_helper_pids = [123]; }, "OUTSIDE_READ_ACL_HELPER_PRESENT"],
  ["foreign controller", row => { row.controller_sha256 = H2; }, "CONTROL_BINDING_MISMATCH"],
  ["foreign runtime expansion", row => { row.runtime_paths_sha256 = H2; }, "CONTROL_BINDING_MISMATCH"],
  ["foreign prior deny paths", row => { row.prior_deny_read_paths_sha256 = H2; }, "CONTROL_BINDING_MISMATCH"],
  ["foreign network", row => { row.network_sha256 = H2; }, "CONTROL_BINDING_MISMATCH"],
]) await check(`${name} blocks process-control adequacy`, () => { const input = fixture(); editControl(input, change); const report = assess(input); assert(report.control.missing_requirements.includes(expected)); assert.equal(report.execution_available, false); });
for (const [field, expected] of [["runtime_expansion_complete", "RUNTIME_ACL_EXPANSION_INCOMPLETE"], ["prior_deny_read_expansion_complete", "PRIOR_DENY_READ_EXPANSION_INCOMPLETE"]])
  await check(`${field} must be observed`, () => { const input = fixture(); editControl(input, row => { row[field] = false; }); assert(gap(assess(input), expected)); });
await check("arbitrary control method cannot claim supported supervision", () => { const input = fixture(); input.operation.control.method = "UAC"; rebind(input); assert(assess(input).control.missing_requirements.includes("CONTROL_METHOD_UNSUPPORTED")); });
await check("physical file alias does not satisfy exact path observation", () => {
  const input = fixture(); editDocument(input, "filesystem-state.v1", doc => { doc.rows.find(row => row.dimensions.exists).dimensions.physical_path = "C:\\Other"; });
  assert(gap(assess(input), "PHYSICAL_PATH_MISMATCH"));
});
await check("unknown resource is not absence", () => {
  const input = fixture(); editDocument(input, "filesystem-state.v1", doc => { doc.rows.find(row => !row.dimensions.exists).dimensions.absence_reason = "access_denied"; });
  assert(gap(assess(input), "ABSENCE_NOT_ESTABLISHED"));
});
await check("secret credential contents are neither required nor accepted", () => {
  const input = fixture(); const id = `${input.manifest.profile_root}\\.sandbox-secrets\\sandbox_users.json`;
  assert.equal(input.observation.evidence.find(row => row.document.profile_id === "filesystem-state.v1").document.rows.find(row => row.id === id).dimensions.content_sha256, null);
  editDocument(input, "filesystem-state.v1", doc => { doc.rows.find(row => row.id === id).dimensions.content_sha256 = H; });
  assert(gap(assess(input), "SECRET_CONTENT_OBSERVATION_FORBIDDEN"));
});
for (const [profile, select, expected] of [
  ["filesystem-state.v1", id => id.endsWith("\\setup_marker.json"), "MARKER_REPLACEMENT_UNREPRESENTED"],
  ["filesystem-state.v1", id => id.endsWith("\\setup_error.json"), "EXACT_DELETION_UNREPRESENTED"],
  ["filesystem-state.v1", id => id.endsWith("\\.sandbox\\sandbox_users.json"), "EXACT_DELETION_UNREPRESENTED"],
  ["firewall-user-rules.v1", id => id.endsWith("allow_loopback_proxy"), "LEGACY_FIREWALL_DELETION_UNREPRESENTED"],
  ["wfp-filter.v1", () => true, "TRANSACTIONAL_WFP_REPLACEMENT_UNREPRESENTED"],
]) await check(`${expected} remains an explicit unsupported mechanism`, () => {
  const input = fixture(), requirement = assess(input).information.requirements.find(row => row.profile_id === profile), id = requirement.scope.selectors.find(select);
  input.inventory.resources.find(row => row.kind === requirement.kind && row.id === id).sha256 = H;
  editDocument(input, profile, doc => { const row = doc.rows.find(value => value.id === id); row.sha256 = H;
    row.dimensions = { exists: true, ...Object.fromEntries(requirement.dimensions.map(name => [name, dimension(name, id, input)])) }; });
  rebind(input); const report = assess(input); assert(report.unsupported_mechanisms.some(row => row.code === expected && row.ids.includes(id)));
  assert.equal(report.status, "REVIEWABLE_WITH_GAPS"); assert.equal(report.execution_available, false);
});
await check("local binding exposes exact loopback rule deletions", () => {
  const input = fixture(); input.operation.configuration.network.allow_local_binding = true; rebind(input);
  editControl(input, row => { row.network_sha256 = hash(input.operation.configuration.network); });
  assert.equal(assess(input).unsupported_mechanisms.filter(row => row.code === "LOOPBACK_FIREWALL_DELETION_UNREPRESENTED").length, 2);
});
await check("log rotation is an explicit gap rather than a delete permission", () => {
  const input = fixture(); editControl(input, row => { row.log_rotation_victims = [`${input.manifest.profile_root}\\.sandbox\\sandbox.2026-01-01.log`]; });
  assert(assess(input).unsupported_mechanisms.some(row => row.code === "LOG_ROTATION_DELETION_UNREPRESENTED"));
});
await check("input accessors are rejected without invoking them", () => {
  const input = fixture(); let invoked = false; Object.defineProperty(input.operation, "hidden", { enumerable: true, get() { invoked = true; return true; } });
  assert.throws(() => assess(input), code("JSON_INVALID")); assert.equal(invoked, false);
});
await check("module evaluation and assessment perform no filesystem, processes or ambient clock access", async () => {
  const input = fixture(), url = new URL("../../src/core/agents/codex-managed-sandbox-operation-policy.mjs", import.meta.url);
  const source = fs.readFileSync(url, "utf8").replace('"./agent-execution-contracts.mjs"', JSON.stringify(new URL("./agent-execution-contracts.mjs", url).href))
    .replace('"./codex-managed-sandbox-contracts.mjs"', JSON.stringify(new URL("./codex-managed-sandbox-contracts.mjs", url).href));
  const saved = [], trap = () => { throw new Error("UNEXPECTED_EFFECT"); }, replace = (target, name) => { saved.push([target, name, target[name]]); target[name] = trap; };
  try {
    for (const name of ["readFileSync", "writeFileSync", "openSync", "mkdirSync", "statSync", "readdirSync", "rmSync"]) replace(fs, name);
    for (const name of ["readFile", "writeFile", "open", "mkdir", "stat", "readdir", "rm"]) replace(fs.promises, name);
    for (const name of ["spawn", "spawnSync", "exec", "execSync", "execFile", "execFileSync", "fork"]) replace(childProcess, name);
    replace(process, "cwd"); replace(Date, "now"); syncBuiltinESMExports();
    const fresh = await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
    assert.equal(fresh.assessManagedSandboxOperationAdequacy(input).status, "REVIEWABLE"); assert.equal(fresh.getManagedSandboxOperationPolicy().execution_available, false);
  } finally { for (const [target, name, value] of saved.reverse()) target[name] = value; syncBuiltinESMExports(); }
});
const failures = checks.filter(row => row.status === "FAIL");
console.log(JSON.stringify({ ok: failures.length === 0, checks, pass: checks.length - failures.length, fail: failures.length, skip: 0,
  evidence: "pure-synthetic-contracts", native: "NOT_RUN", system_effects: "NOT_RUN", cleanup: "NOT_NEEDED" }, null, 2));
process.exitCode = failures.length ? 1 : 0;
