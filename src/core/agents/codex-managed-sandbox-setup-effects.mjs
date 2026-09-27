import { win32 as windows } from "node:path";
import { fingerprintAgentExecutionValue as hash } from "./agent-execution-contracts.mjs";
import { assessManagedSandboxOperationAdequacy as assess, getManagedSandboxOperationPolicy } from "./codex-managed-sandbox-operation-policy.mjs";

// A closed model of selected official effects, not a writer, approval, observer
// authenticator, replacement for v1, or evidence that Windows executed a recipe.
const BASE = getManagedSandboxOperationPolicy();
const ID = "codex-managed-sandbox-setup-effects.v1";
const CONFIG_KEYS = ["windows.sandbox", "features.experimental_windows_sandbox", "features.elevated_windows_sandbox", "features.enable_experimental_windows_sandbox"];
const LEGACY_PROXY = "codex_sandbox_offline_allow_loopback_proxy";
const LOOPBACK = ["codex_sandbox_offline_block_loopback_tcp", "codex_sandbox_offline_block_loopback_udp"];
const LIMITS = { entries: 256, receipts: 2, document_bytes: 2 * 1024 * 1024, observed_log_bytes: 1073741824 };
const FIXED_GAPS = ["OBSERVATIONS_NOT_AUTHENTICATED", "TRANSACTION_AND_PROCESS_PROVENANCE_NOT_OBSERVED",
  "ACL_CAPABILITY_AND_RUNTIME_EFFECTS_OUTSIDE_DELTA", "ATOMIC_TEMPORARY_FILES_OUTSIDE_DELTA",
  "FAILURE_PATH_EFFECTS_OUTSIDE_DELTA", "WFP_FILTER_SEMANTICS_NOT_VERIFIED", "PROVISIONING_BRANCH_AND_MARKER_CONTENT_NOT_OBSERVED", "SUBSEQUENT_LOG_ROTATIONS_NOT_MODELED"];
const FLAGS = { native: false, execution_available: false, authorization: "NOT_AUTHORIZED",
  qualification: "NOT_RUN", assessment: "STRUCTURAL_NOT_AUTHENTICATED" };
const fail = code => { throw Object.assign(new Error(`MANAGED_SETUP_EFFECTS_${code}`), { code: `MANAGED_SETUP_EFFECTS_${code}` }); };
const ensure = (value, code) => { if (!value) fail(code); };
const object = value => value !== null && typeof value === "object" && !Array.isArray(value);
const exact = (value, fields) => object(value) && Object.keys(value).sort().join("|") === [...fields].sort().join("|");
const digest = value => typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
const list = (value, max = LIMITS.entries) => Array.isArray(value) && value.length <= max;
const same = (a, b) => hash(a) === hash(b);
const lower = value => value.toLowerCase();
const copy = value => structuredClone(value);
function frozen(value) { if (value && typeof value === "object") { Object.values(value).forEach(frozen); Object.freeze(value); } return value; }
function json(value) {
  try { hash(value); ensure(Buffer.byteLength(JSON.stringify(value), "utf8") <= LIMITS.document_bytes, "DOCUMENT_LIMIT"); }
  catch (error) { if (error.code === "MANAGED_SETUP_EFFECTS_DOCUMENT_LIMIT") throw error; fail("JSON_INVALID"); }
}
function stamp(value) { return typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value)
  && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value; }
function policy() {
  return { contract_version: ID, base_policy_id: BASE.policy_id, base_policy_sha256: hash(BASE),
    client_sha256: BASE.client_sha256, setup_sha256: BASE.setup_sha256, command_runner_sha256: BASE.command_runner_sha256,
    source_commit: BASE.source_commit, phase: BASE.phase, recipe_ids: ["setup-marker-replace", "codex-wfp-filter-transaction",
      "setup-config-edit", "sandbox-log-append-and-retention", "exact-legacy-cleanup"],
    config_keys: CONFIG_KEYS, log_retention_files: 90, limits: LIMITS, residual_gaps: FIXED_GAPS, ...FLAGS };
}
const POLICY = frozen(policy());
export function getManagedSandboxSetupEffectsPolicy() { return POLICY; }

