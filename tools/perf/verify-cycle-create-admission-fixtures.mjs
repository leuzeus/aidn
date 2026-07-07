#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { runCycleCreateAdmitUseCase } from "../../src/application/runtime/cycle-create-admit-use-case.mjs";
import { copyFixtureToTmp, initGitRepo, removePathWithRetry } from "./test-git-fixture-lib.mjs";

const CASES = [
  {
    id: "source_branch_requires_choice",
    fixture: "tests/fixtures/perf-structure/session-multi-cycle-explicit",
    workingBranch: "main",
    mutate(targetRoot) {
      const configDir = path.join(targetRoot, ".aidn");
      fs.mkdirSync(configDir, { recursive: true });
      fs.writeFileSync(path.join(configDir, "config.json"), `${JSON.stringify({
        version: 1,
        profile: "dual",
        install: {
          artifactImportStore: "dual-sqlite",
        },
        runtime: {
          stateMode: "dual",
        },
        workflow: {
          sourceBranch: "main",
        },
      }, null, 2)}\n`, "utf8");
    },
    expectedAction: "stop_choose_continuity_rule",
    expectedResult: "stop",
    expectsCheckpoint: false,
  },
  {
    id: "session_branch_allows_r2",
    fixture: "tests/fixtures/perf-structure/session-multi-cycle-explicit",
    workingBranch: "S103-multi",
    mutate(targetRoot) {
      const configDir = path.join(targetRoot, ".aidn");
      fs.mkdirSync(configDir, { recursive: true });
      fs.writeFileSync(path.join(configDir, "config.json"), `${JSON.stringify({
        version: 1,
        profile: "dual",
        install: {
          artifactImportStore: "dual-sqlite",
        },
        runtime: {
          stateMode: "dual",
        },
        workflow: {
          sourceBranch: "main",
        },
      }, null, 2)}\n`, "utf8");
    },
    expectedAction: "proceed_r2_session_base_with_import",
    expectedResult: "ok",
    expectsCheckpoint: true,
  },
  {
    id: "latest_cycle_allows_r1",
    fixture: "tests/fixtures/perf-structure/session-multi-cycle-explicit",
    workingBranch: "feature/C104-delta",
    mutate(targetRoot) {
      const configDir = path.join(targetRoot, ".aidn");
      fs.mkdirSync(configDir, { recursive: true });
      fs.writeFileSync(path.join(configDir, "config.json"), `${JSON.stringify({
        version: 1,
        profile: "dual",
        install: {
          artifactImportStore: "dual-sqlite",
        },
        runtime: {
          stateMode: "dual",
        },
        workflow: {
          sourceBranch: "main",
        },
      }, null, 2)}\n`, "utf8");
    },
    expectedAction: "proceed_r1_strict_chain",
    expectedResult: "ok",
    expectsCheckpoint: true,
  },
  {
    id: "promoted_backlog_requires_scope_selection",
    fixture: "tests/fixtures/perf-structure/session-multi-cycle-explicit",
    workingBranch: "S103-multi",
    mutate(targetRoot) {
      writeDualConfig(targetRoot);
      installSharedPlanningFixture(targetRoot, { selectedExecutionScope: "none" });
    },
    expectedAction: "stop_select_execution_scope",
    expectedResult: "stop",
    expectsCheckpoint: false,
  },
  {
    id: "promoted_backlog_new_cycle_scope_allows_r2",
    fixture: "tests/fixtures/perf-structure/session-multi-cycle-explicit",
    workingBranch: "S103-multi",
    mutate(targetRoot) {
      writeDualConfig(targetRoot);
      installSharedPlanningFixture(targetRoot, { selectedExecutionScope: "new_cycle" });
    },
    expectedAction: "proceed_r2_session_base_with_import",
    expectedResult: "ok",
    expectsCheckpoint: true,
  },
];

