#!/usr/bin/env node
import fs from "node:fs";
import { assertAgentLocalPath } from "../../src/core/agents/agent-local-path-policy.mjs";
import os from "node:os";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { fingerprintAgentExecutionValue } from "../../src/core/agents/agent-execution-contracts.mjs";

const SOURCE = path.resolve(import.meta.dirname, "../..");
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const json = (value) => JSON.stringify(value, null, 2) + "\n";
const fail = (code) => { const error = new Error(code); error.code = code; throw error; };
const identityPath = (value) => process.platform === "win32" ? value.toLowerCase() : value;
const childEnvironment = () => Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(?:GIT_|AIDN_|CODEX_|OPENAI_|PG|POSTGRES|NPM_CONFIG_)/i.test(key)));

export function nativeQualificationHomeIdentity(home) {
  const absolute = checkedPath(home), stat = fs.statSync(absolute);
  if (!stat.isDirectory()) fail("PREPARATION_NATIVE_HOME_REQUIRED");
  return { physical_path: fs.realpathSync.native(absolute), device: stat.dev,
    inode: stat.ino, birthtime_ms: stat.birthtimeMs };
}

function checkedPath(value, kind) {
  assertAgentLocalPath(value);
  if (typeof value !== "string" || !path.isAbsolute(value)) fail("PREPARATION_ABSOLUTE_PATH_REQUIRED");
  const absolute = path.resolve(value);
  let cursor = absolute;
  while (true) {
    try {
      const stat = fs.lstatSync(cursor);
      if (stat.isSymbolicLink() || (!stat.isDirectory() && (!stat.isFile() || stat.nlink !== 1))) fail("PREPARATION_UNSAFE_PATH");
    } catch (error) { if (error.code !== "ENOENT") throw error; }
    const parent = path.dirname(cursor);
    if (parent === cursor) break;
    cursor = parent;
  }
  if (kind === "file" && !fs.statSync(absolute).isFile()) fail("PREPARATION_FILE_REQUIRED");
  return absolute;
}

function run(command, args, { cwd = SOURCE, env = childEnvironment(), timeout = 60000 } = {}) {
  const result = spawnSync(command, args, { cwd, env, encoding: "utf8", shell: false,
    windowsHide: true, timeout, maxBuffer: 16 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] });
  if (result.error || result.signal || result.status !== 0) {
    const error = new Error("PREPARATION_CHILD_FAILED");
    error.diagnostics = { command: path.basename(command), exit_code: result.status,
      signal: result.signal, error_code: result.error?.code ?? null,
      stderr_tail: String(result.stderr ?? "").slice(-2048) };
    throw error;
  }
  return result.stdout;
}

function git(root, args, { hooksPath } = {}) {
  const options = ["-C", root, "-c", "user.name=aidn-qualification", "-c", "user.email=fixture@example.invalid",
    "-c", "commit.gpgSign=false", "-c", "core.autocrlf=false", "-c", "core.fsmonitor=false", "-c", "core.untrackedCache=false"];
  if (hooksPath) options.push("-c", "core.hooksPath=" + hooksPath);
  return run("git", [...options, ...args], { cwd: root, env: { ...childEnvironment(), GIT_OPTIONAL_LOCKS: "0" } });
}

function sourceRecord() {
  const head = git(SOURCE, ["rev-parse", "HEAD"]).trim();
  const status = git(SOURCE, ["status", "--porcelain=v1", "--untracked-files=all"]);
  const diff = git(SOURCE, ["diff", "HEAD", "--binary", "--no-ext-diff", "--no-textconv"]);
  const untracked = git(SOURCE, ["ls-files", "--others", "--exclude-standard", "-z"]).split("\0").filter(Boolean)
    .map((relative) => ({ path: relative, sha256: hash(fs.readFileSync(checkedPath(path.join(SOURCE, relative), "file"))) }));
  return { head, dirty: Boolean(status.trim()), status, diff_sha256: hash(diff), untracked,
    snapshot_sha256: hash(json({ head, status, diff_sha256: hash(diff), untracked })), diff };
}

