#!/usr/bin/env node
import fs from "node:fs";
import { assertAgentLocalPath } from "../../src/core/agents/agent-local-path-policy.mjs";
import os from "node:os";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { nativeQualificationHomeIdentity } from "./prepare-agent-native-qualification.mjs";

const SOURCE = path.resolve(import.meta.dirname, "../..");
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const json = (value) => JSON.stringify(value, null, 2) + "\n";
const stable = (value) => JSON.stringify(value, (_, item) => item && typeof item === "object" && !Array.isArray(item)
  ? Object.fromEntries(Object.keys(item).sort().map((key) => [key, item[key]])) : item);
const fingerprint = (value) => hash(stable(value));
const same = (a, b) => stable(a) === stable(b);
const identityPath = (value) => process.platform === "win32" ? value.toLowerCase() : value;
const equalPath = (a, b) => typeof a === "string" && typeof b === "string" && identityPath(path.resolve(a)) === identityPath(path.resolve(b));
const fail = (code) => { const error = new Error(code); error.code = code; throw error; };
const childEnvironment = () => Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(?:GIT_|AIDN_|CODEX_|OPENAI_|PG|POSTGRES|NPM_CONFIG_)/i.test(key)));
const ARGS = Object.freeze({ pack: "core", persistencePolicy: "verify-only", runtimeStateMode: "files",
  artifactImportStore: "file", initDefaults: true, projectName: "neutral qualification",
  sourceBranch: "codex/qualification", verifyAfterInstall: true });

function checkedPath(value, kind) {
  assertAgentLocalPath(value);
  if (typeof value !== "string" || !path.isAbsolute(value)) fail("REFRESH_ABSOLUTE_PATH_REQUIRED");
  const absolute = path.resolve(value);
  let cursor = absolute;
  while (true) {
    try {
      const stat = fs.lstatSync(cursor);
      if (stat.isSymbolicLink() || (!stat.isDirectory() && (!stat.isFile() || stat.nlink !== 1))) fail("REFRESH_UNSAFE_PATH");
    } catch (error) { if (error.code !== "ENOENT") throw error; }
    const parent = path.dirname(cursor);
    if (parent === cursor) break;
    cursor = parent;
  }
  if (kind && !(kind === "file" ? fs.statSync(absolute).isFile() : fs.statSync(absolute).isDirectory())) fail("REFRESH_PATH_KIND_MISMATCH");
  if (fs.existsSync(absolute) && !equalPath(fs.realpathSync.native(absolute), absolute)) fail("REFRESH_PATH_ALIAS");
  return absolute;
}

function inside(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith(".." + path.sep) && relative !== ".." && !path.isAbsolute(relative));
}

function run(command, args, { cwd = SOURCE, env = childEnvironment(), timeout = 60000 } = {}) {
  const result = spawnSync(command, args, { cwd, env, encoding: "utf8", shell: false, windowsHide: true,
    timeout, maxBuffer: 16 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] });
  if (result.error || result.signal || result.status !== 0) {
    const error = new Error("REFRESH_CHILD_FAILED");
    // Child output can include local credentials; retain only bounded process metadata.
    error.diagnostics = { command: path.basename(command), exit_code: result.status,
      signal: result.signal, error_code: result.error?.code ?? null };
    throw error;
  }
  return result.stdout;
}

function git(root, args) {
  return run("git", ["-C", root, "-c", "core.fsmonitor=false", "-c", "core.untrackedCache=false", ...args],
    { cwd: root, env: { ...childEnvironment(), GIT_OPTIONAL_LOCKS: "0" } });
}

function sourceRecord() {
  const head = git(SOURCE, ["rev-parse", "HEAD"]).trim();
  const status = git(SOURCE, ["status", "--porcelain=v1", "--untracked-files=all"]);
  const diff = git(SOURCE, ["diff", "HEAD", "--binary", "--no-ext-diff", "--no-textconv"]);
  const untracked = git(SOURCE, ["ls-files", "--others", "--exclude-standard", "-z"]).split("\0").filter(Boolean)
    .map((relative) => ({ path: relative, sha256: hash(fs.readFileSync(checkedPath(path.join(SOURCE, relative), "file"))) }));
  const content = { head, dirty: Boolean(status.trim()), status, diff_sha256: hash(diff), untracked };
  return { ...content, snapshot_sha256: fingerprint(content), diff };
}

function inventory(root, { omitGit = false } = {}) {
  const files = {};
  function visit(directory, prefix = "") {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (omitGit && prefix === "" && entry.name === ".git") continue;
      const relative = prefix + entry.name, absolute = checkedPath(path.join(directory, entry.name));
      if (entry.isDirectory()) visit(absolute, relative + "/");
      else if (entry.isFile()) files[relative] = hash(fs.readFileSync(absolute));
      else fail("REFRESH_UNSAFE_INVENTORY_ENTRY");
    }
  }
  visit(checkedPath(root, "directory"));
  return files;
}

function nativeHomeIdentity(root) {
  // Native profiles contain live databases, lock files and credentials. Never
  // read or copy their contents. Trust is observed separately through the API;
  // preservation here follows from directory identity and bounded write roots.
  const absolute = checkedPath(root, "directory");
  return { path: absolute, ...nativeQualificationHomeIdentity(absolute) };
}

