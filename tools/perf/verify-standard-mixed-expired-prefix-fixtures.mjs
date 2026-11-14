import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash, randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createFreshStandardWorkflowFixture } from "./standard-workflow-fixture-lib.mjs";
import { createStandardWorkflowExecution, loadStandardWorkflowAssets } from "../../src/application/runtime/standard-workflow-composition.mjs";
import { agenticProcessImplementationPins } from "../../src/application/runtime/agentic-process-implementation-pins.mjs";
import { CODEX_STARTUP_ENVIRONMENT_PROFILES } from "../../src/core/agents/codex-startup-arguments.mjs";
import { createStandardWorkflowArtifacts } from "../../src/application/runtime/standard-workflow-artifacts.mjs";
import { parseSessionMetadata } from "../../src/lib/workflow/session-context-lib.mjs";
import { simulateAgenticProcess } from "../../src/core/workflow/agentic-process-simulation.mjs";
import { shadowHash } from "../../src/core/workflow/shadow-json.mjs";

const here = fileURLToPath(import.meta.url), temporary = fs.realpathSync(os.tmpdir());
const source = new URL("../../", import.meta.url), H = "a".repeat(64);
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const actualNow = Date.now;
let clockFile = null;
// Test-process wall clock only. Production mixed composition keeps its clock,
// TTLs and native budgets. Every child selects this same retained fixture clock.
Date.now = () => clockFile === null ? actualNow() : JSON.parse(fs.readFileSync(clockFile, "utf8"));
const git = (root, ...args) => execFileSync("git", ["-C", root, ...args],
  { encoding: "utf8", stdio: "pipe", windowsHide: true, env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" } }).trim();

function snapshot(root) {
  const rows = [];
  function walk(directory) {
    for (const name of fs.readdirSync(directory).sort()) {
      const file = path.join(directory, name), stat = fs.lstatSync(file), relative = path.relative(root, file).replaceAll("\\", "/");
      if (stat.isSymbolicLink()) rows.push([relative, "link", fs.readlinkSync(file)]);
      else if (stat.isDirectory()) { rows.push([relative, "directory"]); walk(file); }
      else rows.push([relative, "file", hash(fs.readFileSync(file))]);
    }
  }
  walk(root); return rows;
}

function configuration(target, privateRoot, assets) {
  const put = (name, bytes) => {
    const file = path.join(privateRoot, name); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, bytes);
    return { path: file, sha256: hash(bytes) };
  };
  const dirs = Object.fromEntries(["product", "control", "review", "home"].map(name => [name, name === "product" ? path.join(target, name) : path.join(privateRoot, name)]));
  for (const directory of Object.values(dirs)) fs.mkdirSync(directory);
  fs.writeFileSync(path.join(dirs.product, "app.mjs"), "export const value = 1;\n");
  git(target, "add", "product/app.mjs"); git(target, "-c", "core.hooksPath=NUL", "commit", "-m", "fixture product");
  const skillPaths = [...new Set(assets.catalog.activities.flatMap(row => row.skill_sources.map(row => row.path)))];
  return { contract_version: "agentic-process-execution.v1", instance_id: "mixed-expired-prefix", target_root: target,
    implementation_sha256: agenticProcessImplementationPins().sha256,
    product_root: dirs.product, control_root: dirs.control, review_root: dirs.review, product_files: ["app.mjs"],
    model: put("model.json", JSON.stringify(assets.model)), criteria: put("criteria.md", "THINKING prefix must preserve the product.\n"),
    authorities: { project: { path: path.join(target, "AGENTS.md"), sha256: hash(fs.readFileSync(path.join(target, "AGENTS.md"))) } },
    skills: Object.fromEntries(skillPaths.map(name => [name.match(/aidn-([^/]+)\/SKILL[.]md$/)[1], put(name, fs.readFileSync(new URL(name, source)))])),
    instructions: Object.fromEntries(assets.catalog.activities.map(row => [row.node_id, "Return only the scoped typed report; no native activity is entered in this prefix."])),
    activity_outputs: Object.fromEntries(assets.catalog.activities.map(row => [row.node_id, row.output_contract])),
    native: { executable: process.execPath, sha256: hash(fs.readFileSync(process.execPath)), home: dirs.home, tool_roots: [],
      hook_hashes: { work: ["sha256:" + H, "sha256:" + "b".repeat(64)], review: [] }, model: "fixture-model", effort: "medium",
      startup: { mcp_server_ids: [], plugin_ids: [], app_ids: [], environment_override_names: [], environment_names: [...CODEX_STARTUP_ENVIRONMENT_PROFILES.worker],
        log_dir: dirs.control, sqlite_home: dirs.control } } };
}

function host(privateRoot, counters) {
  clockFile = path.join(privateRoot, "clock.json");
  const readClaim = () => JSON.parse(fs.readFileSync(path.join(privateRoot, "claim.json"), "utf8"));
  return createStandardWorkflowExecution({ configuration: JSON.parse(fs.readFileSync(path.join(privateRoot, "configuration.json"), "utf8")),
    readSigningKey: () => fs.readFileSync(path.join(privateRoot, "host.key")),
    authorize: async request => {
      counters.grants++;
      return { authorized: true, authority_id: "fixture_operator", principal_sha256: H, grant_sha256: request.preview_sha256 };
    },
    humanSource: { read: readClaim, verify: ({ source, question }) => {
      const actual = readClaim();
      return actual && shadowHash(actual) === shadowHash(source) && source.question_sha256 === shadowHash(question)
        ? { outcome: "verified", authority_id: source.authority_id, source_sha256: shadowHash(source) } : { outcome: "unverified" };
    } } }, { controllerFactory: () => { counters.native++; throw Error("MIXED_PREFIX_NATIVE_FORBIDDEN"); } });
}

if (process.argv[2] === "--prepare") {
  const [, , , privateRoot, operationId, expectedSha256] = process.argv, counters = { grants: 0, native: 0 };
  const runtime = host(privateRoot, counters), preview = await runtime.reprepareExpiredOperation(operationId, { expectedSha256 });
  assert.deepEqual(counters, { grants: 0, native: 0 }); assert.equal(runtime.inspectAllocations(), null);
  console.log(JSON.stringify({ preview, counters, allocations: null }));
} else {
  const mode = process.argv.find(value => value.startsWith("--mode="))?.slice(7) ?? "files";
  if (!["files", "dual", "db-only"].includes(mode)) throw Error("MIXED_PREFIX_MODE_INVALID");
  const expiredBindings = (process.argv.find(value => value.startsWith("--expire-bindings="))?.slice("--expire-bindings=".length)
    ?? "session_initialize").split(",");
  if (!expiredBindings.length || new Set(expiredBindings).size !== expiredBindings.length
    || expiredBindings.some(id => !["session_initialize", "session_mode_apply", "session_start_finalize"].includes(id)))
    throw Error("MIXED_PREFIX_EXPIRED_BINDINGS_INVALID");
  const owned = [], assets = loadStandardWorkflowAssets(), counters = { grants: 0, native: 0 };
  let checks = 0, success = false;
  const pass = message => { checks++; console.log(`PASS mixed expired ${mode}: ${message}`); };
  try {
    const target = createFreshStandardWorkflowFixture(mode, owned), privateRoot = fs.mkdtempSync(path.join(temporary, "aidn-standard-mixed-expired-")); owned.push(privateRoot);
    fs.writeFileSync(path.join(privateRoot, "host.key"), randomBytes(32)); fs.writeFileSync(path.join(privateRoot, "claim.json"), "null");
    fs.writeFileSync(path.join(privateRoot, "clock.json"), JSON.stringify(actualNow()));
    const config = configuration(target, privateRoot, assets);
    fs.writeFileSync(path.join(privateRoot, "configuration.json"), JSON.stringify(config));
    let runtime = host(privateRoot, counters);
    const parameters = { session: { session_id: "S001", session_branch: "S001-start", objective: "Explicit mixed-host expiry continuation" },
      cycle: { cycle_id: "C001", cycle_type: "FEATURE", title: "Deferred cycle", objective: "Not entered in THINKING" } };
    const initial = runtime.initialize({ parameters }); runtime.initialize({ parameters, write: true, expectedResultSha256: initial.record.instance_sha256 });
    const originals = [], product = fs.readFileSync(path.join(target, "product/app.mjs"));
    let deferred = false;
    for (let index = 0; index < 7; index++) {
      runtime = host(privateRoot, counters);
      const beforePreview = snapshot(target), grantsBefore = counters.grants;
      const selection = await runtime.step();
      assert.equal(selection.kind, "operation_preview"); assert.equal(selection.written, false);
      assert.deepEqual(snapshot(target), beforePreview); assert.equal(counters.grants, grantsBefore);
      let preview = selection.preview;
      assert.ok(preview.input_resolution, "published data bindings must resolve the actual input");
      assert.equal(preview.prepared?.can_apply ?? true, true, JSON.stringify(preview.prepared));
      let staged = await runtime.stageOperation(preview, { write: true, expectedPreviewSha256: shadowHash(preview) });
      const id = staged.operation_id;
      if (expiredBindings.includes(preview.binding.id)) {
        const business = createStandardWorkflowArtifacts({ targetRoot: target });
        // Some fixed operations invoke a hook instead of carrying a CAS list.
        // Observe canonical business artifacts, excluding only host journals,
        // which the expired dispatch must legitimately append to.
        const businessState = () => business.inventory().paths.filter(name => !name.startsWith("workflows/"))
          .map(name => ({ artifact: business.read(name), metadata_sha256: business.metadataHash(name) }));
        const before = businessState(), head = git(target, "rev-parse", "HEAD");
        // FILES has no canonical SQLite journal writes to exclude. Include all
        // hidden runtime files/directories, since the start hook can write there.
        // DB modes keep their separate logical-artifact proof, not this claim.
        const runtimeBefore = mode === "files" ? snapshot(path.join(target, ".aidn/runtime")) : null;
        fs.writeFileSync(clockFile, JSON.stringify(preview.prepared.plan.prepared_at_ms + 300001));
        const refused = await runtime.step({ write: true });
        const original = runtime.readOperation(id), refusedState = runtime.inspect();
        assert.equal(refused.kind, "operation"); assert.equal(refused.status, "WAITING");
        assert.equal(original.results.at(-1).receipt.outcome, "blocked"); assert.equal(original.results.at(-1).receipt.effect_status, "no_effect");
        assert.equal(original.results.at(-1).output.observations.reason_code, "STANDARD_PLAN_EXPIRED");
        assert.deepEqual(businessState(), before);
        if (mode === "files") assert.deepEqual(snapshot(path.join(target, ".aidn/runtime")), runtimeBefore,
          "expired dispatch must preserve every hidden runtime file and directory");
        assert.equal(git(target, "rev-parse", "HEAD"), head); assert.equal(business.ownerPending(), false);
        pass("actual mixed.step accepts expired dispatch as WAITING/no_effect; canonical business artifacts are unchanged"
          + (mode === "files" ? " and every hidden runtime byte/directory is unchanged" : "; physical DB/runtime bytes are not qualified"));

        const waitingBytes = snapshot(target), grantsAtWait = counters.grants;
        for (const write of [false, true]) {
          const wait = await host(privateRoot, counters).step({ write });
          assert.deepEqual(wait, { kind: "operation_reprepare_required", status: "WAITING", written: false, operation_id: id });
          assert.deepEqual(snapshot(target), waitingBytes); assert.equal(counters.grants, grantsAtWait);
        }
        pass("cold mixed.step preview/write both retain explicit reprepare waiting without granting or staging a replacement");
        await assert.rejects(runtime.reprepareExpiredOperation(id, { expectedSha256: initial.record.instance_sha256 }), { code: "PROCESS_REVISION_CONFLICT" });
        await assert.rejects(runtime.reprepareExpiredOperation(id, { expectedSha256: refusedState.record.instance_sha256, input: { session_id: "S999" } }),
          { code: "STANDARD_HOST_REPREPARE_INPUT_INVALID" });
        assert.deepEqual(snapshot(target), waitingBytes);
        pass("stale history and subject substitution refuse through the mixed facade without effects");

        const candidate = JSON.parse(execFileSync(process.execPath, [here, "--prepare", privateRoot, id, refusedState.record.instance_sha256],
          { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 180000, maxBuffer: 2097152, windowsHide: true }));
        preview = candidate.preview;
        assert.deepEqual(candidate.counters, { grants: 0, native: 0 }); assert.equal(candidate.allocations, null);
        assert.deepEqual(snapshot(target), waitingBytes); assert.deepEqual(runtime.readOperation(id), original);
        assert.deepEqual(preview.input, original.preview.input); assert.equal(preview.occurrence_id, original.intent.occurrence_id);
        assert.equal(preview.instance_sha256, refusedState.record.instance_sha256);
        assert.equal(preview.prepared.plan.prepared_at_ms, Date.now()); assert.notEqual(preview.prepared.plan_sha256, original.preview.prepared.plan_sha256);
        pass("fresh Node reauthenticates and prepares the same resolved subject read-only, retaining the original signed grant and refusal");
        staged = await runtime.stageOperation(preview, { write: true, expectedPreviewSha256: shadowHash(preview) });
        // Fresh authorization is required; the internal number of verification
        // calls is not part of the contract. The retained grant is checked below.
        assert.notEqual(staged.operation_id, id); assert.ok(counters.grants > grantsAtWait);
        const replacement = runtime.readOperation(staged.operation_id);
        assert.notDeepEqual(replacement.grant, original.grant); assert.equal(replacement.intent.instance_sha256, refusedState.record.instance_sha256);
        originals.push({ id, binding: original.intent.binding_ref, record: original });
        pass("explicit successor staging obtains a distinct grant/intent bound to the accepted predecessor history");
      }
      let result = await runtime.step({ write: true });
      if (preview.binding.executor_kind === "human") {
        assert.equal(result.status, "waiting_for_human");
        const waiting = snapshot(target);
        assert.equal((await runtime.step()).kind, "human_wait"); assert.deepEqual(snapshot(target), waiting);
        const choice = deferred ? "THINKING" : "deferred";
        fs.writeFileSync(path.join(privateRoot, "claim.json"), JSON.stringify({ contract_version: "human-mode-decision.v1", source_kind: "human",
          authority_id: "fixture_user_channel", source_event_id: `mixed-prefix-${mode}-${choice}`, subject_sha256: H, question_sha256: shadowHash(result.question),
          choice, evidence_refs: [{ ref: "fixture:operator/mode", sha256: H }] }));
        const received = await runtime.receiveDecision(staged.operation_id, { sourceRef: "choice", write: true });
        result = await runtime.acceptOperation(staged.operation_id, { write: true });
        if (!deferred) { assert.equal(received.receipt.outcome, "deferred"); assert.equal(result.cursor.status, "WAITING"); deferred = true; }
        else assert.equal(received.receipt.outcome, "completed");
      } else assert.equal(runtime.readOperation(staged.operation_id).results.at(-1).receipt.outcome, "completed", JSON.stringify(result));
      const accepted = runtime.inspect(), stable = snapshot(target);
      assert.equal((await runtime.dispatchOperation(staged.operation_id, { write: true })).status, "retained_result");
      assert.equal(runtime.inspect().record.instance_sha256, accepted.record.instance_sha256); assert.deepEqual(snapshot(target), stable);
      assert.equal(runtime.inspectAllocations(), null); assert.equal(counters.native, 0);
      pass(`${preview.binding.id}: authenticated acceptance and retained dispatch; no native allocation`);
    }
    const final = runtime.inspect(), finalBytes = snapshot(target);
    assert.equal(final.cursor.status, "COMPLETED"); assert.equal(final.record.model_sha256, assets.source.model_sha256);
    assert.ok(final.cursor.occurrences.some(row => row.node_id === "thinking_handoff"));
    assert.equal(final.cursor.occurrences.some(row => row.node_id === "cycle_create"), false);
    assert.equal(parseSessionMetadata(createStandardWorkflowArtifacts({ targetRoot: target }).read("sessions/S001.md").content).mode, "THINKING");
    assert.deepEqual(fs.readFileSync(path.join(target, "product/app.mjs")), product);
    assert.deepEqual(originals.map(row => row.binding).sort(), [...expiredBindings].sort());
    for (const row of originals) assert.deepEqual(runtime.readOperation(row.id), row.record);
    const simulation = simulateAgenticProcess({ instanceId: final.record.instance_id, model: final.record.model, parameters: final.record.initial_parameters,
      policyPins: final.record.policy_pins, scopeId: final.record.scope_id, events: final.record.events });
    assert.equal(simulation.trace.at(-1).instance_sha256, final.record.instance_sha256); assert.deepEqual(simulation.trace.at(-1).cursor, final.cursor);
    assert.deepEqual(snapshot(target), finalBytes);
    pass("same shipped IR/reducer replay and simulation preserve the refusal, THINKING terminal state and every checkout byte");
    success = true;
    console.log(JSON.stringify({ status: "PASS", checks, state_mode: mode, model_revision: assets.model.revision, model_sha256: assets.source.model_sha256,
      scope: "source-installed-published-mixed-startup-prefix", expired_bindings: expiredBindings,
      expired_dispatch_hidden_runtime: mode === "files" ? "all-bytes-and-directories-unchanged" : "NOT_QUALIFIED",
      clock: "test-process-wall-clock-injection", native_allocations: 0, native_model_calls: counters.native,
      authorization: "fixture-capability", human: "authenticated-fixture-source", native: "NOT_RUN", installed_archive: "NOT_RUN", full_standard_workflow: "NOT_COMPLETE" }));
  } finally {
    clockFile = null;
    if (success && !process.argv.includes("--retain-always")) for (const directory of owned) {
      const real = fs.realpathSync(directory);
      if (path.dirname(real) !== temporary || !path.basename(real).startsWith("aidn-standard-")) throw Error("MIXED_PREFIX_CLEANUP_SCOPE_INVALID");
      fs.rmSync(real, { recursive: true, force: true });
    }
    else console.error(JSON.stringify({ retained_roots: owned, success }));
  }
}