function findNpm(explicit) {
  const candidates = explicit ? [explicit] : [
    path.join(path.dirname(process.execPath), "node_modules/npm/bin/npm-cli.js"),
    path.resolve(path.dirname(process.execPath), "../lib/node_modules/npm/bin/npm-cli.js"),
  ];
  const selected = candidates.find((candidate) => fs.existsSync(candidate));
  if (!selected) fail("PREPARATION_NPM_CLI_REQUIRED");
  return checkedPath(selected, "file");
}

function inventory(root, { omitGit = false } = {}) {
  const files = {};
  function visit(directory, prefix = "") {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (omitGit && prefix === "" && entry.name === ".git") continue;
      const relative = prefix + entry.name, absolute = checkedPath(path.join(directory, entry.name));
      if (entry.isDirectory()) visit(absolute, relative + "/");
      else if (entry.isFile()) files[relative] = hash(fs.readFileSync(absolute));
      else fail("PREPARATION_UNSAFE_INVENTORY_ENTRY");
    }
  }
  visit(root);
  return files;
}

function put(root, relative, contents) {
  const file = checkedPath(path.join(root, relative));
  const rel = path.relative(root, file);
  if (rel.startsWith(".." + path.sep) || rel === ".." || path.isAbsolute(rel)) fail("PREPARATION_OUTPUT_ESCAPE");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, contents, { flag: "wx" });
}

function reviewSheet(record) {
  const lines = ["# Native worker qualification — human review required", "",
    "Preparation ID: " + record.preparation_id, "",
    "Preparation evidence only. Native trust, real Codex edits, refusals, descendant termination and isolation remain NOT_RUN. No model was called.", "",
    "## Exact candidate", "",
    "- Source HEAD: " + record.source.head + "; dirty: " + record.source.dirty,
    "- Candidate archive: " + record.candidate.archivePath, "- SHA-256: " + record.candidate.sha256,
    "- Installed package: " + record.candidate.packageRoot, "- Version: " + record.candidate.version,
    "- Codex binary: " + record.codex.binary_path, "- Codex SHA-256: " + record.codex.sha256,
    "- Codex version: " + record.codex.version, "- Explicit CODEX_HOME: " + record.codex_home,
    "- Native profile mode: " + (record.native_profile?.mode ?? "isolated"),
    "- Home empty: " + record.codex_home_empty, "",
    "## Human review through native controls", "",
    "Use the recorded binary and explicitly selected CODEX_HOME. Review the intended disposable worktree and exact executable hook definition through the native client's /hooks controls. Record the person, time, client surface, definition hashes and observed approval.",
    "Do not seed trust entries, copy authentication/trust, inject approved hashes or bypass a sandbox. If the client cannot expose this review, dependent native execution remains unavailable. Changed definitions require renewed review.", "",
    "The attempt marker .codex/aidn-agent-attempt.json is absent. Only the later supervisor may create it after a PostgreSQL claim, with protocol_version, attempt_id and request_sha256. Preparation grants neither a live lease nor a delegation.", ""];
  if (record.native_profile?.mode === "preexisting") lines.push(
    "## Preexisting profile: additional consent and evidence required", "",
    "Preparation did not launch this profile or change its configuration, authentication, trust or Windows sandbox. Its selection is not consent to execute a worker.",
    "Execution requires a separately reviewed frozen profile policy, native configuration and hook observations, existing sandbox readiness, and explicit consent for the bounded native profile effects. Extra hooks or uncontrolled integrations refuse execution. No setup, repair, profile fallback or copied credentials are part of this preparation.", "");
  for (const entry of record.roots) {
    lines.push("## " + entry.role, "", "Root: " + entry.root, "", "Branch: " + entry.branch, "",
      "Physical worktree ID: " + entry.worktree_id, "", "Receipt SHA-256: " + entry.receipt.sha256, "",
      "Exact .codex/hooks.json (SHA-256 " + entry.hooks.config.sha256 + "):", "", "~~~json", entry.hooks.definition.trim(), "~~~", "",
      "Handler hashes:", "", ...entry.hooks.handlers.map((handler) => "- " + handler.path + ": " + handler.sha256), "");
  }
  lines.push("## Required separate native evidence", "",
    "| Case | Status | Required observation |", "| --- | --- | --- |",
    "| Trust and /hooks review | NOT_RUN | Exact definitions approved through native controls |",
    "| Authorized edit | NOT_RUN | Covered native hook and one scoped change |",
    "| Forbidden edit | NOT_RUN | Native refusal; forbidden marker absent |",
    "| Descendant termination | NOT_RUN | Real child tree stopped; no orphan remains |",
    "| Isolation | NOT_RUN | Other worktree, Git metadata and runtime baseline preserved |", "",
    "Preserve manifest.local.json, baseline.local.json, archive, engine and receipts. They contain local paths and are not tracked publication artifacts. A newer candidate requires a new output directory and renewed review. No automatic cleanup occurs, including on failure.", "");
  return lines.join("\n");
}

