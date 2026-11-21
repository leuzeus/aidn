import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { processModels } from "../../src/core/workflow/process-call-model.mjs";
import { compileBpmnProject } from "../../src/application/workflow/bpmn-project-service.mjs";
import { exactKeys, processId } from "../../src/core/workflow/agentic-process-model.mjs";
import { projectDiagramName } from "../../src/core/workflow/bpmn-project-diagram.mjs";
import { shadowHash } from "../../src/core/workflow/shadow-json.mjs";
import { validateJsonSchema, validateJsonSchemaDefinition } from "../../src/core/contracts/json-schema-validator.mjs";
import transferSchema from "../../src/core/contracts/workflow-definition/workflow-transfer.v1.schema.json" with { type: "json" };

import standardRoles from "../../package/catalogs/standard-role-profile.v1.json" with { type: "json" };
import standardTransitions from "../../package/catalogs/standard-role-transitions.v1.json" with { type: "json" };

const schemaDirectory = fileURLToPath(new URL("../../src/core/contracts/workflow-definition/", import.meta.url));
const maximumFile = 2 * 1024 * 1024;
const maximumBytes = 64 * 1024 * 1024;
const digest = bytes => createHash("sha256").update(bytes).digest("hex");
const encode = value => JSON.stringify(value, null, 2) + "\n";
const isHash = value => typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
const isRevision = value => Number.isSafeInteger(value) && value > 0;
const reserved = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:[.]|$)/i;
const schemaId = id => typeof id === "string" && /^[a-z][a-z0-9_-]*(?:[.][a-z0-9_-]+)*$/.test(id) &&
  id.length <= 128 && !reserved.test(id);
const catalogId = id => processId(id) && !reserved.test(id);
const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

function fail(code, resource) {
  throw Object.assign(new Error(`${code}: ${resource}`), { code, resource });
}

async function readLocal(directory, resource, bytes) {
  const file = path.join(directory, resource);
  try {
    const metadata = await fs.lstat(file);
    if (!metadata.isFile() || await fs.realpath(file) !== file || metadata.size > maximumFile)
      fail("WORKFLOW_PORTABLE_FILE_INVALID", resource);
    bytes.total += metadata.size;
    if (bytes.total > maximumBytes) fail("WORKFLOW_PORTABLE_SIZE_LIMIT", resource);
    return await fs.readFile(file);
  } catch (error) {
    if (error.code === "ENOENT") fail("WORKFLOW_PORTABLE_RESOURCE_MISSING", resource);
    throw error;
  }
}

function parse(bytes, file) {
  try { return JSON.parse(decoder.decode(bytes)); }
  catch { fail("WORKFLOW_PORTABLE_JSON_INVALID", file); }
}

function neededSchemas(project, catalogs, model) {
  const ids = new Set(["agentic-process-model.v2", "workflow-transfer.v1"]);
  if (project.manifest.contract_version === "workflow-project.v1") ids.add(project.manifest.contract_version);
  for (const component of processModels(model)) {
    for (const node of component.nodes) if (node.reliability) ids.add(node.reliability.contract_version);
  }
  for (const row of project.manifest.models) {
    if (row.data_bindings) ids.add(row.data_bindings.contract_version);
    if (row.role_profile) ids.add(row.role_profile.contract_version);
    for (const op of row.operation_bindings) {
      ids.add(op.contract_version);
      ids.add(op.input_contract);
      ids.add(op.output_contract);
    }
  }
  for (const { document } of catalogs) {
    if (document.contract_version) ids.add(document.contract_version);
    for (const activity of document.activities ?? []) if (activity.output_contract) ids.add(activity.output_contract);
  }
  return [...ids].sort();
}

function schemaMatches(id, value) {
  if (!schemaId(id) || value?.$id !== "aidn://contracts/workflow-definition/" + id ||
      validateJsonSchemaDefinition(value, "#", { contractKind: "workflow-definition" }).length)
    fail("WORKFLOW_PORTABLE_SCHEMA_INVALID", id);
}