const CANONICAL_CASES = [
  {
    id: "db_only_canonical_cycle_allows_r1",
    workingBranch: "feature/C104-delta",
    snapshotAvailable: true,
    expectedAction: "proceed_r1_strict_chain",
    expectedReasonCode: null,
    expectedActiveSession: "S103",
    expectedActiveCycle: "C104",
    expectedContinuityStatus: "resolved",
  },
  {
    id: "files_mode_configured_postgres_stays_canonical",
    workingBranch: "feature/C104-delta",
    configuredStateMode: "files",
    snapshotAvailable: true,
    expectedAction: "proceed_r1_strict_chain",
    expectedReasonCode: null,
    expectedActiveSession: "S103",
    expectedActiveCycle: "C104",
    expectedContinuityStatus: "resolved",
  },
  {
    id: "db_only_unregistered_cycle_is_explicit",
    workingBranch: "feature/C105-unregistered",
    snapshotAvailable: true,
    expectedAction: "stop_choose_continuity_rule",
    expectedReasonCode: "CYCLE_CREATE_CONTINUITY_CHOICE_REQUIRED",
    expectedActiveSession: "S103",
    expectedActiveCycle: "C104",
    expectedContinuityStatus: "resolved",
    expectedWarningContains: "must be treated as an explicit continuity choice",
  },
  {
    id: "db_only_ambiguous_canonical_continuity_blocks",
    workingBranch: "main",
    snapshotAvailable: true,
    ambiguousSnapshot: true,
    expectedAction: "stop_repair_canonical_continuity",
    expectedReasonCode: "CYCLE_CREATE_CANONICAL_CONTINUITY_AMBIGUOUS",
    expectedActiveSession: "none",
    expectedActiveCycle: "none",
    expectedContinuityStatus: "ambiguous",
  },
  {
    id: "db_only_canonical_runtime_unavailable_blocks",
    workingBranch: "main",
    snapshotAvailable: false,
    expectedAction: "stop_repair_canonical_runtime",
    expectedReasonCode: "CYCLE_CREATE_CANONICAL_RUNTIME_UNAVAILABLE",
    expectedActiveSession: "none",
    expectedActiveCycle: "none",
    expectedContinuityStatus: "unavailable",
  },
];

function writeDualConfig(targetRoot) {
  const configDir = path.join(targetRoot, ".aidn");
  fs.mkdirSync(configDir, { recursive: true });
  fs.writeFileSync(path.join(configDir, "config.json"), `${JSON.stringify({
    version: 1,
    profile: "dual",
    install: {
      artifactImportStore: "dual-sqlite",
    },
    runtime: {
      stateMode: "dual",
    },
    workflow: {
      sourceBranch: "main",
    },
  }, null, 2)}\n`, "utf8");
}

function writePostgresConfig(targetRoot, stateMode = "db-only") {
  const configDir = path.join(targetRoot, ".aidn");
  fs.mkdirSync(configDir, { recursive: true });
  fs.writeFileSync(path.join(configDir, "config.json"), `${JSON.stringify({
    version: 1,
    profile: stateMode,
    runtime: {
      stateMode,
      persistence: {
        backend: "postgres",
        localProjectionPolicy: "none",
        connectionRef: "env:AIDN_PG_URL",
      },
    },
    workflow: {
      sourceBranch: "main",
    },
  }, null, 2)}\n`, "utf8");
}

function installFilelessVisibleState(targetRoot) {
  const auditRoot = path.join(targetRoot, "docs", "audit");
  fs.rmSync(path.join(auditRoot, "sessions"), { recursive: true, force: true });
  fs.rmSync(path.join(auditRoot, "cycles"), { recursive: true, force: true });
  fs.mkdirSync(auditRoot, { recursive: true });
  fs.writeFileSync(path.join(auditRoot, "CURRENT-STATE.md"), [
    "# Current State",
    "",
    "active_session: none",
    "session_branch: none",
    "branch_kind: unknown",
    "mode: unknown",
    "active_cycle: none",
    "cycle_branch: none",
    "dor_state: unknown",
    "",
  ].join("\n"), "utf8");
}

