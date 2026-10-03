#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import assert from "node:assert/strict";
import { collectGatingObservations, readEventSignalStats } from "../../src/application/runtime/gating-observation-service.mjs";
import { createLocalGitAdapter } from "../../src/adapters/runtime/local-git-adapter.mjs";
import { resolveWorkflowSnapshotBackend } from "../../src/application/runtime/runtime-snapshot-service.mjs";
import { copyFixtureToTmp, initGitRepo, removePathWithRetry } from "./test-git-fixture-lib.mjs";
import { isActivationFixtureSource, prepareActivationFixture, prepareWorkflowDocumentsFixture } from "./test-activation-fixture-lib.mjs";
import { inspectImmediateProcessExitArguments } from "../verify/spawn-sync-evidence-lib.mjs";

const CASES = [
  {
    id: "complete_cycle_passes", fixture: "tests/fixtures/perf-current-state/active",
    workingBranch: "feature/C101-alpha", expectedAction: "audit_cycle_branch",
    expectedResult: "ok", expectsGating: true, complete: true, warm: true,
  },
  {
    id: "complete_cycle_warning_propagates", fixture: "tests/fixtures/perf-current-state/active",
    workingBranch: "feature/C101-alpha", expectedAction: "run_conditional_drift_check",
    expectedResult: "warn", expectsGating: true, complete: true,
  },
  {
    id: "non_compliant_branch",
    fixture: "tests/fixtures/perf-current-state/active",
    workingBranch: "feature/multi-agent-handoff-foundation",
    expectedAction: "blocked_non_compliant_branch",
    expectedResult: "stop",
    expectsGating: false,
  },
  {
    id: "cycle_branch_maps",
    fixture: "tests/fixtures/perf-current-state/active",
    workingBranch: "feature/C101-alpha",
    expectedAction: "stop_and_triage_incident",
    expectedResult: "stop",
    expectsGating: true,
  },
  {
    id: "session_branch_maps",
    fixture: "tests/fixtures/perf-current-state/active",
    workingBranch: "S101-alpha",
    expectedAction: "stop_and_triage_incident",
    expectedResult: "stop",
    expectsGating: true,
  },
  {
    id: "missing_session_mapping_blocks",
    fixture: "tests/fixtures/perf-current-state/missing-session",
    workingBranch: "S101-alpha",
    expectedAction: "blocked_non_compliant_branch",
    expectedResult: "stop",
    expectsGating: false,
  },
];

function parseArgs(argv) {
  const args = {
    tmpRoot: os.tmpdir(),
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
  console.log("  node tools/perf/verify-branch-cycle-audit-admission-fixtures.mjs");
}

function verifyHookExitPolicy() {
  const hookFile = path.resolve(process.cwd(), "tools", "perf", "branch-cycle-audit-hook.mjs");
  const source = fs.readFileSync(hookFile, "utf8");
  const immediateExitArguments = inspectImmediateProcessExitArguments(source);
  if (
    immediateExitArguments.length !== 1
    || immediateExitArguments[0] !== "0"
  ) {
    throw new Error(
      "branch-cycle-audit hook may only use immediate process.exit(0) for help; "
      + `found ${immediateExitArguments.join(", ")}`,
    );
  }
  const oldSuccessExitMutant = `${source}\nprocess.exit(0);\n`;
  const mutantArguments = inspectImmediateProcessExitArguments(oldSuccessExitMutant);
  if (mutantArguments.length === immediateExitArguments.length) {
    throw new Error("branch-cycle-audit immediate-success-exit mutant was not detected");
  }
  return {
    immediate_exit_arguments: immediateExitArguments,
    help_exit_only: true,
    immediate_success_exit_mutant_rejected: true,
  };
}

function runJson(script, scriptArgs, env = {}) {
  const file = path.resolve(process.cwd(), script);
  const run = spawnSync(process.execPath, [file, ...scriptArgs], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      ...env,
    },
  });
  assert.notEqual(run.status, null, 'hook must complete');
  const result = JSON.parse(run.stdout);
  if (script.includes('branch-cycle-audit-hook')) {
    assert.equal(run.status, result.result === 'stop' || result.result === 'error' ? 1 : 0);
  }
  return result;
}

