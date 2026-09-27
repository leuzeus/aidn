import { win32 as windows } from "node:path";
import { fingerprintAgentExecutionValue as hash } from "./agent-execution-contracts.mjs";
import { buildManagedSandboxPreparationPlan } from "./codex-managed-sandbox-contracts.mjs";

// Structural preparation review only. No collector, authenticity verifier,
// approval transport, launcher or Windows privilege adjustment lives here.
const ID = "codex-0.158.0-alpha.2.1-setup-start-legacy.v1";
const CLIENT = "8f0554ede25bbc5450921897c468b2e84635aa513c5017457997af0954581f49";
const SETUP = "987d744df3c1ba4d81580a75ac28864275e8c174c3e0fa9592fb2e3e0a257e74";
const RUNNER = "ed216441555458ab92c5b24b53bb6b4c6346b63a658636f5e2d428dbbf70f6c5";
const COMMIT = "0d9c7cbfa6cf1489f55a8a9542b75ddd2c061807";
const HASH = /^[a-f0-9]{64}$/u;
const TOKEN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const AGE = 300000;
const FIREWALL = ["codex_sandbox_offline_block_outbound", "codex_sandbox_offline_block_inbound", "codex_sandbox_offline_block_loopback_tcp", "codex_sandbox_offline_block_loopback_udp", "codex_sandbox_offline_allow_loopback_proxy"];
const WFP = ["2e31d31c-3948-4753-9117-e5d1a6496f41", "e65054fd-4d32-4c7c-95ef-621f0cf6431a", "9f5f3812-79f0-4fe9-9615-4c2c92d2f0ff", "87498484-45ab-4510-845e-ece8b791b3bc", "af4751de-f874-4a7b-a34d-f0d0f22d1d9b", "ea10db66-a928-4b2e-a82e-a376a54f93ba", "83172805-f6be-4ae1-9dc6-6847aef04e7f", "d23b2efb-1efb-46b2-96f3-b0ccda5690c8", "420b026f-9dc9-4aea-88f4-0f2b9feab39a", "8d917c81-99cc-45e7-84d6-824df860cfb8", "e1d6e0af-ce5f-471b-b2d3-15ca00e966f3", "c2bceca4-66ef-4a0f-ba80-f4f761b8c6f0", "ba10c618-84e7-4b83-8f74-36e22b2fa1ff", "fe7f22b8-5cf5-4adb-b2aa-71fc0a8f5d44"];
const ACCOUNTS = ["CodexSandboxOffline", "CodexSandboxOnline"];
const REGISTRY = "HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Winlogon\\SpecialAccounts\\UserList";
const PROFILES = [
  { profile_id: "accounts-public.v1", kind: "local_account", dimensions: ["sid", "flags", "password_last_set"] },
  { profile_id: "groups-membership.v1", kind: "local_group", dimensions: ["sid", "members"] },
  { profile_id: "filesystem-state.v1", kind: "filesystem", dimensions: ["physical_path", "file_id", "object_type", "attributes", "content_sha256"] },
  { profile_id: "filesystem-dacl.v1", kind: "filesystem_acl", dimensions: ["owner_sid", "group_sid", "dacl_sha256", "control_flags", "inheritance", "descendant_paths"] },
  { profile_id: "firewall-user-rules.v1", kind: "firewall_rule", dimensions: ["enabled", "profiles", "direction", "action", "protocol", "local_addresses", "remote_addresses", "local_ports", "remote_ports", "local_user_authorized_list", "policy_store_source", "policy_store_source_type", "enforcement_status"] },
  { profile_id: "wfp-provider.v1", kind: "wfp_rule", dimensions: ["provider_key", "persistent"] },
  { profile_id: "wfp-sublayer.v1", kind: "wfp_rule", dimensions: ["provider_key", "sublayer_key", "persistent", "weight"] },
  { profile_id: "wfp-filter.v1", kind: "wfp_rule", dimensions: ["provider_key", "sublayer_key", "layer_key", "action", "weight", "conditions", "persistent"] },
  { profile_id: "registry-userlist.v1", kind: "registry", dimensions: ["registry_view", "value_type", "value_data"] },
  { profile_id: "setup-control.v1", kind: "control", dimensions: ["configuration_sha256", "client_sha256", "setup_sha256", "launcher_sha256", "controller_sha256", "launcher_elevated", "job_tree_control", "outside_read_acl_helper_pids", "registered_core_requested", "service_enabled", "log_rotation_victims", "runtime_expansion_complete", "runtime_paths_sha256", "prior_deny_read_expansion_complete", "prior_deny_read_paths_sha256", "network_sha256"] },
];
function frozen(value) { if (value && typeof value === "object") { Object.values(value).forEach(frozen); Object.freeze(value); } return value; }
const POLICY = frozen({ contract_version: "codex-managed-sandbox-operation-policy.v1", policy_id: ID, client_sha256: CLIENT, setup_sha256: SETUP, command_runner_sha256: RUNNER,
  client_version: "0.158.0-alpha.2.1", source_commit: COMMIT, phase: "setupStart-legacy", max_age_ms: AGE,
  profiles: PROFILES, assessment: "STRUCTURAL_NOT_AUTHENTICATED", qualification: "NOT_RUN", execution_available: false });