function projection(input, report, profile) {
  if (!report.information.satisfied_requirements.includes(profile)) return null;
  const receipt = input.observation?.receipts.find(row => row.profile_id === profile);
  const evidence = input.observation?.evidence.find(row => row.sha256 === receipt?.evidence_sha256);
  return evidence ? { receipt, document: evidence.document } : null;
}
function preimage(input, report, profile, id) {
  const found = projection(input, report, profile), row = found?.document.rows.find(value => value.id === id);
  return row ? { profile_id: profile, id, resource_sha256: row.sha256, dimensions: copy(row.dimensions),
    evidence_sha256: found.receipt.evidence_sha256, scope_sha256: found.receipt.scope_sha256 } : null;
}
function detailScope(input, profile) {
  const suffix = profile === "setup-config.v1" ? "config.toml" : ".sandbox";
  return { policy_id: ID, profile_id: profile, selectors: [windows.join(input.manifest.profile_root, suffix)] };
}
function detailsFor(input, report, gaps) {
  const documents = new Map(), details = input.details ?? null;
  if (!details) { gaps.push("SETUP_DETAILS_REQUIRED"); return documents; }
  json(details);
  ensure(exact(details, ["contract_version", "manifest_sha256", "operation_sha256", "inventory_sha256", "observation_sha256",
    "observer_context_sha256", "observed_at", "receipts", "evidence"])
    && details.contract_version === "codex-managed-sandbox-setup-details.v1"
    && details.manifest_sha256 === hash(input.manifest) && details.operation_sha256 === hash(input.operation)
    && details.inventory_sha256 === hash(input.inventory) && details.observation_sha256 === (input.observation ? hash(input.observation) : null)
    && digest(details.observer_context_sha256) && details.observer_context_sha256 === input.observation?.observer.context_sha256
    && stamp(details.observed_at), "DETAIL_BINDING_INVALID");
  ensure(Date.parse(details.observed_at) >= Date.parse(input.observation.observed_at)
    && Date.parse(details.observed_at) <= Date.parse(input.at)
    && Date.parse(input.at) - Date.parse(details.observed_at) <= BASE.max_age_ms, "DETAIL_TIME_INVALID");
  ensure(list(details.receipts, 2) && list(details.evidence, 2), "DETAIL_RECEIPTS_INVALID");
  const used = new Set();
  for (const receipt of details.receipts) {
    ensure(exact(receipt, ["profile_id", "scope_sha256", "evidence_sha256", "status"])
      && ["setup-config.v1", "sandbox-logs.v1"].includes(receipt.profile_id) && !documents.has(receipt.profile_id)
      && digest(receipt.scope_sha256) && digest(receipt.evidence_sha256)
      && ["complete", "partial", "unavailable"].includes(receipt.status), "DETAIL_RECEIPT_INVALID");
    const evidence = details.evidence.find(value => value?.sha256 === receipt.evidence_sha256);
    ensure(evidence && exact(evidence, ["sha256", "document"]) && evidence.sha256 === hash(evidence.document)
      && !used.has(evidence.sha256), "DETAIL_EVIDENCE_INVALID");
    used.add(evidence.sha256);
    const doc = evidence.document, scope = detailScope(input, receipt.profile_id);
    ensure(exact(doc, ["contract_version", "profile_id", "observer_context_sha256", "scope", "scope_sha256", "status",
      "resource_sha256", "dimensions", "outside_sha256", "truncated", "errors"])
      && doc.contract_version === "codex-managed-sandbox-setup-projection.v1" && doc.profile_id === receipt.profile_id
      && same(doc.scope, scope) && doc.scope_sha256 === hash(scope) && doc.scope_sha256 === receipt.scope_sha256
      && doc.observer_context_sha256 === details.observer_context_sha256 && doc.status === receipt.status
      && (doc.resource_sha256 === null || digest(doc.resource_sha256)) && (doc.outside_sha256 === null || digest(doc.outside_sha256))
      && typeof doc.truncated === "boolean" && list(doc.errors, 32)
      && doc.errors.every(value => typeof value === "string" && /^[A-Z][A-Z0-9_]{0,95}$/u.test(value)), "DETAIL_PROJECTION_INVALID");
    const original = preimage(input, report, "filesystem-state.v1", scope.selectors[0]);
    ensure(original && doc.resource_sha256 === original.resource_sha256, "DETAIL_PREIMAGE_MISMATCH");
    documents.set(receipt.profile_id, { receipt, document: doc, original });
    if (doc.status !== "complete" || doc.truncated || doc.errors.length || !digest(doc.outside_sha256)) {
      gaps.push(`DETAIL_INCOMPLETE:${receipt.profile_id}`); continue;
    }
    if (receipt.profile_id === "setup-config.v1") validateConfig(doc, original);
    else validateLogs(doc, input);
  }
  ensure(used.size === details.evidence.length, "DETAIL_EVIDENCE_UNUSED");
  return documents;
}
function validateConfig(doc, original) {
  const d = doc.dimensions;
  ensure(exact(d, ["exists", "content_sha256", "keys", "unrelated_sha256", "features_table_present"])
    && d.exists === original.dimensions.exists && (d.content_sha256 === null || digest(d.content_sha256))
    && (d.exists ? d.content_sha256 === original.dimensions.content_sha256 : d.content_sha256 === null)
    && digest(d.unrelated_sha256) && typeof d.features_table_present === "boolean" && (d.exists || !d.features_table_present) && list(d.keys, 4) && d.keys.length === 4
    && new Set(d.keys.map(row => row?.key)).size === 4, "CONFIG_DIMENSIONS_INVALID");
  for (const row of d.keys) ensure(exact(row, ["key", "present", "value"]) && CONFIG_KEYS.includes(row.key)
    && typeof row.present === "boolean" && (row.present ? (row.key === "windows.sandbox"
      ? ["elevated", "unelevated"].includes(row.value) : typeof row.value === "boolean") : row.value === null)
    && (d.exists || !row.present), "CONFIG_KEY_INVALID");
}
function dailyPath(input, date) { return windows.join(input.manifest.profile_root, ".sandbox", `sandbox.${date}.log`); }
function logName(input, value) {
  if (typeof value !== "string") return false;
  const name = windows.basename(value);
  return name.length <= 255 && name.startsWith("sandbox") && name.endsWith("log")
    && !/[<>:"/|?*\x00-\x1f\x7f]/u.test(name) && name.normalize("NFC") === name
    && value === windows.join(input.manifest.profile_root, ".sandbox", name);
}
function validateLogs(doc, input) {
  const d = doc.dimensions;
  ensure(exact(d, ["entries"]) && list(d.entries) && d.entries.every(row => exact(row, ["path", "sha256", "bytes", "prefixes", "created_at", "object_type", "reparse"])
    && logName(input, row.path) && digest(row.sha256) && stamp(row.created_at) && Date.parse(row.created_at) <= Date.parse(input.at) && row.object_type === "file" && row.reparse === false && Number.isSafeInteger(row.bytes) && row.bytes >= 0
    && row.bytes <= LIMITS.observed_log_bytes && list(row.prefixes, 1)
    && row.prefixes.every(prefix => exact(prefix, ["bytes", "sha256"]) && Number.isSafeInteger(prefix.bytes)
      && prefix.bytes >= 0 && prefix.bytes <= row.bytes && digest(prefix.sha256)))
    && new Set(d.entries.map(row => lower(row.path))).size === d.entries.length, "LOG_DIMENSIONS_INVALID");
}
const completeDetail = detail => detail && detail.document.status === "complete" && !detail.document.truncated
  && !detail.document.errors.length && digest(detail.document.outside_sha256);

export function buildManagedSandboxSetupEffectsPlan(input) {
  const report = assess(input);
  const spec = getManagedSandboxOperationPolicy();
  const fixed = input.operation.policy_id === spec.policy_id && input.manifest.client.sha256 === spec.client_sha256
    && input.manifest.setup.sha256 === spec.setup_sha256 && input.manifest.command_runner.sha256 === spec.command_runner_sha256
    && input.operation.configuration.registered_core_requested === false && input.operation.configuration.service_enabled === false
    && !report.information.missing_requirements.some(row => ["INVENTORY_STALE_OR_FUTURE", "OBSERVATION_STALE_OR_FUTURE", "SECRET_CONTENT_OBSERVATION_FORBIDDEN", "EXECUTABLE_PIN_MISMATCH"].includes(row.code));
  const gaps = [...FIXED_GAPS], recipes = [], home = input.manifest.profile_root;
  const details = detailsFor(input, report, gaps);
  if (!fixed) gaps.push("FIXED_POLICY_OR_ROUTE_MISMATCH");
  const add = (recipe_id, targets, postcondition, extra = {}) => {
    if (!fixed || targets.some(value => value === null)) { gaps.push(`PREIMAGE_REQUIRED:${recipe_id}`); return; }
    recipes.push({ recipe_id, preimages: targets, postcondition, ...extra });
  };
  add("setup-marker-replace", [preimage(input, report, "filesystem-state.v1", windows.join(home, ".sandbox", "setup_marker.json"))],
    "same_exact_path_present_after_success", { condition: "initial_provisioning_only_not_refresh_or_read_acls_only", expected_marker: { version: 5, offline_username: "CodexSandboxOffline", online_username: "CodexSandboxOnline", proxy_ports: copy(input.operation.configuration.network.proxy_ports), allow_local_binding: input.operation.configuration.network.allow_local_binding, read_roots: [], write_roots: [] }, required_observed_fields: ["created_at"], limitations: ["PROVISIONING_BRANCH_AND_MARKER_CONTENT_NOT_OBSERVED", "REPLACEMENT_ORDER_NOT_PROVED"] });
  const wfp = report.information.requirements.find(row => row.profile_id === "wfp-filter.v1").scope.selectors;
  add("codex-wfp-filter-transaction", wfp.map(id => preimage(input, report, "wfp-filter.v1", id)),
    "same_twelve_guids_present_after_success", { provider_key: report.information.requirements.find(row => row.profile_id === "wfp-provider.v1").scope.selectors[0],
      sublayer_key: report.information.requirements.find(row => row.profile_id === "wfp-sublayer.v1").scope.selectors[0],
      limitations: ["TRANSACTION_ATOMICITY_NOT_PROVED", "FILTER_SEMANTICS_NOT_VERIFIED"] });
  const config = details.get("setup-config.v1");
  if (completeDetail(config)) add("setup-config-edit", [config.original], "windows.sandbox=elevated_and_legacy_keys_absent",
    { condition: "only_when_semantic_edit_changes_config", atomic_temporary_identity: "NOT_REPRESENTED", detail_sha256: config.receipt.evidence_sha256, keys: CONFIG_KEYS, unrelated_sha256: config.document.dimensions.unrelated_sha256 });
  else gaps.push("CONFIG_PROJECTION_REQUIRED");
  const logs = details.get("sandbox-logs.v1");
  if (completeDetail(logs)) {
    const current = dailyPath(input, input.at.slice(0, 10)), entries = logs.document.dimensions.entries;
    // tracing-appender 0.2.4 prunes N-89 observed matching files before
    // opening the new log when N>=90. A tied cutoff cannot name exact victims.
    const ordered = [...entries].sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));
    const count = entries.length >= 90 ? entries.length - 89 : 0;
    const ambiguous = count > 0 && ordered[count - 1].created_at === ordered[count]?.created_at;
    const victims = ordered.slice(0, count).map(row => row.path).sort();
    const control = preimage(input, report, "setup-control.v1", "setupStart");
    if (ambiguous) gaps.push("LOG_RETENTION_CUTOFF_AMBIGUOUS");
    else if (!control || !same([...control.dimensions.log_rotation_victims].sort(), victims)) gaps.push("LOG_VICTIM_SET_MISMATCH");
    else add("sandbox-log-append-and-retention", [logs.original], "append_current_daily_log_and_preserve_other_retained_logs",
      { detail_sha256: logs.receipt.evidence_sha256, current_path: current, retention_limit: 90,
        prune_before_open: true, victims, entries: copy(entries), limitations: ["LOG_ROTATION_EXECUTION_NOT_OBSERVED"] });
  } else gaps.push("LOG_PROJECTION_REQUIRED");
  const cleanup = [
    ["filesystem-state.v1", windows.join(home, ".sandbox", "sandbox_users.json")],
    ["filesystem-state.v1", windows.join(home, ".sandbox", "setup_error.json")],
    ["firewall-user-rules.v1", LEGACY_PROXY],
    ...(input.operation.configuration.network.allow_local_binding ? LOOPBACK.map(id => ["firewall-user-rules.v1", id]) : []),
  ];
  for (const [profile, id] of cleanup) add("exact-legacy-cleanup", [preimage(input, report, profile, id)], "exact_target_absent_after_success");
  const plan = { contract_version: "codex-managed-sandbox-setup-effects-plan.v1", policy_sha256: hash(POLICY),
    operation_sha256: hash(input.operation), manifest_sha256: hash(input.manifest), inventory_sha256: hash(input.inventory),
    observation_sha256: input.observation ? hash(input.observation) : null, details_sha256: input.details ? hash(input.details) : null,
    assessed_at: input.at, status: "REVIEWABLE_WITH_GAPS", ...FLAGS, base_assessment: report,
    recipes, residual_gaps: [...new Set(gaps)].sort(), complete_effect_coverage: false };
  return frozen({ ...plan, plan_sha256: hash(plan) });
}

