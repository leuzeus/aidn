#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { readAidnProjectConfig } from "../../src/lib/config/aidn-config-lib.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const SELFHOST_WORKSPACE = path.resolve(REPO_ROOT, "tests", "workspaces", "selfhost-product");
const MODE_MIGRATE = path.resolve(REPO_ROOT, "tools", "runtime", "mode-migrate.mjs");

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

function runNode(scriptRelativeOrAbsolute, argv, options = {}) {
  const separator = process.platform === "win32" ? ";" : ":";
  const scriptPath = path.isAbsolute(scriptRelativeOrAbsolute)
    ? scriptRelativeOrAbsolute
    : path.join(REPO_ROOT, scriptRelativeOrAbsolute);
  return spawnSync(process.execPath, [
    scriptPath,
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

function main() {
  let tempRoot = "";
  try {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aidn-mode-migrate-dual-"));
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

    const install = runNode("tools/install.mjs", installArgs, { env, codexStubBin });
    if ((install.status ?? 1) !== 0) {
      throw new Error(`db-only install failed\nstdout:\n${install.stdout}\nstderr:\n${install.stderr}`);
    }

    const auditRoot = path.join(targetRoot, "docs", "audit");
    const hotFiles = [
      "CURRENT-STATE.md",
      "RUNTIME-STATE.md",
      "HANDOFF-PACKET.md",
    ];
    for (const name of hotFiles) {
      fs.rmSync(path.join(auditRoot, name), { force: true });
    }
    const absentBeforeMigrate = hotFiles.every((name) => !fs.existsSync(path.join(auditRoot, name)));

    const migrate = runNode(MODE_MIGRATE, [
      "--target",
      targetRoot,
      "--from",
      "db-only",
      "--to",
      "dual",
      "--json",
    ], { codexStubBin });
    if ((migrate.status ?? 1) !== 0) {
      throw new Error(`mode-migrate failed\nstdout:\n${migrate.stdout}\nstderr:\n${migrate.stderr}`);
    }
    const migrated = JSON.parse(String(migrate.stdout ?? "{}"));
    const config = readAidnProjectConfig(targetRoot).data ?? {};
    const runtime = config.runtime && typeof config.runtime === "object" ? config.runtime : {};
    const restoredAfterMigrate = hotFiles.every((name) => fs.existsSync(path.join(auditRoot, name)));

    const checks = {
      workspace_seed_exists: fs.existsSync(SELFHOST_WORKSPACE),
      db_only_install_ok: (install.status ?? 1) === 0,
      hot_files_absent_before_migrate: absentBeforeMigrate,
      mode_migrate_ok: migrated.ok === true,
      migrated_to_dual: String(migrated?.to_mode ?? "") === "dual",
      config_state_mode_updated: String(runtime.stateMode ?? "") === "dual",
      config_index_store_updated: String(runtime.indexStoreMode ?? "") === "dual-sqlite",
      hot_files_restored_after_migrate: restoredAfterMigrate,
    };
    const pass = Object.values(checks).every((value) => value === true);
    const output = {
      ts: new Date().toISOString(),
      target_root: targetRoot,
      checks,
      samples: {
        install_stdout_head: String(install.stdout ?? "").split(/\r?\n/).filter(Boolean).slice(0, 10),
        migrated,
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
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  }
}

main();
