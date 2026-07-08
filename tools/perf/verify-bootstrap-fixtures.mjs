#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { removePathWithRetry } from "./test-git-fixture-lib.mjs";

function sha256(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
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
      "exit 0",
      "",
    ].join("\n"), "utf8");
    fs.chmodSync(cmdPath, 0o755);
  }
  return binDir;
}

function runCli(repoRoot, codexStubBin, args, env = {}) {
  const separator = process.platform === "win32" ? ";" : ":";
  const result = spawnSync(process.execPath, [
    path.join(repoRoot, "bin", "aidn.mjs"),
    ...args,
  ], {
    cwd: repoRoot,
    encoding: "utf8",
    timeout: 240000,
    maxBuffer: 30 * 1024 * 1024,
    env: {
      ...process.env,
      ...env,
      PATH: `${codexStubBin}${separator}${String(process.env.PATH ?? "")}`,
    },
  });
  return {
    status: result.status ?? 1,
    stdout: String(result.stdout ?? ""),
    stderr: String(result.stderr ?? ""),
  };
}

function parseJson(result) {
  return JSON.parse(result.stdout || "{}");
}

function listRelativeFiles(root) {
  if (!fs.existsSync(root)) {
    return [];
  }
  const files = [];
  function visit(current) {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) {
        visit(absolute);
      } else if (entry.isFile()) {
        files.push(path.relative(root, absolute).replace(/\\/g, "/"));
      }
    }
  }
  visit(root);
  return files.sort();
}

function main() {
  let tmpRoot = "";
  try {
    const repoRoot = process.cwd();
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aidn-bootstrap-"));
    const codexStubBin = makeCodexStub(tmpRoot);

    const dryRunTarget = path.join(tmpRoot, "fresh-dry-run");
    fs.mkdirSync(dryRunTarget, { recursive: true });
    const dryRunBefore = listRelativeFiles(dryRunTarget);
    const dryRun = runCli(repoRoot, codexStubBin, [
      "bootstrap",
      "--target",
      dryRunTarget,
      "--profile",
      "minimal",
      "--dry-run",
      "--json",
    ]);
    const dryRunPayload = parseJson(dryRun);
    const dryRunAfter = listRelativeFiles(dryRunTarget);

    const defaultTarget = path.join(tmpRoot, "fresh-default");
    fs.mkdirSync(defaultTarget, { recursive: true });
    const defaultInstall = runCli(repoRoot, codexStubBin, [
      "bootstrap",
      "--target",
      defaultTarget,
      "--profile",
      "default",
      "--json",
    ]);
    const defaultPayload = parseJson(defaultInstall);

    const preservedFile = path.join(defaultTarget, "docs", "audit", "parking-lot.md");
    const currentStateFile = path.join(defaultTarget, "docs", "audit", "CURRENT-STATE.md");
    fs.appendFileSync(preservedFile, "\n<!-- bootstrap-preserve-marker -->\n", "utf8");
    fs.appendFileSync(currentStateFile, "\n<!-- bootstrap-current-state-marker -->\n", "utf8");
    const preservedBefore = sha256(preservedFile);
    const currentStateBefore = sha256(currentStateFile);
    const upgrade = runCli(repoRoot, codexStubBin, [
      "bootstrap",
      "--target",
      defaultTarget,
      "--mode",
      "upgrade",
      "--profile",
      "default",
      "--json",
    ]);
    const upgradePayload = parseJson(upgrade);
    const preservedAfter = sha256(preservedFile);
    const currentStateAfter = sha256(currentStateFile);

    const postgresMissing = runCli(repoRoot, codexStubBin, [
      "bootstrap",
      "--target",
      path.join(tmpRoot, "postgres-missing"),
      "--profile",
      "postgres",
      "--json",
    ]);
    const postgresMissingPayload = parseJson(postgresMissing);

    const dbOnlyTarget = path.join(tmpRoot, "db-only");
    fs.mkdirSync(dbOnlyTarget, { recursive: true });
    const dbOnly = runCli(repoRoot, codexStubBin, [
      "bootstrap",
      "--target",
      dbOnlyTarget,
      "--profile",
      "db-only",
      "--json",
    ]);
    const dbOnlyPayload = parseJson(dbOnly);
    const dbOnlyConfig = JSON.parse(fs.readFileSync(path.join(dbOnlyTarget, ".aidn", "config.json"), "utf8"));

    const wizardHelp = runCli(repoRoot, codexStubBin, ["bootstrap", "--help"]);

    const checks = {
      dry_run_ok: dryRun.status === 0 && dryRunPayload.ok === true,
      dry_run_contract_preview: dryRunPayload.command === "aidn bootstrap --dry-run --json"
        && dryRunPayload.effect_class === "preview",
      dry_run_no_target_files: dryRunBefore.join("|") === dryRunAfter.join("|"),
      default_install_ok: defaultInstall.status === 0 && defaultPayload.ok === true,
      default_install_verified: defaultPayload.operations.some((item) => item.id === "verify" && item.ok === true),
      default_install_core_files: fs.existsSync(path.join(defaultTarget, "AGENTS.md"))
        && fs.existsSync(path.join(defaultTarget, ".aidn", "project", "workflow.adapter.json")),
      upgrade_ok: upgrade.status === 0 && upgradePayload.ok === true,
      upgrade_preserves_custom_file: preservedBefore === preservedAfter,
      upgrade_preserves_current_state: currentStateBefore === currentStateAfter,
      postgres_missing_fails: postgresMissing.status !== 0
        && postgresMissingPayload.ok === false
        && postgresMissingPayload.errors.some((item) => item.includes("requires --runtime-persistence-connection-ref")),
      db_only_ok: dbOnly.status === 0 && dbOnlyPayload.ok === true,
      db_only_strict_markers: dbOnlyConfig.runtime?.stateMode === "db-only"
        && dbOnlyConfig.runtime?.dbOnly?.strict === true
        && dbOnlyConfig.runtime?.dbOnly?.visibleArtifacts?.automaticMaterialization === false,
      wizard_surface_documented: wizardHelp.status === 0 && wizardHelp.stdout.includes("--wizard"),
    };

    const pass = Object.values(checks).every((value) => value === true);
    console.log(JSON.stringify({
      ts: new Date().toISOString(),
      checks,
      samples: {
        dry_run: {
          status: dryRun.status,
          operations: dryRunPayload.operations?.map((item) => item.id) ?? [],
        },
        default_install: {
          status: defaultInstall.status,
          operations: defaultPayload.operations?.map((item) => item.id) ?? [],
        },
        upgrade: {
          status: upgrade.status,
          operations: upgradePayload.operations?.map((item) => item.id) ?? [],
        },
        postgres_missing_errors: postgresMissingPayload.errors ?? [],
        db_only_profile: dbOnlyConfig.profile,
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
