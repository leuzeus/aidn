#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { removePathWithRetry, initGitRepo } from "./test-git-fixture-lib.mjs";
import { prepareActivationFixture } from "./test-activation-fixture-lib.mjs";
import { normalizeHookPayload } from "../../src/application/codex/normalize-hook-payload.mjs";

function parseArgs(argv) {
  const args = {
    target: "tests/fixtures/perf-structure/session-rich",
    json: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--target") {
      args.target = String(argv[i + 1] ?? "").trim();
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
  console.log("  node tools/perf/verify-agent-hook-repair-layer-fixtures.mjs");
}

function runJson(script, scriptArgs, env = {}, expectStatus = 0) {
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
    if (expectStatus !== 0) {
      throw new Error(`Command unexpectedly succeeded: ${script}`);
    }
    return JSON.parse(stdout);
  } catch (error) {
    if (Number(error?.status ?? 0) !== expectStatus) {
      throw error;
    }
    const stdout = String(error?.stdout ?? "").trim();
    return JSON.parse(stdout);
  }
}

function verifyObservedGateProjection(tempRoot) {
  const finding = { severity: "warn", finding_type: "STALE_CONTEXT", entity_id: "C101", message: "Reanchor current context." };
  const gate = {
    ok: false, result: "warn", action: "run_conditional_drift_check", reason_code: "L2_SIGNAL_TRIGGERED",
    levels: {
      level1: { reason_codes: ["BRANCH_CHANGED", "ARTIFACTS_CHANGED"] },
      level2: { repair_layer_open_count: 1, repair_layer_top_findings: [finding] },
      level3: { repair_layer_blocking: false },
    },
  };
  const forms = {
    direct_gating: gate,
    skill_payload: { ...gate, levels: undefined, payload: gate },
    checkpoint_gate: { ...gate, levels: undefined, gate },
    payload_checkpoint_gate: { ...gate, levels: undefined, payload: { checkpoint: { gate } } },
    branch_cycle_gating: { ...gate, levels: undefined, payload: { gating: gate } },
    session_workflow_checkpoint: { ...gate, levels: undefined, payload: { workflow_hook: { checkpoint: { gate } } } },
  };
  const checks = {};
  for (const [name, value] of Object.entries(forms)) {
    const normalized = normalizeHookPayload(value);
    checks[`${name}_keeps_reload_causes`] = JSON.stringify(normalized.reason_codes) === JSON.stringify(gate.levels.level1.reason_codes);
    checks[`${name}_keeps_repair_evidence`] = normalized.repair_layer_open_count === 1
      && normalized.repair_layer_blocking === false && normalized.repair_layer_status === "warn"
      && normalized.repair_layer_top_findings[0]?.entity_id === "C101"
      && normalized.repair_primary_reason?.includes("STALE_CONTEXT") === true;
  }
  const empty = normalizeHookPayload({ ok: true, result: "ok" });
  checks.absent_repair_evidence_is_unknown = empty.repair_layer_status === null
    && empty.repair_layer_advice === null && empty.repair_primary_reason === null;
  const clean = normalizeHookPayload({ levels: {
    level2: { repair_layer_open_count: 0, repair_layer_top_findings: [] },
    level3: { repair_layer_blocking: false },
  } });
  checks.observed_zero_and_false_prove_clean = clean.repair_layer_open_count === 0
    && clean.repair_layer_blocking === false && clean.repair_layer_status === "clean";
  const partial = normalizeHookPayload({
    levels: { level1: { reason_codes: ["HEAD_CHANGED"] } },
    payload: { levels: gate.levels },
  });
  checks.one_gate_cannot_borrow_nested_repair_evidence = partial.repair_layer_status === null
    && JSON.stringify(partial.reason_codes) === '["HEAD_CHANGED"]';
  const explicit = normalizeHookPayload({
    repair_layer_status: "warn", repair_layer_advice: "Review declared repair findings.",
    repair_primary_reason: "Declared repair finding.",
  });
  checks.explicit_root_repair_diagnostic_is_preserved = explicit.repair_layer_status === "warn"
    && explicit.repair_primary_reason === "Declared repair finding.";
  const precedence = normalizeHookPayload({
    payload: { summary: { repair_layer_open_count: 2, repair_layer_blocking: true, repair_layer_status: "block" },
      checkpoint: { summary: { repair_layer_open_count: 0, repair_layer_blocking: false, repair_layer_status: "clean" } } },
    summary: { repair_layer_status: "warn" },
  });
  checks.existing_summary_precedence_is_preserved = precedence.repair_layer_open_count === 2
    && precedence.repair_layer_blocking === true && precedence.repair_layer_status === "block";

  const splitMeasurements = {
    gate_count_summary_blocking: {
      levels: { level2: { repair_layer_open_count: 0 } },
      payload: { summary: { repair_layer_blocking: false } },
    },
    summary_count_gate_blocking: {
      payload: { summary: { repair_layer_open_count: 0 } },
      levels: { level3: { repair_layer_blocking: false } },
    },
    different_summaries: {
      payload: { summary: { repair_layer_open_count: 0 } },
      summary: { repair_layer_blocking: false },
    },
    input_and_payload: { repair_layer_open_count: 0, payload: { repair_layer_blocking: false } },
    partial_summary_complete_gate: {
      payload: { summary: { repair_layer_open_count: 0 } },
      levels: { level2: { repair_layer_open_count: 1 }, level3: { repair_layer_blocking: false } },
    },
  };
  for (const [name, input] of Object.entries(splitMeasurements)) {
    const normalized = normalizeHookPayload(input);
    checks[`${name}_cannot_manufacture_repair_diagnostic`] = normalized.repair_layer_status === null
      && normalized.repair_layer_advice === null && normalized.repair_primary_reason === null;
  }
  for (const [name, count] of Object.entries({ boolean: false, empty_array: [], array: [0], object: {}, blank: " " })) {
    const normalized = normalizeHookPayload({ summary: {
      repair_layer_open_count: count, repair_layer_blocking: false,
    } });
    checks[`invalid_${name}_count_cannot_prove_clean`] = normalized.repair_layer_status === null
      && normalized.repair_layer_advice === null && normalized.repair_primary_reason === null;
  }
  const numericString = normalizeHookPayload({ summary: {
    repair_layer_open_count: "0", repair_layer_blocking: false,
  } });
  checks.numeric_string_count_keeps_compatibility = numericString.repair_layer_status === "clean";

  for (const [name, input] of Object.entries({
    warning: forms.skill_payload,
    blocked: { ...gate, result: "stop", reason_code: "L3_BLOCKING", payload: {
      checkpoint: { reload: { reason_codes: ["MAPPING_MISSING"] }, gate: { levels: {
        level2: { repair_layer_open_count: 2, repair_layer_top_findings: [finding] },
        level3: { repair_layer_blocking: true },
      } } },
    }, levels: undefined },
    absent: { ok: false, result: "stop", reason_code: "HOOK_CHECKPOINT_FAILED" },
    split_summary_gate: splitMeasurements.summary_count_gate_blocking,
    split_gate_summary: splitMeasurements.gate_count_summary_blocking,
    invalid_boolean_count: { summary: { repair_layer_open_count: false, repair_layer_blocking: false } },
  })) {
    const file = path.join(tempRoot, `normalization-${name}.json`);
    fs.writeFileSync(file, JSON.stringify(input));
    const output = runJson("tools/codex/normalize-hook-payload.mjs", ["--in", file, "--json"]);
    checks[`normalization_cli_${name}_keeps_primary_cause`] = output.reason_code === (input.reason_code ?? null);
    checks[`normalization_cli_${name}_keeps_observation_state`] = output.repair_layer_status
      === ({ warning: "warn", blocked: "block" }[name] ?? null);
    if (name === "blocked") checks.normalization_cli_blocked_keeps_reload_blocker = output.reason_codes.includes("MAPPING_MISSING");
  }
  return checks;
}

