import { execFileSync } from "node:child_process";
import { createStandardWorkflowArtifacts } from "./standard-workflow-artifacts.mjs";
import { createStandardWorkflowOperations } from "./standard-workflow-operations.mjs";
import { analyzeStructuredArtifact } from "../../lib/workflow/structured-artifact-parser-lib.mjs";
import { parseSessionMetadata } from "../../lib/workflow/session-context-lib.mjs";
import { shadowHash } from "../../core/workflow/shadow-json.mjs";
const fail = code => { throw Object.assign(Error(code), { code }); };
// Canonical observation only. No visible projection can repair a missing DB
// document, and no lifecycle write or human permission is inferred here.
export async function readStandardSessionClosureContext({ targetRoot, sessionId }) {
  const artifacts = createStandardWorkflowArtifacts({ targetRoot }), operations = createStandardWorkflowOperations({ targetRoot });
  const before = await operations.admitSessionClose({ session_id: sessionId });
  if (before.outcome !== "completed") return { blocked: "STANDARD_SESSION_CLOSURE_ADMISSION_BLOCKED", admission: before };
  const sessions = artifacts.sessions().filter(row => row.session_id === sessionId);
  if (sessions.length !== 1) fail("STANDARD_SESSION_CLOSURE_OWNER_REQUIRED");
  const selected = sessions[0], metadata = parseSessionMetadata(selected.content), fields = analyzeStructuredArtifact(selected.content).key_values;
  const admission = before.observations.admission;
  if (metadata.session_branch !== admission.mapped_session?.session_branch)
    fail("STANDARD_SESSION_CLOSURE_OWNER_CHANGED");
  const names = [selected.path, "CURRENT-STATE.md", "snapshots/context-snapshot.md", "baseline/current.md", "baseline/history.md", "index.md"];
  const owned = artifacts.cycles().filter(row => analyzeStructuredArtifact(row.content).key_values.session_owner === sessionId);
  if (owned.length > 48) fail("STANDARD_SESSION_CLOSURE_CONTEXT_LIMIT");
  for (const row of owned) names.push(row.path);
  const documents = [...new Set(names)].map(name => artifacts.read(name, { required: [selected.path, "CURRENT-STATE.md", "snapshots/context-snapshot.md"].includes(name) }))
    .filter(row => row.sha256 !== null).map(row => ({ ref: "audit:" + row.path, sha256: row.sha256, metadata_sha256: artifacts.metadataHash(row.path) }));
  if (documents.length > 64) fail("STANDARD_SESSION_CLOSURE_CONTEXT_LIMIT");
  const head = execFileSync("git", ["-C", artifacts.root, "-c", "core.hooksPath=NUL", "-c", "core.fsmonitor=false", "rev-parse", "HEAD"],
    { encoding: "utf8", windowsHide: true, stdio: "pipe", timeout: 10000, env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" } }).trim();
  const after = await operations.admitSessionClose({ session_id: sessionId });
  if (after.outcome !== "completed" || after.observations.scope_sha256 !== before.observations.scope_sha256
    || documents.some(row => { const name = row.ref.slice(6); return artifacts.read(name).sha256 !== row.sha256 || artifacts.metadataHash(name) !== row.metadata_sha256; }))
    fail("STANDARD_SESSION_CLOSURE_CONTEXT_CHANGED");
  const body = { session_id: sessionId, session_path: selected.path, mode: admission.mode, branch: admission.branch, session_branch: metadata.session_branch, head,
    admission_allowed: true, scope_sha256: before.observations.scope_sha256, documents,
    open_cycles: admission.open_cycles.map(row => row.cycle_id), session_close_gate_satisfied: metadata.close_gate_satisfied === true || fields.state === "CLOSED" };
  return { ...body, context_sha256: shadowHash(body) };
}
