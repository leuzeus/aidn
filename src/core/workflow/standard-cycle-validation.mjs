import path from "node:path";
import schema from "../contracts/workflow-definition/standard-cycle-validation-profile.v1.schema.json" with { type: "json" };
import { validateJsonSchema } from "../contracts/json-schema-validator.mjs";
import { checkShadowJson } from "./shadow-json.mjs";
const fail = code => { throw Object.assign(new Error(code), { code }); };
export function assertStandardValidationProfile(value) {
  if (checkShadowJson(value) || validateJsonSchema(value, schema, "$", { contractKind: "workflow-definition" }).length
    || new Set(value.checks.map(row => row.test_ref)).size !== value.checks.length
    || new Set(value.checks.map(row => row.snapshot_path.toLowerCase())).size !== value.checks.length
    || value.checks.some(row => /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(row.snapshot_path.split("/").at(-1)) || /[. ]$/.test(row.snapshot_path))
    || Object.values(value.environment).some(text => text.includes("\0"))
    || value.checks.some(row => row.args.some(text => text.includes("\0")))) fail("STANDARD_VALIDATION_PROFILE_INVALID");
  for (const name of [value.evidence_root, value.snapshot_root, ...[value.boundary_configuration, value.qualification, value.public_key, ...value.checks.map(row => row.script)].map(row => row.path)])
    if (!path.isAbsolute(name) || /[\0\r\n]/.test(name)) fail("STANDARD_VALIDATION_PROFILE_PATH_INVALID");
  return value;
}
export function selectStandardValidationChecks(profile, task) {
  assertStandardValidationProfile(profile);
  if (!Array.isArray(task.test_refs) || !task.test_refs.length || new Set(task.test_refs).size !== task.test_refs.length) fail("STANDARD_VALIDATION_CHECKS_REQUIRED");
  return task.test_refs.map(id => { const check = profile.checks.find(row => row.test_ref === id); if (!check) fail("STANDARD_VALIDATION_CHECK_UNKNOWN"); return check; });
}
export function standardValidationStatus(checks) {
  if (!Array.isArray(checks) || !checks.length || checks.some(row => !["passed", "failed", "unavailable"].includes(row.status))) fail("STANDARD_VALIDATION_RESULTS_INVALID");
  return checks.some(row => row.status === "unavailable") ? "unavailable" : checks.some(row => row.status === "failed") ? "failed" : "passed";
}
