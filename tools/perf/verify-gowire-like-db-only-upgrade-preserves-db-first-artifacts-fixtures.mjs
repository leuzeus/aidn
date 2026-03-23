#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { getDatabaseSync } from "../../src/lib/sqlite/workflow-db-schema-lib.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const VERSION = fs.readFileSync(path.join(REPO_ROOT, "VERSION"), "utf8").trim();
const SOURCE_FIXTURE = path.join(REPO_ROOT, "tests", "fixtures", "repo-installed-core");
const GOWIRE_WORKFLOW_FIXTURE = path.join(REPO_ROOT, "tests", "fixtures", "project-migration-gowire-like", "WORKFLOW.md");

function parseArgs(argv) {
  const args = {
    json: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--json") {
      args.json = true;
    } else if (token === "--help" || token === "-h") {
      printUsage();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${token}`);
    }
  }
  return args;
}

function printUsage() {
  console.log("Usage:");
  console.log("  node tools/perf/verify-gowire-like-db-only-upgrade-preserves-db-first-artifacts-fixtures.mjs");
}

function makeCodexStub(tempRoot) {
  const binDir = path.join(tempRoot, ".tmp-codex-bin");
  fs.mkdirSync(binDir, { recursive: true });
  if (process.platform === "win32") {
    fs.writeFileSync(path.join(binDir, "codex.cmd"), [
      "@echo off",
      "if \"%1\"==\"login\" if \"%2\"==\"status\" (",
      "  echo Logged in",
      "  exit /b 0",
      ")",
      "if \"%1\"==\"exec\" (",
      "  exit /b 0",
      ")",
      "exit /b 0",
      "",
    ].join("\r\n"), "utf8");
  } else {
    const cmdPath = path.join(binDir, "codex");
    fs.writeFileSync(cmdPath, [
      "#!/usr/bin/env sh",
      "if [ \"$1\" = \"login\" ] && [ \"$2\" = \"status\" ]; then",
      "  echo \"Logged in\"",
      "  exit 0",
      "fi",
      "if [ \"$1\" = \"exec\" ]; then",
      "  exit 0",
      "fi",
      "exit 0",
      "",
    ].join("\n"), "utf8");
    fs.chmodSync(cmdPath, 0o755);
  }
  return binDir;
}

function runNode(scriptRelative, argv, options = {}) {
  const separator = process.platform === "win32" ? ";" : ":";
  return spawnSync(process.execPath, [
    path.join(REPO_ROOT, scriptRelative),
    ...argv,
  ], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    timeout: 240000,
    maxBuffer: 20 * 1024 * 1024,
    env: {
      ...process.env,
      ...(options.env ?? {}),
      PATH: options.codexStubBin
        ? `${options.codexStubBin}${separator}${String((options.env ?? {}).PATH ?? process.env.PATH ?? "")}`
        : String((options.env ?? {}).PATH ?? process.env.PATH ?? ""),
    },
  });
}

function readArtifactRow(sqliteFile, artifactPath) {
  const DatabaseSync = getDatabaseSync();
  const db = new DatabaseSync(sqliteFile);
  try {
    return db.prepare(`
      SELECT artifact_id, path, content, canonical_format, source_mode, updated_at
      FROM artifacts
      WHERE path = ?
    `).get(artifactPath) ?? null;
  } finally {
    db.close();
  }
}

function prepareGowireLikeTarget(targetRoot) {
  const workflowPath = path.join(targetRoot, "docs", "audit", "WORKFLOW.md");
  const summaryPath = path.join(targetRoot, "docs", "audit", "WORKFLOW_SUMMARY.md");
  const codexOnlinePath = path.join(targetRoot, "docs", "audit", "CODEX_ONLINE.md");
  const indexPath = path.join(targetRoot, "docs", "audit", "index.md");
  const configPath = path.join(targetRoot, ".aidn", "config.json");

  fs.writeFileSync(workflowPath, fs.readFileSync(GOWIRE_WORKFLOW_FIXTURE, "utf8"), "utf8");
  fs.writeFileSync(summaryPath, "# stale summary\n", "utf8");
  fs.writeFileSync(codexOnlinePath, "# stale codex\n", "utf8");
  fs.writeFileSync(indexPath, "# stale index\n", "utf8");

  const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
  delete config.workflow;
  fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
}

function main() {
  let tempRoot = "";
  try {
    const args = parseArgs(process.argv.slice(2));
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aidn-gowire-db-upgrade-"));
    const targetRoot = path.join(tempRoot, "repo");
    fs.cpSync(SOURCE_FIXTURE, targetRoot, { recursive: true });
    fs.rmSync(path.join(targetRoot, ".aidn", "project", "workflow.adapter.legacy-source.md"), { force: true });
    fs.rmSync(path.join(targetRoot, ".aidn", "project", "workflow.adapter.migration-report.json"), { force: true });
    prepareGowireLikeTarget(targetRoot);

    const codexStubBin = makeCodexStub(tempRoot);
    const env = {
      AIDN_STATE_MODE: "db-only",
    };

    const migrateAdapter = runNode("tools/project/config.mjs", [
      "--target",
      targetRoot,
      "--migrate-adapter",
      "--version",
      VERSION,
      "--json",
    ], { env, codexStubBin });
    if ((migrateAdapter.status ?? 1) !== 0) {
      throw new Error(`adapter migration failed\nstdout:\n${migrateAdapter.stdout}\nstderr:\n${migrateAdapter.stderr}`);
    }
    const migratePayload = JSON.parse(String(migrateAdapter.stdout ?? "{}"));

    const installArgs = [
      "--target",
      targetRoot,
      "--pack",
      "core",
      "--artifact-import-store",
      "sqlite",
      "--source-branch",
      "main",
      "--no-codex-migrate-custom",
    ];
    const firstInstall = runNode("tools/install.mjs", installArgs, { env, codexStubBin });
    if ((firstInstall.status ?? 1) !== 0) {
      throw new Error(`first install failed\nstdout:\n${firstInstall.stdout}\nstderr:\n${firstInstall.stderr}`);
    }

    const artifactPath = "backlog/BL-S503-gowire-upgrade-preservation.md";
    const artifactContent = [
      "# Session Backlog",
      "",
      "session_id: S503",
      "planning_status: promoted",
      "backlog_next_step: verify-gowire-upgrade-no-loss",
      "",
      "- item: preserve DB-first artifact across gowire-like upgrade",
      "",
    ].join("\n");
    const writeArtifact = runNode("tools/runtime/db-first-artifact.mjs", [
      "--target",
      targetRoot,
      "--path",
      artifactPath,
      "--content",
      artifactContent,
      "--kind",
      "other",
      "--family",
      "support",
      "--state-mode",
      "db-only",
      "--json",
    ], { env, codexStubBin });
    if ((writeArtifact.status ?? 1) !== 0) {
      throw new Error(`db-first artifact write failed\nstdout:\n${writeArtifact.stdout}\nstderr:\n${writeArtifact.stderr}`);
    }

    const sqliteFile = path.join(targetRoot, ".aidn", "runtime", "index", "workflow-index.sqlite");
    const artifactBeforeUpgrade = readArtifactRow(sqliteFile, artifactPath);

    const secondInstall = runNode("tools/install.mjs", installArgs, { env, codexStubBin });
    if ((secondInstall.status ?? 1) !== 0) {
      throw new Error(`second install failed\nstdout:\n${secondInstall.stdout}\nstderr:\n${secondInstall.stderr}`);
    }

    const artifactAfterUpgrade = readArtifactRow(sqliteFile, artifactPath);
    const workflowText = fs.readFileSync(path.join(targetRoot, "docs", "audit", "WORKFLOW.md"), "utf8");
    const checks = {
      source_fixture_exists: fs.existsSync(SOURCE_FIXTURE),
      gowire_fixture_exists: fs.existsSync(GOWIRE_WORKFLOW_FIXTURE),
      adapter_migration_ok: (migrateAdapter.status ?? 1) === 0 && migratePayload.ok === true,
      migrated_adapter_project_name: String(migratePayload?.extracted_config?.projectName ?? "") === "gowire",
      first_install_ok: (firstInstall.status ?? 1) === 0,
      sqlite_created: fs.existsSync(sqliteFile),
      db_first_write_ok: (writeArtifact.status ?? 1) === 0,
      artifact_present_before_upgrade: Number(artifactBeforeUpgrade?.artifact_id ?? 0) > 0,
      second_install_ok: (secondInstall.status ?? 1) === 0,
      artifact_present_after_upgrade: Number(artifactAfterUpgrade?.artifact_id ?? 0) > 0,
      artifact_rowid_stable: Number(artifactBeforeUpgrade?.artifact_id ?? 0) > 0
        && Number(artifactBeforeUpgrade?.artifact_id) === Number(artifactAfterUpgrade?.artifact_id),
      artifact_content_preserved: String(artifactAfterUpgrade?.content ?? "") === artifactContent,
      workflow_regenerated_for_gowire: workflowText.includes("### Session Transition Cleanliness Gate (Mandatory)")
        && workflowText.includes("## Shared Codegen Boundary Gate"),
    };
    const pass = Object.values(checks).every((value) => value === true);
    const output = {
      ts: new Date().toISOString(),
      target_root: targetRoot,
      checks,
      samples: {
        sqlite_file: sqliteFile,
        migrate_payload: migratePayload,
        first_install_stdout_head: String(firstInstall.stdout ?? "").split(/\r?\n/).filter(Boolean).slice(0, 12),
        second_install_stdout_tail: String(secondInstall.stdout ?? "").split(/\r?\n/).filter(Boolean).slice(-12),
        artifact_before_upgrade: artifactBeforeUpgrade,
        artifact_after_upgrade: artifactAfterUpgrade,
      },
      pass,
    };

    if (args.json) {
      console.log(JSON.stringify(output, null, 2));
    } else {
      console.log(`Target: ${targetRoot}`);
      for (const [name, value] of Object.entries(checks)) {
        console.log(`${value ? "PASS" : "FAIL"} ${name}`);
      }
      console.log(`Result: ${pass ? "PASS" : "FAIL"}`);
    }

    if (!pass) {
      process.exit(1);
    }
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    printUsage();
    process.exit(1);
  } finally {
    if (tempRoot && fs.existsSync(tempRoot)) {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  }
}

main();
