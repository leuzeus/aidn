import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { standardPropertyCatalog } from "./property-catalog.mjs";
import { compileBpmnProject } from "../../../src/application/workflow/bpmn-project-service.mjs";
import { compareBpmnModels, compareStandardBpmnProject } from "../../../src/application/workflow/standard-bpmn-project.mjs";
import { loadStandardWorkflowAssets } from "../../../src/application/runtime/standard-workflow-composition.mjs";
import { assertAgenticProcessModel } from "../../../src/core/workflow/agentic-process-model.mjs";
import { shadowHash } from "../../../src/core/workflow/shadow-json.mjs";
import { projectDiagramName } from "../../../src/core/workflow/bpmn-project-diagram.mjs";

import { editorCompileOptions } from "../../../src/application/workflow/workflow-property-catalog.mjs";
import { createWorkflowProject, duplicateWorkflowProject, updateWorkflowProject } from "../../../src/application/workflow/workflow-project-edit.mjs";
import { readEditorProject, readLocalFile, projectHash, refuse, commitEditorProject, editorWorkspace, createEditorWorkspace } from "../workflow-project-store.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const vendor = path.join(here, "node_modules/bpmn-js/dist");
const files = new Map([["/", path.join(here, "index.html")], ["/editor.js", path.join(here, "editor.js")],
  ["/authoring.js", path.join(here, "authoring.js")], ["/editor.css", path.join(here, "editor.css")], ["/modeler.js", path.join(vendor, "bpmn-modeler.production.min.js")]]);
for (const file of ["bpmn-js.css", "diagram-js.css", "bpmn-font/css/bpmn.css", "bpmn-font/font/bpmn.woff2"])
  files.set("/assets/" + file, path.join(vendor, "assets", file));
const mime = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".woff2": "font/woff2" };
const hash = content => createHash("sha256").update(content, "utf8").digest("hex");
const xmlLimit = 1024 * 1024;
async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    if ((size += chunk.length) > 24 * xmlLimit) refuse("BPMN_PROJECT_LIMIT", 413);
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { refuse("BPMN_REQUEST_INVALID", 400); }
}

