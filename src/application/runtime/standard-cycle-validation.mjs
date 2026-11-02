import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";
import { createStandardWorkflowArtifacts } from "./standard-workflow-artifacts.mjs";
import { agentRunPhysicalPath, readAgentRunFile } from "./agent-run-configuration-service.mjs";
import { createCodexSandboxValidationBoundary } from "../../adapters/runtime/codex-sandbox-validation-boundary.mjs";
import { interpretAgentVerificationCheck } from "../../adapters/runtime/local-agent-verification.mjs";
import { assertStandardValidationProfile, selectStandardValidationChecks, standardValidationStatus } from "../../core/workflow/standard-cycle-validation.mjs";
import { assertWorkProductSnapshot } from "../../core/workflow/standard-cycle-work.mjs";
import { shadowHash, checkShadowJson } from "../../core/workflow/shadow-json.mjs";
import { assertStandardOperationInput, assertStandardOperationOutput } from "../../core/workflow/standard-operation-contracts.mjs";
import { validateJsonSchema } from "../../core/contracts/json-schema-validator.mjs";
import planSchema from "../../core/contracts/workflow-definition/standard-cycle-validation-plan.v1.schema.json" with { type: "json" };
const fail = code => { throw Object.assign(new Error(code), { code }); };
const hash = data => createHash("sha256").update(data).digest("hex");
async function bounded(promise, milliseconds) {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(Object.assign(new Error("STANDARD_VALIDATION_EXPIRED"), { code: "STANDARD_VALIDATION_EXPIRED" })), Math.max(1, milliseconds)); })]); }
  finally { clearTimeout(timer); }
}
const inside = (root, file) => { const relative = path.relative(root, file); return !relative || !path.isAbsolute(relative) && relative !== ".." && !relative.startsWith(".." + path.sep); };
const output = (outcome, effect_status, observations, facts = {}, evidence_refs = []) => ({ contract_version: "standard-cycle-validation-output.v1", operation_ref: "cycle_validation_execute", outcome, effect_status, facts, observations, evidence_refs });
// The private boundary factory is an offline fixture capability. Authored JSON
// never selects it; every such result is persistently classified as fixture.
export function createStandardCycleValidation({ targetRoot, profileRef, readWork, readCurrent, now = Date.now }, { boundaryFactory } = {}) {
  const artifacts = createStandardWorkflowArtifacts({ targetRoot }), root = artifacts.root;
  const proofClass = boundaryFactory ? "fixture" : "native";
  async function material(productRoot) {
    const profileFile = readAgentRunFile(profileRef.path, { sha256: profileRef.sha256 }), profile = assertStandardValidationProfile(profileFile.value);
    for (const name of [profileRef.path, profile.snapshot_root, profile.evidence_root, profile.boundary_configuration.path, profile.qualification.path, profile.public_key.path, ...profile.checks.map(row => row.script.path)])
      if (inside(productRoot, name)) fail("STANDARD_VALIDATION_PRODUCT_CONTROL_OVERLAP");
    for (const name of [profile.snapshot_root, profile.evidence_root]) {
      agentRunPhysicalPath(name);
      if (!fs.statSync(name).isDirectory() || inside(root, name)) fail("STANDARD_VALIDATION_ROOT_INVALID");
    }
    if (inside(profile.snapshot_root, profile.evidence_root) || inside(profile.evidence_root, profile.snapshot_root)) fail("STANDARD_VALIDATION_ROOT_INVALID");
    const configuration = readAgentRunFile(profile.boundary_configuration.path, { sha256: profile.boundary_configuration.sha256 }).value;
    const scratch = configuration.roots?.scratch;
    if (scratch && [root, productRoot, profileRef.path, profile.evidence_root, profile.snapshot_root, profile.boundary_configuration.path, profile.qualification.path,
      profile.public_key.path, ...profile.checks.map(row => row.script.path)].some(name => inside(scratch, name))) fail("STANDARD_VALIDATION_WRITABLE_CONTROL_ROOT");
    const qualification = readAgentRunFile(profile.qualification.path, { sha256: profile.qualification.sha256 }).value;
    const publicKey = readAgentRunFile(profile.public_key.path, { sha256: profile.public_key.sha256, json: false }).value;
    if (configuration.roots?.snapshots !== profile.snapshot_root || configuration.environment_sha256 !== shadowHash(profile.environment)
      || !path.isAbsolute(configuration.runner?.executable ?? "") || !/^[a-f0-9]{64}$/.test(configuration.runner?.sha256 ?? "")) fail("STANDARD_VALIDATION_BOUNDARY_MISMATCH");
    for (const row of profile.checks) readAgentRunFile(row.script.path, { sha256: row.script.sha256, json: false, maxBytes: 1048576 });
    const boundary = (boundaryFactory ?? createCodexSandboxValidationBoundary)({ configuration, qualification, publicKey, evidenceRoot: profile.evidence_root });
    const available = await boundary.checkAvailability();
    if (!available.available || !boundaryFactory && available.native !== true) fail("STANDARD_VALIDATION_BOUNDARY_UNAVAILABLE");
    const operations = await boundary.inspectOperations();
    if (operations.uncertain_read || operations.operations.some(row => row.recovery_required)) fail("STANDARD_VALIDATION_RECONCILIATION_REQUIRED");
    return { profile, configuration, boundary, descriptor_sha256: shadowHash(boundary.getDescriptor()) };
  }
  async function prepare(instance, input, preparedAt, acquired = false, capture) {
    assertStandardOperationInput("cycle_validation_execute", input);
    if (!profileRef) return { can_apply: false, reason_code: "STANDARD_VALIDATION_PROFILE_REQUIRED" };
    if (!acquired && artifacts.ownerPending()) return { can_apply: false, reason_code: "STANDARD_EFFECT_OWNER_RECONCILIATION_REQUIRED" };
    const work = await readWork(instance, input), materials = await material(work.product_root), profile = materials.profile;
    assertWorkProductSnapshot(work.files);
    if (work.files.length > profile.limits.max_files || work.files.some(row => row.path.split("/")[0].toLowerCase() === "_aidn_checks")
      || work.files.reduce((sum, row) => sum + (row.bytes ?? 0), 0) > profile.limits.max_snapshot_bytes) fail("STANDARD_VALIDATION_SNAPSHOT_LIMIT");
    const checks = selectStandardValidationChecks(profile, work.output.observations.task);
    const plan = { contract_version: "standard-cycle-validation-plan.v1", operation_ref: "cycle_validation_execute", input, prepared_at_ms: preparedAt,
      work_sha256: work.evaluation_sha256, product_sha256: shadowHash(work.files), profile_sha256: shadowHash(profile), descriptor_sha256: materials.descriptor_sha256,
      proof_class: proofClass, files: work.files, checks, limits: profile.limits,
      snapshot_path: path.join(profile.snapshot_root, "validation_" + shadowHash({ input, preparedAt, profile: shadowHash(profile) }).slice(0, 32)) };
    const prepared = { can_apply: true, plan, plan_sha256: shadowHash(plan) };
    capture?.(work, materials); return prepared;
  }
  function inventory(directory, limits) {
    const rows = []; let bytes = 0, entries = 0;
    function walk(at) {
      agentRunPhysicalPath(at);
      for (const name of fs.readdirSync(at).sort()) {
        if (++entries > limits.max_files + 256) fail("STANDARD_VALIDATION_SNAPSHOT_LIMIT");
        const file = path.join(at, name), stat = fs.lstatSync(file);
        if (stat.isSymbolicLink()) fail("STANDARD_VALIDATION_SNAPSHOT_REDIRECTED");
        if (stat.isDirectory()) walk(file); else {
          if (!stat.isFile() || stat.size > limits.max_snapshot_bytes + 67108864 - bytes) fail("STANDARD_VALIDATION_SNAPSHOT_LIMIT");
          const data = fs.readFileSync(file); bytes += data.length;
          if (bytes > limits.max_snapshot_bytes + 67108864 || rows.length >= limits.max_files + 64) fail("STANDARD_VALIDATION_SNAPSHOT_LIMIT");
          rows.push({ path: path.relative(directory, file).replaceAll("\\", "/"), bytes: data.length, sha256: hash(data) });
        }
      }
    }
    walk(directory); return rows;
  }
  return Object.freeze({
    prepare: (instance, input) => prepare(instance, input, now()),
    async apply(instance, prepared, { write = false, expectPlan, assertAuthorized } = {}) {
      const plan = prepared?.plan;
      try {
        if (checkShadowJson(plan) || validateJsonSchema(plan, planSchema, "$", { contractKind: "workflow-definition" }).length || !prepared.can_apply || write !== true || typeof assertAuthorized !== "function" || prepared.plan_sha256 !== expectPlan
          || shadowHash(plan) !== expectPlan || !Number.isSafeInteger(now() - plan.prepared_at_ms) || now() - plan.prepared_at_ms < 0 || now() - plan.prepared_at_ms > 300000) fail("STANDARD_VALIDATION_EXPLICIT_EFFECT_REQUIRED");
      } catch (cause) { cause.effect_status = "no_effect"; throw cause; }
      return artifacts.withLocalEffectOwner(expectPlan, async () => {
        let work, materials;
        try {
          await assertAuthorized();
          const fresh = await prepare(instance, plan.input, plan.prepared_at_ms, true, (observed, available) => { work = observed; materials = available; });
          if (!fresh.can_apply || fresh.plan_sha256 !== expectPlan) fail("STANDARD_VALIDATION_PREVIEW_CHANGED");
          if (work.evaluation_sha256 !== plan.work_sha256 || shadowHash(work.files) !== plan.product_sha256 || shadowHash(materials.profile) !== plan.profile_sha256
            || materials.descriptor_sha256 !== plan.descriptor_sha256 || now() - plan.prepared_at_ms > 300000
            || readCurrent(instance.instance_id).instance_sha256 !== instance.instance_sha256) fail("STANDARD_VALIDATION_SOURCE_STALE");
        } catch (cause) { cause.effect_status = "no_effect"; throw cause; }
        const stop = new AbortController(), began = performance.now();
        const timer = setTimeout(() => stop.abort(), plan.limits.max_duration_ms);
        const remaining = () => Math.floor(plan.limits.max_duration_ms - (performance.now() - began));
        const checkTime = () => { if (stop.signal.aborted || remaining() <= 0) fail("STANDARD_VALIDATION_EXPIRED"); };
        let touched = false;
        try {
          checkTime(); touched = true; fs.mkdirSync(plan.snapshot_path);
          const resultRoot = path.join(materials.profile.evidence_root, path.basename(plan.snapshot_path)); fs.mkdirSync(resultRoot);
          const retain = (name, data) => { checkTime(); const file = path.join(resultRoot, name); fs.writeFileSync(file, data, { flag: "wx" }); return { ref: "validation/" + path.basename(resultRoot) + "/" + name, sha256: hash(data) }; };
          for (const row of plan.files.filter(row => row.present)) {
            const file = agentRunPhysicalPath(path.join(work.product_root, row.path)), data = readAgentRunFile(file, { sha256: row.sha256, json: false, maxBytes: 1048576 }).value;
            if (hash(data) !== row.sha256) fail("STANDARD_VALIDATION_PRODUCT_CHANGED");
            const destination = path.join(plan.snapshot_path, row.path); fs.mkdirSync(path.dirname(destination), { recursive: true }); fs.writeFileSync(destination, data, { flag: "wx" });
          }
          for (const row of plan.checks) {
            readAgentRunFile(row.script.path, { sha256: row.script.sha256, json: false, maxBytes: 1048576 });
            const data = fs.readFileSync(row.script.path); if (hash(data) !== row.script.sha256) fail("STANDARD_VALIDATION_SCRIPT_CHANGED");
            const destination = path.join(plan.snapshot_path, row.snapshot_path); fs.mkdirSync(path.dirname(destination), { recursive: true }); fs.writeFileSync(destination, data, { flag: "wx" });
          }
          const before = inventory(plan.snapshot_path, plan.limits), refs = [retain("before.json", JSON.stringify(before))], checks = [];
          let outputBytes = 0;
          for (const definition of plan.checks) {
            checkTime(); await assertAuthorized();
            if (shadowHash((await readWork(instance, plan.input)).output) !== plan.work_sha256 || shadowHash(inventory(plan.snapshot_path, plan.limits)) !== shadowHash(before)) fail("STANDARD_VALIDATION_SOURCE_STALE");
            checkTime(); if (outputBytes >= plan.limits.max_output_bytes) fail("STANDARD_VALIDATION_OUTPUT_LIMIT");
            const invocation = { invocation_id: "validation:" + shadowHash({ plan: expectPlan, id: definition.test_ref }).slice(0, 40), boundary_id: materials.boundary.getDescriptor().boundary_id,
              validation_id: definition.test_ref, executable: materials.configuration.runner.executable, executable_sha256: materials.configuration.runner.sha256,
              argv: [definition.snapshot_path, ...definition.args], cwd: plan.snapshot_path, environment_sha256: shadowHash(materials.profile.environment),
              max_duration_ms: Math.max(1, remaining()), max_output_bytes: plan.limits.max_output_bytes - outputBytes };
            const requestHash = shadowHash(invocation); let result;
            try {
              result = await bounded(materials.boundary.run({ ...invocation, request_sha256: requestHash, environment: materials.profile.environment }, { signal: stop.signal }), remaining() + 1000);
              if (result.invocation_id !== invocation.invocation_id || result.request_sha256 !== requestHash || result.boundary_id !== invocation.boundary_id || result.termination_state !== "confirmed") fail("STANDARD_VALIDATION_STOP_UNCONFIRMED");
            } catch (cause) {
              stop.abort();
              try { result = await bounded(materials.boundary.requestStop({ invocationId: invocation.invocation_id, requestSha256: requestHash }), 1000); } catch { fail("STANDARD_VALIDATION_STOP_UNCONFIRMED"); }
              if (result.termination_state !== "confirmed" || result.boundary_id !== invocation.boundary_id || result.invocation_id !== invocation.invocation_id || result.request_sha256 !== requestHash) fail("STANDARD_VALIDATION_STOP_UNCONFIRMED");
              throw cause;
            }
            checkTime();
            const stdout = Buffer.from(result.stdout ?? ""), stderr = Buffer.from(result.stderr ?? ""); outputBytes += stdout.length + stderr.length;
            if (outputBytes > plan.limits.max_output_bytes) fail("STANDARD_VALIDATION_OUTPUT_LIMIT");
            const logName = hash(definition.test_ref).slice(0, 40);
            refs.push(retain(logName + ".stdout", stdout), retain(logName + ".stderr", stderr));
            let protocol = null; try { protocol = JSON.parse(stdout.toString("utf8")); } catch { /* a process exit is not a check verdict */ }
            checks.push({ test_ref: definition.test_ref, status: interpretAgentVerificationCheck(protocol, result, definition.test_ref), request_sha256: requestHash,
              process: { outcome: result.outcome ?? "unavailable", exit_code: result.exit_code, signal: result.signal, termination_state: result.termination_state }, process_evidence: result.process_evidence ?? null });
          }
          const after = inventory(plan.snapshot_path, plan.limits);
          if (shadowHash(after) !== shadowHash(before) || (await readWork(instance, plan.input)).evaluation_sha256 !== plan.work_sha256
            || readCurrent(instance.instance_id).instance_sha256 !== instance.instance_sha256) fail("STANDARD_VALIDATION_POSTCONDITION_FAILED");
          await material(work.product_root); checkTime(); refs.push(retain("after.json", JSON.stringify(after)));
          const status = standardValidationStatus(checks);
          const manifest = retain("result.json", JSON.stringify({ plan_sha256: expectPlan, product_sha256: plan.product_sha256, status, checks, proof_class: proofClass, evidence_refs: refs }));
          return assertStandardOperationOutput(output("completed", "confirmed", { status, checks, proof_class: proofClass, profile_sha256: plan.profile_sha256, product_sha256: plan.product_sha256,
            snapshot_sha256: shadowHash(after), snapshot_path: plan.snapshot_path, work_operation_id: plan.input.work_operation_id },
          { cycle_validation_available: status !== "unavailable", cycle_validation_passed: status === "passed" }, [manifest]));
        } catch (cause) {
          return output(touched ? "reconciliation_required" : "blocked", touched ? "unknown" : "no_effect", { reason_code: cause.code ?? "STANDARD_VALIDATION_UNCONFIRMED", proof_class: proofClass });
        } finally { stop.abort(); clearTimeout(timer); }
      });
    },
  });
}
