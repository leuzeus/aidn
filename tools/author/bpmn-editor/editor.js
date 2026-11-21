"use strict";
const get = id => document.getElementById(id);
const modeler = new BpmnJS({ container: "#canvas" });
let project, file, dirty = false, busy = false, importing = false, selectedFlow;
function status(text, error = false) {
  get("status").textContent = text;
  get("status").toggleAttribute("data-error", error);
  get("diff").replaceChildren();
}
function controls() {
  for (const id of ["model", "scope", "compare", "reload"]) get(id).disabled = busy || !project;
  get("save").disabled = busy || !dirty;
  get("canvas").inert = busy;
  get("condition-form").inert = busy;
}
async function action(work) {
  if (busy) return;
  busy = true; controls();
  try { await work(); }
  catch (error) { status([error.model_id ?? file, error.element_id, error.message].filter(Boolean).join(" · "), true); }
  finally { busy = false; controls(); }
}
function options(control, items) {
  control.replaceChildren(...items.map(([value, label]) => new Option(label, value)));
}
async function openDiagram(name) {
  importing = true;
  try {
    const { warnings } = await modeler.importXML(project.diagrams[name]);
    file = name; dirty = false;
    get("model").value = name;
    options(get("scope"), modeler.getDefinitions().diagrams.map(d => [d.plane.bpmnElement.id, d.plane.bpmnElement.name ?? d.plane.bpmnElement.id]));
    modeler.get("canvas").zoom("fit-viewport");
    status(warnings.length ? warnings.map(w => w.message).join("\n") : "Diagramme ouvert.", warnings.length > 0);
  } finally { importing = false; }
}
async function reload() {
  const response = await fetch("/api/project");
  if (!response.ok) throw new Error((await response.json()).error);
  project = await response.json();
  get("compare").textContent = project.standard ? "Comparer au STANDARD" : "Comparer à la référence";
  options(get("model"), project.models.map(m => [m.file, m.id + " · r" + m.revision]));
  await openDiagram(project.diagrams[file] ? file : project.models[0].file);
}
function discard() {
  return !dirty || window.confirm("Abandonner les modifications du diagramme ouvert ?");
}
get("model").onchange = () => action(async () => {
  const next = get("model").value;
  get("model").value = file;
  if (discard()) await openDiagram(next);
});
get("scope").onchange = () => action(async () => {
  const canvas = modeler.get("canvas");
  const root = canvas.getRootElements().find(r => r.businessObject.id === get("scope").value);
  if (!root) throw new Error("Bloc introuvable");
  canvas.setRootElement(root);
  canvas.zoom("fit-viewport");
});
modeler.on("root.set", ({ element }) => {
  if (!importing && element?.businessObject) get("scope").value = element.businessObject.id;
});
modeler.on("selection.changed", ({ newSelection }) => {
  selectedFlow = newSelection.length === 1 && newSelection[0].businessObject.conditionExpression ? newSelection[0] : null;
  get("condition-form").hidden = !selectedFlow;
  if (selectedFlow) get("condition").value = selectedFlow.businessObject.conditionExpression.body;
});
get("condition-form").onsubmit = event => {
  event.preventDefault();
  if (!busy && selectedFlow) modeler.get("modeling").updateModdleProperties(selectedFlow,
    selectedFlow.businessObject.conditionExpression, { body: get("condition").value });
};
modeler.on("commandStack.changed", () => {
  if (importing || !file) return;
  dirty = true; status("Modifications à comparer."); controls();
});
window.addEventListener("beforeunload", event => { if (dirty) { event.preventDefault(); event.returnValue = ""; } });
async function compare(save) {
  const { xml } = await modeler.saveXML({ format: true });
  const response = await fetch("/api/" + (save ? "save" : "compare"), { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ file, xml, base_sha256: project.hashes[file] }) });
  const result = await response.json();
  if (!response.ok) throw Object.assign(new Error(result.error), result);
  if (save) { project.diagrams[file] = xml; project.hashes[file] = result.file_sha256; dirty = false; }
  const reference = project.standard ? "le STANDARD publié" : "le modèle de référence";
  status((save ? "Enregistré. " : "") + (result.count
    ? result.count + (result.count === 1 ? " différence avec " : " différences avec ") + reference + "."
    : project.standard ? "Identique au STANDARD publié." : "Identique au modèle de référence."));
  for (const d of result.differences) {
    const li = document.createElement("li");
    li.textContent = (d.node_id ? d.node_id + " · " : "") + d.path + " · " + JSON.stringify(d.before) + " → " + JSON.stringify(d.after);
    get("diff").append(li);
  }
}
get("compare").onclick = () => action(() => compare(false));
get("save").onclick = () => action(() => compare(true));
get("reload").onclick = () => action(async () => { if (discard()) await reload(); });
action(reload);
