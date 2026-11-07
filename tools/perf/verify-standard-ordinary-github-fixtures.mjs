import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { createFreshStandardWorkflowFixture } from "./standard-workflow-fixture-lib.mjs";
import { verifyGithubReviewEventComponent } from "./standard-github-review-event-fixture-lib.mjs";
import { runProjectWorkflow } from "../../src/application/runtime/workflow-run-service.mjs";
import { createStandardHostAuthority } from "../../src/adapters/runtime/standard-host-authority.mjs";
import { createStandardWorkflowOperationHost } from "../../src/application/runtime/standard-workflow-operation-host.mjs";
import { CODEX_STARTUP_ENVIRONMENT_PROFILES } from "../../src/core/agents/codex-startup-arguments.mjs";
import { shadowHash } from "../../src/core/workflow/shadow-json.mjs";

const base = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "aidn-ordinary-github-"));
const target = createFreshStandardWorkflowFixture("files");
const dirs = Object.fromEntries(["control", "review", "native", "host"].map(name => {
  const dir = path.join(base, name);
  fs.mkdirSync(dir);
  return [name, dir];
}));
const product = path.join(target, "product");
fs.mkdirSync(product);
fs.writeFileSync(path.join(product, "app.mjs"), "export const value = 1;\n");
const criteria = path.join(base, "criteria.md");
fs.writeFileSync(criteria, "Verify the private STANDARD provider host.\n");
const pin = file => ({ path: file, sha256: createHash("sha256").update(fs.readFileSync(file)).digest("hex") });
const request = { contract_version: "standard-workflow-execution.v1", execution: {
  instance_id: "ordinary-github", target_root: target, product_root: product, control_root: dirs.control, review_root: dirs.review,
  product_files: ["app.mjs"], criteria: pin(criteria), authorities: { project: pin(path.join(target, "AGENTS.md")) }, instructions: {}, controller: {},
  native: { executable: process.execPath, sha256: pin(process.execPath).sha256, home: dirs.native, tool_roots: [], protected_roots: [dirs.host],
    hook_hashes: { work: ["sha256:" + "a".repeat(64), "sha256:" + "b".repeat(64)], review: [] }, model: "fixture-no-native", effort: "medium",
    startup: { mcp_server_ids: [], plugin_ids: [], app_ids: [], environment_override_names: [], environment_names: [...CODEX_STARTUP_ENVIRONMENT_PROFILES.worker],
      log_dir: dirs.control, sqlite_home: dirs.control } },
}, parameters: { session: { session_id: "S001", session_branch: "S001-provider", objective: "Qualify provider composition" },
  cycle: { cycle_id: "C001", cycle_type: "FEATURE", title: "Unused", objective: "No cycle executed" } } };
const configuration = path.join(base, "request.json");
const putRequest = value => fs.writeFileSync(configuration, JSON.stringify(value));
putRequest(request);
const identity = shadowHash({ target: process.platform === "win32" ? target.toLowerCase() : target, instance: request.execution.instance_id });
const manifest = path.join(dirs.host, identity + ".github.json");
const profile = path.join(dirs.host, identity + ".github");
fs.mkdirSync(profile);
const gitBinary = fs.realpathSync(execFileSync(process.platform === "win32" ? "where.exe" : "which", ["git"],
  { encoding: "utf8", windowsHide: true }).split(/\r?\n/).find(Boolean));
const git = (...args) => execFileSync(gitBinary, ["-C", target, ...args], { windowsHide: true, stdio: "pipe" });
const origin = "https://github.com/fixture/repository.git";
git("config", "remote.origin.url", origin);
const binding = { contract_version: "standard-host-github.v1", instance_id: request.execution.instance_id, target_root: target,
  repository: { host: "github.com", owner: "fixture", name: "repository", node_id: "R_fixture" },
  actor: { login: "fixture-actor", node_id: "U_fixture" }, git: pin(gitBinary), gh: pin(fs.realpathSync(process.execPath)) };
const put = value => fs.writeFileSync(manifest, JSON.stringify(value));