function verifyObservationBoundaries(root) {
  const file = path.join(root, 'events.ndjson');
  const nowMs = Date.now();
  const event = (reason, extra = {}) => ({ skill: 'reload-check', result: 'fallback',
    ts: new Date(nowMs).toISOString(), branch: 'S101-alpha', reason_code: reason, ...extra });
  const events = [event('MISSING_CACHE'), event('HEAD_CHANGED'), event('BRANCH_CHANGED'), event('HEAD_CHANGED|DIGEST_MISS'),
    event('CORRUPT_CACHE', { ts: new Date(nowMs - 46 * 60000).toISOString() }),
    event('CORRUPT_CACHE', { branch: 'S102-other' }),
    event('CORRUPT_CACHE'), event('HEAD_CHANGED|CORRUPT_CACHE'),
    event('', { reason_codes: ['STATE_MODE_FALLBACK'] })];
  fs.writeFileSync(file, events.map(row => JSON.stringify(row).replaceAll('\":', '\": ')).join('\n'));
  const before = fs.readFileSync(file);
  assert.equal(readEventSignalStats(file, { nowMs, branch: 'S101-alpha' }).fallbackRecentCount, 3);
  assert.deepEqual(fs.readFileSync(file), before, 'observation must not erase history');
  for (const ts of ['invalid', new Date(nowMs + 60000).toISOString()]) {
    fs.writeFileSync(file, JSON.stringify(event('CORRUPT_CACHE', { ts })));
    assert.equal(readEventSignalStats(file, { nowMs, branch: 'S101-alpha' }).fallbackRecentCount, 1);
  }
  fs.mkdirSync(path.join(root, '.aidn'), { recursive: true });
  fs.writeFileSync(path.join(root, '.aidn/config.json'), JSON.stringify({ runtime: { persistence: { backend: 'postgres', connectionRef: 'env:UNUSED_TEST_DB' } } }));
  assert.equal(resolveWorkflowSnapshotBackend(root, 'legacy.sqlite', 'auto'), 'postgres');
  assert.throws(() => resolveWorkflowSnapshotBackend(root, 'legacy.sqlite', 'sqlite'), /conflicts/);
}

function runCase(tmpRoot, testCase, onTargetCreated) {
  const sourceTarget = path.resolve(process.cwd(), testCase.fixture);
  const targetRoot = copyFixtureToTmp(sourceTarget, tmpRoot, `tmp-branch-cycle-audit-${testCase.id}`, {
    onDestinationCreated: onTargetCreated,
    filter: (source) => isActivationFixtureSource(sourceTarget, source, { freshContext: true }),
  });
  initGitRepo(targetRoot, {
    workingBranch: testCase.workingBranch,
  });
  prepareActivationFixture(targetRoot);
  if (testCase.complete) for (const relative of ['baseline/current.md', 'WORKFLOW.md', 'SPEC.md']) {
    const file = path.join(targetRoot, 'docs/audit', relative);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, '# Temporary workflow artifact\n');
  }
  fs.appendFileSync(path.join(targetRoot, '.git/info/exclude'), '\n/.aidn/runtime/\n');
  execFileSync("git", ["-C", targetRoot, "add", "."], { stdio: "pipe" });
  execFileSync("git", ["-C", targetRoot, "commit", "--amend", "--no-edit"], { stdio: "pipe" });
  if (testCase.warm) runJson('tools/perf/reload-check.mjs', ['--target', targetRoot, '--write-cache', '--json']);

  const hook = runJson("tools/perf/branch-cycle-audit-hook.mjs", [
    "--target",
    targetRoot,
    "--mode",
    "COMMITTING",
    "--json",
  ]);
  const codex = runJson("tools/codex/run-json-hook.mjs", [
    "--skill",
    "branch-cycle-audit",
    "--target",
    targetRoot,
    "--mode",
    "COMMITTING",
    "--json",
  ]);

  const checks = {
    hook_action_expected: String(hook?.action ?? "") === testCase.expectedAction,
    hook_result_expected: String(hook?.result ?? "") === testCase.expectedResult,
    hook_gating_expected: Boolean(hook?.gating) === testCase.expectsGating,
    admission_preserved: !testCase.expectsGating || hook.admission.ok === true,
    nested_gate_propagated: !hook.gating || hook.result === hook.gating.result,
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
      hook_gating_ran: Boolean(hook?.gating),
      codex_action: codex?.action ?? null,
      codex_result: codex?.result ?? null,
      codex_ok: codex?.ok ?? null,
      codex_reason_code: codex?.normalized?.reason_code ?? null,
      codex_command_status: codex?.command_status ?? null,
      codex_error: codex?.error ?? null,
    },
    pass: Object.values(checks).every((value) => value === true),
  };
}

