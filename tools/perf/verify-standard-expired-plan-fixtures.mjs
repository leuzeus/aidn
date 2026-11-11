import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash, randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createStandardWorkflowFixture } from "./standard-workflow-fixture-lib.mjs";
import { createStandardWorkflowOperationHost } from "../../src/application/runtime/standard-workflow-operation-host.mjs";
import { standardWorkflowOperationBindings } from "../../src/application/runtime/standard-workflow-operations.mjs";
import { createStandardWorkflowArtifacts } from "../../src/application/runtime/standard-workflow-artifacts.mjs";
import { simulateAgenticProcess } from "../../src/core/workflow/agentic-process-simulation.mjs";
import { shadowHash } from "../../src/core/workflow/shadow-json.mjs";
import { verifyStandardPreviewValidity } from "./standard-preview-validity-fixture-lib.mjs";

const here = fileURLToPath(import.meta.url), temporary = fs.realpathSync(os.tmpdir());
const H = "a".repeat(64), grant = { authorized: true, authority_id: "fixture_operator", principal_sha256: H, grant_sha256: H };
const input = { session_id: "S001", session_branch: "S001-standard", objective: "Retain an expired refusal before fresh preparation" };
const git = (root, ...args) => execFileSync("git", ["-C", root, ...args], {
  encoding: "utf8", stdio: "pipe", windowsHide: true, env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
}).trim();
function model() {
  const binding = standardWorkflowOperationBindings().find(row => row.id === "session_initialize");
  return { contract_version: "agentic-process-model.v2", model_id: "expired-plan-fixture", revision: 1,
    participants: [{ id: "project" }], roles: [], policies: [], entry: "initialize",
    operation_pins: { session_initialize: shadowHash(binding) },
    nodes: [{ id: "initialize", kind: "operation", participant_ref: "project", binding_ref: "session_initialize" }] };
}
const currentGrant = async request => ({ ...grant, grant_sha256: request.preview_sha256 });
function host(root, keyFile, clock, authorize = currentGrant) {
  return createStandardWorkflowOperationHost({ targetRoot: root, model: model(), readSigningKey: () => fs.readFileSync(keyFile),
    authorize, now: () => clock.value });
}
function snapshot(root) {
  const rows = [];
  const walk = directory => {
    for (const name of fs.readdirSync(directory).sort()) {
      const file = path.join(directory, name), stat = fs.lstatSync(file), relative = path.relative(root, file).replaceAll("\\", "/");
      if (stat.isSymbolicLink()) rows.push([relative, "link", fs.readlinkSync(file)]);
      else if (stat.isDirectory()) { rows.push([relative, "directory"]); walk(file); }
      else rows.push([relative, "file", createHash("sha256").update(fs.readFileSync(file)).digest("hex")]);
    }
  };
  walk(root); return rows;
}
function child(root, keyFile, id, clockValue, expectedSha256, action) {
  return JSON.parse(execFileSync(process.execPath, [here, "--child", root, keyFile, id, String(clockValue), expectedSha256, action],
    { encoding: "utf8", timeout: 180000, maxBuffer: 1048576, stdio: ["ignore", "pipe", "pipe"], windowsHide: true }));
}

