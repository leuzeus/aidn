import definitionSchema from "../contracts/workflow-definition/workflow-definition.v1.schema.json" with { type: "json" };
import contextSchema from "../contracts/workflow-definition/workflow-shadow-context.v1.schema.json" with { type: "json" };
import compilationSchema from "../contracts/workflow-definition/workflow-compilation.v1.schema.json" with { type: "json" };
import registryData from "../../../package/catalogs/workflow-shadow.v1.json" with { type: "json" };
import { validateJsonSchema } from "../contracts/json-schema-validator.mjs";
import { checkShadowJson, normalizeShadowJson, freezeShadow, shadowHash } from "./shadow-json.mjs";

// No handler, filesystem, runtime, Git, backend or executor imports. The registry
// contains references and finite result vocabularies, never callable handlers.
const registry = freezeShadow(registryData);
const profile = { contractKind: "workflow-definition" };
const compilerVersion = "workflow-shadow-compiler.v1";
const problem = (code, path = "$") => ({ code, path });
const failure = issues => freezeShadow({ ok: false, issues, compilation: null });
const sorted = values => [...values].sort();
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const byId = (a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0;

export function getWorkflowShadowRegistry() { return registry; }

function schemaIssues(value, schema, path) {
  const json = checkShadowJson(value);
  if (json) return [problem(json, path)];
  return validateJsonSchema(value, schema, path, profile).map(detail => ({ code: "SCHEMA_INVALID", path, detail }));
}

function normalizeDefinition(value) {
  const normalizeRefs = item => ({ ...item, rule_refs: sorted(item.rule_refs), evidence_refs: sorted(item.evidence_refs) });
  return normalizeShadowJson({ ...value,
    steps: value.steps.map(step => ({ ...normalizeRefs(step), outcomes: sorted(step.outcomes) })).sort(byId),
    transitions: value.transitions.map(normalizeRefs).sort(byId),
  });
}

function semanticIssues(definition, context) {
  if (definition.steps.length > 256 || definition.transitions.length > 1024) return [problem("GRAPH_LIMIT")];
  const issues = [];
  const add = (code, path) => issues.push(problem(code, path));
  const unique = (values, path) => { if (new Set(values).size !== values.length) add("DUPLICATE_IDENTITY", path); };
  unique(definition.steps.map(step => step.id), "$.steps");
  unique(definition.transitions.map(edge => edge.id), "$.transitions");
  const steps = new Map(definition.steps.map(step => [step.id, step]));
  const primitives = new Map(registry.primitives.map(item => [item.id, item]));
  if (!steps.has(definition.entry)) add("UNKNOWN_ENTRY", "$.entry");
  if (context.product_version !== definition.compatibility.product_version
    || context.workflow_version !== definition.compatibility.workflow_version) add("INCOMPATIBLE_CONTEXT", "$.compatibility");
  for (const [group, items] of [["steps", definition.steps], ["transitions", definition.transitions]]) {
    for (const item of items) for (const field of ["rule_refs", "evidence_refs"]) {
      unique(item[field], `$.${group}.${item.id}.${field}`);
      const known = field === "rule_refs" ? registry.rules : registry.evidence;
      if (item[field].some(ref => !known.includes(ref))) add("UNKNOWN_REFERENCE", `$.${group}.${item.id}.${field}`);
    }
  }
  for (const step of definition.steps) {
    const location = `$.steps.${step.id}`;
    const primitive = primitives.get(step.primitive_ref);
    if (!primitive) { add("UNKNOWN_PRIMITIVE", location); continue; }
    if (step.kind !== primitive.kind) add("PRIMITIVE_KIND_MISMATCH", location);
    if (!primitive.sources.some(source => source.path === step.source.path && source.anchor === step.source.anchor)) add("SOURCE_REFERENCE_MISMATCH", location);
    unique(step.outcomes, `${location}.outcomes`);
    if (!equal(sorted(step.outcomes), sorted(primitive.outcomes))) add("OUTPUT_TYPE_MISMATCH", location);
    const outgoing = definition.transitions.filter(edge => edge.from === step.id);
    if (step.kind === "terminal") {
      if (!step.terminal_result || step.outcomes.length || outgoing.length) add("INVALID_TERMINAL", location);
    } else {
      if (step.terminal_result !== undefined) add("INVALID_TERMINAL", location);
      if (!equal(sorted(outgoing.map(edge => edge.outcome)), sorted(step.outcomes))) add("OUTCOME_COVERAGE", location);
    }
  }
  for (const edge of definition.transitions) {
    const location = `$.transitions.${edge.id}`;
    if (!steps.has(edge.from) || !steps.has(edge.to)) add("UNKNOWN_ENDPOINT", location);
    if (!steps.get(edge.from)?.outcomes.includes(edge.outcome)) add("UNKNOWN_OUTCOME", location);
    if ((edge.max_traversals !== undefined) !== (edge.on_exhausted !== undefined)) add("INCOMPLETE_BOUND", location);
    if (edge.on_exhausted && steps.get(edge.on_exhausted)?.kind !== "terminal") add("INVALID_EXHAUSTION", location);
  }
  if (issues.length) return issues;
  const adjacency = new Map(definition.steps.map(step => [step.id, []]));
  const reverse = new Map(definition.steps.map(step => [step.id, []]));
  for (const edge of definition.transitions) for (const target of [edge.to, edge.on_exhausted].filter(Boolean)) {
    adjacency.get(edge.from).push(target); reverse.get(target).push(edge.from);
  }
  function walk(seeds, graph) {
    const seen = new Set(seeds);
    for (const id of seen) for (const target of graph.get(id)) seen.add(target);
    return seen;
  }
  if (walk([definition.entry], adjacency).size !== steps.size) add("UNREACHABLE_STEP", "$.steps");
  const terminals = definition.steps.filter(step => step.kind === "terminal").map(step => step.id);
  if (!terminals.length) add("MISSING_TERMINAL", "$.steps");
  if (walk(terminals, reverse).size !== steps.size) add("NO_TERMINAL_PATH", "$.steps");
  // Remove bounded feedback and registered admission boundaries. Any remaining
  // cycle would permit an unbounded return without an existing admission gate.
  const remaining = new Map(definition.steps.map(step => [step.id, []]));
  for (const edge of definition.transitions) {
    if (!edge.max_traversals && !primitives.get(steps.get(edge.from).primitive_ref).admission_boundary) remaining.get(edge.from).push(edge.to);
  }
  const visiting = new Set(), visited = new Set();
  function cyclic(id) {
    if (visiting.has(id)) return true;
    if (visited.has(id)) return false;
    visiting.add(id);
    for (const target of remaining.get(id)) if (cyclic(target)) return true;
    visiting.delete(id); visited.add(id); return false;
  }
  if ([...steps.keys()].some(cyclic)) add("UNBOUNDED_RETURN", "$.transitions");
  return issues;
}

export function validateShadowWorkflow(definition, context) {
  const issues = [...schemaIssues(definition, definitionSchema, "$"), ...schemaIssues(context, contextSchema, "$.context")];
  if (issues.length) return freezeShadow({ ok: false, issues });
  const semantic = semanticIssues(definition, context);
  return freezeShadow({ ok: semantic.length === 0, issues: semantic });
}

export function compileShadowWorkflow(definition, context) {
  const checked = validateShadowWorkflow(definition, context);
  if (!checked.ok) return failure(checked.issues);
  const normalized = normalizeDefinition(definition);
  const primitives = new Map(registry.primitives.map(item => [item.id, item]));
  const content = normalizeShadowJson({
    contract_version: "workflow-compilation.v1", compiler_version: compilerVersion,
    authority: "shadow", execution_available: false, written: false,
    definition: { workflow_id: normalized.workflow_id, revision: normalized.revision, sha256: shadowHash(normalized) },
    registry: { version: registry.version, sha256: shadowHash(registry) },
    context: normalizeShadowJson(context), context_sha256: shadowHash(context),
    binding: null, parameters: {}, parameters_sha256: shadowHash({}),
    entry: normalized.entry,
    steps: normalized.steps.map(step => ({ ...step,
      primitive_version: primitives.get(step.primitive_ref).version,
      admission_boundary: primitives.get(step.primitive_ref).admission_boundary,
      observation: primitives.get(step.primitive_ref).observation,
    })),
    transitions: normalized.transitions.map(edge => ({ ...edge,
      condition: { field: "outcome", operator: "equals", value: edge.outcome },
    })),
    effects: [], artifacts: [],
    diagnostics: [{ code: "SHADOW_ONLY", path: "$" },
      ...normalized.steps.filter(step => step.kind !== "terminal").map(step => ({
        code: step.kind === "agent_segment" ? "SEGMENT_PLAN_AND_ADMISSION_REQUIRED" : "HANDLER_ADMISSION_REQUIRED",
        path: `$.steps.${step.id}`,
      }))],
  });
  const compilation = freezeShadow({ ...content, compilation_sha256: shadowHash(content) });
  const errors = schemaIssues(compilation, compilationSchema, "$");
  if (errors.length) return failure(errors);
  return freezeShadow({ ok: true, issues: [], compilation });
}

// A pure, single-transition explanation, never an execution or durable cursor.
// Counters are caller-supplied observations and grant no authority to retry.
export function explainShadowTransition(definition, context, request) {
  const json = checkShadowJson(request);
  if (json) return failure([problem(json, "$.request")]);
  if (!request || Array.isArray(request) || typeof request !== "object"
    || Object.keys(request).some(key => !["step_id", "outcome", "observation", "traversals"].includes(key))
    || typeof request.step_id !== "string" || !Number.isSafeInteger(request.traversals ?? 0) || (request.traversals ?? 0) < 0
    || (Object.hasOwn(request, "outcome") === Object.hasOwn(request, "observation"))) return failure([problem("INVALID_REQUEST", "$.request")]);
  const compiled = compileShadowWorkflow(definition, context);
  if (!compiled.ok) return compiled;
  const step = compiled.compilation.steps.find(item => item.id === request.step_id);
  if (!step || step.kind === "terminal") return failure([problem("NO_TRANSITION", "$.request.step_id")]);
  let outcome = request.outcome;
  if (request.observation !== undefined) {
    const mapping = step.observation;
    const value = request.observation?.[mapping?.field];
    if (!mapping || typeof value !== "string" || !Object.hasOwn(mapping.values, value)) return failure([problem("UNKNOWN_OBSERVATION", "$.request.observation")]);
    outcome = mapping.values[value];
  }
  const edge = compiled.compilation.transitions.find(item => item.from === step.id && item.outcome === outcome);
  if (!edge) return failure([problem("UNKNOWN_OUTCOME", "$.request.outcome")]);
  const exhausted = edge.max_traversals !== undefined && (request.traversals ?? 0) >= edge.max_traversals;
  return freezeShadow({ ok: true, issues: [], compilation_sha256: compiled.compilation.compilation_sha256,
    edge_id: edge.id, outcome, next_step: exhausted ? edge.on_exhausted : edge.to, exhausted,
    observation: request.observation === undefined ? null : normalizeShadowJson(request.observation),
    authority: "shadow", execution_available: false, written: false,
  });
}