export function agentNativeRefreshProfileSelection(manifest) {
  const selected=manifest?.native_profile;
  if(selected===undefined) return {mode:"isolated"};
  const keys=selected && typeof selected==="object" && !Array.isArray(selected)?Object.keys(selected):[];
  if(selected?.mode==="isolated" && keys.length===1) return {mode:"isolated"};
  if(selected?.mode!=="preexisting" || keys.length!==2 || !keys.includes("mode") || !keys.includes("home_identity_sha256")
      || !/^[a-f0-9]{64}$/.test(selected.home_identity_sha256 ?? "")) fail("REFRESH_NATIVE_PROFILE_SELECTION_INVALID");
  return {mode:"preexisting",home_identity_sha256:selected.home_identity_sha256};
}

// Metadata only: shared with preparation so its manifest digest cannot drift
// because this refresh tool has historically included an additional `path` key.
export function readAgentNativeRefreshHomeIdentity(manifest) {
  const selected=agentNativeRefreshProfileSelection(manifest), observed=nativeHomeIdentity(manifest.codex_home);
  const {path:declared,...physicalIdentity}=observed;
  if(!equalPath(declared,physicalIdentity.physical_path)) fail("REFRESH_PATH_ALIAS");
  if(selected.mode==="preexisting" && fingerprint(physicalIdentity)!==selected.home_identity_sha256) fail("REFRESH_NATIVE_HOME_CHANGED");
  return observed;
}

function put(root, relative, contents) {
  const file = checkedPath(path.join(root, relative));
  if (!inside(root, file)) fail("REFRESH_OUTPUT_ESCAPE");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, contents, { flag: "wx" });
}

function findNpm(explicit) {
  const candidates = explicit ? [explicit] : [path.join(path.dirname(process.execPath), "node_modules/npm/bin/npm-cli.js"),
    path.resolve(path.dirname(process.execPath), "../lib/node_modules/npm/bin/npm-cli.js")];
  const selected = candidates.find((candidate) => fs.existsSync(candidate));
  if (!selected) fail("REFRESH_NPM_CLI_REQUIRED");
  return checkedPath(selected, "file");
}

// An observed native API response is evidence, never an instruction to modify trust.
export function assertAgentNativeRefreshReview(manifest, evidence) {
  if (!manifest || manifest.status !== "prepared" || manifest.native_execution !== "NOT_RUN"
      || !Array.isArray(manifest.roots) || manifest.roots.length !== 3
      || !same(manifest.roots.map((root) => root.role).sort(), ["coordinator", "worker-a", "worker-b"])) fail("REFRESH_PREPARATION_REQUIRED");
  if (!evidence || !evidence.human_confirmation || typeof evidence.human_confirmation !== "string"
      || !Number.isFinite(Date.parse(evidence.observed_at)) || evidence.process_closed !== true
      || evidence.source_head !== manifest.source.head || evidence.candidate_sha256 !== manifest.candidate.sha256
      || evidence.codex_sha256 !== manifest.codex.sha256 || !equalPath(evidence.codex_home, manifest.codex_home)) fail("REFRESH_NATIVE_REVIEW_BINDING_MISMATCH");
  const surfaces = evidence.hooks?.data;
  if (!Array.isArray(surfaces) || surfaces.length !== 2) fail("REFRESH_NATIVE_HOOKS_REQUIRED");
  for (const root of manifest.roots.filter((entry) => entry.role !== "coordinator")) {
    const matches = surfaces.filter((entry) => equalPath(entry.cwd, root.root));
    if (matches.length !== 1) fail("REFRESH_NATIVE_ROOT_MISMATCH");
    const surface = matches[0];
    if (surface.errors?.length || surface.warnings?.length || !Array.isArray(surface.hooks) || surface.hooks.length !== 2) fail("REFRESH_NATIVE_HOOKS_REQUIRED");
    for (const [nativeEvent, configEvent] of [["preToolUse", "PreToolUse"], ["sessionStart", "SessionStart"]]) {
      const hooks = surface.hooks.filter((item) => item.eventName === nativeEvent);
      if (hooks.length !== 1) fail("REFRESH_NATIVE_HOOKS_REQUIRED");
      const hook = hooks[0];
      const source = manifest.roots.find((entry) => equalPath(entry.hooks?.config?.path, hook.sourcePath));
      if (!source || hook.source !== "project" || hook.enabled !== true || hook.trustStatus !== "trusted"
          || hook.handlerType !== "command" || hook.async !== false || !/^sha256:[a-f0-9]{64}$/.test(hook.currentHash ?? "")) fail("REFRESH_NATIVE_HOOK_UNTRUSTED");
      const groups = JSON.parse(source.hooks.definition)?.hooks?.[configEvent];
      if (!Array.isArray(groups) || groups.length !== 1 || groups[0].hooks?.length !== 1) fail("REFRESH_NATIVE_DEFINITION_MISMATCH");
      const definition = groups[0].hooks[0];
      const command = process.platform === "win32" ? definition.commandWindows ?? definition.command : definition.command;
      if (hook.command !== command || hook.matcher !== groups[0].matcher || hook.timeoutSec !== definition.timeout
          || (nativeEvent === "preToolUse" && hook.matcher !== ".*")) fail("REFRESH_NATIVE_DEFINITION_MISMATCH");
    }
  }
  return true;
}

