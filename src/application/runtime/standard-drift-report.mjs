import path from "node:path";
import { createStandardWorkflowArtifacts } from "./standard-workflow-artifacts.mjs";
import { readWorkflowProjectAuthority } from "./workflow-instance-composition.mjs";
import { analyzeStructuredArtifact } from "../../lib/workflow/structured-artifact-parser-lib.mjs";
import { shadowHash } from "../../core/workflow/shadow-json.mjs";
import { assertStandardDriftReport } from "../../core/workflow/native-activity-output.mjs";
import { readControlledDriftGit, assertDiagnosticPathScope } from "./standard-drift-git.mjs";
import { runCycleCloseAdmitUseCase } from "./cycle-close-admit-use-case.mjs";
import { AIDN_BRANCH_KIND } from "../../lib/workflow/branch-kind-lib.mjs";
import { parseSessionMetadata } from "../../lib/workflow/session-context-lib.mjs";

const fail = code => { throw Object.assign(new Error(code), { code }); };
// A comparison preimage, never an admission or cached observation. Every fence
// invocation rereads canonical artifacts/metadata, inventory, product and Git
// synchronously. In particular, DB-only never substitutes a visible projection.
export function captureStandardDriftContextFence({ targetRoot, observed, productRoot, productFiles,
  readProductSha256, deniedRoots = [], environment = process.env }) {
  const artifacts = createStandardWorkflowArtifacts({ targetRoot, env: environment }), context = observed.context;
  const optional = ["baseline/history.md", "index.md", "RUNTIME-STATE.md", "parking-lot.md"];
  const names = [...new Set([...context.documents.map(row => row.ref.slice(6)), ...optional, "WORKFLOW-KERNEL.md"])].sort();
  function witness() {
    const project = readWorkflowProjectAuthority({ targetRoot });
    const documents = names.map(name => ({ ...artifacts.read(name), metadata_sha256: artifacts.metadataHash(name) }));
    for (const expected of context.documents) {
      const actual = documents.find(row => "audit:" + row.path === expected.ref);
      if (!actual || actual.sha256 !== expected.sha256 || actual.content !== expected.content)
        fail("STANDARD_DRIFT_DIAGNOSIS_REQUEST_STALE");
    }
    if (optional.some(name => !context.documents.some(row => row.ref === "audit:" + name)
      && documents.find(row => row.path === name).sha256 !== null)) fail("STANDARD_DRIFT_DIAGNOSIS_REQUEST_STALE");
    const git = readControlledDriftGit({ root: artifacts.root, productRoot, productFiles, deniedRoots, environment,
      observedDocuments: context.documents.map(row => "docs/audit/" + row.ref.slice(6)) });
    if (readProductSha256() !== context.product_sha256 || shadowHash(project.scope) !== context.project_scope_sha256
      || shadowHash(git) !== shadowHash(context.git)) fail("STANDARD_DRIFT_DIAGNOSIS_REQUEST_STALE");
    const inventory = rows => rows.map(row => ({ path: row.path, sha256: row.sha256, metadata_sha256: artifacts.metadataHash(row.path) }));
    return shadowHash({ project, documents, sessions: inventory(artifacts.sessions()), cycles: inventory(artifacts.cycles()), git });
  }
  const before = witness();
  return () => { if (witness() !== before) fail("STANDARD_DRIFT_DIAGNOSIS_REQUEST_STALE"); };
}
// Read canonical business state. Visible projections are never a DB fallback.
export async function readStandardDriftContext({ targetRoot, productSha256, productRoot, productFiles, deniedRoots = [], environment = process.env }) {
  if (!/^[a-f0-9]{64}$/.test(productSha256 ?? "")) fail("STANDARD_DRIFT_PRODUCT_REQUIRED");
  if (Object.keys(environment).some(key => /^GIT_(DIR|WORK_TREE|COMMON_DIR|INDEX_FILE|OBJECT_DIRECTORY|ALTERNATE_OBJECT_DIRECTORIES|NAMESPACE|CONFIG(?:_.*)?)$/i.test(key))) fail("STANDARD_GIT_ENV_SCOPE_CONFLICT");
  const artifacts = createStandardWorkflowArtifacts({ targetRoot, env: environment }), project = readWorkflowProjectAuthority({ targetRoot });
  const current = artifacts.read("CURRENT-STATE.md", { required: true }), fields = analyzeStructuredArtifact(current.content).key_values;
  const topology = artifacts.observeTopology();
  const session = topology.sessions().find(row => row.session_id === fields.active_session);
  if (!session) fail("STANDARD_DRIFT_SESSION_REQUIRED");
  const mode = parseSessionMetadata(session.content).mode;
  if (!["THINKING", "EXPLORING", "COMMITTING"].includes(mode) || mode !== fields.mode)
    fail("STANDARD_DRIFT_MODE_CHANGED");
  const cycles = topology.cycles(), activeCycleId = fields.active_cycle && fields.active_cycle !== "none" ? fields.active_cycle : null;
  let cycleId = activeCycleId, cycle = cycleId ? cycles.find(row => row.cycle_id === cycleId) : null, completion = null;
  if (cycleId && !cycle) fail("STANDARD_DRIFT_CYCLE_REQUIRED");
  const cycleState = row => row ? analyzeStructuredArtifact(row.content).key_values.state : null;
  const terminal = state => ["DONE", "NO_GO", "DROPPED"].includes(state);
  // The closure application alone may recover a terminal owning cycle. A missing
  // active anchor never permits guessing an open/unrelated cycle or session goal.
  const admission = await runCycleCloseAdmitUseCase({ targetRoot: artifacts.root, mode });
  const ownsBranch = mode === "COMMITTING" && [AIDN_BRANCH_KIND.CYCLE, AIDN_BRANCH_KIND.INTERMEDIATE].includes(admission.branch_kind);
  if (ownsBranch) {
    if (admission.ok !== true) throw Object.assign(new Error("STANDARD_DRIFT_COMPLETION_ADMISSION_BLOCKED"), {
      code: "STANDARD_DRIFT_COMPLETION_ADMISSION_BLOCKED", admission_reason: admission.reason_code });
    const target = admission.target_cycle, selected = cycles.find(row => row.cycle_id === target?.cycle_id);
    if (!selected || cycleState(selected) !== target.state
      || admission.active_session !== fields.active_session || admission.active_cycle !== (fields.active_cycle ?? "none")
      || activeCycleId && activeCycleId !== target.cycle_id) fail("STANDARD_DRIFT_COMPLETION_CONTEXT_REQUIRED");
    if (terminal(target.state)) {
      cycleId = target.cycle_id; cycle = selected; completion = { branch: admission.branch, branch_kind: admission.branch_kind,
        cycle_id: cycleId, cycle_state: target.state, admission_reason: admission.reason_code };
    } else if (!activeCycleId) fail("STANDARD_DRIFT_COMPLETION_CONTEXT_REQUIRED");
  } else if (mode === "COMMITTING" && (terminal(cycleState(cycle)) || !cycle && cycles.some(row => analyzeStructuredArtifact(row.content).key_values.branch_name === admission.branch))) {
    fail("STANDARD_DRIFT_COMPLETION_CONTEXT_REQUIRED");
  }
  const brief = cycle ? artifacts.read(cycle.path.replace(/status\.md$/, "brief.md"), { required: true }) : null;
  const objectiveSection = brief ? /^##\s+Objective\s*\r?\n([\s\S]*?)(?=^##?\s|$(?![\s\S]))/m.exec(brief.content)?.[1]?.trim() : null;
  const objective = brief ? objectiveSection?.replace(/^\s*-\s*/, "").replace(/\s+/gu, " ").trim() : analyzeStructuredArtifact(session.content).key_values.session_objective;
  if (!objective || objective.length > 4096) fail("STANDARD_DRIFT_OBJECTIVE_REQUIRED");
  const required = ["SPEC.md", "WORKFLOW.md", "baseline/current.md", "snapshots/context-snapshot.md"];
  // Baseline finalization writes these canonical artifacts too. They must be
  // observed before a later session-close R05.
  const sessionPaths = [...required, "baseline/history.md", "index.md", "RUNTIME-STATE.md", "parking-lot.md"];
  const cyclePaths = cycle ? ["plan.md", "change-requests.md", "hypotheses.md", "audit-spec.md", "traceability.md", "decisions.md"]
    .map(name => cycle.path.replace(/status\.md$/, name)) : [];
  const observed = artifacts.readMany([...sessionPaths, ...cyclePaths], { required: [...required, ...cyclePaths.slice(0, 2)] });
  const present = row => row.sha256 !== null;
  const documents = [...observed.slice(0, sessionPaths.length).filter(present), current, session];
  if (cycle) documents.push(cycle, brief, ...observed.slice(sessionPaths.length).filter(present));
  for (const row of documents) assertDiagnosticPathScope(path.join(artifacts.root, "docs/audit", row.path), deniedRoots);
  const git = readControlledDriftGit({ root: artifacts.root, productRoot, productFiles, deniedRoots, environment,
    observedDocuments: documents.map(row => "docs/audit/" + row.path) });
  if (admission.branch !== git.branch) fail("STANDARD_DRIFT_CONTEXT_CHANGED");
  const body = { contract_version: "standard-drift-context.v2", mode, project_scope_sha256: shadowHash(project.scope),
    branch: git.branch, head: git.head, product_sha256: productSha256,
    session_id: session.session_id, cycle_id: cycleId, original_objective: objective,
    context_use: completion ? "cycle_completion" : cycle ? "active_cycle" : "session", cycle_state: cycleState(cycle),
    ...(completion ? { completion } : {}),
    documents: documents.map(row => ({ ref: "audit:" + row.path, sha256: row.sha256, content: row.content })),
    git };
  if (Buffer.byteLength(JSON.stringify(body)) > 196608) fail("STANDARD_DRIFT_CONTEXT_TOO_LARGE");
  return { context: body, context_sha256: shadowHash(body), evidence_refs: [...body.documents.map(({ ref, sha256 }) => ({ ref, sha256 })),
    { ref: "git:diff", sha256: body.git.diff_sha256 }, { ref: "git:status", sha256: body.git.status_sha256 }] };
}
export function evaluateStandardDriftReport(authenticated, current) {
  const report = assertStandardDriftReport(authenticated.report);
  if (report.context_sha256 !== current.context_sha256 || report.original_objective !== current.context.original_objective) fail("STANDARD_DRIFT_REPORT_STALE");
  for (const ref of report.evidence_refs) if (!current.evidence_refs.some(row => row.ref === ref.ref && row.sha256 === ref.sha256)) fail("STANDARD_DRIFT_REPORT_EVIDENCE_INVALID");
  // This evaluates the diagnostic. It neither completes R05 nor handles recovery.
  const count = current.context.git?.other_changes?.count, complete = Number.isSafeInteger(count) && count === 0;
  return { contract_version: "standard-drift-output.v1", operation_ref: "drift_report_evaluate", outcome: "completed", effect_status: "no_effect",
    facts: { drift_report_available: true, drift_present: report.drift_level !== "none", drift_recovery_required: report.drift_level !== "none" || !complete, drift_context_complete: complete,
      drift_check_completed: false },
    observations: { report, producer: authenticated.producer, scope: { session_id: current.context.session_id, cycle_id: current.context.cycle_id,
      ...(current.context.context_use ? { context_use: current.context.context_use, cycle_state: current.context.cycle_state } : {}) },
      skill_completion: "pending", recovery_writes_authorized: false, coverage: { context_complete: complete, other_changes: count ?? null,
        diff_scope: current.context.git?.diff_scope ?? null } }, evidence_refs: [authenticated.reference] };
}
