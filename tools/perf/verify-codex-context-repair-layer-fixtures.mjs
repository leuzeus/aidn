#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { redactDiagnostic } from "../verify/git-worktree-state-lib.mjs";
import { removePathWithRetry } from "./test-git-fixture-lib.mjs";

const CURRENT_FILE = fileURLToPath(import.meta.url);
const REPO_ROOT = path.resolve(path.dirname(CURRENT_FILE), "..", "..");
const DEFAULT_STAGE_TIMEOUT_MS = 180000;
const DEFAULT_STAGE_MAX_BUFFER = 20 * 1024 * 1024;
const MAX_SAMPLE_TEXT = 500;

function parseArgs(argv) {
  const args = {
    target: "tests/fixtures/perf-structure/session-rich",
    json: false,
    testFailCheck: "",
  };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--target") {
      args.target = String(argv[i + 1] ?? "").trim();
      i += 1;
    } else if (token === "--json") {
      args.json = true;
    } else if (token === "--test-fail-check") {
      args.testFailCheck = String(argv[i + 1] ?? "").trim();
      i += 1;
    } else if (token === "--help" || token === "-h") {
      printUsage();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${token}`);
    }
  }
  if (!args.target) {
    throw new Error("--target requires a value");
  }
  if (argv.includes("--test-fail-check") && !args.testFailCheck) {
    throw new Error("--test-fail-check requires a check name");
  }
  return args;
}

function printUsage() {
  console.log("Usage:");
  console.log(
    "  node tools/perf/verify-codex-context-repair-layer-fixtures.mjs "
    + "[--target <fixture>] [--json] [--test-fail-check <name>]",
  );
}

function normalizeExitCode(value) {
  return Number.isInteger(value) ? value : null;
}

function replacePath(value, pathValue, replacement) {
  const rawPath = String(pathValue ?? "");
  if (!rawPath) {
    return value;
  }
  return value
    .replaceAll(rawPath, replacement)
    .replaceAll(rawPath.replaceAll("\\", "/"), replacement);
}

function boundedDiagnostic(value, env = process.env, redactedPaths = []) {
  let result = redactDiagnostic(value, env);
  result = replacePath(result, REPO_ROOT, "[repository-root]");
  for (const pathValue of redactedPaths) {
    result = replacePath(result, pathValue, "[temporary-test-root]");
  }
  return result;
}

function boundedSample(value, env = process.env, redactedPaths = []) {
  const result = boundedDiagnostic(value, env, redactedPaths);
  return result.length <= MAX_SAMPLE_TEXT
    ? result
    : `${result.slice(0, MAX_SAMPLE_TEXT - 24)}...[sample truncated]`;
}

function repoTargetLabel(targetPath) {
  const relative = path.relative(REPO_ROOT, targetPath);
  if (!relative || (!relative.startsWith("..") && !path.isAbsolute(relative))) {
    return (relative || ".").replaceAll("\\", "/");
  }
  return "[external-test-target]";
}

function scriptLabel(filePath) {
  const relative = path.relative(REPO_ROOT, filePath);
  return !relative.startsWith("..") && !path.isAbsolute(relative)
    ? relative.replaceAll("\\", "/")
    : "[external-test-script]";
}

function sanitizeFinding(finding, env, redactedPaths) {
  if (!finding || typeof finding !== "object") {
    return null;
  }
  return {
    severity: boundedSample(finding.severity ?? "", env, redactedPaths),
    finding_type: boundedSample(finding.finding_type ?? "", env, redactedPaths),
    entity_id: boundedSample(finding.entity_id ?? "", env, redactedPaths),
    artifact_path: boundedSample(finding.artifact_path ?? "", env, redactedPaths),
    message: boundedSample(finding.message ?? "", env, redactedPaths),
  };
}

function formatRepairFinding(finding) {
  if (!finding || typeof finding !== "object") {
    return "";
  }
  return [
    finding.severity,
    finding.finding_type,
    finding.entity_id,
    finding.message,
  ]
    .map((value) => String(value ?? "").trim())
    .filter(Boolean)
    .join(": ");
}

function sanitizeProcessError(error, env, redactedPaths) {
  if (!error || typeof error !== "object") {
    return null;
  }
  return {
    message: boundedSample(error.message ?? "", env, redactedPaths),
    status: Number.isInteger(error.status) ? error.status : null,
    stdout: boundedSample(error.stdout ?? "", env, redactedPaths),
    stderr: boundedSample(error.stderr ?? "", env, redactedPaths),
  };
}

function buildStageDiagnostic({
  stage,
  file,
  result,
  expectedStatuses,
  env,
  redactedPaths,
}) {
  const errorCode = result?.error?.code ? String(result.error.code) : null;
  return {
    stage,
    script: scriptLabel(file),
    expected_statuses: [...expectedStatuses],
    status: normalizeExitCode(result?.status),
    signal: result?.signal ?? null,
    error_code: errorCode,
    timed_out: errorCode === "ETIMEDOUT",
    error: result?.error
      ? boundedDiagnostic(result.error.message ?? result.error, env, redactedPaths)
      : null,
    stdout_tail: boundedDiagnostic(result?.stdout, env, redactedPaths),
    stderr_tail: boundedDiagnostic(result?.stderr, env, redactedPaths),
  };
}

function publicStageSummary(diagnostic) {
  return {
    stage: diagnostic.stage,
    script: diagnostic.script,
    expected_statuses: diagnostic.expected_statuses,
    status: diagnostic.status,
    signal: diagnostic.signal,
    error_code: diagnostic.error_code,
    timed_out: diagnostic.timed_out,
  };
}

export class StageExecutionError extends Error {
  constructor(message, diagnostic) {
    super(message);
    this.name = "StageExecutionError";
    this.code = diagnostic.failure_code;
    this.stageDiagnostic = diagnostic;
  }
}

function spawnStage(
  stage,
  script,
  scriptArgs,
  env,
  {
    expectedStatuses = [0],
    timeoutMs = DEFAULT_STAGE_TIMEOUT_MS,
    maxBuffer = DEFAULT_STAGE_MAX_BUFFER,
    redactedPaths = [],
  } = {},
) {
  const file = path.resolve(REPO_ROOT, script);
  let result;
  try {
    result = spawnSync(process.execPath, [file, ...scriptArgs], {
      cwd: REPO_ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        ...env,
      },
      timeout: timeoutMs,
      maxBuffer,
      windowsHide: true,
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

  const diagnostic = buildStageDiagnostic({
    stage,
    file,
    result,
    expectedStatuses,
    env: {
      ...process.env,
      ...env,
    },
    redactedPaths,
  });
  const expectedStatus = expectedStatuses.includes(diagnostic.status);
  if (!expectedStatus || diagnostic.signal || diagnostic.error_code) {
    diagnostic.failure_code = diagnostic.error_code
      ? "AIDN_CHILD_PROCESS_ERROR"
      : "AIDN_CHILD_UNEXPECTED_STATUS";
    throw new StageExecutionError(
      `child stage ${stage} did not satisfy its process contract`,
      diagnostic,
    );
  }
  return {
    result,
    diagnostic,
  };
}

export function runJsonStage(
  stage,
  script,
  scriptArgs,
  env = {},
  options = {},
) {
  const stageRun = spawnStage(stage, script, scriptArgs, env, options);
  try {
    return {
      payload: JSON.parse(String(stageRun.result.stdout ?? "").trim()),
      process: stageRun.diagnostic,
    };
  } catch (error) {
    const diagnostic = {
      ...stageRun.diagnostic,
      failure_code: "AIDN_CHILD_JSON_INVALID",
      parse_error: boundedDiagnostic(
        error.message ?? error,
        { ...process.env, ...env },
        options.redactedPaths ?? [],
      ),
    };
    throw new StageExecutionError(
      `child stage ${stage} did not emit one complete JSON document`,
      diagnostic,
    );
  }
}

export function runNoJsonStage(
  stage,
  script,
  scriptArgs,
  env = {},
  options = {},
) {
  return {
    process: spawnStage(stage, script, scriptArgs, env, options).diagnostic,
  };
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

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
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

function resolveDbSyncOpenCount(hookOutput) {
  const triageCount = hookOutput?.db_sync?.payload?.repair_layer_triage_result?.triage?.summary?.open_findings_count;
  if (triageCount !== undefined && triageCount !== null) {
    return Number(triageCount);
  }
  const severityCounts = hookOutput?.db_sync?.payload?.repair_layer_result?.summary?.severity_counts;
  if (severityCounts && typeof severityCounts === "object") {
    return Number(severityCounts.warning ?? 0) + Number(severityCounts.error ?? 0);
  }
  return null;
}

function failedCheck(name, expected, observed, stage = "semantic-assertions") {
  return {
    name,
    stage,
    expected,
    observed,
  };
}

function assertionFailures(checks) {
  return Object.entries(checks)
    .filter(([, value]) => value !== true)
    .map(([name, value]) => failedCheck(name, true, value));
}

function buildInitialOutput(argv) {
  return {
    ts: new Date().toISOString(),
    status: "FAIL",
    pass: false,
    exit_code: 1,
    requested_output_mode: argv.includes("--json") ? "json" : "text",
    source_target: null,
    target_root: "[temporary-test-root]",
    checks: {},
    failed_checks: [],
    samples: {},
    stages: [],
    cleanup: {
      temp_removed: true,
      error: null,
    },
    failure: null,
  };
}

function buildFailure(error, env, redactedPaths) {
  if (error instanceof StageExecutionError) {
    return {
      kind: "child-stage",
      message: boundedDiagnostic(error.message, env, redactedPaths),
      stage: error.stageDiagnostic.stage,
      child: error.stageDiagnostic,
    };
  }
  return {
    kind: "fixture-execution",
    message: boundedDiagnostic(error?.message ?? error, env, redactedPaths),
    stage: "fixture-execution",
  };
}

function failureSummary(output) {
  const names = output.failed_checks
    .slice(0, 20)
    .map((item) => item.name)
    .join(",");
  const stage = output.failure?.stage
    ?? output.failed_checks[0]?.stage
    ?? "unknown";
  return boundedDiagnostic(
    `ERROR: Codex context repair fixture failed; stage=${stage}; `
    + `failed_checks=${names || "unknown"}; exit_code=${output.exit_code}; `
    + `cleanup.temp_removed=${output.cleanup.temp_removed}`,
  );
}

export function main(argv = process.argv.slice(2)) {
  let tempRoot = "";
  let adapterFile = "";
  let args = {
    target: "tests/fixtures/perf-structure/session-rich",
    json: argv.includes("--json"),
    testFailCheck: "",
  };
  const output = buildInitialOutput(argv);
  const stageDiagnostics = [];
  let primaryError = null;
  let cleanupError = null;
  let semanticChecksBuilt = false;
  let redactedPaths = [];

  try {
    args = parseArgs(argv);
    const sourceTarget = path.resolve(REPO_ROOT, args.target);
    output.source_target = repoTargetLabel(sourceTarget);
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aidn-codex-context-repair-"));
    const target = path.join(tempRoot, "repo");
    redactedPaths = [tempRoot, target];
    const installerPrerequisiteStub = makeInstallerPrerequisiteStub(tempRoot);
    const pathSeparator = process.platform === "win32" ? ";" : ":";
    fs.cpSync(sourceTarget, target, { recursive: true });
    fs.rmSync(path.join(target, ".aidn"), { recursive: true, force: true });
    adapterFile = writeAdapterFile(tempRoot);

    const installRun = runNoJsonStage(
      "install-core",
      "tools/install.mjs",
      [
        "--target",
        target,
        "--pack",
        "core",
        "--adapter-file",
        adapterFile,
        "--force-agents-merge",
      ],
      {
        PATH: `${installerPrerequisiteStub}${pathSeparator}${String(process.env.PATH ?? "")}`,
      },
      { redactedPaths },
    );
    stageDiagnostics.push(publicStageSummary(installRun.process));

    const indexRun = runJsonStage(
      "index-sync",
      "tools/perf/index-sync.mjs",
      [
        "--target",
        target,
        "--store",
        "sqlite",
        "--json",
      ],
      {},
      { redactedPaths },
    );
    stageDiagnostics.push(publicStageSummary(indexRun.process));

    const env = {
      AIDN_STATE_MODE: "db-only",
      AIDN_INDEX_STORE_MODE: "sqlite",
    };

    const hookRun = runJsonStage(
      "close-session-hook",
      "tools/codex/run-json-hook.mjs",
      [
        "--skill",
        "close-session",
        "--mode",
        "COMMITTING",
        "--target",
        target,
        "--state-mode",
        "db-only",
        "--no-auto-skip-gate",
        "--verbose",
        "--json",
      ],
      env,
      {
        expectedStatuses: [1],
        redactedPaths,
      },
    );
    stageDiagnostics.push(publicStageSummary(hookRun.process));
    const hookOutput = hookRun.payload;

    const contextFile = String(
      hookOutput?.context_file
      ?? path.resolve(target, ".aidn/runtime/context/codex-context.json"),
    );
    const stored = readJson(contextFile);
    const latestEntry = stored?.latest?.["close-session"] ?? {};

    const hydrateRun = runJsonStage(
      "hydrate-context",
      "tools/codex/hydrate-context.mjs",
      [
        "--target",
        target,
        "--index-file",
        ".aidn/runtime/index/workflow-index.sqlite",
        "--backend",
        "sqlite",
        "--skill",
        "close-session",
        "--materialize-visible-artifacts",
        "--json",
      ],
      env,
      { redactedPaths },
    );
    stageDiagnostics.push(publicStageSummary(hydrateRun.process));
    const hydrated = hydrateRun.payload;
    const runtimeStateFile = path.join(target, "docs", "audit", "RUNTIME-STATE.md");
    const runtimeStateText = fs.existsSync(runtimeStateFile)
      ? fs.readFileSync(runtimeStateFile, "utf8")
      : "";

    const decision = hydrated?.decisions?.["close-session"] ?? {};
    const recentHistory = Array.isArray(hydrated?.recent_history) ? hydrated.recent_history : [];
    const closeHistory = recentHistory.filter(
      (entry) => String(entry?.skill ?? "") === "close-session",
    );
    const latestHistory = closeHistory[closeHistory.length - 1] ?? {};
    const decisionTopFinding = decision?.repair_layer_top_findings?.[0] ?? null;
    const decisionTopFindingText = formatRepairFinding(decisionTopFinding);

    const checks = {
      hook_process_contract_status_one: hookRun.process.status === 1,
      hook_output_contract_block_expected: hookOutput?.ok === false
        && hookOutput?.strict === true
        && String(hookOutput?.action ?? "").startsWith("blocked_")
        && hookOutput?.result === "stop",
      hook_internal_command_status_success: hookOutput?.command_status === 0,
      hook_internal_error_absent: hookOutput?.error == null,
      hook_db_sync_error_absent: hookOutput?.db_sync?.error == null,
      hook_db_sync_payload_ok: hookOutput?.db_sync?.payload?.ok === true,
      hook_output_db_sync_enabled: hookOutput?.db_sync?.enabled === true,
      hook_output_open_count_present: Number(hookOutput?.repair_layer_open_count ?? 0) >= 1,
      hook_output_matches_db_sync_summary: Number(hookOutput?.repair_layer_open_count ?? -1)
        === Number(resolveDbSyncOpenCount(hookOutput) ?? -2),
      context_latest_open_count_present: Number(latestEntry?.repair_layer_open_count ?? 0) >= 1,
      context_latest_status_present: ["warn", "block"].includes(
        String(latestEntry?.repair_layer_status ?? ""),
      ),
      context_latest_advice_present: String(latestEntry?.repair_layer_advice ?? "").length >= 1,
      context_latest_primary_reason_present: String(
        latestEntry?.repair_primary_reason ?? "",
      ).length >= 1,
      context_latest_top_findings_present: Array.isArray(
        latestEntry?.repair_layer_top_findings,
      ) && latestEntry.repair_layer_top_findings.length >= 1,
      hydrate_decision_open_count_present: Number(decision?.repair_layer_open_count ?? 0) >= 1,
      hydrate_decision_status_present: ["warn", "block"].includes(
        String(decision?.repair_layer_status ?? ""),
      ),
      hydrate_decision_advice_present: String(decision?.repair_layer_advice ?? "").length >= 1,
      hydrate_decision_primary_reason_present: String(
        decision?.repair_primary_reason ?? "",
      ).length >= 1,
      hydrate_decision_top_findings_present: Array.isArray(
        decision?.repair_layer_top_findings,
      ) && decision.repair_layer_top_findings.length >= 1,
      hydrate_history_open_count_present: Number(
        latestHistory?.repair_layer_open_count ?? 0,
      ) >= 1,
      hydrate_requested_skill_matches_decision: hydrated?.requested_skill === "close-session",
      parity_context_hydrate_count: Number(latestEntry?.repair_layer_open_count ?? -1)
        === Number(decision?.repair_layer_open_count ?? -2),
      hydrate_runtime_state_present: hydrated?.runtime_state
        && typeof hydrated.runtime_state === "object",
      hydrate_runtime_state_status_present: ["clean", "warn", "block"].includes(
        String(hydrated?.runtime_state?.digest?.repair_layer_status ?? ""),
      ),
      hydrate_runtime_state_matches_decision: String(
        hydrated?.runtime_state?.digest?.repair_layer_status ?? "",
      ) === String(decision?.repair_layer_status ?? ""),
      hydrate_runtime_state_advice_matches_decision: String(
        hydrated?.runtime_state?.digest?.repair_layer_advice ?? "",
      ) === String(decision?.repair_layer_advice ?? ""),
      hydrate_runtime_state_primary_reason_matches_decision: String(
        hydrated?.runtime_state?.digest?.repair_primary_reason ?? "",
      ) === String(decision?.repair_primary_reason ?? ""),
      hydrate_runtime_state_top_finding_matches_decision: decisionTopFindingText.length > 0
        && String(hydrated?.runtime_state?.digest?.blocking_findings?.[0] ?? "")
          === decisionTopFindingText,
      hydrate_runtime_state_file_written: fs.existsSync(runtimeStateFile),
      hydrate_runtime_state_markdown_mentions_status: runtimeStateText.includes(
        `repair_layer_status: ${String(decision?.repair_layer_status ?? "")}`,
      ),
      hydrate_runtime_state_markdown_mentions_advice: String(
        hydrated?.runtime_state?.digest?.repair_layer_advice ?? "",
      ).length >= 1
        && runtimeStateText.includes(
          `repair_layer_advice: ${String(
            hydrated?.runtime_state?.digest?.repair_layer_advice ?? "",
          )}`,
        ),
      hydrate_runtime_state_markdown_mentions_primary_reason: runtimeStateText.includes(
        `repair_primary_reason: ${String(decision?.repair_primary_reason ?? "")}`,
      ),
      hydrate_runtime_state_markdown_mentions_top_finding: decisionTopFindingText.length > 0
        && runtimeStateText.includes(`- ${decisionTopFindingText}`),
    };

    if (args.testFailCheck) {
      if (!Object.hasOwn(checks, args.testFailCheck)) {
        throw new Error(`Unknown test check injection: ${args.testFailCheck}`);
      }
      checks[args.testFailCheck] = false;
    }

    output.checks = checks;
    output.failed_checks = assertionFailures(checks);
    output.samples = {
      hook_output: {
        outer_status: hookRun.process.status,
        ok: hookOutput?.ok ?? null,
        strict: hookOutput?.strict ?? null,
        action: boundedSample(hookOutput?.action ?? "", env, redactedPaths),
        result: boundedSample(hookOutput?.result ?? "", env, redactedPaths),
        reason_code: boundedSample(hookOutput?.reason_code ?? "", env, redactedPaths),
        command_status: hookOutput?.command_status ?? null,
        internal_error_present: hookOutput?.error != null,
        internal_error: sanitizeProcessError(
          hookOutput?.error,
          env,
          redactedPaths,
        ),
        db_sync_enabled: hookOutput?.db_sync?.enabled === true,
        db_sync_error_present: hookOutput?.db_sync?.error != null,
        db_sync_payload_ok: hookOutput?.db_sync?.payload?.ok ?? null,
        db_sync_payload_message: boundedSample(
          hookOutput?.db_sync?.payload?.message ?? "",
          env,
          redactedPaths,
        ),
        db_sync_error: hookOutput?.db_sync?.error
          ? {
            message: boundedSample(
              hookOutput.db_sync.error.message ?? "",
              env,
              redactedPaths,
            ),
            status: hookOutput.db_sync.error.status ?? null,
            stderr: boundedSample(
              hookOutput.db_sync.error.stderr ?? "",
              env,
              redactedPaths,
            ),
          }
          : null,
        repair_layer_open_count: hookOutput?.repair_layer_open_count ?? null,
        top_finding: sanitizeFinding(
          hookOutput?.repair_layer_top_findings?.[0],
          env,
          redactedPaths,
        ),
      },
      context_latest: {
        repair_layer_open_count: latestEntry?.repair_layer_open_count ?? null,
        repair_layer_status: boundedSample(
          latestEntry?.repair_layer_status ?? "",
          env,
          redactedPaths,
        ),
        repair_primary_reason: boundedSample(
          latestEntry?.repair_primary_reason ?? "",
          env,
          redactedPaths,
        ),
        top_finding: sanitizeFinding(
          latestEntry?.repair_layer_top_findings?.[0],
          env,
          redactedPaths,
        ),
      },
      hydrated_decision: {
        requested_skill: boundedSample(
          hydrated?.requested_skill ?? "",
          env,
          redactedPaths,
        ),
        repair_layer_open_count: decision?.repair_layer_open_count ?? null,
        repair_layer_status: boundedSample(
          decision?.repair_layer_status ?? "",
          env,
          redactedPaths,
        ),
        repair_primary_reason: boundedSample(
          decision?.repair_primary_reason ?? "",
          env,
          redactedPaths,
        ),
        top_finding: sanitizeFinding(
          decision?.repair_layer_top_findings?.[0],
          env,
          redactedPaths,
        ),
      },
      hydrated_runtime_state: {
        output_file_written: fs.existsSync(runtimeStateFile),
        repair_layer_status: boundedSample(
          hydrated?.runtime_state?.digest?.repair_layer_status ?? "",
          env,
          redactedPaths,
        ),
        repair_primary_reason: boundedSample(
          hydrated?.runtime_state?.digest?.repair_primary_reason ?? "",
          env,
          redactedPaths,
        ),
        top_finding: boundedSample(
          hydrated?.runtime_state?.digest?.blocking_findings?.[0] ?? "",
          env,
          redactedPaths,
        ),
      },
    };
    semanticChecksBuilt = true;
    if (output.failed_checks.length > 0) {
      output.failure = {
        kind: "assertion",
        message: "one or more named Codex context repair assertions failed",
        stage: "semantic-assertions",
      };
    }
  } catch (error) {
    primaryError = error;
    output.failure = buildFailure(error, process.env, redactedPaths);
    if (error instanceof StageExecutionError) {
      stageDiagnostics.push(error.stageDiagnostic);
      output.failed_checks = [
        failedCheck(
          `child_stage:${error.stageDiagnostic.stage}`,
          {
            statuses: error.stageDiagnostic.expected_statuses,
            signal: null,
            error_code: null,
          },
          {
            status: error.stageDiagnostic.status,
            signal: error.stageDiagnostic.signal,
            error_code: error.stageDiagnostic.error_code,
            timed_out: error.stageDiagnostic.timed_out,
          },
          error.stageDiagnostic.stage,
        ),
      ];
    } else {
      output.failed_checks = [
        failedCheck(
          "fixture_execution",
          "completed",
          boundedDiagnostic(error?.message ?? error, process.env, redactedPaths),
          "fixture-execution",
        ),
      ];
    }
  } finally {
    if (tempRoot && fs.existsSync(tempRoot)) {
      const cleanup = removePathWithRetry(tempRoot);
      if (!cleanup.ok || fs.existsSync(tempRoot)) {
        cleanupError = cleanup.error ?? new Error("Codex context repair temp root remains");
      }
    }
  }

  output.stages = stageDiagnostics;
  output.cleanup = {
    temp_removed: tempRoot ? !fs.existsSync(tempRoot) : true,
    error: cleanupError
      ? boundedDiagnostic(cleanupError.message ?? cleanupError, process.env, redactedPaths)
      : null,
  };
  if (cleanupError) {
    output.failed_checks.push(
      failedCheck("cleanup.temp_removed", true, output.cleanup.temp_removed, "cleanup"),
    );
    if (!output.failure) {
      output.failure = {
        kind: "cleanup",
        message: output.cleanup.error,
        stage: "cleanup",
      };
    }
  }

  output.pass = !primaryError
    && semanticChecksBuilt
    && output.failed_checks.length === 0
    && output.cleanup.temp_removed;
  output.status = output.pass ? "PASS" : "FAIL";
  output.exit_code = output.pass ? 0 : 1;

  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
  if (!output.pass) {
    process.stderr.write(`${failureSummary(output)}\n`);
    process.exitCode = 1;
  }
  return output;
}

const invokedAsMain = process.argv[1]
  && path.resolve(process.argv[1]) === path.resolve(CURRENT_FILE);
if (invokedAsMain) {
  main();
}
