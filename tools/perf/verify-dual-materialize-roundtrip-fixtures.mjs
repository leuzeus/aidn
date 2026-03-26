#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createArtifactStore } from "../../src/adapters/runtime/artifact-store.mjs";
import { getDatabaseSync } from "../../src/lib/sqlite/workflow-db-schema-lib.mjs";
import { removePathWithRetry } from "./test-git-fixture-lib.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const SELFHOST_WORKSPACE = path.resolve(REPO_ROOT, "tests", "workspaces", "selfhost-product");

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
    cwd: options.cwd ?? REPO_ROOT,
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

function readSchemaVersion(sqliteFile) {
  const DatabaseSync = getDatabaseSync();
  const db = new DatabaseSync(sqliteFile);
  try {
    return String(
      db.prepare("SELECT value FROM index_meta WHERE key = 'schema_version'").get()?.value ?? "",
    );
  } finally {
    db.close();
  }
}

function readTextIfExists(filePath) {
  return fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf8") : null;
}

function main() {
  let tempRoot = "";
  try {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aidn-dual-materialize-"));
    const targetRoot = path.join(tempRoot, "repo");
    fs.cpSync(SELFHOST_WORKSPACE, targetRoot, { recursive: true });
    const codexStubBin = makeCodexStub(tempRoot);
    const env = {
      AIDN_STATE_MODE: "dual",
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

    const install = runNode("tools/install.mjs", installArgs, { env, codexStubBin });
    if ((install.status ?? 1) !== 0) {
      throw new Error(`dual install failed\nstdout:\n${install.stdout}\nstderr:\n${install.stderr}`);
    }

    const sqliteFile = path.join(targetRoot, ".aidn", "runtime", "index", "workflow-index.sqlite");
    const auditRoot = path.join(targetRoot, "docs", "audit");
    const hotFiles = [
      "CURRENT-STATE.md",
      "RUNTIME-STATE.md",
      "HANDOFF-PACKET.md",
    ];
    const originals = Object.fromEntries(
      hotFiles.map((name) => [name, readTextIfExists(path.join(auditRoot, name))]),
    );
    for (const [name, text] of Object.entries(originals)) {
      assert.equal(typeof text, "string", `${name} should exist after dual install`);
      fs.rmSync(path.join(auditRoot, name), { force: true });
    }
    const deletedBeforeMaterialize = hotFiles.every((name) => !fs.existsSync(path.join(auditRoot, name)));

    const store = createArtifactStore({ sqliteFile });
    const materializeResult = store.materializeArtifacts({
      targetRoot,
      onlyPaths: hotFiles,
    });
    store.close();

    const rematerialized = Object.fromEntries(
      hotFiles.map((name) => [name, readTextIfExists(path.join(auditRoot, name))]),
    );

    const checks = {
      workspace_seed_exists: fs.existsSync(SELFHOST_WORKSPACE),
      dual_install_ok: (install.status ?? 1) === 0,
      sqlite_created: fs.existsSync(sqliteFile),
      schema_version_v6: readSchemaVersion(sqliteFile) === "6",
      selected_files_deleted_before_materialize: deletedBeforeMaterialize,
      materialize_selected_count_ok: Number(materializeResult?.selected_count ?? 0) === hotFiles.length,
      materialize_exported_all_missing_files: Number(materializeResult?.exported ?? 0) === hotFiles.length,
      current_state_restored: rematerialized["CURRENT-STATE.md"] === originals["CURRENT-STATE.md"],
      runtime_state_restored: rematerialized["RUNTIME-STATE.md"] === originals["RUNTIME-STATE.md"],
      handoff_packet_restored: rematerialized["HANDOFF-PACKET.md"] === originals["HANDOFF-PACKET.md"],
    };
    const pass = Object.values(checks).every((value) => value === true);
    const output = {
      ts: new Date().toISOString(),
      target_root: targetRoot,
      checks,
      samples: {
        sqlite_file: sqliteFile,
        schema_version: readSchemaVersion(sqliteFile),
        materialize_result: materializeResult,
        install_stdout_head: String(install.stdout ?? "").split(/\r?\n/).filter(Boolean).slice(0, 12),
      },
      pass,
    };

    console.log(JSON.stringify(output, null, 2));
    if (!pass) {
      process.exit(1);
    }
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    process.exit(1);
  } finally {
    if (tempRoot && fs.existsSync(tempRoot)) {
      removePathWithRetry(tempRoot);
    }
  }
}

main();