function verifyDriftCompletion(tmpRoot, onCreated) {
  const source = path.resolve('tests/fixtures/perf-current-state/active');
  const root = copyFixtureToTmp(source, tmpRoot, 'tmp-drift-completion', {
    onDestinationCreated: onCreated,
    filter: file => isActivationFixtureSource(source, file, { freshContext: true }),
  });
  initGitRepo(root, { workingBranch: 'feature/C101-alpha' });
  prepareActivationFixture(root);
  prepareWorkflowDocumentsFixture(root);
  fs.appendFileSync(path.join(root, '.git/info/exclude'), '\n/.aidn/runtime/\n');
  execFileSync('git', ['-C', root, 'add', '.'], { stdio: 'pipe' });
  execFileSync('git', ['-C', root, 'commit', '--amend', '--no-edit'], { stdio: 'pipe' });
  const run = (script, args = []) => runJson(script, ['--target', root, '--mode', 'COMMITTING', ...args, '--json']);
  const audit = () => run('tools/perf/branch-cycle-audit-hook.mjs', ['--no-emit-event']);
  const file = path.join(root, '.aidn/runtime/perf/workflow-events.ndjson');
  const events = () => fs.readFileSync(file, 'utf8').trim().split('\n').map(JSON.parse);
  assert.deepEqual(audit().levels.level2.active_signals, ['time_since_last_drift_check']);
  run('tools/perf/gating-evaluate.mjs');
  assert.equal(readEventSignalStats(file, { branch: 'feature/C101-alpha' }).latestDriftMs, null);
  const beforePreview = fs.readFileSync(file);
  assert.equal(run('tools/perf/gating-evaluate.mjs', ['--complete-drift-check', '--no-emit-event']).result, 'warn');
  assert.deepEqual(fs.readFileSync(file), beforePreview);
  const overridden = spawnSync(process.execPath, [path.resolve('tools/perf/gating-evaluate.mjs'),
    '--target', root, '--complete-drift-check', '--reload-decision', 'incremental', '--json'], { encoding: 'utf8', windowsHide: true });
  assert.equal(overridden.status, 1);
  assert.match(overridden.stderr, /observed reload evidence/);
  assert.deepEqual(fs.readFileSync(file), beforePreview);
  const checked = run('tools/codex/run-json-hook.mjs', ['--skill', 'drift-check', '--strict']);
  assert.equal(checked.ok, true, JSON.stringify(checked));
  assert.equal(checked.command_status, 0);
  const completed = events().filter(event => event.event === 'drift_check_completed');
  assert.equal(completed.length, 1);
  assert.equal(completed[0].skill, 'drift-check');
  assert.equal(audit().result, 'ok');
  run('tools/perf/gating-evaluate.mjs');
  assert.equal(events().filter(event => event.event === 'drift_check_completed').length, 1);
  const nowMs = Date.now();
  const recordedMs = Date.parse(completed[0].ts);
  for (const extra of [{ branch: 'S999-other' }, { result: 'warn' }, { event: 'gating_summary' },
    { ts: 'invalid' }, { ts: new Date(nowMs + 60000).toISOString() }, { mode: 'THINKING' }]) {
    fs.appendFileSync(file, JSON.stringify({ ...completed[0], ts: new Date(nowMs).toISOString(), ...extra }) + '\n');
  }
  assert.equal(readEventSignalStats(file, { branch: 'feature/C101-alpha', nowMs }).latestDriftMs, recordedMs);
  // Age the observed completion in this owned fixture, then exercise a real
  // unresolved objective change. Neither failed check may refresh the proof.
  fs.writeFileSync(file, JSON.stringify({ ...completed[0], ts: new Date(nowMs - 46 * 60000).toISOString() }) + '\n');
  assert.equal(audit().result, 'warn');
  const session = path.join(root, 'docs/audit/sessions/S101-alpha.md');
  fs.appendFileSync(session, '\nsession_objective: replace the unrelated payment system\n');
  const failed = run('tools/codex/run-json-hook.mjs', ['--skill', 'drift-check', '--strict']);
  assert.equal(failed.ok, false);
  assert.equal(failed.result, 'warn');
  assert.equal(events().filter(event => event.event === 'drift_check_completed').length, 1);
  assert.equal(events().at(-1).event, 'drift_check_evaluated');
  const reloadCache = path.join(root, '.aidn/runtime/cache/reload-state.json');
  fs.mkdirSync(path.dirname(reloadCache), { recursive: true });
  fs.writeFileSync(reloadCache, '{broken');
  fs.appendFileSync(file, Array.from({ length: 3 }, () => JSON.stringify({ ts: new Date().toISOString(),
    skill: 'reload-check', result: 'fallback', branch: 'feature/C101-alpha', reason_code: 'CORRUPT_CACHE' })).join('\n') + '\n');
  const stopped = run('tools/codex/run-json-hook.mjs', ['--skill', 'drift-check', '--strict']);
  assert.equal(stopped.ok, false);
  assert.equal(stopped.result, 'stop');
  assert.equal(events().filter(event => event.event === 'drift_check_completed').length, 1);
}

