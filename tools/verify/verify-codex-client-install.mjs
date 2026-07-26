#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

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

function run(command, argv, options = {}) {
  const result = spawnSync(command, argv, {
    cwd: options.cwd ?? REPO_ROOT,
    env: options.env ?? process.env,
    input: options.input,
    encoding: "utf8",
    timeout: 240000,
    maxBuffer: 20 * 1024 * 1024,
    shell: false,
  });
  if (result.status !== 0) {
    throw new Error([
      `${command} ${argv.join(" ")} failed with ${result.status}`,
      String(result.stdout ?? "").trim(),
      String(result.stderr ?? "").trim(),
    ].filter(Boolean).join("\n"));
  }
  return result;
}

function makeCodexStub(tempRoot) {
  const binDir = path.join(tempRoot, "codex-stub");
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

function main() {
  const started = Date.now();
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aidn-installed-client-"));
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
    run(npmCommand, [...npmPrefix, "install", "--ignore-scripts", "--no-audit", "--no-fund", tarball], {
      cwd: clientRoot,
    });

    const installedRoot = path.join(clientRoot, "node_modules", "aidn-workflow");
    const installedBin = path.join(installedRoot, "bin", "aidn.mjs");
    assert(fs.existsSync(installedBin), "packed AIDN binary was not installed");
    const codexStub = makeCodexStub(tempRoot);
    const separator = process.platform === "win32" ? ";" : ":";
    const env = {
      ...process.env,
      PATH: `${codexStub}${separator}${process.env.PATH ?? ""}`,
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
    const hookResult = run(process.execPath, [hookScript], {
      cwd: clientRoot,
      env,
      input: `${JSON.stringify({ hook_event_name: "SessionStart", cwd: clientRoot })}\n`,
    });
    const hookPayload = JSON.parse(hookResult.stdout);
    assert(
      hookPayload?.hookSpecificOutput?.hookEventName === "SessionStart",
      "SessionStart hook output contract mismatch",
    );
    assert(fs.existsSync(path.join(clientRoot, "AGENTS.md")), "client policy layer missing");

    console.log(JSON.stringify({
      ok: true,
      status: "PASS",
      proof_class: "installed-client",
      package_source: "npm-pack-tarball",
      installed_package_root: installedRoot,
      client_root: clientRoot,
      skills_discovered: REQUIRED_SKILLS.length,
      agents_discovered: REQUIRED_AGENTS.length,
      hooks_discovered: 1,
      duration_ms: Date.now() - started,
    }, null, 2));
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

try {
  main();
} catch (error) {
  console.error(`FAIL: ${error.message}`);
  process.exitCode = 1;
}
