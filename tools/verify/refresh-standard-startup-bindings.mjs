#!/usr/bin/env node
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { standardWorkflowOperationBindings } from "../../src/application/runtime/standard-workflow-operations.mjs";
import { refreshStandardWorkflowComponentBindings } from "../../src/core/workflow/standard-workflow-model-catalog.mjs";
import { shadowHash } from "../../src/core/workflow/shadow-json.mjs";

const args = process.argv.slice(2);
if (args.some(arg => !["--write", "--cycle-create"].includes(arg)) || new Set(args).size !== args.length) throw Error("STANDARD_STARTUP_REFRESH_ARGUMENT_INVALID");
const cycle = args.includes("--cycle-create"), component = cycle ? "cycle-create" : "startup";
const root = new URL("../../", import.meta.url), read = path => fs.readFileSync(new URL(path, root));
const modelPath = `package/catalogs/process-models/aidn-standard-${component}.v1.json`, catalogPath = `package/catalogs/standard-workflow-${component}.v1.json`;
const before = { model: read(modelPath), catalog: read(catalogPath) }, model = JSON.parse(before.model), catalog = JSON.parse(before.catalog);
const skills = Object.fromEntries((cycle ? ["context-reload", "cycle-create", "branch-cycle-audit"] : ["context-reload", "start-session"]).map(id => { const path = `scaffold/codex/aidn-${id}/SKILL.md`; return [path, read(path)]; }));
const next = refreshStandardWorkflowComponentBindings({ model, catalog, specification: read("docs/SPEC.md"), skills, bindings: standardWorkflowOperationBindings() });
const write = process.argv.includes("--write");
if (write && next.changed.length) {
  if (!read(modelPath).equals(before.model) || !read(catalogPath).equals(before.catalog)) throw Error("STANDARD_STARTUP_SOURCE_CHANGED");
  // A partial source update fails catalog validation. Runtime never repairs it.
  for (const [path, value] of [[modelPath, next.model], [catalogPath, next.catalog]]) {
    const file = fileURLToPath(new URL(path, root)), temporary = `${file}.${process.pid}.tmp`;
    try { fs.writeFileSync(temporary, JSON.stringify(value, null, 2) + "\n", { flag: "wx" }); fs.renameSync(temporary, file); }
    finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
  }
}
console.log(JSON.stringify({ status: next.changed.length ? write ? "UPDATED" : "REFRESH_REQUIRED" : "PASS", written: write && next.changed.length > 0,
  changed_bindings: next.changed, previous_revision: model.revision, next_revision: next.model.revision,
  model_sha256: shadowHash(next.model), catalog_sha256: shadowHash(next.catalog) }));
if (next.changed.length && !write) process.exitCode = 1;
