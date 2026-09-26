import fs from "node:fs";
import crypto from "node:crypto";
import { migrateCustomFileWithCodex } from "../../adapters/codex/codex-migrate-custom.mjs";
import path from "node:path";
import { planCodexAssets, planInstallationAssets, executeInstallationAssets, readInstallationContext, isCodexManagedTarget } from "./codex-assets-service.mjs";
import { readAidnProjectConfig, withInstalledAidnVersion, inspectInstalledAidnVersion } from "../../lib/config/aidn-config-lib.mjs";
import { loadWorkflowManifests, resolvePackOrder } from "./manifest-loader.mjs";
import { resolveCompatibility, validateRuntimeCompatibility } from "./compatibility-policy.mjs";
import { buildNextAidnProjectConfig } from "./project-config-service.mjs";
import { resolveArtifactImportDefaults, runArtifactImport, verifyArtifactImportOutputs } from "./artifact-import-service.mjs";
import { collectExistingPlaceholderValues, resolveInstallSourceBranch, extractPlaceholders, suggestPlaceholderValue } from "./custom-file-policy.mjs";
import { copyRecursive, shouldRenderTemplate } from "./template-copy-service.mjs";
import { mergeAppendUnique } from "./template-merge-service.mjs";
import { normalizeWorkflowAdapterConfig } from "../../lib/config/workflow-adapter-config-lib.mjs";
import { ensureWorkflowAdapterConfig } from "../project/project-config-use-case.mjs";
import { buildGeneratedDocTemplateVars } from "./generated-doc-template-vars.mjs";
import { renderManagedInstallDocs } from "./generated-doc-render-service.mjs";
import { isRetainedInstallSeed } from "./installation-ownership-service.mjs";
import { isDbOnlyStrictVisibleInstallAllowed } from "../runtime/db-only-visible-surface-policy.mjs";
import { migrateWorkflowDbFile } from "../../lib/sqlite/workflow-db-schema-lib.mjs";
import { resolveEffectiveRuntimePersistence } from "../runtime/runtime-persistence-service.mjs";
import { executeRuntimeBackendAdoption, planRuntimeBackendAdoption } from "../runtime/runtime-backend-adoption-service.mjs";
import { globalProjectBinding, renderGlobalCommands } from "./global-project-integration.mjs";

const encoded = (text) => Buffer.from(text).toString("base64");
const json = (value) => `${JSON.stringify(value, null, 2)}\n`;
const ARGUMENTS = ["pack", "initDefaults", "projectName", "sourceBranch", "adapterFile", "adapterData", "skipAgents", "forceAgentsMerge", "skipArtifactImport", "artifactImportStore", "runtimeStateMode", "runtimePersistenceBackend", "runtimePersistenceConnectionRef", "runtimePersistenceLocalProjectionPolicy", "materializeVisibleArtifacts", "verifyAfterInstall", "codexMigrateCustom", "persistencePolicy"];
function safeArgs(args = {}) { return Object.fromEntries(ARGUMENTS.filter((key) => args[key] !== undefined).map((key) => [key, args[key]])); }
function fail(code, target = "") { const error = new Error(code); error.code = code; error.relativePath = target; throw error; }
function persistencePolicy(args = {}) {
  const policy = args.persistencePolicy ?? "adopt";
  if (!["adopt", "verify-only"].includes(policy)) fail("INVALID_INSTALLATION_PERSISTENCE_POLICY");
  return policy;
}
function adoptionOptions(context, targetRoot, options) {
  const persistence = context.next_config.runtime.persistence;
  return { targetRoot, backend: persistence.backend, connectionRef: persistence.connectionRef ?? "", configData: context.next_config,
    ignoreSourceDriftWhenTargetReady: true, ...(options.runtimeBackendAdoptionOptions ?? {}) };
}
async function verifyPersistenceReady(context, targetRoot, options) {
  if (persistencePolicy(context.args) !== "verify-only" || context.next_config.runtime.persistence.backend !== "postgres") return null;
  // Planning reads the configured database but never migrates, transfers or
  // registers anything. A non-noop plan is not successful verification.
  const plan = await planRuntimeBackendAdoption(adoptionOptions(context, targetRoot, options));
  if (plan.blocked !== false || plan.action !== "noop") fail("PERSISTENCE_VERIFY_ONLY_REQUIRES_NOOP");
  return plan;
}
function checkTree(root) {
  if (!fs.existsSync(root)) return;
  const stat = fs.lstatSync(root);
  if (stat.isSymbolicLink()) fail("SYMLINK_INSTALLATION_PATH");
  if (stat.isDirectory()) for (const entry of fs.readdirSync(root)) checkTree(path.join(root, entry));
  else if (!stat.isFile() || stat.nlink > 1) fail("UNSAFE_INSTALLATION_PATH");
}
function failure(error, action = "install") { return { scope: "installation", action, ok: false, dry_run: true, written: false, plan_id: "", operations: [], external_effects: [], write_targets: [], conflicts: [{ code: error.code ?? "INSTALLATION_PLAN_FAILED", path: error.relativePath ?? "" }], errors: [error.message], warnings: [] }; }
function versionInfo(config, version, receipt) {
  const info = inspectInstalledAidnVersion(config, version);
  const receiptVersion = receipt?.installation?.version ?? null;
  return { ...info, receipt_version: receiptVersion, receipt_drift: receiptVersion !== null && receiptVersion !== info.recorded_version };
}

