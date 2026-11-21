import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { createWorkflowConsoleService, validateWorkflowConsoleRequest } from "../../src/application/runtime/workflow-console-service.mjs";
import { shadowHash } from "../../src/core/workflow/shadow-json.mjs";

// Isolates the console consent boundary with a changing prepared-plan clock.
// This is not production STANDARD execution or a genuine human authorization.
export async function verifyStandardConsoleExactAction() {
  let sequence = 0, effects = 0, authority = 1;
  const service = createWorkflowConsoleService({ targetIdentity: "a".repeat(64), invokeRun: (input, flags) => {
    const prepared = input.preparedAction ?? { contract_version: "standard-workflow-action.v1", kind: "operation", context: {},
      payload: { preview: { prepared_at: ++sequence } } };
    if (flags.apply) { assert.equal(flags.expectPlan, shadowHash(prepared)); effects++; }
    return { engine: "agentic", preview: prepared, action_sha256: shadowHash(prepared), authority,
      can_apply: true, written: flags.apply, errors: [] };
  } });
  const request = { operation: "run", input: { configuration: "fixture-standard" } };
  const preview = await service.action(request);
  assert.deepEqual(preview.errors, []); assert.equal(effects, 0);
  assert.equal(Object.hasOwn(request.input, "preparedAction"), false, "do not mutate caller input");
  assert.deepEqual(preview.action.request.input.preparedAction, preview.action.preview.preview);
  const pinned = preview.action.request;
  const again = await service.action(pinned); assert.equal(again.action_sha256, preview.action_sha256);
  const absent = await service.action(request, { execute: true, expectPlan: preview.action_sha256 });
  assert.deepEqual(absent.errors, ["WORKFLOW_CONSOLE_STANDARD_PREPARED_ACTION_REQUIRED"]); assert.equal(effects, 0);
  const forged = structuredClone(pinned); forged.input.preparedAction.payload.preview.prepared_at++;
  assert.deepEqual((await service.action(forged, { execute: true, expectPlan: preview.action_sha256 })).errors, ["WORKFLOW_CONSOLE_PREVIEW_CHANGED"]);
  authority++;
  assert.deepEqual((await service.action(pinned, { execute: true, expectPlan: preview.action_sha256 })).errors, ["WORKFLOW_CONSOLE_PREVIEW_CHANGED"]);
  assert.equal(effects, 0); authority--;
  const applied = await service.action(pinned, { execute: true, expectPlan: preview.action_sha256 });
  assert.deepEqual(applied.errors, []); assert.equal(applied.written, true); assert.equal(effects, 1);
  for (const input of [{ command: "agent-run", preparedAction: {} }, { preparedAction: null }, { preparedAction: [] },
    { actionFile: "old.json", preparedAction: {} }]) assert.throws(() => validateWorkflowConsoleRequest({ operation: "run", input }), /REQUEST_INVALID/);

  const elements = new Map(), get = id => {
    if (!elements.has(id)) elements.set(id, { value: "", checked: false, disabled: false, listeners: {}, addEventListener(name, handler) { this.listeners[name] = handler; } });
    return elements.get(id);
  };
  let respond; const requests = [];
  vm.runInNewContext(fs.readFileSync(new URL("../../src/adapters/workflow-console/dashboard.js", import.meta.url), "utf8"), {
    document: { getElementById: get }, fetch: (_url, options) => { requests.push(JSON.parse(options.body));
      return new Promise(resolve => { respond = value => resolve({ ok: true, json: async () => value }); }); },
  });
  get("request").value = JSON.stringify(request); get("token").value = "fixture";
  const pending = get("preview").onclick(); respond(preview); await pending;
  get("approve").checked = true; get("approve").onchange(); assert.equal(get("apply").disabled, false);
  const applying = get("apply").onclick();
  assert.deepEqual(requests.at(-1).request, pinned); assert.equal(requests.at(-1).expectPlan, preview.action_sha256);
  assert.equal(requests.at(-1).execute, true); assert.equal(requests.at(-1).syncRelay, false);
  respond(applied); await applying; assert.equal(get("apply").disabled, true);
  return { proof_class: "offline-console-consent-and-browser-boundary", effects, genuine_human: "NOT_RUN", standard_execution: "NOT_RUN" };
}
