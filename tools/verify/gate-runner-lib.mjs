import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { findCodexLauncher } from "./codex-discovery-lib.mjs";
import {
  captureGitHead,
  captureGitRepository,
  captureGitWorktreeStatus,
  diffWorktreeEntries,
  redactDiagnostic,
  runGitCommand,
} from "./git-worktree-state-lib.mjs";

const GATE_CONTEXTS = Object.freeze(["dev", "main", "release"]);

function isGitCommandError(condition) {
  return condition.failure_kind === "git-command-error";
}

function gitDiagnostics(...states) {
  return states
    .filter(Boolean)
    .map((state) => state.command)
    .filter(Boolean);
}

export function evaluateGateCondition(
  condition,
  {
    repoRoot,
    env = process.env,
    gitSpawnSync = spawnSync,
    statusSnapshot = null,
  },
) {
  if (condition === "always") {
    return { met: true, failure_kind: null, reason: "always" };
  }
  if (condition === "git-repository") {
    const repository = captureGitRepository(repoRoot, {
      env,
      spawnSyncImpl: gitSpawnSync,
    });
    return {
      met: repository.ok,
      failure_kind: repository.failure_kind,
      reason: repository.ok ? "Git repository available" : "Git repository check failed",
      git_diagnostics: gitDiagnostics(repository),
    };
  }
  if (condition === "git-clean-commit" || condition === "git-clean-worktree") {
    const head = condition === "git-clean-commit"
      ? captureGitHead(repoRoot, { env, spawnSyncImpl: gitSpawnSync })
      : null;
    const status = statusSnapshot ?? captureGitWorktreeStatus(repoRoot, {
      env,
      spawnSyncImpl: gitSpawnSync,
    });
    if (head && !head.ok) {
      return {
        met: false,
        failure_kind: head.failure_kind,
        reason: "Git HEAD verification failed",
        git_diagnostics: gitDiagnostics(head, status),
        worktree_changes: status.entries,
        worktree_change_count: status.entry_count,
        worktree_changes_truncated: status.entries_truncated,
      };
    }
    if (!status.ok) {
      return {
        met: false,
        failure_kind: status.failure_kind,
        reason: "Git worktree status command failed",
        git_diagnostics: gitDiagnostics(head, status),
        worktree_changes: status.entries,
        worktree_change_count: status.entry_count,
        worktree_changes_truncated: status.entries_truncated,
      };
    }
    if (!status.clean) {
      return {
        met: false,
        failure_kind: "dirty-worktree",
        reason: "a clean Git worktree is required",
        git_diagnostics: gitDiagnostics(head, status),
        worktree_changes: status.entries,
        worktree_change_count: status.entry_count,
        worktree_changes_truncated: status.entries_truncated,
      };
    }
    return {
      met: true,
      failure_kind: null,
      reason: "clean Git state available",
      git_diagnostics: gitDiagnostics(head, status),
    };
  }
  if (condition === "codex-cli-available") {
    return {
      met: Boolean(findCodexLauncher(env)),
      failure_kind: "condition-not-met",
      reason: "real Codex CLI is unavailable",
    };
  }
  if (condition === "postgres-smoke-url-available") {
    return {
      met: Boolean(String(env.AIDN_PG_SMOKE_URL ?? "").trim()),
      failure_kind: "condition-not-met",
      reason: "optional PostgreSQL live smoke URL is unavailable",
    };
  }
  if (condition === "postgres-runtime-smoke-url-available") {
    return {
      met: Boolean(String(
        env.AIDN_RUNTIME_PG_SMOKE_URL
          ?? env.AIDN_PG_SMOKE_URL
          ?? "",
      ).trim()),
      failure_kind: "condition-not-met",
      reason: "optional PostgreSQL runtime live smoke URL is unavailable",
    };
  }
  return {
    met: false,
    failure_kind: "unknown-condition",
    reason: `unknown condition: ${condition}`,
  };
}

export function inferGateContext({
  explicitContext = "",
  env = process.env,
  repoRoot,
  gitSpawnSync = spawnSync,
} = {}) {
  if (explicitContext) {
    return explicitContext;
  }
  if (GATE_CONTEXTS.includes(env.AIDN_GATE_CONTEXT)) {
    return env.AIDN_GATE_CONTEXT;
  }
  if (env.GITHUB_EVENT_NAME === "push" && env.GITHUB_REF === "refs/heads/main") {
    return "main";
  }
  if (env.GITHUB_EVENT_NAME === "pull_request") {
    return env.GITHUB_BASE_REF === "main" ? "release" : "dev";
  }
  const branchResult = runGitCommand(
    repoRoot,
    ["branch", "--show-current"],
    { env, spawnSyncImpl: gitSpawnSync },
  );
  const branch = branchResult.exit_code === 0 ? branchResult.stdout.trim() : "";
  return branch.startsWith("release/") ? "release" : "dev";
}

