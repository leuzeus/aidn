#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { copyFixtureToTmp, initGitRepo } from "./test-git-fixture-lib.mjs";

const CASES = [
  {
    id: "push_required_without_upstream",
    fixture: "tests/fixtures/perf-start-session/session-multi-choice",
    workingBranch: "S201-multi",
    expectedAction: "push_session_branch",
    expectedResult: "ok",
    mutate: prepareClosedSessionForPr,
  },
  {
    id: "open_pull_request_when_branch_is_pushed",
    fixture: "tests/fixtures/perf-start-session/session-multi-choice",
    workingBranch: "S201-multi",
    expectedAction: "open_pull_request",
    expectedResult: "ok",
    mutate: prepareClosedSessionForPr,
    setupRemote(targetRoot) {
      attachBareOrigin(targetRoot, "dev");
      runGit(targetRoot, ["push", "-u", "origin", "S201-multi"]);
    },
  },
  {
    id: "await_review_when_pr_is_open",
    fixture: "tests/fixtures/perf-start-session/session-multi-choice",
    workingBranch: "S201-multi",
    expectedAction: "await_review",
    expectedResult: "ok",
    mutate(targetRoot) {
      prepareClosedSessionForPr(targetRoot);
      const sessionFile = path.join(targetRoot, "docs", "audit", "sessions", "S201-multi.md");
      const text = fs.readFileSync(sessionFile, "utf8")
        .replace("- pr_status: `none`", "- pr_status: `open`")
        .replace("- pr_review_status: `unknown`", "- pr_review_status: `pending`");
      fs.writeFileSync(sessionFile, text, "utf8");
    },
  },
  {
    id: "post_merge_sync_required_on_source_branch",
    fixture: "tests/fixtures/perf-start-session/session-multi-choice",
    workingBranch: "dev",
    expectedAction: "post_merge_sync_required",
    expectedResult: "ok",
    mutate(targetRoot) {
      prepareClosedSessionForPr(targetRoot);
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
        "active_session: S201",
        "session_branch: S201-multi",
        "branch_kind: source",
        "mode: COMMITTING",
        "session_pr_status: merged",
        "session_pr_review_status: approved",
        "post_merge_sync_status: required",
        "",
        "active_cycle: none",
        "cycle_branch: none",
        "dor_state: unknown",
        "first_plan_step: unknown",
      ].join("\n"), "utf8");
      const sessionFile = path.join(targetRoot, "docs", "audit", "sessions", "S201-multi.md");
      const text = fs.readFileSync(sessionFile, "utf8")
        .replace("- pr_status: `none`", "- pr_status: `merged`")
        .replace("- pr_review_status: `unknown`", "- pr_review_status: `approved`")
        .replace("- post_merge_sync_status: `not_needed`", "- post_merge_sync_status: `required`");
      fs.writeFileSync(sessionFile, text, "utf8");
    },
    setupRemote(targetRoot) {
      attachBareOrigin(targetRoot, "dev");
      runGit(targetRoot, ["checkout", "dev"]);
      fs.writeFileSync(path.join(targetRoot, "README.pr-sync.txt"), "sync\n", "utf8");
      runGit(targetRoot, ["add", "README.pr-sync.txt"]);
      runGit(targetRoot, ["commit", "-m", "local source drift"]);
      runGit(targetRoot, ["push", "-u", "origin", "dev"]);
      fs.writeFileSync(path.join(targetRoot, "README.pr-sync.txt"), "sync updated\n", "utf8");
      runGit(targetRoot, ["add", "README.pr-sync.txt"]);
      runGit(targetRoot, ["commit", "-m", "source branch ahead"]);
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
  console.log("  node tools/perf/verify-pr-orchestrate-admission-fixtures.mjs");
}

