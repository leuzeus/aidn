import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createStandardWorkflowMixedHost } from "../../src/application/runtime/standard-workflow-mixed-composition.mjs";
import { createStandardWorkflowArtifacts } from "../../src/application/runtime/standard-workflow-artifacts.mjs";
import { fixtureValidationBoundary } from "./standard-cycle-validation-fixture-lib.mjs";
import { closureHumanSource } from "./cycle-closure-fixture-lib.mjs";
import { shadowHash } from "../../src/core/workflow/shadow-json.mjs";
import { simulateAgenticProcess } from "../../src/core/workflow/agentic-process-simulation.mjs";
const inputFile = path.resolve(process.argv[process.argv.indexOf("--input") + 1] ?? "");
assert.ok(process.argv.includes("--input")); assert.equal(path.basename(inputFile), "closure-restart.json");
const data = JSON.parse(fs.readFileSync(inputFile)), f = data.fixture, base = fs.realpathSync(f.base), retainedRoot = fs.realpathSync(path.dirname(base)), temp = fs.realpathSync(os.tmpdir());
assert.equal(path.dirname(retainedRoot), temp); assert.ok(path.basename(retainedRoot).startsWith("aidn-agentic-execution-"));
assert.equal(fs.realpathSync(path.dirname(inputFile)), base);
const retained = JSON.parse(fs.readFileSync(path.join(retainedRoot, "retained-fixture.json")));
assert.equal(retained.proof_class, "offline-diagnostic-only"); assert.equal(fs.realpathSync(retained.root), retainedRoot);
const target = fs.realpathSync(f.configuration.target_root); assert.equal(path.dirname(target), temp); assert.ok(path.basename(target).startsWith("aidn-standard-fresh-"));
assert.ok(retained.business_roots.some(row => fs.realpathSync(row) === target));
const insideOwned = (value, parent) => { const resolved = fs.realpathSync(value), relative = path.relative(parent, resolved); assert.ok(relative && !path.isAbsolute(relative) && relative !== ".." && !relative.startsWith(".." + path.sep)); return resolved; };
const insideBase = value => insideOwned(value, base);
assert.match(path.basename(base), /^case-\d+$/);
insideOwned(f.configuration.product_root, target); insideBase(f.configuration.control_root);
const retainedProfile = JSON.parse(fs.readFileSync(data.validation_profile.path)); insideBase(retainedProfile.evidence_root);
let allowed = true, launches = 0;
const key = Buffer.from(data.key_hex, "hex"); assert.equal(key.length, 32);
const host = () => createStandardWorkflowMixedHost({ configuration: f.configuration, readSigningKey: () => key, validationProfile: data.validation_profile,
  humanSource: closureHumanSource(data.human_source_file), authorize: async () => ({ authorized: allowed, authority_id: "fixture_operator", principal_sha256: "a".repeat(64), grant_sha256: "b".repeat(64) }) },
  { validationBoundaryFactory: fixtureValidationBoundary, controllerFactory() { launches++; throw Error("RETAINED_FIXTURE_NATIVE_REPLAY_FORBIDDEN"); } });
