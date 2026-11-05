import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { createStandardWorkflowArtifacts } from "./standard-workflow-artifacts.mjs";
import { runGatingEvaluateUseCase } from "./gating-evaluate-use-case.mjs";
import { runSkillHookUseCase } from "./skill-hook-use-case.mjs";
import { createLocalProcessAdapter } from "../../adapters/runtime/local-process-adapter.mjs";
import { agentRunPhysicalPath } from "./agent-run-configuration-service.mjs";
import { shadowHash } from "../../core/workflow/shadow-json.mjs";
import { artifactContentHash } from "../../core/workflow/artifact-compare-swap.mjs";
import { assertStandardOperationInput, assertStandardOperationOutput } from "../../core/workflow/standard-operation-contracts.mjs";
import { validateJsonSchema } from "../../core/contracts/json-schema-validator.mjs";
import planSchema from "../../core/contracts/workflow-definition/standard-drift-finalize-plan.v1.schema.json" with { type: "json" };
import planSchemaV2 from "../../core/contracts/workflow-definition/standard-drift-finalize-plan.v2.schema.json" with { type: "json" };
import planSchemaV3 from "../../core/contracts/workflow-definition/standard-drift-finalize-plan.v3.schema.json" with { type: "json" };

const fail = code => { throw Object.assign(new Error(code), { code }); };
const eventRelative = ".aidn/runtime/perf/workflow-events.ndjson";
const schemaFor = plan => plan?.contract_version === "standard-drift-finalize-plan.v3" ? planSchemaV3 : plan?.contract_version === "standard-drift-finalize-plan.v2" ? planSchemaV2 : planSchema;
const planMode = plan => ["standard-drift-finalize-plan.v2", "standard-drift-finalize-plan.v3"].includes(plan.contract_version) ? plan.mode : "COMMITTING";
const emit = (outcome, effect_status, observations, facts = {}, evidence_refs = []) => assertStandardOperationOutput({
  contract_version: "standard-drift-output.v1", operation_ref: "drift_check_finalize", outcome, effect_status, observations, facts, evidence_refs });
