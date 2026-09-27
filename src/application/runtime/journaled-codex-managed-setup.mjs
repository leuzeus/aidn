import path from "node:path";
import { performance } from "node:perf_hooks";
import { createControlledCodexManagedSetup } from "./controlled-codex-managed-setup.mjs";
import { createManagedSetupParentPreflight } from "../../adapters/agents/process-tree/codex-managed-setup-parent-preflight.mjs";
import { createCodexManagedSetupOperationJournal } from "../../adapters/runtime/codex-managed-setup-operation-journal.mjs";
import { assertManagedSetupBridgeRequest } from "../../adapters/agents/process-tree/codex-managed-setup-bridge.mjs";
import { assertAgentLocalPath } from "../../core/agents/agent-local-path-policy.mjs";
import { fingerprintAgentExecutionValue as hash } from "../../core/agents/agent-execution-contracts.mjs";

const PREFIX = "MANAGED_SETUP_DURABLE_", BUDGET = 4500, MAX_BYTES = 4 * 1024 * 1024;
const RUNNER = ["runner_id", "pid", "started_at", "job_name", "executable_sha256", "helper_sha256", "source_sha256", "candidate_sha256"];
const exact = (v, keys) => v && typeof v === "object" && !Array.isArray(v) && [Object.prototype, null].includes(Object.getPrototypeOf(v))
  && Reflect.ownKeys(v).length === keys.length && keys.every(k => { const d = Object.getOwnPropertyDescriptor(v, k); return d && Object.hasOwn(d, "value") && d.enumerable; });
const ensure = (ok, code) => { if (!ok) throw Object.assign(new Error(PREFIX + code), { code: PREFIX + code }); };
const digest = v => typeof v === "string" && /^[a-f0-9]{64}$/u.test(v);
const identifier = v => typeof v === "string" && /^[A-Za-z0-9][A-Za-z0-9._-]{0,95}$/u.test(v);
const freeze = v => { if (v && typeof v === "object") { Object.values(v).forEach(freeze); Object.freeze(v); } return v; };
const copy = v => { hash(v); return freeze(structuredClone(v)); };
const canonical = v => Array.isArray(v) ? `[${v.map(canonical).join(",")}]` : v !== null && typeof v === "object"
  ? `{${Object.keys(v).sort().map(k => `${JSON.stringify(k)}:${canonical(v[k])}`).join(",")}}` : JSON.stringify(v);
const pick = (v, keys) => Object.fromEntries(keys.map(k => [k, v[k]]));
const reason = error => typeof error?.code === "string" && /^[A-Z][A-Z0-9_]{0,127}$/u.test(error.code) ? error.code : PREFIX + "PERSISTENCE_FAILED";
function localAbsolute(value, exclusions = []) {
  ensure(typeof value === "string" && value.length <= 8192 && !/[\x00-\x1f\x7f]/u.test(value)
    && (path.isAbsolute(value) && path.normalize(value) === value || path.win32.isAbsolute(value) && path.win32.normalize(value) === value), "PATH_INVALID");
  return assertAgentLocalPath(value, exclusions);
}

/** Internal host-operation composition, never an executor registration or a run
 * store. The single protected anchor is verified by the journal's mandatory
 * authority port. recordEvidence is an immutable, bounded wx/fsync sink: it must
 * enforce physical ownership/no aliases beneath evidenceRoot and return only
 * after the exact canonical bytes are durable. This module validates its receipt,
 * but cannot manufacture that physical guarantee from the receipt itself.
 *
 * verifyAnchor and recordEvidence must not create processes; anchor inspection
 * necessarily precedes intent. No injected port may hide a launch before begin.
 * The initial evidence document binds the deterministic operation evidence prefix.
 * A reconciliation verifier MUST enumerate and verify that bounded prefix and
 * establish termination of ALL auxiliary Jobs as well as the main Job and parent.
 * No reconciliation entry point is exposed here; no automatic retry is possible.
 * An uncertain auxiliary operation leaves the intent open, even if the main
 * process was never requested. All constructors and preview are I/O-free.
 */
