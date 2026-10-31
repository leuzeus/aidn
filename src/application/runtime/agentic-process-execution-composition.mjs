import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { createAgenticProcessService } from "./agentic-process-service.mjs";
import { createAgenticProcessExecutionHost } from "./agentic-process-execution-host.mjs";
import { createAgenticProcessStore } from "../../adapters/runtime/agentic-process-store.mjs";
import { createAgenticCodexSessions } from "../../adapters/agents/agentic-codex-session.mjs";
import { readWorkflowProjectAuthority } from "./workflow-instance-composition.mjs";
import { agenticPolicyPins, assertAgenticProcessModel, processId, processFail as fail } from "../../core/workflow/agentic-process-model.mjs";
import { shadowHash, checkShadowJson } from "../../core/workflow/shadow-json.mjs";
import { AGENT_ROLES, buildAgentProfile, canAgentRolePerform } from "../../core/agents/agent-role-model.mjs";
import { assertCodexStartupArgumentsConfiguration } from "../../core/agents/codex-startup-arguments.mjs";
import { agenticProcessImplementationPins } from "./agentic-process-implementation-pins.mjs";
import { agenticProcessPersistence, createAgenticProcessWorkerEnvironment } from "./agentic-process-persistence.mjs";

const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const digest = value => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const loadedImplementationSha256 = agenticProcessImplementationPins().sha256;
const inside = (root, file) => { const relative = path.relative(root, file); return relative === "" || relative && !path.isAbsolute(relative) && relative !== ".." && !relative.startsWith(".." + path.sep); };
function physical(root) {
  if (!path.isAbsolute(root ?? "") || fs.realpathSync(root) !== path.resolve(root)) fail("PROCESS_EXECUTION_PHYSICAL_ROOT_REQUIRED");
  return root;
}
function bytes(file, max = 262144) {
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size > max) fail("PROCESS_EXECUTION_FILE_INVALID");
  return fs.readFileSync(file);
}
function pinned(reference, roots) {
  if (!reference || !digest(reference.sha256) || !path.isAbsolute(reference.path ?? "")
    || roots.some(root => inside(root, reference.path))) fail("PROCESS_EXECUTION_INPUT_REFERENCE_INVALID");
  const data = bytes(reference.path);
  if (hash(data) !== reference.sha256) fail("PROCESS_EXECUTION_INPUT_CHANGED");
  return data;
}

