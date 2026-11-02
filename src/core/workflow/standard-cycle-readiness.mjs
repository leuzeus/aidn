import { assertStandardCyclePlan, renderStandardCyclePlan } from "./standard-cycle-planning.mjs";
import { shadowHash } from "./shadow-json.mjs";

const fail = code => { throw Object.assign(new Error(code), { code }); };
// Evaluate only the recorded, authenticated planning component. The host supplies
// its canonical context and actual branch admission; authored facts grant nothing.
export function evaluateStandardCycleReadiness({ proposal, recordSha256, recordOperationId, context, contextSha256, branchAdmitted }) {
  assertStandardCyclePlan(proposal);
  const checks = [], check = (id, ok) => checks.push({ id, satisfied: ok === true });
  const docs = new Map(context.documents.map(row => [row.ref, row]));
  const read = name => docs.get(`audit:${context.cycle_path}/${name}.md`)?.content;
  check("committing_mode", context.mode === "COMMITTING");
  check("owned_active_cycle", branchAdmitted && context.context_use === "active_cycle" && context.cycle_state === "OPEN");
  check("explicit_intent", proposal.objective === context.original_objective && proposal.scope.length > 0 && proposal.non_scope.length > 0);
  check("constraints_and_risks", proposal.constraints.length > 0 && proposal.risks.length > 0);
  check("first_implementation_step", proposal.tasks[0]?.intent === "implementation" && proposal.tasks.every(row => row.intent === "implementation"));
  // SPEC-R04's minimum shared/high-risk matrix includes a context/edge usage.
  // A two-class proposal can be recorded, but must be completed before readiness.
  check("usage_matrix", proposal.surface === "local" || ["nominal", "alternate", "context"].every(kind => proposal.usage_matrix.some(row => row.kind === kind)));
  const rendered = renderStandardCyclePlan(proposal, context.cycle_path, { "brief.md": read("brief") });
  check("canonical_planning_matches", Object.entries(rendered).every(([name, content]) => docs.get("audit:" + name)?.content === content));
  check("adaptive_depth", proposal.cycle_type === context.cycle_type); // proposal validator enforces the type's actual depth and traceability.
  const ready = checks.every(row => row.satisfied);
  if (!/^[a-f0-9]{64}$/.test(recordSha256) || !/^op_[a-f0-9]{40}$/.test(recordOperationId)) fail("STANDARD_CYCLE_READINESS_RECORD_REQUIRED");
  return { contract_version: "standard-cycle-readiness-output.v1", operation_ref: "cycle_readiness_evaluate", outcome: ready ? "completed" : "blocked", effect_status: "no_effect",
    facts: ready ? { cycle_readiness_satisfied: true } : {}, observations: { checks, record_operation_id: recordOperationId, record_sha256: recordSha256,
      context_sha256: contextSha256, cycle_path: context.cycle_path, scope_sha256: shadowHash(proposal.tasks.map(({ task, intent, paths }) => ({ task, intent, paths }))),
      implementation: "not_authorized" }, evidence_refs: context.documents.map(({ ref, sha256 }) => ({ ref, sha256 })).slice(0, 24) };
}