const artifacts = createStandardWorkflowArtifacts({ targetRoot: target }), before = host().inspect();
assert.equal(before.cursor.status, "WAITING"); assert.equal(artifacts.ownerPending(), false);
const closeIntent = before.record.events.filter(row => row.kind === "operation_intent" && row.intent.binding_ref === "cycle_close_record").at(-1); assert.ok(closeIntent);
const closure = host().readOperation(closeIntent.intent.operation_id); assert.equal(closure.results.at(-1).output.outcome, "completed");
const closureSha = shadowHash(closure), allocationsSha = shadowHash(host().inspectAllocations());
const first = await host().step(); assert.equal(first.preview.binding.id, "cycle_close_finalize"); assert.equal(first.preview.prepared.can_apply, true);
const product = insideOwned(path.join(f.configuration.product_root, "app.mjs"), target), bytes = fs.readFileSync(product);
try { fs.writeFileSync(product, Buffer.concat([bytes, Buffer.from("\n// retained-product-refusal-probe\n")])); await assert.rejects(host().step(), error => ["STANDARD_AUDIT_NATIVE_SOURCE_CHANGED", "PROCESS_OPERATION_AUTHORITY_UNAVAILABLE"].includes(error.code)); }
finally { fs.writeFileSync(product, bytes); }
const validationIntent = before.record.events.filter(row => row.kind === "operation_intent" && row.intent.binding_ref === "cycle_validation_execute").at(-1); assert.ok(validationIntent);
const validation = host().readOperation(validationIntent.intent.operation_id).results.at(-1).output, manifestRef = validation.evidence_refs.find(row => row.ref.endsWith("/result.json")); assert.ok(manifestRef);
const profile = JSON.parse(fs.readFileSync(data.validation_profile.path)), manifest = JSON.parse(fs.readFileSync(path.join(profile.evidence_root, manifestRef.ref.slice("validation/".length))));
const ref = manifest.evidence_refs.find(row => row.ref.endsWith(".stdout")); assert.ok(ref);
const log = insideBase(path.join(profile.evidence_root, ref.ref.slice("validation/".length))), originalLog = fs.readFileSync(log);
const validationCounter = JSON.parse(fs.readFileSync(profile.boundary_configuration.path)).fixture_counter, beforeChecks = fs.readFileSync(validationCounter);
try { fs.writeFileSync(log, Buffer.concat([originalLog, Buffer.from(" ")])); await assert.rejects(host().step(), { code: "AGENT_RUN_FILE_CHANGED" }); }
finally { fs.writeFileSync(log, originalLog); }
const eventFile = path.join(target, ".aidn/runtime/perf/workflow-events.ndjson"), eventPrefix = fs.readFileSync(eventFile);
allowed = false; try { await assert.rejects(host().step({ write: true }), { code: "STANDARD_HOST_AUTHORIZATION_REQUIRED" }); } finally { allowed = true; }
assert.equal(host().inspect().record.instance_sha256, before.record.instance_sha256); assert.deepEqual(fs.readFileSync(eventFile), eventPrefix); assert.equal(artifacts.ownerPending(), false);
const restart = path.join(base, "closure-finalize-restart.json"); fs.writeFileSync(restart, JSON.stringify({ fixture: f, key_hex: data.key_hex, validation_profile: data.validation_profile, human_source_file: data.human_source_file }));
const script = fileURLToPath(new URL("verify-agentic-process-execution-fixtures.mjs", import.meta.url));
const child = spawnSync(process.execPath, [script, "--closure-finalize", restart], { encoding: "utf8", shell: false, windowsHide: true, timeout: 900000 });
assert.equal(child.status, 0, child.stderr); const result = JSON.parse(child.stdout); assert.equal(result.launches, 0); assert.equal(result.sessions, 0);
const record = host().readOperation(result.operation_id), output = record.results.at(-1).output;
assert.equal(output.outcome, "completed", JSON.stringify(output)); assert.equal(output.effect_status, "confirmed");
assert.deepEqual(output.facts, { cycle_close_completed: true, cycle_retained: true }); assert.equal(output.observations.committed.length, 3);
assert.equal(output.observations.hook.payload.checkpoint.run_id, output.observations.event.run_id); assert.equal(artifacts.ownerPending(), false);
const postimages = output.evidence_refs.filter(row => row.ref.startsWith("docs/audit/")); assert.equal(postimages.length, 3);
for (const row of postimages) assert.equal(artifacts.read(row.ref.slice("docs/audit/".length), { required: true }).sha256, row.sha256);
assert.deepEqual(fs.readFileSync(validationCounter), beforeChecks);
assert.equal(shadowHash(host().readOperation(closeIntent.intent.operation_id)), closureSha); assert.equal(shadowHash(host().inspectAllocations()), allocationsSha); assert.equal(launches, 0);
assert.ok(fs.readFileSync(product).equals(bytes));
const afterEvents = fs.readFileSync(eventFile), resultSha = shadowHash(record);
assert.equal((await host().dispatchOperation(result.operation_id, { write: true })).status, "retained_result");
assert.equal(shadowHash(host().readOperation(result.operation_id)), resultSha); assert.deepEqual(fs.readFileSync(eventFile), afterEvents);
const after = host().inspect(), replay = simulateAgenticProcess({ instanceId: after.record.instance_id, model: after.record.model, parameters: after.record.initial_parameters,
  policyPins: after.record.policy_pins, scopeId: after.record.scope_id, events: after.record.events });
assert.equal(replay.trace.at(-1).instance_sha256, after.record.instance_sha256);
console.log(JSON.stringify({ status: "PASS", proof_class: "offline-retained-common-host-finalizer-continuation", same_instance: true,
  same_model_sha256: f.configuration.model.sha256, original_instance_sha256: before.record.instance_sha256, final_instance_sha256: after.record.instance_sha256,
  six_document_record_unchanged: true, allocations_unchanged: true, native_launches: launches, hook_suffix_writes: output.observations.committed.length,
  duplicate_dispatch: "retained_result", common_reducer_replay: "exact", cursor: after.cursor.status, native: "NOT_RUN", installed_archive: "NOT_RUN" }));
