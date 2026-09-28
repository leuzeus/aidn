import fs from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { fingerprintAgentExecutionValue as fingerprint } from "../../core/agents/agent-execution-contracts.mjs";

const BRIDGE = "src/adapters/agents/process-tree/codex-profile-metadata-bridge.mjs";
const COLLECTOR = "src/application/runtime/codex-native-profile-observation-service.mjs";
const SELF = "src/application/runtime/controlled-codex-profile-metadata.mjs";
const HASH = /^[a-f0-9]{64}$/u, OUTPUT_LIMIT = 2 * 1024 * 1024 + 65536;
const ENVIRONMENT = new Set(["SYSTEMROOT", "WINDIR", "COMSPEC", "PATH", "PATHEXT", "USERPROFILE", "LOCALAPPDATA", "APPDATA", "PROGRAMDATA", "CODEX_HOME", "TEMP", "TMP"]);
const object = value => value && typeof value === "object" && !Array.isArray(value);
const exact = (value, names) => object(value) && Object.keys(value).sort().join("|") === [...names].sort().join("|");
const fail = (code, process) => { throw Object.assign(new Error(code), { code, ...(process ? { process } : {}) }); };
const ensure = (ok, code) => { if (!ok) fail(code); };
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const samePath = (a, b) => process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b;
const absolute = value => typeof value === "string" && path.isAbsolute(value) && path.normalize(value) === value && !/[\x00-\x1f]/u.test(value);
const relative = value => typeof value === "string" && /^[A-Za-z0-9_./ -]+$/u.test(value) && !value.split("/").some(part => !part || part === "." || part === ".." || /[. ]$/u.test(part));
async function physical(target, directory = false, checkpoint = () => {}) {
  checkpoint(); ensure(absolute(target), "PROFILE_TREE_PATH_INVALID"); let cursor = target;
  for (;;) { checkpoint(); const stat = await fs.lstat(cursor); checkpoint(); ensure(!stat.isSymbolicLink(), "PROFILE_TREE_PATH_ALIAS");
    const parent = path.dirname(cursor); if (parent === cursor) break; cursor = parent; }
  checkpoint(); const stat = await fs.lstat(target); checkpoint();
  ensure(directory ? stat.isDirectory() : stat.isFile() && stat.nlink === 1, "PROFILE_TREE_PATH_INVALID");
  const resolved = await fs.realpath(target); checkpoint(); ensure(samePath(resolved, target), "PROFILE_TREE_PATH_ALIAS"); return stat;
}
async function digestFile(file, checkpoint, limit = 512 * 1024 * 1024, reserveBytes = null) {
  checkpoint(); const before = await physical(file, false, checkpoint); ensure(before.size <= limit, "PROFILE_TREE_FILE_LIMIT");
  // Candidate readers reserve their complete physical size synchronously before
  // opening. They never read beyond it; final size/time checks reject growth.
  if (reserveBytes) reserveBytes(before.size);
  checkpoint(); const handle = await fs.open(file, "r"), digest = createHash("sha256"); let total = 0;
  try { checkpoint(); const opened = await handle.stat(); checkpoint();
    ensure(opened.dev === before.dev && opened.ino === before.ino, "PROFILE_TREE_FILE_CHANGED");
    for (;;) {
      checkpoint(); const remaining = reserveBytes ? before.size - total : limit - total + 1; if (!remaining) break;
      const buffer = Buffer.alloc(Math.min(65536, remaining)), read = await handle.read(buffer, 0, buffer.length, null); checkpoint();
      if (!read.bytesRead) break; total += read.bytesRead; ensure(total <= limit, "PROFILE_TREE_FILE_LIMIT"); digest.update(buffer.subarray(0, read.bytesRead));
    }
    checkpoint(); const after = await handle.stat(); checkpoint(); const final = await physical(file, false, checkpoint);
    ensure(total === before.size && after.size === before.size && after.mtimeMs === before.mtimeMs && after.ctimeMs === before.ctimeMs
      && final.dev === before.dev && final.ino === before.ino, "PROFILE_TREE_FILE_CHANGED");
    checkpoint(); return { sha256: digest.digest("hex"), bytes: total };
  } finally { await handle.close(); }
}
function parentEvidence(process, budget) {
  if (!process) return { closed: false, pid_absent: false, exit_code: null, signal: null, response_count: 0, budget_ms: budget };
  ensure(exact(process, ["closed", "pid_absent", "exit_code", "signal", "response_count", "budget_ms"])
    && typeof process.closed === "boolean" && typeof process.pid_absent === "boolean"
    && (process.exit_code === null || Number.isSafeInteger(process.exit_code)) && (process.signal === null || typeof process.signal === "string")
    && Number.isSafeInteger(process.response_count) && process.response_count >= 0 && process.budget_ms === budget, "PROFILE_TREE_PROTOCOL_INVALID");
  return { ...process };
}

