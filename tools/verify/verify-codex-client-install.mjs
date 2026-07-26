#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { discoverRepoSkills } from "./codex-discovery-lib.mjs";
import { removePathWithRetry } from "../perf/test-git-fixture-lib.mjs";

const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..");
const REQUIRED_SKILLS = [
  "branch-cycle-audit",
  "close-session",
  "context-reload",
  "convert-to-spike",
  "crash-recovery",
  "cycle-close",
  "cycle-create",
  "drift-check",
  "handoff-close",
  "pr-orchestrate",
  "promote-baseline",
  "requirements-delta",
  "start-session",
];
const REQUIRED_AGENTS = [
  "aidn-explorer",
  "aidn-executor",
  "aidn-validator",
  "aidn-reviewer",
];
const launchedPids = new Set();

function isProcessAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function recordCompletedProcess(result) {
  if (!Number.isInteger(result.pid)) {
    return;
  }
  launchedPids.add(result.pid);
  if (isProcessAlive(result.pid)) {
    throw new Error(`child process ${result.pid} remained alive after synchronous completion`);
  }
}

function run(command, argv, options = {}) {
  const result = spawnSync(command, argv, {
    cwd: options.cwd ?? REPO_ROOT,
    env: options.env ?? process.env,
    input: options.input,
    encoding: "utf8",
    timeout: 240000,
    maxBuffer: 20 * 1024 * 1024,
    shell: false,
    windowsHide: true,
  });
  recordCompletedProcess(result);
  if (result.status !== 0) {
    throw new Error([
      `${command} ${argv.join(" ")} failed with ${result.status}`,
      String(result.stdout ?? "").trim(),
      String(result.stderr ?? "").trim(),
    ].filter(Boolean).join("\n"));
  }
  return result;
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

function runHookCommand(command, { cwd, env, input }) {
  const result = spawnSync(command, {
    cwd,
    env,
    input,
    encoding: "utf8",
    timeout: 30000,
    maxBuffer: 2 * 1024 * 1024,
    shell: true,
    windowsHide: true,
  });
  recordCompletedProcess(result);
  if (result.status !== 0) {
    throw new Error([
      `hook command failed from ${cwd} with ${result.status}`,
      command,
      String(result.stdout ?? "").trim(),
      String(result.stderr ?? "").trim(),
    ].filter(Boolean).join("\n"));
  }
  return result;
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function parseArgs(argv) {
  const args = { requireCodexDiscovery: false };
  for (const token of argv) {
    if (token === "--require-codex-discovery") {
      args.requireCodexDiscovery = true;
    } else if (token === "--help" || token === "-h") {
      console.log("Usage: node tools/verify/verify-codex-client-install.mjs [--require-codex-discovery]");
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${token}`);
    }
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const started = Date.now();
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aidn-installed-client-"));
  let output = null;
  let primaryError = null;
  let cleanupError = null;
  try {
    const npmCli = path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js");
    const npmCommand = fs.existsSync(npmCli) ? process.execPath : "npm";
    const npmPrefix = fs.existsSync(npmCli) ? [npmCli] : [];
    const packOutput = run(npmCommand, [...npmPrefix, "pack", "--json", "--pack-destination", tempRoot], {
      cwd: REPO_ROOT,
    });
    const packed = JSON.parse(packOutput.stdout);
    const tarball = path.join(tempRoot, packed[0].filename);
    const clientRoot = path.join(tempRoot, "client");
    fs.mkdirSync(clientRoot, { recursive: true });
    fs.writeFileSync(path.join(clientRoot, "package.json"), `${JSON.stringify({
      name: "aidn-isolated-client-proof",
      private: true,
    }, null, 2)}\n`, "utf8");
    run("git", ["init", "--quiet"], { cwd: clientRoot });
    run(npmCommand, [...npmPrefix, "install", "--ignore-scripts", "--no-audit", "--no-fund", tarball], {
      cwd: clientRoot,
    });

    const installedRoot = path.join(clientRoot, "node_modules", "aidn-workflow");
    const installedBin = path.join(installedRoot, "bin", "aidn.mjs");
    assert(fs.existsSync(installedBin), "packed AIDN binary was not installed");
    const installerPrerequisiteStub = makeInstallerPrerequisiteStub(tempRoot);
    const separator = process.platform === "win32" ? ";" : ":";
    const env = {
      ...process.env,
      PATH: `${installerPrerequisiteStub}${separator}${process.env.PATH ?? ""}`,
    };
    run(process.execPath, [
      installedBin,
      "install",
      "--target",
      clientRoot,
      "--pack",
      "core",
      "--init-defaults",
      "--project-name",
      "isolated-client",
      "--skip-artifact-import",
      "--no-codex-migrate-custom",
    ], { cwd: clientRoot, env });

    for (const skill of REQUIRED_SKILLS) {
      const skillPath = path.join(clientRoot, ".agents", "skills", skill, "SKILL.md");
      assert(fs.existsSync(skillPath), `native client skill missing: ${skill}`);
      assert(fs.readFileSync(skillPath, "utf8").trim().length > 0, `native client skill empty: ${skill}`);
    }
    for (const agent of REQUIRED_AGENTS) {
      const agentPath = path.join(clientRoot, ".codex", "agents", `${agent}.toml`);
      assert(fs.existsSync(agentPath), `client agent missing: ${agent}`);
      const text = fs.readFileSync(agentPath, "utf8");
      for (const field of ["name", "description", "model", "model_reasoning_effort", "sandbox_mode", "developer_instructions"]) {
        assert(new RegExp(`^${field}\\s*=`, "m").test(text), `${agent}: missing ${field}`);
      }
    }
    const hooksPath = path.join(clientRoot, ".codex", "hooks.json");
    const hookScript = path.join(clientRoot, ".codex", "hooks", "aidn-session-start.mjs");
    assert(fs.existsSync(hooksPath), "client hook contract missing");
    assert(fs.existsSync(hookScript), "client hook implementation missing");
    const hookContract = JSON.parse(fs.readFileSync(hooksPath, "utf8"));
    assert(Array.isArray(hookContract?.hooks?.SessionStart), "SessionStart hook is not declared");
    const hookDescriptor = hookContract.hooks.SessionStart[0]?.hooks?.[0];
    const exactHookCommand = process.platform === "win32"
      ? hookDescriptor?.commandWindows
      : hookDescriptor?.command;
    assert(typeof exactHookCommand === "string" && exactHookCommand.trim(), "SessionStart hook command missing");
    const invocationRoots = [
      clientRoot,
      path.join(clientRoot, "src"),
      path.join(clientRoot, "src", "nested", "deeper"),
    ];
    for (const invocationRoot of invocationRoots) {
      fs.mkdirSync(invocationRoot, { recursive: true });
      const hookResult = runHookCommand(exactHookCommand, {
        cwd: invocationRoot,
        env,
        input: `${JSON.stringify({ hook_event_name: "SessionStart", cwd: invocationRoot })}\n`,
      });
      const hookPayload = JSON.parse(hookResult.stdout);
      assert(
        hookPayload?.hookSpecificOutput?.hookEventName === "SessionStart",
        `SessionStart hook output contract mismatch from ${invocationRoot}`,
      );
      assert(
        hookPayload?.aidnDiagnostics?.projectRoot === path.resolve(clientRoot),
        `SessionStart hook resolved the wrong project root from ${invocationRoot}`,
      );
      assert(
        hookPayload?.aidnDiagnostics?.invocationCwd === path.resolve(invocationRoot),
        `SessionStart hook reported the wrong invocation cwd from ${invocationRoot}`,
      );
      assert(
        hookPayload?.aidnDiagnostics?.missing?.length === 0,
        `SessionStart hook reported missing installed assets from ${invocationRoot}`,
      );
    }
    assert(fs.existsSync(path.join(clientRoot, "AGENTS.md")), "client policy layer missing");
    const codexDiscovery = await discoverRepoSkills({
      cwd: clientRoot,
      codexHome: path.join(tempRoot, "isolated-codex-home"),
    });
    if (args.requireCodexDiscovery && codexDiscovery.status === "SKIP") {
      throw new Error(`real Codex discovery is required: ${codexDiscovery.reason}`);
    }
    if (codexDiscovery.status !== "SKIP") {
      assert(codexDiscovery.status === "PASS", `Codex discovery errors: ${JSON.stringify(codexDiscovery.errors)}`);
      const discoveredNames = new Set(codexDiscovery.skills.map((skill) => skill.name));
      for (const skill of REQUIRED_SKILLS) {
        assert(discoveredNames.has(skill), `Codex did not discover installed repo skill: ${skill}`);
      }
    }

    output = {
      ok: true,
      status: "PASS",
      proof_class: "installed-client",
      package_source: "npm-pack-tarball",
      installed_package_root: installedRoot,
      client_root: clientRoot,
      installer_prerequisite: "isolated-stub-only",
      skills_present: REQUIRED_SKILLS.length,
      agents_present: REQUIRED_AGENTS.length,
      hooks_present: 1,
      exact_hook_command: exactHookCommand,
      hook_invocation_roots: invocationRoots.length,
      codex_discovery: codexDiscovery.status === "PASS"
        ? {
          status: "PASS",
          proof: "Codex app-server skills/list",
          isolated_codex_home: true,
          repo_skills_discovered: codexDiscovery.skills.length,
        }
        : codexDiscovery,
      duration_ms: Date.now() - started,
    };
  } catch (error) {
    primaryError = error;
  } finally {
    const cleanup = removePathWithRetry(tempRoot);
    if (!cleanup.ok || fs.existsSync(tempRoot)) {
      cleanupError = cleanup.error ?? new Error("installed-client temp root remains");
    }
  }
  const processesClean = [...launchedPids].every((pid) => !isProcessAlive(pid));
  if (!processesClean) {
    cleanupError ??= new Error("installed-client proof left a child process running");
  }
  if (primaryError || cleanupError) {
    if (primaryError && cleanupError) {
      throw new AggregateError(
        [primaryError, cleanupError],
        `installed-client proof failed and cleanup also failed: ${primaryError.message}; ${cleanupError.message}`,
      );
    }
    throw primaryError ?? cleanupError;
  }
  output.temp_removed = !fs.existsSync(tempRoot);
  output.child_processes_exited = processesClean;
  console.log(JSON.stringify(output, null, 2));
}

try {
  await main();
} catch (error) {
  console.error(`FAIL: ${error.message}`);
  process.exitCode = 1;
}
