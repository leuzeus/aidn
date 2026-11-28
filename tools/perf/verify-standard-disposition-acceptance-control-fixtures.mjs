import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fork } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createStandardWorkflowFixture } from "./standard-workflow-fixture-lib.mjs";
import { createStandardWorkflowOperationHost } from "../../src/application/runtime/standard-workflow-operation-host.mjs";
import { createStandardWorkflowArtifacts } from "../../src/application/runtime/standard-workflow-artifacts.mjs";
import { standardWorkflowOperationBindings } from "../../src/application/runtime/standard-workflow-operations.mjs";
import { createStandardHostAuthority } from "../../src/adapters/runtime/standard-host-authority.mjs";
import { observeLocalProcess, observeLocalProcessOwner } from "../../src/adapters/runtime/local-process-identity.mjs";
import { runStandardWorkflowAction } from "../../src/application/runtime/standard-workflow-entry.mjs";
import { createOperationJournalSigner } from "../../src/core/workflow/process-operation-journal.mjs";
import { shadowHash } from "../../src/core/workflow/shadow-json.mjs";

const here = fileURLToPath(import.meta.url), H = "a".repeat(64);
const read = file => JSON.parse(fs.readFileSync(file, "utf8"));
const save = (file, value) => fs.writeFileSync(file, JSON.stringify(value, null, 2) + "\n");
function model() {
  const binding = standardWorkflowOperationBindings().find(row => row.id === "context_reload");
  return { contract_version: "agentic-process-model.v2", model_id: "accepted-control-fixture", revision: 1,
    participants: [{ id: "project" }], roles: [], policies: [], operation_pins: { context_reload: shadowHash(binding) }, entry: "reload",
    nodes: [{ id: "reload", kind: "operation", participant_ref: "project", binding_ref: "context_reload" }] };
}
function source(calls = [], denied = false) {
  return {
    async authorize({ request }) {
      calls.push(request);
      return { contract_version: "process-disposition-authorization-grant.v2", authority_id: "fixture_operator", authorized: !denied,
        request_sha256: shadowHash(request), principal_sha256: H, grant_sha256: shadowHash({ request, fixture: "accepted-control" }),
        observed_at_ms: Date.now(), evidence_refs: [{ ref: "fixture:current-control-consent", sha256: shadowHash(request) }] };
    },
    async verify({ request, grant }) {
      return { outcome: "verified", authority_id: grant.authority_id, request_sha256: shadowHash(request), grant_sha256: shadowHash(grant) };
    },
  };
}
const open = (config, dispositionSource = source(), options = {}) => createStandardWorkflowOperationHost({ targetRoot: config.root,
  model: model(), readSigningKey: () => Buffer.from(config.key, "hex"), dispositionSource,
  authorize: async () => { throw Error("BUSINESS_EFFECT_AUTHORITY_MUST_NOT_BE_USED"); } }, options);

