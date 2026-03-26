#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { getDatabaseSync } from "../../src/lib/sqlite/workflow-db-schema-lib.mjs";
import { removePathWithRetry } from "./test-git-fixture-lib.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const SELFHOST_WORKSPACE = path.resolve(REPO_ROOT, "tests", "workspaces", "selfhost-product");

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
  console.log("  node tools/perf/verify-reinit-db-only-preserves-db-first-artifacts-fixtures.mjs");
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

function removeForReinit(targetRoot) {
  const paths = [
    path.join(targetRoot, "docs", "audit"),
    path.join(targetRoot, ".codex"),
    path.join(targetRoot, "AGENTS.md"),
  ];
  for (const absolutePath of paths) {
    fs.rmSync(absolutePath, { recursive: true, force: true });
  }
}

function main() {
  let tempRoot = "";
  try {
    const args = parseArgs(process.argv.slice(2));
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aidn-reinit-db-only-preserve-"));
    const targetRoot = path.join(tempRoot, "repo");
    fs.cpSync(SELFHOST_WORKSPACE, targetRoot, { recursive: true });
    const codexStubBin = makeCodexStub(tempRoot);
    const env = {
      AIDN_STATE_MODE: "db-only",
    };
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

    const artifactPath = "backlog/BL-S502-reinit-db-only-preservation.md";
    const artifactContent = [
      "# Session Backlog",
      "",
      "session_id: S502",
      "planning_status: promoted",
      "backlog_next_step: verify-reinit-no-loss",
      "",
      "- item: preserve DB-first artifact across reinitialization",
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
    const artifactBeforeReinit = readArtifactRow(sqliteFile, artifactPath);

    removeForReinit(targetRoot);
    const auditRemovedBeforeReinit = !fs.existsSync(path.join(targetRoot, "docs", "audit"));
    const codexRemovedBeforeReinit = !fs.existsSync(path.join(targetRoot, ".codex"));

    const secondInstall = runNode("tools/install.mjs", installArgs, { env, codexStubBin });
    if ((secondInstall.status ?? 1) !== 0) {
      throw new Error(`reinit install failed\nstdout:\n${secondInstall.stdout}\nstderr:\n${secondInstall.stderr}`);
    }

    const artifactAfterReinit = readArtifactRow(sqliteFile, artifactPath);
    const checks = {
      workspace_seed_exists: fs.existsSync(SELFHOST_WORKSPACE),
      first_install_ok: (firstInstall.status ?? 1) === 0,
      sqlite_created: fs.existsSync(sqliteFile),
      db_first_write_ok: (writeArtifact.status ?? 1) === 0,
      artifact_present_before_reinit: Number(artifactBeforeReinit?.artifact_id ?? 0) > 0,
      audit_removed_before_reinit: auditRemovedBeforeReinit,
      codex_removed_before_reinit: codexRemovedBeforeReinit,
      reinit_install_ok: (secondInstall.status ?? 1) === 0,
      audit_recreated_after_reinit: fs.existsSync(path.join(targetRoot, "docs", "audit", "WORKFLOW.md")),
      codex_recreated_after_reinit: fs.existsSync(path.join(targetRoot, ".codex", "skills.yaml")),
      artifact_present_after_reinit: Number(artifactAfterReinit?.artifact_id ?? 0) > 0,
      artifact_rowid_stable: Number(artifactBeforeReinit?.artifact_id ?? 0) > 0
        && Number(artifactBeforeReinit?.artifact_id) === Number(artifactAfterReinit?.artifact_id),
      artifact_content_preserved: String(artifactAfterReinit?.content ?? "") === artifactContent,
    };
    const pass = Object.values(checks).every((value) => value === true);
    const output = {
      ts: new Date().toISOString(),
      target_root: targetRoot,
      checks,
      samples: {
        sqlite_file: sqliteFile,
        first_install_stdout_head: String(firstInstall.stdout ?? "").split(/\r?\n/).filter(Boolean).slice(0, 12),
        reinit_install_stdout_tail: String(secondInstall.stdout ?? "").split(/\r?\n/).filter(Boolean).slice(-12),
        artifact_before_reinit: artifactBeforeReinit,
        artifact_after_reinit: artifactAfterReinit,
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
      const cleanup = removePathWithRetry(tempRoot);
      if (!cleanup.ok) {
        throw cleanup.error;
      }
    }
  }
}

main();
