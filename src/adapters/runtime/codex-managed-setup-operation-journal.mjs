import fs from "node:fs";
import path from "node:path";
import { assertAgentLocalPath } from "../../core/agents/agent-local-path-policy.mjs";
import { createHash, randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { fingerprintAgentExecutionValue as hash } from "../../core/agents/agent-execution-contracts.mjs";

// Host-level operator journal; never an authority for AIDN runs. The production
// composition pins one protected host anchor and supplies both trusted verifiers.
const PREFIX = "MANAGED_SETUP_JOURNAL_", SCOPE = "windows-codex-managed-setup";
const LIMIT = 1048576, TOTAL = 16 * LIMIT, MAX_ENTRIES = 4096, BUDGET = 4500;
const RUNNER = ["runner_id", "pid", "started_at", "job_name", "executable_sha256", "helper_sha256", "source_sha256", "candidate_sha256"];
const PROOF = RUNNER.filter(key => key !== "executable_sha256");
const INTENT = ["contract_version", "operation_id", "request_sha256", "operation_sha256", "approval_sha256", "configuration_sha256", "startup_sha256", "manifest_sha256", "inventory_sha256", "candidate_sha256", "parent", "invocation_id", "job_name", "node_sha256", "created_at", "deadline_at", "evidence"];
const fail = code => { throw Object.assign(new Error(PREFIX + code), { code: PREFIX + code }); };
const ensure = (ok, code) => { if (!ok) fail(code); };
const object = value => value !== null && typeof value === "object" && !Array.isArray(value);
const exact = (value, keys) => object(value) && Object.keys(value).sort().join("|") === [...keys].sort().join("|");
const digest = value => typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
const id = value => typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(value);
const canonical = value => Array.isArray(value) ? `[${value.map(canonical).join(",")}]` : object(value)
  ? `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}` : JSON.stringify(value);
const bytesHash = bytes => createHash("sha256").update(bytes).digest("hex");
const freeze = value => { if (value && typeof value === "object") { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };
function copy(value) {
  try { hash(value); ensure(Buffer.byteLength(canonical(value)) <= LIMIT, "DOCUMENT_LIMIT"); return freeze(structuredClone(value)); }
  catch (error) { if (error.code?.startsWith(PREFIX)) throw error; fail("JSON_INVALID"); }
}
const stamp = value => typeof value === "string" && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}(?:\d{4})?Z$/u.test(value) && Number.isFinite(Date.parse(value));
const positive = value => Number.isSafeInteger(value) && value > 0;
const absolute = value => typeof value === "string" && value.length <= 8192 && !/[\x00-\x1f\x7f]/u.test(value)
  && path.isAbsolute(value) && path.normalize(value) === value && (process.platform !== "win32" || /^[A-Za-z]:\\/u.test(value));
const samePath = (a, b) => process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b;
function physical(file, directory) {
  assertAgentLocalPath(file);
  ensure(absolute(file), "PATH_INVALID");
  for (let cursor = file;;) {
    ensure(!fs.lstatSync(cursor).isSymbolicLink(), "PATH_ALIAS");
    const parent = path.dirname(cursor); if (parent === cursor) break; cursor = parent;
  }
  const stat = fs.lstatSync(file, { bigint: true });
  ensure(directory ? stat.isDirectory() : stat.isFile() && stat.nlink === 1n, "PATH_INVALID");
  ensure(samePath(fs.realpathSync.native(file), file), "PATH_ALIAS"); return stat;
}
const identity = stat => hash({ device: String(stat.dev), file: String(stat.ino) });
function read(file, limit = LIMIT) {
  const before = physical(file, false); ensure(before.size <= BigInt(limit), "DOCUMENT_LIMIT");
  const fd = fs.openSync(file, "r");
  try {
    ensure(identity(fs.fstatSync(fd, { bigint: true })) === identity(before), "FILE_CHANGED");
    const bytes = Buffer.alloc(Number(before.size)); let offset = 0;
    while (offset < bytes.length) { const n = fs.readSync(fd, bytes, offset, bytes.length - offset, null); ensure(n > 0, "FILE_CHANGED"); offset += n; }
    ensure(fs.readSync(fd, Buffer.alloc(1), 0, 1, null) === 0, "FILE_CHANGED");
    const after = fs.fstatSync(fd, { bigint: true }), final = physical(file, false);
    ensure([after, final].every(stat => identity(stat) === identity(before) && stat.size === before.size && stat.mtimeNs === before.mtimeNs && stat.ctimeNs === before.ctimeNs), "FILE_CHANGED");
    let value; try { value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); } catch { fail("CORRUPT_RECORD"); }
    copy(value); return { value, sha256: bytesHash(bytes), bytes: bytes.length };
  } finally { fs.closeSync(fd); }
}
function evidence(value) {
  ensure(Array.isArray(value) && value.length > 0 && value.length <= 16, "EVIDENCE_INVALID"); const keys = new Set();
  for (const row of value) {
    ensure(exact(row, ["ref", "sha256", "bytes"]) && typeof row.ref === "string" && row.ref.length <= 512
      && /^[A-Za-z0-9][A-Za-z0-9._/-]*$/u.test(row.ref) && !row.ref.split("/").some(part => !part || part === "." || part === "..")
      && digest(row.sha256) && Number.isSafeInteger(row.bytes) && row.bytes >= 0 && row.bytes <= 64 * LIMIT && !keys.has(row.ref.toLowerCase()), "EVIDENCE_INVALID");
    keys.add(row.ref.toLowerCase());
  }
}
function intentValid(value) {
  ensure(exact(value, INTENT) && value.contract_version === "codex-managed-setup-intent.v1" && id(value.operation_id) && id(value.invocation_id), "INTENT_INVALID");
  for (const field of INTENT.filter(name => name.endsWith("_sha256"))) ensure(digest(value[field]), "INTENT_INVALID");
  ensure(exact(value.parent, ["pid", "started_at"]) && positive(value.parent.pid) && stamp(value.parent.started_at), "PARENT_INVALID"); evidence(value.evidence);
  ensure(typeof value.job_name === "string" && /^Local\\aidn-execution-[a-f0-9]{32}$/u.test(value.job_name)
    && stamp(value.created_at) && stamp(value.deadline_at) && Date.parse(value.deadline_at) > Date.parse(value.created_at)
    && Date.parse(value.deadline_at) - Date.parse(value.created_at) <= 300000, "INTENT_INVALID");
}
function runnerValid(value, intent, prepared = false) {
  ensure(exact(value, [...RUNNER, ...(prepared ? ["suspended", "job_assigned"] : [])]) && value.runner_id === intent.invocation_id
    && positive(value.pid) && stamp(value.started_at) && value.job_name === intent.job_name && value.executable_sha256 === intent.node_sha256
    && value.candidate_sha256 === intent.candidate_sha256 && ["helper_sha256", "source_sha256"].every(field => digest(value[field]))
    && (!prepared || value.suspended === true && value.job_assigned === true), "RUNNER_INVALID");
}
const select = (value, keys = RUNNER) => Object.fromEntries(keys.map(field => [field, value[field]]));
function terminalValid(result, op) {
  ensure(exact(result, ["outcome", "reason_code", "launch_state", "protocol_status", "termination", "effects", "evidence"])
    && ["completed", "refused", "indeterminate"].includes(result.outcome)
    && (result.reason_code === null || typeof result.reason_code === "string" && /^[A-Z][A-Z0-9_]{0,127}$/u.test(result.reason_code))
    && ["not_requested", "requested"].includes(result.launch_state) && ["completed", "refused", "unknown"].includes(result.protocol_status), "TERMINAL_INVALID");
  evidence(result.evidence); const t = result.termination, e = result.effects;
  ensure(exact(t, ["state", "runner", "proof"]) && ["not_started", "confirmed", "unknown"].includes(t.state)
    && exact(e, ["status", "comparison_sha256"]) && ["matched", "mismatch", "unknown", "not_observed"].includes(e.status)
    && (e.comparison_sha256 === null || digest(e.comparison_sha256)) && (e.status !== "matched" || digest(e.comparison_sha256)), "TERMINAL_INVALID");
  if (t.runner !== null) { runnerValid(t.runner, op.intent); ensure(op.prepared && hash(t.runner) === hash(select(op.prepared)), "TERMINAL_RUNNER_MISMATCH"); }
  if (t.state === "confirmed") {
    ensure(op.prepared && t.runner && exact(t.proof, ["method", "active_processes", "observed_at", ...PROOF]) && t.proof.method === "windows-job-object"
      && t.proof.active_processes === 0 && stamp(t.proof.observed_at) && hash(select(t.proof, PROOF)) === hash(select(t.runner, PROOF)), "STOP_UNCONFIRMED");
  } else ensure(t.proof === null, "TERMINAL_INVALID");
  if (result.launch_state === "not_requested") ensure(!op.prepared && t.state === "not_started" && t.runner === null && result.outcome === "refused"
    && result.protocol_status !== "completed" && e.status === "not_observed", "TERMINAL_INVALID");
  else ensure(t.state !== "not_started" && result.outcome !== "refused", "TERMINAL_INVALID");
  if (result.outcome === "completed") ensure(result.reason_code === null && result.protocol_status === "completed" && t.state === "confirmed" && e.status === "matched", "COMPLETION_UNPROVEN");
  else ensure(result.reason_code !== null, "TERMINAL_INVALID");
}
const settled = op => Boolean(op.reconciliation || op.terminal && (op.terminal.outcome === "completed" || op.terminal.launch_state === "not_requested"));
function reconciliationValid(value, op, stateHash, anchor) {
  ensure(exact(value, ["contract_version", "operation_id", "intent_sha256", "state_sha256", "host_id", "anchor_sha256", "challenge", "observed_at", "parent", "descendants", "effects", "evidence"])
    && value.contract_version === "codex-managed-setup-reconciliation.v1" && value.operation_id === op.intent.operation_id
    && value.intent_sha256 === op.intent_sha256 && value.state_sha256 === stateHash && value.host_id === anchor.host_id
    && value.anchor_sha256 === anchor.sha256 && id(value.challenge) && stamp(value.observed_at), "RECONCILIATION_INVALID");
  ensure(exact(value.parent, ["pid", "started_at", "state"]) && value.parent.pid === op.intent.parent.pid && value.parent.started_at === op.intent.parent.started_at
    && value.parent.state === "confirmed_stopped", "RECONCILIATION_STOP_UNCONFIRMED");
  ensure(exact(value.descendants, ["invocation_id", "job_name", "state", "runner"]) && value.descendants.invocation_id === op.intent.invocation_id
    && value.descendants.job_name === op.intent.job_name && value.descendants.state === "confirmed_stopped", "RECONCILIATION_STOP_UNCONFIRMED");
  if (op.prepared) ensure(hash(value.descendants.runner) === hash(select(op.prepared)), "RECONCILIATION_STOP_UNCONFIRMED");
  else ensure(value.descendants.runner === null, "RECONCILIATION_INVALID");
  ensure(exact(value.effects, ["status", "inventory_sha256", "after_sha256", "comparison_sha256"]) && value.effects.status === "MATCHED"
    && value.effects.inventory_sha256 === op.intent.inventory_sha256 && digest(value.effects.after_sha256) && digest(value.effects.comparison_sha256), "RECONCILIATION_EFFECTS_UNCONFIRMED");
  evidence(value.evidence);
}

