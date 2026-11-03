import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { createStandardWorkflowArtifacts } from "./standard-workflow-artifacts.mjs";
import { agentRunPhysicalPath, readAgentRunFile } from "./agent-run-configuration-service.mjs";
import { createLocalProcessAdapter } from "../../adapters/runtime/local-process-adapter.mjs";
import { createLocalWorkflowGitCheckpoint } from "../../adapters/runtime/local-workflow-git-checkpoint.mjs";
import { runCloseSessionAdmitUseCase } from "./close-session-admit-use-case.mjs";
import { sessionClosePaths, renderStandardSessionCloseCompletion } from "../../core/workflow/standard-session-close-render.mjs";
import { shadowHash, checkShadowJson } from "../../core/workflow/shadow-json.mjs";
import { artifactContentHash } from "../../core/workflow/artifact-compare-swap.mjs";
import { validateJsonSchema } from "../../core/contracts/json-schema-validator.mjs";
import inputSchema from "../../core/contracts/workflow-definition/standard-session-close-hook-input.v1.schema.json" with { type: "json" };
import planSchema from "../../core/contracts/workflow-definition/standard-session-close-hook-plan.v1.schema.json" with { type: "json" };
import outputSchema from "../../core/contracts/workflow-definition/standard-session-close-hook-output.v1.schema.json" with { type: "json" };
const fail = code => { throw Object.assign(Error(code), { code }); };
const valid = (value, schema) => !checkShadowJson(value) && !validateJsonSchema(value, schema, "$", { contractKind: "workflow-definition" }).length;
const runtimeDir = fileURLToPath(new URL("../../../tools/perf/", import.meta.url));
const eventRelative = ".aidn/runtime/perf/workflow-events.ndjson", runRelative = ".aidn/runtime/perf/current-run-id.txt";
const constraints = ["report_file", "thresholds_file", "actions_file", "history_file", "trend_file", "trend_thresholds_file", "trend_summary_file", "lot_plan_file", "lot_advance_file", "lot_summary_file", "summary_file"];
const constraintPaths = ["report.json", "thresholds.json", "actions.json", "history.ndjson", "trend.json", "trend-thresholds.json", "trend-summary.md", "lot-plan.json", "lot-advance.json", "lot-plan-summary.md", "summary.md"]
  .map(name => ".aidn/runtime/perf/constraint-" + name);
