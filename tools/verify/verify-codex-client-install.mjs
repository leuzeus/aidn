#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { discoverRepoSkills } from "./codex-discovery-lib.mjs";
import { SKILL_IDENTITIES } from "../../src/core/skills/skill-policy.mjs";
import { removePathWithRetry } from "../perf/test-git-fixture-lib.mjs";
import {
  createSpawnSyncEvidenceTracker,
  verifySpawnSyncOraclePolicy,
} from "./spawn-sync-evidence-lib.mjs";

const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..");
const REQUIRED_SKILLS = SKILL_IDENTITIES.map((skill) => skill.publicName);
const REQUIRED_AGENTS = [
  "aidn-explorer",
  "aidn-executor",
  "aidn-validator",
  "aidn-reviewer",
];
const spawnSyncEvidence = createSpawnSyncEvidenceTracker();

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
  spawnSyncEvidence.recordReturn();
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
  const started = performance.now();
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
  spawnSyncEvidence.recordReturn();
  const observed = { ...result, duration_ms: Math.round(performance.now() - started) };
  if (result.error || result.signal || result.status !== 0) {
    throw new Error(`hook command failed: ${JSON.stringify(hookDiagnostic(observed))}`);
  }
  return observed;
}

// Retain the reason before the owned client is removed, without echoing native
// context, command text, project paths or arbitrary stderr into gate summaries.
function hookDiagnostic(result) {
  const knownReasons = new Set([
    "admission_activation_degraded", "admission_invalid_output", "admission_runtime_unavailable",
    "admission_specific_output_invalid", "admission_summary_budget_invalid",
    "runtime_authority_invalid", "runtime_binding_changed", "runtime_binding_missing",
    "runtime_git_resolution_failed", "runtime_global_generation_changed", "runtime_global_launcher_required",
    "runtime_installation_incomplete", "runtime_installation_pending", "runtime_project_root_mismatch",
    "runtime_receipt_invalid", "runtime_receipt_missing", "runtime_receipt_path_invalid",
    "runtime_record_integrity_invalid", "runtime_record_invalid", "runtime_record_too_large",
    "runtime_unsafe_path", "runtime_worktree_backlink_mismatch",
  ]);
  let reason = "invalid_json", envelope = false;
  try {
    const payload = JSON.parse(String(result.stdout ?? "").trim());
    const context = payload?.hookSpecificOutput?.additionalContext;
    envelope = payload?.hookSpecificOutput?.hookEventName === "SessionStart";
    const degraded = typeof context === "string" ? /^AIDN resume is degraded \(([a-z_]+)\)\./.exec(context)?.[1] : null;
    reason = knownReasons.has(degraded) ? degraded
      : typeof context !== "string" ? "missing_context"
      : context.startsWith("AIDN canonical admission (read-only):") ? "canonical_admission"
      : context.startsWith("AIDN delegated task:") ? "delegated_context"
      : context === "AIDN resume is degraded: invalid hook input or project binding. Remain read-only and diagnose the installation."
        ? "invalid_hook_input_or_project_binding" : "unrecognized_context";
  } catch { /* Preserve the JSON failure without copying the untrusted output. */ }
  return {
    exit_code: Number.isInteger(result.status) ? result.status : null,
    signal: ["SIGTERM", "SIGKILL", "SIGINT"].includes(result.signal) ? result.signal : null,
    error_code: ["ETIMEDOUT", "ENOENT", "EACCES", "ENOBUFS"].includes(result.error?.code) ? result.error.code : null,
    duration_ms: Number.isFinite(result.duration_ms) ? result.duration_ms : null,
    stdout_bytes: Buffer.byteLength(String(result.stdout ?? "")),
    stderr_bytes: Buffer.byteLength(String(result.stderr ?? "")),
    session_start_envelope: envelope, reason,
  };
}