/** Pure construction. The anchor and journal directory must already exist.
 * All calls accept optional {signal}; verifiers share a 4500ms deadline.
 * Exclusive creation plus file fsync provides fail-closed process-crash recovery;
 * no automatic repair, purge, stale lock stealing or power-loss guarantee.
 */
export function createCodexManagedSetupOperationJournal({ anchor: inputAnchor, verifyAnchor, verifyReconciliation, excludedRoots = [] } = {}) {
  const anchor = copy(inputAnchor), exclusions = copy(excludedRoots);
  ensure(Array.isArray(exclusions) && exclusions.length <= 32 && exclusions.every(value => typeof value === "string"
    && value.length <= 8192 && !/[\x00-\x1f\x7f]/u.test(value)
    && (path.isAbsolute(value) && path.normalize(value) === value || path.win32.isAbsolute(value) && path.win32.normalize(value) === value))
    && new Set(exclusions.map(value => value.toLowerCase())).size === exclusions.length, "EXCLUSIONS_INVALID");
  ensure(exact(anchor, ["path", "sha256", "host_id"]) && absolute(anchor.path) && digest(anchor.sha256) && id(anchor.host_id)
    && typeof verifyAnchor === "function" && typeof verifyReconciliation === "function", "DEPENDENCIES_REQUIRED");
  const owned = new Map();
  async function call(fn, { signal } = {}) {
    ensure(signal === undefined || signal instanceof AbortSignal, "SIGNAL_INVALID");
    const started = performance.now(), abort = new AbortController(); let timer;
    const cancel = () => abort.abort(); signal?.addEventListener("abort", cancel, { once: true }); if (signal?.aborted) cancel();
    const check = () => { ensure(!abort.signal.aborted, "CANCELLED"); ensure(performance.now() - started < BUDGET, "DEADLINE"); };
    async function bounded(work) {
      check(); let onAbort;
      try {
        const value = await Promise.race([Promise.resolve().then(() => { check(); return work(); }), new Promise((_, reject) => {
          onAbort = () => reject(Object.assign(new Error(PREFIX + "CANCELLED"), { code: PREFIX + "CANCELLED" }));
          abort.signal.addEventListener("abort", onAbort, { once: true });
          timer = setTimeout(() => { reject(Object.assign(new Error(PREFIX + "DEADLINE"), { code: PREFIX + "DEADLINE" })); abort.abort(); }, Math.max(1, BUDGET - (performance.now() - started)));
        })]); check(); return copy(value);
      } finally { clearTimeout(timer); abort.signal.removeEventListener("abort", onAbort); }
    }
    try {
      check(); assertAgentLocalPath(anchor.path, exclusions); const source = read(anchor.path, 16384); ensure(source.sha256 === anchor.sha256, "ANCHOR_CHANGED"); const a = source.value;
      ensure(exact(a, ["contract_version", "host_id", "journal_root", "scope"]) && a.contract_version === "codex-managed-setup-journal-anchor.v1"
        && a.host_id === anchor.host_id && a.scope === SCOPE && absolute(a.journal_root), "ANCHOR_INVALID");
      assertAgentLocalPath(a.journal_root, exclusions);
      const rootIdentity = identity(physical(a.journal_root, true)), challenge = randomUUID();
      const observation = await bounded(() => verifyAnchor(Object.freeze({ anchor, journal_root: a.journal_root, root_identity_sha256: rootIdentity, scope: SCOPE, challenge, signal: abort.signal })));
      ensure(exact(observation, ["contract_version", "host_id", "anchor_sha256", "journal_root", "root_identity_sha256", "scope", "challenge", "observed_at", "evidence"])
        && observation.contract_version === "codex-managed-setup-anchor-verification.v1" && observation.host_id === anchor.host_id
        && observation.anchor_sha256 === anchor.sha256 && observation.journal_root === a.journal_root && observation.root_identity_sha256 === rootIdentity
        && observation.scope === SCOPE && observation.challenge === challenge && stamp(observation.observed_at)
        && Date.now() - Date.parse(observation.observed_at) >= 0 && Date.now() - Date.parse(observation.observed_at) <= 5000, "ANCHOR_UNVERIFIED");
      evidence(observation.evidence);
      const guard = () => { check(); ensure(read(anchor.path, 16384).sha256 === anchor.sha256 && identity(physical(a.journal_root, true)) === rootIdentity, "ANCHOR_CHANGED"); };
      guard(); return await fn({ root: a.journal_root, rootIdentity, guard, check, bounded, signal: abort.signal });
    } catch (error) { if (error.code?.startsWith(PREFIX)) throw error; fail("IO_OR_VERIFIER_FAILURE"); }
    finally { clearTimeout(timer); abort.abort(); signal?.removeEventListener("abort", cancel); }
  }
  function state(context) {
    context.guard(); const names = fs.readdirSync(context.root).sort();
    ensure(names.length <= MAX_ENTRIES && names.every((name, i) => name === `${String(i + 1).padStart(8, "0")}.json`), "AMBIGUOUS_STATE");
    let previous = hash({ anchor_sha256: anchor.sha256, host_id: anchor.host_id, root_identity_sha256: context.rootIdentity, scope: SCOPE }), total = 0;
    const operations = new Map();
    for (let i = 0; i < names.length; i++) {
      context.check(); const record = read(path.join(context.root, names[i])); total += record.bytes; ensure(total <= TOTAL, "JOURNAL_LIMIT"); const entry = record.value;
      ensure(exact(entry, ["contract_version", "sequence", "previous_sha256", "anchor_sha256", "host_id", "event", "payload"])
        && entry.contract_version === "codex-managed-setup-journal-entry.v1" && entry.sequence === i + 1 && entry.previous_sha256 === previous
        && entry.anchor_sha256 === anchor.sha256 && entry.host_id === anchor.host_id, "CHAIN_INVALID");
      const p = entry.payload;
      if (entry.event === "intent") {
        ensure(exact(p, ["intent", "owner_sha256"]) && digest(p.owner_sha256), "RECORD_INVALID"); intentValid(p.intent);
        ensure(!operations.has(p.intent.operation_id) && [...operations.values()].every(op => settled(op)
          && op.intent.request_sha256 !== p.intent.request_sha256 && op.intent.invocation_id !== p.intent.invocation_id), "OPERATION_CONFLICT");
        operations.set(p.intent.operation_id, { intent: p.intent, intent_sha256: hash(p.intent), owner_sha256: p.owner_sha256, prepared: null, terminal: null, reconciliation: null });
      } else {
        ensure(object(p) && id(p.operation_id), "RECORD_INVALID"); const op = operations.get(p.operation_id); ensure(op && p.intent_sha256 === op.intent_sha256, "ORPHAN_RECORD");
        if (entry.event === "prepared") {
          ensure(exact(p, ["operation_id", "intent_sha256", "owner_sha256", "runner"]) && p.owner_sha256 === op.owner_sha256 && !op.prepared && !op.terminal && !op.reconciliation, "RECORD_INVALID");
          runnerValid(p.runner, op.intent, true); op.prepared = p.runner;
        } else if (entry.event === "terminal") {
          ensure(exact(p, ["operation_id", "intent_sha256", "owner_sha256", "result"]) && p.owner_sha256 === op.owner_sha256 && !op.terminal && !op.reconciliation, "RECORD_INVALID");
          terminalValid(p.result, op); op.terminal = p.result;
        } else if (entry.event === "reconciled") {
          ensure(exact(p, ["operation_id", "intent_sha256", "proof_sha256", "observation"]) && digest(p.proof_sha256) && !settled(op), "RECORD_INVALID");
          reconciliationValid(p.observation, op, previous, anchor); op.reconciliation = { proof_sha256: p.proof_sha256, observation: p.observation };
        } else fail("RECORD_INVALID");
      }
      previous = record.sha256;
    }
    context.guard(); return { revision: names.length, state_sha256: previous, operations: [...operations.values()], bytes: total };
  }
  const view = snapshot => freeze({ contract_version: "codex-managed-setup-journal-state.v1", host_id: anchor.host_id, scope: SCOPE, anchor_sha256: anchor.sha256,
    revision: snapshot.revision, state_sha256: snapshot.state_sha256, recovery_required: snapshot.operations.some(op => !settled(op)),
    operations: snapshot.operations.map(({ owner_sha256: ignored, ...op }) => ({ ...op, recovery_required: !settled(op) })), native_qualified: false });
  function append(context, before, event, payload) {
    const fresh = state(context); ensure(fresh.state_sha256 === before.state_sha256, "STALE_STATE"); ensure(before.revision < MAX_ENTRIES, "JOURNAL_LIMIT");
    const entry = { contract_version: "codex-managed-setup-journal-entry.v1", sequence: before.revision + 1, previous_sha256: before.state_sha256,
      anchor_sha256: anchor.sha256, host_id: anchor.host_id, event, payload };
    copy(entry); const bytes = Buffer.from(canonical(entry)); ensure(before.bytes + bytes.length <= TOTAL, "JOURNAL_LIMIT"); context.guard(); let fd;
    try { fd = fs.openSync(path.join(context.root, `${String(entry.sequence).padStart(8, "0")}.json`), "wx", 0o600); }
    catch (error) { if (error.code === "EEXIST") fail("STALE_STATE"); throw error; }
    try { fs.writeFileSync(fd, bytes); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    // No unlink on failure: a partial publication must quarantine subsequent calls.
    context.guard(); return state(context);
  }
  function operation(snapshot, operationId, intentSha256) {
    ensure(id(operationId) && digest(intentSha256), "BINDING_INVALID"); const op = snapshot.operations.find(row => row.intent.operation_id === operationId);
    ensure(op?.intent_sha256 === intentSha256, "BINDING_INVALID"); return op;
  }
  function owner(op) { ensure(owned.get(op.intent.operation_id) === op.owner_sha256, "OWNER_REQUIRED"); }
  return Object.freeze({
    inspect(options) { return call(async context => view(state(context)), options); },
    begin(input, options) {
      input = copy(input); ensure(exact(input, ["intent", "expectedStateSha256"]) && digest(input.expectedStateSha256), "BINDING_INVALID"); intentValid(input.intent);
      return call(async context => {
        const before = state(context), existing = before.operations.find(op => op.intent.operation_id === input.intent.operation_id);
        if (existing) { ensure(existing.intent_sha256 === hash(input.intent), "DIVERGENT_REPLAY"); return freeze({ created: false, intent_sha256: existing.intent_sha256, state: view(before) }); }
        ensure(before.state_sha256 === input.expectedStateSha256, "STALE_STATE"); ensure(before.operations.every(settled), "RECOVERY_REQUIRED");
        ensure(!before.operations.some(op => op.intent.request_sha256 === input.intent.request_sha256 || op.intent.invocation_id === input.intent.invocation_id), "REPLAY_FORBIDDEN");
        ensure(Date.parse(input.intent.created_at) <= Date.now() && Date.now() < Date.parse(input.intent.deadline_at), "INTENT_EXPIRED");
        const ownerHash = hash(randomUUID()), after = append(context, before, "intent", { intent: input.intent, owner_sha256: ownerHash });
        owned.set(input.intent.operation_id, ownerHash); return freeze({ created: true, intent_sha256: hash(input.intent), state: view(after) });
      }, options);
    },
    recordPrepared(input, options) {
      input = copy(input); ensure(exact(input, ["operationId", "intentSha256", "runner"]), "BINDING_INVALID");
      return call(async context => {
        const before = state(context), op = operation(before, input.operationId, input.intentSha256); owner(op); runnerValid(input.runner, op.intent, true);
        if (op.prepared) { ensure(hash(op.prepared) === hash(input.runner), "DIVERGENT_REPLAY"); return freeze({ recorded: false, state: view(before) }); }
        ensure(!op.terminal && !op.reconciliation && Date.now() < Date.parse(op.intent.deadline_at), "RECOVERY_REQUIRED");
        return freeze({ recorded: true, state: view(append(context, before, "prepared", { operation_id: input.operationId, intent_sha256: input.intentSha256, owner_sha256: op.owner_sha256, runner: input.runner })) });
      }, options);
    },
    recordTerminal(input, options) {
      input = copy(input); ensure(exact(input, ["operationId", "intentSha256", "result"]), "BINDING_INVALID");
      return call(async context => {
        const before = state(context), op = operation(before, input.operationId, input.intentSha256); owner(op); terminalValid(input.result, op);
        if (op.terminal) { ensure(hash(op.terminal) === hash(input.result), "DIVERGENT_REPLAY"); return freeze({ recorded: false, state: view(before) }); }
        ensure(!op.reconciliation, "RECOVERY_REQUIRED");
        return freeze({ recorded: true, state: view(append(context, before, "terminal", { operation_id: input.operationId, intent_sha256: input.intentSha256, owner_sha256: op.owner_sha256, result: input.result })) });
      }, options);
    },
    reconcile(input, options) {
      input = copy(input); ensure(exact(input, ["operationId", "expectedStateSha256", "proof"]) && id(input.operationId) && digest(input.expectedStateSha256), "BINDING_INVALID");
      return call(async context => {
        const before = state(context), op = before.operations.find(row => row.intent.operation_id === input.operationId); ensure(op, "BINDING_INVALID");
        if (op.reconciliation) { ensure(op.reconciliation.proof_sha256 === hash(input.proof), "DIVERGENT_REPLAY"); return freeze({ recorded: false, state: view(before) }); }
        ensure(before.state_sha256 === input.expectedStateSha256 && !settled(op), "STALE_STATE");
        const challenge = randomUUID(), observation = await context.bounded(() => verifyReconciliation(Object.freeze({ anchor, operation: copy(op), state_sha256: before.state_sha256, challenge, proof: input.proof, signal: context.signal })));
        reconciliationValid(observation, op, before.state_sha256, anchor);
        ensure(observation.challenge === challenge && Date.now() - Date.parse(observation.observed_at) >= 0 && Date.now() - Date.parse(observation.observed_at) <= 5000, "RECONCILIATION_STALE");
        context.guard(); return freeze({ recorded: true, state: view(append(context, before, "reconciled", { operation_id: input.operationId, intent_sha256: op.intent_sha256, proof_sha256: hash(input.proof), observation })) });
      }, options);
    },
  });
}
