#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { copyFixtureToTmp, initGitRepo, removePathWithRetry } from "./test-git-fixture-lib.mjs";
import { prepareActivationFixture } from "./test-activation-fixture-lib.mjs";
import { runDbFirstArtifactUseCase } from "../../src/application/runtime/db-first-artifact-use-case.mjs";
import { createDaemonRunJsonHookAgentAdapter } from "../../src/application/codex/daemon-run-json-hook-agent-adapter.mjs";

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
  prepareActivationFixture(targetRoot);
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

async function runCanonicalCases(tmpRoot, createdTargets) {
  const results = [];
  for (const mode of ["dual", "db-only"]) {
    const targetRoot = copyFixtureToTmp(path.resolve("tests/fixtures/perf-start-session/session-multi-choice"),
      tmpRoot, `tmp-pr-canonical-${mode}`);
    createdTargets.push(targetRoot);
    initGitRepo(targetRoot, { workingBranch: "S201-multi" });
    prepareClosedSessionForPr(targetRoot);
    prepareActivationFixture(targetRoot);
    fs.writeFileSync(path.join(targetRoot, ".aidn/config.json"), JSON.stringify({ runtime: { stateMode: mode } }));
    fs.appendFileSync(path.join(targetRoot, ".git/info/exclude"), "\n/.aidn/runtime/\n");
    commitFixtureMutation(targetRoot);
    const env = { AIDN_STATE_MODE: mode, AIDN_INDEX_STORE_MODE: "" };
    runJson("tools/perf/index-sync.mjs", ["--target", targetRoot, "--store", "sqlite", "--json"], env);
    const sessionPath = path.join(targetRoot, "docs/audit/sessions/S201-multi.md");
    const visibleSession = fs.readFileSync(sessionPath, "utf8");
    const currentPath = path.join(targetRoot, "docs/audit/CURRENT-STATE.md");
    const visibleCurrent = fs.readFileSync(currentPath, "utf8");
    const indexPath = path.join(targetRoot, ".aidn/runtime/index/workflow-index.sqlite");
    const writeSession = (pr, review, sync = "not_needed", closed = true) => {
      const content = visibleSession.replace("- pr_status: `none`", `- pr_status: \`${pr}\``)
        .replace("- pr_review_status: `unknown`", `- pr_review_status: \`${review}\``)
        .replace("- post_merge_sync_status: `not_needed`", `- post_merge_sync_status: \`${sync}\``)
        .replace("- [x] Yes", closed ? "- [x] Yes" : "- [ ] Yes");
      assert.equal(runDbFirstArtifactUseCase({ target: targetRoot, path: "sessions/S201-multi.md",
        kind: "session", content, materialize: "false" }).materialized, false);
    };
    const assertAction = async expected => {
      const before = fs.readFileSync(indexPath);
      const direct = runJson("tools/perf/pr-orchestrate-hook.mjs",
        ["--target", targetRoot, "--strict", "--json"], env);
      assert.equal(direct.action, expected, `${mode}: direct action`);
      assert.deepEqual(fs.readFileSync(indexPath), before, "direct admission mutated canonical DB");
      const daemon = await createDaemonRunJsonHookAgentAdapter().runCommandAsync({ command: process.execPath,
        commandArgs: [path.resolve("bin/aidn.mjs"), "perf", "skill-hook", "--skill", "pr-orchestrate",
          "--target", targetRoot, "--strict", "--json"], envOverrides: env });
      assert.equal(daemon.status, 0, daemon.stderr);
      assert.equal(JSON.parse(daemon.stdout).action, expected, `${mode}: daemon action`);
      const execution = spawnSync(process.execPath, [path.resolve("tools/codex/run-json-hook.mjs"),
        "--skill", "pr-orchestrate", "--target", targetRoot, "--strict", "--json"],
      { encoding: "utf8", windowsHide: true, env: { ...process.env, ...env }, timeout: 60000 });
      assert.equal(execution.error, undefined, execution.error?.message);
      assert(execution.stdout.trim().startsWith("{"), execution.stderr.slice(-1000));
      const wrapped = JSON.parse(execution.stdout);
      assert.equal(execution.status, wrapped.ok ? 0 : 1);
      assert.equal(wrapped.action, expected, `${mode}: wrapper action`);
      assert.equal(wrapped.db_sync.enabled, false, "diagnostic must not import projections");
      assert.deepEqual(fs.readFileSync(indexPath), before, "wrapper changed canonical DB");
      assert.equal(fs.readFileSync(sessionPath, "utf8"), visibleSession);
      assert.equal(fs.readFileSync(currentPath, "utf8"), visibleCurrent);
      return direct;
    };
    writeSession("none", "unknown", "not_needed", false);
    await assertAction("blocked_session_not_closed");
    writeSession("none", "unknown");
    await assertAction("push_session_branch");
    writeSession("open", "pending");
    await assertAction("await_review");
    writeSession("open", "resolved");
    const reviewed = await assertAction("merge_pull_request");
    assert.equal(reviewed.admission.mapped_session.pr_status, "open");
    assert.equal(reviewed.admission.pr_review_status, "resolved");
    writeSession("closed_not_merged", "resolved");
    await assertAction("blocked_pr_closed_not_merged");
    writeSession("merged", "approved", "required");
    await assertAction("switch_to_source_for_post_merge_sync");
    runGit(targetRoot, ["checkout", "dev"]);
    // Keep the already committed misleading files on the source branch too.
    runGit(targetRoot, ["merge", "--ff-only", "S201-multi"]);
    await assertAction("post_merge_sync_required");
    writeSession("merged", "approved", "done");
    await assertAction("post_merge_sync_complete");
    const db = new DatabaseSync(indexPath);
    try { db.prepare("UPDATE sessions SET branch_name=? WHERE session_id=?").run("S201-wrong", "S201"); }
    finally { db.close(); }
    assert.equal((await assertAction("blocked_pr_context_missing")).reason_code, "PR_ORCHESTRATE_CANONICAL_RUNTIME_INVALID");
    writeSession("open", "resolved");
    runDbFirstArtifactUseCase({ target: targetRoot, path: "sessions/S201-duplicate.md", kind: "session",
      content: visibleSession, materialize: "false" });
    assert.equal((await assertAction("blocked_pr_context_missing")).reason_code, "PR_ORCHESTRATE_CANONICAL_RUNTIME_INVALID");
    fs.renameSync(indexPath, `${indexPath}.offline`);
    const unavailable = runJson("tools/perf/pr-orchestrate-hook.mjs", ["--target", targetRoot, "--json"], env);
    assert.equal(unavailable.reason_code, "PR_ORCHESTRATE_CANONICAL_RUNTIME_INVALID");
    assert.equal(unavailable.result, "stop");
    assert.equal(fs.existsSync(indexPath), false, "unavailable read must not initialize SQLite");
    assert.equal(execFileSync("git", ["-C", targetRoot, "status", "--porcelain"], { encoding: "utf8" }).trim(), "");
    results.push({ id: `${mode}_canonical_lifecycle_cli_daemon_wrapper_preservation_and_refusals`, pass: true });
  }
  return results;
}

async function main() {
  const createdTargets = [];
  try {
    const args = parseArgs(process.argv.slice(2));
    const tmpRoot = path.resolve(process.cwd(), args.tmpRoot);
    const runs = CASES.map((testCase) => {
      const run = runCase(tmpRoot, testCase);
      createdTargets.push(run.target_root);
      return run;
    });
    runs.push(...await runCanonicalCases(tmpRoot, createdTargets));
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
        if (!run.pass) console.log(JSON.stringify({ checks: run.checks, sample: run.sample }));
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
    for (const target of createdTargets) removePathWithRetry(target);
    console.error(`ERROR: ${error.message}`);
    printUsage();
    process.exit(1);
  }
}

main();