const fail = code => { throw Object.assign(new Error(`MANAGED_OPERATION_${code}`), { code: `MANAGED_OPERATION_${code}` }); };
const ensure = (condition, code) => { if (!condition) fail(code); };
const object = value => value !== null && typeof value === "object" && !Array.isArray(value);
const exact = (value, keys) => object(value) && Object.keys(value).sort().join("|") === [...keys].sort().join("|");
const digest = value => typeof value === "string" && HASH.test(value);
const token = value => typeof value === "string" && TOKEN.test(value);
const string = value => typeof value === "string" && value.length > 0 && value.length <= 4096 && value.trim() === value && !/[\x00-\x1f\x7f]/u.test(value);
const key = value => value.toLowerCase();
const unique = rows => new Set(rows.map(key)).size === rows.length;
const array = (value, maximum = 512) => Array.isArray(value) && value.length <= maximum;
const same = (left, right) => hash(left) === hash(right);
function json(value) { try { hash(value); ensure(JSON.stringify(value).length <= 2 * 1024 * 1024, "DOCUMENT_LIMIT"); } catch (error) { if (error.code === "MANAGED_OPERATION_DOCUMENT_LIMIT") throw error; fail("JSON_INVALID"); } }
function absolute(value) { return string(value) && value.normalize("NFC") === value && /^[A-Za-z]:\\/u.test(value) && windows.normalize(value) === value && !value.endsWith("\\")
  && value.slice(3).split("\\").every(part => part.length > 0 && part.length <= 255 && !/[<>:"/|?*]|[. ]$/u.test(part) && !/^(?:con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/iu.test(part)); }
function time(value) { if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value)) return false;
  const n = Date.parse(value); return Number.isFinite(n) && new Date(n).toISOString() === value; }
const sorted = rows => [...new Set(rows)].sort();
function validateOperation(operation, manifest) {
  json(operation);
  ensure(exact(operation, ["contract_version", "policy_id", "manifest_sha256", "request", "configuration", "control"])
    && operation.contract_version === "codex-managed-sandbox-operation.v1" && token(operation.policy_id)
    && operation.manifest_sha256 === hash(manifest), "OPERATION_BINDING_INVALID");
  ensure(exact(operation.request, ["mode", "cwd"]) && operation.request.mode === "elevated" && absolute(operation.request.cwd), "REQUEST_INVALID");
  const config = operation.configuration;
  const paths = ["read_roots", "write_roots", "deny_read_paths", "prior_deny_read_paths", "deny_write_paths", "runtime_paths"];
  ensure(exact(config, ["configuration_sha256", "permission_profile_sha256", "environment_sha256", "registered_core_requested", "service_enabled", "network", ...paths])
    && [config.configuration_sha256, config.permission_profile_sha256, config.environment_sha256].every(digest)
    && [config.registered_core_requested, config.service_enabled].every(value => value === null || typeof value === "boolean")
    && paths.every(field => array(config[field]) && config[field].every(absolute) && unique(config[field])), "CONFIGURATION_INVALID");
  ensure(exact(config.network, ["allow_local_binding", "proxy_ports"]) && typeof config.network.allow_local_binding === "boolean"
    && array(config.network.proxy_ports, 64) && config.network.proxy_ports.every(port => Number.isSafeInteger(port) && port > 0 && port <= 65535)
    && new Set(config.network.proxy_ports).size === config.network.proxy_ports.length, "NETWORK_INVALID");
  ensure(exact(operation.control, ["method", "launcher_sha256", "controller_sha256"]) && string(operation.control.method)
    && digest(operation.control.launcher_sha256) && digest(operation.control.controller_sha256), "CONTROL_INVALID");
}
function requirementsFor(operation, manifest) {
  const home = manifest.profile_root, join = value => windows.join(home, value), config = operation.configuration;
  const selectors = {
    "accounts-public.v1": ACCOUNTS,
    "groups-membership.v1": ["CodexSandboxUsers", "S-1-5-32-545"],
    "filesystem-state.v1": [join(".sandbox"), join(".sandbox\\setup_marker.json"), join(".sandbox\\setup_error.json"), join(".sandbox\\sandbox_users.json"),
      join(".sandbox-secrets\\sandbox_users.json"), join(".sandbox\\deny_read_acl_state.json"), join("cap_sid"), join("config.toml"), manifest.client.executable, manifest.setup.executable, manifest.command_runner.executable],
    "filesystem-dacl.v1": [join(".sandbox"), join(".sandbox-secrets"), join(".sandbox-bin"), ...config.read_roots, ...config.write_roots, ...config.deny_read_paths, ...config.prior_deny_read_paths, ...config.deny_write_paths, ...config.runtime_paths],
    "firewall-user-rules.v1": FIREWALL, "wfp-provider.v1": WFP.slice(0, 1), "wfp-sublayer.v1": WFP.slice(1, 2), "wfp-filter.v1": WFP.slice(2),
    "registry-userlist.v1": ACCOUNTS.map(account => `${REGISTRY}#value=${account}`), "setup-control.v1": ["setupStart"],
  };
  return PROFILES.map(profile => ({ ...profile, scope: { scope_id: `${ID}:${profile.profile_id}`, kind: profile.kind, selectors: sorted(selectors[profile.profile_id]) } }));
}
export function getManagedSandboxOperationPolicy(policyId = ID) { ensure(policyId === ID, "POLICY_UNSUPPORTED"); return POLICY; }

function dimensionValue(name, value) {
  if (["enabled", "persistent", "launcher_elevated", "job_tree_control", "registered_core_requested", "service_enabled", "runtime_expansion_complete", "prior_deny_read_expansion_complete"].includes(name)) return typeof value === "boolean";
  if (name.endsWith("_sha256")) return digest(value) || name === "content_sha256" && value === null;
  if (["members", "descendant_paths", "log_rotation_victims", "outside_read_acl_helper_pids", "conditions"].includes(name)) {
    if (!array(value)) return false;
    if (name === "outside_read_acl_helper_pids") return value.every(pid => Number.isSafeInteger(pid) && pid > 0) && new Set(value).size === value.length;
    if (name === "conditions") return value.every(row => exact(row, ["field", "match", "type", "value"]) && [row.field, row.match, row.type].every(string) && row.value !== null);
    return value.every(string) && unique(value);
  }
  if (["flags", "attributes", "control_flags", "protocol"].includes(name)) return Number.isSafeInteger(value) && value >= 0;
  if (name === "password_last_set") return value === null || time(value);
  if (name === "physical_path") return absolute(value);
  if (name === "value_data") return Number.isSafeInteger(value) && value >= 0 && value <= 0xffffffff;
  if (name === "registry_view") return ["Registry32", "Registry64"].includes(value);
  return string(value);
}
function inspectObservation(observation, operation, inventory, requirements) {
  if (observation === null || observation === undefined) return { observer: null, documents: new Map() };
  json(observation);
  ensure(exact(observation, ["contract_version", "operation_sha256", "inventory_sha256", "observer", "observer_context", "observed_at", "receipts", "evidence"])
    && observation.contract_version === "codex-managed-sandbox-operation-observation.v1" && observation.operation_sha256 === hash(operation)
    && observation.inventory_sha256 === hash(inventory) && time(observation.observed_at), "OBSERVATION_BINDING_INVALID");
  const observer = observation.observer;
  ensure(exact(observer, ["observer_id", "script_sha256", "executable_sha256", "host_id", "context_sha256"])
    && token(observer.observer_id) && observer.host_id === inventory.host_id && [observer.script_sha256, observer.executable_sha256, observer.context_sha256].every(digest), "OBSERVER_INVALID");
  const context = observation.observer_context;
  ensure(exact(context, ["contract_version", "state", "host_id", "user_sid_sha256", "token_projection_sha256", "integrity_sid", "elevation_type", "elevated", "is_app_container", "has_restrictions", "restricted_sid_count", "process_bitness", "os_bitness", "powershell_version", "selected_modules"])
    && context.contract_version === "codex-managed-sandbox-observer-context.v1" && context.state === "observed" && context.host_id === observer.host_id
    && [context.user_sid_sha256, context.token_projection_sha256].every(digest) && typeof context.integrity_sid === "string" && /^S-1-16-\d{1,10}$/u.test(context.integrity_sid)
    && ["default", "full", "limited"].includes(context.elevation_type) && [context.elevated, context.is_app_container, context.has_restrictions].every(value => typeof value === "boolean")
    && Number.isSafeInteger(context.restricted_sid_count) && context.restricted_sid_count >= 0 && context.restricted_sid_count <= 65536
    && [32, 64].includes(context.process_bitness) && [32, 64].includes(context.os_bitness) && string(context.powershell_version)
    && array(context.selected_modules, 64) && context.selected_modules.every(row => exact(row, ["name", "manifest_path_sha256", "manifest_sha256"])
      && token(row.name) && digest(row.manifest_path_sha256) && digest(row.manifest_sha256))
    && unique(context.selected_modules.map(row => row.name)) && hash(context) === observer.context_sha256, "OBSERVER_CONTEXT_INVALID");
  ensure(array(observation.receipts, PROFILES.length) && array(observation.evidence, PROFILES.length)
    && new Set(observation.receipts.map(row => row?.profile_id)).size === observation.receipts.length
    && new Set(observation.evidence.map(row => row?.sha256)).size === observation.evidence.length, "RECEIPTS_AMBIGUOUS");
  const evidence = new Map();
  for (const entry of observation.evidence) {
    ensure(exact(entry, ["sha256", "document"]) && digest(entry.sha256) && entry.sha256 === hash(entry.document), "EVIDENCE_HASH_MISMATCH");
    evidence.set(entry.sha256, entry.document);
  }
  const used = new Set(), documents = new Map();
  for (const receipt of observation.receipts) {
    ensure(exact(receipt, ["profile_id", "scope_sha256", "evidence_sha256", "status"]) && digest(receipt.scope_sha256) && digest(receipt.evidence_sha256)
      && ["complete", "partial", "unavailable"].includes(receipt.status), "RECEIPT_INVALID");
    const requirement = requirements.find(row => row.profile_id === receipt.profile_id), document = evidence.get(receipt.evidence_sha256);
    ensure(requirement && document && !used.has(receipt.evidence_sha256), "EVIDENCE_BINDING_INVALID");
    used.add(receipt.evidence_sha256);
    ensure(exact(document, ["contract_version", "profile_id", "observer_context_sha256", "inventory_scope_sha256", "scope", "scope_sha256", "status", "rows", "outside_sha256", "truncated", "errors"])
      && document.contract_version === "codex-managed-sandbox-projection.v1" && document.profile_id === requirement.profile_id
      && document.observer_context_sha256 === observer.context_sha256 && document.status === receipt.status
      && document.scope_sha256 === receipt.scope_sha256 && document.scope_sha256 === hash(document.scope) && same(document.scope, requirement.scope), "PROJECTION_SCOPE_INVALID");
    const coverage = inventory.coverage.find(row => row.kind === requirement.kind);
    ensure(document.inventory_scope_sha256 === (coverage?.scope_sha256 ?? null), "INVENTORY_SCOPE_MISMATCH");
    ensure(array(document.rows) && document.rows.every(row => object(row) && typeof row.id === "string")
      && new Set(document.rows.map(row => key(row.id))).size === document.rows.length
      && typeof document.truncated === "boolean" && array(document.errors, 32) && document.errors.every(token)
      && (document.outside_sha256 === null || digest(document.outside_sha256)), "PROJECTION_INVALID");
    for (const row of document.rows) {
      ensure(exact(row, ["id", "sha256", "dimensions"]) && requirement.scope.selectors.includes(row.id) && object(row.dimensions)
        && (row.sha256 === null || digest(row.sha256)), "PROJECTION_ROW_INVALID");
      const dims = row.dimensions;
      ensure(Object.keys(dims).every(name => ["exists", "absence_reason", ...requirement.dimensions].includes(name)), "DIMENSION_UNKNOWN");
      if (requirement.kind !== "control") {
        const observed = [...inventory.resources, ...inventory.protected_resources].find(value => value.kind === requirement.kind && key(value.id) === key(row.id));
        ensure(observed && observed.sha256 === row.sha256, "PROJECTION_ROW_BINDING_INVALID");
      } else ensure(row.sha256 === hash(dims), "CONTROL_EVIDENCE_HASH_MISMATCH");
    }
    documents.set(requirement.profile_id, document);
  }
  ensure(used.size === evidence.size, "UNREFERENCED_EVIDENCE");
  return { observer, context, documents };
}

export function assessManagedSandboxOperationAdequacy({ manifest, inventory, operation, observation = null, at }) {
  // Reuse v1 validation without changing its conservative coverage semantics.
  const legacyPlan = buildManagedSandboxPreparationPlan({ manifest, inventory });
  validateOperation(operation, manifest); ensure(time(at), "TIME_REQUIRED");
  const requirements = requirementsFor(operation, manifest);
  const inspected = inspectObservation(observation, operation, inventory, requirements);
  const missing = [], control = [], mechanisms = [], satisfied = [];
  const gap = (code, profile_id = null, id = null) => missing.push({ code, profile_id, id });
  const controlGap = code => control.push(code);
  if (operation.policy_id !== ID) gap("POLICY_UNSUPPORTED");
  if (manifest.client.sha256 !== CLIENT) gap("CLIENT_UNQUALIFIED");
  if (manifest.setup.sha256 !== SETUP || manifest.command_runner.sha256 !== RUNNER) gap("SIDECAR_UNQUALIFIED");
  const config = operation.configuration;
  const legacy = config.registered_core_requested === false && config.service_enabled === false;
  if (!legacy) gap(config.registered_core_requested === null || config.service_enabled === null ? "ROUTE_UNKNOWN" : "SERVICE_ROUTE_UNSUPPORTED");
  if (operation.control.method !== "pre-elevated-job") controlGap("CONTROL_METHOD_UNSUPPORTED");
  const now = Date.parse(at), observed = Date.parse(inventory.observed_at);
  if (observed > now || now - observed > AGE) gap("INVENTORY_STALE_OR_FUTURE");
  if (!observation) gap("OBSERVATION_REQUIRED");
  else {
    const timestamp = Date.parse(observation.observed_at);
    if (timestamp > now || now - timestamp > AGE || timestamp < observed) gap("OBSERVATION_STALE_OR_FUTURE");
  }
  for (const requirement of requirements) {
    const document = inspected.documents.get(requirement.profile_id);
    if (!document) { gap("PROJECTION_REQUIRED", requirement.profile_id); continue; }
    if (document.status !== "complete" || document.truncated || document.errors.length) { gap("PROJECTION_INCOMPLETE", requirement.profile_id); continue; }
    if (requirement.kind !== "control" && !digest(document.outside_sha256)) { gap("OUTSIDE_PROJECTION_REQUIRED", requirement.profile_id); continue; }
    let complete = true;
    for (const id of requirement.scope.selectors) {
      const row = document.rows.find(value => value.id === id), dims = row?.dimensions;
      if (!dims) { gap("RESOURCE_PROJECTION_REQUIRED", requirement.profile_id, id); complete = false; continue; }
      if (dims.exists === false && requirement.kind !== "control") {
        if (!exact(dims, ["exists", "absence_reason"]) || dims.absence_reason !== "not_found" || row.sha256 !== null) { gap("ABSENCE_NOT_ESTABLISHED", requirement.profile_id, id); complete = false; }
        continue;
      }
      if (dims.exists !== true || row.sha256 === null || !exact(dims, ["exists", ...requirement.dimensions]) || !requirement.dimensions.every(name => dimensionValue(name, dims[name]))) {
        gap("DIMENSIONS_INADEQUATE", requirement.profile_id, id); complete = false;
      }
      if (dims.exists === true && requirement.kind === "filesystem" && dims.physical_path !== id) {
        gap("PHYSICAL_PATH_MISMATCH", requirement.profile_id, id); complete = false;
      }
      if (dims.exists === true && requirement.kind === "filesystem" && [windows.join(manifest.profile_root, ".sandbox-secrets\\sandbox_users.json"), windows.join(manifest.profile_root, ".sandbox\\sandbox_users.json")].includes(id)
        && dims.content_sha256 !== null) {
        gap("SECRET_CONTENT_OBSERVATION_FORBIDDEN", requirement.profile_id, id); complete = false;
      }
    }
    if (complete) satisfied.push(requirement.profile_id);
  }
  const validRow = (profile, id) => satisfied.includes(profile) ? inspected.documents.get(profile).rows.find(row => row.id === id) : null;
  const ctl = validRow("setup-control.v1", "setupStart")?.dimensions;
  if (!ctl) controlGap("CONTROL_OBSERVATION_REQUIRED");
  else {
    if (ctl.configuration_sha256 !== config.configuration_sha256 || ctl.client_sha256 !== manifest.client.sha256 || ctl.setup_sha256 !== manifest.setup.sha256
      || ctl.launcher_sha256 !== operation.control.launcher_sha256 || ctl.controller_sha256 !== operation.control.controller_sha256
      || ctl.registered_core_requested !== config.registered_core_requested || ctl.service_enabled !== config.service_enabled
      || ctl.runtime_paths_sha256 !== hash(config.runtime_paths) || ctl.prior_deny_read_paths_sha256 !== hash(config.prior_deny_read_paths)
      || ctl.network_sha256 !== hash(config.network) || ctl.launcher_elevated !== inspected.context.elevated) controlGap("CONTROL_BINDING_MISMATCH");
    if (!ctl.launcher_elevated) controlGap("UAC_OUTSIDE_JOB_UNSUPPORTED");
    if (!ctl.job_tree_control) controlGap("JOB_CONTROL_UNAVAILABLE");
    if (ctl.outside_read_acl_helper_pids.length) controlGap("OUTSIDE_READ_ACL_HELPER_PRESENT");
    if (!ctl.runtime_expansion_complete) gap("RUNTIME_ACL_EXPANSION_INCOMPLETE");
    if (!ctl.prior_deny_read_expansion_complete) gap("PRIOR_DENY_READ_EXPANSION_INCOMPLETE");
    if (ctl.log_rotation_victims.length) mechanisms.push({ code: "LOG_ROTATION_DELETION_UNREPRESENTED", kind: "filesystem", ids: ctl.log_rotation_victims });
  }
  const home = manifest.profile_root;
  for (const [profile, kind, ids, code] of [
    ["filesystem-state.v1", "filesystem", [windows.join(home, ".sandbox\\setup_marker.json")], "MARKER_REPLACEMENT_UNREPRESENTED"],
    ["filesystem-state.v1", "filesystem", [windows.join(home, ".sandbox\\setup_error.json"), windows.join(home, ".sandbox\\sandbox_users.json")], "EXACT_DELETION_UNREPRESENTED"],
    ["firewall-user-rules.v1", "firewall_rule", [FIREWALL[4]], "LEGACY_FIREWALL_DELETION_UNREPRESENTED"],
    ["wfp-filter.v1", "wfp_rule", WFP.slice(2), "TRANSACTIONAL_WFP_REPLACEMENT_UNREPRESENTED"],
  ]) for (const id of ids) if (validRow(profile, id)?.dimensions.exists === true) mechanisms.push({ code, kind, ids: [id] });
  if (config.network.allow_local_binding) for (const id of FIREWALL.slice(2, 4)) if (validRow("firewall-user-rules.v1", id)?.dimensions.exists === true)
    mechanisms.push({ code: "LOOPBACK_FIREWALL_DELETION_UNREPRESENTED", kind: "firewall_rule", ids: [id] });
  for (const pin of [manifest.client, manifest.setup, manifest.command_runner]) {
    const row = validRow("filesystem-state.v1", pin.executable);
    if (row && (row.sha256 !== pin.sha256 || row.dimensions.content_sha256 !== pin.sha256 || row.dimensions.physical_path !== pin.executable)) gap("EXECUTABLE_PIN_MISMATCH", "filesystem-state.v1", pin.executable);
  }
  const report = { contract_version: "codex-managed-sandbox-adequacy.v1", policy_id: ID, policy_sha256: hash(POLICY),
    operation_sha256: hash(operation), manifest_sha256: hash(manifest), inventory_sha256: hash(inventory), observation_sha256: observation ? hash(observation) : null,
    legacy_preparation_status: legacyPlan.status, assessed_at: at, assessment: "STRUCTURAL_NOT_AUTHENTICATED",
    status: missing.length || control.length || mechanisms.length ? "REVIEWABLE_WITH_GAPS" : "REVIEWABLE",
    information: { status: missing.length ? "INCOMPLETE" : "ADEQUATE_FOR_REVIEW", requirements, satisfied_requirements: satisfied, missing_requirements: missing },
    control: { status: control.length ? "UNAVAILABLE_OR_UNVERIFIED" : "DESCRIBED_NOT_QUALIFIED", missing_requirements: control,
      revalidate_before_operation: ["caller_elevated", "job_assignment_before_spawn", "outside_read_acl_helper_absent", "configuration_and_binary_pins"],
      completion_requires: ["setup_completed_notification", "setup_and_read_acl_descendants_stopped", "post_effect_comparison"] },
    approval: { status: "NOT_AUTHORIZED", operation_approval_supported: false }, unsupported_mechanisms: mechanisms,
    non_applicable: legacy ? [{ kind: "service", reason_code: "LEGACY_ROUTE_ONLY" }, { kind: "desktop", reason_code: "RUNNER_PHASE_ONLY" }, { kind: "device_acl", reason_code: "RUNNER_PHASE_ONLY" }] : [],
    residual_limits: [{ kind: "local_policy", reason_code: "NO_DIRECT_LSA_EFFECT_IDENTIFIED_TRANSITIVES_NOT_AUDITED" }, { kind: "filesystem", reason_code: "FAILURE_AND_TEMPORARY_OUTPUT_EFFECTS_REQUIRE_OPERATION_REVIEW" }],
    native: false, execution_available: false, confinement: "NOT_ASSESSED", qualification: "NOT_RUN" };
  return frozen({ ...report, report_sha256: hash(report) });
}
