import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const selfhostWorkspace = path.resolve(repoRoot, "tests", "workspaces", "selfhost-product");

function runNode(args, options = {}) {
  return spawnSync(process.execPath, args, {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    ...options,
  });
}

function copyWorkspaceSeed(tempRoot, name) {
  const destination = path.join(tempRoot, name);
  fs.cpSync(selfhostWorkspace, destination, { recursive: true });
  return destination;
}

function runInstallScenario({ targetRoot, stateMode, store }) {
  const env = {
    ...process.env,
    AIDN_STATE_MODE: stateMode,
  };
  const install = runNode([
    "tools/install.mjs",
    "--target",
    targetRoot,
    "--pack",
    "core",
    "--source-branch",
    "main",
    "--artifact-import-store",
    store,
    "--no-codex-migrate-custom",
  ], { env });
  const verify = runNode([
    "tools/install.mjs",
    "--target",
    targetRoot,
    "--pack",
    "core",
    "--verify",
    "--artifact-import-store",
    store,
  ], { env });
  return { install, verify };
}

function ensureOk(result, label) {
  assert.equal(result.status, 0, `${label} failed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
}

function main() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aidn-selfhost-"));
  const dualRoot = copyWorkspaceSeed(tempRoot, "dual");
  const dbOnlyRoot = copyWorkspaceSeed(tempRoot, "db-only");

  const dual = runInstallScenario({
    targetRoot: dualRoot,
    stateMode: "dual",
    store: "dual-sqlite",
  });
  const dbOnly = runInstallScenario({
    targetRoot: dbOnlyRoot,
    stateMode: "db-only",
    store: "sqlite",
  });

  ensureOk(dual.install, "dual install");
  ensureOk(dual.verify, "dual verify");
  ensureOk(dbOnly.install, "db-only install");
  ensureOk(dbOnly.verify, "db-only verify");

  assert(fs.existsSync(path.join(dualRoot, "docs", "audit", "WORKFLOW.md")), "dual workspace should render WORKFLOW.md");
  assert(fs.existsSync(path.join(dualRoot, ".aidn", "runtime", "index", "workflow-index.sqlite")), "dual workspace should produce sqlite index");
  assert(fs.existsSync(path.join(dbOnlyRoot, "docs", "audit", "WORKFLOW.md")), "db-only workspace should render WORKFLOW.md");
  assert(fs.existsSync(path.join(dbOnlyRoot, ".aidn", "runtime", "index", "workflow-index.sqlite")), "db-only workspace should produce sqlite index");

  const out = {
    ts: new Date().toISOString(),
    checks: {
      workspace_seed_exists: fs.existsSync(selfhostWorkspace),
      dual_install_ok: dual.install.status === 0,
      dual_verify_ok: dual.verify.status === 0,
      db_only_install_ok: dbOnly.install.status === 0,
      db_only_verify_ok: dbOnly.verify.status === 0,
      dual_workflow_rendered: fs.existsSync(path.join(dualRoot, "docs", "audit", "WORKFLOW.md")),
      dual_sqlite_index_present: fs.existsSync(path.join(dualRoot, ".aidn", "runtime", "index", "workflow-index.sqlite")),
      db_only_workflow_rendered: fs.existsSync(path.join(dbOnlyRoot, "docs", "audit", "WORKFLOW.md")),
      db_only_sqlite_index_present: fs.existsSync(path.join(dbOnlyRoot, ".aidn", "runtime", "index", "workflow-index.sqlite")),
    },
    samples: {
      dual_stdout_head: dual.install.stdout.split(/\r?\n/).filter(Boolean).slice(0, 8),
      db_only_stdout_head: dbOnly.install.stdout.split(/\r?\n/).filter(Boolean).slice(0, 8),
    },
  };
  out.pass = Object.values(out.checks).every(Boolean);
  console.log(JSON.stringify(out, null, 2));
  if (!out.pass) {
    process.exitCode = 1;
  }
}

main();