if (process.argv[2] === "--worker") {
  const config = read(process.argv[3]), boundary = process.argv[4];
  // Keep the IPC handle referenced while the parent observes the live owner.
  // An unresolved promise alone allows Node to exit before that observation.
  process.on("message", () => {});
  const host = open(config, source(), { dispatchCheckpoint: async point => {
    if (point !== boundary) return;
    const lease = createStandardWorkflowArtifacts({ targetRoot: config.root }).resourceFence().read();
    process.send({ boundary, identity: observeLocalProcess(process.pid), lease_identity: lease.record.process_identity, instance_sha256: host.inspect(config.instance).record.instance_sha256 });
    await new Promise(() => {});
  } });
  try { await host.accept(config.operation_id, { write: true }); throw Error("ACCEPTANCE_CUT_NOT_REACHED"); }
  catch (cause) { process.send({ error: cause.code ?? cause.message, stack: cause.stack }); process.exitCode = 1; }
} else {
  const mode = process.argv[2] ?? "dual";
  if (!["dual", "db-only"].includes(mode) || process.argv.length > 3) throw Error("FIXTURE_MODE_INVALID");
  const owned = [], evidence = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "aidn-accepted-control-evidence-"));
  const config = { root: createStandardWorkflowFixture(mode, owned), instance: "accepted-control", mode };
  const home = path.join(evidence, "protected-home"); fs.mkdirSync(home);
  const configuration = { instance_id: config.instance, target_root: config.root, control_root: config.root, review_root: config.root,
    native: { home: path.join(evidence, "native-home"), tool_roots: [], protected_roots: [home] } };
  const authority = createStandardHostAuthority({ configuration, environment: { AIDN_STANDARD_HOST_HOME: home } }, { useProvider: false });
  config.key = authority.ensureKey().toString("hex");
  const file = path.join(evidence, "worker.json"), host = open(config), artifacts = createStandardWorkflowArtifacts({ targetRoot: config.root });
  const auditPath = () => `workflows/operation-dispositions/${config.operation_id}.json`;
  const controlPath = () => `workflows/operation-control-intents/${config.operation_id}.json`;
  const signer = createOperationJournalSigner(() => Buffer.from(config.key, "hex"));
  const artifactJson = name => JSON.parse(artifacts.read(name, { required: true }).content);
  const business = () => shadowHash({ instance: host.inspect(config.instance).record, journal: host.readJournal(config.operation_id),
    artifacts: artifacts.inventory().paths.filter(name => ![auditPath(), controlPath(), "workflows/resource-fences/local-artifacts.json"].includes(name))
      .map(name => ({ path: name, sha256: artifacts.read(name).sha256, metadata_sha256: artifacts.metadataHash(name) })) });
  const witness = () => shadowHash({ business: business(), audit: artifactJson(auditPath()), control: artifactJson(controlPath()), fence: artifacts.resourceFence().read() });
  async function cut(boundary, whileAlive = async () => {}) {
    const worker = fork(here, ["--worker", file, boundary], { windowsHide: true, stdio: ["ignore", "pipe", "pipe", "ipc"] });
    let stderr = "", message, exit;
    worker.stdout.resume(); worker.stderr.on("data", bytes => { stderr = (stderr + bytes).slice(-16384); });
    const ended = new Promise(resolve => worker.once("close", (code, signal) => resolve({ code, signal })));
    try {
      message = await new Promise((resolve, reject) => {
        worker.once("error", reject);
        worker.once("message", row => row.boundary === boundary ? resolve(row) : reject(Error(JSON.stringify(row))));
        worker.once("close", () => reject(Error("WORKER_CLOSED_BEFORE_BOUNDARY:" + stderr)));
      });
      await whileAlive(message);
    } finally {
      if (worker.exitCode === null && worker.signalCode === null) worker.kill();
      exit = await ended;
      save(path.join(evidence, boundary + ".json"), { message: message ?? null, exit, stderr });
    }
    assert.equal(observeLocalProcessOwner(message.identity), "terminated");
    return message;
  }
  try {
    const initial = host.initialize({ instanceId: config.instance });
    host.initialize({ instanceId: config.instance, write: true, expectedResultSha256: initial.record.instance_sha256 });
    const preview = await host.preview({ instanceId: config.instance, expectedSha256: host.inspect(config.instance).record.instance_sha256, occurrenceId: "root" });
    config.operation_id = (await host.stage(preview, { write: true, expectedPreviewSha256: shadowHash(preview) })).operation_id;
    assert.equal((await host.dispatch(config.operation_id, { write: true })).status, "receipted");
    const plan = host.prepareOperationDisposition(config.operation_id, { expectedSha256: host.inspect(config.instance).record.instance_sha256 });
    assert.equal(plan.assessment, "no_effect_original");
    await host.applyOperationDisposition(plan, { write: true, expectedPlanSha256: shadowHash(plan) }); save(file, config);
    await cut("disposition_acceptance_committed", async message => {
      assert.equal(observeLocalProcessOwner(message.identity), "active");
      const calls = [], live = open(config, source(calls)), before = witness();
      assert.equal(live.prepareAcceptedOperationControl(config.instance, { expectedSha256: live.inspect(config.instance).record.instance_sha256 }), null);
      assert.equal((await live.accept(config.operation_id, { write: true })).written, false);
      assert.equal(calls.length, 0); assert.equal(witness(), before);
    });
    const originalBusiness = business(), originalAudit = artifactJson(auditPath()), originalControl = artifactJson(controlPath());
    const accepted = host.inspect(config.instance).record, receipt = host.readJournal(config.operation_id).results.at(-1).receipt;
    assert(accepted.events.some(event => event.kind === "operation_result" && shadowHash(event.receipt) === shadowHash(receipt)));
    const beforePreview = witness(), prepared = host.prepareAcceptedOperationControl(config.instance, { expectedSha256: accepted.instance_sha256 });
    assert.equal(prepared.receipt_sha256, shadowHash(receipt)); assert.equal(witness(), beforePreview);
    const denied = open(config, source([], true));
    await assert.rejects(denied.accept(config.operation_id, { write: true }), { code: "PROCESS_DISPOSITION_AUTHORIZATION_REQUIRED" });
    assert.equal(witness(), beforePreview);
    const aborted = new AbortController(); aborted.abort();
    await assert.rejects(host.accept(config.operation_id, { write: true, signal: aborted.signal }), { code: "PROCESS_DISPOSITION_ABORTED" });
    assert.equal(witness(), beforePreview);
    for (const boundary of ["disposition_acceptance_retirement_reserved", "disposition_acceptance_retirement_admitted"]) {
      await cut(boundary); assert.equal(business(), originalBusiness);
      assert.equal(artifacts.resourceFence().read().record.state, "held");
      signer.verify(artifactJson(auditPath())); signer.verify(artifactJson(controlPath()));
    }
    // Exercise the existing action parser and protected operator authority. The
    // embedding below supplies only the one-operation fixture and no Native port.
    const compose = (_authorize, dispositionSource) => {
      const operations = open(config, dispositionSource);
      return { inspect: () => operations.inspect(config.instance), previewNative: () => ({ fixture: "no-native-port" }),
        prepareAcceptedOperationControl: input => operations.prepareAcceptedOperationControl(config.instance, input),
        readOperation: id => operations.readJournal(id), acceptOperation: (id, input) => operations.accept(id, input),
        step: async () => ({ kind: "wait", status: "COMPLETED" }) };
    };
    const entry = input => runStandardWorkflowAction({ request: { fixture: "accepted-control" }, configuration,
      parameters: {}, modelSource: { fixture: "one-operation" }, ...input }, { authority, compose });
    const readonly = witness(), action = await entry({});
    assert.equal(action.preview.kind, "operation_disposition_accept"); assert.deepEqual(action.preview.payload, prepared);
    assert.equal(witness(), readonly);
    const result = await entry({ preparedAction: action.preview, execute: true, expectPlan: action.action_sha256 });
    assert.equal(result.written, true); assert.equal(result.result.details.accepted.control_retired, true);
    assert.equal(business(), originalBusiness); assert.equal(artifacts.resourceFence().read().record.state, "released");
    const audit = artifactJson(auditPath()), control = artifactJson(controlPath()); signer.verify(audit); signer.verify(control);
    assert.deepEqual(audit.acceptance_reservations, originalAudit.acceptance_reservations);
    assert.deepEqual(audit.admissions.slice(0, originalAudit.admissions.length), originalAudit.admissions);
    assert.deepEqual(control.attempts.slice(0, originalControl.attempts.length), originalControl.attempts);
    assert.equal(audit.admissions.at(-1).grant.grant.authority_id, "standard_local_operator");
    const calls = [], duplicate = open(config, source(calls)), done = witness();
    assert.equal((await duplicate.accept(config.operation_id, { write: true })).written, false);
    assert.equal(calls.length, 0); assert.equal(witness(), done);
    await assert.rejects(entry({ preparedAction: action.preview, execute: true, expectPlan: action.action_sha256 }), { code: "STANDARD_ENTRY_ACTION_CHANGED" });
    assert.equal(witness(), done);
    console.log(JSON.stringify({ status: "PASS", mode, scope: "one-operation actual host/entry/protected authority and real child cuts",
      live_owner_retained: true, current_denial_and_abort_no_writes: true, retirement_reservation_and_admission_crashes_recovered: true,
      business_journal_events_unchanged: true, exact_original_lease_released: true, duplicate_no_grant_no_write: true,
      ordinary_written_control_only: true, full_standard: "NOT_RUN", native: "NOT_RUN", evidence }));
  } finally { save(path.join(evidence, "arenas.json"), { mode, owned }); }
}