export async function serveBpmnEditor(directory, port = 0, baseline, { catalog } = {}) {
  const dir = await fs.realpath(path.resolve(directory));
  await fs.access(files.get("/modeler.js"));
  const project = await readEditorProject(dir);
  const compileOptions = editorCompileOptions(catalog);
  compileBpmnProject(project, compileOptions);
  const standard = Object.hasOwn(project.manifest, "catalog_sha256");
  const assets = standard ? loadStandardWorkflowAssets() : null;
  if (standard && (baseline || project.manifest.catalog_sha256 !== assets.source.catalog_sha256)) refuse("BPMN_PROJECT_CATALOG_CHANGED");
  if (!standard) {
    if (!baseline) refuse("BPMN_PROJECT_BASELINE_REQUIRED");
    assertAgenticProcessModel(baseline);
    if (baseline.contract_version !== "agentic-process-model.v2" || baseline.model_id !== project.manifest.models[0].model_id)
      refuse("BPMN_PROJECT_BASELINE_INVALID");
  }
  const baselineHash = standard ? assets.source.model_sha256 : shadowHash(baseline);
  function compare(current, compiled) {
    if (standard) return compareStandardBpmnProject(current, assets);
    if (Object.hasOwn(current.manifest, "catalog_sha256")) refuse("BPMN_PROJECT_CATALOG_CHANGED");
    return { ...compareBpmnModels(baseline, compiled.model), baseline_sha256: baselineHash, candidate_sha256: compiled.model_sha256 };
  }
  const properties = () => catalog ??= standardPropertyCatalog(assets ?? loadStandardWorkflowAssets());
  const server = http.createServer(async (req, res) => {
    const json = (status, value) => { res.writeHead(status, { "Content-Type": "application/json" }); res.end(JSON.stringify(value)); };
    try {
      const address = "127.0.0.1:" + server.address().port;
      if (req.headers.host !== address) refuse("BPMN_ORIGIN_INVALID", 403);
      const url = new URL(req.url, "http://" + address), pathname = url.pathname;
      const workspace = url.searchParams.get("project");
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");
      if (req.method === "GET" && files.has(pathname)) {
        const file = files.get(pathname);
        const contents = await fs.readFile(file);
        res.writeHead(200, { "Content-Type": mime[path.extname(file)] });
        return res.end(contents);
      }
      if (req.method === "GET" && pathname === "/api/catalog") return json(200, properties());
      const location = await editorWorkspace(dir, workspace);
      const isStandard = !workspace && standard;
      const current = await readEditorProject(location), digest = projectHash(current);
      if (req.method === "GET" && pathname === "/api/project") {
        const compiled = compileBpmnProject(current, compileOptions);
        return json(200, { standard: isStandard, models: current.manifest.models.map(row => ({ file: projectDiagramName(row), id: row.model_id, revision: row.revision })),
          manifest: current.manifest, model: compiled.model, diagrams: current.diagrams, project_sha256: digest,
          hashes: Object.fromEntries(Object.entries(current.diagrams).map(([file, xml]) => [file, hash(xml)])) });
      }
      if (req.method !== "POST" || !["/api/compare", "/api/save", "/api/edit", "/api/create", "/api/duplicate"].includes(pathname)) refuse("BPMN_ROUTE_UNKNOWN", 404);
      if (req.headers.origin !== "http://" + address || req.headers["content-type"] !== "application/json") refuse("BPMN_ORIGIN_INVALID", 403);
      const body = await readBody(req);
      if (!body || typeof body !== "object") refuse("BPMN_REQUEST_INVALID", 400);
      if ((pathname === "/api/save" || body.base_project_sha256 !== undefined) && body.base_project_sha256 !== digest)
        refuse("BPMN_PROJECT_FILE_CONFLICT", 409);
      let candidate = body.project ?? current;
      if (body.project && (body.base_project_sha256 !== digest || candidate.manifest?.models?.[0]?.model_id !== current.manifest.models[0].model_id ||
        candidate.manifest.catalog_sha256 !== current.manifest.catalog_sha256)) refuse("BPMN_REQUEST_INVALID", 400);
      if (pathname === "/api/create" || pathname === "/api/duplicate") {
        const fresh = pathname === "/api/create" ? createWorkflowProject({ id: body.id }) : duplicateWorkflowProject(candidate, body.id, catalog);
        await createEditorWorkspace(dir, body.id, fresh, compileOptions);
        return json(201, { project: body.id });
      }
      if (body.file !== undefined) {
        if (!Object.hasOwn(candidate.diagrams, body.file) || typeof body.xml !== "string" || Buffer.byteLength(body.xml) > xmlLimit)
          refuse("BPMN_REQUEST_INVALID", 400);
        if (!body.project && hash(current.diagrams[body.file]) !== body.base_sha256) refuse("BPMN_PROJECT_FILE_CONFLICT", 409);
        candidate = { ...candidate, diagrams: { ...candidate.diagrams, [body.file]: body.xml } };
      }
      if (pathname === "/api/edit") {
        if (body.base_project_sha256 !== digest || !body.edit) refuse("BPMN_REQUEST_INVALID", 400);
        const project = updateWorkflowProject(candidate, body.edit, properties());
        return json(200, { ...project, model: compileBpmnProject(project, compileOptions).model });
      }
      if (!body.file && !body.project) refuse("BPMN_REQUEST_INVALID", 400);
      const compiled = compileBpmnProject(candidate, compileOptions);
      let comparison;
      if (workspace) {
        const original = JSON.parse(await readLocalFile(location, ".aidn-baseline.json", 4 * xmlLimit));
        comparison = { ...compareBpmnModels(original, compiled.model), baseline_sha256: shadowHash(original), candidate_sha256: compiled.model_sha256 };
      } else comparison = compare(candidate, compiled);
      if (pathname === "/api/save") await commitEditorProject(location, digest, candidate, body.project ? null : body.file, compileOptions);
      return json(200, { ...comparison, project_sha256: projectHash(candidate), ...(body.file ? { file_sha256: hash(body.xml) } : {}) });
    } catch (error) {
      return json(error.status ?? 422, { error: error.code ?? "BPMN_PROJECT_INVALID", model_id: error.model_id, element_id: error.element_id });
    }
  });
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(port, "127.0.0.1", resolve); });
  return server;
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const { values } = parseArgs({ options: { baseline: { type: "string" }, project: { type: "string" }, port: { type: "string" } } });
  if (!values.project) throw new Error("Usage: node server.mjs --project working-directory [--port 0] [--baseline model.json]");
  const baseline = values.baseline ? JSON.parse(await fs.readFile(values.baseline, "utf8")) : undefined;
  const server = await serveBpmnEditor(values.project, Number(values.port ?? 0), baseline);
  console.log(`http://127.0.0.1:${server.address().port}/`);
}
