#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { formatGateFamilySummary, runGateFamily } from "./gate-runner-lib.mjs";
import { captureGitWorktreeStatus } from "./git-worktree-state-lib.mjs";
import { removePathWithRetry } from "../perf/test-git-fixture-lib.mjs";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function runGit(repoRoot, args) {
  const result = spawnSync("git", args, {
    cwd: repoRoot,
    encoding: "utf8",
    shell: false,
  });
  if (result.status !== 0) {
    throw new Error(
      `git ${args.join(" ")} failed: ${String(result.stderr ?? result.stdout ?? "").trim()}`,
    );
  }
}

function initializeRepository(repoRoot) {
  fs.writeFileSync(path.join(repoRoot, "package.json"), JSON.stringify({
    name: "aidn-gate-runner-fixture",
    private: true,
    scripts: {
      "fixture:pass": "node fixture-pass.mjs",
      "fixture:dirty": "node fixture-dirty.mjs",
    },
  }, null, 2), "utf8");
  fs.writeFileSync(path.join(repoRoot, "tracked.txt"), "tracked baseline\n", "utf8");
  fs.writeFileSync(path.join(repoRoot, "fixture-pass.mjs"), "console.log('synthetic PASS');\n", "utf8");
  fs.writeFileSync(path.join(repoRoot, "fixture-dirty.mjs"), "console.log('synthetic dirty PASS');\n", "utf8");
  runGit(repoRoot, ["init", "--initial-branch", "dev"]);
  runGit(repoRoot, ["config", "user.name", "aidn-gate-runner-tests"]);
  runGit(repoRoot, ["config", "user.email", "aidn-gate-runner-tests@example.invalid"]);
  runGit(repoRoot, ["add", "."]);
  runGit(repoRoot, ["commit", "-m", "fixture baseline"]);
}

function cleanEnvironment() {
  const env = { ...process.env };
  delete env.AIDN_PG_SMOKE_URL;
  delete env.AIDN_RUNTIME_PG_SMOKE_URL;
  return env;
}

function makeCatalog(gate) {
  return {
    schema_version: 2,
    required_families: ["synthetic"],
    outcomes: ["PASS", "FAIL", "SKIP"],
    gates: [{
      id: gate.id,
      family: "synthetic",
      script: gate.script ?? "fixture:pass",
      job: "fixture/runner",
      surfaces: ["gate-runner"],
      condition: gate.condition ?? "always",
      obligation: gate.obligation ?? {
        dev: "required",
        main: "required",
        release: "required",
      },
    }],
  };
}

function successfulCommand() {
  return {
    status: 0,
    signal: null,
    error: null,
    stdout: "synthetic PASS\n",
    stderr: "",
  };
}

function runFixtureGate(repoRoot, gate, options = {}) {
  return runGateFamily({
    repoRoot,
    catalog: makeCatalog(gate),
    packageJson: {
      scripts: {
        "fixture:pass": "node fixture-pass.mjs",
        "fixture:dirty": "node fixture-dirty.mjs",
      },
    },
    requested: "synthetic",
    context: "dev",
    env: options.env ?? cleanEnvironment(),
    json: true,
    gitSpawnSync: options.gitSpawnSync,
    commandRunner: options.commandRunner ?? successfulCommand,
  });
}

function assertClean(repoRoot, message) {
  const status = captureGitWorktreeStatus(repoRoot);
  assert(status.ok && status.clean, `${message}: ${JSON.stringify(status.entries)}`);
}

function runCleanlinessScript(cleanlinessScript, repoRoot) {
  const result = spawnSync(process.execPath, [cleanlinessScript], {
    cwd: repoRoot,
    env: cleanEnvironment(),
    encoding: "utf8",
    shell: false,
  });
  return {
    status: result.status,
    payload: JSON.parse(String(result.stdout ?? "")),
    stderr: String(result.stderr ?? ""),
  };
}

