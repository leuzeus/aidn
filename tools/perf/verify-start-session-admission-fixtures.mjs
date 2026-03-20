#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { copyFixtureToTmp, initGitRepo } from "./test-git-fixture-lib.mjs";

const CASES = [
  {
    id: "non_compliant_branch",
    fixture: "tests/fixtures/perf-current-state/active",
    workingBranch: "feature/multi-agent-handoff-foundation",
    expectedAction: "blocked_non_compliant_branch",
    expectedResult: "stop",
    expectsWorkflowHook: false,
  },
  {
    id: "source_branch_allows_create",
    fixture: "tests/fixtures/repo-installed-core",
    workingBranch: "dev",
    expectedAction: "create_session_allowed",
    expectedResult: "ok",
    expectsWorkflowHook: true,
  },
  {
    id: "cycle_branch_resumes",
    fixture: "tests/fixtures/perf-current-state/active",
    workingBranch: "feature/C101-alpha",
    expectedAction: "resume_current_cycle",
    expectedResult: "ok",
    expectsWorkflowHook: true,
  },
  {
    id: "session_branch_resumes_with_single_focus",
    fixture: "tests/fixtures/perf-start-session/session-multi-choice",
    workingBranch: "S201-multi",
    expectedAction: "resume_current_session",
    expectedResult: "ok",
    expectsWorkflowHook: true,
    mutate(targetRoot) {
      const sessionFile = path.join(targetRoot, "docs", "audit", "sessions", "S201-multi.md");
      const text = fs.readFileSync(sessionFile, "utf8")
        .replace(/- integration_target_cycles:\s*\r?\n\s*- C201\r?\n\s*- C202/u, "- integration_target_cycles:\n  - C201")
        .replace(/- attached_cycles:\s*\r?\n\s*- C201\r?\n\s*- C202/u, "- attached_cycles:\n  - C201")
        .replace(/- cycle_branch: `feature\/C201-alpha`/u, "- cycle_branch: `feature/C201-alpha`\n- primary_focus_cycle: `C201`");
      fs.writeFileSync(sessionFile, text, "utf8");
    },
  },
  {
    id: "session_multi_requires_choice",
    fixture: "tests/fixtures/perf-start-session/session-multi-choice",
    workingBranch: "S201-multi",
    expectedAction: "choose_cycle",
    expectedResult: "stop",
    expectsWorkflowHook: false,
  },
  {
    id: "session_mapping_missing_blocks",
    fixture: "tests/fixtures/perf-start-session/session-multi-choice",
    workingBranch: "S999-missing",
    expectedAction: "blocked_non_compliant_branch",
    expectedResult: "stop",
    expectsWorkflowHook: false,
  },
  {
    id: "cycle_mapping_missing_blocks",
    fixture: "tests/fixtures/perf-current-state/active",
    workingBranch: "feature/C999-missing",
    expectedAction: "blocked_non_compliant_branch",
    expectedResult: "stop",
    expectsWorkflowHook: false,
  },
  {
    id: "source_branch_resumes_previous_session_when_pr_open",
    fixture: "tests/fixtures/perf-start-session/session-multi-choice",
    workingBranch: "dev",
    expectedAction: "resume_current_session",
    expectedResult: "ok",
    expectsWorkflowHook: true,
    mutate(targetRoot) {
      const currentState = path.join(targetRoot, "docs", "audit", "CURRENT-STATE.md");
      fs.writeFileSync(currentState, [
        "# Current State",
        "",
        "## Summary",
        "",
        "updated_at: 2026-03-19T00:00:00Z",
        "structure_profile: modern",
        "runtime_state_mode: files",
        "repair_layer_status: unknown",
        "",
        "## Active Context",
        "",
        "active_session: none",
        "session_branch: none",
        "branch_kind: source",
        "mode: THINKING",
        "",
        "active_cycle: none",
        "cycle_branch: none",
        "dor_state: unknown",
        "first_plan_step: unknown",
      ].join("\n"), "utf8");
      for (const cycleFile of [
        path.join(targetRoot, "docs", "audit", "cycles", "C201-feature-alpha", "status.md"),
        path.join(targetRoot, "docs", "audit", "cycles", "C202-feature-beta", "status.md"),
      ]) {
        const text = fs.readFileSync(cycleFile, "utf8").replace(/state:\s*(OPEN|IMPLEMENTING|VERIFYING)/gu, "state: DONE");
        fs.writeFileSync(cycleFile, text, "utf8");
      }
      const sessionFile = path.join(targetRoot, "docs", "audit", "sessions", "S201-multi.md");
      fs.appendFileSync(sessionFile, "\n\n### PR Orchestration\n- pr_status: `open`\n- pr_review_status: `pending`\n\n### Session close gate satisfied?\n- [x] Yes\n", "utf8");
    },
  },
  {
    id: "source_branch_blocks_when_post_merge_sync_required",
    fixture: "tests/fixtures/perf-start-session/session-multi-choice",
    workingBranch: "dev",
    expectedAction: "blocked_session_base_gate",
    expectedResult: "stop",
    expectsWorkflowHook: false,
    mutate(targetRoot) {
      const currentState = path.join(targetRoot, "docs", "audit", "CURRENT-STATE.md");
      fs.writeFileSync(currentState, [
        "# Current State",
        "",
        "## Summary",
        "",
        "updated_at: 2026-03-19T00:00:00Z",
        "structure_profile: modern",
        "runtime_state_mode: files",
        "repair_layer_status: unknown",
        "",
        "## Active Context",
        "",
        "active_session: none",
        "session_branch: none",
        "branch_kind: source",
        "mode: THINKING",
        "",
        "active_cycle: none",
        "cycle_branch: none",
        "dor_state: unknown",
        "first_plan_step: unknown",
      ].join("\n"), "utf8");
      for (const cycleFile of [
        path.join(targetRoot, "docs", "audit", "cycles", "C201-feature-alpha", "status.md"),
        path.join(targetRoot, "docs", "audit", "cycles", "C202-feature-beta", "status.md"),
      ]) {
        const text = fs.readFileSync(cycleFile, "utf8").replace(/state:\s*(OPEN|IMPLEMENTING|VERIFYING)/gu, "state: DONE");
        fs.writeFileSync(cycleFile, text, "utf8");
      }
      const sessionFile = path.join(targetRoot, "docs", "audit", "sessions", "S201-multi.md");
      fs.appendFileSync(sessionFile, "\n\n### PR Orchestration\n- pr_status: `merged`\n- pr_review_status: `approved`\n- post_merge_sync_status: `required`\n\n### Session close gate satisfied?\n- [x] Yes\n", "utf8");
    },
  },
];

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
  console.log("  node tools/perf/verify-start-session-admission-fixtures.mjs");
}

