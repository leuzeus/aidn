import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createFreshStandardWorkflowFixture } from "./standard-workflow-fixture-lib.mjs";
import { CODEX_STARTUP_ENVIRONMENT_PROFILES } from "../../src/core/agents/codex-startup-arguments.mjs";
import { shadowHash } from "../../src/core/workflow/shadow-json.mjs";
import { validateJsonSchema } from "../../src/core/contracts/json-schema-validator.mjs";
import outputSchema from "../../src/core/contracts/cli-output/runtime-workflow-action.v1.schema.json" with { type: "json" };

// Real public console CLI, published model, authority, journal and local ports.
// No Native transport is launchable and no human/provider source is supplied.
export function verifyStandardConsoleEntry() {
  const owned = [], target = createFreshStandardWorkflowFixture("files", owned);
  const base = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "aidn-standard-console-"));
  const dirs = Object.fromEntries(["control", "review", "home", "authority"].map(name => { const p = path.join(base, name); fs.mkdirSync(p); return [name, p]; }));
  const pin = file => ({ path: file, sha256: createHash("sha256").update(fs.readFileSync(file)).digest("hex") });
  const product = path.join(target, "product"); fs.mkdirSync(product); fs.writeFileSync(path.join(product, "app.mjs"), "export const value = 1;\n");
  const criteria = path.join(base, "criteria.md"); fs.writeFileSync(criteria, "Qualify the exact published STANDARD console action.\n");
  const config = path.join(base, "configuration.json"), requestFile = path.join(base, "request.json");
  const configuration = { contract_version: "standard-workflow-execution.v1", execution: { instance_id: "console-standard", target_root: target,
    product_root: product, control_root: dirs.control, review_root: dirs.review, product_files: ["app.mjs"], criteria: pin(criteria),
    authorities: { project: pin(path.join(target, "AGENTS.md")) }, instructions: {}, controller: {},
    native: { executable: process.execPath, sha256: pin(process.execPath).sha256, home: dirs.home, tool_roots: [], protected_roots: [dirs.authority],
      hook_hashes: { work: ["sha256:" + "a".repeat(64), "sha256:" + "b".repeat(64)], review: [] }, model: "fixture-no-native", effort: "medium",
      startup: { mcp_server_ids: [], plugin_ids: [], app_ids: [], environment_override_names: [], environment_names: [...CODEX_STARTUP_ENVIRONMENT_PROFILES.worker],
        log_dir: dirs.control, sqlite_home: dirs.control } } },
    parameters: { session: { session_id: "S001", session_branch: "S001-console", objective: "STANDARD console qualification" },
      cycle: { cycle_id: "C001", cycle_type: "FEATURE", title: "Unused cycle", objective: "No cycle in prefix" } } };
  fs.writeFileSync(config, JSON.stringify(configuration));
  const cli = fileURLToPath(new URL("../../bin/aidn.mjs", import.meta.url));
  const environment = { ...process.env, AIDN_STANDARD_HOST_HOME: dirs.authority };
  let calls = 0;
  const request = { operation: "run", input: { configuration: config } };
  const inventory = () => {
    const rows = [];
    function walk(dir) { for (const name of fs.readdirSync(dir).sort()) { const f = path.join(dir, name), stat = fs.lstatSync(f);
      if (stat.isDirectory()) walk(f); else rows.push([f, pin(f).sha256]); } }
    walk(target); walk(dirs.authority); return shadowHash(rows);
  };
  function run(input, extra = []) {
    fs.writeFileSync(requestFile, JSON.stringify(input)); let bytes; const started = Date.now();
    try { bytes = execFileSync(process.execPath, [cli, "runtime", "workflow-action", "--target", target, "--request", requestFile, "--json", ...extra],
      { env: environment, windowsHide: true, timeout: 180000, maxBuffer: 8388608, stdio: ["ignore", "pipe", "pipe"] }); }
    catch (cause) { if (!cause.stdout?.length) throw cause; bytes = cause.stdout; }
    const result = JSON.parse(bytes); fs.writeFileSync(path.join(base, `call-${++calls}.json`), bytes);
    assert.deepEqual(validateJsonSchema(result, outputSchema), []);
    console.log(JSON.stringify({ console_call: calls, elapsed_ms: Date.now() - started, errors: result.errors }));
    return result;
  }
  const good = result => { assert.deepEqual(result.errors, [], JSON.stringify(result)); return result; };
  const apply = preview => good(run(preview.action.request, ["--execute", "--expect-plan", preview.action_sha256]));
  console.log(JSON.stringify({ proof_class: "offline-public-console-cli-real-standard-ports", target, base }));
  for (const kind of ["prepare_host", "initialize"]) {
    const before = inventory(), preview = good(run(request));
    assert.equal(preview.action.request.input.preparedAction.kind, kind); assert.equal(inventory(), before);
    assert.equal(apply(preview).written, true);
  }
  const before = inventory(), operation = good(run(request));
  const prepared = operation.action.request.input.preparedAction;
  assert.equal(prepared.kind, "operation"); assert.equal(prepared.payload.preview.binding.id, "context_reload");
  assert.equal(good(run(operation.action.request)).action_sha256, operation.action_sha256, "retain the original timed plan across cold CLI invocations");
  assert.equal(inventory(), before);
  assert.deepEqual(run(request, ["--execute", "--expect-plan", operation.action_sha256]).errors, ["WORKFLOW_CONSOLE_STANDARD_PREPARED_ACTION_REQUIRED"]);
  const invalid = structuredClone(operation.action.request); invalid.input.preparedAction.unrecognized_authority = true;
  assert.deepEqual(run(invalid).action.preview.errors, ["STANDARD_ENTRY_ACTION_INVALID"]);
  const changed = structuredClone(operation.action.request); changed.input.preparedAction.payload.preview.prepared_at_ms--;
  const changedPreview = good(run(changed));
  const refused = run(changedPreview.action.request, ["--execute", "--expect-plan", changedPreview.action_sha256]);
  assert.deepEqual(refused.result.errors, ["PROCESS_JOURNAL_NOT_AUTHENTICATED"]);
  assert.equal(refused.written, false);
  assert.equal(inventory(), before);
  const completed = apply(operation);
  assert.equal(completed.result.result.operation_outcome, "completed");
  assert.equal(completed.result.result.effect_status, "no_effect"); assert.equal(completed.result.result.workflow_completed, false);
  const after = inventory();
  const stale = run(operation.action.request);
  assert.deepEqual(stale.action.preview.errors, ["STANDARD_ENTRY_PRECONDITIONS_CHANGED"]);
  assert.equal(inventory(), after, "the accepted operation changes CAS and cannot be applied again");
  const replay = good(run({ operation: "run", input: { configuration: config, observation: "replay" } }));
  const simulation = good(run({ operation: "run", input: { configuration: config, observation: "simulate" } }));
  assert.equal(replay.can_apply, false); assert.equal(simulation.can_apply, false);
  assert.equal(replay.action.preview.result.instance_sha256, simulation.action.preview.result.instance_sha256);
  assert.equal(inventory(), after); assert.equal(fs.readdirSync(dirs.control).length, 0);
  const result = { status: "PASS", proof_class: "offline-public-console-cli-real-standard-ports", mode: "files", calls, target, base,
    completed_operation: "context_reload", same_reducer_replay_simulation: true, native: "NOT_RUN", genuine_human: "NOT_RUN", installed: "NOT_RUN", complete_standard: false };
  console.log(JSON.stringify(result)); return result;
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) verifyStandardConsoleEntry();
