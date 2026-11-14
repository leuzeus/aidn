import { createStandardWorkflowArtifacts } from "./standard-workflow-artifacts.mjs";
import { readStandardDriftContext } from "./standard-drift-report.mjs";
import { assertDiagnosticPathScope } from "./standard-drift-git.mjs";
import { analyzeStructuredArtifact } from "../../lib/workflow/structured-artifact-parser-lib.mjs";
import { shadowHash } from "../../core/workflow/shadow-json.mjs";
import { cycleClosePaths } from "../../core/workflow/standard-cycle-close-render.mjs";
import path from "node:path";
const fail = code => { throw Object.assign(new Error(code), { code }); };

// Active VERIFYING and the unique terminal owning cycle use the existing SPEC
// closure admission. Reading a terminal cycle does not reactivate it.
export async function readStandardCycleCloseContext(options) {
  const observed = await readStandardDriftContext(options), source = observed.context;
  if (!source.cycle_id || !["VERIFYING", "DONE", "NO_GO", "DROPPED"].includes(source.cycle_state)) fail("STANDARD_CYCLE_CLOSE_CONTEXT_REQUIRED");
  const artifacts = createStandardWorkflowArtifacts({ targetRoot: options.targetRoot, env: options.environment });
  const current = artifacts.read("CURRENT-STATE.md", { required: true }), fields = analyzeStructuredArtifact(current.content).key_values;
  if (fields.mode !== "COMMITTING" || source.cycle_state === "VERIFYING" && (source.context_use !== "active_cycle" || fields.active_cycle !== source.cycle_id)
    || source.cycle_state !== "VERIFYING" && (source.context_use !== "cycle_completion" || fields.active_cycle !== "none")) fail("STANDARD_CYCLE_CLOSE_CONTEXT_REQUIRED");
  const statusRefs = source.documents.filter(row => new RegExp("^audit:cycles/" + source.cycle_id + "-[a-z]+-[A-Za-z0-9._-]+/status\\.md$").test(row.ref));
  if (statusRefs.length !== 1) fail("STANDARD_CYCLE_CLOSE_CONTEXT_REQUIRED");
  const cyclePath = statusRefs[0].ref.slice(6).replace(/\/status\.md$/, ""), names = cycleClosePaths(cyclePath);
  const inventory = artifacts.inventory(); if (!inventory.complete) fail("STANDARD_CYCLE_CLOSE_INVENTORY_REQUIRED");
  const documents = [...source.documents], add = name => {
    if (documents.some(row => row.ref === "audit:" + name)) return;
    const row = artifacts.read(name, { required: true });
    assertDiagnosticPathScope(path.join(artifacts.root, "docs/audit", name), options.deniedRoots ?? []);
    documents.push({ ref: "audit:" + row.path, sha256: row.sha256, content: row.content });
  };
  for (const name of ["WORKFLOW-KERNEL.md", ...names]) add(name);
  for (const name of ["gap-report.md", "hypotheses.md"].map(name => cyclePath + "/" + name)) if (inventory.paths.includes(name)) add(name);
  const context = { ...source, contract_version: "standard-cycle-close-context.v1", mode: fields.mode, cycle_path: cyclePath, documents,
    metadata_pins: documents.map(row => ({ ref: row.ref, sha256: artifacts.metadataHash(row.ref.slice(6)) })),
    inventory_scope_sha256: shadowHash(inventory.paths.filter(name => name.startsWith(cyclePath + "/") || ["SPEC.md", "WORKFLOW.md", "WORKFLOW-KERNEL.md"].includes(name))) };
  if (Buffer.byteLength(JSON.stringify(context)) > 196608) fail("STANDARD_CYCLE_CLOSE_CONTEXT_LIMIT");
  return { context, context_sha256: shadowHash(context) };
}
