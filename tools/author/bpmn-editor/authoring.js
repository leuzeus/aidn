"use strict";
function currentModel() {
  const row = project.models.find(item => item.file === file);
  return [project.model, ...(project.model.call_targets ?? []).map(target => target.model)].find(model =>
    model.model_id === row?.id && model.revision === row.revision);
}
function authorControl(id, label, choices) {
  const wrapper = document.createElement("label"), input = document.createElement(choices ? "select" : "input");
  input.id = id;
  if (choices) options(input, choices.map(value => [value, value]));
  wrapper.append(label + " ", input); get("step-properties").append(wrapper);
  return input;
}
function boundOperation() {
  const kind = get("step-kind").value;
  const ref = kind === "evaluation" ? propertyCatalog.evaluators.find(row =>
    row.id + "@" + row.revision === get("step-evaluator")?.value)?.operation_ref : get("step-operation")?.value;
  return propertyCatalog.operations.find(row => row.ref === ref);
}
function renderMappings(op, fields) {
  get("mappings")?.remove();
  const list = document.createElement("fieldset"), title = document.createElement("legend");
  list.id = "mappings"; title.textContent = "Entrées"; list.append(title);
  for (const field of op?.inputs ?? []) {
    const row = document.createElement("label"), select = document.createElement("select"), value = document.createElement("input");
    if (!field.editable) continue;
    const expr = fields[field.name];
    row.append(field.name + (field.required ? " *" : ""));
    row.dataset.field = field.name;
    options(select, [["", "Non renseignée"], ["literal", "Valeur"], ["parameter", "Paramètre"],
      ["operation_output", "Sortie d’opération"], ["operation_input", "Entrée d’opération"], ["operation_id", "ID d’opération"],
      ["call_output", "Sortie de sous-processus"], ["item", "Élément de collection"], ["occurrence_id", "Occurrence"]]);
    select.value = expr?.source ?? "";
    value.value = expr?.source === "literal" ? (field.schema.type === "string" ? expr.value : JSON.stringify(expr.value)) :
      [expr?.key ?? expr?.node_id, ...(expr?.path ?? [])].filter(Boolean).join(".");
    select.setAttribute("aria-label", "Source " + field.name); value.setAttribute("aria-label", "Valeur " + field.name);
    const hint = () => { value.placeholder = ["operation_output", "operation_input", "call_output"].includes(select.value)
      ? "étape.champ" : select.value === "parameter" ? "paramètre.champ" : "Valeur"; };
    select.onchange = hint; hint(); row.append(select, value); list.append(row);
  }
  if (list.children.length > 1) get("step-properties").append(list);
}
function renderReliability(op, policy) {
  get("reliability-fields")?.remove();
  const capabilities = op?.reliability;
  if (!capabilities?.idempotent && !capabilities?.wait_deadline) return;
  const list = document.createElement("fieldset"), legend = document.createElement("legend");
  list.id = "reliability-fields"; legend.textContent = "Attente et reprises"; list.append(legend);
  function number(id, label, minimum, maximum, value) {
    const row = document.createElement("label"), field = document.createElement("input");
    row.append(label, field); field.id = id; field.type = "number"; field.min = minimum;
    field.max = maximum; field.step = 1; field.value = value ?? ""; list.append(row);
  }
  if (capabilities.idempotent) number("step-retries", "Nombre maximal de reprises", 0, 255, policy?.max_retries);
  if (capabilities.wait_deadline) number("step-timeout", "Délai d’attente (ms)", 1, Number.MAX_SAFE_INTEGER, policy?.wait_timeout_ms);
  get("step-properties").append(list);
}
function renderStepProperties() {
  const model = currentModel(), kind = get("step-kind").value, id = get("step-id").value;
  if (!model) return;
  const node = model.nodes.find(row => row.id === id);
  get("step-properties").replaceChildren();
  const fields = model.data_bindings?.inputs.find(row => row.node_id === id)?.fields ?? {};
  if (kind === "operation" || kind === "evaluation") {
    let control;
    if (kind === "operation") {
      control = authorControl("step-operation", "Opération versionnée", propertyCatalog.operations.map(row => row.ref));
      const selected = propertyCatalog.operations.find(row => row.binding.id === node?.binding_ref);
      if (selected) control.value = selected.ref;
    } else {
      const available = propertyCatalog.evaluators.filter(row => propertyCatalog.operations.some(op => op.ref === row.operation_ref));
      control = authorControl("step-evaluator", "Évaluateur versionné", available.map(row => row.id + "@" + row.revision));
      const selected = available.find(row => propertyCatalog.operations.some(op => op.ref === row.operation_ref &&
        op.binding.id === node?.binding_ref && model.operation_pins[op.binding.id] === op.provenance.binding_sha256));
      if (selected) control.value = selected.id + "@" + selected.revision;
    }
    control.onchange = () => { renderMappings(boundOperation(), {}); renderReliability(boundOperation()); };
    renderMappings(boundOperation(), fields); renderReliability(boundOperation(), node?.reliability);
  }
  if (kind === "activity") {
    const roles = [...new Set([...model.roles, ...propertyCatalog.roles].map(row => row.id))];
    const policies = [...new Set([...model.policies, ...propertyCatalog.policies].map(row => row.id))];
    const role = authorControl("step-role", "Rôle", roles), policy = authorControl("step-policy", "Politique", policies);
    if (node?.role_ref) role.value = node.role_ref;
    if (node?.policy_ref) policy.value = node.policy_ref;
  }
  if (kind === "xor") {
    const condition = authorControl("step-fact", "Fait booléen"); condition.setAttribute("list", "workflow-facts");
    const facts = document.createElement("datalist"); facts.id = "workflow-facts"; get("step-properties").append(facts);
    options(facts, propertyCatalog.facts.map(fact => [fact, fact]));
    condition.value = node?.branches?.find(row => row.condition)?.condition ?? "";
  }
  if (kind === "call") {
    const target = authorControl("step-target", "Modèle local"); target.value = node?.target?.model_id ?? "";
    const child = project.model.call_targets?.find(row => row.model_id === target.value);
    authorControl("call-parameters", "Paramètres du sous-processus (JSON)").value = JSON.stringify(child?.model.call_interface?.parameters ?? {});
    authorControl("call-fields", "Liaisons de l’appel (JSON)").value = JSON.stringify(fields);
  }
}
function renderAuthor() {
  const model = currentModel(); if (!model || !propertyCatalog) return;
  const old = get("step-parent").value;
  options(get("step-parent"), model.nodes.filter(node => node.kind === "sequence").map(node => [node.id, node.id]));
  if (model.nodes.some(node => node.id === old && node.kind === "sequence")) get("step-parent").value = old;
  options(get("node-ids"), model.nodes.map(node => [node.id, node.id]));
  renderStepProperties();
}
function readStep() {
  const kind = get("step-kind").value;
  const edit = { kind, id: get("step-id").value, parent: get("step-parent").value, model_id: currentModel().model_id,
    model_revision: currentModel().revision };
  if (kind === "activity") Object.assign(edit, { role_ref: get("step-role").value, policy_ref: get("step-policy").value });
  if (kind === "xor") edit.condition = get("step-fact").value;
  if (kind === "call") Object.assign(edit, { target: get("step-target").value, parameters: JSON.parse(get("call-parameters").value),
    fields: JSON.parse(get("call-fields").value) });
  if (kind === "operation" || kind === "evaluation") {
    if (kind === "operation") edit.operation_ref = get("step-operation").value;
    else edit.evaluator_ref = get("step-evaluator").value;
    const retries = get("step-retries")?.value, timeout = get("step-timeout")?.value;
    edit.reliability = retries || timeout ? { contract_version: "operation-reliability.v1",
      ...(retries ? { max_retries: Number(retries) } : {}), ...(timeout ? { wait_timeout_ms: Number(timeout) } : {}) } : null;
    edit.fields = {};
    for (const row of document.querySelectorAll("#mappings [data-field]")) {
      const field = row.dataset.field, source = row.querySelector("select").value, text = row.querySelector("input").value;
      if (!source) continue;
      const [key, ...path] = text.split(".");
      if (source === "literal") {
        const schema = boundOperation().inputs.find(input => input.name === field).schema;
        edit.fields[field] = { source, value: schema.type === "string" ? text : JSON.parse(text) };
      } else if (source === "parameter") edit.fields[field] = { source, key, path };
      else if (["operation_output", "operation_input", "call_output"].includes(source)) edit.fields[field] = { source, node_id: key, path };
      else edit.fields[field] = { source, node_id: key };
    }
  }
  return edit;
}
async function authorRequest(route, data) {
  const diagrams = { ...project.diagrams };
  if (dirty) diagrams[file] = (await modeler.saveXML({ format: true })).xml;
  const response = await fetch(api(route), { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...data, base_project_sha256: project.project_sha256, project: { manifest: project.manifest, diagrams } }) });
  const result = await response.json();
  if (!response.ok) throw Object.assign(new Error(result.error), result);
  return result;
}
document.addEventListener("DOMContentLoaded", () => {
  get("step-kind").onchange = renderStepProperties; get("step-id").onchange = renderStepProperties;
  get("workspace-form").onsubmit = event => {
    event.preventDefault();
    action(async () => {
      const route = event.submitter.value;
      if (route === "create" && (dirty || projectDraft) && !window.confirm("Abandonner les modifications du projet ouvert ?")) return;
      const result = await authorRequest(route, { id: get("workspace-id").value });
      dirty = false; projectDraft = false; location.assign("/?project=" + encodeURIComponent(result.project));
    });
  };
  get("step-form").onsubmit = event => {
    event.preventDefault();
    action(async () => {
      const edit = readStep(), scope = get("scope").value;
      const result = await authorRequest("edit", { edit });
      Object.assign(project, result);
      project.models = result.manifest.models.map(row => ({ id: row.model_id, revision: row.revision, file: row.model_id + "." + row.revision + ".bpmn" }));
      options(get("model"), project.models.map(m => [m.file, m.id + " · r" + m.revision]));
      projectDraft = true; await openDiagram(file, scope); renderAuthor();
      status("Modification appliquée. Enregistrer pour publier la révision locale.");
    });
  };
});
