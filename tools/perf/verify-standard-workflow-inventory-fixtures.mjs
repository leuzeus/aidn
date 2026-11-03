import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createStandardWorkflowArtifacts } from "../../src/application/runtime/standard-workflow-artifacts.mjs";
import { createProjectArtifactStore } from "../../src/application/runtime/project-artifact-store-service.mjs";
import { buildCanonicalFromMarkdown } from "../../src/lib/workflow/markdown-render-lib.mjs";
import { shadowHash } from "../../src/core/workflow/shadow-json.mjs";
const temporary = fs.realpathSync(os.tmpdir()), root = fs.mkdtempSync(path.join(temporary, "aidn-audit-inventory-"));
const sourceConfig = JSON.parse(fs.readFileSync(new URL("../../tests/fixtures/repo-installed-core/.aidn/config.json", import.meta.url)));
let checks = 0; const pass = name => { checks++; console.log("PASS " + name); };
try {
  fs.mkdirSync(path.join(root, ".aidn")); fs.mkdirSync(path.join(root, "docs/audit/notes"), { recursive: true });
  const config = structuredClone(sourceConfig); config.runtime.stateMode = "files"; config.runtime.persistence = { backend: "sqlite" };
  const configPath = path.join(root, ".aidn/config.json"); fs.writeFileSync(configPath, JSON.stringify(config));
  fs.writeFileSync(path.join(root, "docs/audit/CURRENT-STATE.md"), "# Local fixture\n");
  fs.writeFileSync(path.join(root, "docs/audit/notes/Notes with spaces é.md"), "# Human-readable name\n");
  const artifacts = createStandardWorkflowArtifacts({ targetRoot: root }), before = fs.readdirSync(path.join(root, ".aidn"));
  const inventory = artifacts.inventory();
  assert.equal(inventory.complete, true); assert.equal(inventory.source, "files");
  assert.deepEqual(inventory.paths, ["CURRENT-STATE.md", "notes/Notes with spaces é.md"]); assert.equal(inventory.sha256, shadowHash(inventory.paths));
  assert.deepEqual(artifacts.inventory(), inventory); assert.deepEqual(fs.readdirSync(path.join(root, ".aidn")), before);
  pass("complete file inventory includes human-readable names without writing a store or projection");
  const outside = path.join(root, "outside"); fs.mkdirSync(outside); fs.writeFileSync(path.join(outside, "foreign.md"), "# Outside\n");
  const link = path.join(root, "docs/audit/redirect"); fs.symlinkSync(outside, link, process.platform === "win32" ? "junction" : "dir");
  assert.throws(() => artifacts.inventory()); fs.unlinkSync(link); pass("redirected inventory refuses rather than following an outside tree");
  config.runtime.stateMode = "db-only"; fs.writeFileSync(configPath, JSON.stringify(config));
  assert.throws(() => artifacts.inventory(), { code: "STANDARD_CANONICAL_STORE_UNAVAILABLE" }); pass("a missing canonical database never falls back to visible files");
  const store = createProjectArtifactStore({ targetRoot: root, readOnly: false, existingOnly: false });
  try {
    const name = "canonical/gap-report.md", content = "# Canonical gap report\n";
    store.upsertArtifact({ path: name, kind: "other", family: "normative", content_format: "utf8", content, canonical_format: "markdown-canonical-v1",
      canonical: buildCanonicalFromMarkdown(content, { relativePath: name, classification: { kind: "other", family: "normative" } }) });
  } finally { store.close(); }
  const canonical = artifacts.inventory(); assert.equal(canonical.complete, true); assert.equal(canonical.source, "sqlite");
  assert.deepEqual(canonical.paths, ["canonical/gap-report.md"]); assert.equal(fs.existsSync(path.join(root, "docs/audit/canonical/gap-report.md")), false);
  pass("database inventory reads the canonical store and leaves db-only projections absent");
  console.log(JSON.stringify({ status: "PASS", checks, proof: "offline-canonical-inventory-component", native: "NOT_RUN", installed_archive: "NOT_RUN" }));
} finally {
  if (path.dirname(fs.realpathSync(root)) !== temporary || !path.basename(root).startsWith("aidn-audit-inventory-")) throw Error("INVENTORY_FIXTURE_CLEANUP_SCOPE_INVALID");
  fs.rmSync(root, { recursive: true, force: true });
}
