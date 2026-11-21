import { assertStandardCyclePlan, renderStandardCyclePlan, CYCLE_PLAN_CONTRACT } from "./standard-cycle-planning.mjs";
import { renderStandardTaskProgress } from "./standard-cycle-task-progress.mjs";
import { artifactContentHash } from "./artifact-compare-swap.mjs";
import { shadowHash, checkShadowJson } from "./shadow-json.mjs";

const requireValue = condition => { if (!condition) throw Object.assign(Error("STANDARD_CANONICAL_PLAN_UNREPRESENTABLE"), { code: "STANDARD_CANONICAL_PLAN_UNREPRESENTABLE" }); };
const decode = value => value.replaceAll("&#58;", ":");
const refs = value => ["none", "learning"].includes(value) ? [] : value.split(", ");
function section(text, title, optional = false) {
  const escaped = title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const matches = [...text.matchAll(new RegExp("^## " + escaped + "\\r?\\n([\\s\\S]*?)(?=^## |$(?![\\s\\S]))", "gm"))];
  requireValue(matches.length === 1 || optional && matches.length === 0);
  return matches[0]?.[1].trim() ?? null;
}
function bullets(value) {
  const lines = value.split("\n"); requireValue(lines.length > 0 && lines.every(line => line.startsWith("- ") && line.length > 2));
  return lines.map(line => decode(line.slice(2)));
}
function blocks(value, pattern) {
  const result = [...value.matchAll(pattern)]; requireValue(result.length > 0); return result;
}

