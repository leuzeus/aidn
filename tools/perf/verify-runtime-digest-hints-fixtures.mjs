#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { removePathWithRetry } from "./test-git-fixture-lib.mjs";
import { inspectImmediateProcessExitArguments } from "../verify/spawn-sync-evidence-lib.mjs";

const INJECT_CLEANUP_FAILURE_ARG = "--inject-cleanup-failure";

function printUsage() {
  console.log("Usage:");
  console.log("  node tools/perf/verify-runtime-digest-hints-fixtures.mjs");
}

function runText(script, scriptArgs, env = {}, expectStatus = 0) {
  const file = path.resolve(process.cwd(), script);
  const result = spawnSync(process.execPath, [file, ...scriptArgs], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      ...env,
    },
  });
  if ((result.status ?? 1) !== expectStatus) {
    throw new Error(`Command failed: ${process.execPath} ${file} ${scriptArgs.join(" ")}`);
  }
  return `${String(result.stdout ?? "")}${String(result.stderr ?? "")}`;
}

function runNoJson(script, scriptArgs, env = {}) {
  const file = path.resolve(process.cwd(), script);
  execFileSync(process.execPath, [file, ...scriptArgs], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      ...env,
    },
  });
}

function makeInstallerPrerequisiteStub(tempRoot) {
  const binDir = path.join(tempRoot, "installer-prerequisite-stub");
  fs.mkdirSync(binDir, { recursive: true });
  if (process.platform === "win32") {
    fs.writeFileSync(path.join(binDir, "codex.cmd"), [
      "@echo off",
      "if \"%1\"==\"login\" if \"%2\"==\"status\" echo Logged in",
      "exit /b 0",
      "",
    ].join("\r\n"), "utf8");
  } else {
    const commandPath = path.join(binDir, "codex");
    fs.writeFileSync(commandPath, "#!/usr/bin/env sh\necho \"Logged in\"\n", "utf8");
    fs.chmodSync(commandPath, 0o755);
  }
  return binDir;
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function listOwnedTempRoots() {
  return new Set(
    fs.readdirSync(os.tmpdir(), { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && entry.name.startsWith("aidn-runtime-digest-hints-"))
      .map((entry) => entry.name),
  );
}

function verifyFailureCleanup() {
  const scriptPath = path.resolve(process.argv[1]);
  const source = fs.readFileSync(scriptPath, "utf8");
  const immediateExitArguments = inspectImmediateProcessExitArguments(source);
  assert(
    !immediateExitArguments.includes("1"),
    `runtime-digest-hints fixture contains an immediate failure exit: ${immediateExitArguments.join(",")}`,
  );

  const mutantSource = source.replace(
    /\n    process\.exitCode = 1;\n/u,
    "\n    process.exit(1);\n",
  );
  assert(mutantSource !== source, "runtime-digest-hints mutant did not change the executable source");
  const mutantExitArguments = inspectImmediateProcessExitArguments(mutantSource);
  assert(
    mutantExitArguments.includes("1"),
    "runtime-digest-hints immediate-exit mutant was not detected",
  );

  const before = listOwnedTempRoots();
  const result = spawnSync(process.execPath, [scriptPath, INJECT_CLEANUP_FAILURE_ARG], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  assert(result.status === 1, `injected cleanup failure returned ${result.status}`);
  assert(
    String(result.stderr ?? "").includes("injected runtime-digest-hints cleanup failure"),
    "injected cleanup failure did not preserve the primary diagnostic",
  );
  const introduced = [...listOwnedTempRoots()].filter((name) => !before.has(name));
  assert(
    introduced.length === 0,
    `injected cleanup failure left owned temp roots: ${introduced.join(",")}`,
  );
}

function writeAdapterFile(tempRoot) {
  const filePath = path.join(tempRoot, "workflow.adapter.json");
  fs.writeFileSync(filePath, `${JSON.stringify({
    version: 1,
    projectName: "repo",
    constraints: {
      runtime: "",
      architecture: "",
      delivery: "",
      additional: [],
    },
    runtimePolicy: {
      preferredStateMode: "dual",
      defaultIndexStore: "dual-sqlite",
    },
  }, null, 2)}\n`, "utf8");
  return filePath;
}

function setStaleCurrentState(target) {
  const file = path.join(target, "docs", "audit", "CURRENT-STATE.md");
  let text = fs.readFileSync(file, "utf8");
  text = text.replace(/updated_at:\s*.*/u, "updated_at: 2026-01-01T00:00:00Z");
  fs.writeFileSync(file, text, "utf8");
}

function setStaleRuntimeDigest(target) {
  const file = path.join(target, "docs", "audit", "RUNTIME-STATE.md");
  let text = fs.readFileSync(file, "utf8");
  text = text.replace(/current_state_freshness:\s*.*/u, "current_state_freshness: stale");
  text = text.replace(/current_state_freshness_basis:\s*.*/u, "current_state_freshness_basis: CURRENT-STATE.md is older than active cycle timestamps");
  fs.writeFileSync(file, text, "utf8");
}

function main() {
  let tempRoot = "";
  let adapterFile = "";
  try {
    const sourceTarget = path.resolve(process.cwd(), "tests/fixtures/perf-structure/session-rich");
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aidn-runtime-digest-hints-"));
    if (process.argv.includes(INJECT_CLEANUP_FAILURE_ARG)) {
      throw new Error("injected runtime-digest-hints cleanup failure");
    }
    const target = path.join(tempRoot, "repo");
    const installerPrerequisiteStub = makeInstallerPrerequisiteStub(tempRoot);
    const pathSeparator = process.platform === "win32" ? ";" : ":";
    fs.cpSync(sourceTarget, target, { recursive: true });
    fs.rmSync(path.join(target, ".aidn"), { recursive: true, force: true });
    adapterFile = writeAdapterFile(tempRoot);

    runNoJson("tools/install.mjs", [
      "--target",
      target,
      "--pack",
      "core",
      "--adapter-file",
      adapterFile,
      "--force-agents-merge",
    ], {
      PATH: `${installerPrerequisiteStub}${pathSeparator}${String(process.env.PATH ?? "")}`,
    });

    const env = {
      AIDN_STATE_MODE: "db-only",
      AIDN_INDEX_STORE_MODE: "sqlite",
    };

    setStaleCurrentState(target);
    runText("tools/codex/hydrate-context.mjs", [
      "--target",
      target,
      "--skill",
      "close-session",
      "--json",
    ], env);
    setStaleRuntimeDigest(target);
    runText("tools/perf/index-sync.mjs", [
      "--target",
      target,
      "--store",
      "sqlite",
      "--with-content",
      "--json",
    ], env);
    fs.rmSync(path.join(target, "docs", "audit", "RUNTIME-STATE.md"), { force: true });

    const skillHookOut = runText("tools/perf/skill-hook.mjs", [
      "--skill",
      "close-session",
      "--target",
      target,
      "--mode",
      "COMMITTING",
      "--no-auto-skip-gate",
    ], env);
    assert(skillHookOut.includes("Skill hook: WARN (close-session -> close-session-hook.mjs)"), "skill-hook missing warning summary");

    const runJsonHookOut = runText("tools/codex/run-json-hook.mjs", [
      "--skill",
      "close-session",
      "--mode",
      "COMMITTING",
      "--target",
      target,
      "--state-mode",
      "db-only",
      "--no-auto-skip-gate",
    ], env, 1);
    assert(runJsonHookOut.includes("Repair status: "), "run-json-hook missing repair status");
    assert(runJsonHookOut.includes("Runtime digest: docs/audit/RUNTIME-STATE.md"), "run-json-hook missing runtime digest hint");
    assert(runJsonHookOut.includes("Current state stale: docs/audit/CURRENT-STATE.md"), "run-json-hook missing stale current-state hint");

    console.log("PASS");
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    printUsage();
    process.exitCode = 1;
  } finally {
    if (adapterFile && fs.existsSync(adapterFile)) {
      fs.rmSync(adapterFile, { force: true });
    }
    if (tempRoot && fs.existsSync(tempRoot)) {
      const cleanup = removePathWithRetry(tempRoot);
      if (!cleanup.ok) {
        throw cleanup.error;
      }
    }
  }
}

if (!process.argv.includes(INJECT_CLEANUP_FAILURE_ARG)) {
  verifyFailureCleanup();
}
main();
