import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFile, spawnSync } from "node:child_process";
import { shadowHash } from "../../src/core/workflow/shadow-json.mjs";
import { assertStandardValidationProfile, selectStandardValidationChecks } from "../../src/core/workflow/standard-cycle-validation.mjs";
const hash = value => createHash("sha256").update(value).digest("hex");
// Executes a controlled Node fixture. No Codex sandbox qualification, native
// provider, isolation, or general process-tree termination is established.
export function fixtureValidationBoundary({ configuration }) {
  const finished = new Map(), boundary_id = "fixture-validation";
  return {
    getDescriptor: () => ({ boundary_id, qualification: "offline-controlled-node-fixture" }),
    checkAvailability: async () => ({ available: true, native: false }),
    inspectOperations: async () => ({ uncertain_read: false, operations: [] }),
    async run(request, { signal }) {
      const { environment, request_sha256, ...unsigned } = request;
      assert.equal(shadowHash(unsigned), request_sha256);
      assert.equal(request.executable, process.execPath); assert.equal(hash(fs.readFileSync(request.executable)), request.executable_sha256);
      assert.equal(shadowHash(environment), request.environment_sha256);
      fs.appendFileSync(configuration.fixture_counter, JSON.stringify({ invocation_id: request.invocation_id, cwd: request.cwd }) + "\n");
      if (configuration.fixture_mode === "hang") return new Promise(() => {});
      const result = await new Promise(resolve => execFile(request.executable, request.argv, { cwd: request.cwd, env: environment, signal,
        timeout: request.max_duration_ms, maxBuffer: request.max_output_bytes, windowsHide: true, encoding: "utf8" }, (error, stdout, stderr) => resolve({
        boundary_id, invocation_id: request.invocation_id, request_sha256, termination_state: "confirmed",
        outcome: error ? "failed" : "completed", exit_code: error?.code && Number.isInteger(error.code) ? error.code : error ? null : 0,
        signal: error?.signal ?? null, stdout, stderr, process_evidence: { proof_class: "fixture", controlled_node_only: true } })));
      finished.set(request.invocation_id, result); return result;
    },
    async requestStop({ invocationId }) { return finished.get(invocationId) ?? new Promise(() => {}); },
  };
}
export function createValidationProfileFixture(base, { status = "passed", mode = "normal", duration = 600000, testRef = "TEST:VALUE", writableControl = false, expectedValue = 2 } = {}) {
  assert.ok(Number.isSafeInteger(expectedValue));
  const control = path.join(base, "validation-control"); fs.mkdirSync(control, { recursive: true });
  const snapshots = path.join(control, "snapshots"), evidence = path.join(control, "evidence"); fs.mkdirSync(snapshots); fs.mkdirSync(evidence);
  const write = (name, data) => { const file = path.join(control, name), bytes = Buffer.from(typeof data === "string" ? data : JSON.stringify(data)); fs.writeFileSync(file, bytes); return { path: file, sha256: hash(bytes) }; };
  const environment = process.platform === "win32" ? { SystemRoot: process.env.SystemRoot } : {};
  const counter = path.join(control, "calls.jsonl"); fs.writeFileSync(counter, "");
  const configuration = { roots: { snapshots }, environment_sha256: shadowHash(environment), runner: { executable: process.execPath, sha256: hash(fs.readFileSync(process.execPath)) }, fixture_counter: counter, fixture_mode: mode };
  if (writableControl) configuration.roots.scratch = evidence;
  const script = write("check.mjs", mode === "node-timeout" ? "setInterval(()=>{},1000);\n" : `import fs from "node:fs";\nimport path from "node:path";\nimport { pathToFileURL } from "node:url";\nconst subject=await import(pathToFileURL(path.resolve("app.mjs")).href);\n${mode === "mutate" ? 'fs.writeFileSync("app.mjs", "changed");' : ""}\nprocess.stdout.write(${mode === "malformed" ? '"no verdict"' : 'JSON.stringify({contract_version:"agent-verification-check.v1",validation_id:'+JSON.stringify(testRef)+',status:subject.value==='+expectedValue+' && Object.keys(subject).join() === "value"?process.argv[2]:"failed"})'});\n`);
  const profile = { contract_version: "standard-cycle-validation-profile.v1", id: "fixture_checks", boundary_configuration: write("boundary.json", configuration),
    qualification: write("qualification.json", {}), public_key: write("public.pem", "fixture-only"), evidence_root: evidence, snapshot_root: snapshots, environment,
    checks: [{ test_ref: testRef, script, snapshot_path: "_aidn_checks/check.mjs", args: [status] }],
    limits: { max_duration_ms: duration, max_output_bytes: 65536, max_files: 64, max_snapshot_bytes: 1048576 } };
  const profileRef = write("profile.json", profile);
  return { profile, profileRef, counter, calls: () => fs.readFileSync(counter, "utf8").trim().split("\n").filter(Boolean).length };
}

// Setup evidence for a NEW fixture only. This does not qualify a native sandbox
// or validate the product: the runtime must still execute the planned verifier.
export async function preflightValidationProfileFixture(fixture, { testRefs, expectedValue = 2 }) {
  const bytes = fs.readFileSync(fixture.profileRef.path);
  assert.equal(hash(bytes), fixture.profileRef.sha256);
  const profile = assertStandardValidationProfile(JSON.parse(bytes));
  const checks = selectStandardValidationChecks(profile, { test_refs: testRefs });
  const configurationBytes = fs.readFileSync(profile.boundary_configuration.path);
  assert.equal(hash(configurationBytes), profile.boundary_configuration.sha256);
  const boundary = fixtureValidationBoundary({ configuration: JSON.parse(configurationBytes) });
  assert.deepEqual(await boundary.checkAvailability(), { available: true, native: false });
  const results = [];
  for (const [value, expected] of [[expectedValue, "passed"], [expectedValue - 1, "failed"]]) {
    const cwd = path.join(path.dirname(fixture.profileRef.path), "preflight-" + expected);
    fs.mkdirSync(cwd); fs.writeFileSync(path.join(cwd, "app.mjs"), `export const value = ${value};\n`);
    for (const check of checks) {
      assert.equal(hash(fs.readFileSync(check.script.path)), check.script.sha256);
      const child = spawnSync(process.execPath, [check.script.path, ...check.args], { cwd, env: profile.environment,
        windowsHide: true, timeout: 10000, maxBuffer: profile.limits.max_output_bytes, encoding: "utf8" });
      assert.equal(child.status, 0, child.stderr);
      const verdict = JSON.parse(child.stdout);
      assert.equal(verdict.contract_version, "agent-verification-check.v1");
      assert.equal(verdict.validation_id, check.test_ref); assert.equal(verdict.status, expected);
      results.push({ test_ref: check.test_ref, value, status: verdict.status });
    }
  }
  return { proof_class: "offline-controlled-node-fixture", profile_ref: fixture.profileRef, available: true, native: false,
    descriptor: boundary.getDescriptor(), test_refs: checks.map(row => row.test_ref), results, product_validation: "NOT_RUN" };
}
