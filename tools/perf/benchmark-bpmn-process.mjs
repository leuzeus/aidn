import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { performance } from "node:perf_hooks";
import assert from "node:assert/strict";
import { compileBpmnProcess } from "../../src/application/workflow/bpmn-process-service.mjs";
import * as candidate from "../../src/core/workflow/agentic-process.mjs";
import { agenticPolicyPins } from "../../src/core/workflow/agentic-process-model.mjs";
import { evaluateAgentReuse, fingerprintAgentReuse } from "../../src/core/agents/agent-reuse-policy.mjs";
import { shadowHash } from "../../src/core/workflow/shadow-json.mjs";

const args = process.argv.slice(2), value = flag => args[args.indexOf(flag) + 1];
assert(args.includes("--baseline-root") && args.includes("--out"), "--baseline-root and --out are required");
const output = path.resolve(value("--out")); assert(!fs.existsSync(output), "new output required");
const baseline = await import(pathToFileURL(path.join(path.resolve(value("--baseline-root")), "src/core/workflow/agentic-process.mjs")));
const example = JSON.parse(fs.readFileSync(new URL("../../tests/fixtures/agentic-process/compatible-work-and-review.json", import.meta.url)));
const xml = fs.readFileSync(new URL("../../tests/fixtures/agentic-process/extended-delivery.bpmn", import.meta.url), "utf8");
const compile = () => compileBpmnProcess({ xml, processRef: "ExtendedDelivery", modelId: "benchmark",
  revision: 1, participantId: "delivery", roles: example.roles, policies: example.policies });
const compilation = compile(), model = compilation.model, policyPins = agenticPolicyPins(model), H = "a".repeat(64), NOW = 1793534400000;
const initial = api => api.createAgenticProcess({ instanceId: "benchmark", model, policyPins, scopeId: "benchmark", facts: { refinement_done: false } });
let state = initial(candidate), serial = 0, count = 0;
const advance = event => { state = candidate.advanceAgenticProcess(state, { event_id: `step-${++serial}`, ...event }); };
const wait = candidate.inspectAgenticProcess(state).occurrences.find(row => row.wait_reason === "event");
advance({ kind: "message", occurrence_id: wait.occurrence_id, correlation_id: wait.correlation_id, event_key: "approved" });
while (candidate.inspectAgenticProcess(state).ready.length) {
  assert(count < 16); const occurrence = candidate.inspectAgenticProcess(state).ready[0];
  const frame = candidate.inspectAgenticProcess(state).occurrences.find(row => row.occurrence_id === occurrence), node = model.nodes.find(n => n.id === frame.node_id);
  const role = model.roles.find(r => r.id === node.role_ref), policy = model.policies.find(p => p.id === node.policy_ref), who = policy.independent_review ? "reviewer" : "author";
  const request = { contract_version: "agent-reuse-request.v1", activity_id: occurrence, scope_id: "benchmark", revision: "r1", artifact_sha256: H, criteria_sha256: H,
    ...Object.fromEntries(["assurance_profile", "mode", "independent_review", "context_isolation_required", "required_permissions", "allowed_permissions"].map(k => [k, policy[k]])),
    role: role.role, action: role.action, allowed_context_sha256: [H], reviewed_contributors: policy.independent_review ? [{ agent_id: "author", lineage_id: "author" }] : [] };
  const resource = { execution_id: who, agent_id: who, lineage_id: who, session_id: who, adapter_id: "benchmark", role: role.role, action: role.action,
    permissions: policy.required_permissions, guarantees: ["context-isolated", "protected-verdict"], context_sha256: [H], contributions: [] };
  const observation = { contract_version: "agent-reuse-observation.v1", authority_id: "synthetic", observation_id: `observation-${serial}`,
    request_sha256: fingerprintAgentReuse(request), scope_id: "benchmark", revision: "r1", assurance_profile: policy.assurance_profile, artifact_sha256: H, criteria_sha256: H,
    observed_at: new Date(NOW - 1).toISOString(), expires_at: new Date(NOW + 5000).toISOString(), current_execution_id: who, executors: [resource], evidence_refs: [{ ref: "synthetic/observation", sha256: H }] };
  const decision = evaluateAgentReuse({ request, observation, eligibleAdapterIds: ["benchmark"], now: NOW });
  advance({ kind: "assign", occurrence_id: occurrence, request, decision });
  advance({ kind: "result", occurrence_id: occurrence, result: { result_id: `result-${serial}`, request_sha256: fingerprintAgentReuse(request), execution_id: who,
    revision: "r1", artifact_sha256: H, criteria_sha256: H, outcome: "completed", evidence_refs: [{ ref: "synthetic/result", sha256: H }] } });
  if (++count === 2) advance({ kind: "facts", facts: { refinement_done: true } });
}
assert.equal(count, 10); assert.equal(candidate.inspectAgenticProcess(state).status, "COMPLETED");
const events = state.events;
function replay(api) { let s = initial(api); for (const event of events) s = api.advanceAgenticProcess(s, event); return api.inspectAgenticProcess(s); }
const oracle = candidate.inspectAgenticProcess(state); assert.deepEqual(replay(baseline), oracle);
const ir = JSON.stringify(model), samples = { parse_ir_ms: [], compile_xml_ms: [], baseline_replay_ms: [], candidate_replay_ms: [] };
const timed = fn => { const t = performance.now(); const result = fn(); return { elapsed: performance.now() - t, result }; };
for (let i = 0; i < 5; i++) { compile(); replay(baseline); replay(candidate); }
for (let i = 0; i < 50; i++) {
  const pair = i % 2 ? ["candidate", "baseline"] : ["baseline", "candidate"];
  for (const arm of pair) { const r = timed(() => replay(arm === "candidate" ? candidate : baseline)); assert.deepEqual(r.result, oracle); samples[arm + "_replay_ms"].push(r.elapsed); }
}
for (let i = 0; i < 500; i++) {
  const pair = i % 2 ? ["compile", "parse"] : ["parse", "compile"];
  for (const arm of pair) { const r = timed(() => arm === "compile" ? compile().model : JSON.parse(ir)); assert.equal(shadowHash(r.result), compilation.model_sha256); samples[arm === "compile" ? "compile_xml_ms" : "parse_ir_ms"].push(r.elapsed); }
}
const stats = values => { const s = [...values].sort((a, b) => a - b); return { n: s.length, median_ms: s[Math.floor(s.length / 2)], p95_ms: s[Math.ceil(s.length * .95) - 1], min_ms: s[0], max_ms: s.at(-1) }; };
const metrics = Object.fromEntries(Object.entries(samples).map(([k, v]) => [k, stats(v)]));
const result = { status: "PASS", evidence: "offline deterministic CPU benchmark; not native tokens", measured_at: new Date().toISOString(), node: process.version,
  model_sha256: compilation.model_sha256, xml_bytes: Buffer.byteLength(xml), ir_bytes: Buffer.byteLength(ir), oracle_sha256: shadowHash(oracle), activity_results: count,
  events: events.length, occurrences: oracle.occurrences.length, baseline_candidate_cursor_equal: true, provider_model_calls: 0, provider_tokens: 0,
  native_benchmark: "SEPARATE", metrics, samples };
fs.mkdirSync(path.dirname(output), { recursive: true }); fs.writeFileSync(output, JSON.stringify(result, null, 2) + "\n", { flag: "wx" });
console.log(JSON.stringify({ ...result, samples: undefined }));
