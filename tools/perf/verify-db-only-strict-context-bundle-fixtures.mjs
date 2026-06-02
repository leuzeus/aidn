#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
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
  assert(fs.existsSync(path.join(target, ".aidn", "project", "workflow.adapter.json")), "strict install should create hidden workflow adapter config");
  assert(fs.existsSync(path.join(target, ".aidn", "runtime", "index", "workflow-index.sqlite")), "strict install should prepare hidden sqlite runtime store");
  assert(fs.existsSync(path.join(target, ".aidn", "runtime", "agents", "example-external-auditor.mjs")), "strict install should copy hidden runtime agent scaffold");
  assertNotExists(path.join(target, "docs", "audit"), "strict install should not create docs/audit");
  assertNotExists(path.join(target, ".codex"), "strict install should not create .codex");
  assertNotExists(path.join(target, "AGENTS.md"), "strict install should not write AGENTS.md");

  runText("tools/install.mjs", [
    "--target",
    target,
    "--pack",
    "core",
    "--verify",
    "--no-codex-migrate-custom",
  ], { env });
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

function verifyCleanupRestore(tempRoot) {
  const target = path.join(tempRoot, "cleanup-target");
  fs.mkdirSync(path.join(target, "docs", "audit"), { recursive: true });
  fs.mkdirSync(path.join(target, ".codex"), { recursive: true });
  fs.writeFileSync(path.join(target, "docs", "audit", "CURRENT-STATE.md"), "# State\n", "utf8");
  fs.writeFileSync(path.join(target, ".codex", "skills.yaml"), "skills: []\n", "utf8");
  fs.writeFileSync(path.join(target, "AGENTS.md"), "# Protected\n", "utf8");

  const preview = runJson("tools/runtime/visible-artifacts-cleanup.mjs", [
    "--target",
    target,
    "--json",
  ]);
  assert(preview.write_requested === false, "cleanup default should be preview");
  assert(preview.candidates.length === 2, "cleanup preview should list managed visible roots");
  assert(preview.protected_files.includes("AGENTS.md"), "cleanup preview should mark AGENTS.md protected");
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
  assert(!fs.existsSync(path.join(target, "docs", "audit")), "cleanup write should quarantine docs/audit");
  assert(!fs.existsSync(path.join(target, ".codex")), "cleanup write should quarantine .codex");
  assert(fs.existsSync(path.join(target, "AGENTS.md")), "cleanup write should keep AGENTS.md");
  assert(fs.existsSync(path.join(applied.quarantine_root, "docs", "audit", "CURRENT-STATE.md")), "cleanup should move docs/audit to quarantine");

  const restorePreview = runJson("tools/runtime/visible-artifacts-restore.mjs", [
    "--target",
    target,
    "--from",
    applied.backup_root,
    "--json",
  ]);
  assert(restorePreview.write_requested === false, "restore default should be preview");
  assert(restorePreview.restore_items.length === 2, "restore preview should list quarantined roots");

  const restored = runJson("tools/runtime/visible-artifacts-restore.mjs", [
    "--target",
    target,
    "--from",
    applied.backup_root,
    "--write",
    "--json",
  ]);
  assert(restored.status === "applied", "restore write should apply");
  assert(fs.existsSync(path.join(target, "docs", "audit", "CURRENT-STATE.md")), "restore should restore docs/audit content");
  assert(fs.existsSync(path.join(target, ".codex", "skills.yaml")), "restore should restore .codex content");
}

function main() {
  let tempRoot = "";
  try {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aidn-db-only-strict-"));
    verifyStrictInstall(tempRoot);
    verifyHydrateBundle(tempRoot);
    verifyCleanupRestore(tempRoot);
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