function defaultCommandRunner({
  repoRoot,
  script,
  env,
  timeoutMs,
  maxBuffer,
}) {
  const npmCli = path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js");
  const npmCommand = fs.existsSync(npmCli) ? process.execPath : "npm";
  const npmPrefix = fs.existsSync(npmCli) ? [npmCli] : [];
  return spawnSync(npmCommand, [...npmPrefix, "run", script], {
    cwd: repoRoot,
    env,
    encoding: "utf8",
    timeout: timeoutMs,
    maxBuffer,
    shell: false,
  });
}

function resultTail(value, env) {
  return redactDiagnostic(value, env);
}

function createConditionResult(gate, obligation, condition, status) {
  return {
    id: gate.id,
    family: gate.family,
    script: gate.script,
    status,
    obligation,
    condition: gate.condition,
    duration_ms: 0,
    reason: condition.reason,
    condition_evaluation: {
      met: condition.met,
      failure_kind: condition.failure_kind,
      ...(condition.git_diagnostics ? { git_diagnostics: condition.git_diagnostics } : {}),
      ...(condition.worktree_changes ? {
        worktree_changes: condition.worktree_changes,
        worktree_change_count: condition.worktree_change_count,
        worktree_changes_truncated: condition.worktree_changes_truncated,
      } : {}),
    },
  };
}

export function runGateFamily({
  repoRoot,
  catalog,
  packageJson,
  requested,
  explicitGate = "",
  admission = false,
  context,
  env = process.env,
  json = false,
  gitSpawnSync = spawnSync,
  commandRunner = defaultCommandRunner,
  stdoutWriter = (value) => process.stdout.write(value),
  stderrWriter = (value) => process.stderr.write(value),
  timeoutMs = 900000,
  maxBuffer = 30 * 1024 * 1024,
}) {
  const selected = catalog.gates.filter(
    (gate) => (requested === "all"
        || requested === "obligations"
        || gate.family === requested)
      && (!admission || gate.execution_scope !== "manual-only")
      && (!explicitGate || gate.id === explicitGate),
  );
  if (explicitGate && selected.length !== 1) {
    throw new Error(`Unknown gate for ${requested}: ${explicitGate}`);
  }

  const results = [];
  for (const gate of selected) {
    const started = Date.now();
    const obligation = gate.obligation?.[context] ?? "required";
    if (obligation === "skip") {
      results.push({
        id: gate.id,
        family: gate.family,
        script: gate.script,
        status: "SKIP",
        obligation,
        condition: gate.condition,
        duration_ms: 0,
        reason: `catalog obligation is skip for ${context}`,
      });
      continue;
    }

    const before = captureGitWorktreeStatus(repoRoot, {
      env,
      spawnSyncImpl: gitSpawnSync,
    });
    const condition = evaluateGateCondition(gate.condition, {
      repoRoot,
      env,
      gitSpawnSync,
      statusSnapshot: before,
    });
    if (!condition.met) {
      const conditionStatus = obligation === "required"
        || isGitCommandError(condition)
        || condition.failure_kind === "unknown-condition"
        ? "FAIL"
        : "SKIP";
      results.push(createConditionResult(gate, obligation, condition, conditionStatus));
      continue;
    }

    if (!before.ok) {
      results.push({
        ...createConditionResult(gate, obligation, {
          met: false,
          failure_kind: before.failure_kind,
          reason: "Git worktree status command failed before gate execution",
          git_diagnostics: gitDiagnostics(before),
        }, "FAIL"),
      });
      continue;
    }
    if (!packageJson.scripts?.[gate.script]) {
      results.push({
        id: gate.id,
        family: gate.family,
        script: gate.script,
        status: "FAIL",
        obligation,
        condition: gate.condition,
        duration_ms: 0,
        reason: "script is not available",
      });
      continue;
    }

    let result;
    try {
      result = commandRunner({
        repoRoot,
        gate,
        script: gate.script,
        env: {
          ...env,
          AIDN_GATE_CONTEXT: context,
        },
        timeoutMs,
        maxBuffer,
      });
    } catch (error) {
      result = {
        status: null,
        signal: null,
        stdout: "",
        stderr: "",
        error,
      };
    }
    if (!json) {
      stdoutWriter(String(result?.stdout ?? ""));
      stderrWriter(String(result?.stderr ?? ""));
    }

    const after = captureGitWorktreeStatus(repoRoot, {
      env,
      spawnSyncImpl: gitSpawnSync,
    });
    const diff = after.ok ? diffWorktreeEntries(before, after) : {
      introduced: [],
      introduced_count: 0,
      introduced_truncated: false,
      resolved: [],
      resolved_count: 0,
      resolved_truncated: false,
    };
    const gateExitedSuccessfully = result?.status === 0
      && !result?.error
      && !result?.signal;
    const worktreeVerificationFailed = !after.ok;
    const introducedChanges = diff.introduced_count > 0;
    const status = gateExitedSuccessfully
      && !worktreeVerificationFailed
      && !introducedChanges
      ? "PASS"
      : "FAIL";
    let reason = "gate completed without checkout mutation";
    if (!gateExitedSuccessfully) {
      reason = "gate command failed";
    } else if (worktreeVerificationFailed) {
      reason = "Git worktree status command failed after gate execution";
    } else if (introducedChanges) {
      reason = "gate introduced checkout changes";
    }

    results.push({
      id: gate.id,
      family: gate.family,
      script: gate.script,
      status,
      obligation,
      condition: gate.condition,
      duration_ms: Date.now() - started,
      reason,
      exit_code: Number.isInteger(result?.status) ? result.status : null,
      condition_evaluation: {
        met: condition.met,
        failure_kind: condition.failure_kind,
        ...(condition.git_diagnostics ? { git_diagnostics: condition.git_diagnostics } : {}),
      },
      worktree_guard: {
        before_clean: before.clean,
        before_change_count: before.entry_count,
        after_clean: after.clean,
        after_change_count: after.entry_count,
        git_status_ok: before.ok && after.ok,
        before_git_status: before.command,
        after_git_status: after.command,
      },
      ...(introducedChanges ? {
        introduced_worktree_changes: diff.introduced,
        introduced_worktree_change_count: diff.introduced_count,
        introduced_worktree_changes_truncated: diff.introduced_truncated,
      } : {}),
      ...(worktreeVerificationFailed ? {
        git_diagnostics: gitDiagnostics(after),
      } : {}),
      ...(status === "FAIL" ? {
        error: result?.error ? resultTail(result.error.message, env) : null,
        error_code: result?.error?.code ? String(result.error.code) : null,
        signal: result?.signal ?? null,
        stdout_tail: resultTail(result?.stdout, env),
        stderr_tail: resultTail(result?.stderr, env),
      } : {}),
    });
  }

  const counts = Object.fromEntries(catalog.outcomes.map((status) => [
    status,
    results.filter((item) => item.status === status).length,
  ]));
  return {
    ok: counts.FAIL === 0
      && results.every((item) => item.status !== "SKIP" || item.obligation !== "required"),
    requested,
    admission,
    context,
    outcomes: catalog.outcomes,
    counts,
    results,
  };
}

