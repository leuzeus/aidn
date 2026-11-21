import schema from "../contracts/workflow-definition/standard-cycle-plan-proposal.v1.schema.json" with { type: "json" };
import { validateJsonSchema } from "../contracts/json-schema-validator.mjs";
import { checkShadowJson } from "./shadow-json.mjs";

const fail = code => { throw Object.assign(new Error(code), { code }); };
export const CYCLE_PLAN_CONTRACT = "standard-cycle-plan-proposal.v1";
const unique = values => new Set(values).size === values.length;
const scalar = value => typeof value === "string" && value === value.replace(/\s+/gu, " ").trim();
export function assertStandardCyclePlan(proposal) {
  if (checkShadowJson(proposal) || validateJsonSchema(proposal, schema, "$", { contractKind: "workflow-definition" }).length
    || Buffer.byteLength(JSON.stringify(proposal)) > 65536) fail("STANDARD_CYCLE_PLAN_INVALID");
  const compact = (value, key) => { if (typeof value === "string" && !["path", "ref"].includes(key) && !scalar(value)) fail("STANDARD_CYCLE_PLAN_TEXT_INVALID");
    if (Array.isArray(value)) value.forEach(item => compact(item, key)); else if (value && typeof value === "object") Object.entries(value).forEach(([name, item]) => compact(item, name)); };
  compact(proposal);
  const reqs = proposal.requirements.map(row => row.id), tests = proposal.tests.map(row => row.id), tasks = proposal.tasks.map(row => row.id);
  if (![reqs, tests, tasks, proposal.tasks.map(row => row.task), proposal.evidence_refs.map(row => row.ref)].every(unique)) fail("STANDARD_CYCLE_PLAN_DUPLICATE");
  const refs = (values, allowed) => unique(values) && values.every(value => allowed.includes(value));
  for (const row of proposal.tests) if (!refs(row.requirement_refs, reqs)) fail("STANDARD_CYCLE_PLAN_TRACEABILITY_INVALID");
  for (const row of proposal.tasks) {
    if (!scalar(row.task) || !refs(row.requirement_refs, reqs) || !refs(row.test_refs, tests)
      || !unique(row.paths.map(entry => entry.path.toLowerCase()))) fail("STANDARD_CYCLE_PLAN_TRACEABILITY_INVALID");
    for (const entry of row.paths) {
      if (entry.path !== entry.path.trim() || entry.path.startsWith("/") || entry.path.split("/").some(part => !part || [".", "..", ".git", ".aidn", ".codex", ".agents"].includes(part.toLowerCase()))
        || !unique(entry.operations)) fail("STANDARD_CYCLE_PLAN_PATH_INVALID");
    }
  }
  for (const req of reqs) if (!proposal.tasks.some(row => row.requirement_refs.includes(req)) || !proposal.tests.some(row => row.requirement_refs.includes(req))) fail("STANDARD_CYCLE_PLAN_TRACEABILITY_INVALID");
  const kinds = new Set(proposal.usage_matrix.map(row => row.kind)), minimum = proposal.surface === "local" ? 1 : proposal.surface === "shared" ? 2 : 3;
  if (kinds.size < minimum || !kinds.has("nominal") || minimum > 1 && !kinds.has("alternate") || minimum > 2 && !kinds.has("context")
    || proposal.usage_matrix.some(row => !refs(row.test_refs, tests))) fail("STANDARD_CYCLE_PLAN_USAGE_INVALID");
  if (proposal.cycle_type === "spike" ? proposal.spike === null : proposal.spike !== null || !reqs.length) fail("STANDARD_CYCLE_PLAN_ADAPTIVE_INVALID");
  if (["security", "migration", "integration", "structural"].includes(proposal.cycle_type)
    && (!proposal.impact_notes || !proposal.rollback_strategy || !proposal.compatibility_strategy)) fail("STANDARD_CYCLE_PLAN_ADAPTIVE_INVALID");
  return proposal;
}

