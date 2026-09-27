import { win32 as windows } from "node:path";
import { createHash } from "node:crypto";
import { assessManagedSetupConfiguration } from "./codex-managed-configuration.mjs";
import { fingerprintAgentExecutionValue as hash } from "./agent-execution-contracts.mjs";
import { CODEX_STARTUP_ENVIRONMENT_PROFILES } from "./codex-startup-arguments.mjs";
import { buildManagedSetupStartupPaths } from "./codex-managed-startup.mjs";
import { getManagedSandboxOperationPolicy } from "./codex-managed-sandbox-operation-policy.mjs";

// Closed projection of the pinned Legacy Full-refresh recipe, not Codex's
// compiled PermissionProfile or a physical observer. All facts remain claims
// supplied by the caller: IDs/hashes/freshness bind them, never authenticate them.
// Source 0d9c7cbf: setup.rs224-365,536-697,1255-1460; permissions.rs807-850;
// allow.rs14-41; deny_read_resolver.rs32-46; setup_runtime_bin.rs22-207.
// The caller must observe these same inputs again before any authorized launch.
const VERSION = "aidn-managed-setup-legacy-scope.v1";
const JUNCTION_VERSION = "aidn-managed-setup-legacy-scope.v2";
const CLOUD_VERSION = "aidn-managed-setup-legacy-scope.v3";
const MOUNT_POINT_TAG = 0xa0000003;
const CLOUD_7_TAG = 0x9000701a;
const EXCLUSIONS = Object.freeze([".ssh", ".tsh", ".brev", ".gnupg", ".aws", ".azure", ".kube", ".docker", ".config", ".npm", ".pki", ".terraform.d"]);
const PLATFORM = Object.freeze(["C:\\Windows", "C:\\Program Files", "C:\\Program Files (x86)", "C:\\ProgramData"]);
const POLICY = getManagedSandboxOperationPolicy();
const LIMITS = Object.freeze({ paths: 4609, listings: 4097, profile_entries: 512, nonruntime_paths: 512, runtime_entries: 4096, runtime_depth: 32, profile_junctions: 32, profile_cloud_directories: 32, document_bytes: 2097152, max_age_ms: 300000 });
const fail = code => { throw Object.assign(new Error("MANAGED_LEGACY_SCOPE_" + code), { code: "MANAGED_LEGACY_SCOPE_" + code }); };
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
function absolute(value) {
  ensure(typeof value === "string" && value.length > 3 && value.length <= 4096 && value.normalize("NFC") === value
    && /^[A-Za-z]:\\/u.test(value) && windows.normalize(value) === value && !value.endsWith("\\")
    && value.slice(3).split("\\").every(part => part && part.length <= 255 && !/[<>:"/|?*\x00-\x1f\x7f]|[. ]$/u.test(part)
      && !/^(con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/iu.test(part)), "PATH_INVALID");
  return value;
}
const key = value => ascii(absolute(value));
const samePath = (a, b) => key(a) === key(b);
function stamp(value) {
  ensure(typeof value === "string" && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/u.test(value)
    && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value, "TIME_INVALID");
  return Date.parse(value);
}
const ordered = paths => [...new Map(paths.map(value => [key(value), value])).entries()].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([, value]) => value);
const inside = (root, child) => key(child) === key(root) || key(child).startsWith(key(root) + "\\");

/** Pure, bounded, operator-local projection. No filesystem, environment, clock,
 * network, process or registry read. There is deliberately no execution port. */
export function projectManagedSetupLegacyScope(input) {
  json(input); ensure(exact(input, ["configuration", "environment", "facts", "at"]), "INPUT_INVALID");
  const { configuration, environment, facts, at } = input;
  ensure(configuration.startup?.permission_scope === undefined, "NAMED_SCOPE_REQUIRES_SEPARATE_PROJECTOR");
  const assessment = assessManagedSetupConfiguration(configuration);
  // Common Full uses only its closed process env (setup.rs255,780-805).
  // The service branch consumes NetworkProxySpec and is excluded. Opaque
  // configured network variants are still refused in this first subset.
  const response = configuration.metadata.configs[0];
  ensure([response.config, ...response.layers.map(layer => layer.config)].every(config => config.network == null), "NETWORK_UNSUPPORTED");
  ensure(exact(environment, CODEX_STARTUP_ENVIRONMENT_PROFILES.managed) && Object.values(environment).every(value =>
    typeof value === "string" && value.length > 0 && value.length <= 32768 && !/[\x00-\x1f\x7f]/u.test(value)), "ENVIRONMENT_INVALID");
  for (const name of CODEX_STARTUP_ENVIRONMENT_PROFILES.managed.filter(name => !["PATH", "PATHEXT"].includes(name))) absolute(environment[name]);
  const { cwd, profile_root: home, candidate_root: candidate, startup } = configuration;
  ensure(samePath(environment.CODEX_HOME, home) && samePath(environment.TEMP, startup.state_root)
    && samePath(environment.TMP, startup.state_root), "ENVIRONMENT_BINDING");
  const profile = environment.USERPROFILE, local = environment.LOCALAPPDATA;
  ensure(!inside(profile, cwd) && !inside(cwd, profile) && !inside(cwd, home) && !inside(home, cwd), "CWD_SUBSET_UNSUPPORTED");
  const cloudsEnabled = facts?.contract_version === "aidn-managed-setup-legacy-facts.v3";
  const junctionsEnabled = cloudsEnabled || facts?.contract_version === "aidn-managed-setup-legacy-facts.v2";
  const version = cloudsEnabled ? CLOUD_VERSION : junctionsEnabled ? JUNCTION_VERSION : VERSION;
  ensure(exact(facts, ["contract_version", "observed_at", "observer_context_sha256", "paths", "listings", "prior_deny_read_content",
    ...(junctionsEnabled ? ["profile_junctions"] : []), ...(cloudsEnabled ? ["profile_cloud_directories"] : [])])
    && (junctionsEnabled || facts.contract_version === "aidn-managed-setup-legacy-facts.v1") && digest(facts.observer_context_sha256), "FACTS_INVALID");
  const now = stamp(at), observed = stamp(facts.observed_at);
  ensure(now >= observed && now - observed <= LIMITS.max_age_ms, "FACTS_STALE");
  ensure(Array.isArray(facts.paths) && facts.paths.length <= LIMITS.paths && Array.isArray(facts.listings)
    && facts.listings.length <= LIMITS.listings, "FACTS_LIMIT");
  const paths = new Map(), listings = new Map(), usedPaths = new Set(), usedListings = new Set(), identities = new Set();
  // FILE_ID_INFO: VolumeSerialNumber as padded lower-case hex (64 bits),
  // FileId.Identifier in its original 16-byte order as lower-case hex. Never
  // normalize an alternate encoding. A future producer must obtain file link
  // count via BY_HANDLE_FILE_INFORMATION on the same handle; unknown is refused.
  // IDs and link counts are still unauthenticated claims in this pure module.
  const rowFields = ["path", "state", "object_type", "physical_path", "volume_id", "file_id", "link_count", "ancestors_non_reparse", "reparse", "content_sha256"];
  for (const row of facts.paths) {
    ensure(exact(row, rowFields), "PATH_FACT_INVALID"); const id = key(row.path);
    ensure(!paths.has(id), "PATH_FACT_DUPLICATE");
    ensure(row.ancestors_non_reparse === true, "ANCESTORS_UNVERIFIED");
    if (row.state === "absent") ensure(["object_type", "physical_path", "volume_id", "file_id", "link_count", "reparse", "content_sha256"].every(name => row[name] === null), "ABSENCE_INVALID");
    else {
      ensure(row.state === "present" && ["file", "directory"].includes(row.object_type)
        && (row.reparse === false || junctionsEnabled && row.reparse === true && row.object_type === "directory")
        && samePath(row.physical_path, row.path) && typeof row.volume_id === "string" && /^[a-f0-9]{16}$/u.test(row.volume_id)
        && typeof row.file_id === "string" && /^[a-f0-9]{32}$/u.test(row.file_id)
        && (row.content_sha256 === null || digest(row.content_sha256)), "PATH_FACT_INVALID");
      ensure(row.object_type === "file" ? row.link_count === 1 : row.link_count === null, "LINK_COUNT_UNSUPPORTED");
      const identity = row.volume_id + ":" + row.file_id;
      ensure(!identities.has(identity), "PHYSICAL_IDENTITY_DUPLICATE"); identities.add(identity);
    }
    paths.set(id, row);
  }
  for (const row of facts.listings) {
    ensure(exact(row, ["path", "complete", "entries"]) && row.complete === true && Array.isArray(row.entries)
      && row.entries.length <= LIMITS.runtime_entries, "LISTING_INCOMPLETE"); const id = key(row.path);
    ensure(!listings.has(id) && new Set(row.entries.map(key)).size === row.entries.length
      && row.entries.every(child => samePath(windows.dirname(child), row.path)), "LISTING_INVALID");
    listings.set(id, row);
  }
  function fact(target) {
    const id = key(target), row = paths.get(id); ensure(row, "PATH_UNOBSERVED"); usedPaths.add(id); return row;
  }
  function directory(target, optional = false) {
    const row = fact(target);
    if (optional && row.state === "absent") return null;
    ensure(row.state === "present" && row.object_type === "directory" && row.reparse === false, "DIRECTORY_REQUIRED"); return row.path;
  }
  function absent(target, code) { ensure(fact(target).state === "absent", code); }
  function children(target) {
    directory(target); const id = key(target), row = listings.get(id); ensure(row, "LISTING_UNOBSERVED");
    usedListings.add(id); return row.entries;
  }
  // v2 resolves only immediate USERPROFILE directory junctions. Link IDs must
  // come from OPEN_REPARSE_POINT, target IDs from the canonical non-reparse
  // handle. This pure contract binds those claims; it does not observe handles.
  // Source setup.rs536-613 canonicalizes retained profile children before
  // exclusions (1289-1292,1381-1399). No recursive alias resolver is supplied.
  const clouds = new Map();
  if (cloudsEnabled) {
    ensure(Array.isArray(facts.profile_cloud_directories)
      && facts.profile_cloud_directories.length <= LIMITS.profile_cloud_directories, "CLOUD_LIMIT");
    for (const cloud of facts.profile_cloud_directories) {
      ensure(exact(cloud, ["path", "reparse_tag"]) && cloud.reparse_tag === CLOUD_7_TAG, "CLOUD_INVALID");
      const id = key(cloud.path);
      ensure(samePath(windows.dirname(cloud.path), profile) && !clouds.has(id), "CLOUD_INVALID");
      clouds.set(id, cloud);
    }
    // CLOUD_7 is not a name surrogate. Observe only the directory metadata
    // through OPEN_REPARSE_POINT, never content, descendants or a cloud listing.
    // These facts neither prove hydration behavior nor qualify later setup ACLs.
    for (const row of facts.paths) ensure(![...clouds.values()].some(cloud =>
      !samePath(cloud.path, row.path) && inside(cloud.path, row.path)), "CLOUD_DESCENDANT_UNSUPPORTED");
    for (const row of facts.listings) ensure(![...clouds.values()].some(cloud =>
      inside(cloud.path, row.path)), "CLOUD_LISTING_UNSUPPORTED");
    const entries = children(profile);
    for (const cloud of clouds.values()) {
      const row = fact(cloud.path);
      ensure(row.state === "present" && row.object_type === "directory" && row.reparse === true
        && row.path === cloud.path && row.physical_path === cloud.path && row.content_sha256 === null
        && entries.some(entry => entry === cloud.path), "CLOUD_FACT_INVALID");
    }
  }
  const junctions = new Map();
  if (junctionsEnabled) {
    ensure(Array.isArray(facts.profile_junctions) && facts.profile_junctions.length <= LIMITS.profile_junctions, "JUNCTION_LIMIT");
    for (const junction of facts.profile_junctions) {
      ensure(exact(junction, ["path", "target_path", "reparse_tag"]) && junction.reparse_tag === MOUNT_POINT_TAG, "JUNCTION_INVALID");
      const id = key(junction.path); absolute(junction.target_path);
      ensure(samePath(windows.dirname(junction.path), profile) && !junctions.has(id) && !clouds.has(id), "JUNCTION_INVALID");
      junctions.set(id, junction);
    }
    // Reject every observed path through a declared junction, not just the
    // target itself: such a path contradicts ancestors_non_reparse.
    for (const row of facts.paths) {
      ensure(![...junctions.values()].some(junction => !samePath(junction.path, row.path) && inside(junction.path, row.path)), "JUNCTION_CHAIN_UNSUPPORTED");
      ensure(row.reparse !== true || junctions.has(key(row.path)) || clouds.has(key(row.path)), "JUNCTION_UNBOUND");
    }
    const entries = children(profile); ensure(entries.length <= LIMITS.profile_entries, "PROFILE_LIMIT");
    for (const junction of junctions.values()) {
      const link = fact(junction.path);
      ensure(link.state === "present" && link.object_type === "directory" && link.reparse === true
        && link.path === junction.path && link.physical_path === junction.path
        && entries.some(entry => entry === junction.path), "JUNCTION_FACT_INVALID");
      ensure(inside(profile, junction.target_path) && !samePath(profile, junction.target_path), "JUNCTION_TARGET_OUTSIDE");
      ensure(![...junctions.values()].some(other => inside(other.path, junction.target_path)), "JUNCTION_CHAIN_UNSUPPORTED");
      const target = fact(junction.target_path);
      ensure(target.state === "present" && target.object_type === "directory" && target.reparse === false
        && target.physical_path === junction.target_path && target.path === junction.target_path, "JUNCTION_TARGET_INVALID");
      const targetChild = windows.join(profile, windows.relative(profile, junction.target_path).split("\\")[0]);
      ensure(entries.some(entry => samePath(entry, targetChild)), "JUNCTION_TARGET_UNLISTED");
    }
  }
  for (const target of [cwd, home, candidate, profile, ...Object.values(buildManagedSetupStartupPaths(startup))]) directory(target);
  for (const name of [".git", ".agents", ".codex"]) absent(windows.join(cwd, name), "CWD_METADATA_UNSUPPORTED");
  // No content or key material is read: v1 requires explicit NotFound for this
  // exact file. Existing SSH config, including Include, needs a separate scope.
  absent(windows.join(profile, ".ssh", "config"), "SSH_CONFIG_UNSUPPORTED");
  const prior = fact(windows.join(home, ".sandbox", "deny_read_acl_state.json"));
  if (prior.state === "absent") ensure(facts.prior_deny_read_content === null, "PRIOR_STATE_MISMATCH");
  else {
    ensure(prior.object_type === "file" && typeof facts.prior_deny_read_content === "string"
      && Buffer.byteLength(facts.prior_deny_read_content, "utf8") <= 65536
      && rawHash(facts.prior_deny_read_content) === prior.content_sha256, "PRIOR_STATE_MISMATCH");
    let parsed; try { parsed = JSON.parse(facts.prior_deny_read_content); } catch { fail("PRIOR_STATE_INVALID"); }
    ensure(exact(parsed, ["principals"]) && exact(parsed.principals, [])
      && /^\s*\{\s*"principals"\s*:\s*\{\s*\}\s*\}\s*$/u.test(facts.prior_deny_read_content), "PRIOR_STATE_UNSUPPORTED");
  }
  const helper = directory(windows.join(home, ".sandbox-bin"));
  const profileEntries = children(profile); ensure(profileEntries.length <= LIMITS.profile_entries, "PROFILE_LIMIT");
  const homeChildren = profileEntries.filter(child => !EXCLUSIONS.includes(ascii(windows.basename(child))));
  const read = [helper];
  for (const target of PLATFORM) { const row = fact(target); if (row.state === "present") {
    ensure(row.object_type === "directory", "PLATFORM_ROOT_INVALID"); read.push(row.path);
  } }
  for (const child of homeChildren) { const row = fact(child); ensure(row.state === "present", "LISTING_CHANGED"); read.push(junctions.get(key(child))?.target_path ?? row.path); }
  read.push(cwd); // Fixed symbolic-root read; readable_roots_for_cwd returns [].
  const filtered = value => !samePath(value, profile) && !(inside(profile, value)
    && EXCLUSIONS.includes(ascii(windows.relative(profile, value).split("\\")[0])));
  const write = ordered([directory(cwd)].filter(filtered).filter(value => !samePath(value, home)
    && ![".sandbox", ".sandbox-bin", ".sandbox-secrets"].some(name => inside(windows.join(home, name), value))));
  ensure(write.length === 1 && samePath(write[0], cwd), "WRITE_ROOT_UNSUPPORTED");
  const readRoots = ordered(read.filter(filtered).filter(value => !write.some(root => samePath(root, value))));
  const runtime = [], runtimeFacts = new Set();
  for (const target of [windows.join(local, "OpenAI", "Codex"), windows.join(profile, ".cache", "codex-runtimes")]) {
    const seen = directory(target, true); if (seen) runtime.push(seen);
  }
  const runtimeRoot = windows.join(local, "OpenAI", "Codex", "runtimes"), rootRow = fact(runtimeRoot);
  if (rootRow.state === "present") {
    ensure(rootRow.object_type === "directory", "RUNTIME_ROOT_INVALID");
    const pending = [[rootRow.path, 0]], visited = new Set();
    while (pending.length) {
      const [target, depth] = pending.pop(); ensure(depth <= LIMITS.runtime_depth && !visited.has(key(target)), "RUNTIME_LIMIT");
      ensure(visited.size <= LIMITS.runtime_entries, "RUNTIME_LIMIT");
      visited.add(key(target)); runtimeFacts.add(key(target)); const row = fact(target); ensure(row.state === "present", "RUNTIME_CHANGED"); runtime.push(row.path);
      if (row.object_type === "directory") for (const child of children(target)) pending.push([child, depth + 1]);
    }
  }
  ensure(paths.size - runtimeFacts.size <= LIMITS.nonruntime_paths, "NONRUNTIME_LIMIT");
  ensure(usedPaths.size === paths.size && usedListings.size === listings.size, "UNUSED_FACTS");
  const scope = { read_roots: readRoots, write_roots: write, deny_read_paths: [], prior_deny_read_paths: [],
    deny_write_paths: [], runtime_paths: ordered(runtime), network: { allow_local_binding: false, proxy_ports: [] } };
  const preimage = { contract_version: version, source_commit: POLICY.source_commit, client_sha256: POLICY.client_sha256,
    setup_sha256: POLICY.setup_sha256, command_runner_sha256: POLICY.command_runner_sha256,
    phase: "Full", runtime: "Legacy", refresh_only: true, configuration_assessment_sha256: hash(assessment),
    startup_sha256: assessment.startup_sha256, environment_sha256: hash(environment), facts_sha256: hash(facts),
    observer_context_sha256: facts.observer_context_sha256, observed_at: facts.observed_at, ...scope };
  return freeze({ contract_version: version, status: "RESOLVED_FOR_REVIEW", representation: "DERIVED_LEGACY_SETUP_SCOPE",
    authority: "STRUCTURAL_NOT_AUTHENTICATED", authorization: "NOT_AUTHORIZED", native: false, native_qualified: false,
    execution_available: false, qualification: "NOT_RUN", complete_effect_coverage: false,
    initial_provisioning: "CONDITIONAL_NOT_ASSESSED", assessed_at: at, preimage, permission_profile_sha256: hash(preimage) });
}

