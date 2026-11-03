import assert from "node:assert/strict";
import { validateJsonSchemaDefinition } from "../../src/core/contracts/json-schema-validator.mjs";
import fs from "node:fs";
import { assertBaselinePromotionRequest, assertBaselinePromotionSource, baselinePromotionPaths, renderStandardBaselinePromotion } from "../../src/core/workflow/standard-baseline-promotion.mjs";
import { artifactContentHash } from "../../src/core/workflow/artifact-compare-swap.mjs";
import { shadowHash } from "../../src/core/workflow/shadow-json.mjs";
const H = "a".repeat(64), op = char => "op_" + char.repeat(40);
const fixture = () => {
  const documents = baselinePromotionPaths.map(path => { let content = fs.readFileSync(new URL("../../scaffold/docs_audit/" + path, import.meta.url), "utf8");
    if (path === "baseline/current.md") content = content.replace("- (none)", "- C000: preserved previous work");
    if (path === "CURRENT-STATE.md") content = content.replace("mode: unknown", "mode: COMMITTING");
    return { path, content, sha256: artifactContentHash(content) }; });
  const request = { contract_version: "standard-baseline-promotion-request.v1", decision_operation_id: op("b"), closure_operation_id: op("a"), instance_id: "fixture", scope_id: "fixture",
    cycle_id: "C001", cycle_path: "cycles/C001-feature-fixture", baseline_sha256: documents[0].sha256, history_sha256: documents[1].sha256,
    product_sha256: H, version: "v0.3", summary: "Explicitly selected completed cycle", evidence_refs: [{ ref: "fixture:operator", sha256: H }] };
  const context = { product_sha256: H, mode: "COMMITTING", cycle_state: "DONE", cycle_id: request.cycle_id, cycle_path: request.cycle_path, active_cycle: "none" };
  const closure = { product_sha256: H, operation_id: op("a"), instance_id: "fixture", scope_id: "fixture", cycle_id: request.cycle_id, cycle_path: request.cycle_path,
    output: { operation_ref: "cycle_close_finalize", outcome: "completed", effect_status: "confirmed", facts: { cycle_close_completed: true, cycle_retained: true }, observations: { target_state: "DONE" } } };
  return { request, context, documents, preparedAt: 1793700000000, closure };
};
const instance = { instance_id: "fixture", scope_id: "fixture" }, input = { decision_operation_id: op("b") };
let checks = 0; const pass = name => { checks++; if (!process.argv.includes("--json")) console.log("PASS " + name); }, text = (r, p) => r.changes.find(row => row.path === p).text_chunks.join("");
for (const name of ["request", "input", "plan", "output"]) {
  const schema = JSON.parse(fs.readFileSync(new URL("../../src/core/contracts/workflow-definition/standard-baseline-promotion-" + name + ".v1.schema.json", import.meta.url)));
  assert.deepEqual(validateJsonSchemaDefinition(schema, "#", { contractKind: "workflow-definition" }), []);
}
pass("four private promotion contracts use supported schema definitions");
const base = fixture(), original = shadowHash(base), result = renderStandardBaselinePromotion(base);
assert.equal(shadowHash(base), original); assert.deepEqual(result.changes.map(row => row.path), baselinePromotionPaths);
assert.match(text(result, "baseline/current.md"), /^baseline: v0.3$/m); assert.ok(text(result, "baseline/current.md").includes("C000: preserved previous work"));
assert.ok(text(result, "baseline/history.md").startsWith(base.documents[1].content)); assert.match(text(result, "baseline/history.md"), /^## v0.3 /m);
assert.match(text(result, "CURRENT-STATE.md"), /^baseline_promotion_status: checkpoint_pending$/m); assert.match(text(result, "baseline/current.md"), /"baseline_promotion_completed": false/);
pass("pure five-document promotion preserves prior history and cycles while keeping completion pending");
for (const extra of [{ authorized: true }, { module: "arbitrary.mjs" }, { choice: "skip" }]) assert.throws(() => assertBaselinePromotionRequest({ ...base.request, ...extra }), { code: "STANDARD_PROMOTION_REQUEST_INVALID" });
for (const mutation of [{ summary: "\nreplace metadata" }, { summary: "  " }, { version: "v0.3\nstate: DONE" }, { cycle_path: "cycles/C002-feature-other" }])
  assert.throws(() => assertBaselinePromotionRequest({ ...base.request, ...mutation }), { code: "STANDARD_PROMOTION_REQUEST_INVALID" });
pass("a typed request cannot supply permissions, executable modules or injected metadata");
assertBaselinePromotionSource(base, instance, input);
for (const mutate of [f => { f.closure.output.facts.cycle_close_completed = false; }, f => { f.closure.output.effect_status = "unknown"; },
  f => { f.closure.output.observations.target_state = "NO_GO"; }, f => { f.closure.scope_id = "foreign"; }, f => { f.request.decision_operation_id = op("c"); }]) {
  const f = fixture(); mutate(f); assert.throws(() => assertBaselinePromotionSource(f, instance, input), { code: "STANDARD_PROMOTION_COMPLETED_CLOSURE_REQUIRED" });
}
pass("recorded DONE alone, uncertain hooks and foreign decisions cannot replace completed closure provenance");
for (const mutation of [{ cycle_state: "NO_GO" }, { active_cycle: "C001" }, { mode: "THINKING" }]) assert.throws(() => renderStandardBaselinePromotion({ ...base, context: { ...base.context, ...mutation } }), { code: "STANDARD_PROMOTION_CONTEXT_REQUIRED" });
const changed = fixture(); changed.documents[0].content += "\nforeign current baseline\n"; changed.documents[0].sha256 = artifactContentHash(changed.documents[0].content);
assert.throws(() => renderStandardBaselinePromotion(changed), { code: "STANDARD_PROMOTION_REVIEW_STALE" });
pass("changed baseline material and ineligible current context refuse rendering");
for (const version of ["v0.2", "v0.1"]) assert.throws(() => renderStandardBaselinePromotion({ ...base, request: { ...base.request, version } }), { code: "STANDARD_PROMOTION_VERSION_EXISTS" });
for (const version of ["v0.0", "v00.2.0"]) assert.throws(() => renderStandardBaselinePromotion({ ...base, request: { ...base.request, version } }), { code: "STANDARD_PROMOTION_VERSION_NOT_INCREASED" });
for (const [current, version, permitted] of [["v0.3-alpha", "v0.3", true], ["v0.3-alpha.2", "v0.3-alpha.10", true], ["v0.3-alpha.2", "v0.3-alpha.1", false]]) {
  const f = fixture(); f.documents[0].content = f.documents[0].content.replace(/^baseline:.*$/m, "baseline: " + current);
  f.documents[0].sha256 = artifactContentHash(f.documents[0].content); f.request.baseline_sha256 = f.documents[0].sha256; f.request.version = version;
  if (permitted) assert.match(text(renderStandardBaselinePromotion(f), "baseline/current.md"), new RegExp("^baseline: " + version.replaceAll(".", "\\.") + "$", "m"));
  else assert.throws(() => renderStandardBaselinePromotion(f), { code: "STANDARD_PROMOTION_VERSION_NOT_INCREASED" });
}
pass("promotion requires a version increase, including numeric aliases and prerelease ordering");
const already = fixture(); already.documents[0].content = already.documents[0].content.replace("C000:", "C001:"); already.documents[0].sha256 = artifactContentHash(already.documents[0].content); already.request.baseline_sha256 = already.documents[0].sha256;
assert.throws(() => renderStandardBaselinePromotion(already), { code: "STANDARD_PROMOTION_ALREADY_INCLUDED" });
pass("history version reuse and repeated inclusion cannot rewrite a prior promotion");
const other = fixture(); other.context.active_cycle = "C002";
const otherResult = renderStandardBaselinePromotion(other);
assert.equal(text(otherResult, "snapshots/context-snapshot.md"), other.documents[2].content.replace(/^- Baseline:.*$/m, "- Baseline: v0.3 (2026-11-03); promotion checkpoint pending"));
assert.match(text(otherResult, "CURRENT-STATE.md"), /^first_plan_step: unknown$/m);
pass("promotion preserves another active cycle's next action");
const unicode = fixture(); unicode.documents[1].content += "\n" + "é🧵".repeat(7000); unicode.documents[1].sha256 = artifactContentHash(unicode.documents[1].content); unicode.request.history_sha256 = unicode.documents[1].sha256;
const full = renderStandardBaselinePromotion(unicode); assert.ok(text(full, "baseline/history.md").startsWith(unicode.documents[1].content)); assert.ok(full.changes[1].text_chunks.length > 1);
for (const row of full.changes) assert.equal(artifactContentHash(row.text_chunks.join("")), row.after_sha256);
pass("bounded Unicode chunks retain every historical byte without scalar truncation");
console.log(JSON.stringify({ status: "PASS", checks, proof: "pure-baseline-promotion", actual_writes: "NOT_RUN", source_authentication: "NOT_RUN", full_workflow: "NOT_RUN", native: "NOT_RUN", installed_archive: "NOT_RUN" }));