// Only fixed sections of the admitted cycle documents are rendered. Text fields
// cannot inject headings, fences, metadata lines or a second permission block.
export function renderStandardCyclePlan(proposal, cyclePath, existing) {
  assertStandardCyclePlan(proposal);
  const section = (text, title, body) => {
    const regex = new RegExp("(^## " + title + "[^\\r\\n]*\\r?\\n)([\\s\\S]*?)(?=^## |$(?![\\s\\S]))", "gm");
    if ([...text.matchAll(regex)].length !== 1) fail("STANDARD_CYCLE_PLAN_TEMPLATE_INVALID");
    return text.replace(regex, (_match, heading) => heading + "\n" + body + "\n\n");
  };
  const optionalSection = (value, title, body) => new RegExp("^## " + title + "\\r?$", "m").test(value)
    ? section(value, title, body) : value.trimEnd() + `\n\n## ${title}\n\n${body}\n\n`;
  const text = value => value.replaceAll(":", "&#58;");
  const bullets = values => values.map(value => "- " + text(value)).join("\n");
  let brief = existing["brief.md"];
  for (const [title, values] of [["Scope", proposal.scope], ["Non-scope", proposal.non_scope], ["Constraints", proposal.constraints], ["Risks", proposal.risks]]) brief = section(brief, title, bullets(values));
  const rows = proposal.usage_matrix.map(row => `| ${row.kind} | ${text(row.scenario)} | ${text(row.constraint_difference)} | ${row.test_refs.join(", ")} |`).join("\n");
  const scope = { version: 1, tasks: proposal.tasks.map(({ task, intent, paths }) => ({ task, intent, paths })) };
  const plan = `# Plan — ${proposal.cycle_id}\n\n## Usage Matrix\nScope: ${proposal.surface}\n\n| Usage Class | Scenario | Constraint Difference | Evidence |\n|---|---|---|---|\n${rows}\n\n## Tasks\n${proposal.tasks.map((row, index) => `${index + 1}. ${row.task}`).join("\n")}\n\n## Native write scope\n\`\`\`json\n${JSON.stringify(scope)}\n\`\`\`\n\n## Done criteria (per task)\n${proposal.tasks.map(row => `### ${row.id}\n${bullets(row.done_criteria)}`).join("\n\n")}\n\n## Checkpoints\n- Evaluate core and adaptive DoR before entering implementation.\n`;
  const audit = `# Audit specification — ${proposal.cycle_id}\n\n## Intent audit\n${bullets(proposal.scope)}\n\n## Architecture audit\n${bullets(proposal.architecture_notes)}\n\n## Planned tests\n${proposal.tests.map(row => `### ${row.id}\n- Method: ${text(row.method)}\n- Expected: ${text(row.expected)}\n- Requirements: ${row.requirement_refs.join(", ") || "none"}`).join("\n\n")}\n`;
  // Canonical readers require a REQ/TEST matrix; these are planned links only.
  const traceRows = proposal.requirements.map(req => `| ${req.id} | ${proposal.tests.filter(test => test.requirement_refs.includes(req.id)).map(test => test.id).join(", ")} | planned |`).join("\n");
  const traceMatrix = "| REQ | TEST | Status |\n|---|---|---|\n" + traceRows;
  const trace = `# Planned traceability — ${proposal.cycle_id}\n\n## Requirements\n${proposal.requirements.map(row => `- ${row.id}: ${text(row.statement)}`).join("\n") || "- Spike learning outcome; no production requirement declared."}\n\n## Planned mapping\n${traceMatrix}\n\n${proposal.tasks.map(row => `- ${row.id}: ${row.requirement_refs.join(", ") || "learning"} -> ${row.test_refs.join(", ")}`).join("\n")}\n\n## Status\n- Planned evidence only; no test execution or acceptance is claimed.\n`;
  if (proposal.spike) brief = optionalSection(brief, "Spike learning", `- Learning goal: ${text(proposal.spike.learning_goal)}\n- Timebox: ${text(proposal.spike.timebox)}\n- Decision target: ${text(proposal.spike.decision_target)}\n- Code may be throwaway.`);
  if (proposal.impact_notes) brief = optionalSection(brief, "Impact notes", bullets(proposal.impact_notes));
  if (proposal.rollback_strategy) brief = optionalSection(brief, "Rollback strategy", "- " + text(proposal.rollback_strategy));
  if (proposal.compatibility_strategy) brief = optionalSection(brief, "Compatibility strategy", "- " + text(proposal.compatibility_strategy));
  return Object.fromEntries(Object.entries({ "brief.md": brief, "plan.md": plan, "audit-spec.md": audit, "traceability.md": trace }).map(([name, content]) => [`${cyclePath}/${name}`, content]));
}