function formatGitDiagnostic(diagnostic) {
  const command = [diagnostic.executable, ...(diagnostic.args ?? [])].join(" ");
  const pieces = [`command=${command}`, `exit=${diagnostic.exit_code ?? "null"}`];
  if (diagnostic.signal) {
    pieces.push(`signal=${diagnostic.signal}`);
  }
  if (diagnostic.error) {
    pieces.push(`error=${diagnostic.error}`);
  }
  if (diagnostic.stdout) {
    pieces.push(`stdout=${JSON.stringify(diagnostic.stdout)}`);
  }
  if (diagnostic.stderr) {
    pieces.push(`stderr=${JSON.stringify(diagnostic.stderr)}`);
  }
  return pieces.join(" ");
}

function formatGateProcessDiagnostic(item) {
  const pieces = [
    `exit=${item.exit_code ?? "null"}`,
    `signal=${item.signal ?? "null"}`,
  ];
  if (item.error_code) {
    pieces.push(`error_code=${item.error_code}`);
  }
  if (item.error) {
    pieces.push(`error=${JSON.stringify(item.error)}`);
  }
  return pieces.join(" ");
}

export function formatGateFamilySummary(output) {
  const lines = [`Gate family ${output.requested}: ${output.ok ? "PASS" : "FAIL"}`];
  for (const item of output.results) {
    lines.push(`- ${item.id}: ${item.status} obligation=${item.obligation} (${item.duration_ms} ms)`);
    if (item.reason && item.status !== "PASS") {
      lines.push(`  reason=${item.reason}`);
    }
    for (const diagnostic of [
      ...(item.condition_evaluation?.git_diagnostics ?? []),
      ...(item.git_diagnostics ?? []),
    ]) {
      lines.push(`  git=${formatGitDiagnostic(diagnostic)}`);
    }
    const conditionChanges = item.condition_evaluation?.worktree_changes ?? [];
    if (conditionChanges.length > 0) {
      lines.push(`  worktree_changes=${conditionChanges.map((entry) => `${entry.status} ${entry.path}`).join(", ")}`);
    }
    if ((item.introduced_worktree_changes ?? []).length > 0) {
      lines.push(`  introduced_worktree_changes=${item.introduced_worktree_changes.map((entry) => `${entry.status} ${entry.path}`).join(", ")}`);
    }
    if (item.status === "FAIL" && Object.hasOwn(item, "exit_code")) {
      lines.push(`  process=${formatGateProcessDiagnostic(item)}`);
      if (item.stdout_tail) {
        lines.push(`  stdout_tail=${JSON.stringify(item.stdout_tail)}`);
      }
      if (item.stderr_tail) {
        lines.push(`  stderr_tail=${JSON.stringify(item.stderr_tail)}`);
      }
    }
  }
  return `${lines.join("\n")}\n`;
}

export { GATE_CONTEXTS };