export function compareManagedSandboxSetupEffects({ before, after }) {
  const first = buildManagedSandboxSetupEffectsPlan(before), next = buildManagedSandboxSetupEffectsPlan(after);
  const violations = [], checks = [];
  const issue = (code, id = null) => violations.push({ code, id });
  if (!same(before.manifest, after.manifest) || !same(before.operation, after.operation)) issue("OPERATION_OR_MANIFEST_CHANGED");
  if (Date.parse(after.inventory.observed_at) < Date.parse(before.inventory.observed_at)
    || Date.parse(after.at) < Date.parse(before.at)) issue("TIME_REVERSED");
  if (before.observation?.observer.context_sha256 !== after.observation?.observer.context_sha256) issue("OBSERVER_CONTEXT_CHANGED");
  for (const old of before.inventory.protected_resources) {
    const current = after.inventory.protected_resources.find(row => row.kind === old.kind && lower(row.id) === lower(old.id));
    if (!current || old.sha256 !== current.sha256) issue("PROTECTED_RESOURCE_CHANGED", old.id);
  }
  for (const old of before.inventory.coverage) {
    const current = after.inventory.coverage.find(row => row.kind === old.kind);
    if (!current || old.scope_id !== current.scope_id || old.scope_sha256 !== current.scope_sha256) issue("INVENTORY_SCOPE_CHANGED", old.kind);
    if (old.complete && current?.complete && old.outside_authority_sha256 !== current.outside_authority_sha256) issue("OUTSIDE_AUTHORITY_CHANGED", old.kind);
  }
  for (const receipt of before.observation?.receipts ?? []) {
    const a = before.observation.evidence.find(row => row.sha256 === receipt.evidence_sha256)?.document;
    const other = after.observation?.receipts.find(row => row.profile_id === receipt.profile_id);
    const b = after.observation?.evidence.find(row => row.sha256 === other?.evidence_sha256)?.document;
    if (a?.outside_sha256 && b?.outside_sha256 && a.outside_sha256 !== b.outside_sha256) issue("OUTSIDE_PROJECTION_CHANGED", receipt.profile_id);
  }
  const knownDeletes = new Set(first.recipes.filter(row => row.recipe_id === "exact-legacy-cleanup").flatMap(row => row.preimages.map(p => p.id)));
  for (const requirement of first.base_assessment.information.requirements.filter(row => row.kind !== "control")) {
    for (const id of requirement.scope.selectors) {
      const a = preimage(before, first.base_assessment, requirement.profile_id, id), b = preimage(after, next.base_assessment, requirement.profile_id, id);
      if (a?.dimensions.exists === true && b?.dimensions.exists === false && !knownDeletes.has(id)) issue("UNMODELED_DELETION", id);
    }
  }
  for (const recipe of first.recipes) {
    const targets = recipe.preimages.map(p => preimage(after, next.base_assessment, p.profile_id, p.id));
    if (targets.some(value => value === null)) { checks.push({ recipe_id: recipe.recipe_id, status: "UNKNOWN" }); continue; }
    if (recipe.recipe_id === "exact-legacy-cleanup" && targets[0].dimensions.exists !== false) issue("CLEANUP_TARGET_PRESENT", targets[0].id);
    if (recipe.recipe_id === "setup-marker-replace" && targets[0].dimensions.exists !== true) issue("MARKER_ABSENT", targets[0].id);
    if (recipe.recipe_id === "codex-wfp-filter-transaction") for (const target of targets) {
      if (target.dimensions.exists !== true || target.dimensions.provider_key !== recipe.provider_key
        || target.dimensions.sublayer_key !== recipe.sublayer_key || target.dimensions.persistent !== true) issue("WFP_BINDING_MISMATCH", target.id);
    }
    checks.push({ recipe_id: recipe.recipe_id, status: "STRUCTURAL_ONLY" });
  }
  const aDetails = detailsFor(before, first.base_assessment, []), bDetails = detailsFor(after, next.base_assessment, []);
  for (const profile of ["setup-config.v1", "sandbox-logs.v1"]) {
    const a = aDetails.get(profile), b = bDetails.get(profile);
    if (!completeDetail(a) || !completeDetail(b)) continue;
    if (a.document.outside_sha256 !== b.document.outside_sha256) issue("OUTSIDE_DETAIL_CHANGED", profile);
    if (profile === "setup-config.v1") {
      if (a.document.dimensions.unrelated_sha256 !== b.document.dimensions.unrelated_sha256) issue("UNRELATED_CONFIG_CHANGED");
      if (a.document.dimensions.features_table_present !== b.document.dimensions.features_table_present) issue("FEATURES_TABLE_CHANGED");
      for (const row of b.document.dimensions.keys) if (row.key === "windows.sandbox"
        ? !row.present || row.value !== "elevated" : row.present) issue("CONFIG_POSTCONDITION_MISMATCH", row.key);
    } else {
      const recipe = first.recipes.find(row => row.recipe_id === "sandbox-log-append-and-retention");
      if (!recipe) continue;
      if (before.at.slice(0, 10) !== after.at.slice(0, 10)) { issue("LOG_DATE_CHANGED"); continue; }
      const old = a.document.dimensions.entries, current = b.document.dimensions.entries;
      const expected = [...new Set([...old.map(row => row.path).filter(path => !recipe.victims.includes(path)), recipe.current_path])].sort();
      if (!same(expected, current.map(row => row.path).sort())) issue("LOG_RESOURCE_SET_MISMATCH");
      for (const row of old.filter(value => !recipe.victims.includes(value.path))) {
        const post = current.find(value => value.path === row.path);
        if (!post) continue;
        if (row.path !== recipe.current_path && !same(row, post)) issue("RETAINED_LOG_CHANGED", row.path);
        if (row.path === recipe.current_path && (post.bytes < row.bytes || !(post.bytes === row.bytes && post.sha256 === row.sha256)
          && !post.prefixes.some(prefix => prefix.bytes === row.bytes && prefix.sha256 === row.sha256))) issue("LOG_APPEND_PREFIX_MISMATCH", row.path);
      }
    }
  }
  return frozen({ contract_version: "codex-managed-sandbox-setup-effects-comparison.v1", status: violations.length ? "REFUSED" : "INCOMPLETE",
    ...FLAGS, before_plan_sha256: first.plan_sha256, after_plan_sha256: next.plan_sha256, checks, violations,
    residual_gaps: [...new Set([...first.residual_gaps, ...next.residual_gaps])].sort(), complete_effect_coverage: false });
}

