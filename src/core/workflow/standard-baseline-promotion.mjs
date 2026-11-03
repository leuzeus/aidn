import requestSchema from "../contracts/workflow-definition/standard-baseline-promotion-request.v1.schema.json" with { type: "json" };
import { validateJsonSchema } from "../contracts/json-schema-validator.mjs";
import { artifactContentHash } from "./artifact-compare-swap.mjs";
import { checkShadowJson, shadowHash } from "./shadow-json.mjs";
const fail = code => { throw Object.assign(Error(code), { code }); };
export const baselinePromotionPaths = Object.freeze(["baseline/current.md", "baseline/history.md", "snapshots/context-snapshot.md", "index.md", "CURRENT-STATE.md"]);
export function assertBaselinePromotionRequest(value) {
  if (checkShadowJson(value) || validateJsonSchema(value, requestSchema, "$", { contractKind: "workflow-definition" }).length || !value.summary.trim()
    || value.cycle_path.split("/")[1].split("-")[0] !== value.cycle_id) fail("STANDARD_PROMOTION_REQUEST_INVALID");
  return value;
}
// The host must authenticate the accepted decision and completed closure. A
// caller-authored successful output is not an authentication mechanism.
export function assertBaselinePromotionSource(source, instance, input) {
  const request = assertBaselinePromotionRequest(source?.request), closure = source.closure, output = closure?.output;
  if (request.decision_operation_id !== input.decision_operation_id || request.instance_id !== instance.instance_id || request.scope_id !== instance.scope_id
    || closure?.operation_id !== request.closure_operation_id || closure.instance_id !== instance.instance_id || closure.scope_id !== instance.scope_id
    || closure.product_sha256 !== request.product_sha256 || closure.cycle_id !== request.cycle_id || closure.cycle_path !== request.cycle_path || output?.operation_ref !== "cycle_close_finalize"
    || output.outcome !== "completed" || output.effect_status !== "confirmed" || output.facts?.cycle_close_completed !== true
    || output.facts.cycle_retained !== true || output.observations?.target_state !== "DONE") fail("STANDARD_PROMOTION_COMPLETED_CLOSURE_REQUIRED");
  return source;
}
const escape = value => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
function field(text, key, value, optional = false) {
  const regex = new RegExp("^" + escape(key) + ":[^\r\n]*", "gm"), count = [...text.matchAll(regex)].length;
  if (count > 1 || !count && !optional) fail("STANDARD_PROMOTION_DOCUMENT_AMBIGUOUS");
  return count ? text.replace(regex, () => key + ": " + value) : text.trimEnd() + "\n" + key + ": " + value + "\n";
}
function section(text, title, update) {
  const regex = new RegExp(String.raw`(^## ${escape(title)}\r?\n)([\s\S]*?)(?=^## |$(?![\s\S]))`, "gm");
  if ([...text.matchAll(regex)].length !== 1) fail("STANDARD_PROMOTION_DOCUMENT_AMBIGUOUS");
  return text.replace(regex, (_match, heading, body) => heading + "\n" + update(body).trim() + "\n\n");
}
// Baseline versions allow vM.m and vM.m.p, with optional prerelease IDs.
// Compare numeric components numerically; spelling aliases cannot be a bump.
function newerVersion(candidate, current) {
  const parse = text => {
    const m = text.length <= 64 && /^v(\d+)\.(\d+)(?:\.(\d+))?(?:-([A-Za-z0-9][A-Za-z0-9.-]*))?$/.exec(text);
    if (!m || m[4]?.split(".").some(part => !/^[A-Za-z0-9-]+$/.test(part))) fail("STANDARD_PROMOTION_BASELINE_VERSION_INVALID");
    return { numbers: [m[1], m[2], m[3] ?? "0"].map(BigInt), prerelease: m[4]?.split(".") ?? [] };
  };
  const a = parse(candidate), b = parse(current);
  for (let i = 0; i < 3; i++) if (a.numbers[i] !== b.numbers[i]) return a.numbers[i] > b.numbers[i];
  if (!a.prerelease.length || !b.prerelease.length) return !a.prerelease.length && b.prerelease.length > 0;
  for (let i = 0; i < Math.min(a.prerelease.length, b.prerelease.length); i++) {
    const left = a.prerelease[i], right = b.prerelease[i]; if (left === right) continue;
    const ln = /^\d+$/.test(left), rn = /^\d+$/.test(right);
    if (ln && rn) { if (BigInt(left) !== BigInt(right)) return BigInt(left) > BigInt(right); continue; }
    return ln !== rn ? !ln : left > right;
  }
  return a.prerelease.length > b.prerelease.length;
}
const md = value => value.replace(/[\\`*_{}[\]()#+.!|>]/g, "\\$&");
function chunks(text) { const result = []; let part = ""; for (const character of text) { if (part.length + character.length > 8192) { result.push(part); part = ""; } part += character; } if (part || !result.length) result.push(part); return result; }
export function renderStandardBaselinePromotion({ request, context, documents, preparedAt }) {
  assertBaselinePromotionRequest(request);
  if (!Number.isSafeInteger(preparedAt) || preparedAt < 0 || !Number.isFinite(new Date(preparedAt).getTime()) || context.mode !== "COMMITTING"
    || context.cycle_state !== "DONE" || context.cycle_id !== request.cycle_id || context.cycle_path !== request.cycle_path
    || context.product_sha256 !== request.product_sha256 || context.active_cycle === request.cycle_id || documents.length !== baselinePromotionPaths.length
    || documents.some((row, i) => row.path !== baselinePromotionPaths[i] || typeof row.content !== "string" || artifactContentHash(row.content) !== row.sha256)) fail("STANDARD_PROMOTION_CONTEXT_REQUIRED");
  const [baseline, history, snapshot, index, current] = documents;
  if (baseline.sha256 !== request.baseline_sha256 || history.sha256 !== request.history_sha256) fail("STANDARD_PROMOTION_REVIEW_STALE");
  const old = [...baseline.content.matchAll(/^baseline:[ \t]*([^\r\n]+)$/gm)];
  if (old.length !== 1 || old[0][1].trim() === request.version || new RegExp("^## " + escape(request.version) + "(?:[ \t]|\r?$)", "m").test(history.content)) fail("STANDARD_PROMOTION_VERSION_EXISTS");
  if (!newerVersion(request.version, old[0][1].trim())) fail("STANDARD_PROMOTION_VERSION_NOT_INCREASED");
  const date = new Date(preparedAt).toISOString().slice(0, 10), marker = "Process baseline promotion", label = md(request.summary), cycleId = request.cycle_id;
  let nextBaseline = field(field(baseline.content, "baseline", request.version), "date", date);
  nextBaseline = section(nextBaseline, "Intent", () => label);
  nextBaseline = section(nextBaseline, "Included cycles", body => {
    if (new RegExp("^- " + cycleId + "\\b", "m").test(body)) fail("STANDARD_PROMOTION_ALREADY_INCLUDED");
    return body.replace(/^-[ \t]*(?:\(none\)|none)[ \t]*\r?$/gm, "").trimEnd() + `\n- ${cycleId} — ${label} ([status](../${request.cycle_path}/status.md))`;
  });
  const entry = { decision_operation_id: request.decision_operation_id, closure_operation_id: request.closure_operation_id, cycle_id: cycleId, version: request.version, baseline_promotion_completed: false };
  const promotionBody = "Checkpoint remains pending.\n\n" + "```json\n" + JSON.stringify(entry, null, 2) + "\n```";
  nextBaseline = new RegExp("^## " + marker + "\r?$", "m").test(nextBaseline)
    ? section(nextBaseline, marker, () => promotionBody) : nextBaseline.trimEnd() + `\n\n## ${marker}\n\n${promotionBody}\n`;
  const nextHistory = history.content + `\n\n## ${request.version} — ${date}\n- ${cycleId}: ${label}\n- decision_operation_id: ${request.decision_operation_id}\n- closure_operation_id: ${request.closure_operation_id}\n- checkpoint: pending\n`;
  const baselineLine = /^- Baseline:[^\r\n]*$/gm;
  if ([...snapshot.content.matchAll(baselineLine)].length !== 1) fail("STANDARD_PROMOTION_DOCUMENT_AMBIGUOUS");
  let nextSnapshot = snapshot.content.replace(baselineLine, () => `- Baseline: ${request.version} (${date}); promotion checkpoint pending`);
  if (context.active_cycle === "none") nextSnapshot = section(nextSnapshot, "Next entry point", () => "- Finish the promote-baseline checkpoint; promotion remains pending.");
  const indexLine = /^- Baseline:[^\r\n]*$/gm;
  if ([...index.content.matchAll(indexLine)].length !== 1) fail("STANDARD_PROMOTION_DOCUMENT_AMBIGUOUS");
  const nextIndex = index.content.replace(indexLine, () => `- Baseline: [${request.version}](baseline/current.md); promotion checkpoint pending`);
  let nextCurrent = field(field(field(current.content, "updated_at", new Date(preparedAt).toISOString()), "baseline_version", request.version, true), "baseline_promotion_status", "checkpoint_pending", true);
  if (context.active_cycle === "none") nextCurrent = field(nextCurrent, "first_plan_step", "Finish the promote-baseline checkpoint before continuing.");
  const after = [nextBaseline, nextHistory, nextSnapshot, nextIndex, nextCurrent];
  const changes = documents.map((row, i) => ({ path: row.path, before_sha256: row.sha256, after_sha256: artifactContentHash(after[i]), text_chunks: chunks(after[i]) }));
  if (checkShadowJson(changes) || Buffer.byteLength(JSON.stringify(changes)) > 196608 || changes.some(row => row.before_sha256 === row.after_sha256)) fail("STANDARD_PROMOTION_RENDER_LIMIT");
  return { changes, request_sha256: shadowHash(request) };
}
