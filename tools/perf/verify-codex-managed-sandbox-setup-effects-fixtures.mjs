import assert from "node:assert/strict";
import fs from "node:fs";
import childProcess from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
import { fingerprintAgentExecutionValue as hash } from "../../src/core/agents/agent-execution-contracts.mjs";
import { MANAGED_SANDBOX_RESOURCE_KINDS as kinds, buildManagedSandboxPreparationPlan, compareManagedSandboxInventory } from "../../src/core/agents/codex-managed-sandbox-contracts.mjs";
import { assessManagedSandboxOperationAdequacy as assess, getManagedSandboxOperationPolicy as policy } from "../../src/core/agents/codex-managed-sandbox-operation-policy.mjs";
import { getManagedSandboxSetupEffectsPolicy as setupPolicy, buildManagedSandboxSetupEffectsPlan as buildEffects,
  compareManagedSandboxSetupEffects as compareEffects } from "../../src/core/agents/codex-managed-sandbox-setup-effects.mjs";
const H = "a".repeat(64), H2 = "b".repeat(64), NOW = "2026-09-27T12:02:00.000Z", checks = [];
const clone = value => structuredClone(value);
async function check(name, fn) { try { await fn(); checks.push({ name, status: "PASS" }); }
  catch (error) { checks.push({ name, status: "FAIL", detail: String(error.stack ?? error).slice(0, 2200) }); } }

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