function requiredRoleCatalogs(project) {
  if (!project.manifest.models.some(row => row.role_profile)) return [];
  return [standardRoles, standardTransitions];
}

function validateCatalogs(project, catalogs) {
  const identities = new Set();
  for (const { id, revision, document } of catalogs) {
    const identity = id + "@" + revision;
    if (!catalogId(id) || !isRevision(revision) || identities.has(identity) || !document ||
        (document.component_id ?? document.id) !== id || document.revision !== revision)
      fail("WORKFLOW_PORTABLE_CATALOG_INVALID", identity);
    identities.add(identity);
  }
  for (const required of requiredRoleCatalogs(project)) {
    const entry = catalogs.find(row => row.id === required.id && row.revision === required.revision);
    const ref = required.id + "@" + required.revision;
    if (!entry) fail("WORKFLOW_PORTABLE_CATALOG_PIN_MISSING", ref);
    if (shadowHash(entry.document) !== shadowHash(required)) fail("WORKFLOW_PORTABLE_CATALOG_CHANGED", ref);
  }
  if (project.manifest.catalog_sha256 && !catalogs.some(row => shadowHash(row.document) === project.manifest.catalog_sha256))
    fail("WORKFLOW_PORTABLE_CATALOG_PIN_MISSING", project.manifest.catalog_sha256);
}

function bindingRefs(project) {
  return project.manifest.models.flatMap(row => row.operation_bindings.map(binding => ({
    model_id: row.model_id, model_revision: row.revision, id: binding.id,
    revision: binding.revision, sha256: shadowHash(binding)
  })));
}

export async function exportPortableWorkflowProject(destination, project, { schemas = {}, catalogs = [] } = {}) {
  const compiled = compileBpmnProject(project);
  catalogs = [...catalogs];
  for (const document of requiredRoleCatalogs(project)) {
    if (!catalogs.some(row => row.id === document.id && row.revision === document.revision))
      catalogs.push({ id: document.id, revision: document.revision, document });
  }
  validateCatalogs(project, catalogs);
  const files = new Map();
  const manifest = encode(project.manifest);
  files.set("manifest.json", manifest);
  const diagrams = {};
  for (const row of project.manifest.models) {
    const file = projectDiagramName(row);
    if (reserved.test(file)) fail("WORKFLOW_PORTABLE_FILE_INVALID", file);
    files.set(file, project.diagrams[file]);
    diagrams[file] = digest(project.diagrams[file]);
  }
  const references = { schemas: [], catalogs: [] };
  for (const id of neededSchemas(project, catalogs, compiled.model)) {
    if (!schemaId(id)) fail("WORKFLOW_PORTABLE_SCHEMA_INVALID", id);
    const name = id + ".schema.json";
    const schema = Object.hasOwn(schemas, id) ? schemas[id] : parse(await readLocal(schemaDirectory, name, {total: 0}), name);
    schemaMatches(id, schema);
    const contents = encode(schema);
    files.set("schemas/" + name, contents);
    references.schemas.push({ id, sha256: digest(contents) });
  }
  for (const { id, revision, document } of catalogs) {
    const contents = encode(document);
    files.set(`catalogs/${id}.${revision}.json`, contents);
    references.catalogs.push({ id, revision, sha256: digest(contents) });
  }
  const lock = { contract_version: "workflow-transfer.v1", model_sha256: compiled.model_sha256,
    manifest_sha256: digest(manifest), diagrams, bindings: bindingRefs(project), ...references };
  files.set("workflow-transfer.json", encode(lock));
  let total = 0;
  for (const [file, contents] of files) {
    const size = Buffer.byteLength(contents);
    if (size > maximumFile || (total += size) > maximumBytes) fail("WORKFLOW_PORTABLE_SIZE_LIMIT", file);
  }
  const root = path.resolve(destination);
  await fs.mkdir(root);
  const created = [], directories = [root];
  try {
    for (const group of ["schemas", "catalogs"]) {
      if (!references[group].length) continue;
      const directory = path.join(root, group);
      await fs.mkdir(directory);
      directories.push(directory);
    }
    // Readers require the complete index, written after all its dependencies.
    for (const [name, contents] of files) {
      const file = path.join(root, name);
      const handle = await fs.open(file, "wx");
      created.push(file);
      try { await handle.writeFile(contents); } finally { await handle.close(); }
    }
  } catch (error) {
    for (const file of created.reverse()) await fs.unlink(file);
    for (const directory of directories.reverse()) await fs.rmdir(directory);
    throw error;
  }
  return lock;
}