async function verifySessionObjectives(tmpRoot, onCreated) {
  const source = path.resolve('tests/fixtures/perf-current-state/active');
  const root = copyFixtureToTmp(source, tmpRoot, 'tmp-session-objectives', {
    onDestinationCreated: onCreated,
    filter: file => isActivationFixtureSource(source, file, { freshContext: true }),
  });
  initGitRepo(root, { workingBranch: 'feature/C101-alpha' });
  prepareActivationFixture(root);
  prepareWorkflowDocumentsFixture(root);
  const sessionFile = path.join(root, 'docs/audit/sessions/S101-alpha.md');
  const statusFile = path.join(root, 'docs/audit/cycles/C101-feature-alpha/status.md');
  const status = fs.readFileSync(statusFile, 'utf8');
  const goal = 'finalize alpha feature';
  const other = 'replace the unrelated payment system';
  const section = body => `## SESSION OBJECTIVE (1 clear sentence)\n\n${body}\n\n------------------------------------------------------------\n## TIME BUDGET\n- 30 min | 1h | 2h | other:\n`;
  const cases = [
    { id: 'empty_template_section', text: section(''), objective: null },
    { id: 'source_session_template_unprepared', text: fs.readFileSync(path.resolve('scaffold/docs_audit/sessions/TEMPLATE_SESSION_SXXX.md'), 'utf8'), objective: null },
    { id: 'valid_key_before_template_placeholder', text: `session_objective: ${goal}\n${fs.readFileSync(path.resolve('scaffold/docs_audit/sessions/TEMPLATE_SESSION_SXXX.md'), 'utf8')}`, objective: goal },
    { id: 'empty_section_bounded_before_heading', text: `## SESSION OBJECTIVE\n\n## PLANNED OUTPUTS\n- ${other}\n`, objective: null },
    { id: 'empty_section_bounded_before_setext_heading', text: `## SESSION OBJECTIVE\n\nPLANNED OUTPUTS\n==============\n- ${other}\n`, objective: null },
    { id: 'plain_paragraph', text: section(goal), objective: goal },
    { id: 'wrapped_paragraph', text: section('finalize alpha\nfeature'), objective: goal },
    { id: 'paragraph_bounded_before_blank', text: section(`${goal}\n\n${other}`), objective: goal },
    { id: 'paragraph_bounded_before_setext_heading', text: `## SESSION OBJECTIVE\n\n${goal}\nPLANNED OUTPUTS\n==============\n- ${other}\n`, objective: goal },
    { id: 'paragraph_bounded_before_code', text: section(`${goal}\n\`\`\`text\n${other}\n\`\`\`\n${other}`), objective: goal },
    { id: 'legacy_bullet', text: section(`- ${goal}`), objective: goal },
    { id: 'legacy_numbered_line', text: section(`1. ${goal}`), objective: goal },
    { id: 'crlf_paragraph', text: section(goal).replaceAll('\n', '\r\n'), objective: goal },
    { id: 'session_key_priority', text: `session_objective: ${other}\nobjective: ${goal}\n${section(goal)}`, objective: other, drift: true },
    { id: 'last_valid_session_key', text: `session_objective: ${other}\nsession_objective: ${goal}\nsession_objective: unknown\n`, objective: goal },
    { id: 'last_valid_legacy_key', text: `objective: ${goal}\nobjective: TO_DEFINE\n`, objective: goal },
    { id: 'legacy_key_priority', text: `objective: ${goal}\n${section(other)}`, objective: goal },
    { id: 'numbered_key_value_preserved', text: `session_objective: 1. ${goal}\n`, objective: `1. ${goal}` },
    { id: 'quoted_keys_identical', text: 'session_objective: `Keep identifiers`\n', objective: '`Keep identifiers`', cycleGoal: '`Keep identifiers`' },
    { id: 'quoted_placeholder', text: 'session_objective: `TO_DEFINE`\n', objective: null },
    { id: 'placeholder_key_legacy_fallback', text: `session_objective: TO_DEFINE\nobjective: ${goal}\n`, objective: goal },
    { id: 'placeholder_key_section_fallback', text: section(`session_objective: TO_DEFINE\n<!-- Replace the placeholder with the session goal. -->\n${goal}`), objective: goal },
    ...['none', '(none)', 'unknown', 'TO_DEFINE', 'TBD', 'TODO', '(1 clear sentence)', '(1 phrase)']
      .map(value => ({ id: `placeholder_${value.replace(/[^a-z0-9]+/gi, '_')}`, text: section(value), objective: null })),
    { id: 'checkbox_is_not_objective', text: section('[ ] Code'), objective: null },
    { id: 'indented_code_is_not_objective', text: section(`    ${other}`), objective: null },
    { id: 'tab_indented_code_is_not_objective', text: section(`\t${other}`), objective: null },
    { id: 'indented_comment_example_ignored', text: section(`    <!--\n    session_objective: ${other}\n${goal}`), objective: goal },
    { id: 'backtick_example_ignored', text: `\`\`\`markdown\nsession_objective: ${other}\n## SESSION OBJECTIVE\n- ${other}\n\`\`\`\n${section(goal)}`, objective: goal },
    { id: 'tilde_example_ignored', text: `~~~~markdown\nobjective: ${other}\n## SESSION OBJECTIVE\n- ${other}\n~~~~\n${section(goal)}`, objective: goal },
    { id: 'comment_example_ignored', text: `<!--\nsession_objective: ${other}\n## SESSION OBJECTIVE\n- ${other}\n-->\n${section(goal)}`, objective: goal },
    { id: 'fences_inside_comment_ignored', text: `<!--\n\`\`\`\nsession_objective: ${other}\n-->\n${section(goal)}`, objective: goal },
    { id: 'comment_inside_fence_ignored', text: `\`\`\`markdown\n<!--\nsession_objective: ${other}\n\`\`\`\n${section(goal)}`, objective: goal },
    { id: 'unterminated_comment_ignored', text: `## SESSION OBJECTIVE\n<!--\nsession_objective: ${other}\n`, objective: null },
    { id: 'unterminated_fence_ignored', text: `## SESSION OBJECTIVE\n\`\`\`markdown\nsession_objective: ${other}\n`, objective: null },
    { id: 'valid_parenthetical_goal', text: section(`(${goal})`), objective: `(${goal})` },
    { id: 'real_divergence_preserved', text: section(other), objective: other, drift: true },
  ];
  const snapshot = () => {
    const files = {};
    const visit = dir => { for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === '.git') continue;
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) visit(file);
      else files[path.relative(root, file)] = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
    } };
    visit(root);
    return files;
  };
  const observations = completionContext => collectGatingObservations({
    targetRoot: root,
    eventFile: path.join(root, '.aidn/runtime/perf/workflow-events.ndjson'),
    indexSyncCheckFile: path.join(root, '.aidn/runtime/index/index-sync-check.json'),
    indexFile: path.join(root, '.aidn/runtime/index/workflow-index.sqlite'),
    indexBackend: 'sqlite', stateMode: 'files', mode: 'COMMITTING',
    reloadResult: { decision: 'full', fallback: false, reason_codes: ['BRANCH_CHANGED'] },
    gitAdapter: createLocalGitAdapter(), completionContext,
  });
  const runs = [];
  for (const testCase of cases) {
    const cycleGoal = testCase.cycleGoal ?? goal;
    const caseStatus = status.replace(`current goal: ${goal}`, `current goal: ${cycleGoal}`);
    fs.writeFileSync(statusFile, caseStatus);
    fs.writeFileSync(sessionFile, testCase.text);
    const before = snapshot();
    const observed = await observations(null);
    const gate = runJson('tools/perf/gating-evaluate.mjs', [
      '--target', root, '--state-mode', 'files', '--mode', 'COMMITTING',
      '--reload-decision', 'full', '--reload-fallback', 'false',
      '--reload-reason-codes', 'BRANCH_CHANGED', '--no-emit-event', '--json',
    ]);
    assert.deepEqual(snapshot(), before, `${testCase.id}: preview must preserve checkout and journal`);
    // The same parser must read explicitly selected terminal closure intent,
    // while ordinary observations must keep the active-only cycle rule.
    fs.writeFileSync(statusFile, caseStatus.replace(/^state: IMPLEMENTING$/m, 'state: DONE'));
    const terminalBefore = snapshot();
    const closed = await observations({ cycle_dir: 'C101-feature-alpha', session_id: 'S101' });
    const ordinaryTerminal = await observations(null);
    assert.deepEqual(snapshot(), terminalBefore, `${testCase.id}: closure observation must be read-only`);
    fs.writeFileSync(statusFile, caseStatus);
    const signals = gate.levels.level2.active_signals;
    const checks = {
      objective_expected: observed.sessionObjective === testCase.objective,
      uncertain_intent_expected: signals.includes('uncertain_intent') === (testCase.objective === null),
      objective_delta_expected: signals.includes('objective_delta') === (testCase.drift === true),
      terminal_closure_objective_expected: closed.sessionObjective === testCase.objective,
      terminal_closure_goal_expected: closed.cycleGoal === cycleGoal,
      ordinary_terminal_goal_absent: ordinaryTerminal.cycleGoal === null,
    };
    runs.push({ id: testCase.id, checks, pass: Object.values(checks).every(Boolean) });
  }
  return runs;
}