export function createStandardSessionCloseHook({ targetRoot, readSource, readCurrent, now = Date.now }) {
  if (typeof readSource !== "function" || typeof readCurrent !== "function") fail("STANDARD_SESSION_CLOSE_HOOK_AUTHORITY_REQUIRED");
  const artifacts = createStandardWorkflowArtifacts({ targetRoot }), root = artifacts.root;
  const physical = name => agentRunPhysicalPath(path.join(root, name), { missing: true });
  function events() {
    const bytes = readAgentRunFile(physical(eventRelative), { json: false, maxBytes: 4194304 }).value;
    if (!bytes.length || bytes.at(-1) !== 10) fail("STANDARD_SESSION_CLOSE_EVENT_LOG_INVALID"); return bytes;
  }
  function eventRows(bytes, initial = 0) {
    let offset = initial;
    return bytes.toString("utf8").trimEnd().split("\n").map(line => { const row = { event: JSON.parse(line), offset }; offset += Buffer.byteLength(line) + 1; return row; });
  }
  async function source(instance, input) {
    const value = await readSource(instance, input), hook = value?.start_output?.observations?.hook?.payload?.workflow_hook;
    if (checkShadowJson(value) || !value || value.record_operation_id !== input.record_operation_id || value.checkpoint_operation_id !== input.checkpoint_operation_id
      || value.start_output?.facts.session_started !== true || value.start_output.effect_status !== "confirmed" || hook?.ok !== true || hook.result !== "ok"
      || !/^[a-zA-Z0-9_-]{1,128}$/.test(hook.run_id ?? "") || value.checkpoint_output?.facts.session_close_checkpoint_completed !== true
      || value.checkpoint_output.effect_status !== "confirmed" || value.checkpoint_output.observations.record_operation_id !== input.record_operation_id)
      fail("STANDARD_SESSION_CLOSE_HOOK_SOURCE_REQUIRED");
    const docs = sessionClosePaths(value.session_path).map(name => artifacts.read(name, { required: true }));
    const view = createLocalWorkflowGitCheckpoint({ targetRoot: root }, { profile: "cycle-terminal", approvedPaths: docs.map(row => "docs/audit/" + row.path) }).inspect();
    const git = value.checkpoint_output.observations.git, head = git.commit_sha ?? git.head;
    if (view.head !== head || view.branch !== value.branch || view.changes.length || !view.index_clean || view.lock_present) fail("STANDARD_SESSION_CLOSE_HOOK_CHECKPOINT_CHANGED");
    return { value, docs, runId: hook.run_id, startHook: hook, view };
  }
  async function prepare(instance, input, operationId, at, acquired = false) {
    if (!valid(input, inputSchema) || !/^op_[a-f0-9]{40}$/.test(operationId ?? "")) fail("STANDARD_SESSION_CLOSE_HOOK_INPUT_INVALID");
    if (!acquired && artifacts.ownerPending()) return { can_apply: false, reason_code: "STANDARD_EFFECT_OWNER_RECONCILIATION_REQUIRED" };
    const selected = await source(instance, input), { value, docs, runId, startHook } = selected;
    if (artifacts.describe().state_mode !== "files") {
      const ignored = spawnSync("git", ["-C", root, "-c", "core.fsmonitor=false", "check-ignore", "--stdin", "-z"], {
        input: constraintPaths.join("\0") + "\0", encoding: "utf8", shell: false, windowsHide: true, timeout: 10000,
        env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" } });
      if (ignored.status !== 0 || shadowHash(ignored.stdout.split("\0").filter(Boolean).sort()) !== shadowHash([...constraintPaths].sort()))
        return { can_apply: false, reason_code: "STANDARD_SESSION_CLOSE_CONSTRAINT_PROJECTION_POLICY_REQUIRED" };
    }
    const run = readAgentRunFile(physical(runRelative), { json: false, maxBytes: 256 }), before = events();
    const runEvidence = value.start_output.evidence_refs.filter(row => row.ref === runRelative);
    const starts = eventRows(before).filter(row => row.event.event === "hook_session_start" && row.event.run_id === runId);
    if (run.value.toString("utf8") !== runId + "\n" || runEvidence.length !== 1 || runEvidence[0].sha256 !== run.sha256
      || starts.length !== 1 || starts[0].event.ts !== startHook.ts || starts[0].event.result !== "ok" || starts[0].event.skill !== "workflow-hook"
      || starts[0].event.branch !== startHook.branch || starts[0].event.mode !== value.mode
      || eventRows(before).some(row => row.event.event === "hook_session_close" && row.event.run_id === runId)) fail("STANDARD_SESSION_CLOSE_START_PROOF_CHANGED");
    const admission = await runCloseSessionAdmitUseCase({ targetRoot: root, mode: value.mode });
    if (admission.ok !== true || admission.action !== "close_session_allowed" || admission.active_session !== value.session_id || admission.branch !== value.branch)
      return { can_apply: false, reason_code: "STANDARD_SESSION_CLOSE_HOOK_ADMISSION_BLOCKED" };
    const plan = { contract_version: "standard-session-close-hook-plan.v1", input, operation_id: operationId, prepared_at_ms: at,
      source_sha256: shadowHash(value), session_id: value.session_id, session_path: value.session_path, branch: value.branch, head: selected.view.head,
      mode: value.mode, state_mode: artifacts.describe().state_mode, run_id: runId, run_file_sha256: run.sha256,
      event_log: { bytes: before.length, sha256: artifactContentHash(before) },
      documents: docs.map(row => ({ path: row.path, sha256: row.sha256, metadata_sha256: artifacts.metadataHash(row.path) })) };
    if (!valid(plan, planSchema)) fail("STANDARD_SESSION_CLOSE_HOOK_PLAN_INVALID");
    return { can_apply: true, plan, plan_sha256: shadowHash(plan) };
  }
  function emit(outcome, effect_status, observations, facts = {}, evidence_refs = []) {
    // Runtime telemetry is JSON, but may contain fractional measurements that
    // are deliberately outside the process IR's safe-integer vocabulary. Keep
    // the authenticated digest and verified completion summary, not raw telemetry.
    const observed = { ...observations };
    if (observed.hook) observed.hook = { ok: observed.hook.ok === true, tool: "close-session-hook.mjs",
      payload_sha256: artifactContentHash(JSON.stringify(observed.hook.payload)), result: observed.hook.payload?.result ?? null,
      run_id: observed.hook.payload?.workflow_hook?.run_id ?? null,
      checkpoint_confirmed: observed.hook.payload?.checkpoint?.ok === true,
      constraint_loop_required: observed.hook.payload?.constraint_loop_required === true };
    if (observed.sync) observed.sync = { ok: observed.sync.ok === true, skipped: observed.sync.skipped === true, reason: observed.sync.reason ?? null,
      payload_sha256: artifactContentHash(JSON.stringify(observed.sync)), fallback_full_used: observed.sync.fallback_full_used === true };
    const value = { contract_version: "standard-session-close-hook-output.v1", operation_ref: "session_close_finalize", outcome, effect_status, observations: observed, facts, evidence_refs };
    if (!valid(value, outputSchema)) fail("STANDARD_SESSION_CLOSE_HOOK_OUTPUT_INVALID"); return value;
  }
  return Object.freeze({ prepare: (instance, input, id) => prepare(instance, input, id, now()),
    async apply(instance, prepared, { write = false, expectPlan, assertAuthorized } = {}) {
      const plan = prepared?.plan, age = now() - plan?.prepared_at_ms;
      if (!valid(plan, planSchema) || !prepared?.can_apply || write !== true || prepared.plan_sha256 !== expectPlan || shadowHash(plan) !== expectPlan
        || typeof assertAuthorized !== "function" || !Number.isSafeInteger(age) || age < 0 || age > 300000)
        throw Object.assign(Error("STANDARD_SESSION_CLOSE_HOOK_EXPLICIT_EFFECT_REQUIRED"), { code: "STANDARD_SESSION_CLOSE_HOOK_EXPLICIT_EFFECT_REQUIRED", effect_status: "no_effect" });
      return artifacts.withLocalEffectOwner(expectPlan, async () => {
        try {
          await assertAuthorized(); const fresh = await prepare(instance, plan.input, plan.operation_id, plan.prepared_at_ms, true);
          if (!fresh.can_apply || fresh.plan_sha256 !== expectPlan || readCurrent(instance.instance_id).instance_sha256 !== instance.instance_sha256) fail("STANDARD_SESSION_CLOSE_HOOK_SOURCE_CHANGED");
        } catch (cause) { cause.effect_status = "no_effect"; throw cause; }
        let hook = null, sync = null; const committed = [];
        try {
          const before = events(), started = now();
          // The actual hook reads/removes the start run file. It has no --run-id.
          const actual = createLocalProcessAdapter().runJsonNodeScript(path.join(runtimeDir, "close-session-hook.mjs"),
            ["--target", root, "--mode", plan.mode, "--strict", "--no-auto-skip-gate", "--index-sync-check", "--index-sync-check-strict", "--json"]);
          hook = { ok: actual.ok === true, tool: "close-session-hook.mjs", payload: actual };
          const payload = hook.payload, workflow = payload?.workflow_hook, checkpoint = payload?.checkpoint;
          if (hook.ok !== true || payload?.ok !== true || payload.result !== "ok" || payload.action !== "close_session_allowed" || payload.branch !== plan.branch
            || payload.admission?.active_session !== plan.session_id || workflow?.ok !== true || workflow.result !== "ok" || workflow.run_id !== plan.run_id
            || workflow.checkpoint_error || workflow.constraint_loop_error || checkpoint?.ok !== true || checkpoint.summary?.result !== "ok"
            || checkpoint.gate?.result !== "ok" || checkpoint.gate.skipped !== false || checkpoint.reload?.decision === "stop" || checkpoint.summary?.repair_layer_blocking === true
            || checkpoint.index_sync_check?.enabled && checkpoint.index_sync_check.in_sync !== true || fs.existsSync(physical(runRelative))) fail("STANDARD_SESSION_CLOSE_HOOK_UNCONFIRMED");
          const evidence = [];
          if (plan.state_mode !== "files") {
            if (workflow.constraint_loop_required !== true || !workflow.constraint_loop) fail("STANDARD_SESSION_CLOSE_CONSTRAINT_PROOF_REQUIRED");
            for (const key of constraints) {
              const file = workflow.constraint_loop.artifacts?.[key];
              if (typeof file !== "string") fail("STANDARD_SESSION_CLOSE_CONSTRAINT_PROOF_REQUIRED");
              const at = agentRunPhysicalPath(file), relative = path.relative(root, at).replaceAll("\\", "/");
              if (!relative.startsWith(".aidn/runtime/perf/")) fail("STANDARD_SESSION_CLOSE_CONSTRAINT_SCOPE_INVALID");
              evidence.push({ ref: relative, sha256: readAgentRunFile(at, { json: false, maxBytes: 4194304 }).sha256 });
              if (["thresholds_file", "trend_thresholds_file"].includes(key)) {
                const threshold = readAgentRunFile(at, { maxBytes: 4194304 }).value;
                // Match the existing warning/error policy. Runtime strictness
                // does not silently turn every informational warning into an error.
                if (threshold.summary?.blocking !== 0 || threshold.summary?.missing !== 0 || threshold.summary?.invalid !== 0)
                  fail("STANDARD_SESSION_CLOSE_CONSTRAINT_CHECK_BLOCKED");
              }
            }
          }
          const after = events(), delta = after.subarray(before.length);
          if (before.length !== plan.event_log.bytes || artifactContentHash(before) !== plan.event_log.sha256 || delta.length <= 0 || delta.length > 262144
            || artifactContentHash(after.subarray(0, before.length)) !== plan.event_log.sha256) fail("STANDARD_SESSION_CLOSE_EVENT_CHANGED");
          const matches = eventRows(delta, before.length).filter(row => row.event.run_id === plan.run_id && row.event.event === "hook_session_close"), event = matches[0]?.event;
          if (matches.length !== 1 || event.skill !== "workflow-hook" || event.phase !== "session-close" || event.result !== "ok" || event.mode !== plan.mode || event.branch !== plan.branch
            || event.ts !== workflow.ts || !Number.isFinite(Date.parse(event.ts)) || Date.parse(event.ts) < started || Date.parse(event.ts) > now()) fail("STANDARD_SESSION_CLOSE_EVENT_UNCONFIRMED");
          await assertAuthorized();
          const selected = await source(instance, plan.input);
          if (shadowHash(selected.value) !== plan.source_sha256 || readCurrent(instance.instance_id).instance_sha256 !== instance.instance_sha256) fail("STANDARD_SESSION_CLOSE_HOOK_POSTCONDITION_FAILED");
          if (plan.state_mode !== "files") {
            sync = createLocalProcessAdapter().runJsonNodeScript(fileURLToPath(new URL("../../../tools/runtime/sync-db-first-selective.mjs", import.meta.url)),
              ["--target", root, "--state-mode", plan.state_mode, "--no-fallback-full", "--strict", "--json"]);
            if (sync.ok !== true || sync.fallback_full_used === true || sync.summary?.failed_count || sync.summary?.synced_count) fail("STANDARD_SESSION_CLOSE_SYNC_UNCONFIRMED");
          }
          await assertAuthorized();
          const docs = plan.documents.map(row => { const observed = artifacts.read(row.path, { required: true });
            if (observed.sha256 !== row.sha256 || artifacts.metadataHash(row.path) !== row.metadata_sha256) fail("STANDARD_SESSION_CLOSE_COMPLETION_PREIMAGE_CHANGED"); return observed; });
          const changes = renderStandardSessionCloseCompletion({ sessionPath: plan.session_path, documents: docs, runId: plan.run_id, eventSha256: shadowHash(event), completedAt: Date.parse(event.ts) });
          const metadata = [];
          for (const [i, row] of changes.entries()) { metadata.push(artifacts.compareAndSwapPreservingMetadata({ ...row, before_metadata_sha256: plan.documents[i].metadata_sha256, after: row.text_chunks.join("") }).metadata_sha256); committed.push(row.path); }
          artifacts.project(committed);
          for (const [i, row] of changes.entries()) {
            if (artifacts.read(row.path).sha256 !== row.after_sha256 || artifacts.metadataHash(row.path) !== metadata[i]) fail("STANDARD_SESSION_CLOSE_COMPLETION_UNCONFIRMED");
            if (plan.state_mode !== "db-only" && readAgentRunFile(physical("docs/audit/" + row.path), { json: false, maxBytes: 1048576 }).sha256 !== row.after_sha256) fail("STANDARD_SESSION_CLOSE_COMPLETION_UNCONFIRMED");
          }
          if (readCurrent(instance.instance_id).instance_sha256 !== instance.instance_sha256 || now() - plan.prepared_at_ms > 300000) fail("STANDARD_SESSION_CLOSE_HOOK_POSTCONDITION_FAILED");
          return emit("completed", "confirmed", { hook, sync, event, event_offset: matches[0].offset, event_file: eventRelative, committed, run_id: plan.run_id },
            { session_close_completed: true }, [{ ref: "aidn:session-close/" + plan.run_id, sha256: shadowHash(event) }, ...evidence,
              ...changes.map(row => ({ ref: "docs/audit/" + row.path, sha256: row.after_sha256 }))]);
        } catch (cause) { return emit("reconciliation_required", "unknown", { hook, sync, committed, reason_code: cause.code ?? "STANDARD_SESSION_CLOSE_HOOK_UNCONFIRMED",
          diagnostic_sha256: artifactContentHash(String(cause.message)), exit_code: Number.isInteger(cause.status) ? cause.status : null }); }
      });
    },
  });
}
