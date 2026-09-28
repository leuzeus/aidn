import fs from "node:fs/promises";
import path from "node:path";
import net from "node:net";
import { createHash, randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { fingerprintAgentExecutionValue as fingerprint } from "../../src/core/agents/agent-execution-contracts.mjs";
import { assertCodexSandboxValidationConfiguration, buildCodexSandboxValidationInvocation,
  inspectCodexSandboxValidationConfiguration, assertCodexSandboxValidationLaunchSupported, createCodexValidationStreamParser, assertCodexSandboxProtectedBaseline, assertCodexCooperativeConcurrency } from "../../src/adapters/runtime/codex-sandbox-validation-boundary.mjs";
import { createWindowsProcessTreeController } from "../../src/adapters/agents/process-tree/windows-process-tree-controller.mjs";

const CASES = ["filesystem", "network", "timeout", "cancel", "callback"];
const SOURCE = path.join(import.meta.dirname, "codex-validation-native-probe.mjs");
const HASH = /^[a-f0-9]{64}$/u;
const hostKeys = ["configuration_sha256", "provisioning_sha256", "accounts_sha256", "acl_sha256", "firewall_sha256"];
const requireThat = (condition, code) => { if (!condition) throw Object.assign(new Error(code), { code }); };
const inside = (root, target) => { const relative = path.relative(root, target); return relative && !relative.startsWith("..") && !path.isAbsolute(relative); };
const hash = data => createHash("sha256").update(data).digest("hex");
async function filePin(file, limit = 262144) {
  requireThat(path.isAbsolute(file), "NATIVE_PROBE_FILE_INVALID"); let cursor = path.resolve(file);
  for (;;) { requireThat(!(await fs.lstat(cursor)).isSymbolicLink(), "NATIVE_PROBE_FILE_ALIAS"); const parent = path.dirname(cursor); if (parent === cursor) break; cursor = parent; }
  requireThat((await fs.realpath(file)).toLowerCase() === path.resolve(file).toLowerCase(), "NATIVE_PROBE_FILE_ALIAS");
  const stat = await fs.lstat(file); requireThat(stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1 && stat.size <= limit, "NATIVE_PROBE_FILE_INVALID");
  const handle = await fs.open(file, "r"), chunks = []; let bytes = 0;
  try { const opened = await handle.stat(); requireThat(opened.dev === stat.dev && opened.ino === stat.ino, "NATIVE_PROBE_FILE_CHANGED");
    for (;;) { const buffer = Buffer.alloc(Math.min(65536, limit - bytes + 1)), read = await handle.read(buffer, 0, buffer.length, null); if (!read.bytesRead) break;
      bytes += read.bytesRead; requireThat(bytes <= limit, "NATIVE_PROBE_FILE_INVALID"); chunks.push(buffer.subarray(0, read.bytesRead)); }
    const after = await handle.stat(); requireThat(bytes === stat.size && after.size === stat.size && after.mtimeMs === stat.mtimeMs && after.ctimeMs === stat.ctimeMs, "NATIVE_PROBE_FILE_CHANGED");
    return { sha256: hash(Buffer.concat(chunks, bytes)), bytes };
  } finally { await handle.close(); }
}
const networkUnguaranteed = config => config.contract_version === "codex-sandbox-validation-configuration.v4";
const cooperative = config => config.contract_version === "codex-sandbox-validation-configuration.v3" || networkUnguaranteed(config);
const managed = config => config.contract_version === "codex-sandbox-validation-configuration.v2" || cooperative(config);
function baseline(value, config) { if (managed(config)) return assertCodexSandboxProtectedBaseline(value, config); requireThat(value && Object.keys(value).sort().join("|") === [...hostKeys].sort().join("|") && hostKeys.every(key => HASH.test(value[key])), "NATIVE_PROBE_HOST_BASELINE_REQUIRED"); }

// Pure preview. No listener, files, profiles, accounts, ACLs or child processes.
// Each case needs a separate exact approval when run; the tool never signs a
// qualification and never reports runtime availability itself.
export function buildCodexValidationQualificationPlan({ configuration, environment, probe, cwd, canaries, networkPort, challenge, hostBaseline, evidenceRoot }) {
  assertCodexSandboxValidationConfiguration(configuration); baseline(hostBaseline, configuration);
  requireThat(probe && path.isAbsolute(probe.path) && HASH.test(probe.sha256) && inside(configuration.roots.snapshots, probe.path)
    && path.isAbsolute(cwd) && inside(configuration.roots.snapshots, cwd), "NATIVE_PROBE_SNAPSHOT_INVALID");
  requireThat(canaries && Object.keys(canaries).sort().join("|") === "scratch_file|snapshot_file|supervisor_file"
    && Object.values(canaries).every(path.isAbsolute) && inside(cwd, canaries.snapshot_file) && inside(configuration.roots.scratch, canaries.scratch_file)
    && inside(configuration.roots.supervisor, canaries.supervisor_file) && !inside(configuration.roots.snapshots, canaries.supervisor_file)
    && !inside(configuration.roots.scratch, canaries.supervisor_file), "NATIVE_PROBE_CANARIES_INVALID");
  requireThat(/^[a-f0-9-]{36}$/u.test(challenge) && Number.isSafeInteger(networkPort) && networkPort >= 1024 && networkPort <= 65535, "NATIVE_PROBE_PARAMETERS_INVALID");
  requireThat(typeof evidenceRoot === "string" && path.isAbsolute(evidenceRoot) && inside(configuration.roots.supervisor, evidenceRoot)
    && !inside(configuration.roots.snapshots, evidenceRoot) && !inside(configuration.roots.scratch, evidenceRoot), "NATIVE_PROBE_EVIDENCE_ROOT_INVALID");
  const sync = Object.fromEntries(["companion_ready", "during_done", "companion_stopped"].map(name => [name, path.join(path.dirname(canaries.scratch_file), `probe-${challenge}-${name}.json`)]));
  const cases = CASES.map(caseId => {
    const payload = { case_id: caseId, challenge, ...canaries, port: networkPort,
      ...(cooperative(configuration) ? { assurance_profile: configuration.assurance_profile, ...(networkUnguaranteed(configuration) ? { read_isolation: "not_guaranteed", network_isolation: "not_guaranteed" } : {}), ...(caseId === "filesystem" ? { role: "primary", sync } : {}) } : {}) };
    const invocation = { invocation_id: `probe.${caseId}.${challenge}`, boundary_id: configuration.boundary_id, validation_id: `probe.${caseId}`,
      executable: configuration.runner.executable, executable_sha256: configuration.runner.sha256, argv: [probe.path, JSON.stringify(payload)], cwd,
      environment_sha256: configuration.environment_sha256, max_duration_ms: cooperative(configuration) ? 60000 : 15000, max_output_bytes: 65536 };
    const request = { ...invocation, request_sha256: fingerprint(invocation), environment };
    const launch = buildCodexSandboxValidationInvocation(configuration, request);
    if (caseId === "timeout") { const input = JSON.parse(launch.stdin); input.max_duration_ms = 2500; launch.stdin = JSON.stringify(input) + "\n"; }
    let companion;
    if (cooperative(configuration) && caseId === "filesystem") {
      const invocation2 = { ...invocation, invocation_id: `probe.companion.${challenge}`, argv: [probe.path, JSON.stringify({ ...payload, role: "companion" })] };
      const request2 = { ...invocation2, request_sha256: fingerprint(invocation2), environment };
      companion = { request: request2, launch_sha256: fingerprint(buildCodexSandboxValidationInvocation(configuration, request2)), sync };
    }
    return { case_id: caseId, ...(networkUnguaranteed(configuration) ? { evidence_role: caseId === "network" ? "diagnostic" : "qualification" } : {}), request, launch_sha256: fingerprint(launch), ...(companion ? { companion } : {}), expected_effects: caseId === "filesystem"
      ? cooperative(configuration) ? ["start two official Codex sandbox processes in distinct Jobs", "create three exact scratch rendezvous files", "test denied snapshot and supervisor writes during and after the companion", "create the scratch canary", "observe both Jobs empty; read isolation is not guaranteed"] : ["read the snapshot canary", "attempt denied snapshot write", "create the scratch canary", "attempt denied supervisor canary read and write"]
      : caseId === "network" ? ["open one local canary listener with a positive control", "attempt a sandboxed connection to that listener", "close the listener"]
      : ["create a bounded Node descendant", `stop through ${caseId}`, "observe zero active processes in the exact containing Job"] };
  });
  const plan = { contract_version: networkUnguaranteed(configuration) ? "codex-validation-native-plan.v4" : cooperative(configuration) ? "codex-validation-native-plan.v3" : managed(configuration) ? "codex-validation-native-plan.v2" : "codex-validation-native-plan.v1", configuration_sha256: fingerprint(configuration), probe, cwd, canaries,
    network_port: networkPort, challenge, ...(cooperative(configuration) ? { assurance_profile: configuration.assurance_profile, read_isolation: "not_guaranteed", max_duration_ms: 60000 } : {}), host_baseline: hostBaseline, evidence_root: evidenceRoot, cases: networkUnguaranteed(configuration) ? cases.filter(row => row.case_id !== "network") : cases,
    ...(networkUnguaranteed(configuration) ? { network_isolation: "not_guaranteed", diagnostic_cases: cases.filter(row => row.case_id === "network") } : {}),
    ...(managed(configuration) ? { sandbox_maintenance: "codex-managed", protected_resources: structuredClone(configuration.protected_resources),
      prohibited_effects: ["protected resource changes", "configuration or trust changes", "AIDN sandbox setup or repair", "fallback execution"] }
      : { prohibited_effects: ["sandbox setup", "account changes", "ACL changes", "firewall changes", "profile changes", "trust injection", "fallback execution"] }) };
  return { ...plan, plan_sha256: fingerprint(plan) };
}
async function observe(observer, { caseId, phase, expected, signal, configuration }) {
  requireThat(typeof observer === "function", "NATIVE_PROBE_HOST_OBSERVER_REQUIRED"); const challenge = randomUUID(), began = performance.now(); let timer;
  try {
    const result = await Promise.race([Promise.resolve().then(() => observer({ caseId, phase, challenge, signal, ...(managed(configuration) ? { protected_resources: structuredClone(configuration.protected_resources),
      protected_resources_sha256: fingerprint(configuration.protected_resources) } : {}) })), new Promise((_, reject) => {
      timer = setTimeout(() => reject(Object.assign(new Error("NATIVE_PROBE_HOST_OBSERVER_TIMEOUT"), { code: "NATIVE_PROBE_HOST_OBSERVER_TIMEOUT" })), 4500);
    })]);
    requireThat(!signal?.aborted && performance.now() - began < 4500 && result?.challenge === challenge && result.phase === phase && result.case_id === caseId
      && Number.isFinite(Date.parse(result.observed_at)) && Math.abs(Date.now() - Date.parse(result.observed_at)) <= 5000, "NATIVE_PROBE_HOST_OBSERVATION_INVALID");
    baseline(result.material, configuration); requireThat(fingerprint(result.material) === fingerprint(expected), "NATIVE_PROBE_HOST_CHANGED"); return result;
  } finally { clearTimeout(timer); }
}
async function listener(port, challenge) {
  let controls = 0, attempts = 0; const sockets = new Set();
  const server = net.createServer(socket => { sockets.add(socket); const control = controls === 0; if (!control) attempts++;
    let content = ""; socket.setTimeout(1500, () => socket.destroy()); socket.on("data", data => { content += data.toString(); if (content.length > 256) socket.destroy(); });
    socket.on("end", () => { if (control && content === challenge) controls++; }); socket.on("close", () => sockets.delete(socket)); socket.on("error", () => {});
  });
  try { await new Promise((resolve, reject) => { server.once("error", reject); server.listen(port, "127.0.0.1", resolve); });
    await new Promise((resolve, reject) => { const socket = net.createConnection({ host: "127.0.0.1", port }); socket.setTimeout(1500, () => { socket.destroy(); reject(new Error("NATIVE_PROBE_LISTENER_CONTROL_FAILED")); });
      socket.once("error", reject); socket.once("connect", () => socket.end(challenge)); socket.once("close", resolve); });
    requireThat(controls === 1, "NATIVE_PROBE_LISTENER_CONTROL_FAILED");
    return { observation: () => ({ positive_control: controls === 1, sandbox_connections: attempts }), close: () => new Promise(resolve => { for (const socket of sockets) socket.destroy(); server.close(resolve); }) };
  } catch (cause) { for (const socket of sockets) socket.destroy(); server.close(); throw cause; }
}

// Retain only a bounded diagnostic tail locally. Full-stream totals and hash
// remain those produced by the process controller, including undelivered bytes.
export function createCodexValidationProbeStderr() {
  const limit = 4096; let tail = Buffer.alloc(0), observed = 0;
  return {
    consume(bytes) { const chunk = Buffer.from(bytes); observed += chunk.length;
      tail = chunk.length >= limit ? Buffer.from(chunk.subarray(-limit)) : Buffer.concat([tail, chunk]).subarray(-limit); },
    snapshot(process) {
      let text = null, offset = 0;
      if (observed > tail.length) while (offset < Math.min(4, tail.length) && (tail[offset] & 0xc0) === 0x80) offset++;
      try { text = new TextDecoder("utf-8", { fatal: true }).decode(tail.subarray(offset)); } catch { /* Exact bytes remain available below. */ }
      return { total_bytes: process?.bytes?.stderr ?? null, sha256: process?.hashes?.stderr_sha256 ?? null,
        observed_bytes: observed, retained_bytes: tail.length, truncated: (process?.bytes?.stderr ?? observed) > tail.length,
        tail_base64: tail.toString("base64"), tail_utf8: text };
    },
  };
}
// The framed controller retains cumulative child stdout. Consume each complete
// JSONL observation once, including when transport chunks split or join lines.
export function createCodexValidationObservationReader() {
  let consumed = 0;
  return stdout => {
    requireThat(Buffer.isBuffer(stdout) && stdout.length >= consumed && stdout.length <= 65536, "NATIVE_PROBE_OBSERVATION_INVALID");
    const values = [];
    for (;;) {
      const end = stdout.indexOf(10, consumed); if (end < 0) break;
      const line = stdout.subarray(consumed, end); consumed = end + 1;
      requireThat(line.length > 0, "NATIVE_PROBE_OBSERVATION_INVALID");
      values.push(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(line)));
    }
    return values;
  };
}
export function assertCodexValidationProbeTermination(process, member, jobName) {
  requireThat(process?.termination_state === "confirmed" && process.termination_proof?.job_name === jobName
    && process.termination_proof.active_processes === 0, "NATIVE_PROBE_TERMINATION_UNCONFIRMED");
  // Missing handshake says nothing about a child's start. It must not erase
  // the independently confirmed termination of the containing process tree.
  requireThat(member, "NATIVE_PROBE_CHILD_NOT_OBSERVED");
  requireThat(member.parent_job_member === true && member.parent_job_name === jobName, "NATIVE_PROBE_CHILD_MEMBERSHIP_UNCONFIRMED");
  return true;
}

