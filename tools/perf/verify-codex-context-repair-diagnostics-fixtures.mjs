#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  runJsonStage,
  StageExecutionError,
} from "./verify-codex-context-repair-layer-fixtures.mjs";
import { removePathWithRetry } from "./test-git-fixture-lib.mjs";
import {
  formatGateFamilySummary,
  runGateFamily,
} from "../verify/gate-runner-lib.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const DIRECT_FIXTURE = path.join(
  REPO_ROOT,
  "tools",
  "perf",
  "verify-codex-context-repair-layer-fixtures.mjs",
);
const FORCED_CHECK = "hydrate_runtime_state_matches_decision";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function runNode(file, args, env = {}) {
  return spawnSync(process.execPath, [file, ...args], {
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      ...env,
    },
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 180000,
    maxBuffer: 20 * 1024 * 1024,
    windowsHide: true,
  });
}

function captureStageFailure(callback, label) {
  try {
    callback();
  } catch (error) {
    assert(error instanceof StageExecutionError, `${label} must preserve StageExecutionError`);
    return error.stageDiagnostic;
  }
  throw new Error(`${label} unexpectedly passed`);
}

function syntheticCatalog() {
  return {
    schema_version: 2,
    required_families: ["synthetic"],
    outcomes: ["PASS", "FAIL", "SKIP"],
    gates: [{
      id: "codex-context-diagnostic-mutant",
      family: "synthetic",
      script: "fixture:codex-context-mutant",
      job: "fixture/codex-context",
      surfaces: ["Codex context diagnostic propagation"],
      condition: "always",
      obligation: {
        dev: "required",
        main: "required",
        release: "required",
      },
    }],
  };
}

