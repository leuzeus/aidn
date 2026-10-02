import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { readPackageTarball } from "../lib/release-package-tar.mjs";

function snapshot(root) {
  const hash = crypto.createHash("sha256");
  function visit(folder, prefix = "") {
    for (const name of fs.readdirSync(folder).sort()) {
      const file = path.join(folder, name), relative = prefix + name;
      hash.update(relative + "\0");
      if (fs.statSync(file).isDirectory()) visit(file, relative + "/");
      else hash.update(fs.readFileSync(file));
    }
  }
  visit(root); return hash.digest("hex");
}

// Called by the existing release reproducibility gate. All product modules,
// CLI entrypoints and HTTP assets come from its exact built tarball. Targets
// and activation evidence are disposable fixtures, never native qualification.
export async function qualifyWorkflowPackage({ tarball, root, descriptors }) {
  const packageRoot = path.join(root, "package"), target = path.join(root, "client");
  for (const [relative, bytes] of readPackageTarball(fs.readFileSync(tarball))) {
    const file = path.resolve(packageRoot, relative);
    assert(file.startsWith(packageRoot + path.sep), "package entry escapes extraction root");
    fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, bytes);
  }
  const load = relative => import(pathToFileURL(path.join(packageRoot, relative)).href);
  const { activateWorkflowConsoleFixture } = await load("tools/perf/workflow-console-fixture-lib.mjs");
  const { startWorkflowDashboard } = await load("src/adapters/workflow-console/dashboard-server.mjs");
  const { createWorkflowInstance } = await load("src/core/workflow/workflow-instance.mjs");
  const { readWorkflowProjectAuthority } = await load("src/application/runtime/workflow-instance-composition.mjs");
  const { planAuthorization, applyAuthorization } = await load("src/application/install/project-activation-service.mjs");
  const { compileShadowWorkflow } = await load("src/core/workflow/workflow-shadow-compiler.mjs");
  const version = fs.readFileSync(path.join(packageRoot, "VERSION"), "utf8").trim();
  const packageBefore = snapshot(packageRoot), passed = [];
  const put = (file, value) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(value)); };
  const context = { contract_version: "workflow-shadow-context.v1", authority: "caller_supplied", product_version: version, workflow_version: 7, state_mode: "files" };
  for (const historical of descriptors) {
    const definition = structuredClone(historical); definition.compatibility.product_version = version;
    const result = compileShadowWorkflow(definition, context);
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.deepEqual(compileShadowWorkflow(definition, context), result);
  }
  passed.push("packaged registry compiles both macro descriptors deterministically");
  const cli = (command, args = []) => {
    const result = spawnSync(process.execPath, [path.join(packageRoot, "bin/aidn.mjs"), "runtime", command, "--target", target, "--json", ...args],
      { cwd: root, encoding: "utf8", windowsHide: true, timeout: 30000, maxBuffer: 5 * 1024 * 1024 });
    assert.equal(result.error, undefined, result.error?.message);
    // Refused actions use a nonzero CLI exit; the contracted envelope is checked below.
    assert([0, 1].includes(result.status), result.stderr);
    const output = JSON.parse(result.stdout);
    assert.equal(result.status, output.errors.length ? 1 : 0, result.stderr);
    return output;
  };
  fs.mkdirSync(target); const empty = snapshot(target);
  assert(cli("workflow-inspect").view.admission.blockers.includes("WORKFLOW_INSTANCE_ACTIVATION_REQUIRED"));
  assert.equal(cli("workflow-dashboard").listening, false);
  assert.equal(snapshot(target), empty);
  passed.push("packaged CLI inspection and dashboard preview preserve an uninstalled target");

  activateWorkflowConsoleFixture(target, path.join(root, "neutral-install-evidence"));
  const original = descriptors.find(item => item.workflow_id === "diagnostic-correction");
  assert(original, "alternate macro fixture required");
  const definition = { ...structuredClone(original), workflow_id: "release-qualification", entry: "approval",
    steps: original.steps.filter(step => step.id !== "diagnose"), transitions: original.transitions.filter(edge => edge.from !== "diagnose") };
  definition.compatibility = { ...definition.compatibility, product_version: version };
  const evidence = [{ ref: "fixture-human-review", sha256: "b".repeat(64) }];
  let server = await startWorkflowDashboard({ targetRoot: target });
  const api = async (route, body, extraHeaders = {}) => {
    const response = await fetch(server.url + "/api/" + route, { method: "POST", headers: { Origin: server.url,
      "Content-Type": "application/json", Authorization: "Bearer " + server.token, ...extraHeaders }, body: JSON.stringify(body) });
    return response;
  };
  const action = async (request, flags = {}) => (await api("action", { request, ...flags })).json();
  const requestFile = path.join(root, "request.json");
  const preview = async request => {
    put(requestFile, request); const before = snapshot(target);
    const result = cli("workflow-action", ["--request", requestFile]);
    assert.deepEqual(await action(request), result); assert.equal(snapshot(target), before);
    assert.deepEqual(result.errors, []); return result;
  };
  const apply = async request => {
    const planned = await preview(request); assert.equal(planned.can_apply, true);
    const result = await action(request, { write: true, expectPlan: planned.action_sha256 });
    assert.deepEqual(result.errors, []); assert.equal(result.written, true); return result.result;
  };
  try {
    for (const asset of ["/", "/dashboard.js", "/dashboard.css"]) assert.equal((await fetch(server.url + asset)).status, 200);
    assert.equal((await api("inspect", {}, { Authorization: "" })).status, 403);
    assert.equal((await api("inspect", {}, { Origin: "https://foreign.invalid" })).status, 403);
    const request = { operation: "initialize", input: { instanceId: "initial", definition, context } };
    const planned = await preview(request), before = snapshot(target);
    const stale = await action(request, { write: true, expectPlan: "0".repeat(64) });
    assert(stale.errors.includes("WORKFLOW_CONSOLE_PREVIEW_CHANGED")); assert.equal(snapshot(target), before);
    const created = await action(request, { write: true, expectPlan: planned.action_sha256 });
    assert.deepEqual(created.errors, []); assert.equal(created.written, true);
    const initial = created.result.instance;
    const decision = { operation: "decide", input: { instanceId: "initial", expectedSha256: initial.instance_sha256, outcome: "rejected", evidence } };
    const terminal = await apply(decision); assert.equal(terminal.cursor.terminal_result, "stopped");
    const retained = snapshot(target);
    const replay = cli("workflow-action", ["--request", requestFile]);
    assert(replay.errors.includes("WORKFLOW_INSTANCE_REVISION_CONFLICT")); assert.equal(snapshot(target), retained);
    passed.push("CLI and HTTP agree on pure previews; stale approval and checkpoint replay refuse");

    const candidate = structuredClone(definition); candidate.revision++;
    candidate.transitions.find(edge => edge.max_traversals).max_traversals = 1;
    const proposal = { operation: "propose", input: { baseInstanceId: "initial", definition: candidate, explanation: "Bounded release fixture candidate." } };
    const proposed = await preview(proposal); assert.equal(proposed.can_apply, false);
    assert.equal(proposed.action.preview.activation_eligible, true);
    const reviewHash = proposed.action.preview.preview_sha256;
    const selected = await apply({ operation: "activate", input: { ...proposal.input, expectedPreviewSha256: reviewHash,
      review: { decision: "approve", preview_sha256: reviewHash, evidence } } });
    const future = { operation: "initialize-selected", input: { workflowId: definition.workflow_id, instanceId: "future", expectedSelectionSha256: selected.selection.selection_sha256 } };
    const initialized = await apply(future);
    assert.equal(initialized.instance.definition.revision, candidate.revision);
    assert.equal(cli("workflow-inspect").view.instances.find(row => row.instance_id === "initial").definition.revision, definition.revision);
    server.close(); server = await startWorkflowDashboard({ targetRoot: target });
    const restarted = snapshot(target);
    const inspection = cli("workflow-inspect"); assert.deepEqual(await (await api("inspect", {})).json(), inspection);
    assert.equal(inspection.view.selections[0].definitions.length, 2); assert.equal(snapshot(target), restarted);
    passed.push("reviewed selection initializes only future instances and survives CLI/HTTP reopen");

    // Seed a genuine historical envelope using the packaged pure constructor;
    // do not rewrite its version, hashes or events to make it current.
    const historical = structuredClone(definition); historical.compatibility.product_version = original.compatibility.product_version;
    assert.notEqual(historical.compatibility.product_version, version);
    const old = createWorkflowInstance({ instanceId: "historical", definition: historical,
      context: { ...context, product_version: historical.compatibility.product_version }, scope: readWorkflowProjectAuthority({ targetRoot: target }).scope });
    put(path.join(target, "docs/audit/workflows/instances/historical.json"), old);
    const historicalBefore = snapshot(target);
    const view = cli("workflow-inspect").view.instances.find(row => row.instance_id === "historical");
    assert(view.blockers.includes("WORKFLOW_INSTANCE_AUTHORITY_CHANGED"));
    put(requestFile, { operation: "decide", input: { instanceId: "historical", expectedSha256: old.instance_sha256, outcome: "rejected", evidence } });
    const refused = cli("workflow-action", ["--request", requestFile, "--write", "--expect-plan", "0".repeat(64)]);
    assert(refused.errors.includes("WORKFLOW_INSTANCE_CONTEXT_CHANGED")); assert.equal(snapshot(target), historicalBefore);
    passed.push("historical product-version instance remains readable and refuses productive writes without migration");

    const next = { operation: "initialize", input: { ...request.input, instanceId: "revoked" } };
    const authorized = await preview(next);
    applyAuthorization(planAuthorization({ targetRoot: target, action: "revoke" }));
    const revoked = snapshot(target), denied = await action(next, { write: true, expectPlan: authorized.action_sha256 });
    assert(denied.errors.includes("WORKFLOW_INSTANCE_ACTIVATION_REQUIRED")); assert.equal(snapshot(target), revoked);
    assert.equal(snapshot(packageRoot), packageBefore);
    passed.push("revoked authority invalidates approval; extracted package remains unchanged");
  } finally { server.close(); }
  return { status: "PASS", proof_class: "built-package-disposable-fixtures", version, checks: passed,
    native_codex: "SKIP", external_client: "SKIP", postgres: "SKIP" };
}