const identityContinuity = value => identityPath(path.resolve(value));
const requireContinuity = (condition, code) => { if (!condition) fail(code); };
// Pure continuity validation shared with fixtures. Receipt hashes and their
// installation plan IDs may change; native identities and reviewed hooks may not.
export function assertAgentNativeQualificationRefreshContinuity({manifest,trust,previousManifest,previousTrust}) {
  assertAgentNativeRefreshReview(manifest,trust);
  assertAgentNativeRefreshReview(previousManifest,previousTrust);
  requireContinuity(same(agentNativeRefreshProfileSelection(manifest),agentNativeRefreshProfileSelection(previousManifest)),
    "QUALIFICATION_REFRESH_NATIVE_PROFILE_CHANGED");
  requireContinuity(identityContinuity(manifest.codex_home)===identityContinuity(previousManifest.codex_home)
    && isDeepStrictEqual(manifest.codex,previousManifest.codex)
    && manifest.host.platform===previousManifest.host.platform && manifest.host.architecture===previousManifest.host.architecture,
  "QUALIFICATION_REFRESH_NATIVE_RUNTIME_CHANGED");
  for(const root of manifest.roots) {
    const before=previousManifest.roots.find(row=>row.role===root.role);
    requireContinuity(before && identityContinuity(root.root)===identityContinuity(before.root)
      && ["worktree_id","branch","head"].every(key=>root[key]===before[key])
      && isDeepStrictEqual(root.identity,before.identity) && isDeepStrictEqual(root.activation,before.activation)
      && isDeepStrictEqual(root.hooks,before.hooks)
      && isDeepStrictEqual({...root.installation,plan_id:null},{...before.installation,plan_id:null})
      && root.receipt.root_id===before.receipt.root_id && identityContinuity(root.receipt.path)===identityContinuity(before.receipt.path)
      && root.attempt_marker_present===false && before.attempt_marker_present===false,
    "QUALIFICATION_REFRESH_ROOT_IDENTITY_CHANGED");
  }
  for(const surface of trust.hooks.data) {
    const previous=previousTrust.hooks.data.find(row=>identityContinuity(row.cwd)===identityContinuity(surface.cwd));
    requireContinuity(previous,"QUALIFICATION_REFRESH_NATIVE_ROOT_CHANGED");
    for(const hook of surface.hooks) {
      const before=previous.hooks.find(row=>row.eventName===hook.eventName);
      requireContinuity(before && identityContinuity(before.sourcePath)===identityContinuity(hook.sourcePath) && before.currentHash===hook.currentHash,
        "QUALIFICATION_REFRESH_NATIVE_DEFINITION_CHANGED");
    }
  }
  return true;
}

// Refresh is intentionally receipt-only. Any asset change requires fresh preparation.
export function assertAgentNativeRefreshPlan(plan) {
  if (!plan?.ok || plan.pending || !Array.isArray(plan.operations) || !plan.operations.length) fail("REFRESH_INSTALL_PLAN_UNREADY");
  if (plan.authorization && plan.authorization.effect !== "unchanged") fail("REFRESH_AUTHORIZATION_CHANGE_FORBIDDEN");
  if ((plan.external_effects ?? []).some((effect) => effect.state !== "skipped")) fail("REFRESH_EXTERNAL_EFFECT_FORBIDDEN");
  if (plan.operations.some((operation) => operation.path === ".codex/hooks.json" || operation.path.startsWith(".codex/hooks/")) === false) fail("REFRESH_HOOK_PLAN_MISSING");
  if (plan.operations.some((operation) => operation.effect !== "unchanged" || operation.before_hash !== operation.after_hash)) fail("REFRESH_INSTALL_ASSETS_CHANGED");
  return true;
}

function hooksRecord(root) {
  const configPath = checkedPath(path.join(root, ".codex/hooks.json"), "file");
  return { config: { path: configPath, sha256: hash(fs.readFileSync(configPath)) }, definition: fs.readFileSync(configPath, "utf8"),
    handlers: Object.entries(inventory(path.join(root, ".codex/hooks"))).map(([relative, sha256]) => ({ path: ".codex/hooks/" + relative, sha256 })) };
}

function baseline(roots) {
  return { roots: roots.map((entry) => ({ role: entry.role, root: entry.root,
    files: inventory(entry.root, { omitGit: true }), runtime: inventory(path.join(entry.root, ".aidn/runtime")),
    git_dir: entry.identity.git_dir, git_files: inventory(entry.identity.git_dir),
    status: git(entry.root, ["status", "--porcelain=v1", "--untracked-files=all"]) })),
  common_git_dir: roots[0].identity.common_dir, common_git_files: inventory(roots[0].identity.common_dir) };
}

