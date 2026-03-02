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
  fs.rmSync(path.join(target, ".aidn", "config.json"), { force: true });
  fs.rmSync(path.join(target, ".aidn", "runtime", "index"), { recursive: true, force: true });
  fs.rmSync(path.join(target, ".aidn", "runtime", "cache"), { recursive: true, force: true });
  fs.rmSync(path.join(target, ".aidn", "runtime", "perf"), { recursive: true, force: true });
  return target;
}

function makeCodexStub(tmpRoot) {
  const binDir = path.resolve(tmpRoot, ".tmp-codex-bin");
  fs.mkdirSync(binDir, { recursive: true });
  if (process.platform === "win32") {
    const cmdPath = path.join(binDir, "codex.cmd");
    const content = [
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
    ].join("\r\n");
    fs.writeFileSync(cmdPath, content, "utf8");
  } else {
    const cmdPath = path.join(binDir, "codex");
    const content = [
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
    ].join("\n");
    fs.writeFileSync(cmdPath, content, "utf8");
    fs.chmodSync(cmdPath, 0o755);
  }
  return binDir;
}

function runInstall(repoRoot, targetRoot, codexStubBin, extraArgs = [], extraEnv = {}) {
  const installScript = path.resolve(repoRoot, "tools", "install.mjs");
  const args = [installScript, "--target", targetRoot, "--pack", "core", ...extraArgs];
  const separator = process.platform === "win32" ? ";" : ":";
  const basePath = String(process.env.PATH ?? "");
  const mergedPath = codexStubBin ? `${codexStubBin}${separator}${basePath}` : basePath;
  const result = spawnSync(process.execPath, args, {
    cwd: repoRoot,
    env: {
      ...process.env,
      PATH: mergedPath,
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

function runCheckpointJson(repoRoot, targetRoot) {
  const checkpointScript = path.resolve(repoRoot, "tools", "perf", "checkpoint.mjs");
  const result = spawnSync(process.execPath, [
    checkpointScript,
    "--target",
    targetRoot,
    "--mode",
    "COMMITTING",
    "--json",
  ], {
    cwd: repoRoot,
    env: { ...process.env },
    encoding: "utf8",
    timeout: 180000,
    maxBuffer: 20 * 1024 * 1024,
  });
  if ((result.status ?? 1) !== 0) {
    return {
      ok: false,
      status: result.status ?? 1,
      payload: null,
      stdout: String(result.stdout ?? ""),
      stderr: String(result.stderr ?? ""),
    };
  }
  try {
    return {
      ok: true,
      status: 0,
      payload: JSON.parse(String(result.stdout ?? "{}")),
      stdout: String(result.stdout ?? ""),
      stderr: String(result.stderr ?? ""),
    };
  } catch (error) {
    return {
      ok: false,
      status: 1,
      payload: null,
      stdout: String(result.stdout ?? ""),
      stderr: `invalid checkpoint JSON: ${error.message}\n${String(result.stderr ?? "")}`,
    };
  }
}

function includes(text, token) {
  return String(text ?? "").includes(token);
}

function readConfigSafe(configPath) {
  if (!fs.existsSync(configPath)) {
    return null;
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(configPath, "utf8"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
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

function checkCaseDefault(repoRoot, sourceTarget, tmpRoot, codexStubBin) {
  const target = prepareTmp(sourceTarget, tmpRoot, "default");
  const out = runInstall(repoRoot, target, codexStubBin);
  const indexJson = path.join(target, ".aidn", "runtime", "index", "workflow-index.json");
  const configPath = path.join(target, ".aidn", "config.json");
  const config = readConfigSafe(configPath);
  return {
    name: "default_files_mode",
    target_root: target,
    ok: out.status === 0
      && includes(out.stdout, "artifact import: OK")
      && includes(out.stdout, "store=file")
      && fs.existsSync(indexJson)
      && fs.existsSync(configPath)
      && String(config?.runtime?.stateMode ?? "") === "files",
    details: {
      ...installDiagnostics(out),
      has_import_ok_line: includes(out.stdout, "artifact import: OK"),
      has_store_file: includes(out.stdout, "store=file"),
      index_json_exists: fs.existsSync(indexJson),
      config_exists: fs.existsSync(configPath),
      config_runtime_state_mode: config?.runtime?.stateMode ?? null,
    },
  };
}

function checkCaseDbOnly(repoRoot, sourceTarget, tmpRoot, codexStubBin) {
  const target = prepareTmp(sourceTarget, tmpRoot, "db-only");
  const out = runInstall(repoRoot, target, codexStubBin, [], { AIDN_STATE_MODE: "db-only" });
  const indexSqlite = path.join(target, ".aidn", "runtime", "index", "workflow-index.sqlite");
  const configPath = path.join(target, ".aidn", "config.json");
  const config = readConfigSafe(configPath);
  return {
    name: "env_state_mode_db_only",
    target_root: target,
    ok: out.status === 0
      && includes(out.stdout, "artifact import: OK")
      && includes(out.stdout, "store=sqlite")
      && fs.existsSync(indexSqlite)
      && fs.existsSync(configPath)
      && String(config?.runtime?.stateMode ?? "") === "db-only",
    details: {
      ...installDiagnostics(out),
      has_import_ok_line: includes(out.stdout, "artifact import: OK"),
      has_store_sqlite: includes(out.stdout, "store=sqlite"),
      index_sqlite_exists: fs.existsSync(indexSqlite),
      config_exists: fs.existsSync(configPath),
      config_runtime_state_mode: config?.runtime?.stateMode ?? null,
    },
  };
}

function checkCaseEnvPrecedence(repoRoot, sourceTarget, tmpRoot, codexStubBin) {
  const target = prepareTmp(sourceTarget, tmpRoot, "env-precedence");
  const out = runInstall(repoRoot, target, codexStubBin, [], {
    AIDN_STATE_MODE: "db-only",
    AIDN_INDEX_STORE_MODE: "file",
  });
  const indexJson = path.join(target, ".aidn", "runtime", "index", "workflow-index.json");
  const indexSqlite = path.join(target, ".aidn", "runtime", "index", "workflow-index.sqlite");
  const configPath = path.join(target, ".aidn", "config.json");
  const config = readConfigSafe(configPath);
  return {
    name: "env_index_store_over_state_mode",
    target_root: target,
    ok: out.status === 0
      && includes(out.stdout, "artifact import: OK")
      && includes(out.stdout, "store=file")
      && fs.existsSync(indexJson)
      && !fs.existsSync(indexSqlite)
      && fs.existsSync(configPath)
      && String(config?.runtime?.stateMode ?? "") === "files",
    details: {
      ...installDiagnostics(out),
      has_import_ok_line: includes(out.stdout, "artifact import: OK"),
      has_store_file: includes(out.stdout, "store=file"),
      index_json_exists: fs.existsSync(indexJson),
      index_sqlite_exists: fs.existsSync(indexSqlite),
      config_exists: fs.existsSync(configPath),
      config_runtime_state_mode: config?.runtime?.stateMode ?? null,
    },
  };
}

function checkCaseCliOverride(repoRoot, sourceTarget, tmpRoot, codexStubBin) {
  const target = prepareTmp(sourceTarget, tmpRoot, "cli-override");
  const out = runInstall(repoRoot, target, codexStubBin, ["--artifact-import-store", "dual-sqlite"], {
    AIDN_STATE_MODE: "files",
    AIDN_INDEX_STORE_MODE: "file",
  });
  const indexJson = path.join(target, ".aidn", "runtime", "index", "workflow-index.json");
  const indexSqlite = path.join(target, ".aidn", "runtime", "index", "workflow-index.sqlite");
  const configPath = path.join(target, ".aidn", "config.json");
  const config = readConfigSafe(configPath);
  const checkpoint = runCheckpointJson(repoRoot, target);
  return {
    name: "cli_override_artifact_import_store",
    target_root: target,
    ok: out.status === 0
      && includes(out.stdout, "artifact import: OK")
      && includes(out.stdout, "store=dual-sqlite")
      && includes(out.stdout, "source=cli")
      && fs.existsSync(indexJson)
      && fs.existsSync(indexSqlite)
      && fs.existsSync(configPath)
      && String(config?.runtime?.stateMode ?? "") === "dual"
      && checkpoint.ok
      && String(checkpoint?.payload?.state_mode ?? "") === "dual"
      && String(checkpoint?.payload?.index?.store ?? "") === "dual-sqlite",
    details: {
      ...installDiagnostics(out),
      has_import_ok_line: includes(out.stdout, "artifact import: OK"),
      has_store_dual_sqlite: includes(out.stdout, "store=dual-sqlite"),
      has_source_cli: includes(out.stdout, "source=cli"),
      index_json_exists: fs.existsSync(indexJson),
      index_sqlite_exists: fs.existsSync(indexSqlite),
      config_exists: fs.existsSync(configPath),
      config_runtime_state_mode: config?.runtime?.stateMode ?? null,
      runtime_checkpoint_ok: checkpoint.ok,
      runtime_checkpoint_state_mode: checkpoint?.payload?.state_mode ?? null,
      runtime_checkpoint_index_store: checkpoint?.payload?.index?.store ?? null,
      runtime_checkpoint_stderr_tail: tail(checkpoint.stderr),
    },
  };
}

function checkCaseSkip(repoRoot, sourceTarget, tmpRoot, codexStubBin) {
  const target = prepareTmp(sourceTarget, tmpRoot, "skip");
  const out = runInstall(repoRoot, target, codexStubBin, ["--skip-artifact-import"]);
  const indexJson = path.join(target, ".aidn", "runtime", "index", "workflow-index.json");
  const indexSqlite = path.join(target, ".aidn", "runtime", "index", "workflow-index.sqlite");
  const configPath = path.join(target, ".aidn", "config.json");
  const config = readConfigSafe(configPath);
  return {
    name: "explicit_skip_artifact_import",
    target_root: target,
    ok: out.status === 0
      && includes(out.stdout, "artifact import skipped: explicit --skip-artifact-import")
      && !fs.existsSync(indexJson)
      && !fs.existsSync(indexSqlite)
      && fs.existsSync(configPath)
      && String(config?.runtime?.stateMode ?? "") === "files",
    details: {
      ...installDiagnostics(out),
      has_skip_line: includes(out.stdout, "artifact import skipped: explicit --skip-artifact-import"),
      index_json_exists: fs.existsSync(indexJson),
      index_sqlite_exists: fs.existsSync(indexSqlite),
      config_exists: fs.existsSync(configPath),
      config_runtime_state_mode: config?.runtime?.stateMode ?? null,
    },
  };
}

function main() {
  let exitCode = 0;
  let keepTmp = false;
  const tmpTargets = [];
  let codexStubBin = null;
  try {
    const args = parseArgs(process.argv.slice(2));
    keepTmp = args.keepTmp === true;
    const repoRoot = process.cwd();
    const sourceTarget = path.resolve(repoRoot, args.target);
    const tmpRoot = path.resolve(repoRoot, args.tmpRoot);
    codexStubBin = makeCodexStub(tmpRoot);

    const cases = [
      checkCaseDefault(repoRoot, sourceTarget, tmpRoot, codexStubBin),
      checkCaseDbOnly(repoRoot, sourceTarget, tmpRoot, codexStubBin),
      checkCaseEnvPrecedence(repoRoot, sourceTarget, tmpRoot, codexStubBin),
      checkCaseCliOverride(repoRoot, sourceTarget, tmpRoot, codexStubBin),
      checkCaseSkip(repoRoot, sourceTarget, tmpRoot, codexStubBin),
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
      if (codexStubBin) {
        fs.rmSync(codexStubBin, { recursive: true, force: true });
      }
    }
  }
  if (exitCode !== 0) {
    process.exit(exitCode);
  }
}

main();