function main() {
  let tempRoot = "";
  let output = null;
  let primaryError = null;
  let cleanup = null;
  try {
    const sourceRoot = path.resolve(import.meta.dirname, "..", "..");
    const cleanlinessScript = path.join(
      sourceRoot,
      "tools",
      "verify",
      "verify-repository-cleanliness.mjs",
    );
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aidn-gate-runner-"));
    initializeRepository(tempRoot);
    assertClean(tempRoot, "fixture repository should start clean");

    const cleanGate = runFixtureGate(tempRoot, { id: "clean-pass" });
    assert(cleanGate.ok, "clean synthetic gate should pass");
    assert(cleanGate.results[0].worktree_guard.before_clean, "clean gate should record a clean before snapshot");
    assert(cleanGate.results[0].worktree_guard.after_clean, "clean gate should record a clean after snapshot");

    const configuredSecret = "postgresql://fixture:secret@localhost/db";
    const failedCommand = runFixtureGate(
      tempRoot,
      { id: "failed-command-diagnostics" },
      {
        env: {
          ...cleanEnvironment(),
          AIDN_PG_SMOKE_URL: configuredSecret,
        },
        commandRunner() {
          return {
            status: 9,
            signal: null,
            error: null,
            stdout: "synthetic failed stdout\n",
            stderr: `synthetic failed stderr ${configuredSecret}\n`,
          };
        },
      },
    );
    const failedCommandResult = failedCommand.results[0];
    assert(!failedCommand.ok && failedCommandResult.status === "FAIL", "failed command must fail");
    assert(failedCommandResult.exit_code === 9, "failed command must retain exit code 9");
    assert(failedCommandResult.signal == null, "failed command must retain a null signal");
    assert(
      failedCommandResult.stdout_tail.includes("synthetic failed stdout"),
      "failed command must retain bounded stdout",
    );
    assert(
      failedCommandResult.stderr_tail.includes("[redacted]")
      && !failedCommandResult.stderr_tail.includes("fixture:secret"),
      "failed command must retain redacted stderr",
    );
    const failedCommandSummary = formatGateFamilySummary(failedCommand);
    assert(
      failedCommandSummary.includes("process=exit=9 signal=null")
      && failedCommandSummary.includes("stdout_tail=")
      && failedCommandSummary.includes("stderr_tail=")
      && failedCommandSummary.includes("[redacted]"),
      "text summary must retain exit, signal, and redacted output tails",
    );
    JSON.parse(JSON.stringify(failedCommand));

    const signalledCommand = runFixtureGate(
      tempRoot,
      { id: "signalled-command-diagnostics" },
      {
        commandRunner() {
          const error = new Error("synthetic timeout");
          error.code = "ETIMEDOUT";
          return {
            status: null,
            signal: "SIGTERM",
            error,
            stdout: "synthetic timeout stdout\n",
            stderr: "synthetic timeout stderr\n",
          };
        },
      },
    );
    const signalledResult = signalledCommand.results[0];
    assert(signalledResult.exit_code == null, "signalled command must retain null exit code");
    assert(signalledResult.signal === "SIGTERM", "signalled command must retain SIGTERM");
    assert(signalledResult.error_code === "ETIMEDOUT", "signalled command must retain ETIMEDOUT");
    const signalledSummary = formatGateFamilySummary(signalledCommand);
    assert(
      signalledSummary.includes("process=exit=null signal=SIGTERM error_code=ETIMEDOUT"),
      "text summary must retain signal and timeout error code",
    );

    const polluter = runFixtureGate(
      tempRoot,
      { id: "polluter-claims-pass", script: "fixture:dirty" },
      {
        commandRunner() {
          fs.writeFileSync(path.join(tempRoot, "tracked.txt"), "tracked mutation\n", "utf8");
          fs.writeFileSync(path.join(tempRoot, "introduced-untracked.txt"), "untracked mutation\n", "utf8");
          return successfulCommand();
        },
      },
    );
    const polluterResult = polluter.results[0];
    assert(!polluter.ok && polluterResult.status === "FAIL", "polluting gate must fail immediately");
    assert(
      polluterResult.reason === "gate introduced checkout changes",
      "polluting gate should carry the immediate pollution reason",
    );
    assert(
      polluterResult.introduced_worktree_changes.some((entry) => entry.path === "tracked.txt"),
      "polluting gate should report the tracked path",
    );
    assert(
      polluterResult.introduced_worktree_changes.some((entry) => entry.path === "introduced-untracked.txt"),
      "polluting gate should report the untracked path",
    );
    const polluterSummary = formatGateFamilySummary(polluter);
    assert(
      polluterSummary.includes("introduced_worktree_changes=")
      && polluterSummary.includes("tracked.txt")
      && polluterSummary.includes("introduced-untracked.txt"),
      "text summary should attribute bounded path/status diagnostics to the polluting gate",
    );
    fs.writeFileSync(path.join(tempRoot, "tracked.txt"), "tracked baseline\n", "utf8");
    fs.rmSync(path.join(tempRoot, "introduced-untracked.txt"), { force: true });
    assertClean(tempRoot, "polluter fixture cleanup should restore the checkout");

    const actualSpawnSync = spawnSync;
    const forcedGitError = runFixtureGate(
      tempRoot,
      { id: "forced-git-status-error" },
      {
        gitSpawnSync(command, args, options) {
          if (command === "git" && args[0] === "status") {
            return {
              status: 128,
              signal: null,
              error: null,
              stdout: "synthetic git status stdout\n",
              stderr: "synthetic git status failure postgresql://fixture:secret@localhost/db\n",
            };
          }
          return actualSpawnSync(command, args, options);
        },
      },
    );
    const gitErrorResult = forcedGitError.results[0];
    assert(!forcedGitError.ok && gitErrorResult.status === "FAIL", "git status error must fail");
    assert(
      gitErrorResult.condition_evaluation.failure_kind === "git-command-error",
      "git status error must remain distinct from a dirty checkout",
    );
    assert(
      gitErrorResult.condition_evaluation.git_diagnostics[0].exit_code === 128,
      "git status error should retain the exit code",
    );
    assert(
      gitErrorResult.condition_evaluation.git_diagnostics[0].stderr.includes("synthetic git status failure"),
      "git status error should retain redacted stderr",
    );
    assert(
      gitErrorResult.condition_evaluation.git_diagnostics[0].stdout.includes("synthetic git status stdout"),
      "git status error should retain redacted stdout",
    );
    assert(
      gitErrorResult.condition_evaluation.git_diagnostics[0].stderr.includes("[redacted-postgres-url]")
      && !gitErrorResult.condition_evaluation.git_diagnostics[0].stderr.includes("fixture:secret"),
      "git status error should redact connection credentials",
    );
    const gitErrorSummary = formatGateFamilySummary(forcedGitError);
    assert(
      gitErrorSummary.includes("exit=128")
      && gitErrorSummary.includes("synthetic git status stdout")
      && gitErrorSummary.includes("[redacted-postgres-url]"),
      "text summary should retain redacted Git code/stdout/stderr diagnostics",
    );

    fs.writeFileSync(path.join(tempRoot, "initial-dirty.txt"), "pre-existing dirt\n", "utf8");
    const initialDirty = runFixtureGate(tempRoot, {
      id: "initial-dirty-checkout",
      condition: "git-clean-commit",
    });
    const initialDirtyResult = initialDirty.results[0];
    assert(!initialDirty.ok && initialDirtyResult.status === "FAIL", "required clean condition must fail");
    assert(
      initialDirtyResult.condition_evaluation.failure_kind === "dirty-worktree",
      "dirty checkout should not be reported as a Git command error",
    );
    assert(
      initialDirtyResult.condition_evaluation.worktree_changes.some(
        (entry) => entry.path === "initial-dirty.txt",
      ),
      "dirty checkout failure should expose the bounded path/status list",
    );

    const dirtyCleanliness = runCleanlinessScript(cleanlinessScript, tempRoot);
    assert(dirtyCleanliness.status === 1, "cleanliness script should execute and fail on a dirty checkout");
    assert(
      dirtyCleanliness.payload.failure_kind === "dirty-worktree",
      "cleanliness script should classify a dirty checkout",
    );
    assert(
      dirtyCleanliness.payload.entries.some((entry) => entry.path === "initial-dirty.txt"),
      "cleanliness script should report the dirty path",
    );
    fs.rmSync(path.join(tempRoot, "initial-dirty.txt"), { force: true });
    assertClean(tempRoot, "initial dirty fixture cleanup should restore the checkout");

    const requiredCondition = runFixtureGate(tempRoot, {
      id: "required-condition-not-met",
      condition: "postgres-smoke-url-available",
    });
    assert(
      requiredCondition.results[0].status === "FAIL"
      && requiredCondition.results[0].condition_evaluation.failure_kind === "condition-not-met",
      "unmet required condition must fail diagnostically",
    );

    const optionalCondition = runFixtureGate(tempRoot, {
      id: "optional-condition-not-met",
      condition: "postgres-smoke-url-available",
      obligation: {
        dev: "optional",
        main: "optional",
        release: "optional",
      },
    });
    assert(
      optionalCondition.ok && optionalCondition.results[0].status === "SKIP",
      "unmet optional condition should remain an honest SKIP",
    );

    const cleanCleanliness = runCleanlinessScript(cleanlinessScript, tempRoot);
    assert(
      cleanCleanliness.status === 0
      && cleanCleanliness.payload.ok
      && cleanCleanliness.payload.entry_count === 0,
      "cleanliness script should execute and pass in a clean repository",
    );
    assertClean(tempRoot, "all runner fixture cases should leave the checkout clean");

    output = {
      status: "PASS",
      mutation_probes: {
        polluter_claiming_pass_rejected_at_source_gate: true,
        tracked_and_untracked_paths_reported: true,
        git_status_error_distinct_from_dirty_checkout: true,
        required_condition_not_met_failed: true,
        optional_condition_not_met_skipped: true,
        cleanliness_script_executed_clean_and_dirty: true,
        failed_command_exit_signal_tails_preserved: true,
        signalled_command_error_code_preserved: true,
      },
      final_repository_clean: true,
    };
  } catch (error) {
    primaryError = error;
  } finally {
    if (tempRoot) {
      cleanup = removePathWithRetry(tempRoot);
      if (!cleanup.ok && !primaryError) {
        primaryError = cleanup.error;
      }
    }
  }

  if (primaryError) {
    throw primaryError;
  }
  assert(cleanup?.ok && !fs.existsSync(tempRoot), "runner fixture temporary root should be removed");
  output.cleanup = {
    temporary_root_removed: true,
    attempts: cleanup.attempts,
  };
  console.log(JSON.stringify(output, null, 2));
}

try {
  main();
} catch (error) {
  console.error(`ERROR: ${error.message}`);
  process.exitCode = 1;
}