export async function importPortableWorkflowProject(directory) {
  const root = await fs.realpath(path.resolve(directory)), bytes = { total: 0 };
  const lock = parse(await readLocal(root, "workflow-transfer.json", bytes), "workflow-transfer.json");
  if (validateJsonSchema(lock, transferSchema, "$", { contractKind: "workflow-definition" }).length)
    fail("WORKFLOW_PORTABLE_INDEX_INVALID", "workflow-transfer.json");
  async function verified(file, hash) {
    const value = await readLocal(root, file, bytes);
    if (!isHash(hash) || digest(value) !== hash) fail("WORKFLOW_PORTABLE_RESOURCE_CHANGED", file);
    return value;
  }
  const manifest = parse(await verified("manifest.json", lock.manifest_sha256), "manifest.json");
  if (!Array.isArray(manifest?.models) || manifest.models.length > 33 || !manifest.models.length ||
      manifest.models.some(row => !catalogId(row?.model_id) || !isRevision(row.revision)))
    fail("WORKFLOW_PORTABLE_INDEX_INVALID", "manifest.json");
  const diagrams = {};
  const diagramFiles = manifest.models.map(projectDiagramName);
  if (!exactKeys(lock.diagrams, diagramFiles)) fail("WORKFLOW_PORTABLE_DIAGRAM_INDEX_CHANGED", "diagrams");
  for (const file of diagramFiles) diagrams[file] = decoder.decode(await verified(file, lock.diagrams[file]));
  const project = { manifest, diagrams };
  const compilation = compileBpmnProject(project);
  if (compilation.model_sha256 !== lock.model_sha256) fail("WORKFLOW_PORTABLE_MODEL_CHANGED", compilation.model.model_id);
  if (shadowHash(bindingRefs(project)) !== shadowHash(lock.bindings)) fail("WORKFLOW_PORTABLE_BINDINGS_CHANGED", "bindings");
  const catalogs = [];
  for (const row of lock.catalogs) {
    if (!exactKeys(row, ["id", "revision", "sha256"]) || !catalogId(row.id) || !isRevision(row.revision))
      fail("WORKFLOW_PORTABLE_INDEX_INVALID", "catalogs");
    const file = `catalogs/${row.id}.${row.revision}.json`;
    catalogs.push({ id: row.id, revision: row.revision, document: parse(await verified(file, row.sha256), file) });
  }
  validateCatalogs(project, catalogs);
  const schemas = Object.create(null);
  for (const row of lock.schemas) {
    if (!exactKeys(row, ["id", "sha256"]) || !schemaId(row.id) || Object.hasOwn(schemas, row.id))
      fail("WORKFLOW_PORTABLE_INDEX_INVALID", "schemas");
    const file = "schemas/" + row.id + ".schema.json";
    schemas[row.id] = parse(await verified(file, row.sha256), file);
    schemaMatches(row.id, schemas[row.id]);
  }
  const needed = neededSchemas(project, catalogs, compilation.model);
  for (const id of needed) if (!Object.hasOwn(schemas, id)) fail("WORKFLOW_PORTABLE_SCHEMA_MISSING", id);
  if (Object.keys(schemas).length !== needed.length) fail("WORKFLOW_PORTABLE_INDEX_INVALID", "schemas");
  return { project, compilation, catalogs, schemas };
}