function verifyHookDiagnosticPolicy() {
  const payload = context => JSON.stringify({ hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: context } });
  const cases = [
    [payload('AIDN canonical admission (read-only): {"admission":"blocked"}'), "canonical_admission"],
    [payload("AIDN resume is degraded (admission_runtime_unavailable). private payload"), "admission_runtime_unavailable"],
    [payload("AIDN resume is degraded (runtime_binding_changed). private payload"), "runtime_binding_changed"],
    [payload("AIDN resume is degraded (runtime_git_resolution_failed). private payload"), "runtime_git_resolution_failed"],
    [payload("AIDN resume is degraded (private_secret). private payload"), "unrecognized_context"],
    ["{}", "missing_context"], ["private malformed payload", "invalid_json"],
  ];
  for (const [stdout, reason] of cases) {
    const observed = hookDiagnostic({ status: 0, stdout, stderr: "private stderr" });
    assert(observed.reason === reason, `SessionStart diagnostic reason lost: ${reason}`);
    assert(!JSON.stringify(observed).includes("private"), "SessionStart diagnostic leaked untrusted output");
  }
  const timeout = hookDiagnostic({ status: null, signal: "SIGTERM", error: { code: "ETIMEDOUT" }, duration_ms: 7000 });
  assert(timeout.error_code === "ETIMEDOUT" && timeout.signal === "SIGTERM" && timeout.exit_code === null
    && timeout.duration_ms === 7000, "SessionStart process timeout diagnostic lost");
  return { status: "PASS", cases: cases.length + 1, raw_context_retained: false };
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
  const diagnosticRegression = verifyHookDiagnosticPolicy();
  const oracleRegression = verifySpawnSyncOraclePolicy({
    source: fs.readFileSync(import.meta.filename, "utf8"),
    label: "verify-codex-client-install",
  });
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
      assert(!/^model\s*=/m.test(text), `${agent}: distributed roles must inherit the client model default`);
      for (const field of ["name", "description", "model_reasoning_effort", "sandbox_mode", "developer_instructions"]) {
        assert(new RegExp(`^${field}\\s*=`, "m").test(text), `${agent}: missing ${field}`);
      }
    }
    const hooksPath = path.join(clientRoot, ".codex", "hooks.json");
    const hookScript = path.join(clientRoot, ".codex", "hooks", "aidn-session-start.mjs");
    assert(fs.existsSync(hooksPath), "client hook contract missing");
    assert(fs.existsSync(hookScript), "client hook implementation missing");
    const hookContract = JSON.parse(fs.readFileSync(hooksPath, "utf8"));
    assert(Array.isArray(hookContract?.hooks?.SessionStart), "SessionStart hook is not declared");
    assert(Array.isArray(hookContract?.hooks?.PreToolUse), "PreToolUse hook is not declared");
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
    const hookObservations = [];
    for (const invocationRoot of invocationRoots) {
      fs.mkdirSync(invocationRoot, { recursive: true });
      const hookResult = runHookCommand(exactHookCommand, {
        cwd: invocationRoot,
        env,
        input: `${JSON.stringify({ hook_event_name: "SessionStart", cwd: invocationRoot })}\n`,
      });
      const diagnostic = hookDiagnostic(hookResult);
      hookObservations.push(diagnostic);
      const detail = JSON.stringify(diagnostic);
      let hookPayload;
      try { hookPayload = JSON.parse(hookResult.stdout); }
      catch { throw new Error(`SessionStart hook output is not complete JSON: ${detail}`); }
      assert(hookPayload !== null && typeof hookPayload === "object" && !Array.isArray(hookPayload)
        && Object.keys(hookPayload).length === 1 && Object.hasOwn(hookPayload, "hookSpecificOutput"),
        `packed SessionStart must emit only native-supported root fields: ${detail}`);
      assert(
        hookPayload?.hookSpecificOutput?.hookEventName === "SessionStart",
        `SessionStart hook output contract mismatch: ${detail}`,
      );
      assert(
        /AIDN canonical admission \(read-only\):/.test(hookPayload.hookSpecificOutput.additionalContext),
        `SessionStart hook did not reach canonical admission: ${detail}`,
      );
      assert(
        /"admission":"(?:admitted|admitted_with_warnings|blocked)"/.test(hookPayload.hookSpecificOutput.additionalContext),
        `SessionStart hook admission status missing: ${detail}`,
      );
      assert(
        !hookPayload.hookSpecificOutput.additionalContext.includes("Missing installed assets:"),
        `SessionStart hook reported missing installed assets: ${detail}`,
      );
    }
    assert(fs.existsSync(path.join(clientRoot, "AGENTS.md")), "client policy layer missing");
    const codexDiscovery = await discoverRepoSkills({
      cwd: clientRoot,
      codexHome: path.join(tempRoot, "isolated-codex-home"),
      expectedSkillNames: REQUIRED_SKILLS,
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
      hooks_present: Object.values(hookContract.hooks).flatMap((groups) => groups.flatMap((group) => group.hooks)).length,
      native_tool_qualification: "SKIP: no native hook trust or Codex tool execution",
      exact_hook_command: exactHookCommand,
      hook_invocation_roots: invocationRoots.length,
      hook_observations: hookObservations,
      diagnostic_regression: diagnosticRegression,
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
    const resolved = path.resolve(tempRoot);
    assert(resolved.startsWith(path.resolve(os.tmpdir()) + path.sep) && path.basename(resolved).startsWith("aidn-installed-client-"),
      "installed-client cleanup must stay in its exclusive temporary directory");
    const cleanup = removePathWithRetry(resolved);
    if (!cleanup.ok || fs.existsSync(tempRoot)) {
      cleanupError = cleanup.error ?? new Error("installed-client temp root remains");
    }
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
  output.processes = spawnSyncEvidence.snapshot();
  output.oracle_regression = oracleRegression;
  console.log(JSON.stringify(output, null, 2));
}

try {
  await main();
} catch (error) {
  console.error(`FAIL: ${error.message}`);
  process.exitCode = 1;
}