function createCanonicalRuntimePayload({ ambiguous = false } = {}) {
  const payload = {
    schema_version: 2,
    generated_at: "2026-06-04T00:00:00.000Z",
    sessions: [
      {
        session_id: "S103",
        branch_name: "S103-multi",
        state: "COMMITTING",
        branch_kind: "session",
        integration_target_cycle: "C104",
        source_artifact_path: "sessions/S103.md",
        updated_at: "2026-06-04T00:01:00.000Z",
      },
    ],
    cycles: [
      {
        cycle_id: "C103",
        session_id: "S103",
        state: "DONE",
        outcome: "DONE",
        branch_name: "feature/C103-gamma",
        dor_state: "READY",
        updated_at: "2026-06-03T00:00:00.000Z",
      },
      {
        cycle_id: "C104",
        session_id: "S103",
        state: "IMPLEMENTING",
        outcome: "ACTIVE",
        branch_name: "feature/C104-delta",
        dor_state: "READY",
        continuity_rule: "R1_STRICT_CHAIN",
        continuity_base_branch: "feature/C103-gamma",
        updated_at: "2026-06-04T00:02:00.000Z",
      },
    ],
    artifacts: [
      {
        path: "CURRENT-STATE.md",
        subtype: "current_state",
        content_format: "utf8",
        content: [
          "# Current State",
          "",
          "active_session: none",
          "active_cycle: none",
          "mode: unknown",
          "",
        ].join("\n"),
      },
    ],
  };
  if (ambiguous) {
    payload.cycles[1].state = "DONE";
    payload.cycles[1].outcome = "DONE";
    payload.sessions.push({
      session_id: "S104",
      branch_name: "S104-ambiguous",
      state: "COMMITTING",
      branch_kind: "session",
      integration_target_cycle: null,
      source_artifact_path: "sessions/S104.md",
      updated_at: "2026-06-04T00:03:00.000Z",
    });
  }
  return payload;
}

function createCanonicalRuntimeReaderFactory({ available, ambiguous = false }) {
  return () => ({
    describeBackend() {
      return {
        backend_kind: "postgres",
        scope: "runtime-artifact-persistence",
      };
    },
    async readCanonicalSnapshot() {
      return available
        ? {
            exists: true,
            payload: createCanonicalRuntimePayload({ ambiguous }),
            runtimeHeads: {
              current_state: {
                artifact_path: "CURRENT-STATE.md",
              },
            },
            warning: "",
          }
        : {
            exists: false,
            payload: null,
            runtimeHeads: {},
            warning: "fixture canonical postgres runtime unavailable",
          };
    },
  });
}

function installSharedPlanningFixture(targetRoot, { selectedExecutionScope = "none" } = {}) {
  const currentStateFile = path.join(targetRoot, "docs", "audit", "CURRENT-STATE.md");
  const currentStateText = fs.existsSync(currentStateFile)
    ? fs.readFileSync(currentStateFile, "utf8")
    : [
      "# Current State",
      "",
      "## Summary",
      "",
      "updated_at: 2026-03-09T01:05:00Z",
      "structure_profile: modern",
      "runtime_state_mode: dual",
      "repair_layer_status: ok",
      "",
      "## Active Context",
      "",
      "active_session: S103",
      "session_branch: S103-multi",
      "branch_kind: session",
      "mode: COMMITTING",
      "",
      "active_cycle: C104",
      "cycle_branch: feature/C104-delta",
      "dor_state: READY",
      "first_plan_step: select the first cycle scope",
      "",
    ].join("\n");
  const nextCurrentState = currentStateText.includes("active_backlog:")
    ? currentStateText
      .replace(/active_backlog:\s*.+/g, "active_backlog: backlog/BL-S103-session-planning.md")
      .replace(/backlog_status:\s*.+/g, "backlog_status: promoted")
      .replace(/backlog_next_step:\s*.+/g, "backlog_next_step: select the first cycle scope")
      .replace(/backlog_selected_execution_scope:\s*.+/g, `backlog_selected_execution_scope: ${selectedExecutionScope}`)
      .replace(/planning_arbitration_status:\s*.+/g, "planning_arbitration_status: none")
    : currentStateText.replace(
      "first_plan_step: select the first cycle scope",
      [
        "first_plan_step: select the first cycle scope",
        "active_backlog: backlog/BL-S103-session-planning.md",
        "backlog_status: promoted",
        "backlog_next_step: select the first cycle scope",
        `backlog_selected_execution_scope: ${selectedExecutionScope}`,
        "planning_arbitration_status: none",
      ].join("\n"),
    );
  fs.mkdirSync(path.dirname(currentStateFile), { recursive: true });
  fs.writeFileSync(currentStateFile, `${nextCurrentState.replace(/\n+$/u, "")}\n`, "utf8");
  const backlogDir = path.join(targetRoot, "docs", "audit", "backlog");
  fs.mkdirSync(backlogDir, { recursive: true });
  fs.writeFileSync(path.join(backlogDir, "BL-S103-session-planning.md"), [
    "# Session Backlog - S103",
    "",
    "## Summary",
    "",
    "updated_at: 2026-03-09T01:10:00Z",
    "session_id: S103",
    "session_branch: S103-multi",
    "mode: COMMITTING",
    "planning_status: promoted",
    "linked_cycles: C103, C104",
    "dispatch_ready: yes",
    "planning_arbitration_status: none",
    "next_dispatch_scope: cycle",
    "next_dispatch_action: implement",
    "backlog_next_step: select the first cycle scope",
    `selected_execution_scope: ${selectedExecutionScope}`,
    "",
  ].join("\n"), "utf8");
}