const setupCode = value => error => error.code === `MANAGED_SETUP_EFFECTS_${value}`;
function changeResource(input, profile, id, dimensions, sha256 = H2) {
  const row = [...input.inventory.resources, ...input.inventory.protected_resources].find(value => value.id === id
    && value.kind === assess(input).information.requirements.find(req => req.profile_id === profile).kind);
  row.sha256 = dimensions.exists ? sha256 : null;
  editDocument(input, profile, doc => Object.assign(doc.rows.find(value => value.id === id), { sha256: row.sha256, dimensions }));
  rebind(input);
}
function setupDetails(input, entries = []) {
  const profiles = [
    ["setup-config.v1", "config.toml", { exists: true, content_sha256: H, keys: setupPolicy().config_keys.map(key => ({ key, present: false, value: null })), unrelated_sha256: H, features_table_present: true }],
    ["sandbox-logs.v1", ".sandbox", { entries }],
  ];
  const details = { contract_version: "codex-managed-sandbox-setup-details.v1", manifest_sha256: hash(input.manifest),
    operation_sha256: hash(input.operation), inventory_sha256: hash(input.inventory), observation_sha256: hash(input.observation),
    observer_context_sha256: input.observation.observer.context_sha256, observed_at: NOW, receipts: [], evidence: [] };
  for (const [profile_id, suffix, dimensions] of profiles) {
    const path = input.manifest.profile_root + "\\" + suffix;
    const original = input.observation.evidence.find(row => row.document.profile_id === "filesystem-state.v1").document.rows.find(row => row.id === path);
    const scope = { policy_id: setupPolicy().contract_version, profile_id, selectors: [path] };
    const document = { contract_version: "codex-managed-sandbox-setup-projection.v1", profile_id,
      observer_context_sha256: details.observer_context_sha256, scope, scope_sha256: hash(scope), status: "complete",
      resource_sha256: original.sha256, dimensions, outside_sha256: H, truncated: false, errors: [] };
    details.evidence.push({ sha256: hash(document), document });
    details.receipts.push({ profile_id, scope_sha256: hash(scope), evidence_sha256: hash(document), status: "complete" });
  }
  input.details = details; return input;
}
function editDetail(input, profile, edit) {
  const entry = input.details.evidence.find(row => row.document.profile_id === profile); edit(entry.document);
  entry.sha256 = hash(entry.document);
  const receipt = input.details.receipts.find(row => row.profile_id === profile);
  receipt.evidence_sha256 = entry.sha256; receipt.scope_sha256 = entry.document.scope_sha256; receipt.status = entry.document.status;
}
function bindDetails(input) {
  if (!input.details) return;
  Object.assign(input.details, { manifest_sha256: hash(input.manifest), operation_sha256: hash(input.operation),
    inventory_sha256: hash(input.inventory), observation_sha256: hash(input.observation) });
}
function fullFixture() { return setupDetails(fixture()); }
function successfulPair() {
  const before = fullFixture(), after = clone(before), home = before.manifest.profile_root;
  const fsEntry = after.observation.evidence.find(row => row.document.profile_id === "filesystem-state.v1");
  const marker = fsEntry.document.rows.find(row => row.id.endsWith("\\setup_marker.json"));
  changeResource(after, "filesystem-state.v1", marker.id, { exists: true, physical_path: marker.id, file_id: "fixture-id",
    object_type: "file", attributes: 0, content_sha256: H2 });
  const r = assess(after);
  const provider = r.information.requirements.find(row => row.profile_id === "wfp-provider.v1").scope.selectors[0];
  const sublayer = r.information.requirements.find(row => row.profile_id === "wfp-sublayer.v1").scope.selectors[0];
  for (const id of r.information.requirements.find(row => row.profile_id === "wfp-filter.v1").scope.selectors)
    changeResource(after, "wfp-filter.v1", id, { exists: true, provider_key: provider, sublayer_key: sublayer,
      layer_key: "fixture-layer", action: "fixture-block", weight: "fixture-weight", conditions: [], persistent: true });
  editDetail(after, "setup-config.v1", doc => { doc.dimensions.keys[0] = { key: "windows.sandbox", present: true, value: "elevated" }; });
  editDetail(after, "sandbox-logs.v1", doc => { doc.dimensions.entries = [{ path: home + "\\.sandbox\\sandbox.2026-09-27.log", sha256: H, bytes: 42, prefixes: [], created_at: "2026-09-26T00:00:00.000Z", object_type: "file", reparse: false }]; });
  bindDetails(after);
  return { before, after };
}
await check("recipes and hashes are deterministic, frozen, pure and never authorize execution", () => {
  const input = fullFixture(), original = clone(input), plan = buildEffects(input);
  assert.deepEqual(input, original); assert(Object.isFrozen(plan.recipes));
  assert.equal(plan.recipes.length, 7); assert.equal(plan.native, false); assert.equal(plan.execution_available, false);
  assert.equal(plan.authorization, "NOT_AUTHORIZED"); assert.equal(plan.qualification, "NOT_RUN");
  assert.equal(plan.complete_effect_coverage, false); assert.equal(plan.plan_sha256, buildEffects(input).plan_sha256);
  const { plan_sha256, ...content } = plan; assert.equal(plan_sha256, hash(content));
  assert.equal(buildManagedSandboxPreparationPlan(input).status, "PREPARATION_BLOCKED");
});
await check("complete structural postconditions remain INCOMPLETE without native or complete coverage claims", () => {
  const pair = successfulPair(), result = compareEffects(pair);
  assert.deepEqual(result.violations, []); assert.equal(result.status, "INCOMPLETE"); assert.equal(result.native, false);
  assert.equal(result.execution_available, false); assert.equal(result.complete_effect_coverage, false);
  assert(result.residual_gaps.includes("WFP_FILTER_SEMANTICS_NOT_VERIFIED"));
});
await check("missing receipt cannot manufacture a preimage from a complete flag", () => {
  const input = fixture(); input.observation.receipts = []; input.observation.evidence = []; rebind(input);
  const plan = buildEffects(input); assert.equal(plan.recipes.length, 0); assert(plan.residual_gaps.includes("SETUP_DETAILS_REQUIRED"));
});
await check("partial supplemental projection is an explicit gap", () => {
  const input = fullFixture(); editDetail(input, "setup-config.v1", doc => { doc.status = "partial"; doc.outside_sha256 = null; });
  assert(!buildEffects(input).recipes.some(row => row.recipe_id === "setup-config-edit"));
});
await check("old inventory comparator continues to refuse delete", () => {
  const input = fullFixture(); input.inventory.coverage.forEach(row => Object.assign(row, { complete: true, outside_authority_sha256: H, reason_code: null }));
  const after = clone(input.inventory); after.resources[0].sha256 = null;
  const result = compareManagedSandboxInventory({ manifest: input.manifest, before: input.inventory, after });
  assert.equal(result.status, "REFUSED"); assert(result.violations.some(row => row.code === "DELETE_FORBIDDEN"));
});
for (const [field, value] of [["policy_id", "foreign"], ["service_enabled", true], ["registered_core_requested", true]]) await check(`fixed route refuses ${field}`, () => {
  const input = fullFixture(); if (field === "policy_id") input.operation[field] = value; else input.operation.configuration[field] = value;
  rebind(input); bindDetails(input); assert.equal(buildEffects(input).recipes.length, 0);
});
for (const field of ["client", "setup", "command_runner"]) await check(`foreign ${field} pin cannot acquire recipes`, () => {
  const input = fullFixture(); input.manifest[field].sha256 = H2; rebind(input); bindDetails(input);
  assert.equal(buildEffects(input).recipes.length, 0);
});
for (const field of ["manifest_sha256", "operation_sha256", "inventory_sha256", "observation_sha256", "observer_context_sha256"]) await check(`reject foreign detail ${field}`, () => {
  const input = fullFixture(); input.details[field] = H2; assert.throws(() => buildEffects(input), setupCode("DETAIL_BINDING_INVALID"));
});
for (const [name, edit, code] of [
  ["unknown key", doc => { doc.dimensions.keys[0].key = "secret.token"; }, "CONFIG_KEY_INVALID"],
  ["injected value", doc => { doc.dimensions.keys[0].present = true; doc.dimensions.keys[0].value = "arbitrary"; }, "CONFIG_KEY_INVALID"],
  ["raw secret contents", doc => { doc.dimensions.content = "not accepted"; }, "CONFIG_DIMENSIONS_INVALID"],
  ["foreign preimage", doc => { doc.resource_sha256 = H2; }, "DETAIL_PREIMAGE_MISMATCH"],
  ["foreign scope", doc => { doc.scope.selectors = ["C:\\foreign"]; doc.scope_sha256 = hash(doc.scope); }, "DETAIL_PROJECTION_INVALID"],
  ["false content hash", doc => { doc.dimensions.content_sha256 = H2; }, "CONFIG_DIMENSIONS_INVALID"],
]) await check(`rejects ${name}`, () => {
  const input = fullFixture(); editDetail(input, "setup-config.v1", edit); assert.throws(() => buildEffects(input), setupCode(code));
});
await check("tampered evidence rejected", () => {
  const input = fullFixture(); input.details.evidence[0].document.status = "partial";
  assert.throws(() => buildEffects(input), setupCode("DETAIL_EVIDENCE_INVALID"));
});
await check("duplicate receipts rejected", () => {
  const input = fullFixture(); input.details.receipts[1] = clone(input.details.receipts[0]);
  assert.throws(() => buildEffects(input), setupCode("DETAIL_RECEIPT_INVALID"));
});
await check("detail time must bind a fresh post-observer receipt", () => {
  const input = fullFixture(); input.details.observed_at = "2020-01-01T00:00:00.000Z";
  assert.throws(() => buildEffects(input), setupCode("DETAIL_TIME_INVALID"));
});
for (const path of ["C:\\outside.log", "C:\\Codex Équipe\\.sandbox\\*.log", "C:\\Codex Équipe\\.sandbox\\..\\sandbox.2026-02-30.log",
  "C:\\Codex Équipe\\.sandbox\\sandbox.2026-09-27.log."]) await check(`rejects nonexact log ${path}`, () => {
  const input = fullFixture(); editDetail(input, "sandbox-logs.v1", doc => { doc.dimensions.entries = [{ path, bytes: 1, sha256: H, prefixes: [], created_at: "2026-09-26T00:00:00.000Z", object_type: "file", reparse: false }]; });
  assert.throws(() => buildEffects(input), setupCode("LOG_DIMENSIONS_INVALID"));
});
await check("log duplicate alias and absent digest rejected", () => {
  for (const invalid of ["duplicate", "hash"]) {
    const input = fullFixture(), row = { path: input.manifest.profile_root + "\\.sandbox\\sandbox.2026-09-26.log", sha256: H, bytes: 1, prefixes: [], created_at: "2026-09-26T00:00:00.000Z", object_type: "file", reparse: false };
    editDetail(input, "sandbox-logs.v1", doc => { doc.dimensions.entries = invalid === "duplicate" ? [row, clone(row)] : [{ ...row, sha256: null }]; });
    assert.throws(() => buildEffects(input), setupCode("LOG_DIMENSIONS_INVALID"));
  }
});
await check("unrelated config drift is refused", () => {
  const pair = successfulPair(); editDetail(pair.after, "setup-config.v1", doc => { doc.dimensions.unrelated_sha256 = H2; });
  assert(compareEffects(pair).violations.some(row => row.code === "UNRELATED_CONFIG_CHANGED"));
});
await check("missing elevated mode and remaining legacy key each refused", () => {
  for (const index of [0, 1]) {
    const pair = successfulPair(); editDetail(pair.after, "setup-config.v1", doc => { doc.dimensions.keys[index].present = index !== 0; doc.dimensions.keys[index].value = index ? true : null; });
    assert(compareEffects(pair).violations.some(row => row.code === "CONFIG_POSTCONDITION_MISMATCH"));
  }
});
await check("a caller recipe never permits an unmodeled deletion", () => {
  const pair = successfulPair(), id = pair.after.manifest.profile_root + "\\cap_sid";
  changeResource(pair.after, "filesystem-state.v1", id, { exists: false, absence_reason: "not_found" });
  bindDetails(pair.after); pair.before.recipes = [{ recipe_id: "delete", target: id }];
  const report = compareEffects(pair); assert.equal(report.status, "REFUSED"); assert(report.violations.some(row => row.code === "UNMODELED_DELETION" && row.id === id));
});
await check("unlisted loopback removal refused when local binding disabled", () => {
  const pair = successfulPair(), id = "codex_sandbox_offline_block_loopback_tcp";
  changeResource(pair.after, "firewall-user-rules.v1", id, { exists: false, absence_reason: "not_found" });
  bindDetails(pair.after); assert(compareEffects(pair).violations.some(row => row.code === "UNMODELED_DELETION"));
});
await check("post provider or persistence mismatch refused independently from unknown semantics", () => {
  for (const field of ["provider_key", "persistent"]) {
    const pair = successfulPair();
    editDocument(pair.after, "wfp-filter.v1", doc => { doc.rows[0].dimensions[field] = field === "persistent" ? false : "other"; });
    rebind(pair.after); bindDetails(pair.after); assert(compareEffects(pair).violations.some(row => row.code === "WFP_BINDING_MISMATCH"));
  }
});
await check("outside projection drift refused despite partial legacy inventory", () => {
  const pair = successfulPair(); editDocument(pair.after, "accounts-public.v1", doc => { doc.outside_sha256 = H2; });
  rebind(pair.after); bindDetails(pair.after); assert(compareEffects(pair).violations.some(row => row.code === "OUTSIDE_PROJECTION_CHANGED"));
});
await check("outside supplemental drift refused", () => {
  const pair = successfulPair(); editDetail(pair.after, "sandbox-logs.v1", doc => { doc.outside_sha256 = H2; });
  assert(compareEffects(pair).violations.some(row => row.code === "OUTSIDE_DETAIL_CHANGED"));
});
await check("new daily log only and prefix proof for old bytes required", () => {
  const pair = successfulPair(), path = pair.before.manifest.profile_root + "\\.sandbox\\sandbox.2026-09-27.log";
  editDetail(pair.before, "sandbox-logs.v1", doc => { doc.dimensions.entries = [{ path, bytes: 10, sha256: H2, prefixes: [], created_at: "2026-09-26T00:00:00.000Z", object_type: "file", reparse: false }]; });
  assert(compareEffects(pair).violations.some(row => row.code === "LOG_APPEND_PREFIX_MISMATCH"));
  editDetail(pair.after, "sandbox-logs.v1", doc => { doc.dimensions.entries[0].prefixes = [{ bytes: 10, sha256: H2 }]; });
  assert.deepEqual(compareEffects(pair).violations, []);
});
await check("ordinary retained log cannot change or disappear", () => {
  for (const remove of [true, false]) {
    const pair = successfulPair(), path = pair.before.manifest.profile_root + "\\.sandbox\\sandbox.2026-09-26.log";
    editDetail(pair.before, "sandbox-logs.v1", doc => { doc.dimensions.entries = [{ path, bytes: 10, sha256: H2, prefixes: [], created_at: "2026-09-26T00:00:00.000Z", object_type: "file", reparse: false }]; });
    if (!remove) editDetail(pair.after, "sandbox-logs.v1", doc => { doc.dimensions.entries.push({ path, bytes: 11, sha256: H, prefixes: [], created_at: "2026-09-26T00:00:00.000Z", object_type: "file", reparse: false }); });
    assert.equal(compareEffects(pair).status, "REFUSED");
  }
});
await check("details accessors rejected without invocation", () => {
  const input = fullFixture(); let called = false; Object.defineProperty(input.details, "secret", { enumerable: true, get() { called = true; return 1; } });
  assert.throws(() => buildEffects(input), setupCode("JSON_INVALID")); assert.equal(called, false);
});
await check("material preimage changes invalidate the plan", () => {
  const input = fullFixture(), before = buildEffects(input).plan_sha256;
  editDetail(input, "setup-config.v1", doc => { doc.dimensions.unrelated_sha256 = H2; });
  assert.notEqual(buildEffects(input).plan_sha256, before);
});
await check("model evaluation performs no filesystem, process or ambient clock access", async () => {
  const saved = [], forbid = () => { throw new Error("IMPLICIT_EFFECT"); };
  for (const [owner, names] of [[fs, ["readFileSync", "writeFileSync", "readdirSync", "statSync"]], [childProcess, ["spawn", "spawnSync", "exec", "execSync"]], [Date, ["now"]]]) {
    for (const name of names) { saved.push([owner, name, owner[name]]); owner[name] = forbid; }
  }
  syncBuiltinESMExports();
  try { const module = await import("../../src/core/agents/codex-managed-sandbox-setup-effects.mjs?purity"); module.buildManagedSandboxSetupEffectsPlan(fullFixture()); }
  finally { for (const [owner, name, method] of saved) owner[name] = method; syncBuiltinESMExports(); }
});