function main() {
  let tempRoot = "";
  let cleanup = null;
  let primaryError = null;
  let output = null;
  try {
    const direct = runNode(DIRECT_FIXTURE, [
      "--json",
      "--test-fail-check",
      FORCED_CHECK,
    ]);
    assert(direct.status === 1, "forced named assertion must exit 1");
    assert(direct.signal == null, "forced named assertion must return without a signal");
    const directStdout = String(direct.stdout ?? "");
    const directStderr = String(direct.stderr ?? "");
    const directPayload = JSON.parse(directStdout.trim());
    const namedFailure = directPayload.failed_checks?.find(
      (item) => item?.name === FORCED_CHECK,
    );
    assert(directPayload.pass === false, "forced named assertion must preserve pass=false");
    assert(directPayload.status === "FAIL", "forced named assertion must preserve FAIL status");
    assert(directPayload.exit_code === 1, "forced named assertion must preserve exit_code=1");
    assert(
      directPayload.checks?.[FORCED_CHECK] === false,
      "forced named assertion must preserve the observed false check value",
    );
    assert(
      namedFailure?.expected === true && namedFailure?.observed === false,
      "forced named assertion must preserve expected and observed values",
    );
    assert(
      directPayload.cleanup?.temp_removed === true,
      "forced named assertion must preserve successful cleanup",
    );
    assert(
      directStderr.includes(FORCED_CHECK),
      "bounded stderr summary must name the failed assertion",
    );
    assert(!directStderr.includes("Usage:"), "assertion failure must not print usage");
    assert(
      !directStdout.includes(REPO_ROOT) && !directStdout.includes(os.tmpdir()),
      "structured samples must not expose repository or temporary absolute paths",
    );

    const family = runGateFamily({
      repoRoot: REPO_ROOT,
      catalog: syntheticCatalog(),
      packageJson: {
        scripts: {
          "fixture:codex-context-mutant": "node fixture",
        },
      },
      requested: "synthetic",
      context: "dev",
      env: process.env,
      json: true,
      commandRunner() {
        return direct;
      },
    });
    const familyResult = family.results[0];
    assert(!family.ok && familyResult.status === "FAIL", "family must preserve the gate failure");
    assert(familyResult.exit_code === 1, "family JSON must preserve exit code 1");
    assert(familyResult.signal == null, "family JSON must preserve a null signal");
    assert(
      familyResult.stdout_tail.includes(FORCED_CHECK)
      && familyResult.stderr_tail.includes(FORCED_CHECK),
      "family JSON must preserve named stdout/stderr diagnostics",
    );
    assert(
      JSON.parse(familyResult.stdout_tail.trim()).pass === false,
      "family stdout tail must preserve the complete structured failure document",
    );
    JSON.parse(JSON.stringify(family));
    const familySummary = formatGateFamilySummary(family);
    assert(
      familySummary.includes("process=exit=1 signal=null"),
      "family text summary must preserve exit code and signal",
    );
    assert(
      familySummary.includes("stdout_tail=")
      && familySummary.includes("stderr_tail=")
      && familySummary.includes(FORCED_CHECK),
      "family text summary must preserve the bounded named tails",
    );

    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aidn-codex-context-diagnostics-"));
    const unexpectedFile = path.join(tempRoot, "unexpected-status.mjs");
    const invalidJsonFile = path.join(tempRoot, "invalid-json.mjs");
    const timeoutFile = path.join(tempRoot, "timeout.mjs");
    const configuredSecret = "postgresql://fixture:secret@localhost/db";
    fs.writeFileSync(
      unexpectedFile,
      [
        "process.stdout.write(JSON.stringify({ ok: false, marker: 'unexpected-status' }) + '\\n');",
        `process.stderr.write(${JSON.stringify(configuredSecret)} + "\\n");`,
        "process.exitCode = 7;",
        "",
      ].join("\n"),
      "utf8",
    );
    fs.writeFileSync(
      invalidJsonFile,
      "process.stdout.write('prefix {\"ok\":true} suffix\\n');\n",
      "utf8",
    );
    fs.writeFileSync(
      timeoutFile,
      [
        "process.stdout.write('timeout-stage-started\\n');",
        "setInterval(() => {}, 1000);",
        "",
      ].join("\n"),
      "utf8",
    );

    const unexpected = captureStageFailure(
      () => runJsonStage(
        "unexpected-status-mutant",
        unexpectedFile,
        [],
        { AIDN_PG_SMOKE_URL: configuredSecret },
        { timeoutMs: 5000, redactedPaths: [tempRoot] },
      ),
      "unexpected status mutant",
    );
    assert(unexpected.status === 7, "unexpected status mutant must preserve status 7");
    assert(unexpected.signal == null, "unexpected status mutant must preserve null signal");
    assert(
      unexpected.failure_code === "AIDN_CHILD_UNEXPECTED_STATUS",
      "unexpected status mutant must preserve its failure classification",
    );
    assert(
      unexpected.stdout_tail.includes("unexpected-status"),
      "unexpected status mutant must preserve bounded stdout",
    );
    assert(
      unexpected.stderr_tail.includes("[redacted]")
      && !unexpected.stderr_tail.includes("fixture:secret"),
      "unexpected status mutant must redact configured secrets",
    );

    const invalidJson = captureStageFailure(
      () => runJsonStage(
        "invalid-json-mutant",
        invalidJsonFile,
        [],
        {},
        { timeoutMs: 5000, redactedPaths: [tempRoot] },
      ),
      "invalid JSON mutant",
    );
    assert(invalidJson.status === 0, "invalid JSON mutant must preserve status 0");
    assert(
      invalidJson.failure_code === "AIDN_CHILD_JSON_INVALID",
      "invalid JSON mutant must preserve its failure classification",
    );
    assert(
      invalidJson.stdout_tail.includes("prefix")
      && invalidJson.stdout_tail.includes("suffix")
      && invalidJson.parse_error,
      "invalid JSON mutant must preserve stdout and parse error diagnostics",
    );

    const timeout = captureStageFailure(
      () => runJsonStage(
        "timeout-mutant",
        timeoutFile,
        [],
        {},
        { timeoutMs: 100, redactedPaths: [tempRoot] },
      ),
      "timeout mutant",
    );
    assert(timeout.status == null, "timeout mutant must preserve null exit status");
    assert(timeout.error_code === "ETIMEDOUT", "timeout mutant must preserve ETIMEDOUT");
    assert(timeout.timed_out === true, "timeout mutant must preserve timed_out=true");
    assert(Object.hasOwn(timeout, "signal"), "timeout mutant must preserve the signal field");
    assert(
      typeof timeout.stdout_tail === "string" && typeof timeout.stderr_tail === "string",
      "timeout mutant must preserve bounded stdout/stderr tail fields even when empty",
    );

    output = {
      status: "PASS",
      direct_named_assertion: {
        name: FORCED_CHECK,
        exit_code: direct.status,
        pass: directPayload.pass,
        expected: namedFailure.expected,
        observed: namedFailure.observed,
        cleanup_temp_removed: directPayload.cleanup.temp_removed,
        stdout_is_complete_json: true,
        stderr_names_assertion: true,
        usage_omitted: true,
      },
      family_propagation: {
        exit_code: familyResult.exit_code,
        signal: familyResult.signal,
        stdout_tail_preserved: true,
        stderr_tail_preserved: true,
        text_summary_preserved: true,
        json_summary_preserved: true,
      },
      child_stage_mutants: {
        unexpected_status: {
          stage: unexpected.stage,
          status: unexpected.status,
          signal: unexpected.signal,
          redacted_tails: true,
        },
        invalid_json: {
          stage: invalidJson.stage,
          status: invalidJson.status,
          failure_code: invalidJson.failure_code,
          parse_error_preserved: true,
        },
        timeout: {
          stage: timeout.stage,
          status: timeout.status,
          signal: timeout.signal,
          error_code: timeout.error_code,
          timed_out: timeout.timed_out,
          output_tail_fields_preserved: true,
        },
      },
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
  assert(cleanup?.ok && !fs.existsSync(tempRoot), "diagnostic mutant temp root must be removed");
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