// The parent already pins candidateInventory in the run configuration. No native
// discovery, process, log or evidence write occurs on construction. Raw metadata
// travels only through bounded private pipes and is returned transiently to the
// observer; the surrounding operation journal persists only process evidence.
export function createControlledCodexProfileMetadata({ controller, nodeRuntime, candidateRoot, candidateInventory } = {}) {
  ensure(typeof controller?.run === "function" && typeof controller?.checkAvailability === "function"
    && exact(nodeRuntime, ["executable", "sha256"]) && absolute(nodeRuntime.executable) && HASH.test(nodeRuntime.sha256)
    && absolute(candidateRoot) && object(candidateInventory), "PROFILE_TREE_CONFIGURATION_INVALID");
  const inventory = structuredClone(candidateInventory), node = structuredClone(nodeRuntime), names = Object.keys(inventory);
  ensure(names.length > 0 && names.length <= 20000 && new Set(names.map(name => name.toLowerCase())).size === names.length
    && names.every(name => relative(name) && HASH.test(inventory[name])) && [BRIDGE, COLLECTOR, SELF].every(name => HASH.test(inventory[name])), "PROFILE_TREE_INVENTORY_INVALID");
  const inventoryHash = fingerprint(inventory), bridgePath = path.join(candidateRoot, BRIDGE);
  let active = false, recoveryRequired = false;
  return async function collect(input, { timeoutMs = 10000 } = {}) {
    const began = performance.now();
    ensure(Number.isSafeInteger(timeoutMs) && timeoutMs > 0 && timeoutMs <= 60000, "PROFILE_TREE_BUDGET_INVALID");
    ensure(!Object.hasOwn(input ?? {}, "metadataProfile"), "PROFILE_METADATA_PROFILE_INVALID");
    const inputFields = ["executable", "args", "cwd", "env", "roots"];
    ensure(exact(input, [...inputFields, "signal"]) || exact(input, inputFields), "PROFILE_TREE_INPUT_INVALID");
    const protocol = "aidn-controlled-profile-metadata.v1";
    ensure(input.signal === undefined || input.signal instanceof AbortSignal, "PROFILE_TREE_SIGNAL_INVALID");
    ensure(!active, "PROFILE_TREE_ALREADY_RUNNING");
    ensure(!recoveryRequired, "PROFILE_TREE_RECOVERY_REQUIRED");
    const { signal, ...plain } = input;
    ensure(absolute(plain.executable) && absolute(plain.cwd) && Array.isArray(plain.args) && plain.args.length <= 256
      && plain.args.every(value => typeof value === "string" && value.length <= 8192 && !value.includes("\0"))
      && object(plain.env) && Object.keys(plain.env).length <= ENVIRONMENT.size
      && new Set(Object.keys(plain.env).map(name => name.toUpperCase())).size === Object.keys(plain.env).length
      && Object.entries(plain.env).every(([name, value]) => ENVIRONMENT.has(name.toUpperCase()) && typeof value === "string" && value.length <= 32768 && !value.includes("\0"))
      && Array.isArray(plain.roots) && plain.roots.length >= 1 && plain.roots.length <= 4
      && plain.roots.every(root => object(root) && absolute(root.root)), "PROFILE_TREE_INPUT_INVALID");
    const frozen = structuredClone(plain), stop = new AbortController();
    const abort = () => stop.abort(signal.reason); signal?.addEventListener("abort", abort, { once: true }); if (signal?.aborted) abort();
    const checkpoint = () => { if (stop.signal.aborted) fail("PROFILE_TREE_CANCELLED"); if (performance.now() - began >= timeoutMs - 2000) fail("PROFILE_TREE_TIMEOUT"); };
    let requestHash = null, observed = null, availability = null, controllerPromise = null, timer = null, launchRequested = false, pendingMaterial = null, callbackErrorCode = null, primaryFailure = null;
    const invocationId = randomUUID(); active = true;
    const tree = () => {
      const runner = observed?.runner ?? null, proof = observed?.termination_proof ?? null;
      const confirmed = observed?.termination_state === "confirmed" && runner && proof?.method === "windows-job-object" && proof.active_processes === 0
        && runner.runner_id === invocationId && proof.runner_id === invocationId && proof.pid === runner.pid && proof.started_at === runner.started_at
        && proof.job_name === runner.job_name && runner.executable_sha256 === node.sha256
        && ["helper_sha256", "source_sha256", "candidate_sha256"].every(key => HASH.test(availability?.[key] ?? "") && proof[key] === availability[key] && runner[key] === availability[key]);
      return { termination_state: !launchRequested ? "not_started" : confirmed ? "confirmed" : observed?.termination_state === "not_started" && !runner && !proof ? "not_started" : "unknown",
        runner, proof, bridge_sha256: inventory[BRIDGE], collector_sha256: inventory[COLLECTOR], candidate_inventory_sha256: inventoryHash, request_sha256: requestHash };
    };
    async function material() {
      checkpoint(); await physical(candidateRoot, true, checkpoint); await physical(frozen.cwd, true, checkpoint);
      ensure((await digestFile(node.executable, checkpoint)).sha256 === node.sha256, "PROFILE_TREE_NODE_CHANGED");
      // Close the complete path inventory before hashing. Both passes inspect
      // every file; four readers share one queue and the unchanged deadline.
      const actual = [], files = [];
      async function visit(directory, prefix = "") {
        checkpoint(); const entries = await fs.readdir(directory, { withFileTypes: true });
        for (const entry of entries) { checkpoint(); const name = prefix + entry.name, file = path.join(directory, entry.name);
          ensure(!entry.isSymbolicLink(), "PROFILE_TREE_PATH_ALIAS");
          if (entry.isDirectory()) { await physical(file, true, checkpoint); await visit(file, name + "/"); }
          else { ensure(entry.isFile() && HASH.test(inventory[name] ?? "") && actual.length < 20000, "PROFILE_TREE_CANDIDATE_CHANGED");
            actual.push(name); files.push({ name, file }); }
        }
      }
      await visit(candidateRoot); ensure(actual.sort().join("|") === [...names].sort().join("|"), "PROFILE_TREE_CANDIDATE_CHANGED");
      let next = 0, total = 0, failure = null;
      const readCheckpoint = () => { if (failure) throw failure; checkpoint(); };
      const reserveBytes = bytes => {
        readCheckpoint(); ensure(total + bytes <= 512 * 1024 * 1024, "PROFILE_TREE_CANDIDATE_CHANGED"); total += bytes;
      };
      async function reader() {
        while (!failure) {
          try {
            readCheckpoint(); const entry = files[next++]; if (!entry) return;
            const seen = await digestFile(entry.file, readCheckpoint, 512 * 1024 * 1024, reserveBytes); readCheckpoint();
            ensure(seen.sha256 === inventory[entry.name], "PROFILE_TREE_CANDIDATE_CHANGED");
          } catch (cause) { failure ??= cause; }
        }
      }
      // All engaged readers close their handles before the first error escapes.
      await Promise.all(Array.from({ length: Math.min(4, files.length) }, () => reader()));
      if (failure) throw failure;
      ensure((await digestFile(path.resolve(import.meta.filename), checkpoint)).sha256 === inventory[SELF], "PROFILE_TREE_PRODUCER_CHANGED");
      checkpoint();
    }
    try {
      async function bounded(action) {
        checkpoint(); let timeout, onAbort;
        try { return await Promise.race([Promise.resolve().then(action), new Promise((_, reject) => {
          const rejectWith = code => reject(Object.assign(new Error(code), { code }));
          onAbort = () => rejectWith("PROFILE_TREE_CANCELLED"); stop.signal.addEventListener("abort", onAbort, { once: true });
          timeout = setTimeout(() => { rejectWith("PROFILE_TREE_TIMEOUT"); stop.abort(); }, Math.max(1, timeoutMs - (performance.now() - began) - 2000));
        })]); } finally { clearTimeout(timeout); stop.signal.removeEventListener("abort", onAbort); }
      }
      checkpoint(); await bounded(() => (pendingMaterial = material()));
      availability = await bounded(() => controller.checkAvailability({ cwd: frozen.cwd, signal: stop.signal, executable: node.executable, executableSha256: node.sha256 }));
      ensure(availability?.available === true, "PROFILE_TREE_CONTROLLER_UNAVAILABLE"); checkpoint();
      // The collector retains its historical configured budget. The containing
      // Job enforces the smaller remaining run budget, including preparation.
      const bridgeBudget = timeoutMs;
      const body = { protocol, invocation_id: invocationId, input: frozen, timeout_ms: bridgeBudget };
      requestHash = fingerprint(body); const stdin = JSON.stringify({ ...body, request_sha256: requestHash }) + "\n";
      ensure(Buffer.byteLength(stdin) <= 262144, "PROFILE_TREE_INPUT_LIMIT");
      let bytes = 0; const chunks = [];
      const remaining = Math.floor(timeoutMs - (performance.now() - began)); ensure(remaining > 2000, "PROFILE_TREE_TIMEOUT");
      launchRequested = true;
      controllerPromise = controller.run({ runnerId: invocationId, executable: node.executable, executableSha256: node.sha256,
        args: [bridgePath], cwd: frozen.cwd, env: frozen.env, stdin, maxDurationMs: Math.max(1, remaining - 2000),
        maxOutputBytes: OUTPUT_LIMIT, maxPendingBytes: OUTPUT_LIMIT, stopTimeoutMs: 500 }, {
        signal: stop.signal, async onEvent(event) {
          try {
            checkpoint();
            if (event.type === "prepared") await (pendingMaterial = material());
            else if (event.type === "stdout") { ensure(Buffer.isBuffer(event.bytes), "PROFILE_TREE_PROTOCOL_INVALID"); bytes += event.bytes.length;
              ensure(bytes <= OUTPUT_LIMIT, "PROFILE_TREE_OUTPUT_LIMIT"); chunks.push(Buffer.from(event.bytes)); }
            else if (event.type === "stderr" && event.bytes?.length) fail("PROFILE_TREE_BRIDGE_DIAGNOSTIC");
            checkpoint();
          } catch (cause) {
            callbackErrorCode ??= typeof cause?.code === "string" && /^[A-Z][A-Z0-9_]{0,100}$/u.test(cause.code)
              ? cause.code : "PROFILE_TREE_CALLBACK_FAILED";
            throw cause;
          }
        },
      });
      const outcome = await Promise.race([controllerPromise.then(value => ({ value }), () => ({ rejected: true })), new Promise(resolve => {
        timer = setTimeout(() => { stop.abort(); resolve({ expired: true }); }, remaining);
      })]);
      if (!outcome.value) fail(outcome.expired ? "PROFILE_TREE_TIMEOUT" : "PROFILE_TREE_CONTROLLER_FAILED");
      observed = outcome.value; const termination = tree();
      if (termination.termination_state !== "confirmed") fail("PROFILE_TREE_TERMINATION_UNCONFIRMED");
      // Only a confirmed empty Job can expose the bounded callback cause.
      // Controller cancellation and timeout retain their own first-stop outcome.
      if (observed.reason_code === "PROCESS_CANCELLED") fail("PROFILE_TREE_CANCELLED");
      if (observed.reason_code === "PROCESS_TIMEOUT") fail("PROFILE_TREE_TIMEOUT");
      if (observed.reason_code === "PROCESS_CALLBACK_FAILED") fail(callbackErrorCode ?? "PROFILE_TREE_CALLBACK_FAILED");
      if (!bytes && observed.outcome !== "completed") fail("PROFILE_TREE_EXECUTION_FAILED");
      let envelope; try { envelope = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks, bytes))); }
      catch { fail("PROFILE_TREE_PROTOCOL_INVALID"); }
      ensure(envelope?.protocol === body.protocol && envelope.request_sha256 === requestHash && envelope.invocation_id === invocationId
        && typeof envelope.ok === "boolean", "PROFILE_TREE_PROTOCOL_INVALID");
      const parent = parentEvidence(envelope.ok ? envelope.result?.process : envelope.error?.process, bridgeBudget);
      const process = { ...parent, tree_termination: termination };
      if (!envelope.ok) fail(/^[A-Z][A-Z0-9_]{0,100}$/u.test(envelope.error?.code ?? "") ? envelope.error.code : "PROFILE_TREE_BRIDGE_FAILED", process);
      ensure(observed.outcome === "completed" && observed.exit_code === 0 && parent.closed && parent.pid_absent
        && parent.exit_code === 0 && parent.signal === null && parent.response_count === frozen.roots.length + 3,
      "PROFILE_TREE_EXECUTION_FAILED");
      checkpoint();
      ensure(Array.isArray(envelope.result.configs) && envelope.result.configs.length === frozen.roots.length, "PROFILE_TREE_PROTOCOL_INVALID");
      ensure(!Object.hasOwn(envelope.result, "requirements"), "PROFILE_TREE_PROTOCOL_INVALID");
      return { ...envelope.result, process };
    } catch (cause) {
      primaryFailure = cause; stop.abort();
      if (!cause.process) cause.process = { ...parentEvidence(null, timeoutMs), tree_termination: tree() };
      if (cause.process.tree_termination?.termination_state === "unknown") recoveryRequired = true;
      throw cause;
    } finally {
      clearTimeout(timer); signal?.removeEventListener("abort", abort);
      // Drain within the original deadline, including its cleanup reserve.
      // An outstanding filesystem call cannot be cancelled; quarantine instead
      // of extending the budget or permitting another invocation.
      let materialUnconfirmed = false;
      if (pendingMaterial) {
        let settled = false, drainTimer;
        const drained = pendingMaterial.then(() => { settled = true; }, () => { settled = true; });
        try {
          await Promise.race([drained, new Promise(resolve => {
            drainTimer = setTimeout(resolve, Math.max(0, timeoutMs - (performance.now() - began)));
          })]);
        } finally { clearTimeout(drainTimer); }
        if (!settled) {
          materialUnconfirmed = true; stop.abort(); recoveryRequired = true;
          if (primaryFailure?.process) primaryFailure.process.material_cleanup = "UNCONFIRMED";
        }
      }
      active = false;
      if (materialUnconfirmed && !primaryFailure) fail("PROFILE_TREE_MATERIAL_CLEANUP_UNCONFIRMED",
        { ...parentEvidence(null, timeoutMs), tree_termination: tree(), material_cleanup: "UNCONFIRMED" });
    }
  };
}
