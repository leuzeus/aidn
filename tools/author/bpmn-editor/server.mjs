import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { compileBpmnProject } from "../../../src/application/workflow/bpmn-project-service.mjs";
import { compareBpmnModels, compareStandardBpmnProject } from "../../../src/application/workflow/standard-bpmn-project.mjs";
import { loadStandardWorkflowAssets } from "../../../src/application/runtime/standard-workflow-composition.mjs";
import { assertAgenticProcessModel } from "../../../src/core/workflow/agentic-process-model.mjs";
import { shadowHash } from "../../../src/core/workflow/shadow-json.mjs";
import { projectDiagramName } from "../../../src/core/workflow/bpmn-project-diagram.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const vendor = path.join(here, "node_modules/bpmn-js/dist");
const files = new Map([["/", path.join(here, "index.html")], ["/editor.js", path.join(here, "editor.js")],
  ["/editor.css", path.join(here, "editor.css")], ["/modeler.js", path.join(vendor, "bpmn-modeler.production.min.js")]]);
for (const file of ["bpmn-js.css", "diagram-js.css", "bpmn-font/css/bpmn.css", "bpmn-font/font/bpmn.woff2"])
  files.set("/assets/" + file, path.join(vendor, "assets", file));
const mime = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".woff2": "font/woff2" };
const hash = content => createHash("sha256").update(content, "utf8").digest("hex");
const refuse = (code, status = 422) => { throw Object.assign(new Error(code), { code, status }); };
const xmlLimit = 1024 * 1024;
async function readLocalFile(dir, file, limit) {
  const full = path.join(dir, file);
  const stat = await fs.lstat(full);
  if (!stat.isFile() || stat.size > limit || await fs.realpath(full) !== full) refuse("BPMN_PROJECT_FILE_INVALID");
  return fs.readFile(full, "utf8");
}
async function readProject(dir) {
  const manifest = JSON.parse(await readLocalFile(dir, "manifest.json", xmlLimit));
  if (!Array.isArray(manifest.models) || manifest.models.length > 33) refuse("BPMN_PROJECT_MANIFEST_INVALID");
  const diagrams = {};
  let bytes = 0;
  for (const row of manifest.models) {
    if (!/^[a-z][a-z0-9_-]{0,63}$/.test(row?.model_id) || !Number.isSafeInteger(row.revision) || row.revision < 1
      || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(row.model_id)) refuse("BPMN_PROJECT_FILENAME_INVALID");
    const file = projectDiagramName(row);
    diagrams[file] = await readLocalFile(dir, file, xmlLimit);
    if ((bytes += Buffer.byteLength(diagrams[file])) > 8 * xmlLimit) refuse("BPMN_PROJECT_LIMIT");
  }
  return { manifest, diagrams };
}
async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    if ((size += chunk.length) > 2 * xmlLimit) refuse("BPMN_PROJECT_LIMIT", 413);
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { refuse("BPMN_REQUEST_INVALID", 400); }
}

export async function serveBpmnEditor(directory, port = 0, baseline) {
  const dir = await fs.realpath(path.resolve(directory));
  await fs.access(files.get("/modeler.js"));
  const project = await readProject(dir);
  compileBpmnProject(project);
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
  function compare(current) {
    if (standard) return compareStandardBpmnProject(current, assets);
    if (Object.hasOwn(current.manifest, "catalog_sha256")) refuse("BPMN_PROJECT_CATALOG_CHANGED");
    const compiled = compileBpmnProject(current);
    return { ...compareBpmnModels(baseline, compiled.model), baseline_sha256: baselineHash, candidate_sha256: compiled.model_sha256 };
  }
  let saving = false;
  const server = http.createServer(async (req, res) => {
    const json = (status, value) => { res.writeHead(status, { "Content-Type": "application/json" }); res.end(JSON.stringify(value)); };
    try {
      const address = "127.0.0.1:" + server.address().port;
      if (req.headers.host !== address) refuse("BPMN_ORIGIN_INVALID", 403);
      const pathname = new URL(req.url, "http://" + address).pathname;
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");
      if (req.method === "GET" && files.has(pathname)) {
        const file = files.get(pathname);
        const contents = await fs.readFile(file);
        res.writeHead(200, { "Content-Type": mime[path.extname(file)] });
        return res.end(contents);
      }
      if (req.method === "GET" && pathname === "/api/project") {
        const current = await readProject(dir);
        return json(200, { standard, models: current.manifest.models.map(row => ({ file: projectDiagramName(row), id: row.model_id, revision: row.revision })),
          diagrams: current.diagrams, hashes: Object.fromEntries(Object.entries(current.diagrams).map(([file, xml]) => [file, hash(xml)])) });
      }
      if (req.method !== "POST" || !["/api/compare", "/api/save"].includes(pathname)) refuse("BPMN_ROUTE_UNKNOWN", 404);
      if (req.headers.origin !== "http://" + address || req.headers["content-type"] !== "application/json") refuse("BPMN_ORIGIN_INVALID", 403);
      const body = await readBody(req);
      if (!body || typeof body.file !== "string" || typeof body.xml !== "string" || Buffer.byteLength(body.xml) > xmlLimit) refuse("BPMN_REQUEST_INVALID", 400);
      const save = pathname === "/api/save";
      if (save && saving) refuse("BPMN_PROJECT_FILE_CONFLICT", 409);
      if (save) saving = true;
      try {
        const current = await readProject(dir);
        if (!Object.hasOwn(current.diagrams, body.file)) refuse("BPMN_PROJECT_FILES_INVALID");
        if (hash(current.diagrams[body.file]) !== body.base_sha256) refuse("BPMN_PROJECT_FILE_CONFLICT", 409);
        current.diagrams[body.file] = body.xml;
        const comparison = compare(current);
        if (save) {
          const temp = path.join(dir, ".bpmn-" + randomUUID() + ".tmp");
          const handle = await fs.open(temp, "wx");
          try {
            try { await handle.writeFile(body.xml, "utf8"); } finally { await handle.close(); }
            if (hash(await readLocalFile(dir, body.file, xmlLimit)) !== body.base_sha256) refuse("BPMN_PROJECT_FILE_CONFLICT", 409);
            await fs.rename(temp, path.join(dir, body.file));
          } finally { await fs.rm(temp, { force: true }); }
        }
        return json(200, { ...comparison, file_sha256: hash(body.xml) });
      } finally { if (save) saving = false; }
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