export async function observeStandardDriftGate(artifacts, mode) {
  return runGatingEvaluateUseCase({ targetRoot: artifacts.root, runtimeDir: fileURLToPath(new URL("../../../tools/perf/", import.meta.url)), args: {
    cache: ".aidn/runtime/cache/reload-state.json", eventFile: eventRelative, indexSyncCheckFile: ".aidn/runtime/index/index-sync-check.json",
    stateMode: artifacts.describe().state_mode, stateModeExplicit: true, indexFile: ".aidn/runtime/index/workflow-index.sqlite", indexBackend: "auto",
    thresholdFiles: 3, thresholdMinutes: 45, mode, runId: "", reloadDecision: "", reloadFallback: "", reloadReasonCodes: "", emitEvent: false, completeDriftCheck: true,
  } });
}
export function createStandardDriftFinalization({ targetRoot, readEvaluation, readCurrent, readObjectiveAlignment = null, now = Date.now }) {
  if (typeof readEvaluation !== "function" || typeof readCurrent !== "function") fail("STANDARD_DRIFT_AUTHORITY_UNAVAILABLE");
  const artifacts = createStandardWorkflowArtifacts({ targetRoot }), root = artifacts.root;
  const eventPath = () => agentRunPhysicalPath(path.join(root, eventRelative), { missing: true });
  async function prepare(instance, input, operationId, preparedAt, acquired = false) {
    assertStandardOperationInput("drift_check_finalize", input);
    if (!/^op_[a-f0-9]{40}$/.test(operationId ?? "")) fail("STANDARD_DRIFT_OPERATION_ID_INVALID");
    const verified = await readEvaluation(instance, input), result = verified.output;
    const mode = verified.context.contract_version === "standard-drift-context.v2" ? verified.context.mode : "COMMITTING";
    if (!["THINKING", "EXPLORING", "COMMITTING"].includes(mode)) fail("STANDARD_DRIFT_MODE_CHANGED");
    if (result.facts.drift_present !== false || result.facts.drift_context_complete !== true || result.facts.drift_recovery_required !== false)
      return { can_apply: false, reason_code: "STANDARD_DRIFT_RECOVERY_REQUIRED" };
    if (!acquired && artifacts.ownerPending()) return { can_apply: false, reason_code: "STANDARD_EFFECT_OWNER_RECONCILIATION_REQUIRED" };
    const reportPath = `workflows/drift-reports/${operationId}.md`;
    const ignored = spawnSync("git", ["-C", root, "-c", "core.fsmonitor=false", "check-ignore", "--quiet", "--", "docs/audit/" + reportPath],
      { encoding: "utf8", shell: false, windowsHide: true, timeout: 10000, env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" } });
    if (ignored.status !== 0) return { can_apply: false, reason_code: "STANDARD_DRIFT_REPORT_PROJECTION_POLICY_REQUIRED" };
    if (artifacts.read(reportPath).sha256 !== null) return { can_apply: false, reason_code: "STANDARD_DRIFT_REPORT_RECONCILIATION_REQUIRED" };
    const gate = await observeStandardDriftGate(artifacts, mode);
    const constraints = { level1: gate.levels.level1, level3: gate.levels.level3,
      other_signals: gate.levels.level2.active_signals.filter(value => value !== "time_since_last_drift_check") };
    let alignment = null;
    if (gate.levels.level1.decision !== "stop" && !gate.levels.level3.required
      && shadowHash(constraints.other_signals) === shadowHash(["objective_delta"]) && typeof readObjectiveAlignment === "function")
      alignment = await readObjectiveAlignment(instance, input, verified);
    if (gate.levels.level1.decision === "stop" || gate.levels.level3.required || constraints.other_signals.length && alignment === null)
      return { can_apply: false, reason_code: "STANDARD_DRIFT_GATE_BLOCKED", gate };
    const body = { evaluation_operation_id: input.evaluation_operation_id, evaluation_sha256: verified.evaluation_sha256,
      context_sha256: verified.context_sha256, report: result.observations.report, producer: result.observations.producer,
      ...(alignment === null ? {} : { objective_alignment: alignment }) };
    const after = `# Drift report\n\ncontract_version: critical-markdown-v1\nid: drift-${operationId}\ntype: drift_report\nowner: aidn-drift-check\nsteward: project-maintainer\nprivacy_classification: project-internal\nretention_policy: retain-with-process-instance\nsource_of_truth: agentic_process_instance\nsource_mode: ${artifacts.describe().state_mode}\nlifecycle_status: retained\nupdated_at: ${new Date(preparedAt).toISOString()}\n\n\`\`\`json\n${JSON.stringify(body, null, 2)}\n\`\`\`\n`;
    const plan = { contract_version: alignment === null ? "standard-drift-finalize-plan.v2" : "standard-drift-finalize-plan.v3", mode, operation_id: operationId, input, prepared_at_ms: preparedAt,
      context_sha256: verified.context_sha256, evaluation_sha256: verified.evaluation_sha256, branch: verified.context.branch, head: verified.context.head,
      report: { path: reportPath, before_sha256: null, after, after_sha256: artifactContentHash(after) }, gate_constraints: constraints,
      ...(alignment === null ? {} : { objective_alignment: alignment }) };
    if (validateJsonSchema(plan, schemaFor(plan), "$", { contractKind: "workflow-definition" }).length) fail("STANDARD_DRIFT_PLAN_INVALID");
    return { can_apply: true, plan, plan_sha256: shadowHash(plan) };
  }
  return Object.freeze({
    prepare: (instance, input, operationId) => prepare(instance, input, operationId, now()),
    async apply(instance, prepared, { write = false, expectPlan, assertAuthorized } = {}) {
      const plan = prepared?.plan, age = now() - plan?.prepared_at_ms;
      if (write !== true || typeof assertAuthorized !== "function" || !prepared.can_apply || shadowHash(plan) !== expectPlan || prepared.plan_sha256 !== expectPlan
        || !Number.isSafeInteger(age) || age < 0 || age > 300000) fail("STANDARD_DRIFT_EXPLICIT_EFFECT_REQUIRED");
      if (validateJsonSchema(plan, schemaFor(plan), "$", { contractKind: "workflow-definition" }).length) fail("STANDARD_DRIFT_PLAN_INVALID");
      return artifacts.withLocalEffectOwner(expectPlan, async () => {
        const assertCurrent = () => { if (readCurrent(instance.instance_id).instance_sha256 !== instance.instance_sha256) fail("STANDARD_DRIFT_PROCESS_CHANGED"); };
        const assertContext = async () => {
          const current = await readEvaluation(instance, plan.input);
          if (current.context_sha256 !== plan.context_sha256 || current.evaluation_sha256 !== plan.evaluation_sha256) fail("STANDARD_DRIFT_CONTEXT_CHANGED");
          if (plan.contract_version === "standard-drift-finalize-plan.v3") {
            if (typeof readObjectiveAlignment !== "function" || shadowHash(await readObjectiveAlignment(instance, plan.input, current)) !== shadowHash(plan.objective_alignment))
              fail("STANDARD_DRIFT_OBJECTIVE_ALIGNMENT_CHANGED");
          }
          assertCurrent();
        };
        let file, beforeSize;
        try {
          const fresh = await prepare(instance, plan.input, plan.operation_id, plan.prepared_at_ms, true);
          if (!fresh.can_apply || fresh.plan_sha256 !== expectPlan) fail("STANDARD_DRIFT_PREVIEW_CHANGED");
          await assertAuthorized(); assertCurrent();
          await assertContext();
          if (now() - plan.prepared_at_ms > 300000) fail("STANDARD_DRIFT_PLAN_EXPIRED");
          file = eventPath(); beforeSize = fs.existsSync(file) ? fs.statSync(file).size : 0;
          if (fs.existsSync(file) && !fs.statSync(file).isFile()) fail("STANDARD_DRIFT_EVENT_LOG_INVALID");
          if (beforeSize > 0) {
            const descriptor = fs.openSync(file, "r"), last = Buffer.alloc(1);
            try { if (fs.readSync(descriptor, last, 0, 1, beforeSize - 1) !== 1 || last[0] !== 10) fail("STANDARD_DRIFT_EVENT_LOG_INVALID"); }
            finally { fs.closeSync(descriptor); }
          }
        } catch (cause) { cause.effect_status = "no_effect"; throw cause; }
        let hook = null;
        try {
          artifacts.compareAndSwap(plan.report); artifacts.project([plan.report.path]);
          await assertContext(); await assertAuthorized(); assertCurrent();
          const runId = "process_drift_" + plan.operation_id;
          const hookStarted = now();
          if (plan.contract_version === "standard-drift-finalize-plan.v3") {
            // The ordinary CLI hook cannot acquire this capability. This owned
            // invocation uses its same production evaluator/event writer, with
            // live verification of the accepted disposition at the effect fence.
            const payload = await runGatingEvaluateUseCase({ targetRoot: root,
              runtimeDir: fileURLToPath(new URL("../../../tools/perf/", import.meta.url)), args: {
                cache: ".aidn/runtime/cache/reload-state.json", eventFile: eventRelative, indexSyncCheckFile: ".aidn/runtime/index/index-sync-check.json",
                stateMode: artifacts.describe().state_mode, stateModeExplicit: true, indexFile: ".aidn/runtime/index/workflow-index.sqlite", indexBackend: "auto",
                thresholdFiles: 3, thresholdMinutes: 45, mode: planMode(plan), runId, reloadDecision: "", reloadFallback: "", reloadReasonCodes: "", emitEvent: true, completeDriftCheck: true },
              verifyObjectiveAlignment: async () => { await assertAuthorized(); await assertContext(); return structuredClone(plan.objective_alignment); } });
            hook = { ok: payload.ok, skill: "drift-check", tool: "gating-evaluate.mjs", mode: planMode(plan), target: root,
              strict: true, invocation: "in_process_authenticated_objective_alignment", result: payload.result, payload };
          } else hook = runSkillHookUseCase({ args: { skill: "drift-check", mode: planMode(plan), runId, strict: true, noAutoSkipGate: false },
            perfDir: fileURLToPath(new URL("../../../tools/perf/", import.meta.url)), targetRoot: root, processAdapter: createLocalProcessAdapter() });
          const payload = hook.payload, afterSize = fs.statSync(eventPath()).size, size = afterSize - beforeSize;
          await assertContext();
          if (hook.ok !== true || payload?.ok !== true || payload.result !== "ok" || payload.branch !== plan.branch || payload.mode !== planMode(plan)
            || !Number.isSafeInteger(size) || size <= 0 || size > 65536) fail("STANDARD_DRIFT_HOOK_UNCONFIRMED");
          const descriptor = fs.openSync(file, "r"), bytes = Buffer.alloc(size);
          try { if (fs.readSync(descriptor, bytes, 0, size, beforeSize) !== size) fail("STANDARD_DRIFT_HOOK_UNCONFIRMED"); } finally { fs.closeSync(descriptor); }
          const events = []; let offset = beforeSize;
          for (const line of bytes.toString("utf8").split("\n")) {
            if (line.trim()) events.push({ event: JSON.parse(line), offset });
            offset += Buffer.byteLength(line) + 1;
          }
          const matches = events.filter(row => row.event.run_id === runId), event = matches[0]?.event;
          if (matches.length !== 1 || event.event !== "drift_check_completed" || event.skill !== "drift-check" || event.result !== "ok"
            || event.mode !== planMode(plan) || event.branch !== plan.branch || event.ts !== payload.ts
            || !Number.isFinite(Date.parse(event.ts)) || Date.parse(event.ts) < hookStarted || Date.parse(event.ts) > now()) fail("STANDARD_DRIFT_HOOK_UNCONFIRMED");
          if (plan.contract_version === "standard-drift-finalize-plan.v3" && (event.objective_alignment_sha256 !== shadowHash(plan.objective_alignment)
            || shadowHash(payload.objective_alignment) !== shadowHash(plan.objective_alignment))) fail("STANDARD_DRIFT_OBJECTIVE_ALIGNMENT_CHANGED");
          if (artifacts.read(plan.report.path).sha256 !== plan.report.after_sha256) fail("STANDARD_DRIFT_REPORT_CHANGED");
          return emit("completed", "confirmed", { report_path: plan.report.path, report_sha256: plan.report.after_sha256,
            evaluation_operation_id: plan.input.evaluation_operation_id, hook, observed_event: event, event_offset: matches[0].offset, event_file: eventRelative },
            { drift_check_completed: true }, [{ ref: "docs/audit/" + plan.report.path, sha256: plan.report.after_sha256 }, { ref: "aidn:drift-event/" + plan.operation_id, sha256: shadowHash(event) }]);
        } catch (cause) {
          return emit("reconciliation_required", "unknown", { reason_code: cause.code ?? "STANDARD_DRIFT_FINALIZATION_UNCONFIRMED", report_path: plan.report.path,
            report_sha256: plan.report.after_sha256, hook, diagnostic_sha256: artifactContentHash(String(cause.message)) });
        }
      });
    },
  });
}
