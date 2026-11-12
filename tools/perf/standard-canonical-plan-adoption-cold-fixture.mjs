import assert from "node:assert/strict";
import fs from "node:fs";
import { createStandardWorkflowMixedHost } from "../../src/application/runtime/standard-workflow-mixed-composition.mjs";

const data = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
let launches = 0;
const host = createStandardWorkflowMixedHost({ configuration: data.configuration,
  readSigningKey: () => Buffer.from(data.key_hex, "hex"), authorize: async () => data.fixture_grant },
  { controllerFactory: () => { launches++; throw Error("CANONICAL_ADOPTION_NATIVE_FORBIDDEN"); } });
assert.equal(host.inspect().record.instance_sha256, data.expected_before_sha256);
const accepted = await host.acceptOperation(data.operation_id, { write: true });
assert.equal(accepted.cursor.status, "COMPLETED"); assert.equal(launches, 0);
console.log(JSON.stringify({ status: "PASS", instance_sha256: accepted.record.instance_sha256, cursor: accepted.cursor.status, new_native_allocations: 0 }));