// A reversible data projection only. Neither supplied canonical bytes nor this
// function authenticate approval, completed work, readiness or an effect grant.
// The owning host must separately bind current source/metadata and provenance.
function projectCanonicalPlanData(observed, retainVerificationHistory = false) {
  const { context, context_sha256: contextSha } = observed;
  requireValue(context && shadowHash(context) === contextSha && Array.isArray(context.documents));
  const documents = new Map(context.documents.map(row => [row.ref, row]));
  requireValue(documents.size === context.documents.length);
  const names = ["brief", "plan", "audit-spec", "traceability"];
  const material = Object.fromEntries(names.map(name => {
    const row = documents.get(`audit:${context.cycle_path}/${name}.md`);
    requireValue(row && typeof row.content === "string" && artifactContentHash(row.content) === row.sha256);
    return [name, row.content];
  }));
  const plan = material.plan, brief = material.brief, fullTrace = material.traceability, audit = material["audit-spec"];
  const retained = retainVerificationHistory ? retainedVerification(fullTrace) : null, trace = retained ? retained.body : fullTrace;
  requireValue(shadowHash(bullets(section(brief, "Objective"))) === shadowHash([context.original_objective]));
  const scopeBlock = section(plan, "Native write scope"), json = /^```json\n([\s\S]+)\n```$/.exec(scopeBlock);
  requireValue(json); let scope;
  try { scope = JSON.parse(json[1]); } catch { requireValue(false); }
  requireValue(scope?.version === 1 && Array.isArray(scope.tasks) && scope.tasks.every(row => row && typeof row === "object" && !Array.isArray(row)));
  requireValue(shadowHash(scope) === shadowHash({ version: 1, tasks: scope.tasks.map(({ task, intent, paths }) => ({ task, intent, paths })) }));
  const taskLines = section(plan, "Tasks").split("\n").map(line => /^(\d+)\. (?:\[([ x])\] )?(.+)$/.exec(line));
  requireValue(taskLines.length === scope.tasks.length && taskLines.every((row, index) => row && Number(row[1]) === index + 1 && row[3] === scope.tasks[index].task));
  const done = blocks(section(plan, "Done criteria (per task)"), /^### (TASK-[0-9]{3,6})\n([\s\S]*?)(?=^### |$(?![\s\S]))/gm);
  const mapping = new Map([...trace.matchAll(/^- (TASK-[0-9]{3,6}): ([^\n]+) -> ([^\n]+)$/gm)].map(row => [row[1], { requirement_refs: refs(row[2]), test_refs: refs(row[3]) }]));
  requireValue(done.length === scope.tasks.length && mapping.size === done.length);
  const tasks = scope.tasks.map((row, index) => {
    const id = done[index][1]; requireValue(mapping.has(id));
    return { id, ...row, ...mapping.get(id), done_criteria: bullets(done[index][2].trim()) };
  });
  const completed = tasks.filter((_row, index) => taskLines[index][2] === "x").map(row => row.id);
  requireValue(shadowHash(completed) === shadowHash(tasks.slice(0, completed.length).map(row => row.id)));
  const progress = section(plan, "Process task progress", true);
  if (progress !== null) {
    const match = /^contract_version: standard-cycle-task-progress\.v1\ncompleted_task_ids: ([^\n]+)$/.exec(progress); requireValue(match);
    let declared; try { declared = JSON.parse(match[1]); } catch { requireValue(false); }
    requireValue(shadowHash(declared) === shadowHash(completed));
  }
  const matrix = section(plan, "Usage Matrix"), surface = /^Scope: (local|shared|high-risk)\n/.exec(matrix); requireValue(surface);
  const rows = matrix.split("\n").filter(line => line.startsWith("|")).slice(2).map(line => line.split("|").slice(1, -1).map(value => value.trim()));
  requireValue(rows.length > 0 && rows.every(row => row.length === 4));
  const usage = rows.map(([kind, scenario, difference, tests]) => ({ kind, scenario: decode(scenario), constraint_difference: decode(difference), test_refs: refs(tests) }));
  const requirementsText = section(trace, "Requirements");
  const requirements = context.cycle_type === "spike" && requirementsText === "- Spike learning outcome; no production requirement declared." ? []
    : requirementsText.split("\n").map(line => { const row = /^- (REQ-[0-9]{3,6}): (.+)$/.exec(line); requireValue(row); return { id: row[1], statement: decode(row[2]) }; });
  const tests = blocks(section(audit, "Planned tests"), /^### (TEST-[0-9]{3,6})\n- Method: ([^\n]+)\n- Expected: ([^\n]+)\n- Requirements: ([^\n]+)(?=\n|$)/gm)
    .map(row => ({ id: row[1], method: decode(row[2]), expected: decode(row[3]), requirement_refs: refs(row[4]) }));
  const optionalBullets = title => { const text = section(brief, title, true); return text === null ? null : bullets(text); };
  const optionalScalar = title => { const values = optionalBullets(title); requireValue(values === null || values.length === 1); return values?.[0] ?? null; };
  const spikeText = section(brief, "Spike learning", true); let spike = null;
  if (spikeText !== null) {
    const row = /^- Learning goal: ([^\n]+)\n- Timebox: ([^\n]+)\n- Decision target: ([^\n]+)\n- Code may be throwaway\.$/.exec(spikeText); requireValue(row);
    spike = { learning_goal: decode(row[1]), timebox: decode(row[2]), decision_target: decode(row[3]) };
  }
  const sourceRefs = names.map(name => documents.get(`audit:${context.cycle_path}/${name}.md`)).map(({ ref, sha256 }) => ({ ref, sha256 }));
  const proposal = assertStandardCyclePlan({ contract_version: CYCLE_PLAN_CONTRACT, context_sha256: contextSha, session_id: context.session_id, cycle_id: context.cycle_id,
    cycle_type: context.cycle_type, objective: context.original_objective, scope: bullets(section(brief, "Scope")), non_scope: bullets(section(brief, "Non-scope")),
    constraints: bullets(section(brief, "Constraints")), risks: bullets(section(brief, "Risks")), surface: surface[1], usage_matrix: usage, requirements, tests, tasks,
    architecture_notes: bullets(section(audit, "Architecture audit")), impact_notes: optionalBullets("Impact notes"), rollback_strategy: optionalScalar("Rollback strategy"),
    compatibility_strategy: optionalScalar("Compatibility strategy"), spike, evidence_refs: sourceRefs });
  const rendered = renderStandardCyclePlan(proposal, context.cycle_path, { "brief.md": brief });
  for (const name of names) {
    const file = `${context.cycle_path}/${name}.md`, expected = name === "plan" ? renderStandardTaskProgress({ originalPlan: rendered[file], proposal, completedTaskIds: completed }) : rendered[file];
    const complete = name === "traceability" && retained ? expected.trimEnd() + retained.suffix : expected;
    requireValue(complete === material[name]);
  }
  return { proposal, original_plan: rendered[`${context.cycle_path}/plan.md`], completed_task_ids: completed, source_refs: sourceRefs,
    ...(retainVerificationHistory ? { retained_verification_history: retained ? { source_ref: "audit:" + context.cycle_path + "/traceability.md",
      document_sha256: documents.get("audit:" + context.cycle_path + "/traceability.md").sha256, section_sha256: artifactContentHash(retained.suffix),
      raw_section: retained.suffix, evaluation_operation_id: retained.sections[0].evaluation_operation_id, sections: retained.sections, current_validation_evidence: false } : null } : {}) };
}

// The historical API retains its exact projection/rejection behavior.
export function projectStandardCanonicalCyclePlan(observed) {
  return projectCanonicalPlanData(observed, false);
}
function retainedVerification(text) {
  const marker = "\n\n## Process verification evidence\n\n", parts = text.split(marker);
  if (parts.length === 1) { requireValue(!/^## Process verification evidence\s*$/m.test(text)); return null; }
  const suffix = text.slice(parts[0].length), ticks = String.fromCharCode(96).repeat(3);
  requireValue(Buffer.byteLength(suffix) <= 1048576);
  const opening = marker + "No lifecycle completion is inferred from these checks.\n\n" + ticks + "json\n", ending = "\n" + ticks + "\n";
  const sections = parts.slice(1).map(part => {
    const raw = marker + part;
    requireValue(raw.startsWith(opening) && raw.endsWith(ending));
    let data; try { data = JSON.parse(raw.slice(opening.length, -ending.length)); } catch { requireValue(false); }
    requireValue(data && typeof data === "object" && !Array.isArray(data) && !checkShadowJson(data)
      && /^op_[a-f0-9]{40}$/.test(data.evaluation_operation_id ?? ""));
    return { raw_section: raw, section_sha256: artifactContentHash(raw), evaluation_operation_id: data.evaluation_operation_id, current_validation_evidence: false };
  });
  requireValue(sections.map(row => row.raw_section).join("") === suffix);
  return { body: parts[0], suffix, sections };
}
// A derived data view. Retained verification bytes are historical data, never a
// current validation receipt, imported work acceptance or phase/effect authority.
export function projectStandardCanonicalCycleProgress(observed) {
  requireValue(observed?.context && ["OPEN", "IMPLEMENTING", "VERIFYING"].includes(observed.context.cycle_state));
  return { source_kind: "canonical_progress", ...projectCanonicalPlanData(observed, true), phase: observed.context.cycle_state,
    current_phase_admission: false, current_validation_evidence: false, implementation_authorized: false };
}
