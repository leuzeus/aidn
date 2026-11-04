import { createStandardWorkflowArtifacts } from "./standard-workflow-artifacts.mjs";
import { readWorkflowProjectAuthority } from "./workflow-instance-composition.mjs";
import { readControlledDriftGit } from "./standard-drift-git.mjs";
import { analyzeStructuredArtifact } from "../../lib/workflow/structured-artifact-parser-lib.mjs";
import { parseSessionMetadata } from "../../lib/workflow/session-context-lib.mjs";
import { shadowHash } from "../../core/workflow/shadow-json.mjs";

const fail = code => { throw Object.assign(new Error(code), { code }); };
// Canonical artifacts are read through the configured backend, including DB-only.
// No branch/cycle ownership requirement is inferred for read-only mode analysis.
export function readStandardModeWorkContext({ targetRoot, productSha256, productRoot, productFiles, deniedRoots = [], environment = process.env }) {
  if (!/^[a-f0-9]{64}$/.test(productSha256 ?? "")) fail("STANDARD_MODE_WORK_PRODUCT_REQUIRED");
  const artifacts = createStandardWorkflowArtifacts({ targetRoot, env: environment }), project = readWorkflowProjectAuthority({ targetRoot });
  const current = artifacts.read("CURRENT-STATE.md", { required: true }), state = analyzeStructuredArtifact(current.content).key_values;
  const session = artifacts.sessions().find(row => row.session_id === state.active_session);
  if (!session) fail("STANDARD_MODE_WORK_SESSION_REQUIRED");
  const metadata = parseSessionMetadata(session.content), fields = analyzeStructuredArtifact(session.content).key_values;
  if (!["THINKING", "EXPLORING"].includes(state.mode) || metadata.mode !== state.mode
    || state.session_branch !== metadata.session_branch) fail("STANDARD_MODE_WORK_MODE_REQUIRED");
  const objective = fields.session_objective;
  if (typeof objective !== "string" || !objective.trim() || objective.length > 4096) fail("STANDARD_MODE_WORK_OBJECTIVE_REQUIRED");
  const rows = [current, session, ...["SPEC.md", "WORKFLOW.md", "baseline/current.md", "snapshots/context-snapshot.md"].map(name => artifacts.read(name, { required: true }))];
  const git = readControlledDriftGit({ root: artifacts.root, productRoot, productFiles, observedDocuments: rows.map(row => "docs/audit/" + row.path), deniedRoots, environment });
  const context = { contract_version: "standard-mode-work-context.v1", session_id: session.session_id, mode: state.mode, objective,
    project_scope: project.scope, product_sha256: productSha256, git,
    documents: rows.map(row => ({ ref: "docs/audit/" + row.path, sha256: row.sha256, metadata_sha256: artifacts.metadataHash(row.path), content: row.content })) };
  if (Buffer.byteLength(JSON.stringify(context)) > 196608) fail("STANDARD_MODE_WORK_CONTEXT_TOO_LARGE");
  return { context, context_sha256: shadowHash(context), evidence_refs: [...context.documents.map(({ ref, sha256 }) => ({ ref, sha256 })),
    { ref: "git:diff", sha256: git.diff_sha256 }, { ref: "git:status", sha256: git.status_sha256 }] };
}