process.env.AIDN_STANDARD_HOST_HOME = dirs.host;
process.env.GH_TOKEN = "untrusted-ambient-fixture-token";
const calls = [], token = "offline-fixture-credential";
let wrongActor = false, mutate = false;
const head = "1".repeat(40), tip = "2".repeat(40);
const output = value => ({ status: 0, stdout: typeof value === "string" ? value : JSON.stringify(value) });
const providerTransport = {
  runGithub() { assert.fail("unexpected synchronous GitHub transport"); },
  runRemoteGit() { assert.fail("unexpected remote Git transport"); },
  async runGithubRead(binary, args, options) {
    assert.equal(binary, binding.gh.path);
    assert.equal(options.cwd, dirs.host);
    assert.equal(options.env.GH_CONFIG_DIR, profile);
    assert.equal(options.shell, false);
    calls.push(args);
    if (args[0] === "auth") {
      assert.deepEqual(args, ["auth", "token", "--hostname", "github.com"]);
      assert.equal(options.env.GH_TOKEN, undefined);
      return output(token);
    }
    assert.equal(options.env.GH_TOKEN, token);
    if (args[1] === "graphql") {
      assert.deepEqual(args, ["api", "graphql", "--hostname", "github.com", "--input", "-"]);
      const query = JSON.parse(options.input);
      assert.match(query.query, /^query AidnPrMerge/);
      assert.deepEqual(query.variables, { owner: "fixture", name: "repository", number: 7 });
      return output({ data: { repository: { id: "R_fixture", nameWithOwner: "fixture/repository",
        pullRequest: { id: "PR_fixture", number: 7, headRefOid: head, headRefName: "topic", baseRefName: "dev",
          headRepository: { id: "R_fixture" }, isDraft: false, state: "OPEN", merged: false, mergedAt: null,
          mergeCommit: null, baseRef: { target: { oid: tip } } } } } });
    }
    assert.deepEqual(args.slice(0, -1), ["api", "--hostname", "github.com", "--method", "GET"]);
    if (args.at(-1) === "user") {
      if (mutate) put({ ...binding, actor: { ...binding.actor, login: "substituted" } });
      return output({ login: binding.actor.login, node_id: wrongActor ? "U_wrong" : binding.actor.node_id });
    }
    assert.equal(args.at(-1), "repos/fixture/repository");
    return output({ full_name: "fixture/repository", node_id: "R_fixture" });
  },
};
const run = extra => runProjectWorkflow({ targetRoot: target, configuration, ...extra }, { providerTransport });
const apply = preview => run({ preparedAction: preview.preview, execute: true, expectPlan: preview.action_sha256 });
const reviewer = { login: "fixture-reviewer[bot]", node_id: "BOT_fixture", type: "Bot" };
if (!process.argv.includes("--review-event-only")) {
const unconfigured = await run();
assert.deepEqual(unconfigured.errors, []);
assert.equal(unconfigured.preview.kind, "prepare_host");
assert.equal(calls.length, 0);
put(binding);
const prepare = await run();
assert.deepEqual(prepare.errors, []);
assert.notEqual(prepare.preview.context.trust_sha256, unconfigured.preview.context.trust_sha256);
assert.deepEqual((await apply(unconfigured)).errors, ["STANDARD_ENTRY_PRECONDITIONS_CHANGED"]);
assert.equal((await apply(prepare)).result.details.status, "HOST_READY");
assert.equal(calls.length, 0);
console.log("PASS ordinary entry selects only the protected per-project/instance configuration and binds it into the exact action");

const initialize = await run();
assert.equal(initialize.preview.kind, "initialize");
wrongActor = true;
const rejected = await apply(initialize);
assert.deepEqual(rejected.errors, ["STANDARD_GITHUB_IDENTITY_CHANGED"]);
assert.equal(rejected.written, false);
assert.equal(calls.length, 2);
wrongActor = false;
mutate = true;
assert.deepEqual((await apply(initialize)).errors, ["STANDARD_GITHUB_HOST_CONFIGURATION_CHANGED"]);
assert.equal((await run()).preview.kind, "initialize");
mutate = false;
put(binding);
const initialized = await apply(initialize);
assert.deepEqual(initialized.errors, []);
assert.equal(initialized.written, true);
assert.deepEqual(calls.slice(-3).map(args => args.at(-1)), ["github.com", "user", "repos/fixture/repository"]);
assert.ok(!JSON.stringify(initialized).includes(token));
console.log("PASS ordinary exact initialize reads the pinned GitHub actor and repository, refuses identity/configuration substitution before the instance write");

const previous = calls.length;
git("config", "--add", "remote.origin.url", origin);
assert.deepEqual((await run()).errors, ["STANDARD_GITHUB_REPOSITORY_BINDING_INVALID"]);
git("config", "--replace-all", "remote.origin.url", origin);
put({ ...binding, instance_id: "other" });
assert.deepEqual((await run()).errors, ["STANDARD_GITHUB_HOST_CONFIGURATION_INVALID"]);
put({ ...binding, gh: { ...binding.gh, sha256: "0".repeat(64) } });
assert.deepEqual((await run()).errors, ["STANDARD_GITHUB_EXECUTABLE_PIN_CHANGED"]);
putRequest({ ...request, execution: { ...request.execution, sessionReviewPort: { provider: "github" } } });
assert.deepEqual((await run()).errors, ["STANDARD_ENTRY_CONFIGURATION_INVALID"]);
putRequest(request);
for (const observation of ["replay", "simulate"]) {
  const observed = await run({ observation });
  assert.deepEqual(observed.errors, []);
  assert.equal(observed.written, false);
  assert.equal(observed.result.evidence_kind, "synthetic");
}
assert.equal(calls.length, previous);
console.log("PASS ordinary entry refuses ambiguous origin, foreign instance, changed binary and request port override; replay and SIM are offline even with an invalid provider pin");

put(binding);
const host = createStandardHostAuthority({ configuration: request.execution }, { providerTransport });
const merged = await host.githubProvider.sessionReviewPort.observePrMerge({ contract_version: "github-pr-observation-request.v2", pull_request_number: 7,
  expected_pull_request_id: "PR_fixture", expected_head_oid: head, expected_base_oid: tip, expected_head_ref: "topic", expected_base_ref: "dev" });
assert.equal(merged.pull_request.state, "OPEN");
assert.equal(merged.repository.node_id, "R_fixture");
assert.equal(host.controlSource.readReview, undefined);
assert.equal(host.githubProvider.sessionReviewEventPort, undefined);
console.log("PASS host composes the real read-only merge protocol independently of event authentication");

const beforeEffects = calls.length;
await assert.rejects(host.githubProvider.sessionPushPort.push({}, { write: true }), { code: "GITHUB_PUSH_EXPLICIT_WRITE_REQUIRED" });
await assert.rejects(host.githubProvider.sessionPullRequestPort.apply({}, { write: true }), { code: "GITHUB_PR_OPEN_EXPLICIT_EFFECT_REQUIRED" });
assert.equal(calls.length, beforeEffects);
console.log("PASS the composed effect ports still refuse missing grants and plans before transport");

for (const wait of ["session_pr_review_wait", "correction_pr_review_wait"]) {
  const model = { contract_version: "agentic-process-model.v2", model_id: "review-wait-fixture", revision: 1,
    participants: [{ id: "project" }], roles: [], policies: [], operation_pins: {}, entry: wait, nodes: [
      { id: wait, kind: "event", participant_ref: "project", branches: [
        { flow_id: "review", node_id: "reviewed", event_key: "review_snapshot" },
        { flow_id: "checks", node_id: "checked", event_key: "checks_snapshot" },
      ] },
      ...["reviewed", "checked"].map(id => ({ id, kind: "sequence", participant_ref: "project", children: [] })),
    ] };
  const operations = createStandardWorkflowOperationHost({ targetRoot: target, model, readSigningKey: host.readKey,
    authorize: host.authorizeOperation, controlSource: host.controlSource, sessionReviewPort: host.githubProvider.sessionReviewPort });
  const instanceId = wait.replaceAll("_", "-"), initial = operations.initialize({ instanceId });
  const persisted = operations.initialize({ instanceId, write: true, expectedResultSha256: initial.record.instance_sha256 });
  const input = { instanceId, expectedSha256: persisted.record.instance_sha256, occurrenceId: persisted.cursor.occurrences[0].occurrence_id,
    sourceRef: "absent", write: true };
  await assert.rejects(operations.captureControl(input), { code: "PROCESS_CONTROL_PR_EVENT_SOURCE_REQUIRED" });
  await assert.rejects(operations.captureControl({ ...input, captureKind: "claim" }), { code: "PROCESS_CONTROL_CAPTURE_KIND_INVALID" });
  assert.equal(operations.inspect(instanceId).record.instance_sha256, persisted.record.instance_sha256);
}
console.log("PASS both PR review waits refuse generic control and remain durable without an event source");
put({ ...binding, reviewer });
const configured = await run();
assert.deepEqual(configured.errors, []);
assert.notEqual(configured.preview.context.trust_sha256, prepare.preview.context.trust_sha256);
assert.ok(createStandardHostAuthority({ configuration: request.execution }, { providerTransport }).githubProvider.sessionReviewEventPort);
console.log("PASS the ordinary entry binds explicit Bot reviewer configuration into its exact host trust");
}

const componentConfiguration = { ...request.execution, instance_id: "ordinary-review-event" };
const componentBinary = path.join(dirs.host, "gh-review-transport.fixture");
fs.writeFileSync(componentBinary, "Pinned subprocess transport fixture\n");
const componentBinding = { ...binding, instance_id: componentConfiguration.instance_id, reviewer, gh: pin(componentBinary) };
const componentIdentity = shadowHash({ target: process.platform === "win32" ? target.toLowerCase() : target, instance: componentBinding.instance_id });
fs.mkdirSync(path.join(dirs.host, componentIdentity + ".github"));
fs.writeFileSync(path.join(dirs.host, componentIdentity + ".github.json"), JSON.stringify(componentBinding));
await verifyGithubReviewEventComponent({ base, configuration: componentConfiguration, binding: componentBinding, git });
console.log(JSON.stringify({ status: "PASS", base, target, real_github: "NOT_RUN", actual_pr_lifecycle: "NOT_RUN",
  published_review_wait_delivery: "NOT_RUN", native: "NOT_RUN", complete_standard_workflow: false }));
