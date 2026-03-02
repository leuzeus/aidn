#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

function parseArgs(argv) {
  const args = {
    target: "tests/fixtures/repo-installed-core",
    tmpRoot: "tests/fixtures",
    keepTmp: false,
    json: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--target") {
      args.target = argv[i + 1] ?? "";
      i += 1;
    } else if (token === "--tmp-root") {
      args.tmpRoot = argv[i + 1] ?? "";
      i += 1;
    } else if (token === "--keep-tmp") {
      args.keepTmp = true;
    } else if (token === "--json") {
      args.json = true;
    } else if (token === "--help" || token === "-h") {
      printUsage();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${token}`);
    }
  }
  if (!args.target || !args.tmpRoot) {
    throw new Error("Missing required argument values");
  }
  return args;
}

function printUsage() {
  console.log("Usage:");
  console.log("  node tools/perf/verify-install-import-fixtures.mjs");
  console.log("  node tools/perf/verify-install-import-fixtures.mjs --target tests/fixtures/repo-installed-core");
  console.log("  node tools/perf/verify-install-import-fixtures.mjs --tmp-root tests/fixtures");
  console.log("  node tools/perf/verify-install-import-fixtures.mjs --keep-tmp");
}

function prepareTmp(sourceTarget, tmpRoot, suffix) {
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  const target = path.resolve(tmpRoot, `tmp-install-import-${suffix}-${stamp}`);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.cpSync(sourceTarget, target, { recursive: true });
  fs.rmSync(path.join(target, ".aidn", "runtime", "index"), { recursive: true, force: true });
  fs.rmSync(path.join(target, ".aidn", "runtime", "cache"), { recursive: true, force: true });
  fs.rmSync(path.join(target, ".aidn", "runtime", "perf"), { recursive: true, force: true });
  return target;
}

function runInstall(repoRoot, targetRoot, extraArgs = [], extraEnv = {}) {
  const installScript = path.resolve(repoRoot, "tools", "install.mjs");
  const args = [installScript, "--target", targetRoot, "--pack", "core", ...extraArgs];
  const result = spawnSync(process.execPath, args, {
    cwd: repoRoot,
    env: {
      ...process.env,
      ...extraEnv,
    },
    encoding: "utf8",
    timeout: 180000,
    maxBuffer: 20 * 1024 * 1024,
  });
  return {
    status: result.status ?? 1,
    stdout: String(result.stdout ?? ""),
    stderr: String(result.stderr ?? ""),
  };
}

function includes(text, token) {
  return String(text ?? "").includes(token);
}

function tail(text, maxChars = 800) {
  const value = String(text ?? "");
  if (value.length <= maxChars) {
    return value;
  }
  return value.slice(value.length - maxChars);
}

function installDiagnostics(out) {
  return {
    exit_status: out.status,
    stdout_tail: tail(out.stdout),
    stderr_tail: tail(out.stderr),
  };
}

function checkCaseDefault(repoRoot, sourceTarget, tmpRoot) {
  const target = prepareTmp(sourceTarget, tmpRoot, "default");
  const out = runInstall(repoRoot, target);
  const indexJson = path.join(target, ".aidn", "runtime", "index", "workflow-index.json");
  return {
    name: "default_files_mode",
    target_root: target,
    ok: out.status === 0
      && includes(out.stdout, "artifact import: OK")
      && includes(out.stdout, "store=file")
      && fs.existsSync(indexJson),
    details: {
      ...installDiagnostics(out),
      has_import_ok_line: includes(out.stdout, "artifact import: OK"),
      has_store_file: includes(out.stdout, "store=file"),
      index_json_exists: fs.existsSync(indexJson),
    },
  };
}

function checkCaseDbOnly(repoRoot, sourceTarget, tmpRoot) {
  const target = prepareTmp(sourceTarget, tmpRoot, "db-only");
  const out = runInstall(repoRoot, target, [], { AIDN_STATE_MODE: "db-only" });
  const indexSqlite = path.join(target, ".aidn", "runtime", "index", "workflow-index.sqlite");
  return {
    name: "env_state_mode_db_only",
    target_root: target,
    ok: out.status === 0
      && includes(out.stdout, "artifact import: OK")
      && includes(out.stdout, "store=sqlite")
      && fs.existsSync(indexSqlite),
    details: {
      ...installDiagnostics(out),
      has_import_ok_line: includes(out.stdout, "artifact import: OK"),
      has_store_sqlite: includes(out.stdout, "store=sqlite"),
      index_sqlite_exists: fs.existsSync(indexSqlite),
    },
  };
}

function checkCaseEnvPrecedence(repoRoot, sourceTarget, tmpRoot) {
  const target = prepareTmp(sourceTarget, tmpRoot, "env-precedence");
  const out = runInstall(repoRoot, target, [], {
    AIDN_STATE_MODE: "db-only",
    AIDN_INDEX_STORE_MODE: "file",
  });
  const indexJson = path.join(target, ".aidn", "runtime", "index", "workflow-index.json");
  const indexSqlite = path.join(target, ".aidn", "runtime", "index", "workflow-index.sqlite");
  return {
    name: "env_index_store_over_state_mode",
    target_root: target,
    ok: out.status === 0
      && includes(out.stdout, "artifact import: OK")
      && includes(out.stdout, "store=file")
      && fs.existsSync(indexJson)
      && !fs.existsSync(indexSqlite),
    details: {
      ...installDiagnostics(out),
      has_import_ok_line: includes(out.stdout, "artifact import: OK"),
      has_store_file: includes(out.stdout, "store=file"),
      index_json_exists: fs.existsSync(indexJson),
      index_sqlite_exists: fs.existsSync(indexSqlite),
    },
  };
}

function checkCaseCliOverride(repoRoot, sourceTarget, tmpRoot) {
  const target = prepareTmp(sourceTarget, tmpRoot, "cli-override");
  const out = runInstall(repoRoot, target, ["--artifact-import-store", "dual-sqlite"], {
    AIDN_STATE_MODE: "files",
    AIDN_INDEX_STORE_MODE: "file",
  });
  const indexJson = path.join(target, ".aidn", "runtime", "index", "workflow-index.json");
  const indexSqlite = path.join(target, ".aidn", "runtime", "index", "workflow-index.sqlite");
  return {
    name: "cli_override_artifact_import_store",
    target_root: target,
    ok: out.status === 0
      && includes(out.stdout, "artifact import: OK")
      && includes(out.stdout, "store=dual-sqlite")
      && includes(out.stdout, "source=cli")
      && fs.existsSync(indexJson)
      && fs.existsSync(indexSqlite),
    details: {
      ...installDiagnostics(out),
      has_import_ok_line: includes(out.stdout, "artifact import: OK"),
      has_store_dual_sqlite: includes(out.stdout, "store=dual-sqlite"),
      has_source_cli: includes(out.stdout, "source=cli"),
      index_json_exists: fs.existsSync(indexJson),
      index_sqlite_exists: fs.existsSync(indexSqlite),
    },
  };
}

function checkCaseSkip(repoRoot, sourceTarget, tmpRoot) {
  const target = prepareTmp(sourceTarget, tmpRoot, "skip");
  const out = runInstall(repoRoot, target, ["--skip-artifact-import"]);
  const indexJson = path.join(target, ".aidn", "runtime", "index", "workflow-index.json");
  const indexSqlite = path.join(target, ".aidn", "runtime", "index", "workflow-index.sqlite");
  return {
    name: "explicit_skip_artifact_import",
    target_root: target,
    ok: out.status === 0
      && includes(out.stdout, "artifact import skipped: explicit --skip-artifact-import")
      && !fs.existsSync(indexJson)
      && !fs.existsSync(indexSqlite),
    details: {
      ...installDiagnostics(out),
      has_skip_line: includes(out.stdout, "artifact import skipped: explicit --skip-artifact-import"),
      index_json_exists: fs.existsSync(indexJson),
      index_sqlite_exists: fs.existsSync(indexSqlite),
    },
  };
}

function main() {
  let exitCode = 0;
  let keepTmp = false;
  const tmpTargets = [];
  try {
    const args = parseArgs(process.argv.slice(2));
    keepTmp = args.keepTmp === true;
    const repoRoot = process.cwd();
    const sourceTarget = path.resolve(repoRoot, args.target);
    const tmpRoot = path.resolve(repoRoot, args.tmpRoot);

    const cases = [
      checkCaseDefault(repoRoot, sourceTarget, tmpRoot),
      checkCaseDbOnly(repoRoot, sourceTarget, tmpRoot),
      checkCaseEnvPrecedence(repoRoot, sourceTarget, tmpRoot),
      checkCaseCliOverride(repoRoot, sourceTarget, tmpRoot),
      checkCaseSkip(repoRoot, sourceTarget, tmpRoot),
    ];
    for (const item of cases) {
      tmpTargets.push(item.target_root);
    }

    const pass = cases.every((item) => item.ok === true);
    const output = {
      ts: new Date().toISOString(),
      source_target: sourceTarget,
      tmp_root: tmpRoot,
      checks: cases,
      pass,
    };

    if (args.json) {
      console.log(JSON.stringify(output, null, 2));
    } else {
      console.log(`Source target: ${sourceTarget}`);
      for (const item of cases) {
        console.log(`${item.name}: ${item.ok ? "PASS" : "FAIL"}`);
      }
      console.log(`Result: ${pass ? "PASS" : "FAIL"}`);
    }

    if (!pass) {
      exitCode = 1;
    }
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    printUsage();
    exitCode = 1;
  } finally {
    if (!keepTmp) {
      for (const target of tmpTargets) {
        fs.rmSync(target, { recursive: true, force: true });
      }
    }
  }
  if (exitCode !== 0) {
    process.exit(exitCode);
  }
}

main();