export async function verifyStandardExpiredPlans() {
  let checks = 0;
  const owned = [], pass = name => { checks++; console.log("PASS " + name); };
  try {
    for (const mode of ["files", "dual", "db-only"]) {
      const root = createStandardWorkflowFixture(mode, owned), privateRoot = fs.mkdtempSync(path.join(temporary, "aidn-standard-expired-")); owned.push(privateRoot);
      const keyFile = path.join(privateRoot, "host.key"); fs.writeFileSync(keyFile, randomBytes(32));
      const clock = { value: Date.now() }, runtime = host(root, keyFile, clock), initial = runtime.initialize({ instanceId: "expired" });
      runtime.initialize({ instanceId: "expired", write: true, expectedResultSha256: initial.record.instance_sha256 });
      const preview = await runtime.preview({ instanceId: "expired", expectedSha256: initial.record.instance_sha256, occurrenceId: "root", input });
      const staged = await runtime.stage(preview, { write: true, expectedPreviewSha256: shadowHash(preview) }), id = staged.operation_id;
      const business = createStandardWorkflowArtifacts({ targetRoot: root });
      const before = preview.prepared.plan.changes.map(row => business.read(row.path)), head = git(root, "rev-parse", "HEAD");
      clock.value = preview.prepared.plan.prepared_at_ms + 300001;
      const refused = await runtime.dispatch(id, { write: true });
      assert.equal(refused.receipt.outcome, "blocked"); assert.equal(refused.receipt.effect_status, "no_effect");
      const original = runtime.readJournal(id);
      assert.equal(original.results[0].output.observations.reason_code, "STANDARD_PLAN_EXPIRED");
      assert.deepEqual(preview.prepared.plan.changes.map(row => business.read(row.path)), before);
      assert.equal(git(root, "rev-parse", "HEAD"), head); assert.equal(git(root, "branch", "--show-current"), "dev");
      assert.equal(business.ownerPending(), false);
      const pending = runtime.inspect("expired");
      await assert.rejects(runtime.reprepareExpiredOperation(id, { expectedSha256: pending.record.instance_sha256 }),
        { code: "STANDARD_HOST_ACCEPTED_EXPIRED_NO_EFFECT_REQUIRED" });
      pass(`${mode}: real expired dispatch refuses before business effects; unaccepted result cannot be reprepared`);

      const accepted = await runtime.accept(id, { write: true }), expected = accepted.record.instance_sha256;
      assert.equal(accepted.cursor.status, "WAITING");
      const bytes = snapshot(root);
      const preparation = child(root, keyFile, id, clock.value, expected, "prepare"), candidate = preparation.preview;
      assert.equal(preparation.authorization_calls, 0);
      assert.deepEqual(snapshot(root), bytes, "cold preparation must leave every checkout file unchanged");
      assert.equal(candidate.instance_sha256, expected); assert.deepEqual(candidate.input, original.preview.input);
      assert.equal(candidate.prepared.plan.prepared_at_ms, clock.value);
      assert.notEqual(candidate.prepared.plan_sha256, original.preview.prepared.plan_sha256);
      assert.deepEqual(runtime.readJournal(id), original);
      pass(`${mode}: fresh Node prepares the same subject at current time, preserving all files and the original grant/refusal`);

      await assert.rejects(runtime.reprepareExpiredOperation(id, { expectedSha256: initial.record.instance_sha256 }), { code: "PROCESS_REVISION_CONFLICT" });
      await assert.rejects(runtime.reprepareExpiredOperation(id, { expectedSha256: expected, input: { session_id: "S999" } }),
        { code: "STANDARD_HOST_REPREPARE_INPUT_INVALID" });
      await assert.rejects(runtime.reprepareExpiredOperation(id, { expectedSha256: expected, signal: AbortSignal.abort() }),
        { code: "STANDARD_HOST_REPREPARE_ABORTED" });
      const denied = host(root, keyFile, clock, async () => ({ ...grant, authorized: false }));
      const deniedPreview = await denied.reprepareExpiredOperation(id, { expectedSha256: expected });
      await assert.rejects(denied.stage(deniedPreview, { write: true, expectedPreviewSha256: shadowHash(deniedPreview) }),
        { code: "STANDARD_HOST_AUTHORIZATION_REQUIRED" });
      assert.deepEqual(snapshot(root), bytes);
      pass(`${mode}: stale revision, subject override, abort and refused new grant produce no successor or business effect`);

      // The actual configured authority is read again; a changed storage scope
      // cannot be substituted beneath the original process or copied plan.
      const configPath = path.join(root, ".aidn/config.json"), configBytes = fs.readFileSync(configPath);
      const changedConfig = JSON.parse(configBytes); changedConfig.runtime.stateMode = mode === "files" ? "dual" : "files";
      fs.writeFileSync(configPath, JSON.stringify(changedConfig));
      await assert.rejects(runtime.reprepareExpiredOperation(id, { expectedSha256: expected }), { code: "STANDARD_HOST_STATE_MODE_CHANGED" });
      fs.writeFileSync(configPath, configBytes);
      assert.deepEqual(runtime.readJournal(id), original); assert.equal(git(root, "branch", "--show-current"), "dev");
      await business.withLocalEffectOwner(original.preview.prepared.plan_sha256, async () => {
        await assert.rejects(runtime.reprepareExpiredOperation(id, { expectedSha256: expected }), { code: "STANDARD_EFFECT_OWNER_RECONCILIATION_REQUIRED" });
        return { effect_status: "no_effect" };
      });
      git(root, "branch", input.session_branch);
      await assert.rejects(runtime.reprepareExpiredOperation(id, { expectedSha256: expected }), { code: "STANDARD_SESSION_BRANCH_ALREADY_EXISTS" });
      git(root, "branch", "-D", input.session_branch);
      pass(`${mode}: changed current authority, a real effect owner and a conflicting Git branch refuse fresh preparation`);

      const next = child(root, keyFile, id, clock.value, expected, "stage");
      assert.notEqual(next.operation_id, id);
      const successor = runtime.readJournal(next.operation_id);
      assert.deepEqual(successor.preview.input, original.preview.input); assert.deepEqual(successor.grant, await currentGrant({ preview_sha256: shadowHash(successor.preview) }));
      assert.notDeepEqual(successor.grant, original.grant);
      assert.equal(successor.intent.instance_sha256, expected); assert.deepEqual(runtime.readJournal(id), original);
      // Dispatching/unknown state must not enter expiry preparation, even if the
      // old plan would now be expired. This is an actual pending new intent.
      await assert.rejects(runtime.reprepareExpiredOperation(next.operation_id, { expectedSha256: next.instance_sha256 }),
        { code: "STANDARD_HOST_ACCEPTED_EXPIRED_NO_EFFECT_REQUIRED" });
      const completed = await runtime.dispatch(next.operation_id, { write: true });
      assert.equal(completed.receipt.outcome, "completed"); assert.equal(completed.receipt.effect_status, "confirmed");
      const done = await runtime.accept(next.operation_id, { write: true }); assert.equal(done.cursor.status, "COMPLETED");
      assert.equal(done.record.events.filter(row => row.kind === "operation_intent").length, 2);
      assert.equal(done.record.events.filter(row => row.kind === "operation_result").length, 2);
      assert.deepEqual(runtime.readJournal(id), original); assert.equal(business.ownerPending(), false);
      const finalFiles = snapshot(root);
      await assert.rejects(runtime.reprepareExpiredOperation(next.operation_id, { expectedSha256: done.record.instance_sha256 }),
        { code: "STANDARD_HOST_ACCEPTED_EXPIRED_NO_EFFECT_REQUIRED" });
      assert.equal((await runtime.dispatch(id, { write: true })).status, "retained_result");
      assert.equal((await runtime.dispatch(next.operation_id, { write: true })).status, "retained_result");
      const simulation = simulateAgenticProcess({ instanceId: done.record.instance_id, model: done.record.model,
        policyPins: done.record.policy_pins, scopeId: done.record.scope_id, events: done.record.events });
      assert.equal(simulation.trace.at(-1).instance_sha256, done.record.instance_sha256);
      assert.deepEqual(simulation.trace.at(-1).cursor, done.cursor); assert.deepEqual(snapshot(root), finalFiles);
      pass(`${mode}: new authenticated intent completes once; both immutable outcomes and exact common-reducer replay/simulation survive`);
    }
  } finally {
    for (const root of owned) {
      const physical = fs.realpathSync(root);
      if (path.dirname(physical) !== temporary || !path.basename(physical).startsWith("aidn-standard-")) throw Error("FIXTURE_CLEANUP_SCOPE_INVALID");
      fs.rmSync(physical, { recursive: true, force: true });
    }
  }
  await verifyStandardPreviewValidity(pass);
  return checks;
}

if (process.argv[1] && path.resolve(process.argv[1]) === here) {
  if (process.argv[2] === "--child") {
    const [, , , root, keyFile, id, clockValue, expectedSha256, action] = process.argv;
    let authorizationCalls = 0;
    const runtime = host(root, keyFile, { value: Number(clockValue) }, async request => { authorizationCalls++; return currentGrant(request); });
    const preview = await runtime.reprepareExpiredOperation(id, { expectedSha256 });
    if (action === "prepare") console.log(JSON.stringify({ preview, authorization_calls: authorizationCalls }));
    else {
      assert.equal(action, "stage");
      const next = await runtime.stage(preview, { write: true, expectedPreviewSha256: shadowHash(preview) });
      console.log(JSON.stringify({ operation_id: next.operation_id, instance_sha256: next.record.instance_sha256 }));
    }
  } else {
    const checks = await verifyStandardExpiredPlans();
    console.log(JSON.stringify({ status: "PASS", checks, clock: "injected", business_ports: "actual", stores: "files-and-SQLite",
      authorizations: "fixture-capability", native_model_calls: 0, full_standard_workflow: "NOT_QUALIFIED", installed_archive: "NOT_RUN" }));
  }
}
