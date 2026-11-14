#!/usr/bin/env node
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { createProcessDispatchRecordStore } from "../../src/adapters/runtime/process-dispatch-record-store.mjs";
import { createLocalArtifactResourceFence, LOCAL_ARTIFACT_FENCE_PATH } from "../../src/application/runtime/local-artifact-resource-fence.mjs";
import { readControlledDriftGit } from "../../src/application/runtime/standard-drift-git.mjs";
import { createStandardOperationDisposition } from "../../src/application/runtime/standard-operation-disposition.mjs";
import { createStandardWorkflowArtifacts } from "../../src/application/runtime/standard-workflow-artifacts.mjs";
import { createStandardWorkflowOperations } from "../../src/application/runtime/standard-workflow-operations.mjs";
import { readWorkflowProjectAuthority } from "../../src/application/runtime/workflow-instance-composition.mjs";
import { dispatchRecordPath } from "../../src/core/workflow/process-dispatch-record.mjs";
import { createOperationJournalSigner } from "../../src/core/workflow/process-operation-journal.mjs";
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

const RUNTIME_IGNORES = [
  "/docs/audit/workflows/dispatch-records/",
  "/docs/audit/workflows/operation-control-intents/",
  "/docs/audit/workflows/operation-dispositions/",
  "/docs/audit/workflows/resource-fences/local-artifacts.json",
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

function fixtureGit(targetRoot, ...args) {
  return execFileSync("git", ["-C", targetRoot, "-c", "core.fsmonitor=false", "-c",
    `core.hooksPath=${process.platform === "win32" ? "NUL" : "/dev/null"}`, ...args], {
    encoding: "utf8", timeout: 10000, windowsHide: true, stdio: "pipe",
  });
}

async function verifyRuntimeGitScope(targetRoot) {
  const git = (...args) => fixtureGit(targetRoot, ...args);
  const product = "app.mjs";
  const dispatch = "op_" + "a".repeat(40);
  const tracked = "docs/audit/" + dispatchRecordPath("op_" + "b".repeat(40));
  fs.mkdirSync(path.dirname(path.join(targetRoot, tracked)), { recursive: true });
  fs.writeFileSync(path.join(targetRoot, tracked), "tracked fixture\n");
  fs.writeFileSync(path.join(targetRoot, product), "export const value = 1;\n");
  git("add", "--", ".gitignore", product);
  git("add", "-f", "--", tracked);
  git("-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-m", "fixture Git scope");
  const status = () => git("status", "--porcelain=v1", "-z", "--untracked-files=all");
  const observe = () => readControlledDriftGit({ root: targetRoot, productRoot: targetRoot, productFiles: [product] });
  const beforeStatus = status();
  const before = observe();

  const options = { targetRoot, stateMode: "files" };
  const readAuthority = () => readWorkflowProjectAuthority({ targetRoot });
  const authority = readAuthority();
  assert.equal(authority.stateMode, options.stateMode);
  const key = crypto.randomBytes(32);
  const signer = createOperationJournalSigner(() => key);
  const host = createStandardOperationDisposition({ ...options, signer,
    artifacts: createStandardWorkflowArtifacts({ targetRoot }), readAuthority, readContext: observe });
  const fence = createLocalArtifactResourceFence(options);
  fence.release(fence.acquire());
  assert.equal(fence.read().record.state, "released");
  const record = { operation_id: dispatch, intent: { instance_id: "git_scope_fixture",
    scope_id: authority.scope.runtime_scope_id, model_sha256: "a".repeat(64), binding_ref: "context_reload" },
  preview: {}, owner: {} };
  const operations = createStandardWorkflowOperations({ targetRoot });
  const output = await host.run(record, () => operations.reload());
  assert.equal(output.outcome, "completed");
  assert.equal(output.effect_status, "no_effect");
  const persisted = createProcessDispatchRecordStore(options).read(dispatch).record;
  assert.equal(signer.verify(persisted).phase, "returned");
  for (const privatePath of [dispatchRecordPath(dispatch), LOCAL_ARTIFACT_FENCE_PATH]) {
    const relative = "docs/audit/" + privatePath;
    assert.ok(fs.existsSync(path.join(targetRoot, relative)));
    assert.match(git("check-ignore", "-v", "--", relative), /^\.gitignore:/);
  }
  assert.equal(status(), beforeStatus, "private runtime writes must leave Git status stable");
  assert.deepEqual(observe(), before, "private runtime writes must leave the drift Git witness stable");

  const business = "docs/audit/workflows/resource-fences/business-evidence.md";
  fs.appendFileSync(path.join(targetRoot, tracked), "tracked change\n");
  fs.appendFileSync(path.join(targetRoot, product), "export const changed = true;\n");
  fs.writeFileSync(path.join(targetRoot, business), "# Business evidence\n");
  const visible = status().split("\0");
  assert.ok(visible.includes(` M ${tracked}`), "Git must still report tracked files under ignored paths");
  assert.ok(visible.includes(` M ${product}`));
  assert.ok(visible.includes(`?? ${business}`), "sibling business artifacts must remain visible");
  const changed = observe();
  assert.notEqual(changed.status_sha256, before.status_sha256);
  assert.notEqual(changed.diff_sha256, before.diff_sha256);
}

async function verifyInstalledRuntimeGitScope(repoRoot, tmpRoot, codexStubBin, installArgs) {
  const freshRoot = path.join(tmpRoot, "fresh");
  const targetRoot = path.join(tmpRoot, "runtime-git-scope");
  const ignorePath = path.join(targetRoot, ".gitignore");
  const userIgnores = "# User rules\n/user-cache/\n!/user-cache/keep.txt\n";
  const install = target => {
    const result = runNodeScript(repoRoot, codexStubBin, "tools/install.mjs", [
      "--target", target, ...installArgs, "--artifact-import-store", "file", "--runtime-persistence-backend", "sqlite",
    ]);
    assert.equal(result.status, 0, result.stderr.trim() || result.stdout.trim());
  };
  fs.mkdirSync(freshRoot);
  install(freshRoot);
  const freshIgnores = readText(path.join(freshRoot, ".gitignore")).split(/\r?\n/);
  assert.ok(RUNTIME_IGNORES.every(rule => freshIgnores.includes(rule)), "fresh install must add every private runtime rule");

  fs.mkdirSync(targetRoot);
  fixtureGit(targetRoot, "init", "--initial-branch=dev");
  // Supply the new lines as user-owned during the first install, so its
  // receipt owns only the earlier managed rules. Remove those user-owned
  // lines to construct the legacy preimage without editing the receipt.
  fs.writeFileSync(ignorePath, userIgnores + RUNTIME_IGNORES.join("\n") + "\n");
  install(targetRoot);
  const firstIgnores = readText(ignorePath);
  assert.ok(firstIgnores.startsWith(userIgnores));
  const legacyIgnores = firstIgnores.split("\n").filter(line => !RUNTIME_IGNORES.includes(line)).join("\n");
  fs.writeFileSync(ignorePath, legacyIgnores);
  install(targetRoot);
  const upgradedIgnores = readText(ignorePath);
  assert.ok(upgradedIgnores.startsWith(legacyIgnores));
  assert.ok(RUNTIME_IGNORES.every(rule => upgradedIgnores.split("\n").filter(line => line === rule).length === 1),
    "reinstall must restore every private runtime rule exactly once");
  install(targetRoot);
  assert.equal(readText(ignorePath), upgradedIgnores, "repeated installs must preserve the updated .gitignore");
  await verifyRuntimeGitScope(targetRoot);
}

async function main() {
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
    const codexStubBin = makeCodexStub(tmpRoot);
    const coreInstallArgs = [
      "--pack",
      "core",
      "--skip-artifact-import",
      "--no-codex-migrate-custom",
      "--adapter-file",
      adapterSourcePath,
      "--source-branch",
      "dev",
    ];
    await verifyInstalledRuntimeGitScope(repoRoot, tmpRoot, codexStubBin, coreInstallArgs);
    if (process.argv.includes("--runtime-gitignore-only")) {
      console.log(JSON.stringify({ status: "PASS", scope: "source-installed-files-runtime-gitignore" }));
      return;
    }
    const targetRoot = path.join(tmpRoot, "repo");
    fs.mkdirSync(targetRoot, { recursive: true });
    const installArgs = ["--target", targetRoot, ...coreInstallArgs];
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
      "--write",
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
      runtime_gitignore_scope_verified: true,
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
