#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { removePathWithRetry } from "./test-git-fixture-lib.mjs";

const GENERATED_FILES = [
  "docs/audit/WORKFLOW.md",
  "docs/audit/WORKFLOW_SUMMARY.md",
  "docs/audit/CODEX_ONLINE.md",
  "docs/audit/index.md",
];

const PRESERVED_FILES = [
  "docs/audit/baseline/current.md",
  "docs/audit/baseline/history.md",
  "docs/audit/parking-lot.md",
  "docs/audit/snapshots/context-snapshot.md",
];

function sha256(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function readText(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

function collectHashes(targetRoot, relativePaths) {
  return Object.fromEntries(relativePaths.map((relativePath) => [
    relativePath,
    sha256(path.join(targetRoot, relativePath)),
  ]));
}

function hashesEqual(left, right) {
  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();
  if (leftKeys.join("|") !== rightKeys.join("|")) {
    return false;
  }
  return leftKeys.every((key) => left[key] === right[key]);
}

function makeCodexStub(tmpRoot) {
  const binDir = path.join(tmpRoot, ".tmp-codex-bin");
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

function runNodeScript(repoRoot, codexStubBin, scriptRelative, argv = []) {
  const separator = process.platform === "win32" ? ";" : ":";
  const result = spawnSync(process.execPath, [
    path.join(repoRoot, scriptRelative),
    ...argv,
  ], {
    cwd: repoRoot,
    encoding: "utf8",
    timeout: 240000,
    maxBuffer: 20 * 1024 * 1024,
    env: {
      ...process.env,
      PATH: `${codexStubBin}${separator}${String(process.env.PATH ?? "")}`,
    },
  });
  return {
    status: result.status ?? 1,
    stdout: String(result.stdout ?? ""),
    stderr: String(result.stderr ?? ""),
  };
}

function main() {
  let tmpRoot = "";
  try {
    const repoRoot = process.cwd();
    const version = readText(path.join(repoRoot, "VERSION")).trim();
    const adapterSourcePath = path.join(
      repoRoot,
      "tests",
      "fixtures",
      "repo-installed-core",
      ".aidn",
      "project",
      "workflow.adapter.json",
    );
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aidn-install-idempotence-"));
    const targetRoot = path.join(tmpRoot, "repo");
    fs.mkdirSync(targetRoot, { recursive: true });
    const codexStubBin = makeCodexStub(tmpRoot);

    const installArgs = [
      "--target",
      targetRoot,
      "--pack",
      "core",
      "--skip-artifact-import",
      "--no-codex-migrate-custom",
      "--adapter-file",
      adapterSourcePath,
      "--source-branch",
      "dev",
    ];

    const firstInstall = runNodeScript(repoRoot, codexStubBin, "tools/install.mjs", installArgs);
    const generatedAfterFirst = collectHashes(targetRoot, GENERATED_FILES);

    const preservedMarkers = {
      "docs/audit/baseline/current.md": "<!-- preserve:baseline-current -->",
      "docs/audit/baseline/history.md": "<!-- preserve:baseline-history -->",
      "docs/audit/parking-lot.md": "<!-- preserve:parking-lot -->",
      "docs/audit/snapshots/context-snapshot.md": "<!-- preserve:snapshot -->",
    };
    for (const [relativePath, marker] of Object.entries(preservedMarkers)) {
      const absolutePath = path.join(targetRoot, relativePath);
      fs.writeFileSync(absolutePath, `${readText(absolutePath).trimEnd()}\n\n${marker}\n`, "utf8");
    }
    const preservedBeforeReinstall = collectHashes(targetRoot, PRESERVED_FILES);

    const secondInstall = runNodeScript(repoRoot, codexStubBin, "tools/install.mjs", installArgs);
    const generatedAfterSecond = collectHashes(targetRoot, GENERATED_FILES);
    const preservedAfterSecond = collectHashes(targetRoot, PRESERVED_FILES);

    const verifyOnly = runNodeScript(repoRoot, codexStubBin, "tools/install.mjs", [
      ...installArgs,
      "--verify",
    ]);
    const generatedAfterVerify = collectHashes(targetRoot, GENERATED_FILES);
    const preservedAfterVerify = collectHashes(targetRoot, PRESERVED_FILES);

    const migration = runNodeScript(repoRoot, codexStubBin, "tools/project/config.mjs", [
      "--target",
      targetRoot,
      "--migrate-adapter",
      "--version",
      version,
      "--json",
    ]);
    const migrationPayload = JSON.parse(migration.stdout || "{}");
    const generatedAfterMigration = collectHashes(targetRoot, GENERATED_FILES);
    const preservedAfterMigration = collectHashes(targetRoot, PRESERVED_FILES);

    const thirdInstall = runNodeScript(repoRoot, codexStubBin, "tools/install.mjs", installArgs);
    const generatedAfterThird = collectHashes(targetRoot, GENERATED_FILES);
    const preservedAfterThird = collectHashes(targetRoot, PRESERVED_FILES);

    const checks = {
      first_install_ok: firstInstall.status === 0,
      first_install_generated_files_exist: GENERATED_FILES.every((relativePath) => fs.existsSync(path.join(targetRoot, relativePath))),
      first_install_adapter_written: fs.existsSync(path.join(targetRoot, ".aidn", "project", "workflow.adapter.json")),
      reinstall_ok: secondInstall.status === 0,
      reinstall_generated_stable: hashesEqual(generatedAfterFirst, generatedAfterSecond),
      reinstall_preserved_unchanged: hashesEqual(preservedBeforeReinstall, preservedAfterSecond),
      verify_only_ok: verifyOnly.status === 0,
      verify_only_generated_unchanged: hashesEqual(generatedAfterSecond, generatedAfterVerify),
      verify_only_preserved_unchanged: hashesEqual(preservedAfterSecond, preservedAfterVerify),
      migration_ok: migration.status === 0 && migrationPayload.ok === true,
      migration_generated_unchanged: hashesEqual(generatedAfterVerify, generatedAfterMigration),
      migration_preserved_unchanged: hashesEqual(preservedAfterVerify, preservedAfterMigration),
      migration_report_written: fs.existsSync(path.join(targetRoot, ".aidn", "project", "workflow.adapter.migration-report.json")),
      migration_legacy_source_written: fs.existsSync(path.join(targetRoot, ".aidn", "project", "workflow.adapter.legacy-source.md")),
      post_migration_reinstall_ok: thirdInstall.status === 0,
      post_migration_generated_stable: hashesEqual(generatedAfterMigration, generatedAfterThird),
      post_migration_preserved_unchanged: hashesEqual(preservedAfterMigration, preservedAfterThird),
    };

    const pass = Object.values(checks).every((value) => value === true);
    console.log(JSON.stringify({
      ts: new Date().toISOString(),
      target_root: targetRoot,
      checks,
      samples: {
        first_install_stdout_head: firstInstall.stdout.trim().split(/\r?\n/).slice(0, 20),
        second_install_stdout_tail: secondInstall.stdout.trim().split(/\r?\n/).slice(-20),
        verify_only_stdout_tail: verifyOnly.stdout.trim().split(/\r?\n/).slice(-12),
        migration_payload: migrationPayload,
      },
      pass,
    }, null, 2));
    if (!pass) {
      process.exit(1);
    }
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    process.exit(1);
  } finally {
    if (tmpRoot && fs.existsSync(tmpRoot)) {
      const cleanup = removePathWithRetry(tmpRoot);
      if (!cleanup.ok) {
        throw cleanup.error;
      }
    }
  }
}

main();
