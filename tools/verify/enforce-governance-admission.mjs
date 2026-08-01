#!/usr/bin/env node
import { evaluateGovernanceAdmission } from "./governance-admission-lib.mjs";

const output = evaluateGovernanceAdmission({
  classificationResult: process.env.AIDN_CLASSIFICATION_RESULT,
  gatesResult: process.env.AIDN_GATES_RESULT,
  familyCount: process.env.AIDN_FAMILY_COUNT,
  lane: process.env.AIDN_GOVERNANCE_LANE,
});
console.log(JSON.stringify(output, null, 2));
if (!output.ok) {
  process.exitCode = 1;
}
