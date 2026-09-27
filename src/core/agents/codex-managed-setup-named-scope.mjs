import { win32 as windows } from "node:path";
import { createHash } from "node:crypto";
import { assessManagedSetupConfiguration } from "./codex-managed-configuration.mjs";
import { fingerprintAgentExecutionValue as hash } from "./agent-execution-contracts.mjs";
import { CODEX_STARTUP_ENVIRONMENT_PROFILES } from "./codex-startup-arguments.mjs";
import { buildManagedSetupStartupPaths } from "./codex-managed-startup.mjs";
import { getManagedSandboxOperationPolicy } from "./codex-managed-sandbox-operation-policy.mjs";
import { assertAgentLocalPath } from "./agent-local-path-policy.mjs";

// Pure projection of the pinned named-profile Legacy recipe. Unlike Full's
// symbolic Root selection, explicit paths do not enumerate USERPROFILE.
// Source 0d9c7cbf: setup.rs616-642,1255-1460; resolved_permissions.rs105-140;
// setup_runtime_bin.rs22-207. SSH absence and the empty prior-state constraint
// are retained from the historical projector, never inferred from omission.
const VERSION = "aidn-managed-setup-named-scope.v1";
const POLICY = getManagedSandboxOperationPolicy();
const EXCLUSIONS = [".ssh", ".tsh", ".brev", ".gnupg", ".aws", ".azure", ".kube", ".docker", ".config", ".npm", ".pki", ".terraform.d"];
const LIMITS = { paths: 4609, listings: 4097, runtime_entries: 4096, runtime_depth: 32, nonruntime_paths: 512, document_bytes: 2097152, max_age_ms: 300000 };
const fail = code => { throw Object.assign(new Error("MANAGED_NAMED_SCOPE_" + code), { code: "MANAGED_NAMED_SCOPE_" + code }); };
const ensure = (ok, code) => { if (!ok) fail(code); };
const object = value => value !== null && typeof value === "object" && !Array.isArray(value);
const exact = (value, keys) => object(value) && Object.keys(value).sort().join("|") === [...keys].sort().join("|");
const digest = value => typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
const ascii = value => value.replace(/[A-Z]/gu, char => char.toLowerCase());
const rawHash = value => createHash("sha256").update(value, "utf8").digest("hex");
const freeze = value => { if (value && typeof value === "object") { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };
function json(value) {
  let count = 0; const seen = new Set();
  function visit(row, depth) {
    ensure(++count <= 65536 && depth <= 24, "JSON_LIMIT");
    if (row === null || typeof row === "boolean" || typeof row === "number" && Number.isFinite(row)) return;
    if (typeof row === "string") { ensure(row.isWellFormed() && row.length <= LIMITS.document_bytes, "JSON_INVALID"); return; }
    ensure(row && typeof row === "object" && [Object.prototype, Array.prototype, null].includes(Object.getPrototypeOf(row))
      && (Array.isArray(row) || Object.getPrototypeOf(row) !== Array.prototype) && !seen.has(row), "JSON_INVALID");
    seen.add(row); const keys = Reflect.ownKeys(row);
    if (Array.isArray(row)) ensure(keys.length === row.length + 1 && row.length <= 65536, "JSON_INVALID");
    for (const key of keys) {
      ensure(typeof key === "string" && key.isWellFormed(), "JSON_INVALID");
      const descriptor = Object.getOwnPropertyDescriptor(row, key); ensure(Object.hasOwn(descriptor, "value"), "JSON_INVALID");
      if (Array.isArray(row) && key === "length") continue;
      ensure(descriptor.enumerable && (!Array.isArray(row) || /^(0|[1-9][0-9]*)$/u.test(key) && Number(key) < row.length), "JSON_INVALID");
      visit(descriptor.value, depth + 1);
    }
    seen.delete(row);
  }
  visit(value, 0); ensure(Buffer.byteLength(JSON.stringify(value), "utf8") <= LIMITS.document_bytes, "JSON_LIMIT");
}
function stamp(value) {
  ensure(typeof value === "string" && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/u.test(value)
    && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value, "TIME_INVALID");
  return Date.parse(value);
}

/** No environment, filesystem, process, clock, network, admission or setup call. */
export function projectManagedSetupNamedScope(input) {
  json(input); ensure(exact(input, ["configuration", "environment", "facts", "at"]), "INPUT_INVALID");
  const { configuration, environment, facts, at } = input;
  const assessment = assessManagedSetupConfiguration(configuration), selection = configuration.startup.permission_scope;
  ensure(selection && assessment.contract_version === "codex-managed-configuration-assessment.v2"
    && assessment.permission_scope === "NAMED_PERMISSION_SCOPE_UNRESOLVED", "NAMED_CONFIGURATION_REQUIRED");
  function absolute(value) {
    assertAgentLocalPath(value, selection.excluded_paths);
    ensure(typeof value === "string" && value.length <= 4096 && value.normalize("NFC") === value, "PATH_INVALID");
    if (value === selection.project_volume_root) return value;
    ensure(value.length > 3 && /^[A-Za-z]:\\/u.test(value) && windows.normalize(value) === value && !value.endsWith("\\")
      && value.slice(3).split("\\").every(part => part && part.length <= 255 && !/[<>:"/|?*\x00-\x1f\x7f]|[. ]$/u.test(part)
        && !/^(con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/iu.test(part)), "PATH_INVALID");
    return value;
  }
  const key = value => ascii(absolute(value)), same = (a, b) => key(a) === key(b);
  const inside = (root, child) => key(child) === key(root) || key(child).startsWith(key(root).replace(/\\$/u, "") + "\\");
  const ordered = values => [...new Map(values.map(value => [key(value), value])).entries()].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([, value]) => value);
  const response = configuration.metadata.configs[0];
  ensure([response.config, ...response.layers.map(layer => layer.config)].every(config => config.network == null), "NETWORK_UNSUPPORTED");
  ensure(exact(environment, CODEX_STARTUP_ENVIRONMENT_PROFILES.managed) && Object.values(environment).every(value =>
    typeof value === "string" && value.length > 0 && value.length <= 32768 && !/[\x00-\x1f\x7f]/u.test(value)), "ENVIRONMENT_INVALID");
  for (const name of CODEX_STARTUP_ENVIRONMENT_PROFILES.managed.filter(name => !["PATH", "PATHEXT"].includes(name))) absolute(environment[name]);
  const { cwd, profile_root: home, candidate_root: candidate, startup } = configuration;
  const profile = environment.USERPROFILE, local = environment.LOCALAPPDATA;
  ensure(same(environment.CODEX_HOME, home) && same(environment.TEMP, startup.state_root) && same(environment.TMP, startup.state_root)
    && profile === selection.user_profile, "ENVIRONMENT_BINDING");
  ensure(!inside(profile, cwd) && !inside(cwd, home) && !inside(home, cwd), "CWD_SUBSET_UNSUPPORTED");
  ensure(exact(facts, ["contract_version", "observed_at", "observer_context_sha256", "permission_scope_sha256", "paths", "listings", "prior_deny_read_content"])
    && facts.contract_version === "aidn-managed-setup-named-facts.v1" && digest(facts.observer_context_sha256)
    && facts.permission_scope_sha256 === hash(selection) && facts.permission_scope_sha256 === assessment.permission_scope_sha256, "FACTS_INVALID");
  const now = stamp(at), observed = stamp(facts.observed_at);
  ensure(now >= observed && now - observed <= LIMITS.max_age_ms, "FACTS_STALE");
  ensure(Array.isArray(facts.paths) && facts.paths.length <= LIMITS.paths && Array.isArray(facts.listings) && facts.listings.length <= LIMITS.listings, "FACTS_LIMIT");
  const paths = new Map(), listings = new Map(), usedPaths = new Set(), usedListings = new Set(), identities = new Set();
  const priorPath = windows.join(home, ".sandbox", "deny_read_acl_state.json");
  const runtimeRoot = windows.join(local, "OpenAI", "Codex", "runtimes");
  for (const row of facts.paths) {
    ensure(exact(row, ["path", "state", "object_type", "physical_path", "volume_id", "file_id", "link_count", "ancestors_non_reparse", "reparse", "content_sha256"]), "PATH_FACT_INVALID");
    const id = key(row.path); ensure(!paths.has(id), "PATH_FACT_DUPLICATE"); ensure(row.ancestors_non_reparse === true, "ANCESTORS_UNVERIFIED");
    if (row.state === "absent") ensure(["object_type", "physical_path", "volume_id", "file_id", "link_count", "reparse", "content_sha256"].every(name => row[name] === null), "ABSENCE_INVALID");
    else {
      ensure(row.state === "present" && ["file", "directory"].includes(row.object_type) && row.reparse === false
        && row.physical_path === row.path && typeof row.volume_id === "string" && /^[a-f0-9]{16}$/u.test(row.volume_id)
        && typeof row.file_id === "string" && /^[a-f0-9]{32}$/u.test(row.file_id)
        && (row.content_sha256 === null || same(row.path, priorPath) && digest(row.content_sha256)), "PATH_FACT_INVALID");
      ensure(row.object_type === "file" ? row.link_count === 1 : row.link_count === null, "LINK_COUNT_UNSUPPORTED");
      const identity = row.volume_id + ":" + row.file_id;
      ensure(!identities.has(identity), "PHYSICAL_IDENTITY_DUPLICATE"); identities.add(identity);
    }
    paths.set(id, row);
  }
  for (const row of facts.listings) {
    ensure(exact(row, ["path", "complete", "entries"]) && row.complete === true && Array.isArray(row.entries)
      && row.entries.length <= LIMITS.runtime_entries, "LISTING_INCOMPLETE");
    const id = key(row.path);
    ensure(inside(runtimeRoot, row.path) && !listings.has(id) && new Set(row.entries.map(key)).size === row.entries.length
      && row.entries.every(child => same(windows.dirname(child), row.path)), "LISTING_INVALID");
    listings.set(id, row);
  }
  function fact(target) { const id = key(target), row = paths.get(id); ensure(row, "PATH_UNOBSERVED"); usedPaths.add(id); return row; }
  function directory(target, optional = false) {
    const row = fact(target); if (optional && row.state === "absent") return null;
    ensure(row.state === "present" && row.object_type === "directory", "DIRECTORY_REQUIRED"); return row.path;
  }
  function children(target) { directory(target); const id = key(target), row = listings.get(id); ensure(row, "LISTING_UNOBSERVED"); usedListings.add(id); return row.entries; }
  for (const target of [cwd, home, candidate, selection.project_volume_root, ...Object.values(buildManagedSetupStartupPaths(startup))]) directory(target);
  for (const name of [".git", ".agents", ".codex"]) ensure(fact(windows.join(cwd, name)).state === "absent", "CWD_METADATA_UNSUPPORTED");
  // Retained historical precondition: metadata-only absence, never SSH content.
  ensure(fact(windows.join(profile, ".ssh", "config")).state === "absent", "SSH_CONFIG_UNSUPPORTED");
  const prior = fact(priorPath);
  if (prior.state === "absent") ensure(facts.prior_deny_read_content === null, "PRIOR_STATE_MISMATCH");
  else {
    ensure(prior.object_type === "file" && typeof facts.prior_deny_read_content === "string"
      && Buffer.byteLength(facts.prior_deny_read_content, "utf8") <= 65536 && rawHash(facts.prior_deny_read_content) === prior.content_sha256, "PRIOR_STATE_MISMATCH");
    ensure(/^\s*\{\s*"principals"\s*:\s*\{\s*\}\s*\}\s*$/u.test(facts.prior_deny_read_content), "PRIOR_STATE_UNSUPPORTED");
  }
  const filtered = value => !same(value, profile) && !(inside(profile, value) && EXCLUSIONS.includes(ascii(windows.relative(profile, value).split("\\")[0])));
  const helper = directory(windows.join(home, ".sandbox-bin"));
  const reads = [helper, selection.project_volume_root];
  for (const target of selection.read_roots) { const row = fact(target); ensure(row.state === "present", "READ_ROOT_ABSENT"); reads.push(row.path); }
  ensure(reads.every(filtered) && filtered(cwd), "FILTERED_ROOT_UNSUPPORTED");
  const runtime = [], runtimeFacts = new Set();
  for (const target of [windows.join(local, "OpenAI", "Codex"), windows.join(profile, ".cache", "codex-runtimes")]) {
    const present = directory(target, true); if (present) runtime.push(present);
  }
  const root = fact(runtimeRoot);
  if (root.state === "present") {
    ensure(root.object_type === "directory", "RUNTIME_ROOT_INVALID");
    const pending = [[root.path, 0]], discovered = new Set([key(root.path)]);
    while (pending.length) {
      const [target, depth] = pending.pop(); ensure(depth <= LIMITS.runtime_depth && !runtimeFacts.has(key(target)), "RUNTIME_LIMIT");
      runtimeFacts.add(key(target)); const row = fact(target); ensure(row.state === "present", "RUNTIME_CHANGED"); runtime.push(row.path);
      if (row.object_type === "directory") for (const child of children(target)) {
        ensure(!discovered.has(key(child)) && discovered.size <= LIMITS.runtime_entries, "RUNTIME_LIMIT");
        discovered.add(key(child)); pending.push([child, depth + 1]);
      }
    }
  }
  ensure(paths.size - runtimeFacts.size <= LIMITS.nonruntime_paths, "NONRUNTIME_LIMIT");
  ensure(usedPaths.size === paths.size && usedListings.size === listings.size, "UNUSED_FACTS");
  const scope = { read_roots: ordered(reads.filter(value => !same(value, cwd))), write_roots: [cwd], deny_read_paths: [], prior_deny_read_paths: [],
    deny_write_paths: [], runtime_paths: ordered(runtime), network: { allow_local_binding: false, proxy_ports: [] } };
  const preimage = { contract_version: VERSION, source_commit: POLICY.source_commit, client_sha256: POLICY.client_sha256,
    setup_sha256: POLICY.setup_sha256, command_runner_sha256: POLICY.command_runner_sha256, phase: "Full", runtime: "Legacy", refresh_only: true,
    configuration_assessment_sha256: hash(assessment), startup_sha256: assessment.startup_sha256, permission_scope_sha256: hash(selection),
    environment_sha256: hash(environment), facts_sha256: hash(facts), observer_context_sha256: facts.observer_context_sha256, observed_at: facts.observed_at, ...scope };
  return freeze({ contract_version: VERSION, status: "RESOLVED_FOR_REVIEW", representation: "DERIVED_NAMED_SETUP_SCOPE",
    authority: "STRUCTURAL_NOT_AUTHENTICATED", authorization: "NOT_AUTHORIZED", native: false, native_qualified: false,
    execution_available: false, qualification: "NOT_RUN", complete_effect_coverage: false, initial_provisioning: "CONDITIONAL_NOT_ASSESSED",
    read_exclusion_authority: "AIDN_POLICY_NOT_OS_READ_DENIAL", assessed_at: at, preimage, permission_profile_sha256: hash(preimage) });
}