async function main() {
  const createdTargets = [];
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
    const observationsRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aidn-gating-observations-'));
    createdTargets.push(observationsRoot);
    verifyObservationBoundaries(observationsRoot);
    const hookExitPolicy = verifyHookExitPolicy();
    const tmpRoot = path.resolve(process.cwd(), args.tmpRoot);
    const objectiveRuns = await verifySessionObjectives(tmpRoot, target => createdTargets.push(target));
    verifyDriftCompletion(tmpRoot, target => createdTargets.push(target));
    const runs = CASES.map((testCase) => {
      return runCase(tmpRoot, testCase, (target) => createdTargets.push(target));
    });
    const pass = [...runs, ...objectiveRuns].every((run) => run.pass === true);
    const output = {
      ts: new Date().toISOString(),
      runs,
      session_objectives: objectiveRuns,
      hook_exit_policy: hookExitPolicy,
      pass,
    };

    if (args.json) {
      console.log(JSON.stringify(output, null, 2));
    } else {
      console.log('PASS drift completion: real skill event, subsequent admission, preview, age/branch boundaries and unresolved warning/stop');
      for (const run of objectiveRuns) console.log(`${run.pass ? "PASS" : "FAIL"} session objective: ${run.id}`);
      for (const run of runs) {
        console.log(`${run.pass ? "PASS" : "FAIL"} ${run.id}`);
      }
      console.log(`Result: ${pass ? "PASS" : "FAIL"}`);
    }

    if (!pass) {
      process.exitCode = 1;
    }
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    printUsage();
    process.exitCode = 1;
  } finally {
    if (!args?.keepTmp) for (const target of createdTargets.reverse()) {
      const cleanup = removePathWithRetry(target);
      if (!cleanup.ok) { console.error(`Cleanup failed: ${cleanup.error?.message}`); process.exitCode = 1; }
    }
  }
}

await main();