function gitMarkers(roots) {
  return roots.map(({ role, root }) => {
    const markerPath = checkedPath(path.join(root, ".git")), stat = fs.statSync(markerPath);
    const marker = stat.isDirectory() ? { kind: "directory" }
      : { kind: "file", bytes: stat.size, sha256: hash(fs.readFileSync(markerPath)) };
    return { role, root, marker };
  });
}

export function assertAgentNativeRefreshGitMarkers(before, after) {
  if (!same(before, after)) fail("REFRESH_GIT_MARKER_CHANGED");
  return true;
}

function assertActivation(entry, activation, packageRoot) {
  if (!activation.active || activation.state !== "active" || activation.authorization?.status !== "authorized"
      || activation.identity?.root_id !== entry.worktree_id || !equalPath(activation.identity?.target_root, entry.root)
      || activation.identity?.authority_id !== entry.activation.authority_id || activation.authorization?.revision !== entry.activation.revision
      || !same(activation.identity, entry.identity) || activation.receipt?.root_id !== entry.worktree_id
      || !equalPath(activation.receipt?.package?.root, packageRoot) || activation.receipt?.global_runtime
      || activation.receipt?.installation?.args?.persistencePolicy !== "verify-only") fail("REFRESH_ACTIVATION_DRIFT");
}

export function assertAgentNativeRefreshPreservation(before, after, completedRoles = []) {
  if (!same(before.common_git_files, after.common_git_files) || !equalPath(before.common_git_dir, after.common_git_dir)
      || before.roots.length !== after.roots.length) fail("REFRESH_GIT_CHANGED");
  for (const old of before.roots) {
    const current = after.roots.find((entry) => entry.role === old.role);
    if (!current || !equalPath(old.root, current.root) || !equalPath(old.git_dir, current.git_dir)
        || !same(old.git_files, current.git_files) || old.status !== current.status) fail("REFRESH_GIT_CHANGED");
    if (!same(old.runtime, current.runtime)) fail("REFRESH_RUNTIME_CHANGED");
    for (const relative of new Set([...Object.keys(old.files), ...Object.keys(current.files)])) {
      if (old.files[relative] === current.files[relative]) continue;
      const receiptChange = relative === ".aidn/install/receipt.json";
      const newTransaction = /^\.aidn\/install\/transactions\/[a-f0-9]{32}\.json$/.test(relative) && old.files[relative] === undefined;
      if (!completedRoles.includes(old.role) || (!receiptChange && !newTransaction)) fail("REFRESH_UNEXPECTED_ROOT_CHANGE");
    }
  }
  return true;
}

// Pure layout/provenance checks; the caller supplies hashes from observed bytes.
export function assertAgentNativeRefreshLineage(lineage, outputRoot) {
  if (!Array.isArray(lineage) || !lineage.length || lineage.length > 32) fail("REFRESH_LINEAGE_LIMIT");
  if (typeof outputRoot !== "string" || !path.isAbsolute(outputRoot)) fail("REFRESH_ABSOLUTE_PATH_REQUIRED");
  const seen = new Set();
  for (const [index, entry] of lineage.entries()) {
    const { manifest, evidence, manifestPath, manifestSha256, trustEvidencePath, trustSha256 } = entry;
    const selected=agentNativeRefreshProfileSelection(manifest);
    if (![manifestPath, trustEvidencePath, manifest.output_root, manifest.codex_home,
      manifest.candidate.packageRoot, manifest.candidate.archivePath, ...manifest.roots.map(root => root.root)]
      .every(value => typeof value === "string" && path.isAbsolute(value))) fail("REFRESH_ABSOLUTE_PATH_REQUIRED");
    if (![manifestSha256, trustSha256].every(value => /^[a-f0-9]{64}$/.test(value ?? ""))) fail("REFRESH_LINEAGE_HASH_INVALID");
    assertAgentNativeRefreshReview(manifest, evidence);
    if(manifest.roots.some(root=>root.attempt_marker_present!==false)) fail("REFRESH_ATTEMPT_ALREADY_STARTED");
    if(selected.mode==="preexisting") {
      // Codex-managed source worktrees may reside below CODEX_HOME. Only this
      // exact source is read and packed; the surrounding profile is not scanned.
      // The home itself must never be a source entry eligible for packaging.
      if(inside(SOURCE,manifest.codex_home)) fail("REFRESH_NATIVE_PROFILE_OVERLAP");
      const protectedRoots=[outputRoot,manifest.output_root,manifest.candidate.packageRoot,
        manifest.candidate.archivePath,manifest.codex.binary_path,...manifest.roots.map(root=>root.root)];
      if(protectedRoots.some(root=>inside(root,manifest.codex_home) || inside(manifest.codex_home,root))) fail("REFRESH_NATIVE_PROFILE_OVERLAP");
    }
    const key = identityContinuity(manifestPath);
    if (seen.has(key)) fail("REFRESH_LINEAGE_CYCLE");
    seen.add(key);
    if (!equalPath(path.dirname(manifestPath), manifest.output_root)
        || inside(manifest.output_root, outputRoot)) fail("REFRESH_OUTPUT_OVERLAP");
    if (!inside(manifest.output_root, manifest.candidate.packageRoot)
        || !inside(manifest.output_root, manifest.candidate.archivePath)) fail("REFRESH_PREPARATION_PATH_MISMATCH");
    const previous = lineage[index + 1];
    if (previous) {
      if (!manifest.refresh || !equalPath(manifest.refresh.prior_manifest, previous.manifestPath)
          || manifest.refresh.prior_manifest_sha256 !== previous.manifestSha256
          || !equalPath(manifest.refresh.trust_evidence?.path, previous.trustEvidencePath)
          || manifest.refresh.trust_evidence?.sha256 !== previous.trustSha256) fail("REFRESH_LINEAGE_BINDING_MISMATCH");
      assertAgentNativeQualificationRefreshContinuity({ manifest, trust: evidence,
        previousManifest: previous.manifest, previousTrust: previous.evidence });
    } else if (manifest.refresh) fail("REFRESH_LINEAGE_INCOMPLETE");
  }
  const origin = lineage.at(-1).manifest.output_root;
  for (const { manifest } of lineage) {
    if ((agentNativeRefreshProfileSelection(manifest).mode==="isolated" && !inside(origin, manifest.codex_home))
        || manifest.roots.some(entry => !inside(origin, entry.root))) fail("REFRESH_PREPARATION_PATH_MISMATCH");
  }
  return origin;
}

