const $ = id => document.getElementById(id);
let prepared = null, pending = false, generation = 0;
const json = value => JSON.stringify(value, null, 2);
const node = (tag, text, className = "") => { const element = document.createElement(tag); element.textContent = text; element.className = className; return element; };
const details = (title, value) => { const element = document.createElement("details"); element.append(node("summary", title), node("pre", json(value))); return element; };
function card(title, tags = []) { const element = node("article", "", "card"); element.append(node("h3", title)); for (const tag of tags) element.append(node("span", tag, "tag")); return element; }
function runCard(status) {
  const element = card(status.run_id ?? "Run", ["exécution · " + status.execution_status]);
  element.append(node("p", "Acceptation : " + (status.attempts?.map(row => row.task_id + " / " + (row.acceptance ?? "non observée")).join(" · ") || "non observée")),
    node("p", "Intégration : " + (status.integration?.sha ?? "non observée") + " · en attente : " + (status.integration?.pending ?? "inconnu")),
    node("p", "Validation : " + (status.validation?.status ?? "non observée") + " · nettoyage : " + (status.cleanup?.status ?? "non observé")), details("Preuves et statut complet", status));
  return element;
}
async function call(endpoint, body) {
  const response = await fetch("/api/" + endpoint, { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + $("token").value.trim() }, body: json(body) });
  const result = await response.json(); if (!response.ok) throw new Error((result.errors ?? [response.status]).join(" · ")); return result;
}
function invalidate() { generation++; prepared = null; $("approve").checked = false; $("sync").checked = false; $("apply").disabled = true; }
function render(output) {
  $("raw").textContent = json(output); $("errors").textContent = output.errors.join(" · ");
  for (const id of ["summary", "instances", "catalog", "limits", "live"]) $(id).replaceChildren();
  if (!output.view) return;
  const view = output.view;
  for (const [value, label] of [[view.instances.length, "Instances observées"], [view.selections.length, "Workflows sélectionnés"], [view.instances.filter(row => row.blockers.length).length, "Instances avec blocages"]]) {
    const metric = node("div", "", "metric"); metric.append(node("strong", String(value)), node("span", label)); $("summary").append(metric);
  }
  if (!view.instances.length) $("instances").append(node("p", "Aucune instance canonique dans cette sélection.", "empty"));
  for (const row of view.instances) {
    const element = card(row.instance_id, [row.cursor.status, "étape · " + row.cursor.step_id, "révision · " + row.revision]);
    element.append(node("p", row.definition.workflow_id + " · définition " + row.definition.revision), node("p", row.instance_sha256, "hash"));
    if (row.blockers.length) element.append(node("p", row.blockers.join(" · "), "error"));
    const steps = node("div", "", "steps");
    for (const step of row.steps) steps.append(node("p", (step.id === row.cursor.step_id ? "→ " : "· ") + step.id + " / " + step.primitive_ref, step.id === row.cursor.step_id ? "current-step" : ""));
    element.append(steps);
    element.append(details("Étapes et transitions", { steps: row.steps, transitions: row.transitions }), details("Décisions et preuves", row.evidence), details("Runs · observations conservées", row.runs), details("Contexte et empreintes", { context: row.context, scope: row.scope, compilation_sha256: row.compilation_sha256 }));
    $("instances").append(element);
  }
  for (const selection of view.selections) {
    const element = card(selection.workflow_id, ["sélection · " + selection.revision]);
    element.append(node("p", selection.selection_sha256, "hash"), details("Révisions et revues", selection)); $("catalog").append(element);
  }
  $("catalog").append(details("Primitives · références du registre", view.registry));
  $("limits").append(details("Admission observée · preview requis avant action", view.admission), details("Limites déclarées", view.limits));
  if (view.live_run?.errors?.length) $("live").append(node("p", view.live_run.errors.join(" · "), "error"));
  $("live").append(view.live_run?.status ? runCard(view.live_run.status) : node("p", view.live_run ? "Statut de run indisponible." : "Aucun run demandé en direct.", "empty"));
}
$("refresh").onclick = async () => {
  invalidate(); $("connection-state").textContent = "Lecture…";
  try { const query = {}; for (const [id, key] of [["instance", "instanceId"], ["workflow", "workflowId"], ["configuration", "configuration"], ["run", "run"]]) if ($(id).value.trim()) query[key] = $(id).value.trim();
    const output = await call("inspect", query); render(output); $("connection-state").textContent = output.errors.length ? "Lecture refusée" : "État consulté · lecture seule";
  } catch (error) { $("errors").textContent = error.message; $("connection-state").textContent = "Indisponible"; }
};
for (const id of ["request", "token", "instance", "workflow", "configuration", "run"]) $(id).addEventListener("input", invalidate);
$("preview").onclick = async () => {
  if (pending) return; invalidate(); pending = true;
  const observed = { generation, text: $("request").value, token: $("token").value };
  try { const request = JSON.parse(observed.text); const output = await call("action", { request }); $("preview-output").textContent = json(output);
    $("approve").checked = false; $("sync").checked = false;
    prepared = output.can_apply && generation === observed.generation && observed.text === $("request").value && observed.token === $("token").value
      ? { request, output, text: observed.text, token: observed.token } : null;
  }
  catch (error) { $("preview-output").textContent = error.message; }
  finally { pending = false; }
};
function allowApply() { $("apply").disabled = pending || !prepared || !$("approve").checked || prepared.request.operation === "run" && !$("sync").checked; }
$("approve").onchange = allowApply; $("sync").onchange = allowApply;
$("apply").onclick = async () => {
  if (pending || !prepared || !$("approve").checked || prepared.text !== $("request").value || prepared.token !== $("token").value) return;
  const selected = prepared, run = selected.request.operation === "run";
  if (run && !$("sync").checked) return;
  invalidate(); pending = true;
  try { const execute = run && selected.request.input.command !== "agent-run-cleanup";
    const output = await call("action", { request: selected.request, expectPlan: selected.output.action_sha256, write: !execute, execute, syncRelay: run }); $("result").textContent = json(output);
  } catch (error) { $("result").textContent = error.message + "\nRésultat incertain : consulter l’état avant toute nouvelle action."; }
  finally { pending = false; }
};
