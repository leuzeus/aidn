import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { agentRunPhysicalPath, readAgentRunFile } from "./agent-run-configuration-service.mjs";
import { shadowHash, checkShadowJson } from "../../core/workflow/shadow-json.mjs";
import { interpretAgentVerificationCheck } from "../../adapters/runtime/local-agent-verification.mjs";
import { selectStandardValidationChecks, standardValidationStatus } from "../../core/workflow/standard-cycle-validation.mjs";
import { assertStandardOperationOutput } from "../../core/workflow/standard-operation-contracts.mjs";
import { validateJsonSchema } from "../../core/contracts/json-schema-validator.mjs";
import planSchema from "../../core/contracts/workflow-definition/standard-cycle-validation-plan.v1.schema.json" with { type: "json" };
const fail = code => { throw Object.assign(new Error(code), { code }); };
const hash = value => createHash("sha256").update(value).digest("hex");
const equal = (a, b) => shadowHash(a) === shadowHash(b);
export function inventoryStandardValidationSnapshot(directory, limits) {
  const rows = []; let bytes = 0, entries = 0;
  function walk(at) {
    agentRunPhysicalPath(at);
    for (const name of fs.readdirSync(at).sort()) {
      if (++entries > limits.max_files + 256) fail("STANDARD_VALIDATION_SNAPSHOT_LIMIT");
      const file = path.join(at, name), stat = fs.lstatSync(file);
      if (stat.isSymbolicLink()) fail("STANDARD_VALIDATION_SNAPSHOT_REDIRECTED");
      if (stat.isDirectory()) walk(file); else {
        if (!stat.isFile() || stat.size > limits.max_snapshot_bytes + 67108864 - bytes) fail("STANDARD_VALIDATION_SNAPSHOT_LIMIT");
        const data = readAgentRunFile(file, { json: false, maxBytes: limits.max_snapshot_bytes + 67108864 - bytes }).value; bytes += data.length;
        if (rows.length >= limits.max_files + 64) fail("STANDARD_VALIDATION_SNAPSHOT_LIMIT");
        rows.push({ path: path.relative(directory, file).replaceAll("\\", "/"), bytes: data.length, sha256: hash(data) });
      }
    }
  }
  walk(directory); return rows;
}
// The caller authenticates the accepted operation and current work through the
// actual process authority. No authored path, verdict or quality label is trusted.
export function readStandardCycleValidationResult({ record, output, work, materials, allowFixture = false }) {
  assertStandardOperationOutput(output);
  const prepared = record.preview.prepared, plan = prepared?.plan, profile = materials.profile;
  if (checkShadowJson(plan) || validateJsonSchema(plan, planSchema, "$", { contractKind: "workflow-definition" }).length
    || prepared.plan_sha256 !== shadowHash(plan) || record.intent.binding_ref !== "cycle_validation_execute"
    || !equal(record.preview.input, plan.input) || !equal(plan.limits, profile.limits)
    || output.outcome !== "completed" || output.effect_status !== "confirmed"
    || output.observations.proof_class !== plan.proof_class || plan.proof_class === "fixture" && !allowFixture
    || plan.profile_sha256 !== shadowHash(profile) || plan.descriptor_sha256 !== materials.descriptor_sha256
    || plan.work_sha256 !== work.evaluation_sha256 || !equal(plan.files, work.files) || plan.product_sha256 !== shadowHash(work.files)
    || output.observations.product_sha256 !== plan.product_sha256 || output.observations.profile_sha256 !== plan.profile_sha256
    || output.observations.work_operation_id !== plan.input.work_operation_id
    || !equal(plan.checks, selectStandardValidationChecks(profile, work.output.observations.task))) fail("STANDARD_VALIDATION_RESULT_BINDING_CHANGED");
  const base = "validation_" + shadowHash({ input: plan.input, preparedAt: plan.prepared_at_ms, profile: plan.profile_sha256 }).slice(0, 32);
  if (plan.snapshot_path !== path.join(profile.snapshot_root, base) || output.observations.snapshot_path !== plan.snapshot_path
    || output.evidence_refs[0]?.ref !== `validation/${base}/result.json`) fail("STANDARD_VALIDATION_EVIDENCE_SCOPE_INVALID");
  const read = (ref, json = true, maxBytes = 8388608) => {
    if (!ref || Object.keys(ref).sort().join(",") !== "ref,sha256" || !/^[a-f0-9]{64}$/.test(ref.sha256)
      || typeof ref.ref !== "string" || !ref.ref.startsWith(`validation/${base}/`) || !/^[A-Za-z0-9._-]+$/.test(ref.ref.slice(`validation/${base}/`.length))) fail("STANDARD_VALIDATION_EVIDENCE_SCOPE_INVALID");
    return readAgentRunFile(path.join(profile.evidence_root, base, path.posix.basename(ref.ref)), { sha256: ref.sha256, json, maxBytes }).value;
  };
  const manifest = read(output.evidence_refs[0]);
  if (checkShadowJson(manifest) || Object.keys(manifest).sort().join(",") !== "checks,evidence_refs,plan_sha256,product_sha256,proof_class,status"
    || manifest.plan_sha256 !== prepared.plan_sha256 || manifest.product_sha256 !== plan.product_sha256 || manifest.proof_class !== plan.proof_class
    || manifest.status !== output.observations.status || !equal(manifest.checks, output.observations.checks)
    || !Array.isArray(manifest.checks) || manifest.checks.length !== plan.checks.length || !Array.isArray(manifest.evidence_refs)) fail("STANDARD_VALIDATION_MANIFEST_CHANGED");
  const names = ["before.json", ...plan.checks.flatMap(row => [hash(row.test_ref).slice(0, 40) + ".stdout", hash(row.test_ref).slice(0, 40) + ".stderr"]), "after.json"];
  if (!equal(manifest.evidence_refs.map(row => row.ref), names.map(name => `validation/${base}/${name}`))) fail("STANDARD_VALIDATION_LOG_SET_CHANGED");
  const before = read(manifest.evidence_refs[0]), after = read(manifest.evidence_refs.at(-1)), inventory = inventoryStandardValidationSnapshot(plan.snapshot_path, plan.limits);
  if (!equal(before, after) || !equal(after, inventory) || shadowHash(inventory) !== output.observations.snapshot_sha256) fail("STANDARD_VALIDATION_SNAPSHOT_CHANGED");
  const expected = plan.files.filter(row => row.present).map(({ path, sha256, bytes }) => ({ path, sha256, bytes }));
  for (const check of plan.checks) { const source = readAgentRunFile(check.script.path, { sha256: check.script.sha256, json: false, maxBytes: 1048576 });
    expected.push({ path: check.snapshot_path, sha256: source.sha256, bytes: source.bytes }); }
  const sorted = rows => [...rows].sort((a, b) => a.path.localeCompare(b.path));
  if (!equal(sorted(expected), sorted(inventory))) fail("STANDARD_VALIDATION_SNAPSHOT_CHANGED");
  let outputBytes = 0;
  for (const [index, definition] of plan.checks.entries()) {
    const stdout = read(manifest.evidence_refs[1 + index * 2], false, plan.limits.max_output_bytes), stderr = read(manifest.evidence_refs[2 + index * 2], false, plan.limits.max_output_bytes);
    outputBytes += stdout.length + stderr.length; const check = manifest.checks[index];
    let protocol = null; try { protocol = JSON.parse(stdout.toString("utf8")); } catch { /* unavailable, never a passed check */ }
    if (check.test_ref !== definition.test_ref || check.process?.termination_state !== "confirmed" || !/^[a-f0-9]{64}$/.test(check.request_sha256)
      || check.status !== interpretAgentVerificationCheck(protocol, check.process, definition.test_ref) || outputBytes > plan.limits.max_output_bytes) fail("STANDARD_VALIDATION_VERDICT_CHANGED");
  }
  if (standardValidationStatus(manifest.checks) !== manifest.status) fail("STANDARD_VALIDATION_VERDICT_CHANGED");
  return { plan, manifest, evidence_refs: output.evidence_refs, checks: manifest.checks.map(({ test_ref, status, request_sha256 }) => ({ test_ref, status, request_sha256 })) };
}