export function readAgentNativeRefreshLineage(manifestPath, trustEvidencePath, outputRoot) {
  const lineage = [], seen = new Set();
  for (;;) {
    if (lineage.length >= 32) fail("REFRESH_LINEAGE_LIMIT");
    manifestPath = checkedPath(manifestPath, "file");
    trustEvidencePath = checkedPath(trustEvidencePath, "file");
    if (seen.has(identityContinuity(manifestPath))) fail("REFRESH_LINEAGE_CYCLE");
    seen.add(identityContinuity(manifestPath));
    const manifestBytes = fs.readFileSync(manifestPath), trustBytes = fs.readFileSync(trustEvidencePath);
    const manifest = JSON.parse(manifestBytes), evidence = JSON.parse(trustBytes);
    lineage.push({ manifest, evidence, manifestPath, trustEvidencePath,
      manifestSha256: hash(manifestBytes), trustSha256: hash(trustBytes) });
    if (!manifest.refresh) break;
    manifestPath = manifest.refresh.prior_manifest;
    trustEvidencePath = manifest.refresh.trust_evidence?.path;
  }
  return { lineage, originOutput: assertAgentNativeRefreshLineage(lineage, outputRoot) };
}

async function inspect({ manifestPath, trustEvidencePath, outputRoot, npmCli }) {
  for (const value of [manifestPath, trustEvidencePath, outputRoot, npmCli]) assertAgentLocalPath(value);
  manifestPath = checkedPath(manifestPath, "file");
  trustEvidencePath = checkedPath(trustEvidencePath, "file");
  outputRoot = checkedPath(outputRoot);
  if (fs.existsSync(outputRoot)) fail("REFRESH_OUTPUT_ALREADY_EXISTS");
  checkedPath(path.dirname(outputRoot), "directory");
  if (inside(SOURCE, outputRoot)) fail("REFRESH_OUTPUT_INSIDE_SOURCE");
  const { lineage, originOutput } = readAgentNativeRefreshLineage(manifestPath, trustEvidencePath, outputRoot);
  const { manifest, evidence } = lineage[0];
  const selected=agentNativeRefreshProfileSelection(manifest);
  const oldOutput = checkedPath(manifest.output_root, "directory");
  if (!equalPath(path.dirname(manifestPath), oldOutput) || inside(oldOutput, outputRoot)) fail("REFRESH_OUTPUT_OVERLAP");
  checkedPath(manifest.codex_home, "directory");
  checkedPath(manifest.codex.binary_path, "file");
  checkedPath(manifest.candidate.packageRoot, "directory");
  checkedPath(manifest.candidate.archivePath, "file");
  if ((selected.mode==="isolated" && !inside(originOutput, manifest.codex_home)) || !inside(oldOutput, manifest.candidate.packageRoot)
      || !inside(oldOutput, manifest.candidate.archivePath)) fail("REFRESH_PREPARATION_PATH_MISMATCH");
  if (new Set(manifest.roots.map((entry) => identityPath(checkedPath(entry.root, "directory")))).size !== 3
      || new Set(manifest.roots.map((entry) => entry.worktree_id)).size !== 3) fail("REFRESH_ROOT_IDENTITY_INVALID");
  for (const entry of manifest.roots) {
    if (!inside(originOutput, entry.root) || inside(entry.root, outputRoot) || !equalPath(entry.receipt.path, path.join(entry.root, ".aidn/install/receipt.json"))) fail("REFRESH_PREPARATION_PATH_MISMATCH");
    if (entry.attempt_marker_present || fs.existsSync(path.join(entry.root, ".codex/aidn-agent-attempt.json"))) fail("REFRESH_ATTEMPT_ALREADY_STARTED");
    if (git(entry.root, ["branch", "--show-current"]).trim() !== entry.branch || git(entry.root, ["rev-parse", "HEAD"]).trim() !== entry.head) fail("REFRESH_GIT_IDENTITY_DRIFT");
    if (hash(fs.readFileSync(checkedPath(entry.receipt.path, "file"))) !== entry.receipt.sha256 || !same(hooksRecord(entry.root), entry.hooks)) fail("REFRESH_REVIEWED_BYTES_CHANGED");
  }
  if (hash(fs.readFileSync(manifest.codex.binary_path)) !== manifest.codex.sha256
      || hash(fs.readFileSync(manifest.candidate.archivePath)) !== manifest.candidate.sha256) fail("REFRESH_BINARY_IDENTITY_DRIFT");
  const from = (root, relative) => import(pathToFileURL(path.join(root, relative)).href);
  const oldActivation = await from(manifest.candidate.packageRoot, "src/application/install/project-activation-service.mjs");
  const { inventoryRuntime } = await from(manifest.candidate.packageRoot, "src/application/install/global-runtime-store.mjs");
  if (!same(inventoryRuntime(manifest.candidate.packageRoot, { beforeObserve: assertAgentLocalPath }), manifest.candidate.inventory)) fail("REFRESH_OLD_CANDIDATE_CHANGED");
  const before = baseline(manifest.roots), markersBefore = gitMarkers(manifest.roots);
  const baselinePath = checkedPath(path.join(oldOutput, "baseline.local.json"), "file");
  const baselineBytes = fs.readFileSync(baselinePath);
  if (hash(baselineBytes) !== manifest.baseline_sha256 || !same(JSON.parse(baselineBytes), before)) fail("REFRESH_PREPARATION_BASELINE_DRIFT");
  const homeBefore = readAgentNativeRefreshHomeIdentity(manifest);
  const source = sourceRecord(), { diff, ...sourceIdentity } = source;
  const sourceInstall = await from(SOURCE, "src/application/install/installation-service.mjs");
  const sourcePlans = [];
  for (const entry of manifest.roots) {
    assertActivation(entry, oldActivation.readActivation({ targetRoot: entry.root }), manifest.candidate.packageRoot);
    const plan = await sourceInstall.planInstallation({ repoRoot: SOURCE, targetRoot: entry.root, args: ARGS });
    assertAgentNativeRefreshPlan(plan);
    sourcePlans.push({ role: entry.role, plan_id: plan.plan_id, operations_sha256: fingerprint(plan.operations) });
  }
  assertAgentNativeRefreshPreservation(before, baseline(manifest.roots));
  assertAgentNativeRefreshGitMarkers(markersBefore, gitMarkers(manifest.roots));
  if (!same(homeBefore, readAgentNativeRefreshHomeIdentity(manifest))) fail("REFRESH_NATIVE_HOME_CHANGED");
  npmCli = findNpm(npmCli);
  if(selected.mode==="preexisting" && inside(manifest.codex_home,npmCli)) fail("REFRESH_NATIVE_PROFILE_OVERLAP");
  const preimages = { manifest_sha256: hash(fs.readFileSync(manifestPath)), trust_evidence_sha256: hash(fs.readFileSync(trustEvidencePath)),
    lineage: lineage.map(({ manifestPath, manifestSha256, trustEvidencePath, trustSha256 }) => ({ manifestPath, manifestSha256, trustEvidencePath, trustSha256 })),
    baseline_sha256: fingerprint(before), git_markers: markersBefore, codex_home_identity_sha256: fingerprint(homeBefore), source: sourceIdentity,
    npm_cli: npmCli, npm_cli_sha256: hash(fs.readFileSync(npmCli)), source_plans: sourcePlans, output_root: outputRoot };
  return { manifestPath, trustEvidencePath, outputRoot, manifest, evidence, before, markersBefore, homeBefore, source, npmCli, preimages,
    planId: fingerprint(preimages), oldActivation };
}