// Internal preparation tooling: no new public aidn command and no model runner.
export async function prepareAgentNativeQualification({ outputRoot, codexBinary, npmCli, nativeProfileMode = "isolated", codexHome, write = false } = {}) {
  if (typeof write !== "boolean") fail("PREPARATION_EXPLICIT_WRITE_BOOLEAN_REQUIRED");
  if (!["isolated", "preexisting"].includes(nativeProfileMode)) fail("PREPARATION_NATIVE_PROFILE_MODE_INVALID");
  if ((nativeProfileMode === "preexisting") !== (codexHome !== undefined)) fail("PREPARATION_NATIVE_PROFILE_SELECTION_REQUIRED");
  for (const value of [outputRoot, codexBinary, npmCli, codexHome]) assertAgentLocalPath(value);
  const profileIdentity = nativeProfileMode === "preexisting" ? nativeQualificationHomeIdentity(codexHome) : null;
  if (profileIdentity) codexHome = profileIdentity.physical_path;
  outputRoot = checkedPath(outputRoot);
  codexBinary = checkedPath(codexBinary, "file");
  if (process.platform === "win32" && !/\.exe$/i.test(codexBinary)) fail("PREPARATION_NATIVE_EXECUTABLE_REQUIRED");
  if (fs.existsSync(outputRoot)) fail("PREPARATION_OUTPUT_ALREADY_EXISTS");
  const parent = path.dirname(outputRoot);
  if (!fs.statSync(parent).isDirectory() || identityPath(fs.realpathSync.native(parent)) !== identityPath(parent)) fail("PREPARATION_OUTPUT_PARENT_UNSAFE");
  const sourceRelative = path.relative(SOURCE, outputRoot);
  if (sourceRelative === "" || (!sourceRelative.startsWith(".." + path.sep) && sourceRelative !== ".." && !path.isAbsolute(sourceRelative))) fail("PREPARATION_OUTPUT_INSIDE_SOURCE");
  if (profileIdentity) {
    for (const [outer, inner] of [[codexHome, outputRoot], [outputRoot, codexHome], [SOURCE, codexHome]]) {
      const relative = path.relative(outer, inner);
      if (!relative || (!relative.startsWith(".." + path.sep) && relative !== ".." && !path.isAbsolute(relative))) fail("PREPARATION_NATIVE_PROFILE_OVERLAP");
    }
  }
  npmCli = findNpm(npmCli);
  const source = sourceRecord(), { diff, ...sourceIdentity } = source;
  const paths = { artifacts: path.join(outputRoot, "artifacts"), engine: path.join(outputRoot, "engine"),
    primary: path.join(outputRoot, "neutral project été"), workerA: path.join(outputRoot, "worker A été"), workerB: path.join(outputRoot, "worker B été"),
    codexHome: codexHome ?? path.join(outputRoot, "codex-home"), versionHome: path.join(outputRoot, "version-home"), hooks: path.join(outputRoot, "no-git-hooks") };
  const nativeProfile = { mode: nativeProfileMode,
    ...(profileIdentity ? { home_identity_sha256: fingerprintAgentExecutionValue(profileIdentity) } : {}) };
  const preview = { ok: true, status: "preview", written: false, output_root: outputRoot, source: sourceIdentity,
    codex: { binary_path: codexBinary, sha256: hash(fs.readFileSync(codexBinary)), version: "NOT_QUERIED_IN_PREVIEW" },
    planned_paths: paths, native_profile: nativeProfile, effects: ["pack candidate", "install isolated engine", "create neutral repository and two worktrees", "prepare each root with verify-only", "query Codex version in isolated metadata home", "write local review and baseline"],
    native_execution: "NOT_RUN", human_trust: "NOT_RECORDED", llm_calls: 0 };
  if (!write) return preview;

  fs.mkdirSync(outputRoot); // Exclusive claim; never merge into an existing output.
  const preparationId = randomUUID();
  try {
    put(outputRoot, "owner.local.json", json({ preparation_id: preparationId, created_at: new Date().toISOString(), pid: process.pid }));
    for (const directory of Object.values(paths).filter((value) => ![paths.workerA, paths.workerB, ...(profileIdentity ? [paths.codexHome] : [])].includes(value))) fs.mkdirSync(directory);
    put(outputRoot, "source.diff", diff);
    put(outputRoot, "npmrc", "");
    put(outputRoot, "global-npmrc", "");
    const npmEnv = { ...childEnvironment(), NPM_CONFIG_USERCONFIG: path.join(outputRoot, "npmrc"), NPM_CONFIG_GLOBALCONFIG: path.join(outputRoot, "global-npmrc"), NPM_CONFIG_CACHE: path.join(outputRoot, "npm-cache") };
    const packed = JSON.parse(run(process.execPath, [npmCli, "pack", SOURCE, "--ignore-scripts", "--json", "--pack-destination", paths.artifacts], { env: npmEnv, timeout: 240000 }));
    if (packed.length !== 1 || path.basename(packed[0].filename) !== packed[0].filename) fail("PREPARATION_INVALID_PACK_RESULT");
    if (sourceRecord().snapshot_sha256 !== source.snapshot_sha256) fail("PREPARATION_SOURCE_CHANGED_DURING_PACK");
    const archivePath = checkedPath(path.join(paths.artifacts, packed[0].filename), "file");
    run(process.execPath, [npmCli, "install", "--prefix", paths.engine, "--ignore-scripts", "--no-audit", "--no-fund", "--save-exact", "--package-lock", archivePath], { env: npmEnv, timeout: 240000 });
    const packageRoot = checkedPath(path.join(paths.engine, "node_modules/aidn-workflow"));
    const installedModule = (relative) => import(pathToFileURL(path.join(packageRoot, relative)).href);
    const { inventoryRuntime } = await installedModule("src/application/install/global-runtime-store.mjs");
    const { planInstallation, executeInstallation, verifyInstallationCandidate } = await installedModule("src/application/install/installation-service.mjs");
    const { readActivation } = await installedModule("src/application/install/project-activation-service.mjs");
    const candidate = { packageRoot, archivePath, sha256: hash(fs.readFileSync(archivePath)),
      version: fs.readFileSync(path.join(packageRoot, "VERSION"), "utf8").trim(), inventory: inventoryRuntime(packageRoot, { beforeObserve: assertAgentLocalPath }) };
    if (JSON.parse(fs.readFileSync(path.join(packageRoot, "package.json"))).version !== candidate.version) fail("PREPARATION_PACKAGE_VERSION_MISMATCH");
    const gitOptions = { hooksPath: paths.hooks };
    git(paths.primary, ["init", "--quiet", "--initial-branch=codex/qualification"], gitOptions);
    put(paths.primary, ".gitignore", ".aidn/\n.codex/\n.agents/\n");
    put(paths.primary, "src/allowed.txt", "neutral authorized marker target\n");
    put(paths.primary, "protected/sentinel.txt", "neutral forbidden marker target\n");
    git(paths.primary, ["add", ".gitignore", "src/allowed.txt", "protected/sentinel.txt"], gitOptions);
    git(paths.primary, ["commit", "--quiet", "-m", "Neutral native qualification fixture"], gitOptions);
    git(paths.primary, ["worktree", "add", "--quiet", "-b", "codex/qualification-worker-a", paths.workerA, "HEAD"], gitOptions);
    git(paths.primary, ["worktree", "add", "--quiet", "-b", "codex/qualification-worker-b", paths.workerB, "HEAD"], gitOptions);
    const roots = [];
    for (const [role, root] of [["coordinator", paths.primary], ["worker-a", paths.workerA], ["worker-b", paths.workerB]]) {
      const args = { pack: "core", persistencePolicy: "verify-only", runtimeStateMode: "files", artifactImportStore: "file", initDefaults: true, projectName: "neutral qualification", sourceBranch: "codex/qualification", verifyAfterInstall: true };
      const options = { repoRoot: packageRoot, targetRoot: root, args };
      const before = inventory(root, { omitGit: true });
      const plan = await planInstallation(options);
      if (!plan.ok) fail("PREPARATION_INSTALL_PLAN_FAILED:" + role + ":" + (plan.errors ?? []).join(";"));
      if (json(inventory(root, { omitGit: true })) !== json(before)) fail("PREPARATION_INSTALL_PREVIEW_MUTATED_ROOT");
      const applied = await executeInstallation({ ...options, dryRun: false, expectedPlanId: plan.plan_id });
      if (!applied.ok) fail("PREPARATION_INSTALL_FAILED:" + role + ":" + (applied.errors ?? []).join(";"));
      const verified = await verifyInstallationCandidate(options);
      const activation = readActivation({ targetRoot: root });
      if (!verified.ok || !activation.active || activation.state !== "active" || activation.receipt?.package?.root !== packageRoot) fail("PREPARATION_INSTALLED_BINDING_NOT_READY");
      if (activation.receipt.global_runtime) fail("PREPARATION_UNEXPECTED_GLOBAL_BINDING");
      put(root, ".aidn/runtime/qualification-sentinel.json", json({ fixture: "native-worker-qualification", role, preserved: true }));
      const configPath = path.join(root, ".codex/hooks.json");
      const hooks = { config: { path: configPath, sha256: hash(fs.readFileSync(configPath)) }, definition: fs.readFileSync(configPath, "utf8"),
        handlers: Object.entries(inventory(path.join(root, ".codex/hooks"))).map(([relative, sha256]) => ({ path: ".codex/hooks/" + relative, sha256 })) };
      roots.push({ role, root, worktree_id: activation.identity.root_id, branch: git(root, ["branch", "--show-current"]).trim(),
        head: git(root, ["rev-parse", "HEAD"]).trim(), activation: { state: activation.state, authority_id: activation.identity.authority_id, revision: activation.authorization.revision },
        identity: activation.identity, installation: { plan_id: plan.plan_id, applied: true, verified: true, persistence_policy: "verify-only", state_mode: "files" },
        receipt: { path: path.join(root, ".aidn/install/receipt.json"), sha256: hash(fs.readFileSync(path.join(root, ".aidn/install/receipt.json"))), root_id: activation.receipt.root_id }, hooks,
        attempt_marker_present: fs.existsSync(path.join(root, ".codex/aidn-agent-attempt.json")) });
    }
    if (new Set(roots.map((entry) => entry.worktree_id)).size !== 3 || roots.some((entry) => entry.attempt_marker_present)) fail("PREPARATION_WORKTREE_IDENTITY_INVALID");
    const version = run(codexBinary, ["--version"], { cwd: paths.versionHome, env: { ...childEnvironment(), CODEX_HOME: paths.versionHome }, timeout: 15000 }).trim();
    if (!version || hash(fs.readFileSync(codexBinary)) !== preview.codex.sha256) fail("PREPARATION_CODEX_IDENTITY_CHANGED");
    const baseline = { roots: roots.map((entry) => ({ role: entry.role, root: entry.root, files: inventory(entry.root, { omitGit: true }),
      runtime: inventory(path.join(entry.root, ".aidn/runtime")), git_dir: entry.identity.git_dir, git_files: inventory(entry.identity.git_dir),
      status: git(entry.root, ["status", "--porcelain=v1", "--untracked-files=all"]) })),
      common_git_dir: roots[0].identity.common_dir, common_git_files: inventory(roots[0].identity.common_dir) };
    const record = { ok: true, status: "prepared", written: true, preparation_id: preparationId, output_root: outputRoot,
      source: sourceIdentity, candidate, host: { platform: process.platform, architecture: process.arch, release: os.release(), node: process.version },
      codex: { ...preview.codex, version }, codex_home: paths.codexHome, native_profile: nativeProfile,
      codex_home_empty: profileIdentity ? false : fs.readdirSync(paths.codexHome).length === 0,
      roots, engine_lock_sha256: hash(fs.readFileSync(path.join(paths.engine, "package-lock.json"))), baseline_sha256: hash(json(baseline)),
      native_execution: "NOT_RUN", human_trust: "NOT_RECORDED", llm_calls: 0, cleanup: "PRESERVED_FOR_REVIEW" };
    if (!profileIdentity && !record.codex_home_empty) fail("PREPARATION_NATIVE_HOME_NOT_EMPTY");
    if (profileIdentity && fingerprintAgentExecutionValue(nativeQualificationHomeIdentity(paths.codexHome)) !== nativeProfile.home_identity_sha256) fail("PREPARATION_NATIVE_HOME_CHANGED");
    put(outputRoot, "baseline.local.json", json(baseline));
    put(outputRoot, "manifest.local.json", json(record));
    put(outputRoot, "REVIEW.md", reviewSheet(record));
    return { ok: true, status: record.status, written: true, preparation_id: preparationId, output_root: outputRoot,
      manifest: path.join(outputRoot, "manifest.local.json"), review: path.join(outputRoot, "REVIEW.md"), baseline: path.join(outputRoot, "baseline.local.json"),
      candidate: { ...candidate, inventory: undefined }, native_execution: record.native_execution, human_trust: record.human_trust, llm_calls: 0 };
  } catch (error) {
    const failure = { ok: false, status: "failed", written: true, output_root: outputRoot, preparation_id: preparationId,
      reason: error.code ?? error.message, diagnostics: error.diagnostics, cleanup: "PRESERVED_FOR_DIAGNOSIS", native_execution: "NOT_RUN", llm_calls: 0 };
    try { put(outputRoot, "failure.local.json", json(failure)); } catch { /* Preserve original failure and output. */ }
    error.preparation = failure;
    throw error;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const input = process.argv.slice(2), options = {};
    for (let index = 0; index < input.length; index += 1) {
      const key = input[index];
      if (key === "--write") { if (options.write) fail("PREPARATION_DUPLICATE_OPTION"); options.write = true; continue; }
      if (key === "--json") continue;
      const field = { "--output-root": "outputRoot", "--codex-binary": "codexBinary", "--npm-cli": "npmCli", "--native-profile-mode": "nativeProfileMode", "--codex-home": "codexHome" }[key];
      if (!field || options[field] || !input[index + 1] || input[index + 1].startsWith("--")) fail("usage: prepare-agent-native-qualification.mjs --output-root <new absolute directory> --codex-binary <absolute executable> [--npm-cli <absolute npm-cli.js>] [--native-profile-mode preexisting --codex-home <existing absolute home>] [--write] [--json]");
      options[field] = input[++index];
    }
    console.log(json(await prepareAgentNativeQualification(options)).trimEnd());
  } catch (error) {
    console.log(json(error.preparation ?? { ok: false, written: false, reason: error.code ?? error.message, diagnostics: error.diagnostics }).trimEnd());
    process.exitCode = 1;
  }
}