function main() {
  let tempRoot = "";
  try {
    const args = parseArgs(process.argv.slice(2));
    const sourceTarget = path.resolve(process.cwd(), args.target);
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aidn-agent-hook-repair-"));
    const target = path.join(tempRoot, "repo");
    fs.cpSync(sourceTarget, target, { recursive: true });
    fs.rmSync(path.join(target, ".aidn"), { recursive: true, force: true });
    initGitRepo(target, { workingBranch: "fixture" });
    prepareActivationFixture(target);
    const observedGateChecks = verifyObservedGateProjection(tempRoot);

    runJson("tools/perf/index-sync.mjs", [
      "--target",
      target,
      "--store",
      "sqlite",
      "--json",
    ]);

    const env = {
      AIDN_STATE_MODE: "db-only",
      AIDN_INDEX_STORE_MODE: "sqlite",
    };

    const skillHook = runJson("tools/perf/skill-hook.mjs", [
      "--skill",
      "close-session",
      "--target",
      target,
      "--mode",
      "COMMITTING",
      "--no-auto-skip-gate",
      "--json",
    ], env);

    const runJsonHook = runJson("tools/codex/run-json-hook.mjs", [
      "--skill",
      "close-session",
      "--mode",
      "COMMITTING",
      "--target",
      target,
      "--state-mode",
      "db-only",
      "--no-auto-skip-gate",
      "--json",
    ], env, 1);

    const checks = {
      ...observedGateChecks,
      skill_hook_structured_output_present: skillHook && typeof skillHook === "object",
      skill_hook_result_present: ["ok", "stop"].includes(String(skillHook?.result ?? "")),
      skill_hook_status_present: ["clean", "warn", "block"].includes(String(skillHook?.repair_layer_status ?? "")),
      skill_hook_advice_present: String(skillHook?.repair_layer_advice ?? "").length >= 1,
      skill_hook_primary_reason_present: String(skillHook?.repair_primary_reason ?? "").length >= 1,
      skill_hook_top_findings_shape_present: Array.isArray(skillHook?.repair_layer_top_findings),
      run_json_hook_structured_output_present: runJsonHook && typeof runJsonHook === "object",
      run_json_hook_stop_is_a_workflow_decision: runJsonHook?.result === "stop"
        && runJsonHook?.command_status === 0 && runJsonHook?.error == null,
      run_json_hook_open_count_present: Number(runJsonHook?.repair_layer_open_count ?? 0) >= 0,
      run_json_hook_status_present: ["clean", "warn", "block"].includes(String(runJsonHook?.repair_layer_status ?? "")),
      run_json_hook_advice_present: String(runJsonHook?.repair_layer_advice ?? "").length >= 1,
      run_json_hook_primary_reason_present: String(runJsonHook?.repair_primary_reason ?? "").length >= 1,
      run_json_hook_top_findings_shape_present: Array.isArray(runJsonHook?.repair_layer_top_findings),
      run_json_hook_summary_present: Number(runJsonHook?.summary?.repair_layer_open_count ?? 0) >= 0
        && ["clean", "warn", "block"].includes(String(runJsonHook?.summary?.repair_layer_status ?? "")),
      run_json_hook_enrichment_preserves_or_increases_open_count: Number(runJsonHook?.repair_layer_open_count ?? -1)
        >= Number(skillHook?.repair_layer_open_count ?? -2),
      run_json_hook_enrichment_preserves_or_increases_findings: Number(runJsonHook?.repair_layer_top_findings?.length ?? 0)
        >= Number(skillHook?.repair_layer_top_findings?.length ?? 0),
      run_json_hook_primary_reason_differs_when_db_sync_finds_more_context:
        Number(runJsonHook?.repair_layer_top_findings?.length ?? 0) === 0
        || String(runJsonHook?.repair_primary_reason ?? "") !== String(skillHook?.repair_primary_reason ?? ""),
    };
    const pass = Object.values(checks).every((value) => value === true);
    const output = {
      ts: new Date().toISOString(),
      source_target: sourceTarget,
      target_root: target,
      checks,
      samples: {
        skill_hook: {
          result: skillHook?.payload?.summary?.result ?? null,
          repair_layer_open_count: skillHook?.repair_layer_open_count ?? null,
          repair_layer_status: skillHook?.repair_layer_status ?? null,
          repair_primary_reason: skillHook?.repair_primary_reason ?? null,
          top_finding: skillHook?.repair_layer_top_findings?.[0] ?? null,
        },
        run_json_hook: {
          result: runJsonHook?.summary?.result ?? null,
          repair_layer_open_count: runJsonHook?.repair_layer_open_count ?? null,
          repair_layer_status: runJsonHook?.repair_layer_status ?? null,
          repair_primary_reason: runJsonHook?.repair_primary_reason ?? null,
          summary_repair_layer_open_count: runJsonHook?.summary?.repair_layer_open_count ?? null,
          top_finding: runJsonHook?.repair_layer_top_findings?.[0] ?? null,
        },
      },
      pass,
    };

    if (args.json) {
      console.log(JSON.stringify(output, null, 2));
    } else {
      console.log(`Target: ${sourceTarget}`);
      for (const [name, value] of Object.entries(checks)) {
        console.log(`${value ? "PASS" : "FAIL"} ${name}`);
      }
      console.log(`Result: ${pass ? "PASS" : "FAIL"}`);
    }

    if (!pass) {
      process.exit(1);
    }
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    printUsage();
    process.exit(1);
  } finally {
    if (tempRoot && fs.existsSync(tempRoot)) {
      removePathWithRetry(tempRoot);
    }
  }
}

main();