// Internal preparation refresh only: no public command, model, trust mutation or database.
export async function refreshAgentNativeCandidate({ manifestPath, trustEvidencePath, outputRoot, npmCli, write = false, expectedPlanId } = {}) {
  const context = await inspect({ manifestPath, trustEvidencePath, outputRoot, npmCli });
  const { manifest, before, markersBefore, homeBefore, preimages, planId, source, oldActivation } = context;
  const selected=agentNativeRefreshProfileSelection(manifest), preexisting=selected.mode==="preexisting";
  ({ manifestPath, trustEvidencePath, outputRoot, npmCli } = context);
  const { diff, ...sourceIdentity } = source;
  const preview = { ok: true, status: "preview", written: false, plan_id: planId, output_root: outputRoot,
    prior_manifest: manifestPath, source: sourceIdentity, roots: manifest.roots.map(({ role, root }) => ({ role, root })),
    codex_home: manifest.codex_home, native_profile:selected, preimages_sha256: fingerprint(preimages),
    effects: ["pack exact source", "install new isolated engine", "rebind three root-specific receipts with verify-only", "record fresh baseline"],
    native_execution: "NOT_RUN", human_trust: "PRESERVED_DEFINITION_RECHECK_REQUIRED", llm_calls: 0 };
  if (!write) return preview;
  if (typeof expectedPlanId !== "string" || expectedPlanId !== planId) fail("REFRESH_EXPECTED_PLAN_REQUIRED_OR_STALE");
  if (source.dirty) fail("REFRESH_CLEAN_SOURCE_REQUIRED");
  // Freeze the complete expected preimage again immediately before claiming output.
  const confirmed = await inspect({ manifestPath, trustEvidencePath, outputRoot, npmCli });
  if (confirmed.planId !== planId) fail("REFRESH_PREIMAGE_CHANGED");
  fs.mkdirSync(outputRoot);
  const preparationId = randomUUID(), completedRoles = [];
  try {
    put(outputRoot, "owner.local.json", json({ preparation_id: preparationId, kind: "candidate-refresh", created_at: new Date().toISOString(), pid: process.pid }));
    put(outputRoot, "preimages.local.json", json(preimages));
    put(outputRoot, "source.diff", diff);
    const artifacts = path.join(outputRoot, "artifacts"), engine = path.join(outputRoot, "engine");
    fs.mkdirSync(artifacts); fs.mkdirSync(engine);
    put(outputRoot, "npmrc", ""); put(outputRoot, "global-npmrc", "");
    const npmEnv = { ...childEnvironment(), NPM_CONFIG_USERCONFIG: path.join(outputRoot, "npmrc"),
      NPM_CONFIG_GLOBALCONFIG: path.join(outputRoot, "global-npmrc"), NPM_CONFIG_CACHE: path.join(outputRoot, "npm-cache") };
    const packed = JSON.parse(run(process.execPath, [npmCli, "pack", SOURCE, "--ignore-scripts", "--json", "--pack-destination", artifacts], { env: npmEnv, timeout: 240000 }));
    if (packed.length !== 1 || path.basename(packed[0].filename) !== packed[0].filename) fail("REFRESH_INVALID_PACK_RESULT");
    if (sourceRecord().snapshot_sha256 !== source.snapshot_sha256) fail("REFRESH_SOURCE_CHANGED_DURING_PACK");
    const archivePath = checkedPath(path.join(artifacts, packed[0].filename), "file");
    run(process.execPath, [npmCli, "install", "--prefix", engine, "--ignore-scripts", "--no-audit", "--no-fund", "--save-exact", "--package-lock", archivePath], { env: npmEnv, timeout: 240000 });
    const packageRoot = checkedPath(path.join(engine, "node_modules/aidn-workflow"), "directory");
    const installedModule = (relative) => import(pathToFileURL(path.join(packageRoot, relative)).href);
    const { inventoryRuntime } = await installedModule("src/application/install/global-runtime-store.mjs");
    const { planInstallation, executeInstallation, verifyInstallationCandidate } = await installedModule("src/application/install/installation-service.mjs");
    const { readActivation } = await installedModule("src/application/install/project-activation-service.mjs");
    const candidate = { packageRoot, archivePath, sha256: hash(fs.readFileSync(archivePath)),
      version: fs.readFileSync(path.join(packageRoot, "VERSION"), "utf8").trim(), inventory: inventoryRuntime(packageRoot, { beforeObserve: assertAgentLocalPath }) };
    if (JSON.parse(fs.readFileSync(path.join(packageRoot, "package.json"))).version !== candidate.version) fail("REFRESH_PACKAGE_VERSION_MISMATCH");
    const plans = [];
    for (const entry of manifest.roots) {
      const plan = await planInstallation({ repoRoot: packageRoot, targetRoot: entry.root, args: ARGS });
      assertAgentNativeRefreshPlan(plan);
      plans.push(plan);
    }
    if (sourceRecord().snapshot_sha256 !== source.snapshot_sha256) fail("REFRESH_SOURCE_CHANGED_DURING_PACK");
    const roots = [];
    for (const [index, entry] of manifest.roots.entries()) {
      assertAgentNativeRefreshPreservation(before, baseline(manifest.roots), completedRoles);
      assertAgentNativeRefreshGitMarkers(markersBefore, gitMarkers(manifest.roots));
      if (!same(homeBefore, readAgentNativeRefreshHomeIdentity(manifest))) fail("REFRESH_NATIVE_HOME_CHANGED");
      assertActivation(entry, oldActivation.readActivation({ targetRoot: entry.root }), manifest.candidate.packageRoot);
      if (hash(fs.readFileSync(entry.receipt.path)) !== entry.receipt.sha256 || !same(hooksRecord(entry.root), entry.hooks)) fail("REFRESH_PREIMAGE_CHANGED");
      const options = { repoRoot: packageRoot, targetRoot: entry.root, args: ARGS };
      const result = await executeInstallation({ ...options, dryRun: false, expectedPlanId: plans[index].plan_id });
      if (!result.ok) fail("REFRESH_INSTALL_FAILED");
      completedRoles.push(entry.role);
      const verified = await verifyInstallationCandidate(options), activation = readActivation({ targetRoot: entry.root });
      if (!verified.ok) fail("REFRESH_INSTALL_VERIFICATION_FAILED");
      assertAgentNativeRefreshPlan(verified);
      assertActivation(entry, activation, packageRoot);
      if (!same(hooksRecord(entry.root), entry.hooks)) fail("REFRESH_REVIEWED_BYTES_CHANGED");
      assertAgentNativeRefreshPreservation(before, baseline(manifest.roots), completedRoles);
      assertAgentNativeRefreshGitMarkers(markersBefore, gitMarkers(manifest.roots));
      roots.push({ ...entry, installation: { ...entry.installation, plan_id: plans[index].plan_id },
        receipt: { ...entry.receipt, sha256: hash(fs.readFileSync(entry.receipt.path)) } });
    }
    if (!same(homeBefore, readAgentNativeRefreshHomeIdentity(manifest))) fail("REFRESH_NATIVE_HOME_CHANGED");
    if (hash(fs.readFileSync(manifest.codex.binary_path)) !== manifest.codex.sha256
        || !same(inventoryRuntime(packageRoot, { beforeObserve: assertAgentLocalPath }), candidate.inventory)) fail("REFRESH_BINARY_IDENTITY_DRIFT");
    const after = baseline(roots);
    assertAgentNativeRefreshPreservation(before, after, completedRoles);
    assertAgentNativeRefreshGitMarkers(markersBefore, gitMarkers(roots));
    const record = { ...manifest, preparation_id: preparationId, source: sourceIdentity, candidate, output_root: outputRoot,
      host: { platform: process.platform, architecture: process.arch, release: os.release(), node: process.version }, roots,
      codex_home_empty: preexisting?false:fs.readdirSync(manifest.codex_home).length === 0, engine_lock_sha256: hash(fs.readFileSync(path.join(engine, "package-lock.json"))),
      baseline_sha256: hash(json(after)), human_trust: preview.human_trust, native_execution: "NOT_RUN", llm_calls: 0,
      refresh: { plan_id: planId, prior_manifest: manifestPath, prior_manifest_sha256: preimages.manifest_sha256,
        trust_evidence: { path: trustEvidencePath, sha256: preimages.trust_evidence_sha256 },
        roots_and_hooks_preserved: true, git_markers: markersBefore,
        codex_home_identity_sha256: fingerprint(homeBefore), native_api_recheck_required: true } };
    put(outputRoot, "baseline.local.json", json(after));
    put(outputRoot, "manifest.local.json", json(record));
    put(outputRoot, "REVIEW.md", ["# Native candidate refresh", "", "Exact candidate: " + candidate.sha256,
      "Source HEAD: " + sourceIdentity.head, "", "Prior reviewed preparation: " + manifestPath,
      "Native review evidence: " + trustEvidencePath, "", "The three roots, hook definitions/handlers, Git metadata, runtime sentinels and " + (preexisting?"explicitly selected preexisting":"isolated") + " native home are preserved.",
      "Only root-specific receipts and new completed installation transactions changed. No trust or authentication was copied or written.",
      "Before native execution, query the supported hooks/list API again for both worker roots in the same " + (preexisting?"selected preexisting":"isolated") + " home. Require the same source paths and native hashes, enabled and trusted status. Preserve that fresh observation separately.",
      ...(preexisting?["Profile contents and policies were neither read nor copied. Observe configuration, native hooks and consented effects afresh for this candidate, then freeze its local policy before execution; the existing approval alone is not runtime admission."]:[]),
      "The new package has no native execution evidence. Repeat allowed/refused edit, actual descendant termination and preservation cases against this exact candidate.",
      "Changed roots, definitions or handlers require new preparation and human review. Old output and all failures remain preserved.", ""].join("\n"));
    return { ...preview, status: "prepared", written: true, preparation_id: preparationId,
      manifest: path.join(outputRoot, "manifest.local.json"), baseline: path.join(outputRoot, "baseline.local.json"),
      review: path.join(outputRoot, "REVIEW.md"), candidate: { ...candidate, inventory: undefined } };
  } catch (error) {
    const failure = { ok: false, status: "failed", written: true, output_root: outputRoot, preparation_id: preparationId,
      reason: error.code ?? error.message, diagnostics: error.diagnostics, completed_roles: completedRoles,
      cleanup: "PRESERVED_FOR_DIAGNOSIS", native_execution: "NOT_RUN", llm_calls: 0 };
    try { put(outputRoot, "failure.local.json", json(failure)); } catch { /* Preserve original failure. */ }
    error.preparation = failure;
    throw error;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const options = {}, args = process.argv.slice(2);
    const names = new Map([["--manifest", "manifestPath"], ["--trust-evidence", "trustEvidencePath"],
      ["--output-root", "outputRoot"], ["--npm-cli", "npmCli"], ["--expect-plan", "expectedPlanId"]]);
    for (let index = 0; index < args.length; index += 1) {
      if (args[index] === "--write") options.write = true;
      else if (args[index] === "--json") continue;
      else if (names.has(args[index]) && args[index + 1] && !args[index + 1].startsWith("--")) options[names.get(args[index])] = args[++index];
      else fail("REFRESH_UNKNOWN_OR_INCOMPLETE_ARGUMENT");
    }
    process.stdout.write(json(await refreshAgentNativeCandidate(options)));
  } catch (error) {
    process.stdout.write(json(error.preparation ?? { ok: false, status: "failed", written: false, reason: error.code ?? error.message, diagnostics: error.diagnostics, native_execution: "NOT_RUN", llm_calls: 0 }));
    process.exitCode = 1;
  }
}