export function createJournaledCodexManagedSetup(dependencies = {}) {
  ensure(exact(dependencies, ["anchor", "verifyAnchor", "verifyReconciliation", "controller", "parentIdentity", "authorizeOperation", "compareEffects", "recordEvidence", "evidenceRoot", "excludedRoots"]), "DEPENDENCIES_REQUIRED");
  const { controller, authorizeOperation, compareEffects, recordEvidence, verifyAnchor, verifyReconciliation } = dependencies;
  ensure([authorizeOperation, compareEffects, recordEvidence, verifyAnchor, verifyReconciliation].every(fn => typeof fn === "function")
    && typeof controller?.run === "function" && typeof controller?.checkAvailability === "function", "DEPENDENCIES_REQUIRED");
  const excludedRoots = copy(dependencies.excludedRoots);
  ensure(Array.isArray(excludedRoots) && excludedRoots.length > 0 && excludedRoots.length <= 32 && excludedRoots.every(v => typeof v === "string" && v.length > 0 && v.length <= 8192), "EXCLUSIONS_INVALID");
  const parent = copy(dependencies.parentIdentity), anchor = copy(dependencies.anchor), evidenceRoot = localAbsolute(dependencies.evidenceRoot, excludedRoots);
  ensure(exact(parent, ["pid", "started_at"]) && parent.pid === process.pid && typeof parent.started_at === "string"
    && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{7}Z$/u.test(parent.started_at) && Number.isFinite(Date.parse(parent.started_at)), "PARENT_INVALID");
  localAbsolute(anchor.path, excludedRoots);
  const journal = createCodexManagedSetupOperationJournal({ anchor, verifyAnchor, verifyReconciliation, excludedRoots });
  let active = false;
  function preview(envelope, options = {}) {
    assertManagedSetupBridgeRequest(envelope); const request = copy(envelope);
    ensure(Object.hasOwn(request.startup, "permission_scope"), "NAMED_PERMISSION_REQUIRED");
    const exclusions = request.startup.permission_scope.excluded_paths;
    ensure(hash(exclusions) === hash(excludedRoots), "EXCLUSIONS_MISMATCH");
    for (const target of [anchor.path, evidenceRoot, request.cwd, request.candidate_root, request.startup.state_root,
      request.node.executable, request.powershell.executable, request.client.executable, request.sidecars.setup.executable,
      request.sidecars.command_runner.executable, request.prerequisites.reference]) localAbsolute(target, exclusions);
    for (const [name, value] of Object.entries(request.env)) {
      if (name.toUpperCase() === "PATH") for (const entry of value.split(";")) localAbsolute(entry, exclusions);
      else if (["CODEX_HOME", "TEMP", "TMP", "USERPROFILE", "SYSTEMROOT", "WINDIR", "COMSPEC", "LOCALAPPDATA", "APPDATA", "PROGRAMDATA"].includes(name.toUpperCase())) localAbsolute(value, exclusions);
    }
    ensure(exact(options, ["operationId", "manifestSha256", "inventorySha256", "maxDurationMs"]) && identifier(options.operationId)
      && digest(options.manifestSha256) && digest(options.inventorySha256) && Number.isSafeInteger(options.maxDurationMs)
      && options.maxDurationMs >= 1000 && options.maxDurationMs <= 60000, "OPTIONS_INVALID");
    return copy({ contract_version: "aidn-journaled-managed-setup-preview.v1", operation_id: options.operationId,
      request_sha256: request.request_sha256, operation_sha256: request.operation_sha256,
      manifest_sha256: options.manifestSha256, inventory_sha256: options.inventorySha256,
      candidate_sha256: hash(request.source_inventory), startup_sha256: hash(request.startup),
      evidence_prefix: `managed-setup/${options.operationId}`, max_duration_ms: options.maxDurationMs,
      status: "PREPARED_NOT_AUTHORIZED", execution_available: false, native_qualified: false, execution_registered: false });
  }
  return Object.freeze({
    preview,
    inspect(options) { return journal.inspect(options); },
    async run(envelope, options = {}) {
      ensure(exact(options, ["operationId", "manifestSha256", "inventorySha256", "maxDurationMs", "execute", "expectRequestSha256", ...(Object.hasOwn(options, "signal") ? ["signal"] : [])]), "OPTIONS_INVALID");
      const selected = preview(envelope, pick(options, ["operationId", "manifestSha256", "inventorySha256", "maxDurationMs"]));
      const request = copy(envelope), signal = options.signal;
      ensure(options.execute === true && options.expectRequestSha256 === request.request_sha256, "EXPLICIT_INTENT_REQUIRED");
      ensure(!signal || signal instanceof AbortSignal, "SIGNAL_INVALID");
      ensure(!active, "ALREADY_RUNNING"); ensure(!signal?.aborted, "CANCELLED"); active = true;
      const began = performance.now(), started = Date.now(), stop = new AbortController(), receipts = [], auxiliary = new Map();
      const abort = () => stop.abort(); signal?.addEventListener("abort", abort, { once: true });
      let intentSha = null, journalState = null, parentResult = null, terminalRecorded = false, closed = false;
      let sinkUncertain = false, requested = false, prepared = null, failure = null, quarantine = false, intentAttempted = false;
      const workCheck = () => { ensure(!stop.signal.aborted, "CANCELLED"); ensure(performance.now() - began < selected.max_duration_ms, "DEADLINE"); };
      async function retain(recordId, document, { work = true } = {}) {
        if (work) { ensure(!closed, "EVENTS_CLOSED"); workCheck(); }
        document = copy(document); const bytes = Buffer.byteLength(canonical(document)), sha256 = hash(document);
        ensure(bytes <= MAX_BYTES && identifier(recordId), "EVIDENCE_INVALID");
        const ref = `${selected.evidence_prefix}/${recordId}.json`, sinkStop = new AbortController(); let timer;
        const timeout = work ? Math.min(BUDGET, Math.max(1, selected.max_duration_ms - (performance.now() - began))) : BUDGET;
        const since = performance.now();
        try {
          const receipt = copy(await Promise.race([Promise.resolve().then(() => recordEvidence(Object.freeze({ operation_id: selected.operation_id,
            record_id: recordId, evidence_root: evidenceRoot, document, sha256, bytes }), { signal: sinkStop.signal })),
          new Promise((_, reject) => { timer = setTimeout(() => { sinkStop.abort(); reject(Object.assign(new Error(PREFIX + "EVIDENCE_TIMEOUT"), { code: PREFIX + "EVIDENCE_TIMEOUT" })); }, timeout); })]));
          ensure(performance.now() - since < timeout, "EVIDENCE_TIMEOUT");
          ensure(exact(receipt, ["ref", "sha256", "bytes"]) && receipt.ref === ref && receipt.sha256 === sha256 && receipt.bytes === bytes, "EVIDENCE_RECEIPT_INVALID");
          receipts.push(receipt); if (work) workCheck(); return receipt;
        } catch (error) { sinkUncertain = true; throw error; }
        finally { clearTimeout(timer); sinkStop.abort(); }
      }
      try {
        workCheck(); const initial = await journal.inspect({ signal: stop.signal }); workCheck(); journalState = initial.state_sha256; quarantine = initial.recovery_required;
        const existing = initial.operations.find(op => op.intent.operation_id === selected.operation_id);
        if (existing) {
          ensure(existing.intent.request_sha256 === request.request_sha256 && existing.intent.manifest_sha256 === selected.manifest_sha256
            && existing.intent.inventory_sha256 === selected.inventory_sha256, "DIVERGENT_REPLAY");
          const replay = await journal.begin({ intent: existing.intent, expectedStateSha256: initial.state_sha256 }, { signal: stop.signal });
          ensure(replay.created === true, "REPLAY_FORBIDDEN");
        }
        ensure(!initial.recovery_required, "RECOVERY_REQUIRED");
        const requestEvidence = await retain("request", { contract_version: "aidn-managed-setup-operation-evidence.v1", operation_id: selected.operation_id,
          request, manifest_sha256: selected.manifest_sha256, inventory_sha256: selected.inventory_sha256,
          evidence_root: evidenceRoot, evidence_prefix: selected.evidence_prefix, parent, max_duration_ms: selected.max_duration_ms });
        const intent = { contract_version: "codex-managed-setup-intent.v1", operation_id: selected.operation_id,
          request_sha256: request.request_sha256, operation_sha256: request.operation_sha256, approval_sha256: request.approval_sha256,
          configuration_sha256: request.configuration_sha256, startup_sha256: selected.startup_sha256,
          manifest_sha256: selected.manifest_sha256, inventory_sha256: selected.inventory_sha256, candidate_sha256: selected.candidate_sha256,
          parent, invocation_id: request.invocation_id, job_name: request.job_name, node_sha256: request.node.sha256,
          created_at: new Date(started).toISOString(), deadline_at: new Date(started + selected.max_duration_ms).toISOString(), evidence: [requestEvidence] };
        intentAttempted = true; const begun = await journal.begin({ intent, expectedStateSha256: initial.state_sha256 }, { signal: stop.signal });
        ensure(begun.created === true, "REPLAY_FORBIDDEN"); intentSha = begun.intent_sha256; journalState = begun.state.state_sha256; workCheck();
        const preflight = createManagedSetupParentPreflight({ controller, parentIdentity: parent, recordEvidence: async document => {
          ensure(document.request_sha256 === request.request_sha256 && ["before_create", "before_resume"].includes(document.phase)
            && ["intent", "prepared", "terminal"].includes(document.kind), "AUXILIARY_BINDING_INVALID");
          const key = document.phase, previous = auxiliary.get(key);
          if (document.kind === "intent") { ensure(!previous, "AUXILIARY_REPLAY"); auxiliary.set(key, { runner_id: document.runner_id, job_name: document.job_name, settled: false }); }
          else ensure(previous?.runner_id === document.runner_id && previous.job_name === document.job_name, "AUXILIARY_BINDING_INVALID");
          const receipt = await retain(`preflight-${key}-${document.kind}`, document);
          if (document.kind === "terminal") auxiliary.get(key).settled = ["not_started", "confirmed"].includes(document.termination_state);
          return receipt;
        } });
        const trackedController = {
          checkAvailability: input => controller.checkAvailability(input),
          run: async (input, callbacks) => {
            workCheck(); ensure(!closed && !requested, "MAIN_REPLAY"); requested = true;
            return controller.run(input, { ...callbacks, onEvent: async event => {
              ensure(!closed, "EVENTS_CLOSED"); workCheck();
              if (event.type === "prepared") {
                ensure(!prepared, "PREPARED_REPLAY"); const runner = copy(pick(event, [...RUNNER, "suspended", "job_assigned"]));
                const recorded = await journal.recordPrepared({ operationId: selected.operation_id, intentSha256: intentSha, runner }, { signal: callbacks.signal });
                ensure(recorded.recorded === true, "PREPARED_REPLAY"); journalState = recorded.state.state_sha256; prepared = runner;
                await retain("main-prepared", event);
              }
              await callbacks.onEvent(event);
            } });
          },
        };
        const controlled = createControlledCodexManagedSetup({ controller: trackedController, authorizeOperation, preflight, compareEffects });
        workCheck(); const remaining = Math.floor(selected.max_duration_ms - (performance.now() - began)); ensure(remaining >= 1000, "DEADLINE");
        parentResult = copy(await controlled(request, { execute: true, expectRequestSha256: request.request_sha256, maxDurationMs: remaining, signal: stop.signal }));
        closed = true;
        const resultEvidence = await retain("result", { contract_version: "aidn-managed-setup-complete-result-evidence.v1", operation_id: selected.operation_id,
          intent_sha256: intentSha, result: parentResult, prior_evidence: receipts.slice() }, { work: false });
        const unresolved = sinkUncertain || parentResult.recovery_required || parentResult.preflight_recovery?.recovery_required
          || [...auxiliary.values()].some(row => !row.settled);
        if (!unresolved) {
          const t = parentResult.tree_termination;
          const terminal = { outcome: parentResult.outcome, reason_code: parentResult.reason_code,
            launch_state: requested ? "requested" : "not_requested", protocol_status: parentResult.outcome === "completed" ? "completed" : "refused",
            termination: { state: t.state, runner: t.runner ? pick(t.runner, RUNNER) : null,
              proof: t.proof ? pick(t.proof, ["method", "active_processes", "observed_at", ...RUNNER.filter(k => k !== "executable_sha256")]) : null },
            effects: { status: parentResult.effects?.status === "MATCHED" ? "matched" : "not_observed", comparison_sha256: parentResult.effects?.comparison_sha256 ?? null }, evidence: [resultEvidence] };
          const final = await journal.recordTerminal({ operationId: selected.operation_id, intentSha256: intentSha, result: terminal });
          terminalRecorded = final.recorded === true; journalState = final.state.state_sha256;
          ensure(terminalRecorded, "TERMINAL_REPLAY");
        } else failure = parentResult.reason_code ?? PREFIX + "RECOVERY_REQUIRED";
      } catch (error) { failure = reason(error); }
      finally { closed = true; stop.abort(); signal?.removeEventListener("abort", abort); active = false; }
      return copy({ contract_version: "aidn-journaled-managed-setup-result.v1", operation_id: selected.operation_id,
        request_sha256: request.request_sha256, outcome: terminalRecorded ? parentResult.outcome : intentAttempted ? "indeterminate" : "refused",
        reason_code: failure ?? parentResult?.reason_code ?? null, recovery_required: !terminalRecorded && Boolean(intentAttempted || sinkUncertain || quarantine),
        journal: { intent_sha256: intentSha, terminal_recorded: terminalRecorded, state_sha256: journalState, evidence: receipts },
        result: parentResult, native_qualified: false, execution_registered: false });
    },
  });
}