async function prepare(options) {
  const repoRoot = path.resolve(options.repoRoot), targetRoot = path.resolve(options.targetRoot);
  const recordedReceipt = readInstallationContext({ targetRoot }).receipt;
  // Repair enters through the public bootstrap CLI without an explicit home.
  // Keep generated commands on the same verified global binding as Codex assets.
  const globalHome = options.globalHome ?? recordedReceipt?.global_runtime?.home;
  const saved = recordedReceipt?.installation?.args ?? {};
  const args = safeArgs({ ...saved, ...options.args });
  args.persistencePolicy = persistencePolicy({ persistencePolicy: options.args?.persistencePolicy ?? saved.persistencePolicy });
  // Consent applies to this new operation; only a pending journal may retain it for resume.
  args.codexMigrateCustom = options.args?.codexMigrateCustom === true;
  // Import inputs initialize or explicitly update the adapter; its current file is canonical thereafter.
  if (options.args?.adapterData === undefined) delete args.adapterData;
  if (options.args?.adapterFile === undefined) delete args.adapterFile;
  const version = fs.readFileSync(path.join(repoRoot, "VERSION"), "utf8").trim();
  // The existing asset planner validates root ancestry before any project reads.
  const rootCheck = planCodexAssets({ repoRoot, targetRoot, globalHome, action: options.action ?? "install", skipAgents: args.skipAgents });
  if (!rootCheck.ok) return { public: { ...rootCheck, scope: "installation", asset_plan: rootCheck, external_effects: [] } };
  for (const relative of ["docs/audit", ".aidn/project", ".aidn/config.json", ".gitignore", ".github"]) checkTree(path.join(targetRoot, relative));
  const configRead = readAidnProjectConfig(targetRoot);
  const recordedConfig = recordedReceipt?.installation?.assets?.[".aidn/config.json"];
  const currentConfig = configRead.exists ? configRead.data : options.action === "repair" && recordedConfig ? JSON.parse(Buffer.from(recordedConfig.current, "base64").toString("utf8")) : {};
  const adapterPath = path.join(targetRoot, ".aidn/project/workflow.adapter.json");
  const recordedAdapter = recordedReceipt?.installation?.assets?.[".aidn/project/workflow.adapter.json"];
  if (options.action === "repair" && !fs.existsSync(adapterPath) && recordedAdapter && !options.args?.adapterData && !options.args?.adapterFile) args.adapterData = JSON.parse(Buffer.from(recordedAdapter.current, "base64").toString("utf8"));
  if (options.args?.adapterFile) args.adapterData = JSON.parse(fs.readFileSync(path.resolve(options.args.adapterFile), "utf8"));
  const defaults = resolveArtifactImportDefaults(args, currentConfig);
  const strict = defaults.stateMode === "db-only" && !args.materializeVisibleArtifacts;
  const { workflowManifest, compatMatrix } = loadWorkflowManifests(repoRoot);
  const compatibility = resolveCompatibility(workflowManifest, compatMatrix);
  // No CLI/auth or database discovery belongs in a non-mutating plan.
  const { ordered: packs, packCache } = resolvePackOrder(repoRoot, args.pack ? [args.pack] : workflowManifest.packs);
  const source = await resolveInstallSourceBranch({ explicitSourceBranch: args.sourceBranch, configData: currentConfig, targetRoot, dryRun: true, summary: {} });
  args.sourceBranch = source.value;
  const vars = { ...collectExistingPlaceholderValues(targetRoot), VERSION: version, SOURCE_BRANCH: source.value };
  const adapter = args.adapterData ? { data: normalizeWorkflowAdapterConfig(args.adapterData), source: "prepared-wizard", path: path.join(targetRoot, ".aidn/project/workflow.adapter.json") } : await ensureWorkflowAdapterConfig({ targetRoot, dryRun: true, adapterFile: args.adapterFile, initDefaults: args.initDefaults === true, defaults: { projectName: args.projectName || path.basename(targetRoot), preferredStateMode: defaults.stateMode, defaultIndexStore: defaults.store } });
  vars.PROJECT_NAME = adapter.data.projectName;
  Object.assign(vars, buildGeneratedDocTemplateVars({ repoRoot, templateVars: vars, aidnConfigData: currentConfig, workflowAdapterConfig: adapter }));
  const operations = new Map();
  const customCandidates = [];
  const collect = ({ targetRelative, targetPath, content }, kind = null) => {
    const relative = targetRelative ?? path.relative(targetRoot, targetPath).replace(/\\/g, "/");
    if (globalHome && /\.md$/i.test(relative)) content = renderGlobalCommands(String(content));
    operations.set(relative, { path: relative, kind: kind ?? (isRetainedInstallSeed(relative) ? "seed-file" : "local-file"), data: encoded(content) });
  };
  if (args.adapterData || !fs.existsSync(path.join(targetRoot, ".aidn/project/workflow.adapter.json"))) collect({ targetRelative: ".aidn/project/workflow.adapter.json", content: json(adapter.data) }, "config-fields");
  const infer = (sourcePath) => {
    const stat = fs.lstatSync(sourcePath);
    if (stat.isSymbolicLink()) fail("SYMLINK_PACKAGE_ASSET");
    if (stat.isDirectory()) { for (const entry of fs.readdirSync(sourcePath).sort()) infer(path.join(sourcePath, entry)); return; }
    if (shouldRenderTemplate(sourcePath)) for (const placeholder of extractPlaceholders(fs.readFileSync(sourcePath, "utf8"))) if (!Object.hasOwn(vars, placeholder)) vars[placeholder] = suggestPlaceholderValue(placeholder, targetRoot, vars);
  };
  for (const pack of packs) {
    const manifest = packCache.get(pack).manifest;
    const copies = manifest.install?.copy ?? [];
    const explicit = new Set(copies.map((op) => path.resolve(repoRoot, op.from)).filter((file) => fs.existsSync(file) && fs.statSync(file).isFile()));
    for (const op of copies) {
      if (isCodexManagedTarget(op.to)) continue;
      const from = path.resolve(repoRoot, op.from), to = path.resolve(targetRoot, op.to);
      infer(from);
      copyRecursive(from, to, true, fs.statSync(from).isDirectory() ? explicit : null, vars, { targetRoot, preserveCustomizableFiles: true, onPlannedFile: collect, onPreservedCustomFile: (candidate) => { if (candidate.differsFromTemplate) customCandidates.push(candidate); }, ...(strict && !op.to.startsWith(".aidn/") ? { shouldCopyTargetRelative: isDbOnlyStrictVisibleInstallAllowed } : {}) });
    }
    for (const op of manifest.install?.merge ?? []) {
      if (isCodexManagedTarget(op.to)) continue;
      if (op.strategy !== "append_unique") fail("UNSUPPORTED_INSTALLATION_MERGE", op.to);
      mergeAppendUnique(path.resolve(repoRoot, op.from), path.resolve(targetRoot, op.to), true, vars, (item) => collect(item, "append-lines"));
    }
  }
  renderManagedInstallDocs({ repoRoot, targetRoot, dryRun: true, templateVars: vars, workflowAdapterConfig: adapter, onPlannedFile: collect });
  const priorVersion = readInstallationContext({ targetRoot }).receipt?.package?.version ?? currentConfig.install?.aidnVersion;
  // Approved unchanged template at product commit 56414bb4091bb0c0ab7d351078a0177bfbb531f8.
  const knownWorkflowTemplate = crypto.createHash("sha256").update(fs.readFileSync(path.join(repoRoot, "scaffold/docs_audit/PROJECT_WORKFLOW.md"), "utf8").replace(/\r\n/g, "\n")).digest("hex") === "dc87b3844f0461a1b0fc58f911e43ea1b64221d6a0e77b532eb160e4e9393174";
  if (priorVersion === "0.7.2" && priorVersion !== version && knownWorkflowTemplate) {
    // Recognition is a complete historical rendering match, never a marker or
    // substring claim. Client extensions are retained by the existing renderer.
    renderManagedInstallDocs({ repoRoot, targetRoot, dryRun: true, templateVars: { ...vars, VERSION: priorVersion }, workflowAdapterConfig: adapter,
      existingContentByTarget: Object.fromEntries(["workflow.md", "workflow_summary.md", "codex_online.md", "index.md"].map((name) => ["docs/audit/" + name, ""])),
      onPlannedFile: ({ targetRelative, content }) => { const item = operations.get(targetRelative); if (item && targetRelative === "docs/audit/WORKFLOW.md") item.legacy_data = [encoded(content)]; } });
  }
  const nextConfig = buildNextAidnProjectConfig(currentConfig, defaults, args);
  const finalConfig = withInstalledAidnVersion(nextConfig, version);
  const importPersistence = resolveEffectiveRuntimePersistence({ targetRoot, backend: args.runtimePersistenceBackend, connectionRef: args.runtimePersistenceConnectionRef, configData: nextConfig });
  operations.set(".aidn/config.json", { path: ".aidn/config.json", kind: "config-fields", data: encoded(json(finalConfig)), staged: encoded(json(nextConfig)), finalize: true });
  const required = [...new Set(packs.flatMap((pack) => packCache.get(pack).manifest.verify?.must_exist ?? []))].filter((relative) => !strict || relative.startsWith(".aidn/") || isDbOnlyStrictVisibleInstallAllowed(relative));
  const verifyOnlyPersistence = args.persistencePolicy === "verify-only";
  const effects = [{ id: "artifact-import", state: args.skipArtifactImport || verifyOnlyPersistence ? "skipped" : "deferred", reversible: false, store: defaults.store, state_mode: defaults.stateMode, destination_backend: importPersistence.backend,
    ...(verifyOnlyPersistence ? { reason: "persistence-policy-verify-only" } : {}) }];
  if (strict && defaults.store === "sqlite" && nextConfig.runtime.persistence.backend !== "postgres") effects.push({ id: "sqlite-schema", state: verifyOnlyPersistence ? "skipped" : "deferred", reversible: false });
  if (nextConfig.runtime.persistence.backend === "postgres") effects.push({ id: "persistence-adoption", state: "deferred", reversible: false, readiness: "unknown", policy: args.persistencePolicy });
  if (args.codexMigrateCustom) effects.push({ id: "custom-file-llm-migration", state: "deferred", optional: true, reversible: false, paths: customCandidates.map((candidate) => candidate.targetRelative) });
  const context = { args, version_before: currentConfig.install?.aidnVersion ?? null, version_after: version, current_config: currentConfig, next_config: nextConfig, verify_entries: required, external_effects: effects, compatibility, packs, strict, defaults, import_persistence: importPersistence, custom_candidates: customCandidates };
  const installation = { operations: [...operations.values()], context };
  const assetPlan = planCodexAssets({ repoRoot, targetRoot, globalHome, action: options.action ?? "install", templateVars: vars, skipAgents: args.skipAgents, forceAgentsMerge: args.forceAgentsMerge });
  const journal = planInstallationAssets({ ...options, repoRoot, targetRoot, globalHome, templateVars: vars, installation });
  const receipt = readInstallationContext({ targetRoot }).receipt;
  return { repoRoot, targetRoot, globalHome, args, vars, installation, public: { ...journal, asset_plan: assetPlan, version_info: versionInfo(currentConfig, version, receipt) } };
}

