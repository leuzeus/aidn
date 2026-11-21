import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright";
import { serveBpmnEditor } from "./server.mjs";
import { writeNewBpmnProject } from "../export-bpmn-project.mjs";
import { exportStandardBpmnProject, compareStandardBpmnProject } from "../../../src/application/workflow/standard-bpmn-project.mjs";
import { loadStandardWorkflowAssets } from "../../../src/application/runtime/standard-workflow-composition.mjs";
import { readProjectBpmnXml } from "../../../src/adapters/workflow/bpmn-xml.mjs";
import { bpmnId } from "../../../src/core/workflow/bpmn-profile.mjs";
import { projectDiagramName } from "../../../src/core/workflow/bpmn-project-diagram.mjs";

const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "aidn-bpmn-browser-"));
let browser, server;
try {
  const assets = loadStandardWorkflowAssets(), exported = exportStandardBpmnProject(assets);
  const dir = path.join(workspace, "project");
  await writeNewBpmnProject(dir, exported);
  server = await serveBpmnEditor(dir);
  const origin = "http://127.0.0.1:" + server.address().port;
  browser = await chromium.launch({ ...(process.env.BPMN_BROWSER_PATH ? { executablePath: process.env.BPMN_BROWSER_PATH } : {}) });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.setDefaultTimeout(6500);
  const errors = [], external = [];
  page.on("pageerror", e => errors.push(e.message));
  await page.route("**/*", route => {
    if (new URL(route.request().url()).origin === origin) return route.continue();
    external.push(route.request().url()); return route.abort();
  });
  const captured = {};
  page.on("request", request => {
    if (request.url() === origin + "/api/compare") { const body = request.postDataJSON(); captured[body.file] = body.xml; }
  });
  await page.goto(origin);
  const status = page.locator("#status"), model = page.locator("#model"), scope = page.locator("#scope");
  async function compare(save = false) {
    const pending = page.waitForResponse(r => r.url() === origin + (save ? "/api/save" : "/api/compare"));
    await page.locator(save ? "#save" : "#compare").click();
    const response = await pending;
    return response.json();
  }
  const root = projectDiagramName(assets.model);
  for (const row of exported.manifest.models) {
    const file = projectDiagramName(row);
    await model.selectOption(file);
    await page.waitForFunction(() => !document.querySelector("#compare").disabled);
    assert.equal(await status.textContent(), "Diagramme ouvert.", file + ": " + await status.textContent());
    const result = await compare();
    assert.equal(result.candidate_sha256, assets.source.model_sha256, JSON.stringify(result));
  }
  assert.equal(compareStandardBpmnProject({ manifest: exported.manifest, diagrams: captured }, assets).count, 0);
  console.log("PASS the offline modeler opens and serializes every published diagram without a semantic change");

  await model.selectOption(root);
  const originalDigest = (await (await fetch(origin + "/api/project")).json()).hashes[root];
  const main = page.locator(`.djs-shape[data-element-id="N_${assets.model.entry}"]`).first();
  const box = await main.boundingBox();
  assert.ok(box);
  const x = box.x + box.width / 2, y = box.y + box.height / 2;
  await page.mouse.move(x,y); await page.mouse.down(); await page.mouse.move(x+55,y+84,{steps:12}); await page.mouse.up();
  assert.equal((await compare(true)).count, 0);
  const savedLayout = await fs.readFile(path.join(dir, root), "utf8");
  const entryBounds = xml => find(readProjectBpmnXml(xml), n => n.name === "BPMNShape" &&
    n.attributes.some(a => a.name === "bpmnElement" && a.value === "N_" + assets.model.entry)).children[0].attributes;
  assert.notDeepEqual(entryBounds(savedLayout), entryBounds(exported.diagrams[root]));
  const stale = await fetch(origin + "/api/save", { method: "POST", headers: { Origin: origin, "Content-Type": "application/json" },
    body: JSON.stringify({ file: root, xml: exported.diagrams[root], base_sha256: originalDigest }) });
  assert.equal(stale.status, 409);
  assert.equal(await fs.readFile(path.join(dir, root), "utf8"), savedLayout);
  await page.locator("#reload").click();
  assert.equal((await compare()).count, 0);
  console.log("PASS a graphical layout edit saves, reopens and keeps the published IR hash");

  const gateway = assets.model.nodes.find(n => n.kind === "xor");
  await scope.selectOption("N_" + gateway.id);
  function find(element, predicate) {
    if (predicate(element)) return element;
    for (const child of element.children) { const result = find(child, predicate); if (result) return result; }
  }
  const group = find(readProjectBpmnXml(captured[root]), n => bpmnId(n) === "N_" + gateway.id);
  const flow = group.children.find(n => n.name === "sequenceFlow" && n.children.some(c => c.name === "conditionExpression"));
  const visual = page.locator(`.djs-connection[data-element-id="${bpmnId(flow)}"] .djs-visual > :is(path,polyline)`).first();
  const point = await visual.evaluate(el => {
    const { x, y } = el.getPointAtLength(el.getTotalLength() * .67).matrixTransform(el.getScreenCTM());
    return { x, y };
  });
  await page.mouse.click(point.x, point.y);
  const condition = page.getByLabel("Condition du flux");
  await condition.fill("edited_review_condition"); await page.getByText("Appliquer", {exact:true}).click();
  const result = await compare(true);
  assert.equal(result.count, 1, JSON.stringify(result));
  assert.equal(result.differences[0].node_id, gateway.id);
  assert.equal(result.differences[0].after, "edited_review_condition");
  const saved = await fs.readFile(path.join(dir, root), "utf8");
  await page.locator("#reload").click();
  assert.deepEqual((await compare()).differences, result.differences);
  await scope.selectOption("N_" + gateway.id);
  await page.mouse.click(point.x, point.y);
  await condition.fill("invalid fact"); await page.getByText("Appliquer", {exact:true}).click();
  const refusal = await compare(true);
  assert.deepEqual([refusal.error, refusal.model_id, refusal.element_id], ["BPMN_CONDITION_INVALID", assets.model.model_id, bpmnId(flow)]);
  assert.equal(await fs.readFile(path.join(dir, root), "utf8"), saved);
  assert.equal((await fetch(origin + "/api/save", { method: "POST", headers: { Origin: "https://other.invalid", "Content-Type": "application/json" }, body: "{}" })).status, 403);
  assert.deepEqual(errors, []); assert.deepEqual(external, []);
  const generic = structuredClone(exported);
  delete generic.manifest.catalog_sha256;
  const genericDir = path.join(workspace, "custom-project");
  await writeNewBpmnProject(genericDir, generic);
  await assert.rejects(serveBpmnEditor(genericDir), { code: "BPMN_PROJECT_BASELINE_REQUIRED" });
  const custom = await serveBpmnEditor(genericDir, 0, assets.model);
  try {
    const url = "http://127.0.0.1:" + custom.address().port;
    const initial = await (await fetch(url + "/api/project")).json();
    const response = await fetch(url + "/api/compare", { method: "POST", headers: { Origin: url, "Content-Type": "application/json" },
      body: JSON.stringify({ file: root, xml: initial.diagrams[root], base_sha256: initial.hashes[root] }) });
    assert.equal((await response.json()).candidate_sha256, assets.source.model_sha256);
  } finally { await new Promise(resolve => custom.close(resolve)); }
  console.log("PASS a graphical condition edit yields a precise persisted diff; an invalid condition identifies the model and flow");
} finally {
  await browser?.close();
  if (server) await new Promise(resolve => server.close(resolve));
  await fs.rm(workspace, { recursive: true, force: true });
}
