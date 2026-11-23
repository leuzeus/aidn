import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { assertStandardValidationNativeLayout as checkLayout } from "../../src/core/workflow/standard-validation-native-layout.mjs";
import { runStandardWorkflowEntry, resolveStandardWorkflowConfiguration } from "../../src/application/runtime/standard-workflow-entry.mjs";
const H = "a".repeat(64), digest = bytes => createHash("sha256").update(bytes).digest("hex");

export async function verifyStandardValidationLayout({ check }) {
  await check("Windows validator launch paths cannot be under Native denied roots", () => {
    const input = { execution: { control_root: "C:\\pilot\\control", native: { home: "C:\\native-home", protected_roots: ["C:\\private"] } },
      profile: { snapshot_root: "C:\\validation\\snapshots" }, boundary: { platform: "win32", roots: { scratch: "C:\\validation\\scratch" },
        runner: { executable: "C:\\bin\\node.exe" }, trampoline: { executable: "C:\\bin\\trampoline.exe" }, access_observer: { executable: "C:\\bin\\access.exe" } } };
    const before = structuredClone(input); checkLayout(input); assert.deepEqual(input, before);
    for (const mutate of [i => { i.profile.snapshot_root = "c:/PRIVATE/snapshots"; }, i => { i.profile.snapshot_root = "C:\\private"; },
      i => { i.boundary.roots.scratch = "C:\\private\\scratch"; }, i => { i.boundary.roots.scratch = "C:\\"; },
      i => { i.boundary.runner.executable = "C:\\private\\runner.exe"; }, i => { i.boundary.trampoline.executable = "C:\\private\\trampoline.exe"; },
      i => { i.boundary.access_observer.executable = "C:\\private\\observer.exe"; }, i => { i.profile.snapshot_root = "C:\\pilot\\control\\snapshots"; },
      i => { i.profile.snapshot_root = "C:\\native-home\\snapshots"; }, i => { i.profile.snapshot_root = "C:\\allowed\\..\\private\\snapshots"; }]) {
      const value = structuredClone(input); mutate(value); assert.throws(() => checkLayout(value), { code: "STANDARD_VALIDATION_NATIVE_READ_CONFLICT" });
    }
    for (const snapshot of ["C:\\private-sibling\\snapshots", "D:\\private\\snapshots", "C:\\validation\\snapshots"]) {
      checkLayout({ ...input, profile: { snapshot_root: snapshot } });
    }
    checkLayout({ ...input, profile: { snapshot_root: "C:\\private\\snapshots" }, boundary: { ...input.boundary, platform: "linux" } });
    for (const protected_roots of ["C:\\private", [null]])
      assert.throws(() => checkLayout({ ...input, execution: { ...input.execution, native: { ...input.execution.native, protected_roots } } }), { code: "PROCESS_EXECUTION_PROTECTED_ROOT_INVALID" });
  });
  await check("public entry refuses the pinned conflicting profile before authority or workflow creation", async () => {
    const root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "aidn-validation-layout-"));
    try {
      const save = (name, value) => { const file = path.join(root, name), bytes = JSON.stringify(value); fs.writeFileSync(file, bytes, { flag: "wx" }); return { path: file, sha256: digest(bytes) }; };
      const privateRoot = path.join(root, "private"), snapshot = path.join(privateRoot, "snapshots");
      const boundary = save("boundary.json", { platform: "win32", roots: { scratch: path.join(root, "scratch") }, runner: { executable: process.execPath }, trampoline: { executable: path.join(root, "trampoline.exe") } });
      const absent = { path: path.join(root, "not-opened"), sha256: H };
      const profileValue = { contract_version: "standard-cycle-validation-profile.v1", id: "fixture", boundary_configuration: boundary, qualification: absent, public_key: absent,
        snapshot_root: snapshot, evidence_root: path.join(root, "evidence"), environment: {}, checks: [{ test_ref: "TEST-001", script: absent, snapshot_path: "_aidn_checks/check.mjs", args: [] }],
        limits: { max_duration_ms: 1000, max_output_bytes: 4096, max_files: 16, max_snapshot_bytes: 4096 } };
      const profile = save("profile.json", profileValue);
      const request = { contract_version: "standard-workflow-execution.v1", parameters: {}, validation_profile: profile,
        execution: { instance_id: "layout-fixture", target_root: path.join(root, "absent-target"), product_root: path.join(root, "product"),
          control_root: path.join(root, "control"), review_root: path.join(root, "review"), product_files: ["app.mjs"], criteria: {}, authorities: {}, controller: {},
          native: { home: path.join(root, "native"), protected_roots: [privateRoot] } } };
      const before = fs.readdirSync(root).map(name => [name, digest(fs.readFileSync(path.join(root, name)))]);
      let providerCalls = 0;
      await assert.rejects(runStandardWorkflowEntry({ request }, { providerTransport: () => { providerCalls++; throw Error("Must not construct provider"); } }), { code: "STANDARD_VALIDATION_NATIVE_READ_CONFLICT" });
      assert.equal(providerCalls, 0); assert(!fs.existsSync(request.execution.target_root));
      assert.deepEqual(fs.readdirSync(root).map(name => [name, digest(fs.readFileSync(path.join(root, name)))]), before);
      const allowed = save("allowed-profile.json", { ...profileValue, snapshot_root: path.join(root, "snapshots") });
      assert.equal(resolveStandardWorkflowConfiguration({ ...request, validation_profile: allowed }).validationProfile.sha256, allowed.sha256);
      const { validation_profile, ...withoutProfile } = request;
      assert.equal(resolveStandardWorkflowConfiguration(withoutProfile).validationProfile, null);
      fs.appendFileSync(boundary.path, " ");
      assert.throws(() => resolveStandardWorkflowConfiguration({ ...request, validation_profile: allowed }));
    } finally {
      assert.equal(path.dirname(fs.realpathSync(root)), fs.realpathSync(os.tmpdir())); assert(path.basename(root).startsWith("aidn-validation-layout-"));
      fs.rmSync(root, { recursive: true });
    }
  });
}