export async function planInstallation(options) {
  try {
    if (options.action === "resume" && options.args?.persistencePolicy !== undefined) {
      const pending = readInstallationContext(options);
      if (pending.context && persistencePolicy(options.args) !== persistencePolicy(pending.context.args)) fail("PERSISTENCE_POLICY_FROZEN_BY_TRANSACTION");
    }
    if (["resume", "rollback", "uninstall"].includes(options.action)) return planInstallationAssets(options);
    return (await prepare(options)).public;
  } catch (error) { return failure(error, options.action); }
}

// Setup candidate qualification: same planner and persistence admission as
// bootstrap, but no package, receipt, asset or database writes.
export async function verifyInstallationCandidate(options) {
  const prepared = await prepare({ ...options, args: { ...options.args, persistencePolicy: 'verify-only' } });
  if (!prepared.public.ok) return prepared.public;
  await verifyPersistenceReady(prepared.installation.context, prepared.targetRoot, options);
  if (prepared.installation.context.next_config.runtime.persistence.backend !== 'postgres'
      && ['sqlite', 'dual-sqlite', 'all'].includes(prepared.installation.context.defaults.store)) {
    const { inspectWorkflowDbSchema, getLatestWorkflowSchemaVersion } = await import('../../lib/sqlite/workflow-db-schema-lib.mjs');
    const status = inspectWorkflowDbSchema({ sqliteFile: path.join(prepared.targetRoot, '.aidn/runtime/index/workflow-index.sqlite'), readOnly: true });
    if (!status.exists || status.pending_ids.length || Number(status.schema_version) !== getLatestWorkflowSchemaVersion()) fail('PERSISTENCE_MIGRATION_REQUIRED');
  }
  return prepared.public;
}
export async function diagnoseInstallation(options) {
  const interrupted = readInstallationContext(options).scope === "installation";
  const plan = await planInstallation({ ...options, action: interrupted ? "resume" : "install" });
  const config = readAidnProjectConfig(options.targetRoot).data ?? {};
  const version = fs.readFileSync(path.join(options.repoRoot, "VERSION"), "utf8").trim();
  const receipt = readInstallationContext(options).receipt;
  return { ...plan, action: "diagnose", ...(interrupted ? { state: "interrupted" } : {}), version_info: versionInfo(config, version, receipt) };
}