// This is the real project composition. Tests may replace native/SQL wires, but
// not assignmentAuthority, resultAuthority, bindings, CAS or admission policy.
export function createProjectAgenticProcessExecution(configuration, { rpcFactory, artifactStoreFactory, environment = process.env } = {}) {
  if (checkShadowJson(configuration) || configuration.contract_version !== "agentic-process-execution.v1") fail("PROCESS_EXECUTION_CONFIGURATION_INVALID");
  const config = structuredClone(configuration);
  const fields = ["contract_version", "instance_id", "target_root", "product_root", "control_root", "review_root", "product_files", "model", "criteria", "authorities", "skills", "instructions", "native", "controller", "implementation_sha256"];
  if (Object.keys(config).some(key => !fields.includes(key)) || !digest(config.implementation_sha256)
    || config.implementation_sha256 !== loadedImplementationSha256
    || config.implementation_sha256 !== agenticProcessImplementationPins().sha256) fail("PROCESS_EXECUTION_IMPLEMENTATION_CHANGED");
  const targetRoot = physical(config.target_root), productRoot = physical(config.product_root), controlRoot = physical(config.control_root), reviewRoot = physical(config.review_root);
  if (!inside(targetRoot, productRoot) || targetRoot === productRoot || [targetRoot, productRoot].some(root => inside(root, controlRoot) || inside(root, reviewRoot))
    || inside(controlRoot, reviewRoot) || inside(reviewRoot, controlRoot)) fail("PROCESS_EXECUTION_ROOTS_OVERLAP");
  if (!processId(config.instance_id) || !Array.isArray(config.product_files) || !config.product_files.length || config.product_files.length > 128
    || new Set(config.product_files).size !== config.product_files.length) fail("PROCESS_EXECUTION_PRODUCT_SCOPE_INVALID");
  for (const name of config.product_files) {
    if (typeof name !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._/-]{0,191}$/.test(name)
      || name.split("/").some(part => ["..", ".", ".git", ".codex", ".aidn", "node_modules"].includes(part))
      || /(?:^|\/)(?:auth|credentials|secrets|config\.toml)(?:\.|$)/i.test(name)) fail("PROCESS_EXECUTION_PRODUCT_SCOPE_INVALID");
  }
  if (!config.native || !path.isAbsolute(config.native.executable ?? "") || !digest(config.native.sha256)
    || !path.isAbsolute(config.native.home ?? "") || !Array.isArray(config.native.tool_roots) || config.native.tool_roots.length > 16
    || typeof config.native.model !== "string" || !config.native.model || !["low", "medium", "high", "xhigh"].includes(config.native.effort)
    || !["work", "review"].every(kind => Array.isArray(config.native.hook_hashes?.[kind]) && config.native.hook_hashes[kind].length <= 16
      && config.native.hook_hashes[kind].every(value => /^sha256:[a-f0-9]{64}$/.test(value)))
    || config.native.hook_hashes.work.length !== 2
    || !config.instructions || typeof config.instructions !== "object" || Array.isArray(config.instructions)) fail("PROCESS_EXECUTION_NATIVE_CONFIGURATION_INVALID");
  physical(config.native.home);
  if (!Array.isArray(config.native.protected_roots ?? []) || (config.native.protected_roots ?? []).length > 16)
    fail("PROCESS_EXECUTION_PROTECTED_ROOT_INVALID");
  for (const root of config.native.protected_roots ?? []) {
    physical(root);
    if ([productRoot, reviewRoot, ...config.native.tool_roots].some(other => inside(root, other) || inside(other, root)))
      fail("PROCESS_EXECUTION_PROTECTED_ROOT_OVERLAP");
  }
  assertCodexStartupArgumentsConfiguration(config.native.startup);
  for (const root of config.native.tool_roots) {
    physical(root);
    if ([targetRoot, reviewRoot, controlRoot, config.native.home].some(other => inside(root, other) || inside(other, root))) fail("PROCESS_EXECUTION_TOOL_ROOT_OVERLAP");
  }
  const model = JSON.parse(pinned(config.model, [productRoot, reviewRoot]).toString("utf8")); assertAgenticProcessModel(model);
  for (const policy of model.policies) if (!["compatible-work.v1", "independent-review.v1"].includes(policy.assurance_profile)) fail("PROCESS_EXECUTION_ASSURANCE_PROFILE_UNSUPPORTED");
  for (const [key, value] of Object.entries(config.instructions)) if (!model.nodes.some(node => node.id === key && node.kind === "activity")
    || typeof value !== "string" || Buffer.byteLength(value) > 16384) fail("PROCESS_EXECUTION_INSTRUCTION_INVALID");
  const criteria = pinned(config.criteria, [productRoot, reviewRoot]).toString("utf8");
  if (!config.authorities || path.resolve(config.authorities.project?.path ?? "") !== path.join(targetRoot, "AGENTS.md")
    || Object.keys(config.authorities).length > 16) fail("PROCESS_EXECUTION_PROJECT_AUTHORITY_REQUIRED");
  const authorities = Object.fromEntries(Object.entries(config.authorities).map(([id, ref]) => [id, pinned(ref, [productRoot, reviewRoot]).toString("utf8")]));
  const skills = Object.fromEntries(Object.entries(config.skills ?? {}).map(([id, ref]) => [id, pinned(ref, [productRoot, reviewRoot]).toString("utf8")]));
  for (const role of model.roles) if (role.skills.some(skill => !Object.hasOwn(skills, skill))) fail("PROCESS_EXECUTION_SKILL_MISSING");
  const authorityAtCreation = readWorkflowProjectAuthority({ targetRoot });
  const persistence = agenticProcessPersistence({ targetRoot, env: environment });
  const scopeId = shadowHash({ project: authorityAtCreation.scope, persistence: persistence.binding_sha256 });
  function readAuthority() {
    const observed = readWorkflowProjectAuthority({ targetRoot });
    if (agenticProcessPersistence({ targetRoot, env: environment }).binding_sha256 !== persistence.binding_sha256) fail("PROCESS_EXECUTION_PERSISTENCE_CHANGED");
    if (observed.stateMode !== authorityAtCreation.stateMode || shadowHash(observed.scope) !== shadowHash(authorityAtCreation.scope)
      || config.implementation_sha256 !== agenticProcessImplementationPins().sha256 || observed.productVersion !== authorityAtCreation.productVersion
      || hash(bytes(config.model.path)) !== config.model.sha256 || hash(bytes(config.criteria.path)) !== config.criteria.sha256)
      fail("PROCESS_EXECUTION_AUTHORITY_CHANGED");
    for (const reference of Object.values(config.skills)) pinned(reference, [productRoot, reviewRoot]);
    for (const reference of Object.values(config.authorities)) pinned(reference, [productRoot, reviewRoot]);
    return { scope_id: scopeId, model_sha256: shadowHash(model), policy_pins: agenticPolicyPins(model) };
  }
  function productSnapshot(root = productRoot) {
    let visited = 0;
    function inventory(directory) {
      for (const entry of fs.readdirSync(directory)) {
        if (++visited > 512) fail("PROCESS_EXECUTION_PRODUCT_SCOPE_LIMIT");
        const file = path.join(directory, entry), stat = fs.lstatSync(file);
        if (stat.isSymbolicLink()) fail("PROCESS_EXECUTION_PRODUCT_SYMLINK");
        if (stat.isDirectory()) inventory(file);
        else if (!config.product_files.includes(path.relative(root, file).replaceAll(path.sep, "/"))) fail("PROCESS_EXECUTION_PRODUCT_SCOPE_CHANGED");
      }
    }
    inventory(root);
    return config.product_files.map(name => {
      const file = path.resolve(root, name);
      if (!inside(root, file)) fail("PROCESS_EXECUTION_PRODUCT_SCOPE_INVALID");
      const parent = path.dirname(file);
      if (fs.existsSync(parent) && fs.realpathSync(parent) !== parent) fail("PROCESS_EXECUTION_PRODUCT_SYMLINK");
      if (!fs.existsSync(file)) return { path: name, present: false };
      const data = bytes(file, 1024 * 1024);
      return { path: name, present: true, bytes: data.length, sha256: hash(data) };
    });
  }
  return Object.freeze({
    preview() { readAuthority(); return { contract_version: "agentic-process-execution-preview.v1", scope_id: scopeId,
      model_sha256: shadowHash(model), criteria_sha256: config.criteria.sha256, product_sha256: shadowHash(productSnapshot()), persistence, native_started: false, written: false }; },
    async run({ execute = false, authorization, signal, persistenceBinding = persistence.binding_sha256 } = {}) {
      if (execute !== true || authorization?.approved !== true || authorization.model_allowed !== true
        || !Number.isSafeInteger(authorization.authorized_at_ms) || !Number.isSafeInteger(authorization.global_deadline_ms)
        || authorization.authorized_at_ms > Date.now() || authorization.global_deadline_ms <= Date.now()
        || authorization.global_deadline_ms - authorization.authorized_at_ms > 10800000
        || !Number.isSafeInteger(authorization.workflow_deadline_ms) || authorization.workflow_deadline_ms <= Date.now()
        || authorization.workflow_deadline_ms > authorization.global_deadline_ms
        || !Number.isSafeInteger(authorization.max_turn_ms) || authorization.max_turn_ms < 1 || authorization.max_turn_ms > 2700000
        || authorization.configuration_sha256 !== shadowHash(config)
        || !Number.isSafeInteger(authorization.max_responses) || authorization.max_responses < 1 || authorization.max_responses > 120
        || !Number.isSafeInteger(authorization.max_bytes) || authorization.max_bytes < 1048576 || authorization.max_bytes > 471859200) fail("PROCESS_EXECUTION_EXPLICIT_AUTHORIZATION_REQUIRED");
      readAuthority();
      const workDeadline = Math.min(authorization.workflow_deadline_ms, authorization.global_deadline_ms - 20000);
      if (Date.now() >= workDeadline) fail("PROCESS_EXECUTION_CLOSURE_RESERVE");
      const storeEnvironment = createAgenticProcessWorkerEnvironment({ targetRoot, expectedBinding: persistenceBinding, env: environment });
      const store = createAgenticProcessStore({ targetRoot, stateMode: authorityAtCreation.stateMode, env: storeEnvironment,
        deadlineMs: workDeadline, ...(artifactStoreFactory ? { artifactStoreFactory } : {}) });
      if (store.read(config.instance_id).record) fail("PROCESS_EXECUTION_EXISTING_INSTANCE_REQUIRES_RECONCILIATION");
      const output = path.join(controlRoot, config.instance_id);
      fs.mkdirSync(output); // wx-style allocation: existing control folder refuses
      const stop = new AbortController(), responseIds = new Set(); let firstFailure = null, retainedBytes = 0, sequence = 0, diagnostics = 0;
      let canonicalPayloadAttempted = 0, canonicalPayloadAcknowledged = 0;
      let vanishedStorageEntries = 0, storageReadFailure = null;
      const reviewDirectories = [];
      function diskBytes(file, required = false) {
        let visited = 0;
        const read = (operation, entry, rootEntry) => {
          try { return fs[operation](entry); }
          catch (error) {
            // Live journals may disappear after readdir. Their retained size
            // is zero; disappearing roots and every other error still refuse.
            if (error.code === "ENOENT" && (!rootEntry || !required)) {
              if (!rootEntry) vanishedStorageEntries++;
              return null;
            }
            storageReadFailure ??= { error_code: /^[A-Z][A-Z0-9_]{0,63}$/.test(error.code ?? "") ? error.code : "UNKNOWN",
              operation, entry_sha256: hash(Buffer.from(entry)), observed_at_ms: Date.now() };
            fail("PROCESS_EXECUTION_STORAGE_UNVERIFIABLE");
          }
        };
        const count = (entry, rootEntry = false) => {
          if (++visited > 10000) fail("PROCESS_EXECUTION_STORAGE_ENTRY_LIMIT");
          const stat = read("lstatSync", entry, rootEntry);
          if (stat === null) return 0;
          if (stat.isSymbolicLink()) fail("PROCESS_EXECUTION_STORAGE_SYMLINK");
          if (!stat.isDirectory()) return stat.size;
          const names = read("readdirSync", entry, rootEntry);
          return names === null ? 0 : names.reduce((sum, name) => sum + count(path.join(entry, name)), 0);
        };
        return count(file, true);
      }
      const databaseFiles = persistence.backend === "sqlite" ? ["", "-wal", "-shm"].map(suffix => path.join(targetRoot, ".aidn/runtime/index/workflow-index.sqlite" + suffix)) : [];
      const baseline = databaseFiles.map(file => diskBytes(file));
      const productBaseline = diskBytes(productRoot, true);
      const localUsed = () => diskBytes(output, true) + reviewDirectories.reduce((sum, directory) => sum + diskBytes(directory, true), 0)
        + diskBytes(path.join(targetRoot, "docs/audit/workflows/process-instances", config.instance_id + ".json"))
        + Math.max(0, diskBytes(productRoot, true) - productBaseline)
        + databaseFiles.reduce((sum, file, index) => sum + Math.max(0, diskBytes(file) - baseline[index]), 0);
      const used = () => localUsed() + (persistence.backend === "postgres" ? canonicalPayloadAttempted : 0);
      const requestStop = code => { firstFailure ??= code; stop.abort(); };
      const onAbort = () => requestStop("PROCESS_EXECUTION_CANCELLED"); signal?.addEventListener("abort", onAbort, { once: true });
      if (signal?.aborted) onAbort();
      const timer = setTimeout(() => requestStop("PROCESS_EXECUTION_GLOBAL_DEADLINE"), Math.max(1, workDeadline - Date.now()));
      const storageTimer = setInterval(() => {
        try { if (used() > authorization.max_bytes - 262144) requestStop("PROCESS_EXECUTION_STORAGE_LIMIT"); }
        catch { requestStop("PROCESS_EXECUTION_STORAGE_UNVERIFIABLE"); }
      }, 100);
      const save = (name, value) => {
        const data = Buffer.from(JSON.stringify(value) + "\n");
        if (data.length > 262144 || used() + data.length > authorization.max_bytes - 262144) { requestStop("PROCESS_EXECUTION_STORAGE_LIMIT"); fail("PROCESS_EXECUTION_STORAGE_LIMIT"); }
        const file = path.join(output, name); fs.writeFileSync(file, data, { flag: "wx" }); retainedBytes += data.length;
        return { ref: `execution/${config.instance_id}/${name}`, sha256: hash(data) };
      };
      const evidence = {
        async retain(kind, value) { return save(`${String(++sequence).padStart(5, "0")}-${kind}.json`, value); },
        async verify(ref) { const name = ref.ref.split("/").at(-1); if (hash(bytes(path.join(output, name))) !== ref.sha256) fail("PROCESS_EXECUTION_EVIDENCE_CHANGED"); },
        diagnostic(value) {
          if (++diagnostics > 4096) { requestStop("PROCESS_EXECUTION_DIAGNOSTIC_LIMIT"); fail("PROCESS_EXECUTION_DIAGNOSTIC_LIMIT"); }
          save(`${String(++sequence).padStart(5, "0")}-transport.json`, value);
        },
      };
      const budget = {
        maxTurnMs: authorization.max_turn_ms,
        remainingBytes: () => Math.max(1, authorization.max_bytes - used() - 262144),
        response(threadId, responseId) {
          responseIds.add(`${threadId}:${responseId}`);
          if (responseIds.size > authorization.max_responses) { requestStop("PROCESS_EXECUTION_RESPONSE_LIMIT"); fail("PROCESS_EXECUTION_RESPONSE_LIMIT"); }
        },
      };
      const inputs = {
        async prepare({ instance, frame, role, policy }) {
          readAuthority(); const snapshot = productSnapshot(), artifact = shadowHash(snapshot);
          const input = { before: artifact, output: null, review_root: null,
            binding: { revision: artifact, artifact_sha256: artifact, criteria_sha256: config.criteria.sha256 } };
          if (policy.independent_review || policy.context_isolation_required) {
            if (process.platform === "win32") {
              // Files created by the sandbox account can retain explicit
              // creator grants. Re-publish identical bytes through the trusted
              // broker before applying the independent reader's filesystem policy.
              const staging = path.join(output, `broker-review-${sequence + 1}`); fs.mkdirSync(staging);
              const republished = [];
              for (const row of snapshot.filter(row => row.present)) {
                const original = path.join(productRoot, row.path), data = bytes(original, 1024 * 1024);
                if (hash(data) !== row.sha256) fail("PROCESS_EXECUTION_REVIEW_SNAPSHOT_CHANGED");
                if (used() + data.length > authorization.max_bytes - 262144) fail("PROCESS_EXECUTION_STORAGE_LIMIT");
                const staged = path.join(staging, String(republished.length)); fs.writeFileSync(staged, data, { flag: "wx" });
                if (hash(bytes(staged, 1024 * 1024)) !== row.sha256) fail("PROCESS_EXECUTION_BROKER_COPY_CHANGED");
                fs.renameSync(staged, original);
                if (hash(bytes(original, 1024 * 1024)) !== row.sha256) fail("PROCESS_EXECUTION_BROKER_COPY_CHANGED");
                republished.push({ path: row.path, bytes: row.bytes, sha256: row.sha256 });
              }
              if (shadowHash(productSnapshot()) !== artifact) fail("PROCESS_EXECUTION_PRODUCT_CHANGED");
              await evidence.retain("broker-product-republish", { files: republished, artifact_sha256: artifact,
                scope: "Windows controlled product files only; byte-identical broker publication, not a content correction" });
            }
            const directory = path.join(reviewRoot, `${config.instance_id}-${sequence + 1}`); fs.mkdirSync(directory); reviewDirectories.push(directory);
            for (const row of snapshot.filter(row => row.present)) {
              const destination = path.join(directory, row.path); fs.mkdirSync(path.dirname(destination), { recursive: true });
              const data = bytes(path.join(productRoot, row.path), 1024 * 1024);
              if (hash(data) !== row.sha256) fail("PROCESS_EXECUTION_REVIEW_SNAPSHOT_CHANGED");
              if (used() + data.length > authorization.max_bytes - 262144) fail("PROCESS_EXECUTION_STORAGE_LIMIT");
              fs.writeFileSync(destination, data, { flag: "wx" });
            }
            input.review_root = directory;
          }
          input.developer_instructions = ["Execute the assigned role only. Do not create other agents or alter workflow authority.",
            ...Object.entries(authorities).map(([id, text]) => `Common authority ${id} [${config.authorities[id].sha256}]:\n${text}`),
            policy.independent_review ? "Independent review: inspect the supplied product snapshot; do not change it. Reject if criteria fail." : "Implement only the admitted product-file scope.",
            `Product files: ${config.product_files.join(", ")}`, `Acceptance criteria:\n${criteria}`,
            ...role.skills.map(skill => `Skill ${skill}:\n${skills[skill]}`)].join("\n\n");
          input.instruction = `Activity ${frame.node_id}; role ${role.role}/${role.action}.\n${config.instructions[frame.node_id] ?? "Complete this activity against the acceptance criteria."}\nReturn the required JSON outcome and a concise factual summary.`;
          await evidence.retain("activity-input", { occurrence_id: frame.occurrence_id, artifact_sha256: artifact,
            criteria_sha256: config.criteria.sha256, developer_sha256: shadowHash(input.developer_instructions), instruction_sha256: shadowHash(input.instruction) });
          return input;
        },
        assertCurrent(input, { review }) { readAuthority(); const expected = review ? input.before : input.output ?? input.before;
          if (shadowHash(productSnapshot()) !== expected) fail("PROCESS_EXECUTION_PRODUCT_CHANGED");
          if (input.review_root && shadowHash(productSnapshot(input.review_root)) !== input.before) fail("PROCESS_EXECUTION_REVIEW_SNAPSHOT_CHANGED"); },
        async completed(input) {
          const snapshot = productSnapshot(); input.output = shadowHash(snapshot);
          await evidence.retain("artifact-output", { artifact_sha256: input.output, files: snapshot,
            provenance: "workspace observed after the bound native turn; not per-file writer authentication" });
        },
      };
      const sessions = createAgenticCodexSessions({ native: config.native, targetRoot, productRoot, controlRoot: output, evidence, budget,
        governanceEnvironment: storeEnvironment, ...(rpcFactory ? { rpcFactory } : {}) });
      const host = createAgenticProcessExecutionHost({ sessionFactory: sessions, inputs, evidence, deadline: workDeadline });
      const profile = buildAgentProfile({ id: "codex-agentic-session", label: "Owned Codex session", defaultRole: "coordinator", roles: AGENT_ROLES });
      const guardedStore = { ...store, compareAndSwap(instance, expected) {
        readAuthority();
        const payloadBytes = Buffer.byteLength(JSON.stringify(instance) + "\n");
        if (used() + 2 * payloadBytes > authorization.max_bytes - 262144) fail("PROCESS_EXECUTION_STORAGE_LIMIT");
        canonicalPayloadAttempted += payloadBytes;
        const retained = store.compareAndSwap(instance, expected);
        canonicalPayloadAcknowledged += payloadBytes;
        return retained;
      } };
      const service = createAgenticProcessService({ store: guardedStore, readAuthority, readBinding: host.readBinding,
        assignmentAuthority: host.assignmentAuthority, resultAuthority: host.resultAuthority,
        authorityTimeoutMs: 5000, adapters: [{ getProfile: () => profile, canHandleRole: ({ role, action }) => canAgentRolePerform(role, action) }] });
      let current = null, closure = null;
      const requireProjection = () => { if (current?.projection === "reconciliation_required") fail("PROCESS_EXECUTION_PROJECTION_RECONCILIATION_REQUIRED"); };
      try {
        if (stop.signal.aborted) fail(firstFailure ?? "PROCESS_EXECUTION_CANCELLED");
        const initial = service.initialize({ instanceId: config.instance_id, model, write: false });
        current = service.initialize({ instanceId: config.instance_id, model, write: true, expectedResultSha256: initial.record.instance_sha256 });
        requireProjection();
        while (!["COMPLETED", "FAILED", "CANCELLED"].includes(current.cursor.status)) {
          if (stop.signal.aborted) fail(firstFailure ?? "PROCESS_EXECUTION_CANCELLED");
          if (responseIds.size >= authorization.max_responses) fail("PROCESS_EXECUTION_RESPONSE_LIMIT");
          const occurrenceId = current.cursor.ready[0];
          if (!occurrenceId) break; // durable event wait, no model polling
          const frame = current.cursor.occurrences.find(row => row.occurrence_id === occurrenceId), node = model.nodes.find(row => row.id === frame.node_id);
          const role = model.roles.find(row => row.id === node.role_ref), policy = model.policies.find(row => row.id === node.policy_ref);
          await host.prepare({ instance: current.record, frame, node, role, policy });
          current = await service.assign({ instanceId: config.instance_id, expectedSha256: current.record.instance_sha256, occurrenceId,
            eventId: `assign-${current.record.revision}`, write: true });
          requireProjection();
          if (current.status === "WAITING_FOR_ELIGIBLE_EXECUTOR") break;
          const executed = await host.execute({ instance: current.record, occurrenceId, signal: stop.signal });
          current = await service.accept({ instanceId: config.instance_id, expectedSha256: current.record.instance_sha256, occurrenceId,
            eventId: `result-${current.record.revision}`, resultId: executed.resultId, write: true });
          requireProjection();
          if (current.status === "RESULT_NOT_ACCEPTED") break;
        }
        if (current?.cursor.status === "FAILED") firstFailure ??= current.cursor.first_failure;
      } catch (error) {
        const code = error.code ?? error.message;
        requestStop(/^(PROCESS_|ARTIFACT_|WORKFLOW_INSTANCE_)[A-Z_]+$/.test(code ?? "") ? code : "PROCESS_EXECUTION_FAILED");
      }
      finally {
        try { closure = await host.close(); } catch { firstFailure ??= "PROCESS_HOST_CLOSE_UNCONFIRMED"; }
        clearTimeout(timer); clearInterval(storageTimer); signal?.removeEventListener("abort", onAbort);
      }
      let retained = null, debit = null;
      try { retained = localUsed(); debit = retained + (persistence.backend === "postgres" ? canonicalPayloadAttempted : 0); }
      catch { firstFailure ??= "PROCESS_EXECUTION_STORAGE_UNVERIFIABLE"; }
      const result = { contract_version: "agentic-process-execution-result.v1", status: firstFailure ? "FAILED" : current?.status ?? current?.cursor.status ?? "FAILED",
        implementation_sha256: config.implementation_sha256,
        persistence: { ...persistence, state_mode: authorityAtCreation.stateMode,
          canonical_payload_bytes_attempted: canonicalPayloadAttempted, canonical_payload_bytes_acknowledged: canonicalPayloadAcknowledged,
          accounting: persistence.backend === "postgres" ? "local retained bytes plus cumulative attempted canonical payload; server physical storage/WAL not measured" : "local retained bytes and SQLite/WAL file growth",
          server_physical_bytes: persistence.backend === "postgres" ? "NON_MESURE" : "NOT_APPLICABLE" },
        first_failure: firstFailure, instance_sha256: current?.record?.instance_sha256 ?? null, responses_observed: responseIds.size,
        elapsed_global_ms: Date.now() - authorization.authorized_at_ms, global_deadline_ms: authorization.global_deadline_ms,
        workflow_deadline_ms: authorization.workflow_deadline_ms,
        native_parent_closure: closure, process_tree_closure: "OUTER_CONTROLLER_REQUIRED", bytes_retained: retained,
        storage_budget_debit_bytes: debit,
        storage_observation: { vanished_entries: vanishedStorageEntries, first_read_failure: storageReadFailure },
        consumption: sessions.metrics(),
        provider_consumption: "client-reported only; missing/in-flight counters remain unknown", retry: false };
      // The reserved footer is permitted even after a preventive storage stop.
      // Never delete evidence to make room or replace the first failure.
      if (debit === null) { result.seal = "STDOUT_ONLY_STORAGE_UNVERIFIABLE"; return result; }
      const footer = Buffer.from(JSON.stringify(result) + "\n");
      if (footer.length > 65536 || debit + footer.length > authorization.max_bytes) {
        // Retain the structured partial result on the owned stdout channel. A
        // storage breach is never hidden by deleting files or a sealing error.
        result.first_failure ??= "PROCESS_EXECUTION_SEAL_STORAGE_LIMIT"; result.status = "FAILED";
        result.seal = "STDOUT_ONLY_STORAGE_LIMIT"; return result;
      }
      try { fs.writeFileSync(path.join(output, "RESULT.json"), footer, { flag: "wx" }); }
      catch { result.first_failure ??= "PROCESS_EXECUTION_SEAL_WRITE_FAILED"; result.status = "FAILED"; result.seal = "STDOUT_ONLY_WRITE_FAILED"; }
      return result;
    },
  });
}
