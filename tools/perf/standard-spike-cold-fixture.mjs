import assert from "node:assert/strict";
import fs from "node:fs";
import { shadowHash } from "../../src/core/workflow/shadow-json.mjs";
import { createStandardWorkflowExecution } from "../../src/application/runtime/standard-workflow-composition.mjs";
import { closureHumanSource } from "./cycle-closure-fixture-lib.mjs";
import { standardSpikeWitness } from "./standard-spike-execution-fixture-lib.mjs";

const data = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
let launches = 0;
const host = createStandardWorkflowExecution({ configuration: data.configuration, readSigningKey: () => Buffer.from(data.key_hex, "hex"),
  humanSource: closureHumanSource(data.human_source_file), authorize: async () => { throw Error("COLD_SPIKE_AUTHORIZATION_FORBIDDEN"); } },
  { controllerFactory: () => { launches++; throw Error("COLD_SPIKE_NATIVE_FORBIDDEN"); } });
const state = host.inspect(), originalAuthority = shadowHash(data.authority);
assert.equal(state.record.instance_sha256, data.expected_instance_sha256); assert.equal(state.cursor.status, data.expected_status);
const before = standardSpikeWitness(host, data.configuration), allocations = host.inspectAllocations();
for (let i = 0; i < 2; i++) {
  const result = await host.step({ write: false }); assert.equal(result.written, false);
  assert.equal(host.inspect().record.instance_sha256, data.expected_instance_sha256);
  assert.deepEqual(host.inspectAllocations(), allocations); assert.equal(launches, 0);
}
assert.equal(standardSpikeWitness(host, data.configuration), before); assert.equal(shadowHash(data.authority), originalAuthority);
console.log(JSON.stringify({ status: "PASS", new_native_allocations: 0, effects_unchanged: true, workflow_status: state.cursor.status }));