// An explicit reviewed case is the only native entry point. Its result is raw
// review material: independent review must still authenticate provenance and
// decide whether to sign a separate native qualification under the plan key.
export async function executeCodexValidationQualificationCase({ configuration, plan, caseId, execute = false, expectPlan, observeHost, signal } = {}) {
  const began = performance.now();
  const { plan_sha256: expected, ...body } = plan ?? {};
  requireThat(execute === true && expected === expectPlan && fingerprint(body) === expected, "NATIVE_PROBE_EXACT_APPROVAL_REQUIRED");
  requireThat(plan.configuration_sha256 === fingerprint(configuration), "NATIVE_PROBE_CONFIGURATION_CHANGED");
  // This gate precedes source reads, observers, listeners, intent writes and processes.
  assertCodexSandboxValidationLaunchSupported(configuration);
  const selected = [...plan.cases, ...(networkUnguaranteed(configuration) ? plan.diagnostic_cases : [])].find(row => row.case_id === caseId); requireThat(selected && CASES.includes(caseId), "NATIVE_PROBE_CASE_INVALID");
  const rebuilt = buildCodexValidationQualificationPlan({ configuration, environment: selected.request.environment, probe: plan.probe, cwd: plan.cwd,
    canaries: plan.canaries, networkPort: plan.network_port, challenge: plan.challenge, hostBaseline: plan.host_baseline, evidenceRoot: plan.evidence_root });
  requireThat(rebuilt.plan_sha256 === expected, "NATIVE_PROBE_PLAN_CHANGED");
  if (selected.companion) for (const file of Object.values(selected.companion.sync)) {
    try { await fs.lstat(file); throw Object.assign(new Error(), { code: "NATIVE_PROBE_SYNC_ALREADY_EXISTS" }); }
    catch (cause) { if (cause.code !== "ENOENT") throw cause; }
  }
  const source = await filePin(SOURCE), copied = await filePin(plan.probe.path);
  requireThat(source.sha256 === plan.probe.sha256 && copied.sha256 === source.sha256 && copied.bytes === source.bytes, "NATIVE_PROBE_SOURCE_CHANGED");
  const before = await observe(observeHost, { caseId, phase: "before", expected: plan.host_baseline, signal, configuration });
  await inspectCodexSandboxValidationConfiguration(configuration, { cwd: plan.cwd, signal });
  const snapshot = await filePin(plan.canaries.snapshot_file), supervisor = await filePin(plan.canaries.supervisor_file);
  requireThat(snapshot.bytes >= 36 && supervisor.bytes >= 36, "NATIVE_PROBE_CANARY_TOO_SMALL");
  try {
    const scratch = await filePin(plan.canaries.scratch_file);
    requireThat(caseId !== "filesystem" && scratch.sha256 === hash(plan.challenge), "NATIVE_PROBE_SCRATCH_ALREADY_EXISTS");
  } catch (cause) { if (cause.code !== "ENOENT") throw cause; }
  requireThat((await fs.realpath(path.dirname(plan.canaries.scratch_file))).toLowerCase() === path.dirname(plan.canaries.scratch_file).toLowerCase(), "NATIVE_PROBE_FILE_ALIAS");
  const evidenceStat = await fs.lstat(plan.evidence_root);
  requireThat(evidenceStat.isDirectory() && !evidenceStat.isSymbolicLink()
    && (await fs.realpath(plan.evidence_root)).toLowerCase() === path.resolve(plan.evidence_root).toLowerCase(), "NATIVE_PROBE_EVIDENCE_ROOT_INVALID");
  requireThat(!cooperative(configuration) || performance.now() - began < 45000, "NATIVE_PROBE_BUDGET_EXPIRED");
  await fs.writeFile(path.join(plan.evidence_root, `${caseId}.intent.json`), JSON.stringify({ plan_sha256: expected, case_id: caseId, request_sha256: selected.request.request_sha256, observed_at: new Date().toISOString() }) + "\n", { flag: "wx" });
  const stop = new AbortController(), abort = () => stop.abort(signal.reason); signal?.addEventListener("abort", abort, { once: true }); if (signal?.aborted) abort();
  // Request stop at 50 seconds including preparation; reserve ten seconds for
  // Job termination and final observations inside the reviewed 60-second budget.
  const budgetTimer = cooperative(configuration) ? setTimeout(() => stop.abort(), Math.max(1, 50000 - (performance.now() - began))) : null;
  const controller = createWindowsProcessTreeController(configuration.controller), stream = createCodexValidationStreamParser(selected.request), stderr = createCodexValidationProbeStderr(), observations = createCodexValidationObservationReader();
  const launch = buildCodexSandboxValidationInvocation(configuration, selected.request); let network, processResult, diagnostic = null, observation = null, after = null, childTerminal = null, concurrency = null, companionPromise = null;
  let processLaunchedAt = null, childPreparedAt = null, processSettledAt = null;
  try {
    if (caseId === "network") network = await listener(plan.network_port, plan.challenge);
    if (caseId === "timeout") { const input = JSON.parse(launch.stdin); input.max_duration_ms = 2500; launch.stdin = JSON.stringify(input) + "\n"; }
    requireThat(fingerprint(launch) === selected.launch_sha256, "NATIVE_PROBE_LAUNCH_CHANGED");
    processLaunchedAt = performance.now();
    processResult = await controller.run(launch, { signal: stop.signal, async onEvent(event) {
      if (event.type === "prepared") {
        await inspectCodexSandboxValidationConfiguration(configuration, { cwd: plan.cwd, signal: stop.signal });
        await observe(observeHost, { caseId, phase: "before_resume", expected: plan.host_baseline, signal: stop.signal, configuration });
      }
      if (event.type === "stderr") { stderr.consume(event.bytes); return; }
      if (event.type !== "stdout") return; stream.consume(event.bytes);
      if (childPreparedAt === null && stream.observation()) childPreparedAt = performance.now();
      for (const decoded of observations(stream.output().stdout)) {
      observation = decoded;
      requireThat(observation.challenge === plan.challenge && observation.case_id === caseId && observation.contract_version === (networkUnguaranteed(configuration) ? "codex-validation-native-observation.v3" : cooperative(configuration) ? "codex-validation-native-observation.v2" : "codex-validation-native-observation.v1")
        && observation.environment_sha256 === configuration.environment_sha256
        && (!networkUnguaranteed(configuration) || observation.assurance_profile === configuration.assurance_profile
          && observation.read_isolation === "not_guaranteed" && observation.network_isolation === "not_guaranteed"), "NATIVE_PROBE_OBSERVATION_MISMATCH");
      if (selected.companion && observation.phase === "primary_ready") {
        requireThat(!companionPromise && observation.pid === stream.observation()?.pid, "NATIVE_PROBE_COMPANION_ALREADY_STARTED");
        const companionStream = createCodexValidationStreamParser(selected.companion.request), companionStderr = createCodexValidationProbeStderr();
        const companionLaunch = buildCodexSandboxValidationInvocation(configuration, selected.companion.request);
        requireThat(fingerprint(companionLaunch) === selected.companion.launch_sha256, "NATIVE_PROBE_LAUNCH_CHANGED");
        concurrency = { process: null, prepared: null, child_terminal: null, observation: null, diagnostic: null, stderr: null };
        companionPromise = (async () => {
          try {
            concurrency.process = await controller.run(companionLaunch, { signal: stop.signal, async onEvent(companionEvent) {
              if (companionEvent.type === "prepared") {
                await inspectCodexSandboxValidationConfiguration(configuration, { cwd: plan.cwd, signal: stop.signal });
                await observe(observeHost, { caseId, phase: "before_resume", expected: plan.host_baseline, signal: stop.signal, configuration });
              }
              if (companionEvent.type === "stderr") companionStderr.consume(companionEvent.bytes);
              if (companionEvent.type === "stdout") companionStream.consume(companionEvent.bytes);
            } });
            concurrency.prepared = companionStream.observation();
            assertCodexValidationProbeTermination(concurrency.process, concurrency.prepared, companionLaunch.jobName);
            const finished = companionStream.finish(); concurrency.child_terminal = finished.terminal;
            concurrency.observation = JSON.parse(finished.stdout.toString("utf8"));
            requireThat(concurrency.child_terminal.outcome === "completed" && concurrency.process.outcome === "completed"
              && concurrency.observation.phase === "companion_completed" && concurrency.observation.challenge === plan.challenge
              && concurrency.observation.pid === concurrency.prepared.pid && concurrency.observation.observations?.primary_pid === decoded.pid,
            "NATIVE_PROBE_COMPANION_FAILED");
            await fs.writeFile(selected.companion.sync.companion_stopped, JSON.stringify({ challenge: plan.challenge,
              companion_pid: concurrency.prepared.pid, termination_state: "confirmed" }) + "\n", { flag: "wx" });
          } catch (cause) { concurrency.diagnostic = cause.code ?? cause.message; stop.abort(); }
          finally { concurrency.prepared ??= companionStream.observation(); concurrency.stderr = companionStderr.snapshot(concurrency.process); }
        })();
        continue;
      }
      if (["timeout", "cancel", "callback"].includes(caseId)) requireThat(Number.isSafeInteger(observation.observations?.descendant_pid) && observation.observations.descendant_pid > 0, "NATIVE_PROBE_DESCENDANT_MISSING");
      if (caseId === "cancel") stop.abort(); if (caseId === "callback") throw new Error("NATIVE_PROBE_EXPECTED_CALLBACK_FAILURE");
      }
    } }).finally(() => { processSettledAt = performance.now(); });
    if (companionPromise) await companionPromise;
    assertCodexValidationProbeTermination(processResult, stream.observation(), launch.jobName);
    requireThat(observation, "NATIVE_PROBE_OBSERVATION_MISSING");
    if (["filesystem", "network", "timeout"].includes(caseId)) { childTerminal = stream.finish().terminal;
      requireThat(childTerminal.outcome === (caseId === "timeout" ? "timed_out" : "completed"), "NATIVE_PROBE_OUTCOME_MISMATCH"); }
    if (caseId === "cancel") requireThat(processResult.reason_code === "PROCESS_CANCELLED", "NATIVE_PROBE_OUTCOME_MISMATCH");
    if (caseId === "callback") requireThat(processResult.reason_code === "PROCESS_CALLBACK_FAILED", "NATIVE_PROBE_OUTCOME_MISMATCH");
    if (caseId === "filesystem") requireThat(observation.observations.snapshot_sha256 === snapshot.sha256 && observation.observations.snapshot_write_denied === true
      && (cooperative(configuration) || observation.observations.supervisor_read_denied === true) && observation.observations.supervisor_write_denied === true
      && observation.observations.scratch_sha256 === hash(plan.challenge), "NATIVE_PROBE_BOUNDARY_FAILED");
    if (selected.companion) assertCodexCooperativeConcurrency({ concurrency, observation, process: processResult }, configuration);
    if (caseId === "network") requireThat(["denied", "timed_out"].includes(observation.observations.network) && network.observation().sandbox_connections === 0, "NATIVE_PROBE_NETWORK_FAILED");
    requireThat(fingerprint(await filePin(plan.canaries.snapshot_file)) === fingerprint(snapshot)
      && fingerprint(await filePin(plan.canaries.supervisor_file)) === fingerprint(supervisor), "NATIVE_PROBE_CANARY_CHANGED");
    await inspectCodexSandboxValidationConfiguration(configuration, { cwd: plan.cwd, signal });
    after = await observe(observeHost, { caseId, phase: "after", expected: plan.host_baseline, signal, configuration });
  } catch (cause) { diagnostic = cause.code ?? cause.message; stop.abort(); }
  finally {
    if (companionPromise) { if (diagnostic) stop.abort(); await companionPromise; }
    if (budgetTimer) clearTimeout(budgetTimer);
    if (network) await network.close(); signal?.removeEventListener("abort", abort);
    if (!after && processResult?.termination_state === "confirmed" && (!concurrency || concurrency.process?.termination_state === "confirmed")) {
      try { after = await observe(observeHost, { caseId, phase: "after", expected: plan.host_baseline, signal, configuration }); }
      catch (cause) { diagnostic ??= cause.code ?? cause.message; }
    }
  }
  if (cooperative(configuration) && performance.now() - began > 60000) diagnostic ??= "NATIVE_PROBE_BUDGET_EXPIRED";
  const report = { status: diagnostic ? "FAIL" : "READY_FOR_INDEPENDENT_REVIEW", case_id: caseId, plan_sha256: expected,
    configuration_sha256: plan.configuration_sha256,
    ...(managed(configuration) ? { sandbox_maintenance: "codex-managed", protected_resources_sha256: fingerprint(configuration.protected_resources) } : {}),
    ...(cooperative(configuration) ? { assurance_profile: configuration.assurance_profile, read_isolation: "not_guaranteed", concurrency, elapsed_ms: Math.ceil(performance.now() - began),
      timings: { preflight_ms: processLaunchedAt === null ? null : Math.ceil(processLaunchedAt - began),
        child_startup_ms: childPreparedAt === null ? null : Math.ceil(childPreparedAt - processLaunchedAt),
        probe_ms: childPreparedAt === null || processSettledAt === null ? null : Math.ceil(processSettledAt - childPreparedAt) } } : {}),
    ...(networkUnguaranteed(configuration) ? { network_isolation: "not_guaranteed", evidence_role: selected.evidence_role } : {}),
    source, before, after, observation, prepared: stream.observation(), child_terminal: childTerminal, process: processResult ?? null,
    network: network?.observation() ?? null, diagnostic, stderr: stderr.snapshot(processResult), native_availability: false,
    retention: "Preserve canaries, outputs and failed evidence. This helper never signs a qualification or cleans resources." };
  await fs.writeFile(path.join(plan.evidence_root, `${caseId}.result.json`), JSON.stringify(report) + "\n", { flag: "wx" }); return report;
}
