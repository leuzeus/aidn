import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { buildStandardCycleAuditContext } from "../../src/application/runtime/standard-cycle-audit-context.mjs";
import { createProjectArtifactStore } from "../../src/application/runtime/project-artifact-store-service.mjs";
import { shadowHash, checkShadowJson } from "../../src/core/workflow/shadow-json.mjs";
const temporary = fs.realpathSync(os.tmpdir()), H = "a".repeat(64), op = "op_" + "b".repeat(40);
let checks = 0; const pass = name => { checks++; console.log("PASS " + name); };
for (const mode of ["files", "dual", "db-only"]) {
  const root = fs.mkdtempSync(path.join(temporary, "aidn-audit-context-"));
  try {
    fs.mkdirSync(path.join(root, ".aidn")); fs.mkdirSync(path.join(root, "docs/audit"), { recursive: true });
    fs.writeFileSync(path.join(root, ".aidn/config.json"), JSON.stringify({ runtime: { stateMode: mode, persistence: { backend: "sqlite" } } }));
    const write = (name, content, runtime = false) => {
      if (mode === "files") { const file = path.join(root, "docs/audit", name); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, content); }
      else {
        const store = createProjectArtifactStore({ targetRoot: root, existingOnly: false });
        try { store.upsertArtifact({ path: name, kind: runtime ? "process_operation_journal" : "other", family: runtime ? "runtime" : "normative", content_format: "utf8", content }); }
        finally { store.close(); }
      }
    };
    const cycle = "cycles/C001-feature-fixture", names = ["SPEC.md", "WORKFLOW.md", "WORKFLOW-KERNEL.md", ...["brief", "plan", "audit-spec", "traceability", "decisions", "change-requests", "status"].map(name => cycle + "/" + name + ".md")];
    const specification = fs.readFileSync(new URL("../../docs/SPEC.md", import.meta.url), "utf8") + "\n" + "😀".repeat(9000);
    assert.ok(specification.length > 16384);
    for (const name of names) write(name, name === "SPEC.md" ? specification : "# Audit context fixture\n");
    const files = [{ path: "app.mjs", present: true, sha256: H }], product = shadowHash(files);
    const context = { cycle_state: "VERIFYING", mode: "COMMITTING", cycle_path: cycle, product_sha256: product, project_scope_sha256: H,
      branch: "fixture", head: "a".repeat(40), session_id: "S001", cycle_id: "C001" };
    const bridge = { context, context_sha256: shadowHash(context), source: { work: { files, output: { observations: { scope_sha256: H, implementation_operation_id: op } } }, proposal: {} }, verification: { record: { operation_id: op } } };
    const read = () => buildStandardCycleAuditContext({ targetRoot: root, bridge, validation: { product_sha256: product, evidence_refs: [] } });
    const initial = read(), spec = initial.context.audit_documents.find(row => row.ref === "audit:SPEC.md");
    assert.equal(checkShadowJson(initial.context), null); assert.equal(spec.content_chunks.join(""), specification);
    assert.ok(spec.content_chunks.every(text => text.length <= 8192)); assert.equal(spec.sha256, createHash("sha256").update(specification).digest("hex"));
    assert.equal(initial.context.canonical_inventory_complete, true); assert.equal(initial.context.canonical_inventory_scope.cycle_path, cycle);
    pass(`${mode}: full normative text and Unicode survive bounded lossless chunks under the existing JSON limits`);
    write("workflows/operation-records/" + op + ".json", "{}", true);
    const dispatch = read(); assert.equal(dispatch.context_sha256, initial.context_sha256);
    assert.equal(dispatch.context.canonical_inventory_sha256, initial.context.canonical_inventory_sha256);
    pass(`${mode}: unrelated durable dispatch records do not invalidate the audit document scope`);
    write(cycle + "/decisions.md", "# Changed audit decision\n");
    const changed = read(); assert.notEqual(changed.context_sha256, initial.context_sha256);
    pass(`${mode}: a required document change still invalidates the exact audit context`);
    write(cycle + "/gap-report.md", "# Newly present conditional gap report\n");
    const conditional = read(); assert.notEqual(conditional.context_sha256, changed.context_sha256);
    assert.notEqual(conditional.context.canonical_inventory_sha256, changed.context.canonical_inventory_sha256);
    assert.ok(conditional.context.audit_documents.some(row => row.ref === "audit:" + cycle + "/gap-report.md"));
    if (mode === "db-only") assert.equal(fs.existsSync(path.join(root, "docs/audit", cycle, "gap-report.md")), false);
    pass(`${mode}: new canonical conditional documents invalidate and enter the audit without requiring a projection`);
    write("SPEC.md", "x".repeat(200000));
    assert.throws(read, { code: "STANDARD_AUDIT_CONTEXT_LIMIT" });
    pass(`${mode}: the total context ceiling still rejects oversize material without truncation`);
  } finally {
    const resolved = fs.realpathSync(root); assert.equal(path.dirname(resolved), temporary); assert.ok(path.basename(resolved).startsWith("aidn-audit-context-"));
    fs.rmSync(resolved, { recursive: true, force: true });
  }
}
console.log(JSON.stringify({ status: "PASS", checks, proof: "audit-context-component", authenticated_bridge: "fixture", full_workflow: "NOT_RUN", native: "NOT_RUN", installed_archive: "NOT_RUN" }));
