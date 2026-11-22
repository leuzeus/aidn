import assert from "node:assert/strict";
import path from "node:path";
import { createHash } from "node:crypto";
import { assertCodexSandboxValidationConfiguration, assertCodexSandboxValidationQualificationPayload,
  assertCodexSandboxNativeCase } from "../../src/adapters/runtime/codex-sandbox-validation-boundary.mjs";

export function verifyAccessEvidence({ networkCooperativeFixture, networkCooperativeReport, networkCooperativeQualification, managedPlan }) {
  const { config, request } = networkCooperativeFixture(), pin = "a".repeat(64);
  Object.assign(config, { contract_version: "codex-sandbox-validation-configuration.v5", assurance_profile: "codex-cooperative-access.v1",
    access_observer: { executable: path.join(config.roots.supervisor, "observer.exe"), sha256: pin, source_sha256: pin, probe_sha256: pin } });
  const plan = managedPlan(config, request);
  assert.equal(plan.contract_version, "codex-validation-native-plan.v5");
  assert.deepEqual(plan.cases.map(row => row.case_id), ["filesystem_access", "timeout", "cancel", "callback"]);
  assert.deepEqual(plan.diagnostic_cases, []);
  const q = { ...networkCooperativeQualification(config), assurance_profile: config.assurance_profile,
    contract_version: "agent-verification-boundary.v5", filesystem_evidence_method: "windows-access-check.v1", qualification_plan_sha256: plan.plan_sha256 };
  const report = networkCooperativeReport(config, q, "filesystem");
  report.case_id = report.before.case_id = report.after.case_id = "filesystem_access";
  report.source = { sha256: pin, bytes: 900 }; report.process.outcome = "completed"; report.assurance_profile = config.assurance_profile;
  for (const observation of [report.observation, report.concurrency.observation]) Object.assign(observation, {
    contract_version: "codex-validation-access-observation.v1", challenge: plan.challenge, case_id: report.case_id, assurance_profile: config.assurance_profile });
  const scratchHash = createHash("sha256").update(plan.challenge).digest("hex");
  report.host_canaries = { scratch_sha256: scratchHash, snapshot_sha256: pin, supervisor_sha256: pin };
  const paths = { snapshot: plan.canaries.snapshot_file, supervisor: plan.canaries.supervisor_file, scratch: plan.canaries.scratch_file };
  const sample = { subject_pid: report.prepared.pid, token_id: "0000000012345678", observer_sha256: pin, companion_pid: report.concurrency.prepared.pid };
  const rights = granted => ({ granted, descriptor_sha256: pin });
  for (const [role, target] of Object.entries(paths)) {
    const ancestors = [];
    for (let p = target; path.dirname(p) !== p; p = path.dirname(p)) ancestors.push(rights(role === "scratch" && !ancestors.length ? 3 : 1));
    sample[role] = { file: rights(role === "scratch" ? 3 : 1), ancestors };
  }
  report.observation.phase = "primary_completed";
  report.observation.observations = { paths, during: structuredClone(sample), after: { ...structuredClone(sample), companion_stopped: true },
    snapshot_sha256: pin, scratch_sha256: scratchHash };
  assert.equal(assertCodexSandboxNativeCase(report, q, config), report.case_id);
  for (const change of [
    r => { r.observation.observations.during.snapshot.file.granted |= 2; },
    r => { r.observation.observations.after.supervisor.ancestors[0].granted |= 0x40; },
    r => { r.observation.observations.after.snapshot.ancestors.at(-1).granted |= 0x40000; },
    r => { r.observation.observations.during.token_id = "0000000000000000"; },
    r => { r.observation.observations.during.subject_pid++; },
    r => { r.observation.observations.after.scratch.file.granted = 1; },
    r => { r.observation.observations.after.snapshot.file.granted = 0; },
    r => { r.observation.observations.after.snapshot.file.granted = 0x100000001; },
    r => { r.observation.observations.after.supervisor.ancestors.pop(); },
    r => { r.observation.observations.paths.supervisor = paths.scratch; },
    r => { r.host_canaries.scratch_sha256 = pin; },
    r => { r.source.sha256 = "b".repeat(64); },
    r => { r.concurrency.process.termination_proof.active_processes = 1; },
    r => { delete r.observation.observations.after; },
  ]) {
    const changed = structuredClone(report); change(changed);
    assert.throws(() => assertCodexSandboxNativeCase(changed, q, config));
  }
  assert.throws(() => assertCodexSandboxValidationQualificationPayload(networkCooperativeQualification(config), config));
  assert.throws(() => assertCodexSandboxValidationQualificationPayload({ ...q, filesystem_evidence_method: undefined }, config));
  assert.throws(() => assertCodexSandboxNativeCase(networkCooperativeReport(config, q, "filesystem"), q, config));
  const changed = structuredClone(config); changed.access_observer.executable = path.join(config.roots.scratch, "observer.exe");
  assert.throws(() => assertCodexSandboxValidationConfiguration(changed));
}