function runJson(script, scriptArgs, env = {}) {
  const file = path.resolve(process.cwd(), script);
  const stdout = execFileSync(process.execPath, [file, ...scriptArgs], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      ...env,
    },
  });
  return JSON.parse(stdout);
}

function runCase(tmpRoot, testCase) {
  const sourceTarget = path.resolve(process.cwd(), testCase.fixture);
  const targetRoot = copyFixtureToTmp(sourceTarget, tmpRoot, `tmp-start-session-${testCase.id}`);
  if (typeof testCase.mutate === "function") {
    testCase.mutate(targetRoot);
  }
  initGitRepo(targetRoot, {
    workingBranch: testCase.workingBranch,
  });

  const hook = runJson("tools/perf/start-session-hook.mjs", [
    "--target",
    targetRoot,
    "--mode",
    "COMMITTING",
    "--json",
  ]);
  const codex = runJson("tools/codex/run-json-hook.mjs", [
    "--skill",
    "start-session",
    "--target",
    targetRoot,
    "--mode",
    "COMMITTING",
    "--json",
  ]);

  const checks = {
    hook_action_expected: String(hook?.action ?? "") === testCase.expectedAction,
    hook_result_expected: String(hook?.result ?? "") === testCase.expectedResult,
    hook_workflow_hook_expected: Boolean(hook?.workflow_hook) === testCase.expectsWorkflowHook,
    codex_action_expected: String(codex?.action ?? "") === testCase.expectedAction,
    codex_result_expected: String(codex?.result ?? "") === testCase.expectedResult,
    codex_ok_matches_result: Boolean(codex?.ok) === (testCase.expectedResult === "ok"),
    codex_reason_code_present: String(codex?.normalized?.reason_code ?? hook?.reason_code ?? "").length > 0 || testCase.expectedResult === "ok",
  };
  return {
    id: testCase.id,
    source_target: sourceTarget,
    target_root: targetRoot,
    expected_action: testCase.expectedAction,
    expected_result: testCase.expectedResult,
    checks,
    sample: {
      hook_action: hook?.action ?? null,
      hook_result: hook?.result ?? null,
      hook_reason_code: hook?.reason_code ?? null,
      hook_workflow_ran: Boolean(hook?.workflow_hook),
      codex_action: codex?.action ?? null,
      codex_result: codex?.result ?? null,
      codex_ok: codex?.ok ?? null,
      codex_reason_code: codex?.normalized?.reason_code ?? null,
    },
    pass: Object.values(checks).every((value) => value === true),
  };
}

function main() {
  const createdTargets = [];
  try {
    const args = parseArgs(process.argv.slice(2));
    const tmpRoot = path.resolve(process.cwd(), args.tmpRoot);
    const runs = CASES.map((testCase) => {
      const run = runCase(tmpRoot, testCase);
      createdTargets.push(run.target_root);
      return run;
    });
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
        fs.rmSync(target, { recursive: true, force: true });
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

main();