function parseArgs(argv) {
  const args = {
    tmpRoot: "tests/fixtures",
    keepTmp: false,
    json: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--tmp-root") {
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
  return args;
}

function printUsage() {
  console.log("Usage:");
  console.log("  node tools/perf/verify-cycle-create-admission-fixtures.mjs");
}

function runJson(script, scriptArgs, env = {}) {
  const file = path.resolve(process.cwd(), script);
  try {
    const stdout = execFileSync(process.execPath, [file, ...scriptArgs], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        ...env,
      },
    });
    return JSON.parse(stdout);
  } catch (error) {
    const stdout = String(error?.stdout ?? "").trim();
    if (stdout) {
      return JSON.parse(stdout);
    }
    throw error;
  }
}

function runCase(tmpRoot, testCase) {
  const sourceTarget = path.resolve(process.cwd(), testCase.fixture);
  const targetRoot = copyFixtureToTmp(sourceTarget, tmpRoot, `tmp-cycle-create-${testCase.id}`);
  if (typeof testCase.mutate === "function") {
    testCase.mutate(targetRoot);
  }
  initGitRepo(targetRoot, {
    workingBranch: testCase.workingBranch,
  });

  const hook = runJson("tools/perf/cycle-create-hook.mjs", [
    "--target",
    targetRoot,
    "--mode",
    "COMMITTING",
    "--json",
  ]);
  const codex = runJson("tools/codex/run-json-hook.mjs", [
    "--skill",
    "cycle-create",
    "--target",
    targetRoot,
    "--mode",
    "COMMITTING",
    "--json",
  ]);
  const codexAction = codex?.action ?? codex?.normalized?.action ?? null;
  const codexResult = codex?.result ?? codex?.normalized?.result ?? null;

  const checks = {
    hook_action_expected: String(hook?.action ?? "") === testCase.expectedAction,
    hook_result_expected: String(hook?.result ?? "") === testCase.expectedResult,
    hook_checkpoint_expected: Boolean(hook?.checkpoint) === testCase.expectsCheckpoint,
    hook_state_mode_expected: hook?.state_mode === "dual",
    hook_admission_state_mode_expected: hook?.admission?.state_mode === "dual",
    hook_checkpoint_state_mode_expected: hook?.checkpoint ? hook.checkpoint.state_mode === "dual" : true,
    hook_workspace_present: String(hook?.workspace?.workspace_id ?? "").length > 0,
    hook_worktree_present: String(hook?.workspace?.worktree_id ?? "").length > 0,
    codex_action_expected: String(codexAction ?? "") === testCase.expectedAction,
    codex_result_expected: String(codexResult ?? "") === testCase.expectedResult,
  };
  return {
    id: testCase.id,
    source_target: sourceTarget,
    target_root: targetRoot,
    checks,
    sample: {
      hook_action: hook?.action ?? null,
      hook_result: hook?.result ?? null,
      hook_checkpoint_ran: Boolean(hook?.checkpoint),
      hook_state_mode: hook?.state_mode ?? null,
      hook_checkpoint_state_mode: hook?.checkpoint?.state_mode ?? null,
      hook_workspace_id: hook?.workspace?.workspace_id ?? null,
      hook_is_linked_worktree: hook?.workspace?.is_linked_worktree ?? null,
      codex_action: codexAction,
      codex_result: codexResult,
      codex_ok: codex?.ok ?? null,
    },
    pass: Object.values(checks).every((value) => value === true),
  };
}