function runGit(target, args) {
  execFileSync("git", ["-C", target, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
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

function commitFixtureMutation(targetRoot) {
  const status = execFileSync("git", ["-C", targetRoot, "status", "--porcelain"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
  if (!status) {
    return;
  }
  runGit(targetRoot, ["add", "."]);
  runGit(targetRoot, ["commit", "-m", "fixture mutation"]);
}

function attachBareOrigin(targetRoot, sourceBranch) {
  const remoteRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aidn-pr-orchestrate-"));
  runGit(remoteRoot, ["init", "--bare"]);
  runGit(targetRoot, ["remote", "add", "origin", remoteRoot]);
  runGit(targetRoot, ["push", "-u", "origin", sourceBranch]);
  return remoteRoot;
}

function prepareClosedSessionForPr(targetRoot) {
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
    "active_session: S201",
    "session_branch: S201-multi",
    "branch_kind: session",
    "mode: COMMITTING",
    "session_pr_status: none",
    "session_pr_review_status: unknown",
    "post_merge_sync_status: not_needed",
    "",
    "active_cycle: none",
    "cycle_branch: none",
    "dor_state: READY",
    "first_plan_step: finish session closure",
  ].join("\n"), "utf8");
  for (const cycleFile of [
    path.join(targetRoot, "docs", "audit", "cycles", "C201-feature-alpha", "status.md"),
    path.join(targetRoot, "docs", "audit", "cycles", "C202-feature-beta", "status.md"),
  ]) {
    const text = fs.readFileSync(cycleFile, "utf8").replace(/state:\s*(OPEN|IMPLEMENTING|VERIFYING)/gu, "state: DONE");
    fs.writeFileSync(cycleFile, text, "utf8");
  }
  const sessionFile = path.join(targetRoot, "docs", "audit", "sessions", "S201-multi.md");
  fs.writeFileSync(sessionFile, [
    "# Session S201 - Multi",
    "",
    "[x] COMMITTING",
    "[ ] EXPLORING",
    "[ ] THINKING",
    "",
    "- session_branch: `S201-multi`",
    "- parent_session: S200",
    "- branch_kind: `session`",
    "- cycle_branch: `none`",
    "- integration_target_cycles:",
    "  - C201",
    "  - C202",
    "- attached_cycles:",
    "  - C201",
    "  - C202",
    "- reported_from_previous_session: `none`",
    "- carry_over_pending: no",
    "- pr_status: `none`",
    "- pr_url: `none`",
    "- pr_number: `none`",
    "- pr_base_branch: `dev`",
    "- pr_head_branch: `S201-multi`",
    "- pr_review_status: `unknown`",
    "- post_merge_sync_status: `not_needed`",
    "- post_merge_sync_basis: `none`",
    "",
    "### Session close gate satisfied?",
    "- [x] Yes",
  ].join("\n"), "utf8");
}

function runCase(tmpRoot, testCase) {
  const sourceTarget = path.resolve(process.cwd(), testCase.fixture);
  const targetRoot = copyFixtureToTmp(sourceTarget, tmpRoot, `tmp-pr-orchestrate-${testCase.id}`);
  initGitRepo(targetRoot, {
    workingBranch: testCase.workingBranch,
  });
  if (typeof testCase.mutate === "function") {
    testCase.mutate(targetRoot);
    commitFixtureMutation(targetRoot);
  }
  if (typeof testCase.setupRemote === "function") {
    testCase.setupRemote(targetRoot);
  }

  const hook = runJson("tools/perf/pr-orchestrate-hook.mjs", [
    "--target",
    targetRoot,
    "--mode",
    "COMMITTING",
    "--json",
  ]);
  const codex = runJson("tools/codex/run-json-hook.mjs", [
    "--skill",
    "pr-orchestrate",
    "--target",
    targetRoot,
    "--mode",
    "COMMITTING",
    "--json",
  ]);

  const checks = {
    hook_action_expected: String(hook?.action ?? "") === testCase.expectedAction,
    hook_result_expected: String(hook?.result ?? "") === testCase.expectedResult,
    codex_action_expected: String(codex?.action ?? "") === testCase.expectedAction,
    codex_result_expected: String(codex?.result ?? "") === testCase.expectedResult,
    codex_ok_matches_result: Boolean(codex?.ok) === (testCase.expectedResult === "ok"),
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
      codex_action: codex?.action ?? null,
      codex_result: codex?.result ?? null,
      codex_ok: codex?.ok ?? null,
      suggested_commands: hook?.admission?.suggested_commands ?? [],
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
