#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { removePathWithRetry } from "./test-git-fixture-lib.mjs";

function printUsage() {
  console.log("Usage:");
  console.log("  node tools/perf/verify-project-config-fixtures.mjs");
}

function run(repoRoot, relativeScript, argv) {
  const result = spawnSync(process.execPath, [
    path.resolve(repoRoot, relativeScript),
    ...argv,
  ], {
    cwd: repoRoot,
    encoding: "utf8",
    timeout: 180000,
    maxBuffer: 20 * 1024 * 1024,
    env: {
      ...process.env,
    },
  });
  return {
    status: result.status ?? 1,
    stdout: String(result.stdout ?? ""),
    stderr: String(result.stderr ?? ""),
  };
}

function writeAdapterFile(tempRoot, projectName = "tmp-project") {
  const filePath = path.join(tempRoot, "workflow.adapter.json");
  fs.writeFileSync(filePath, `${JSON.stringify({
    version: 1,
    projectName,
    constraints: {
      runtime: "runtime constraint",
      architecture: "architecture constraint",
      delivery: "delivery constraint",
      additional: ["extra constraint"],
    },
    runtimePolicy: {
      preferredStateMode: "dual",
      defaultIndexStore: "dual-sqlite",
    },
  }, null, 2)}\n`, "utf8");
  return filePath;
}

function main() {
  let tempRoot = "";
  try {
    const repoRoot = process.cwd();
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aidn-project-config-"));
    const target = path.join(tempRoot, "repo");
    fs.mkdirSync(target, { recursive: true });

    const adapterFile = writeAdapterFile(tempRoot, "fixture-project");

    const listExisting = run(repoRoot, "tools/project/config.mjs", [
      "--target",
      "tests/fixtures/repo-installed-core",
      "--list",
      "--json",
    ]);
    const listExistingPayload = JSON.parse(listExisting.stdout || "{}");

    const installMissing = run(repoRoot, "tools/install.mjs", [
      "--target",
      target,
      "--pack",
      "core",
      "--skip-artifact-import",
      "--no-codex-migrate-custom",
    ]);

    const initDefaultsTarget = path.join(tempRoot, "repo-init-defaults");
    fs.mkdirSync(initDefaultsTarget, { recursive: true });
    const initDefaults = run(repoRoot, "tools/project/config.mjs", [
      "--target",
      initDefaultsTarget,
      "--init-defaults",
      "--project-name",
      "init-defaults-project",
      "--json",
    ]);
    const initDefaultsPayload = JSON.parse(initDefaults.stdout || "{}");

    const installInitDefaultsTarget = path.join(tempRoot, "repo-install-init-defaults");
    fs.mkdirSync(installInitDefaultsTarget, { recursive: true });
    const installWithInitDefaults = run(repoRoot, "tools/install.mjs", [
      "--target",
      installInitDefaultsTarget,
      "--pack",
      "core",
      "--init-defaults",
      "--project-name",
      "install-defaults-project",
      "--verify",
      "--skip-artifact-import",
      "--no-codex-migrate-custom",
    ]);

    const createFromFile = run(repoRoot, "tools/project/config.mjs", [
      "--target",
      target,
      "--adapter-file",
      adapterFile,
      "--json",
    ]);
    const createFromFilePayload = JSON.parse(createFromFile.stdout || "{}");

    const listCreated = run(repoRoot, "tools/project/config.mjs", [
      "--target",
      target,
      "--list",
      "--json",
    ]);
    const listCreatedPayload = JSON.parse(listCreated.stdout || "{}");

    const installWithAdapter = run(repoRoot, "tools/install.mjs", [
      "--target",
      target,
      "--pack",
      "core",
      "--adapter-file",
      adapterFile,
      "--skip-artifact-import",
      "--no-codex-migrate-custom",
      "--force-agents-merge",
    ]);

    const checks = {
      list_existing_ok: listExisting.status === 0,
      list_existing_has_config: listExistingPayload?.exists === true,
      list_existing_project_name: String(listExistingPayload?.config?.projectName ?? "") === "repo-installed-core",
      install_missing_fails_non_interactive: installMissing.status !== 0,
      install_missing_mentions_adapter_config: installMissing.stderr.includes("Missing workflow adapter config"),
      init_defaults_ok: initDefaults.status === 0,
      init_defaults_action: String(initDefaultsPayload?.action ?? "") === "init-defaults",
      init_defaults_project_name: String(initDefaultsPayload?.config?.projectName ?? "") === "init-defaults-project",
      install_with_init_defaults_ok: installWithInitDefaults.status === 0,
      install_with_init_defaults_created_adapter: fs.existsSync(path.join(installInitDefaultsTarget, ".aidn", "project", "workflow.adapter.json")),
      install_with_init_defaults_created_aidn_config: fs.existsSync(path.join(installInitDefaultsTarget, ".aidn", "config.json")),
      create_from_file_ok: createFromFile.status === 0,
      create_from_file_action: String(createFromFilePayload?.action ?? "") === "init-from-file",
      list_created_ok: listCreated.status === 0,
      list_created_exists: listCreatedPayload?.exists === true,
      list_created_project_name: String(listCreatedPayload?.config?.projectName ?? "") === "fixture-project",
      install_with_adapter_ok: installWithAdapter.status === 0,
      install_with_adapter_mentions_adapter: installWithAdapter.stdout.includes("Workflow adapter config:"),
      install_with_adapter_created_target_config: fs.existsSync(path.join(target, ".aidn", "project", "workflow.adapter.json")),
    };

    const pass = Object.values(checks).every((value) => value === true);
    const output = {
      ts: new Date().toISOString(),
      target_root: target,
      checks,
      samples: {
        install_missing_stderr: installMissing.stderr.trim(),
        install_with_init_defaults_stdout: installWithInitDefaults.stdout.trim().split(/\r?\n/).slice(0, 12),
        install_with_adapter_stdout: installWithAdapter.stdout.trim().split(/\r?\n/).slice(0, 12),
      },
      pass,
    };

    console.log(JSON.stringify(output, null, 2));
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