async function runCanonicalCase(tmpRoot, testCase) {
  const sourceTarget = path.resolve(process.cwd(), "tests/fixtures/perf-structure/session-multi-cycle-explicit");
  const targetRoot = copyFixtureToTmp(sourceTarget, tmpRoot, `tmp-cycle-create-${testCase.id}`);
  writePostgresConfig(targetRoot, testCase.configuredStateMode ?? "db-only");
  installFilelessVisibleState(targetRoot);
  initGitRepo(targetRoot, {
    workingBranch: testCase.workingBranch,
  });
  const admission = await runCycleCreateAdmitUseCase({
    targetRoot,
    mode: "COMMITTING",
    runtimeSnapshotReaderFactory: createCanonicalRuntimeReaderFactory({
      available: testCase.snapshotAvailable,
      ambiguous: testCase.ambiguousSnapshot === true,
    }),
  });
  const checks = {
    action_expected: admission.action === testCase.expectedAction,
    reason_code_expected: (admission.reason_code ?? null) === testCase.expectedReasonCode,
    active_session_expected: admission.active_session === testCase.expectedActiveSession,
    active_cycle_expected: admission.active_cycle === testCase.expectedActiveCycle,
    canonical_source_expected: testCase.snapshotAvailable
      ? admission.continuity_context_source === "runtime-canonical-postgres"
      : admission.continuity_context_source === "visible-files-fallback",
    canonical_backend_expected: admission.continuity_context_backend === "postgres",
    canonical_required: admission.canonical_runtime_required === true,
    canonical_available_expected: admission.canonical_runtime_available === testCase.snapshotAvailable,
    canonical_continuity_status_expected: admission.canonical_continuity_status === testCase.expectedContinuityStatus,
    canonical_ambiguity_expected: testCase.expectedContinuityStatus === "ambiguous"
      ? admission.canonical_continuity_ambiguities.length > 0
      : admission.canonical_continuity_ambiguities.length === 0,
    warning_expected: testCase.expectedWarningContains
      ? admission.warnings.some((item) => String(item).includes(testCase.expectedWarningContains))
      : true,
  };
  return {
    id: testCase.id,
    source_target: sourceTarget,
    target_root: targetRoot,
    checks,
    sample: {
      action: admission.action,
      reason_code: admission.reason_code,
      active_session: admission.active_session,
      active_cycle: admission.active_cycle,
      continuity_context_source: admission.continuity_context_source,
      continuity_context_backend: admission.continuity_context_backend,
      canonical_continuity_status: admission.canonical_continuity_status,
      canonical_continuity_ambiguities: admission.canonical_continuity_ambiguities,
    },
    pass: Object.values(checks).every((value) => value === true),
  };
}

async function main() {
  const createdTargets = [];
  try {
    const args = parseArgs(process.argv.slice(2));
    const tmpRoot = path.resolve(process.cwd(), args.tmpRoot);
    const fileRuns = CASES.map((testCase) => {
      const run = runCase(tmpRoot, testCase);
      createdTargets.push(run.target_root);
      return run;
    });
    const canonicalRuns = [];
    for (const testCase of CANONICAL_CASES) {
      const run = await runCanonicalCase(tmpRoot, testCase);
      createdTargets.push(run.target_root);
      canonicalRuns.push(run);
    }
    const runs = [...fileRuns, ...canonicalRuns];
    const pass = runs.every((run) => run.pass === true);
    const output = {
      ts: new Date().toISOString(),
      runs,
      pass,
    };

    if (args.json) {
      console.log(JSON.stringify(output, null, 2));
    } else {
      for (const run of runs) {
        console.log(`${run.pass ? "PASS" : "FAIL"} ${run.id}`);
      }
      console.log(`Result: ${pass ? "PASS" : "FAIL"}`);
    }

    if (!args.keepTmp) {
      for (const target of createdTargets) {
        const cleanup = removePathWithRetry(target);
        if (!cleanup.ok) {
          throw cleanup.error;
        }
      }
    }

    if (!pass) {
      process.exit(1);
    }
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    printUsage();
    process.exit(1);
  }
}

await main();
