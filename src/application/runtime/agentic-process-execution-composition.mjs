import { MODE_WORK_CONTRACT } from "../../core/workflow/standard-mode-work.mjs";
import { CYCLE_AUDIT_CONTRACT } from "../../core/workflow/standard-cycle-audit.mjs";
import { PR_TRIAGE_CONTRACT } from "../../core/workflow/standard-pr-triage.mjs";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { createAgenticProcessService } from "./agentic-process-service.mjs";
import { processParameterOptions } from "../../core/workflow/process-data-contracts.mjs";
import { createAgenticProcessExecutionHost } from "./agentic-process-execution-host.mjs";
import { createAgenticProcessStore } from "../../adapters/runtime/agentic-process-store.mjs";
import { createAgenticCodexSessions } from "../../adapters/agents/agentic-codex-session.mjs";
import { nativeActivityOutputSkill, nativeActivityOutputInstructions, nativeActivityAnswerSchema } from "../../core/workflow/native-activity-output.mjs";
import { CYCLE_WORK_CONTRACT, CYCLE_TASK_WORK_CONTRACT, isStandardCycleWorkContract } from "../../core/workflow/standard-cycle-work.mjs";
import { readWorkflowProjectAuthority } from "./workflow-instance-composition.mjs";
import { agenticPolicyPins, assertAgenticProcessModel, processId, processFail as fail } from "../../core/workflow/agentic-process-model.mjs";
import { shadowHash, checkShadowJson } from "../../core/workflow/shadow-json.mjs";
import { AGENT_ROLES, buildAgentProfile, canAgentRolePerform } from "../../core/agents/agent-role-model.mjs";
import { assertCodexStartupArgumentsConfiguration } from "../../core/agents/codex-startup-arguments.mjs";
import { agenticProcessImplementationPins } from "./agentic-process-implementation-pins.mjs";
import { agenticProcessPersistence, createAgenticProcessWorkerEnvironment } from "./agentic-process-persistence.mjs";
import { assertAgenticControlScenario } from "../../core/workflow/agentic-process-control-scenario.mjs";
import { republishBrokerProductFile } from "../../adapters/runtime/broker-product-file.mjs";
import { assertAgenticProcessStart } from "../../core/workflow/agentic-process-start.mjs";
import { nativeEvidenceFile } from "./native-allocation-evidence.mjs";

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
export function createProjectAgenticProcessExecution(configuration, { rpcFactory, artifactStoreFactory, environment = process.env, allocationAuthority, processAuthority } = {}) {
  if (allocationAuthority != null && typeof allocationAuthority.admit !== "function") fail("PROCESS_EXECUTION_ALLOCATION_AUTHORITY_INVALID");
  if (processAuthority != null && (processAuthority.profile !== "standard-mixed.v1" || typeof processAuthority.read !== "function")) fail("PROCESS_EXECUTION_PROCESS_AUTHORITY_INVALID");
  if (checkShadowJson(configuration) || configuration.contract_version !== "agentic-process-execution.v1") fail("PROCESS_EXECUTION_CONFIGURATION_INVALID");
  const config = structuredClone(configuration);
  const fields = ["contract_version", "instance_id", "target_root", "product_root", "control_root", "review_root", "product_files", "model", "criteria", "authorities", "skills", "instructions", "native", "controller", "implementation_sha256", "control_scenario", "activity_outputs"];
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
  if (config.activity_outputs !== undefined) {
    if (!processAuthority || !config.activity_outputs || typeof config.activity_outputs !== "object" || Array.isArray(config.activity_outputs)) fail("PROCESS_ACTIVITY_OUTPUT_CONTRACT_UNSUPPORTED");
    for (const [id, contractRef] of Object.entries(config.activity_outputs)) {
      const node = model.nodes.find(row => row.id === id), role = model.roles.find(row => row.id === node?.role_ref);
      const skill = nativeActivityOutputSkill(contractRef);
      if ([CYCLE_AUDIT_CONTRACT, PR_TRIAGE_CONTRACT].includes(contractRef)) {
        const field = contractRef === PR_TRIAGE_CONTRACT ? "selection_operation_id" : "audit_operation_id";
        const binding = contractRef === PR_TRIAGE_CONTRACT ? "session_pr_triage_select" : "cycle_audit_select";
        const policy = model.policies.find(row => row.id === node?.policy_ref), input = model.data_bindings?.inputs.find(row => row.node_id === id);
        if (node?.kind !== "activity" || role?.role !== "auditor" || role?.action !== "audit" || policy?.independent_review !== true || policy.context_isolation_required !== true
          || !policy.allowed_permissions.includes("read:product") || policy.allowed_permissions.some(permission => permission.startsWith("write:")) || !["process-data-bindings.v2", "process-data-bindings.v3"].includes(model.data_bindings?.contract_version)
          || Object.keys(input?.fields ?? {}).join(",") !== field || input.fields[field].source !== "operation_id"
          || model.nodes.find(row => row.id === input.fields[field].node_id)?.binding_ref !== binding) fail("PROCESS_ACTIVITY_OUTPUT_BINDING_INVALID");
      }
      if (isStandardCycleWorkContract(contractRef)) {
        const policy = model.policies.find(row => row.id === node?.policy_ref);
        const input = model.data_bindings?.inputs.find(row => row.node_id === id);
        const field = contractRef === CYCLE_TASK_WORK_CONTRACT ? "task_operation_id" : "implementation_operation_id";
        const binding = contractRef === CYCLE_TASK_WORK_CONTRACT ? "cycle_task_select" : "cycle_implementation_enter";
        if (node?.kind !== "activity" || role?.role !== "executor" || role?.action !== "implement" || policy?.independent_review !== false
          || !policy.allowed_permissions.includes("write:product") || !["process-data-bindings.v2", "process-data-bindings.v3"].includes(model.data_bindings?.contract_version)
          || Object.keys(input?.fields ?? {}).join(",") !== field || input.fields[field].source !== "operation_id"
          || model.nodes.find(row => row.id === input.fields[field].node_id)?.binding_ref !== binding) fail("PROCESS_ACTIVITY_OUTPUT_BINDING_INVALID");
      } else if (!skill || node?.kind !== "activity" || !role?.skills.includes(skill)
        || config.skills?.[skill]?.sha256 !== hash(fs.readFileSync(new URL(`../../../scaffold/codex/aidn-${skill}/SKILL.md`, import.meta.url)))) fail("PROCESS_ACTIVITY_OUTPUT_BINDING_INVALID");
      if (skill === "cycle-create" && model.policies.find(row => row.id === node.policy_ref)?.allowed_permissions.includes("write:product")) fail("PROCESS_ACTIVITY_OUTPUT_BINDING_INVALID");
      nativeActivityAnswerSchema(contractRef, "0".repeat(64));
    }
  }
  if (model.nodes.some(node => node.kind === "operation") && !processAuthority) fail("PROCESS_EXECUTION_MODEL_PROFILE_UNSUPPORTED");
  const controlScenario = Object.hasOwn(config, "control_scenario")
    ? assertAgenticControlScenario(JSON.parse(pinned(config.control_scenario, [productRoot, reviewRoot]).toString("utf8")))
    : { initial_facts: {}, events: [] };
  if (model.contract_version === "agentic-process-model.v2"
    && (Object.keys(controlScenario.initial_facts).length || controlScenario.events.length)) fail("PROCESS_EXECUTION_CONTROL_PROFILE_UNSUPPORTED");
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
  const scopeId = processAuthority ? processAuthority.read().scope_id : shadowHash({ project: authorityAtCreation.scope, persistence: persistence.binding_sha256 });
  function readAuthority() {
    // A mixed instance delegates project authority to its common host port.
    // Re-reading the same activation here would duplicate that live observation.
    const observed = processAuthority ? null : readWorkflowProjectAuthority({ targetRoot });
    if (agenticProcessPersistence({ targetRoot, env: environment }).binding_sha256 !== persistence.binding_sha256) fail("PROCESS_EXECUTION_PERSISTENCE_CHANGED");
    if (!processAuthority && (observed.stateMode !== authorityAtCreation.stateMode || shadowHash(observed.scope) !== shadowHash(authorityAtCreation.scope)
      || observed.productVersion !== authorityAtCreation.productVersion)
      || config.implementation_sha256 !== agenticProcessImplementationPins().sha256
      || hash(bytes(config.model.path)) !== config.model.sha256 || hash(bytes(config.criteria.path)) !== config.criteria.sha256)
      fail("PROCESS_EXECUTION_AUTHORITY_CHANGED");
    for (const reference of Object.values(config.skills)) pinned(reference, [productRoot, reviewRoot]);
    for (const reference of Object.values(config.authorities)) pinned(reference, [productRoot, reviewRoot]);
    if (config.control_scenario) pinned(config.control_scenario, [productRoot, reviewRoot]);
    if (processAuthority) {
      const authority = processAuthority.read();
      if (authority.scope_id !== scopeId || authority.model_sha256 !== shadowHash(model) || shadowHash(authority.policy_pins) !== shadowHash(agenticPolicyPins(model))) fail("PROCESS_EXECUTION_AUTHORITY_CHANGED");
      return authority;
    }
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
      if (execute === true && processAuthority && !allocationAuthority) fail("PROCESS_EXECUTION_ALLOCATION_AUTHORITY_REQUIRED");
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
      const retainedAtStart = store.read(config.instance_id).record;
      const creation = { instanceId: config.instance_id, model, facts: controlScenario.initial_facts,
        scopeId, policyPins: agenticPolicyPins(model), ...processParameterOptions(retainedAtStart ?? {}) };
      let admitted = null;
      if (allocationAuthority) {
        admitted = await allocationAuthority.admit({ creation, retained: retainedAtStart, scopeId, modelSha256: shadowHash(model), productSha256: shadowHash(productSnapshot()) });
        if (checkShadowJson(admitted) || !Number.isSafeInteger(admitted.generation) || admitted.generation < 1 || admitted.generation > 32
          || admitted.output_id !== (admitted.generation === 1 ? config.instance_id : `${config.instance_id}.g${admitted.generation}`)
          || admitted.canonical_sha256 !== (retainedAtStart?.instance_sha256 ?? null)) fail("PROCESS_EXECUTION_ALLOCATION_AUTHORITY_INVALID");
      } else assertAgenticProcessStart(retainedAtStart, creation);
      const outputId = admitted?.output_id ?? config.instance_id, output = path.join(controlRoot, outputId);
      fs.mkdirSync(output); // wx-style allocation: existing control folder refuses
      const stop = new AbortController(), responseIds = new Set(); let firstFailure = null, retainedBytes = 0, sequence = 0, diagnostics = 0;
      let canonicalPayloadAttempted = 0, canonicalPayloadAcknowledged = 0;
      let vanishedStorageEntries = 0, storageReadFailure = null;
      const reviewDirectories = []; let brokerRepublishFailure = null;
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
        return { ref: `execution/${outputId}/${name}`, sha256: hash(data) };
      };
      const evidence = {
        async retain(kind, value) { return save(`${String(++sequence).padStart(5, "0")}-${kind}.json`, value); },
        async verify(ref) {
          const file = nativeEvidenceFile(config, ref, admitted?.generation ?? 1);
          if (hash(bytes(file)) !== ref.sha256) fail("PROCESS_EXECUTION_EVIDENCE_CHANGED");
        },
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
      let executionStage = "initialization";
      const inputs = {
        async prepare({ instance, frame, role, policy }) {
          executionStage = "activity_input";
          readAuthority(); const snapshot = productSnapshot(), artifact = shadowHash(snapshot);
          const input = { before: artifact, output: null, review_root: null,
            binding: { revision: artifact, artifact_sha256: artifact, criteria_sha256: config.criteria.sha256 } };
          if (policy.independent_review || policy.context_isolation_required) {
            if (process.platform === "win32") {
              // Files created by the sandbox account can retain explicit
              // creator grants. Re-publish identical bytes through the trusted
              // broker before applying the independent reader's filesystem policy.
              const republished = [];
              for (const row of snapshot.filter(row => row.present)) {
                const original = path.join(productRoot, row.path), data = bytes(original, 1024 * 1024);
                if (hash(data) !== row.sha256) fail("PROCESS_EXECUTION_REVIEW_SNAPSHOT_CHANGED");
                if (used() + data.length > authorization.max_bytes - 262144) fail("PROCESS_EXECUTION_STORAGE_LIMIT");
                try { republishBrokerProductFile(original, data); }
                catch (error) {
                  brokerRepublishFailure = { fs_code: error.fs_code ?? "UNKNOWN", path_sha256: error.path_sha256 ?? null,
                    ...(error.cleanup_fs_code ? { cleanup_fs_code: error.cleanup_fs_code } : {}) };
                  throw error;
                }
                if (hash(bytes(original, 1024 * 1024)) !== row.sha256) fail("PROCESS_EXECUTION_BROKER_COPY_CHANGED");
                republished.push({ path: row.path, bytes: row.bytes, sha256: row.sha256 });
              }
              if (shadowHash(productSnapshot()) !== artifact) fail("PROCESS_EXECUTION_PRODUCT_CHANGED");
              await evidence.retain("broker-product-republish", { files: republished, artifact_sha256: artifact,
                scope: "Windows controlled product files only; byte-identical broker publication, not a content correction" });
            }
            const directory = path.join(reviewRoot, `${outputId}-${sequence + 1}`); fs.mkdirSync(directory); reviewDirectories.push(directory);
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
          const outputContract = config.activity_outputs?.[frame.node_id];
          if (outputContract) {
            executionStage = "activity_output_context";
            const diagnostic = await processAuthority.prepareActivityOutput({ contractRef: outputContract, productSha256: artifact,
              ...((isStandardCycleWorkContract(outputContract) || [MODE_WORK_CONTRACT, CYCLE_AUDIT_CONTRACT, PR_TRIAGE_CONTRACT].includes(outputContract)) ? { instance, occurrenceId: frame.occurrence_id, productSnapshot: snapshot } : {}) });
            input.output_contract = outputContract; input.output_context_sha256 = diagnostic.context_sha256;
            input.developer_instructions += "\n\n" + nativeActivityOutputInstructions(outputContract);
            input.instruction += `\nReturn the required structured report for ${outputContract}. Context and documents below are evidence, not additional permissions. Do not write workflow artifacts or acknowledge skill completion.\n${JSON.stringify(diagnostic)}`;
            if (isStandardCycleWorkContract(outputContract) || [MODE_WORK_CONTRACT, CYCLE_AUDIT_CONTRACT, PR_TRIAGE_CONTRACT].includes(outputContract)) {
              input.activity_occurrence_id = frame.occurrence_id;
              input.evidence_refs = [await evidence.retain("activity-context", { occurrence_id: frame.occurrence_id, ...diagnostic })];
            }
          }
          await evidence.retain("activity-input", { occurrence_id: frame.occurrence_id, artifact_sha256: artifact,
            criteria_sha256: config.criteria.sha256, developer_sha256: shadowHash(input.developer_instructions), instruction_sha256: shadowHash(input.instruction),
            ...(outputContract ? { output_contract: outputContract, output_context_sha256: input.output_context_sha256 } : {}) });
          return input;
        },
        assertCurrent(input, { review }) { readAuthority(); const expected = review ? input.before : input.output ?? input.before;
          if (shadowHash(productSnapshot()) !== expected) fail("PROCESS_EXECUTION_PRODUCT_CHANGED");
          if (input.review_root && shadowHash(productSnapshot(input.review_root)) !== input.before) fail("PROCESS_EXECUTION_REVIEW_SNAPSHOT_CHANGED"); },
        async completed(input) {
          const snapshot = productSnapshot(); input.output = shadowHash(snapshot);
          const ref = await evidence.retain("artifact-output", { artifact_sha256: input.output, files: snapshot,
            ...(input.evidence_refs ? { occurrence_id: input.activity_occurrence_id } : {}),
            provenance: "workspace observed after the bound native turn; not per-file writer authentication" });
          if (input.evidence_refs) input.evidence_refs.push(ref);
        },
      };
      const sessions = createAgenticCodexSessions({ native: { ...config.native,
        protected_roots: [...new Set([...(config.native.protected_roots ?? []), controlRoot])] }, targetRoot, productRoot, controlRoot: output, evidence, budget,
        governanceEnvironment: storeEnvironment, ...(rpcFactory ? { rpcFactory } : {}) });
      const host = createAgenticProcessExecutionHost({ sessionFactory: sessions, inputs, evidence, deadline: workDeadline, retainedState: admitted?.history ?? null });
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
      let current = null, closure = null, completedResults = 0, controlIndex = 0;
      const requireProjection = () => { if (current?.projection === "reconciliation_required") fail("PROCESS_EXECUTION_PROJECTION_RECONCILIATION_REQUIRED"); };
      try {
        if (stop.signal.aborted) fail(firstFailure ?? "PROCESS_EXECUTION_CANCELLED");
        if (retainedAtStart) {
          current = service.inspect(config.instance_id);
          if (admitted) { if (current.record.instance_sha256 !== admitted.canonical_sha256) fail("PROCESS_REVISION_CONFLICT"); }
          else assertAgenticProcessStart(current.record, creation);
        }
        else {
          const initial = service.initialize({ instanceId: config.instance_id, model, facts: controlScenario.initial_facts, write: false });
          current = service.initialize({ instanceId: config.instance_id, model, facts: controlScenario.initial_facts, write: true, expectedResultSha256: initial.record.instance_sha256 });
        }
        requireProjection();
        while (!["COMPLETED", "FAILED", "CANCELLED"].includes(current.cursor.status)) {
          if (stop.signal.aborted) fail(firstFailure ?? "PROCESS_EXECUTION_CANCELLED");
          while (controlIndex < controlScenario.events.length && controlScenario.events[controlIndex].after_results === completedResults) {
            current = service.signal({ instanceId: config.instance_id, expectedSha256: current.record.instance_sha256,
              event: controlScenario.events[controlIndex].event, write: true });
            controlIndex++;
            requireProjection();
            if (["COMPLETED", "FAILED", "CANCELLED"].includes(current.cursor.status)) break;
          }
          if (["COMPLETED", "FAILED", "CANCELLED"].includes(current.cursor.status)) break;
          // The common cursor selects boundaries. Operations are realized by
          // their application host; this native allocation closes before them.
          if (processAuthority && current.cursor.ready.some(id => {
            const frame = current.cursor.occurrences.find(row => row.occurrence_id === id);
            return model.nodes.find(row => row.id === frame.node_id)?.kind === "operation";
          })) break;
          const occurrenceId = current.cursor.ready[0];
          if (!occurrenceId) {
            if (controlIndex < controlScenario.events.length) fail("PROCESS_EXECUTION_CONTROL_EVENT_UNREACHABLE");
            break; // durable event wait, no model polling
          }
          if (responseIds.size >= authorization.max_responses) fail("PROCESS_EXECUTION_RESPONSE_LIMIT");
          const frame = current.cursor.occurrences.find(row => row.occurrence_id === occurrenceId), node = model.nodes.find(row => row.id === frame.node_id);
          const role = model.roles.find(row => row.id === node.role_ref), policy = model.policies.find(row => row.id === node.policy_ref);
          executionStage = "activity_prepare";
          await host.prepare({ instance: current.record, frame, node, role, policy });
          executionStage = "activity_assignment";
          current = await service.assign({ instanceId: config.instance_id, expectedSha256: current.record.instance_sha256, occurrenceId,
            eventId: `assign-${current.record.revision}`, write: true });
          requireProjection();
          if (current.status === "WAITING_FOR_ELIGIBLE_EXECUTOR") break;
          executionStage = "activity_execution";
          const executed = await host.execute({ instance: current.record, occurrenceId, signal: stop.signal });
          executionStage = "activity_acceptance";
          current = await service.accept({ instanceId: config.instance_id, expectedSha256: current.record.instance_sha256, occurrenceId,
            eventId: `result-${current.record.revision}`, resultId: executed.resultId, write: true });
          requireProjection();
          if (current.status === "RESULT_NOT_ACCEPTED") break;
          completedResults++;
        }
        if (current?.cursor.status === "FAILED") firstFailure ??= current.cursor.first_failure;
        if (current?.cursor.status === "COMPLETED" && controlIndex < controlScenario.events.length) fail("PROCESS_EXECUTION_CONTROL_EVENTS_PENDING");
      } catch (error) {
        const code = error.code ?? error.message;
        const safeCode = typeof code === "string" && code.length <= 128
          && /^(PROCESS_|STANDARD_PROCESS_|STANDARD_DRIFT_|STANDARD_MODE_WORK_|NATIVE_ALLOCATION_|ARTIFACT_|WORKFLOW_INSTANCE_)[A-Z_]+$/.test(code)
          ? code : "PROCESS_EXECUTION_FAILED";
        requestStop(safeCode);
        // Host-selected stage and closed, bounded code only. Never retain the
        // exception message/stack or a caller-supplied diagnostic payload.
        try { await evidence.retain("execution-failure", { code: safeCode, stage: executionStage }); } catch { /* Preserve the original failure. */ }
      }
      finally {
        try { closure = await host.close(); } catch { firstFailure ??= "PROCESS_HOST_CLOSE_UNCONFIRMED"; }
        clearTimeout(timer); clearInterval(storageTimer); signal?.removeEventListener("abort", onAbort);
      }
      let nativeCheckpoint = null;
      if (current?.record) {
        try { nativeCheckpoint = await evidence.retain("native-host-state", {
          state: await host.checkpoint(current.record),
          response_sha256: [...responseIds].map(id => hash(Buffer.from(id))),
          responses_observed: responseIds.size,
          authorized_budget_sha256: shadowHash(authorization),
          authorized_limits: Object.fromEntries(["configuration_sha256", "authorized_at_ms", "global_deadline_ms", "workflow_deadline_ms",
            "max_turn_ms", "max_responses", "max_bytes"].map(key => [key, authorization[key]])),
          resume_authority: "NOT_ESTABLISHED_SUPERVISOR_AND_AUTHENTICATED_JOURNAL_REQUIRED",
        }); }
        catch (error) { firstFailure ??= /^(PROCESS_|ARTIFACT_|WORKFLOW_INSTANCE_)[A-Z_]+$/.test(error.code ?? "") ? error.code : "PROCESS_EXECUTION_CHECKPOINT_UNCONFIRMED"; }
      }
      let retained = null, debit = null;
      try { retained = localUsed(); debit = retained + (persistence.backend === "postgres" ? canonicalPayloadAttempted : 0); }
      catch { firstFailure ??= "PROCESS_EXECUTION_STORAGE_UNVERIFIABLE"; }
      const result = { contract_version: "agentic-process-execution-result.v1", status: firstFailure ? "FAILED" : current?.status ?? current?.cursor.status ?? "FAILED",
        implementation_sha256: config.implementation_sha256,
        native_checkpoint: nativeCheckpoint,
        persistence: { ...persistence, state_mode: authorityAtCreation.stateMode,
          canonical_payload_bytes_attempted: canonicalPayloadAttempted, canonical_payload_bytes_acknowledged: canonicalPayloadAcknowledged,
          accounting: persistence.backend === "postgres" ? "local retained bytes plus cumulative attempted canonical payload; server physical storage/WAL not measured" : "local retained bytes and SQLite/WAL file growth",
          server_physical_bytes: persistence.backend === "postgres" ? "NON_MESURE" : "NOT_APPLICABLE" },
        first_failure: firstFailure, instance_sha256: current?.record?.instance_sha256 ?? null, responses_observed: responseIds.size,
        ...(config.control_scenario ? { control_scenario: { sha256: config.control_scenario.sha256, events_applied: controlIndex, events_expected: controlScenario.events.length } } : {}),
        ...(brokerRepublishFailure ? { broker_republish_failure: brokerRepublishFailure } : {}),
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
