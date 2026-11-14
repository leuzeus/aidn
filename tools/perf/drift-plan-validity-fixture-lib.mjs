import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { registerFixtureModuleMocks } from "./fixture-module-mocks.mjs";
import { shadowHash } from "../../src/core/workflow/shadow-json.mjs";
import { artifactContentHash } from "../../src/core/workflow/artifact-compare-swap.mjs";

// Exercise the production v3 finalizer, including its post-report capability
// callback. Evaluation, artifact/owner ports and the gate are controlled here;
// real report/hook persistence is covered separately by --drift-finalize-mode.
export async function verifyDriftPreparedPlanValidity(check) {
  const key = "aidn-drift-plan-validity-fixture";
  const target = new URL("../../src/application/runtime/standard-drift-finalization.mjs?plan-validity-fixture", import.meta.url).href;
  const mocked = {
    "./standard-workflow-artifacts.mjs": `export const createStandardWorkflowArtifacts = () => globalThis[Symbol.for(${JSON.stringify(key)})].artifacts;`,
    "./gating-evaluate-use-case.mjs": `export const runGatingEvaluateUseCase = options => globalThis[Symbol.for(${JSON.stringify(key)})].gate(options);`,
  };
  const hook = registerFixtureModuleMocks({ targets: [target], mocked });
  let factory;
  try { ({ createStandardDriftFinalization: factory } = await import(target)); }
  finally { await hook.deregister(); }
  const temporary = fs.realpathSync(os.tmpdir());
  const root = fs.mkdtempSync(path.join(temporary, "aidn-drift-plan-validity-"));
  let success = false;
  try {
    execFileSync("git", ["init", "-q", root], { windowsHide: true, stdio: "pipe" });
    fs.writeFileSync(path.join(root, ".gitignore"), "docs/audit/workflows/\n");
    const file = path.join(root, ".aidn/runtime/perf/workflow-events.ndjson");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const H = "a".repeat(64), id = "op_" + "a".repeat(40);
    for (const scenario of ["aged", "elapsed-after-report", "revoked-before", "prefix-before", "context-before",
      "revoked-after-report", "context-after-report", "alignment-at-hook", "lost-hook-observation"]) {
      await check("drift finalization contract prepared-plan " + scenario, async () => {
        fs.writeFileSync(file, "");
        let clock = Date.now() - (scenario === "aged" ? 86400000 : 0);
        let owner = false, writes = 0, grants = 0, evaluations = 0, hookCalls = 0, atHook = false;
        const rows = new Map(), instance = { instance_id: "fixture", instance_sha256: H };
        const alignment = { contract_version: "standard-drift-objective-disposition.v1", decision_operation_id: id,
          evaluation_operation_id: id, evaluation_sha256: H, context_sha256: H, review_sha256: H, question_sha256: H,
          source_sha256: H, receipt_sha256: H, inbox_id: "decision_" + "a".repeat(40), authority_id: "fixture_operator",
          source_event_id: "fixture", session_objective: "Current objective", cycle_objective: "Current objective",
          rationale: "Controlled validity fixture", prepared_at_ms: clock };
        const state = {
          artifacts: { root, describe: () => ({ state_mode: "files" }), ownerPending: () => owner,
            read(name) { const content = rows.get(name); return { path: name, content: content ?? null,
              sha256: content === undefined ? null : artifactContentHash(content) }; },
            async withLocalEffectOwner(_id, action) { assert.equal(owner, false); owner = true;
              try { return await action(); } finally { owner = false; } },
            compareAndSwap(change) { assert.equal(rows.has(change.path), false); rows.set(change.path, change.after); writes++;
              if (scenario === "elapsed-after-report") clock += 86400000; }, project() {} },
          async gate({ args, verifyObjectiveAlignment }) {
            const levels = { level1: { decision: "proceed" }, level2: { required: true, active_signals: ["objective_delta"] }, level3: { required: false } };
            if (!args.emitEvent) return { result: "ok", levels };
            hookCalls++; atHook = true;
            const completion = await verifyObjectiveAlignment();
            const event = { run_id: args.runId, event: "drift_check_completed", skill: "drift-check", result: "ok",
              mode: "COMMITTING", branch: "fixture", ts: new Date(clock).toISOString(), objective_alignment_sha256: shadowHash(completion) };
            fs.appendFileSync(file, JSON.stringify(event) + "\n");
            if (scenario === "lost-hook-observation") throw Object.assign(Error("FIXTURE_HOOK_OBSERVATION_LOST"), { code: "FIXTURE_HOOK_OBSERVATION_LOST" });
            return { ok: true, result: "ok", branch: "fixture", ts: event.ts, mode: "COMMITTING", objective_alignment: completion };
          },
        };
        globalThis[Symbol.for(key)] = state;
        const finalizer = factory({ targetRoot: root, now: () => clock,
          readEvaluation: async () => { evaluations++;
            const changed = scenario === "context-before" && evaluations > 1 || scenario === "context-after-report" && writes > 0;
            return { context: { contract_version: "standard-drift-context.v2", branch: "fixture", head: "a".repeat(40), mode: "COMMITTING" },
              context_sha256: changed ? "b".repeat(64) : H, evaluation_sha256: H,
              output: { facts: { drift_present: false, drift_context_complete: true, drift_recovery_required: false },
                observations: { report: { drift_level: "none" }, producer: { kind: "fixture" } } } }; },
          readCurrent: () => scenario === "prefix-before" && grants > 0 ? { ...instance, instance_sha256: "c".repeat(64) } : instance,
          readObjectiveAlignment: async () => scenario === "alignment-at-hook" && atHook ? { ...alignment, source_event_id: "changed" } : alignment });
        const prepared = await finalizer.prepare(instance, { evaluation_operation_id: id }, id);
        assert.equal(prepared.can_apply, true, JSON.stringify(prepared));
        assert.equal(prepared.plan.contract_version, "standard-drift-finalize-plan.v3");
        assert.equal(writes, 0);
        if (scenario === "aged") clock += 86400000;
        const applying = finalizer.apply(instance, prepared, { write: true, expectPlan: prepared.plan_sha256,
          assertAuthorized: async () => { grants++;
            if (scenario === "revoked-before" || scenario === "revoked-after-report" && writes > 0)
              throw Object.assign(Error("AUTHORIZATION_REVOKED"), { code: "AUTHORIZATION_REVOKED" }); } });
        if (["revoked-before", "prefix-before", "context-before"].includes(scenario)) {
          const code = scenario === "revoked-before" ? "AUTHORIZATION_REVOKED"
            : scenario === "prefix-before" ? "STANDARD_DRIFT_PROCESS_CHANGED" : "STANDARD_DRIFT_PREVIEW_CHANGED";
          await assert.rejects(applying, { code, effect_status: "no_effect" });
          assert.equal(writes, 0); assert.equal(hookCalls, 0); assert.equal(fs.readFileSync(file, "utf8"), "");
        } else {
          const result = await applying, confirmed = ["aged", "elapsed-after-report"].includes(scenario);
          assert.equal(result.outcome, confirmed ? "completed" : "reconciliation_required", JSON.stringify(result));
          assert.equal(result.effect_status, confirmed ? "confirmed" : "unknown");
          assert.equal(writes, 1); assert.equal(rows.get(prepared.plan.report.path), prepared.plan.report.after);
          const expected = { "revoked-after-report": "AUTHORIZATION_REVOKED", "context-after-report": "STANDARD_DRIFT_CONTEXT_CHANGED",
            "alignment-at-hook": "STANDARD_DRIFT_OBJECTIVE_ALIGNMENT_CHANGED", "lost-hook-observation": "FIXTURE_HOOK_OBSERVATION_LOST" };
          if (!confirmed) { assert.equal(result.observations.reason_code, expected[scenario]); assert.deepEqual(result.facts, {}); }
          const eventCount = fs.readFileSync(file, "utf8").trim().split("\n").filter(Boolean).length;
          assert.equal(eventCount, confirmed || scenario === "lost-hook-observation" ? 1 : 0);
        }
        assert.equal(owner, false);
      });
    }
    success = true;
  } finally {
    delete globalThis[Symbol.for(key)];
    if (success) {
      const real = fs.realpathSync(root);
      if (path.dirname(real) !== temporary || !path.basename(real).startsWith("aidn-drift-plan-validity-")) throw Error("FIXTURE_CLEANUP_SCOPE_INVALID");
      fs.rmSync(real, { recursive: true, force: true });
    } else console.error(JSON.stringify({ retained_fixture_root: root, scope: "controlled-v3-drift-plan-validity" }));
  }
}