function logEntry(input, name, day, overrides = {}) {
  return { path: input.manifest.profile_root + "\\.sandbox\\" + name, bytes: 10, sha256: H, prefixes: [],
    created_at: new Date(Date.UTC(2026, 0, day)).toISOString(), object_type: "file", reparse: false, ...overrides };
}
await check("all three legacy config keys are fixed and the empty features table is preserved", () => {
  assert.deepEqual(setupPolicy().config_keys, ["windows.sandbox", "features.experimental_windows_sandbox",
    "features.elevated_windows_sandbox", "features.enable_experimental_windows_sandbox"]);
  const pair = successfulPair(); editDetail(pair.after, "setup-config.v1", doc => { doc.dimensions.features_table_present = false; });
  assert(compareEffects(pair).violations.some(row => row.code === "FEATURES_TABLE_CHANGED"));
});
await check("marker replacement is conditional and includes only fixed v5 identities", () => {
  const input = fullFixture(), recipe = buildEffects(input).recipes.find(row => row.recipe_id === "setup-marker-replace");
  assert.equal(recipe.condition, "initial_provisioning_only_not_refresh_or_read_acls_only");
  assert.equal(recipe.expected_marker.version, 5); assert.deepEqual(recipe.expected_marker.read_roots, []);
  assert.deepEqual(recipe.expected_marker.write_roots, []); assert.equal(recipe.expected_marker.offline_username, "CodexSandboxOffline");
  assert(recipe.limitations.includes("PROVISIONING_BRANCH_AND_MARKER_CONTENT_NOT_OBSERVED"));
});
await check("an already equal sandbox mode still models the official atomic config write", () => {
  const input = fullFixture(); editDetail(input, "setup-config.v1", doc => { doc.dimensions.keys[0] = { key: "windows.sandbox", present: true, value: "elevated" }; });
  const plan = buildEffects(input), recipe = plan.recipes.find(row => row.recipe_id === "setup-config-edit");
  assert.equal(recipe.condition, "after_successful_setup_even_if_semantic_values_equal");
  assert.equal(recipe.atomic_temporary_identity, "NOT_REPRESENTED");
  assert.equal(plan.branch_model.initial_provisioning, "conditional_not_established_by_metadata");
  assert.equal(plan.branch_model.credentials_content_observed, false);
});
await check("a full refresh may preserve the complete WFP preimage without proving network correctness", () => {
  const pair = successfulPair();
  const original = pair.before.observation.evidence.find(row => row.document.profile_id === "wfp-filter.v1");
  for (const row of original.document.rows) changeResource(pair.after, "wfp-filter.v1", row.id, clone(row.dimensions));
  bindDetails(pair.after);
  const result = compareEffects(pair);
  assert.deepEqual(result.violations, []); assert.equal(result.status, "INCOMPLETE");
  assert(result.residual_gaps.includes("WFP_FILTER_SEMANTICS_NOT_VERIFIED"));
  assert.equal(buildEffects(pair.before).recipes.find(row => row.recipe_id === "codex-wfp-filter-transaction").condition,
    "initial_provisioning_only_not_full_refresh");
});
await check("ninety matching logs prune one oldest preimage before opening, including non-daily filenames", () => {
  const input = fullFixture(), rows = Array.from({ length: 90 }, (_, i) => logEntry(input, `sandbox-${i.toString(16).padStart(16, "0")}.log`, i + 1));
  editDetail(input, "sandbox-logs.v1", doc => { doc.dimensions.entries = [...rows].reverse(); });
  editControl(input, d => { d.log_rotation_victims = [rows[0].path]; }); bindDetails(input);
  const recipe = buildEffects(input).recipes.find(row => row.recipe_id === "sandbox-log-append-and-retention");
  assert.deepEqual(recipe.victims, [rows[0].path]); assert.equal(recipe.prune_before_open, true); assert.equal(recipe.retention_limit, 90);
  assert(!recipe.victims.includes(recipe.current_path));
});
await check("retention does not exempt the current filename when its creation is oldest", () => {
  const input = fullFixture(), rows = Array.from({ length: 90 }, (_, i) => logEntry(input, i ? `sandbox-${i}.log` : "sandbox.2026-09-27.log", i + 1));
  editDetail(input, "sandbox-logs.v1", doc => { doc.dimensions.entries = rows; });
  editControl(input, d => { d.log_rotation_victims = [rows[0].path]; }); bindDetails(input);
  const recipe = buildEffects(input).recipes.find(row => row.recipe_id === "sandbox-log-append-and-retention");
  assert.deepEqual(recipe.victims, [recipe.current_path]);
});
await check("ninety-one logs prune N-89 and equal cutoff creation timestamps leave a gap", () => {
  const input = fullFixture(), rows = Array.from({ length: 91 }, (_, i) => logEntry(input, `sandbox-${i}.log`, i + 1));
  editDetail(input, "sandbox-logs.v1", doc => { doc.dimensions.entries = rows; });
  editControl(input, d => { d.log_rotation_victims = rows.slice(0, 2).map(row => row.path); }); bindDetails(input);
  assert.equal(buildEffects(input).recipes.find(row => row.recipe_id === "sandbox-log-append-and-retention").victims.length, 2);
  editDetail(input, "sandbox-logs.v1", doc => { doc.dimensions.entries[2].created_at = doc.dimensions.entries[1].created_at; });
  const report = buildEffects(input); assert(report.residual_gaps.includes("LOG_RETENTION_CUTOFF_AMBIGUOUS"));
  assert(!report.recipes.some(row => row.recipe_id === "sandbox-log-append-and-retention"));
});
await check("caller control victims cannot name an extra deletion", () => {
  const input = fullFixture(); editControl(input, d => { d.log_rotation_victims = [input.manifest.profile_root + "\\config.toml"]; }); bindDetails(input);
  const report = buildEffects(input); assert(report.residual_gaps.includes("LOG_VICTIM_SET_MISMATCH"));
  assert(!report.recipes.some(row => row.recipe_id === "sandbox-log-append-and-retention"));
});
await check("reparse or non-file log entries and unknown creation times are not represented", () => {
  for (const overrides of [{ reparse: true }, { object_type: "directory" }, { created_at: null }, { created_at: "2027-01-01T00:00:00.000Z" }]) {
    const input = fullFixture(); editDetail(input, "sandbox-logs.v1", doc => { doc.dimensions.entries = [logEntry(input, "sandbox-one.log", 1, overrides)]; });
    assert.throws(() => buildEffects(input), setupCode("LOG_DIMENSIONS_INVALID"));
  }
});
await check("a deletion is modeled only for exact existing legacy preimages", () => {
  const pair = successfulPair(), id = pair.before.manifest.profile_root + "\\.sandbox\\sandbox_users.json";
  changeResource(pair.before, "filesystem-state.v1", id, { exists: true, physical_path: id, file_id: "fixture-file", object_type: "file",
    attributes: 0, content_sha256: null });
  bindDetails(pair.before);
  const recipe = buildEffects(pair.before).recipes.find(row => row.recipe_id === "exact-legacy-cleanup" && row.preimages[0].id === id);
  assert.equal(recipe.preimages[0].dimensions.content_sha256, null);
  assert.deepEqual(compareEffects(pair).violations, []);
});
await check("pure comparison preserves input objects and rejects reversed time", () => {
  const pair = successfulPair(), saved = clone(pair); compareEffects(pair); assert.deepEqual(pair, saved);
  pair.after.at = "2026-09-27T12:01:59.000Z"; pair.after.details.observed_at = pair.after.at;
  assert(compareEffects(pair).violations.some(row => row.code === "TIME_REVERSED"));
});

await check("document limit counts UTF-8 bytes rather than UTF-16 string units", () => {
  const input = fullFixture(); input.details.padding = "é".repeat(1100000);
  const encoded = JSON.stringify(input.details), limit = setupPolicy().limits.document_bytes;
  assert(encoded.length < limit); assert(Buffer.byteLength(encoded, "utf8") > limit);
  assert.throws(() => buildEffects(input), setupCode("DOCUMENT_LIMIT"));
});
const failed = checks.filter(row => row.status === "FAIL");
console.log(JSON.stringify({ ok: failed.length === 0, checks, pass: checks.length - failed.length, fail: failed.length, skip: 0,
  evidence: "pure-synthetic-receipts-and-comparison", native: "NOT_RUN", system_effects: "NOT_RUN", cleanup: "NOT_NEEDED" }, null, 2));
process.exitCode = failed.length ? 1 : 0;

