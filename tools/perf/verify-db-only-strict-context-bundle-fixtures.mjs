#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { buildNextAidnProjectConfig } from "../../src/application/install/project-config-service.mjs";
import {
  runArtifactImport,
  verifyArtifactImportOutputs,
} from "../../src/application/install/artifact-import-service.mjs";
import { buildArtifactSourceDescriptor } from "../../src/application/codex/hydrate-context-use-case.mjs";
import { movePath } from "../../src/application/runtime/visible-artifacts-cleanup-service.mjs";
import { removePathWithRetry } from "./test-git-fixture-lib.mjs";

function printUsage() {
  console.log("Usage:");
  console.log("  node tools/perf/verify-db-only-strict-context-bundle-fixtures.mjs");
}

function runText(script, scriptArgs, options = {}) {
  const file = path.resolve(process.cwd(), script);
  return execFileSync(process.execPath, [file, ...scriptArgs], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      ...(options.env ?? {}),
    },
  });
}

function runJson(script, scriptArgs, options = {}) {
  return JSON.parse(runText(script, scriptArgs, options));
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function assertNotExists(filePath, message) {
  assert(!fs.existsSync(filePath), message);
}

function verifyStrictInstall(tempRoot) {
  const target = path.join(tempRoot, "strict-install");
  fs.mkdirSync(target, { recursive: true });
  const env = { AIDN_STATE_MODE: "db-only" };
  runText("tools/install.mjs", [
    "--target",
    target,
    "--pack",
    "core",
    "--init-defaults",
    "--project-name",
    "strict-install",
    "--skip-artifact-import",
    "--no-codex-migrate-custom",
  ], { env });
  assert(fs.existsSync(path.join(target, ".aidn", "config.json")), "strict install should create hidden .aidn/config.json");
  const config = JSON.parse(fs.readFileSync(path.join(target, ".aidn", "config.json"), "utf8"));
  assert(config.runtime?.stateMode === "db-only", "strict install config should declare runtime.stateMode=db-only");
  assert(config.runtime?.dbOnly?.strict === true, "strict install config should declare runtime.dbOnly.strict=true");
  assert(config.runtime?.dbOnly?.visibleArtifacts?.automaticMaterialization === false, "strict install config should disable automatic visible materialization");
  assert(Array.isArray(config.runtime?.dbOnly?.visibleArtifacts?.managedRuntimePaths), "strict install config should list managed runtime materializations");
  assert(!config.runtime.dbOnly.visibleArtifacts.managedRuntimePaths.includes("docs/audit/CURRENT-STATE.md"), "strict install config should not classify CURRENT-STATE as cleanup materialization");
  assert(config.runtime.dbOnly.visibleArtifacts.protectedReanchorPaths.includes("docs/audit/CURRENT-STATE.md"), "strict install config should protect CURRENT-STATE as a reanchor path");
  assert(config.runtime.dbOnly.visibleArtifacts.protectedReanchorPaths.includes("docs/audit/RUNTIME-STATE.md"), "strict install config should protect RUNTIME-STATE as a reanchor path");
  assert(config.runtime.dbOnly.visibleArtifacts.protectedReanchorPaths.includes("docs/audit/HANDOFF-PACKET.md"), "strict install config should protect HANDOFF-PACKET as a reanchor path");
  assert(config.runtime.dbOnly.visibleArtifacts.protectedWorkflowPaths.includes(".codex"), "strict install config should protect local Codex skills");
  assert(config.runtime?.dbOnly?.cleanup?.backupRequired === true, "strict install config should require external backup before cleanup");
  assert(config.runtime?.dbOnly?.cleanup?.quarantine === "external", "strict install config should declare external quarantine");
  assert(config.runtime?.dbOnly?.codexBundle?.sourceOfTruth === "runtime-backend", "strict install config should make runtime backend the bundle source of truth");
  assert(config.runtime?.dbOnly?.artifactImport?.role === "compatibility-or-migration", "strict install config should classify artifact import as compatibility/migration");
  assert(config.runtime?.dbOnly?.artifactImport?.canonicalBackend === "sqlite", "strict install config should record the canonical backend");
  assert(config.runtime?.dbOnly?.artifactImport?.canonicalBackendField === "runtime.persistence.backend", "strict install config should point artifact import to the backend field");
  assert(config.runtime?.dbOnly?.artifactImport?.canonicalBackendWins === true, "strict install config should make the runtime backend canonical");
  assert(fs.existsSync(path.join(target, ".aidn", "project", "workflow.adapter.json")), "strict install should create hidden workflow adapter config");
  assert(fs.existsSync(path.join(target, ".aidn", "runtime", "index", "workflow-index.sqlite")), "strict install should prepare hidden sqlite runtime store");
  assert(fs.existsSync(path.join(target, ".aidn", "runtime", "agents", "example-external-auditor.mjs")), "strict install should copy hidden runtime agent scaffold");
  assert(fs.existsSync(path.join(target, "AGENTS.md")), "strict install should write visible AGENTS workflow bootstrap");
  assert(fs.existsSync(path.join(target, ".codex", "skills.yaml")), "strict install should write visible Codex skill bootstrap");
  assert(fs.existsSync(path.join(target, "docs", "audit", "SPEC.md")), "strict install should write visible SPEC bootstrap");
  assert(fs.existsSync(path.join(target, "docs", "audit", "WORKFLOW.md")), "strict install should write visible WORKFLOW bootstrap");
  assert(fs.existsSync(path.join(target, "docs", "audit", "WORKFLOW-KERNEL.md")), "strict install should write visible workflow kernel");
  assert(fs.existsSync(path.join(target, "docs", "audit", "CURRENT-STATE.md")), "strict install should write minimal CURRENT-STATE reanchor");
  assert(fs.existsSync(path.join(target, "docs", "audit", "RUNTIME-STATE.md")), "strict install should write minimal RUNTIME-STATE reanchor");
  assert(fs.existsSync(path.join(target, "docs", "audit", "HANDOFF-PACKET.md")), "strict install should write minimal HANDOFF-PACKET reanchor");
  assert(fs.existsSync(path.join(target, "docs", "audit", "snapshots", "context-snapshot.md")), "strict install should write minimal snapshot reanchor");
  assert(fs.existsSync(path.join(target, "docs", "audit", "baseline", "current.md")), "strict install should write minimal baseline reanchor");
  assertNotExists(path.join(target, "docs", "audit", "COORDINATION-SUMMARY.md"), "strict install should not write coordination summary projection");
  assertNotExists(path.join(target, "docs", "audit", "AGENT-HEALTH-SUMMARY.md"), "strict install should not write agent health projection");

  runText("tools/install.mjs", [
    "--target",
    target,
    "--pack",
    "core",
    "--verify",
    "--no-codex-migrate-custom",
  ], { env });
}

function verifyStrictPostgresConfigBuilder() {
  const config = buildNextAidnProjectConfig(
    {
      install: {
        artifactImportStore: "sqlite",
      },
      runtime: {
        stateMode: "db-only",
      },
    },
    {
      store: "sqlite",
      stateMode: "db-only",
    },
    {
      runtimePersistenceBackend: "postgres",
      runtimePersistenceConnectionRef: "env:AIDN_PG_URL",
      runtimePersistenceLocalProjectionPolicy: "none",
    },
  );
  assert(config.install?.artifactImportStore === "sqlite", "legacy artifactImportStore should remain a local index value");
  assert(config.runtime?.persistence?.backend === "postgres", "strict postgres config should select postgres as runtime backend");
  assert(config.runtime?.persistence?.localProjectionPolicy === "none", "strict postgres config should disable local projection by default");
  assert(config.runtime?.dbOnly?.artifactImport?.canonicalBackend === "postgres", "strict postgres config should mark postgres as canonical backend");
  assert(config.runtime?.dbOnly?.artifactImport?.legacyStoreField === "install.artifactImportStore", "strict postgres config should identify the legacy import store field");
  assert(config.runtime?.dbOnly?.artifactImport?.canonicalBackendWins === true, "strict postgres config should make runtime.persistence.backend win");
}

function verifyStrictPostgresInstallSkipsHiddenSqlite(tempRoot) {
  const target = path.join(tempRoot, "strict-postgres-install");
  fs.mkdirSync(path.join(target, ".aidn"), { recursive: true });
  fs.writeFileSync(path.join(target, ".aidn", "config.json"), JSON.stringify({
    version: 1,
    install: {
      artifactImportStore: "sqlite",
    },
    runtime: {
      stateMode: "db-only",
      persistence: {
        backend: "postgres",
        connectionRef: "env:AIDN_PG_URL",
        localProjectionPolicy: "none",
      },
    },
  }, null, 2), "utf8");
  const out = runText("tools/install.mjs", [
    "--target",
    target,
    "--pack",
    "core",
    "--dry-run",
    "--skip-artifact-import",
    "--no-codex-migrate-custom",
    "--init-defaults",
    "--project-name",
    "strict-postgres-install",
  ]);
  assert(out.includes("skip hidden sqlite runtime store in db-only strict: runtime.persistence.backend=postgres"), "strict postgres install should skip hidden sqlite preparation");
  assert(out.includes("hidden_runtime_store_prepared: 0"), "strict postgres install should not prepare hidden sqlite");
  assert(!out.includes("prepare hidden sqlite runtime store:"), "strict postgres install should not log sqlite preparation");
  assertNotExists(path.join(target, ".aidn", "runtime", "index", "workflow-index.sqlite"), "strict postgres dry-run should not create hidden sqlite");
}

function verifyStrictPostgresSkipsImplicitArtifactImport(tempRoot) {
  const repoRoot = process.cwd();
  const target = path.join(tempRoot, "strict-postgres-import-skip");
  fs.mkdirSync(path.join(target, "docs", "audit"), { recursive: true });
  fs.writeFileSync(path.join(target, "docs", "audit", "SPEC.md"), "# Spec\n", "utf8");
  const configData = {
    install: {
      artifactImportStore: "sqlite",
    },
    runtime: {
      stateMode: "db-only",
      persistence: {
        backend: "postgres",
      },
      dbOnly: {
        strict: true,
      },
    },
  };
  const imported = runArtifactImport(repoRoot, target, false, {}, configData);
  assert(imported.skipped === true, "strict postgres implicit artifact import should skip");
  assert(String(imported.reason).includes("canonical postgres db-only strict"), "strict postgres import skip should explain canonical backend");
  const verified = verifyArtifactImportOutputs(target, {}, configData);
  assert(verified.checked === false, "strict postgres artifact import verify should not require sqlite");
  assert(String(verified.reason).includes("compatibility/migration"), "strict postgres artifact verify skip should explain compatibility role");
}

function verifyHydrateBundle(tempRoot) {
  const sourceTarget = path.resolve(process.cwd(), "tests/fixtures/repo-installed-core");
  const target = path.join(tempRoot, "hydrate-target");
  fs.cpSync(sourceTarget, target, { recursive: true });
  const visibleOutputs = [
    "RUNTIME-STATE.md",
    "HANDOFF-PACKET.md",
    "AGENT-HEALTH-SUMMARY.md",
    "AGENT-SELECTION-SUMMARY.md",
    "MULTI-AGENT-STATUS.md",
  ].map((name) => path.join(target, "docs", "audit", name));
  for (const filePath of visibleOutputs) {
    fs.rmSync(filePath, { force: true });
  }

  const hiddenOnly = runJson("tools/codex/hydrate-context.mjs", [
    "--target",
    target,
    "--skill",
    "context-reload",
    "--json",
  ], {
    env: { AIDN_STATE_MODE: "db-only" },
  });
  assert(hiddenOnly.state_mode === "db-only", "hydrate should honor db-only state mode");
  assert(hiddenOnly.visible_projection_policy?.materialize_visible_artifacts === false, "hydrate should default to hidden-only projection policy");
  assert(hiddenOnly.bundle_budget?.hard_limit_bytes === 1048576, "hydrate bundle should expose hard limit");
  assert(Number(hiddenOnly.bundle_budget?.selected_count ?? 0) === hiddenOnly.artifacts.length, "bundle selected_count should match artifacts length");
  assert(hiddenOnly.artifacts.every((artifact) => ["active", "continuity", "history"].includes(String(artifact.selection_tier))), "every artifact should expose a selection tier");
  assert(!("runtime_state" in hiddenOnly), "db-only hidden hydrate should not auto-project runtime state");
  assert(!("handoff_packet" in hiddenOnly), "db-only hidden hydrate should not auto-project handoff packet");
  assert(!("agent_health_summary" in hiddenOnly), "db-only hidden hydrate should not auto-project agent health summary");
  for (const filePath of visibleOutputs) {
    assertNotExists(filePath, `db-only hidden hydrate should not recreate ${path.basename(filePath)}`);
  }

  const materialized = runJson("tools/codex/hydrate-context.mjs", [
    "--target",
    target,
    "--skill",
    "context-reload",
    "--materialize-visible-artifacts",
    "--project-runtime-state",
    "--project-handoff-packet",
    "--project-agent-health-summary",
    "--project-agent-selection-summary",
    "--project-multi-agent-status",
    "--json",
  ], {
    env: { AIDN_STATE_MODE: "db-only" },
  });
  assert(materialized.visible_projection_policy?.materialize_visible_artifacts === true, "explicit materialization flag should be exposed");
  assert(fs.existsSync(String(materialized.runtime_state?.output_file ?? "")), "explicit materialization should write runtime state");
  assert(fs.existsSync(String(materialized.handoff_packet?.output_file ?? "")), "explicit materialization should write handoff packet");

  const fetched = runJson("tools/runtime/artifact-fetch.mjs", [
    "--target",
    target,
    "--backend",
    "sqlite",
    "--path",
    "CURRENT-STATE.md",
    "--metadata-only",
    "--json",
  ]);
  assert(fetched.found === true, "artifact-fetch should find CURRENT-STATE.md in sqlite fixture");
  assert(fetched.artifact?.path === "CURRENT-STATE.md", "artifact-fetch should return the selected artifact path");
}

function verifyArtifactSourceDescriptor() {
  const postgresDescriptor = buildArtifactSourceDescriptor({
    backend: "postgres",
    indexAbsolute: "G:/project/.aidn/runtime/index/workflow-index.sqlite",
    connectionRef: "env:AIDN_PG_URL",
    payload: {
      project_context: {
        runtime_scope_id: "runtime:project=example:workspace=main:profile=default",
        project_id: "example",
        workspace_id: "main",
      },
    },
  });
  assert(postgresDescriptor.backend === "postgres", "postgres descriptor should expose postgres backend");
  assert(postgresDescriptor.canonical_backend === "postgres", "postgres descriptor should expose canonical backend");
  assert(!Object.prototype.hasOwnProperty.call(postgresDescriptor, "file"), "postgres descriptor must not expose a sqlite file as artifact_source.file");
  assert(String(postgresDescriptor.compat_local_index_file ?? "").endsWith("workflow-index.sqlite"), "postgres descriptor should keep sqlite path only as compatibility metadata");
  assert(String(postgresDescriptor.agent_read_guidance ?? "").includes("--backend postgres"), "postgres descriptor should guide agents to postgres artifact-fetch");

  const sqliteDescriptor = buildArtifactSourceDescriptor({
    backend: "sqlite",
    indexAbsolute: "G:/project/.aidn/runtime/index/workflow-index.sqlite",
    payload: {},
  });
  assert(String(sqliteDescriptor.file ?? "").endsWith("workflow-index.sqlite"), "sqlite descriptor should keep file as active local index source");
  assert(sqliteDescriptor.compat_local_index_file === undefined, "sqlite descriptor should not classify its active source as compatibility metadata");
}

function verifyCleanupRestore(tempRoot) {
  const target = path.join(tempRoot, "cleanup-target");
  fs.mkdirSync(path.join(target, "docs", "audit"), { recursive: true });
  fs.mkdirSync(path.join(target, "docs", "audit", "sessions"), { recursive: true });
  fs.mkdirSync(path.join(target, "docs", "audit", "cycles", "C777-active"), { recursive: true });
  fs.mkdirSync(path.join(target, ".codex"), { recursive: true });
  fs.writeFileSync(path.join(target, "docs", "audit", "CURRENT-STATE.md"), [
    "# State",
    "",
    "active_session: S777",
    "active_cycle: C777-active",
    "",
  ].join("\n"), "utf8");
  fs.writeFileSync(path.join(target, "docs", "audit", "RUNTIME-STATE.md"), "# Runtime\n", "utf8");
  fs.writeFileSync(path.join(target, "docs", "audit", "HANDOFF-PACKET.md"), "# Handoff\n", "utf8");
  fs.writeFileSync(path.join(target, "docs", "audit", "COORDINATION-SUMMARY.md"), "# Coordination\n", "utf8");
  fs.writeFileSync(path.join(target, "docs", "audit", "sessions", "S777.md"), "# Active session\n", "utf8");
  fs.writeFileSync(path.join(target, "docs", "audit", "cycles", "C777-active", "status.md"), "# Active cycle\n", "utf8");
  fs.writeFileSync(path.join(target, "docs", "audit", "SPEC.md"), "# Spec\n", "utf8");
  fs.writeFileSync(path.join(target, ".codex", "skills.yaml"), "skills: []\n", "utf8");
  fs.writeFileSync(path.join(target, "AGENTS.md"), "# Protected\n", "utf8");

  const preview = runJson("tools/runtime/visible-artifacts-cleanup.mjs", [
    "--target",
    target,
    "--json",
  ]);
  assert(preview.write_requested === false, "cleanup default should be preview");
  assert(preview.candidates.length === 1, "cleanup preview should list only non-anchor runtime materializations");
  assert(preview.candidates[0]?.relative === "docs/audit/COORDINATION-SUMMARY.md", "cleanup preview should target coordination summary");
  assert(preview.protected_files.includes("docs/audit/CURRENT-STATE.md"), "cleanup preview should protect CURRENT-STATE");
  assert(preview.protected_files.includes("docs/audit/RUNTIME-STATE.md"), "cleanup preview should protect RUNTIME-STATE");
  assert(preview.protected_files.includes("docs/audit/HANDOFF-PACKET.md"), "cleanup preview should protect HANDOFF-PACKET");
  assert(preview.protected_files.includes("docs/audit/sessions/S777.md"), "cleanup preview should protect active session");
  assert(preview.protected_files.includes("docs/audit/cycles/C777-active"), "cleanup preview should protect active cycle");
  assert(preview.protected_files.includes("AGENTS.md"), "cleanup preview should mark AGENTS.md protected");
  assert(preview.protected_files.includes(".codex"), "cleanup preview should mark .codex skills protected");
  assert(preview.protected_files.includes("docs/audit/SPEC.md"), "cleanup preview should mark SPEC protected");
  assert(preview.backup_outside_project === true, "cleanup backup should default outside project");
  assert(fs.existsSync(path.join(target, "docs", "audit", "CURRENT-STATE.md")), "cleanup preview should not mutate docs/audit");

  const applied = runJson("tools/runtime/visible-artifacts-cleanup.mjs", [
    "--target",
    target,
    "--write",
    "--json",
  ]);
  assert(applied.status === "applied", "cleanup write should apply");
  assert(applied.backup_created === true, "cleanup write should create backup");
  assert(fs.existsSync(path.join(target, "docs", "audit", "CURRENT-STATE.md")), "cleanup write should keep CURRENT-STATE reanchor");
  assert(fs.existsSync(path.join(target, "docs", "audit", "RUNTIME-STATE.md")), "cleanup write should keep RUNTIME-STATE reanchor");
  assert(fs.existsSync(path.join(target, "docs", "audit", "HANDOFF-PACKET.md")), "cleanup write should keep HANDOFF-PACKET reanchor");
  assert(fs.existsSync(path.join(target, "docs", "audit", "sessions", "S777.md")), "cleanup write should keep active session");
  assert(fs.existsSync(path.join(target, "docs", "audit", "cycles", "C777-active", "status.md")), "cleanup write should keep active cycle status");
  assert(!fs.existsSync(path.join(target, "docs", "audit", "COORDINATION-SUMMARY.md")), "cleanup write should quarantine non-anchor runtime projection");
  assert(fs.existsSync(path.join(target, "docs", "audit", "SPEC.md")), "cleanup write should keep workflow SPEC");
  assert(fs.existsSync(path.join(target, ".codex")), "cleanup write should keep .codex skills");
  assert(fs.existsSync(path.join(target, "AGENTS.md")), "cleanup write should keep AGENTS.md");
  assert(fs.existsSync(path.join(applied.quarantine_root, "docs", "audit", "COORDINATION-SUMMARY.md")), "cleanup should move non-anchor projection to quarantine");

  const restorePreview = runJson("tools/runtime/visible-artifacts-restore.mjs", [
    "--target",
    target,
    "--from",
    applied.backup_root,
    "--json",
  ]);
  assert(restorePreview.write_requested === false, "restore default should be preview");
  assert(restorePreview.restore_items.length === 1, "restore preview should list quarantined runtime materializations");

  const restored = runJson("tools/runtime/visible-artifacts-restore.mjs", [
    "--target",
    target,
    "--from",
    applied.backup_root,
    "--write",
    "--json",
  ]);
  assert(restored.status === "applied", "restore write should apply");
  assert(fs.existsSync(path.join(target, "docs", "audit", "COORDINATION-SUMMARY.md")), "restore should restore runtime materialization content");
  assert(fs.existsSync(path.join(target, ".codex", "skills.yaml")), "restore should have left protected .codex content in place");
}

function verifyCleanupMoveFallback(tempRoot) {
  const source = path.join(tempRoot, "move-fallback-source");
  const destination = path.join(tempRoot, "move-fallback-destination");
  fs.mkdirSync(source, { recursive: true });
  fs.writeFileSync(path.join(source, "locked.txt"), "content\n", "utf8");
  const error = new Error("simulated Windows rename failure");
  error.code = "EPERM";
  movePath(source, destination, {
    renameSync: () => {
      throw error;
    },
  });
  assert(!fs.existsSync(source), "move fallback should remove source after copy");
  assert(fs.existsSync(path.join(destination, "locked.txt")), "move fallback should copy destination content");
}

function main() {
  let tempRoot = "";
  try {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aidn-db-only-strict-"));
    verifyStrictPostgresConfigBuilder();
    verifyStrictPostgresInstallSkipsHiddenSqlite(tempRoot);
    verifyStrictPostgresSkipsImplicitArtifactImport(tempRoot);
    verifyStrictInstall(tempRoot);
    verifyArtifactSourceDescriptor();
    verifyHydrateBundle(tempRoot);
    verifyCleanupRestore(tempRoot);
    verifyCleanupMoveFallback(tempRoot);
    console.log("PASS");
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    printUsage();
    process.exit(1);
  } finally {
    if (tempRoot && fs.existsSync(tempRoot)) {
      removePathWithRetry(tempRoot);
    }
  }
}

main();
