#!/usr/bin/env node
import fs from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createArtifactStore } from "../../src/adapters/runtime/artifact-store.mjs";
import { removePathWithRetry } from "./test-git-fixture-lib.mjs";
import { runSessionPlan } from '../runtime/session-plan.mjs';

function parseArgs(argv) {
  const args = {
    target: "tests/fixtures/repo-installed-core",
    tempRoot: "tmp/perf-session-plan",
    sqliteFile: ".aidn/runtime/index/workflow-index.sqlite",
    json: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--target") {
      args.target = argv[i + 1] ?? "";
      i += 1;
    } else if (token === "--temp-root") {
      args.tempRoot = argv[i + 1] ?? "";
      i += 1;
    } else if (token === "--sqlite-file") {
      args.sqliteFile = argv[i + 1] ?? "";
      i += 1;
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
  console.log("  node tools/perf/verify-session-plan-fixtures.mjs");
  console.log("  node tools/perf/verify-session-plan-fixtures.mjs --target tests/fixtures/repo-installed-core --json");
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function runJson(script, scriptArgs, cwd = process.cwd()) {
  const file = path.resolve(process.cwd(), script);
  const stdout = execFileSync(process.execPath, [file, ...scriptArgs], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return JSON.parse(stdout);
}

function copyFixture(source, target) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.cpSync(source, target, { recursive: true, force: true });
}

function readText(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

async function main() {
  let tempTarget = null;
  try {
    const args = parseArgs(process.argv.slice(2));
    const repoRoot = process.cwd();
    const sourceTarget = path.resolve(repoRoot, args.target);
    tempTarget = path.resolve(repoRoot, args.tempRoot);
    const sqliteFile = path.resolve(tempTarget, args.sqliteFile);

    removePathWithRetry(tempTarget);
    copyFixture(sourceTarget, tempTarget);

    const dualResult = runJson("tools/runtime/session-plan.mjs", [
      "--target",
      tempTarget,
      "--session-id",
      "S401",
      "--item",
      "define shared session backlog",
      "--question",
      "which cycle should be created first?",
      "--next-step",
      "select the first cycle scope",
      "--promote",
      "--state-mode",
      "dual",
      "--sqlite-file",
      sqliteFile,
      "--json",
    ]);

    const draftResult = runJson("tools/runtime/session-plan.mjs", [
      "--target",
      tempTarget,
      "--session-id",
      "S402",
      "--item",
      "triage planning draft",
      "--question",
      "resume or create cycle?",
      "--next-step",
      "choose the first dispatch scope",
      "--draft-file",
      ".aidn/runtime/context/session-plan-draft-alt.json",
      "--state-mode",
      "db-only",
      "--json",
    ]);

    const updateResult = runJson("tools/runtime/session-plan.mjs", [
      "--target",
      tempTarget,
      "--session-id",
      "S401",
      "--item",
      "record coordinator addendum",
      "--question",
      "is arbitration needed before dispatch?",
      "--next-step",
      "select the coordinating agent and dispatch scope",
      "--selected-execution-scope",
      "new_cycle",
      "--dispatch-scope",
      "session",
      "--dispatch-action",
      "coordinate",
      "--planning-arbitration-status",
      "review_requested",
      "--source-agent",
      "codex-auditor",
      "--rationale",
      "arbitration follow-up from auditor review",
      "--affected-item",
      "record coordinator addendum",
      "--affected-question",
      "is arbitration needed before dispatch?",
      "--addendum-note",
      "auditor requested explicit arbitration trace",
      "--promote",
      "--state-mode",
      "dual",
      "--sqlite-file",
      sqliteFile,
      "--json",
    ]);

    const currentStatePath = path.join(tempTarget, "docs", "audit", "CURRENT-STATE.md");
    const backlogPath = path.join(tempTarget, "docs", "audit", "backlog", "BL-S401-session-planning.md");
    const draftPath = path.join(tempTarget, ".aidn", "runtime", "context", "session-plan-draft.json");
    const altDraftPath = path.join(tempTarget, ".aidn", "runtime", "context", "session-plan-draft-alt.json");

    assert(fs.existsSync(draftPath), "missing promoted draft file");
    assert(fs.existsSync(altDraftPath), "missing draft-only file");
    assert(fs.existsSync(backlogPath), "missing promoted backlog file");
    const currentStateText = readText(currentStatePath);
    const backlogText = readText(backlogPath);
    assert(currentStateText.includes("active_session: S401"), "CURRENT-STATE missing active_session update");
    assert(currentStateText.includes("contract_version: critical-markdown-v1"), "CURRENT-STATE missing explicit contract version");
    assert(currentStateText.includes("source_of_truth:"), "CURRENT-STATE missing source_of_truth");
    assert(currentStateText.includes("source_mode: explicit"), "CURRENT-STATE missing source_mode");
    assert(currentStateText.includes("lifecycle_status: refreshed"), "CURRENT-STATE missing lifecycle_status");
    assert(currentStateText.includes("active_backlog: backlog/BL-S401-session-planning.md"), "CURRENT-STATE missing active_backlog update");
    assert(currentStateText.includes("backlog_status: promoted"), "CURRENT-STATE missing backlog_status update");
    assert(currentStateText.includes("backlog_next_step: select the coordinating agent and dispatch scope"), "CURRENT-STATE missing merged backlog_next_step update");
    assert(currentStateText.includes("backlog_selected_execution_scope: new_cycle"), "CURRENT-STATE missing selected execution scope update");
    assert(currentStateText.includes("planning_arbitration_status: review_requested"), "CURRENT-STATE missing merged planning_arbitration_status update");
    assert(backlogText.includes("- define shared session backlog"), "backlog missing initial item");
    assert(backlogText.includes("- record coordinator addendum"), "backlog missing merged item");
    assert(backlogText.includes("- which cycle should be created first?"), "backlog missing initial question");
    assert(backlogText.includes("- is arbitration needed before dispatch?"), "backlog missing merged question");
    assert(backlogText.includes("next_dispatch_scope: session"), "backlog missing merged dispatch scope");
    assert(backlogText.includes("next_dispatch_action: coordinate"), "backlog missing merged dispatch action");
    assert(backlogText.includes("planning_arbitration_status: review_requested"), "backlog missing merged arbitration status");
    assert(backlogText.includes("backlog_next_step: select the coordinating agent and dispatch scope"), "backlog missing merged next step");
    assert(backlogText.includes("selected_execution_scope: new_cycle"), "backlog missing selected execution scope");
    assert(backlogText.includes("rationale: arbitration follow-up from auditor review"), "backlog missing structured addendum rationale");
    assert(backlogText.includes("affected_item: record coordinator addendum"), "backlog missing structured affected item");
    assert(backlogText.includes("affected_question: is arbitration needed before dispatch?"), "backlog missing structured affected question");
    assert(backlogText.includes("note: auditor requested explicit arbitration trace"), "backlog missing structured addendum note");
    assert((backlogText.match(/agent_role:/g) ?? []).length === 2, "backlog should keep both addenda entries");

    const store = createArtifactStore({ sqliteFile });
    let backlogArtifact;
    let currentStateArtifact;
    try {
      backlogArtifact = store.getArtifact("backlog/BL-S401-session-planning.md");
      currentStateArtifact = store.getArtifact("CURRENT-STATE.md");
    } finally {
      store.close();
    }

    assert(dualResult.db_first_applied === true, "expected dual promotion to apply db-first writes");
    assert(dualResult.session_plan_diagnostic?.scope === "runtime-session-plan", "expected dual promotion to expose session-plan diagnostic");
    assert(dualResult.session_plan_diagnostic?.backlog_operation === "created", "expected dual promotion to expose created backlog diagnostic");
    assert(Array.isArray(dualResult.db_first_writes) && dualResult.db_first_writes.length === 2, "expected two db-first writes for promote");
    assert(dualResult.backlog_operation === "created", "initial promotion should create the shared backlog");
    assert(draftResult.db_first_applied === false, "draft-only session-plan should not apply db-first writes");
    assert(draftResult.session_plan_diagnostic?.promoted === false, "draft-only session-plan should expose non-promoted diagnostic");
    assert(updateResult.db_first_applied === true, "merged promotion should still apply db-first writes");
    assert(updateResult.session_plan_diagnostic?.backlog_operation === "updated", "merged promotion should expose updated backlog diagnostic");
    assert(Array.isArray(updateResult.db_first_writes) && updateResult.db_first_writes.length === 2, "expected two db-first writes for backlog update");
    assert(updateResult.backlog_operation === "updated", "second promotion should update the shared backlog");
    assert(backlogArtifact && backlogArtifact.path === "backlog/BL-S401-session-planning.md", "missing backlog artifact in sqlite store");
    assert(currentStateArtifact && currentStateArtifact.path === "CURRENT-STATE.md", "missing CURRENT-STATE artifact in sqlite store");

    const beforeRefusal = [backlogPath, draftPath, currentStatePath].map(file => readText(file));
    let planningWrites = 0;
    const reservedCoordination = {
      enabled: true, configured: true, backend_kind: 'postgres', status: 'ready',
      store: {
        async healthcheck() { return { ok: true, schema_status: 'ready', compatibility_status: 'project-scoped' }; },
        async getPlanningState() { return { ok: true, planning_state: null }; },
        async registerWorkspace() { return { ok: true }; },
        async registerWorktreeHeartbeat() { return { ok: true }; },
        async upsertPlanningState() {
          planningWrites++;
          return { ok: false, error: { code: 'SHARED_EXECUTION_SCOPE_RESERVED', message: 'SHARED_EXECUTION_SCOPE_RESERVED' } };
        },
      },
    };
    let reservationRefused = false;
    try {
      await runSessionPlan({ targetRoot: tempTarget, sessionId: 'S401', promote: true, dbFirst: 'false', stateMode: 'files',
        nextStep: 'must not replace the accepted projection', sharedCoordination: reservedCoordination });
    } catch (error) {
      reservationRefused = error.code === 'ARTIFACT_EXECUTION_SCOPE_RESERVED';
    }
    assert(reservationRefused && planningWrites === 1, 'reserved shared planning must refuse before visible projection');
    assert(JSON.stringify([backlogPath, draftPath, currentStatePath].map(file => readText(file))) === JSON.stringify(beforeRefusal),
      'reserved planning must preserve backlog, draft and current-state bytes');

    let publishedPlanning = null;
    let previousBacklogAtSync = "";
    const acceptingCoordination = {
      ...reservedCoordination,
      store: {
        ...reservedCoordination.store,
        async upsertPlanningState(input) {
          publishedPlanning = input;
          previousBacklogAtSync = readText(backlogPath);
          return { ok: true, planning_state: { ...input, revision: 1 } };
        },
      },
    };
    const hashedPromotion = await runSessionPlan({
      targetRoot: tempTarget, sessionId: "S401", promote: true, stateMode: "dual", sqliteFile,
      items: ["préparer la délégation et vérifier les références"],
      nextStep: "qualifier le contenu canonique exact", sharedCoordination: acceptingCoordination,
    });
    const canonicalStore = createArtifactStore({ sqliteFile });
    let publishedArtifact;
    try { publishedArtifact = canonicalStore.getArtifact("backlog/BL-S401-session-planning.md"); }
    finally { canonicalStore.close(); }
    const publishedContent = Buffer.from(publishedArtifact.content, publishedArtifact.content_format === "base64" ? "base64" : "utf8");
    const expectedHash = createHash("sha256").update(publishedContent).digest("hex");
    assert(hashedPromotion.shared_coordination_sync.ok === true, "shared planning promotion should succeed");
    assert(publishedPlanning.backlogArtifactSha256 === expectedHash && publishedArtifact.sha256 === expectedHash,
      "shared planning hash must identify the exact canonical backlog bytes");
    assert(fs.readFileSync(backlogPath).equals(publishedContent), "materialized backlog must equal the hashed canonical artifact");
    assert(publishedPlanning.backlogArtifactSha256 !== createHash("sha256").update(previousBacklogAtSync, "utf8").digest("hex"),
      "shared planning must hash the prepared candidate before writing, not the old projection");

    const output = {
      ts: new Date().toISOString(),
      source_target: sourceTarget,
      temp_target: tempTarget,
      sqlite_file: sqliteFile,
      dual_result: dualResult,
      draft_result: draftResult,
      update_result: updateResult,
      checks: {
        backlog_file_exists: fs.existsSync(backlogPath),
        promoted_draft_exists: fs.existsSync(draftPath),
        draft_only_exists: fs.existsSync(altDraftPath),
        current_state_updated: currentStateText.includes("active_backlog: backlog/BL-S401-session-planning.md"),
        backlog_merged_update: backlogText.includes("- record coordinator addendum"),
        sqlite_backlog_present: Boolean(backlogArtifact),
        sqlite_current_state_present: Boolean(currentStateArtifact),
        reserved_planning_preserves_local_files: reservationRefused,
        shared_planning_hash_matches_canonical_content: publishedPlanning.backlogArtifactSha256 === expectedHash,
      },
      pass: true,
    };

    if (args.json) {
      console.log(JSON.stringify(output, null, 2));
    } else {
      console.log(`Target: ${sourceTarget}`);
      console.log(`Temp target: ${tempTarget}`);
      console.log("Result: PASS");
    }
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    printUsage();
    process.exit(1);
  } finally {
    if (tempTarget) {
      removePathWithRetry(tempTarget);
    }
  }
}

main();