async function finishExternal({ transaction, targetRoot, checkpoint }, repoRoot, options, messages) {
  const context = transaction.installation_context;
  const { args, current_config: currentConfig, next_config: nextConfig, defaults, strict } = context;
  const verifyOnlyPersistence = persistencePolicy(args) === "verify-only";
  // Recheck even after an earlier completed verification checkpoint. The
  // database may have changed since preflight or an interrupted installation.
  await verifyPersistenceReady(context, targetRoot, options);
  validateRuntimeCompatibility(context.compatibility, { requireCodex: args.codexMigrateCustom === true });
  if (options.failExternal) fail("INJECTED_INSTALLATION_EXTERNAL_FAILURE");
  if (args.codexMigrateCustom) for (const candidate of context.custom_candidates ?? []) {
    transaction.external_records ??= [];
    let record = transaction.external_records.find((item) => item.path === candidate.targetRelative);
    if (record?.status === "complete") continue;
    if (record) fail("LLM_MIGRATION_REQUIRES_INSPECTION", candidate.targetRelative);
    const file = path.join(targetRoot, candidate.targetRelative);
    record = { path: candidate.targetRelative, kind: "explicit-llm-migration", before: encoded(fs.readFileSync(file)), after: null, status: "pending", reversible: false };
    transaction.external_records.push(record); checkpoint();
    const migrated = migrateCustomFileWithCodex(targetRoot, candidate, false);
    record.after = encoded(fs.readFileSync(file)); record.status = migrated.migrated ? "complete" : "failed"; checkpoint();
    if (migrated.attempted && !migrated.migrated) fail("EXPLICIT_LLM_MIGRATION_FAILED", candidate.targetRelative);
  }
  const effectResults = transaction.external_effect_results ??= {};
  async function effect(id, sourceKind, run, { repeatUncertain = true } = {}) {
    const previous = effectResults[id];
    if (["completed", "skipped"].includes(previous?.status)) return { checkpointed: true, skipped: previous.status === "skipped", reason: previous.reason };
    if (previous && !repeatUncertain) fail("ARTIFACT_IMPORT_REQUIRES_INSPECTION");
    const record = effectResults[id] = { id, source_kind: sourceKind, status: "pending", reversible: false };
    checkpoint();
    let result;
    try { result = await run(); }
    catch (error) { record.status = "failed"; checkpoint(); throw error; }
    record.status = result?.skipped ? "skipped" : result?.ok === false ? "failed" : "completed";
    if (result?.skipped) record.reason = result.reason;
    checkpoint();
    return result ?? { ok: true };
  }
  const importPersistence = context.import_persistence ?? { backend: nextConfig.runtime.persistence.backend, connectionRef: nextConfig.runtime.persistence.connectionRef ?? null };
  if (verifyOnlyPersistence) messages.push("artifact import skipped: persistence policy verify-only");
  else if (args.skipArtifactImport) messages.push("artifact import skipped: explicit --skip-artifact-import");
  else {
    const imported = await effect("artifact-import", importPersistence.backend === "postgres" ? "postgres" : "local", () => runArtifactImport(repoRoot, targetRoot, false, args, nextConfig, defaults, importPersistence), { repeatUncertain: importPersistence.backend !== "postgres" });
    if (imported.checkpointed) messages.push("artifact import: retained completed checkpoint");
    else if (imported.skipped) messages.push(`artifact import skipped: ${imported.reason}`);
    else if (!imported.ok) fail("ARTIFACT_IMPORT_FAILED");
    else messages.push(`artifact import: OK (store=${defaults.store}, state_mode=${defaults.stateMode}, source=${defaults.source})`);
  }
  if (options.failAfterArtifactImport) fail("INJECTED_INSTALLATION_AFTER_ARTIFACT_IMPORT");
  const persistence = nextConfig.runtime.persistence;
  if (!verifyOnlyPersistence && strict && defaults.store === "sqlite" && persistence.backend !== "postgres") {
    const sqliteFile = path.join(targetRoot, ".aidn/runtime/index/workflow-index.sqlite");
    await effect("sqlite-schema", "local", () => { fs.mkdirSync(path.dirname(sqliteFile), { recursive: true }); migrateWorkflowDbFile({ sqliteFile }); });
  }
  if (persistence.backend === "postgres") {
    if (verifyOnlyPersistence) {
      effectResults["persistence-adoption"] = { id: "persistence-adoption", source_kind: "postgres", status: "completed", policy: "verify-only", action: "noop", read_only: true, reversible: false };
      checkpoint();
      messages.push("persistence verified: no adoption required; database writes disabled");
    } else {
      const result = await effect("persistence-adoption", "postgres", () => executeRuntimeBackendAdoption({ write: true, ...adoptionOptions(context, targetRoot, options) }));
      if (!result.ok && !result.checkpointed) fail("RUNTIME_PERSISTENCE_ADOPTION_BLOCKED");
    }
  }
  // Local manifest verification and import verification are part of completion,
  // before installation metadata claims the package version.
  const globalHome = options.globalHome ?? transaction.receipt_after?.global_runtime?.home;
  if (globalHome) globalProjectBinding(globalHome, repoRoot);
  for (const relative of context.verify_entries) {
    if (globalHome && (relative.startsWith(".agents/skills/") || relative.startsWith(".codex/agents/") || relative === ".codex/hooks/aidn-hook-runtime.mjs")) continue;
    if (!fs.existsSync(path.join(targetRoot, relative))) fail("INSTALLATION_VERIFY_MISSING", relative);
  }
  const verified = verifyArtifactImportOutputs(targetRoot, verifyOnlyPersistence ? { ...args, skipArtifactImport: true } : args, nextConfig, defaults);
  if (verified.checked && !verified.ok) fail("INSTALLATION_IMPORT_VERIFY_FAILED");
  messages.push("verified: OK");
}
export async function executeInstallation(options) {
  const action = options.action ?? "install";
  if (options.dryRun !== false) return planInstallation(options);
  try {
    let prepared;
    if (["resume", "rollback", "uninstall"].includes(action)) prepared = { repoRoot: path.resolve(options.repoRoot), targetRoot: path.resolve(options.targetRoot) };
    else {
      prepared = await prepare(options);
      if (!prepared.public.ok) return prepared.public;
    }
    const initialPlan = prepared.public ?? await planInstallation(options);
    if (!initialPlan.ok) return { ...initialPlan, dry_run: false };
    if (options.expectedPlanId && options.expectedPlanId !== initialPlan.plan_id) fail("STALE_INSTALL_PLAN");
    if (action === "resume") {
      const pending = readInstallationContext({ targetRoot: prepared.targetRoot });
      if (pending.context && !["rollback", "uninstall"].includes(pending.action)) await verifyPersistenceReady(pending.context, prepared.targetRoot, options);
    } else if (!["rollback", "uninstall"].includes(action)) {
      await verifyPersistenceReady(prepared.installation.context, prepared.targetRoot, options);
    }
    const messages = [];
    const result = await executeInstallationAssets({ ...options, ...prepared, scope: "installation", templateVars: prepared.vars, expectedPlanId: options.expectedPlanId || initialPlan.plan_id }, (event) => finishExternal(event, prepared.repoRoot, options, messages));
    return { ...result, messages, ...(prepared.public?.asset_plan ? { asset_plan: prepared.public.asset_plan } : {}) };
  } catch (error) { return { ...failure(error, action), dry_run: false }; }
}
