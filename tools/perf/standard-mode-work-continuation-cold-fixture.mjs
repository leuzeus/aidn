import assert from "node:assert/strict";
import fs from "node:fs";
import { createStandardWorkflowExecution } from "../../src/application/runtime/standard-workflow-composition.mjs";
import { closureHumanSource } from "./cycle-closure-fixture-lib.mjs";
const data = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const realNow = Date.now;
if (data.clock_offset_ms) Date.now = () => realNow() + data.clock_offset_ms;
let launches = 0;
try {
  const host = createStandardWorkflowExecution({ configuration: data.configuration, readSigningKey: () => Buffer.from(data.key_hex, "hex"),
    humanSource: closureHumanSource(data.human_source_file),
    authorize: async () => ({ authorized: true, authority_id: "fixture_operator", principal_sha256: "a".repeat(64), grant_sha256: "b".repeat(64) }) },
  { controllerFactory: () => { launches++; throw Error("COLD_DECISION_NATIVE_FORBIDDEN"); } });
  assert.equal(host.inspect().record.instance_sha256, data.expected_instance_sha256);
  const initial = host.inspectAllocations();
  assert.equal((await host.receiveDecision(data.operation_id, { sourceRef: "missing", write: true })).status, "waiting_for_human");
  assert.equal(host.inspect().record.instance_sha256, data.expected_instance_sha256);
  const received = await host.receiveDecision(data.operation_id, { sourceRef: data.source_ref, write: true });
  assert.equal(received.status, "receipted");
  // A captured source survives restart and cannot be replaced by another ref.
  assert.equal((await host.receiveDecision(data.operation_id, { sourceRef: data.source_ref, write: true })).status, "retained_result");
  const accepted = await host.acceptOperation(data.operation_id, { write: true });
  assert.deepEqual(host.inspectAllocations(), initial); assert.equal(launches, 0);
  console.log(JSON.stringify({ status: "PASS", pid: process.pid, new_native_allocations: launches, original_authority_expired: Date.now() > data.original_deadline_ms,
    instance_sha256: accepted.record.instance_sha256, workflow_status: accepted.cursor.status }));
} finally { Date.now = realNow; }
