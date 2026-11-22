import { digest } from "./operator-key.mjs";

const fieldNames = {
  cycle_id: "Cycle", cycle_type: "Type du cycle", title: "Titre court", objective: "Objectif", rationale: "Motif",
  severity: "Gravité", version: "Version", summary: "Résumé", open_loops: "Points ouverts", blockers: "Blocages",
  next_entry_point: "Prochain point de reprise", finding_id: "Constat", action: "Traitement", outcome: "Résultat",
  decision_target: "Décision visée", learning_goal: "Objectif d’apprentissage", timebox: "Durée", chosen_mode: "Mode",
  branch_action: "Branche", next_agent_role: "Rôle à qui transmettre", next_agent_action: "Prochaine action",
  next_agent_goal: "Objectif à transmettre", from_agent_role: "Rôle en cours", from_agent_action: "Action en cours",
  handoff_note: "Note de transmission", selected_cycle: "Cycle choisi", risk_acceptances: "Risques à accepter",
  carryover_decisions: "Cycles reportés", session_report: "Compte rendu", promotion: "Référence", selection: "Sélection", handoff: "Transmission",
};
export const choiceLabel = key => ({
  refused: "Refuser", deferred: "Reporter", cancelled: "Annuler", approve_merge: "Autoriser la fusion",
  retain: "Retenir le cycle", no_go: "Prononcer un NO-GO", drop: "Abandonner", close: "Clore la session", promote: "Promouvoir",
  not_requested: "Poursuivre sans promotion", "integrate-to-session": "Intégrer à la session", select_cycle: "Choisir ce cycle",
  confirm_alignment: "Confirmer l’alignement", request_diagnosis: "Demander un diagnostic", rollback: "Revenir en arrière",
  "convert-to-spike": "Convertir en SPIKE", handoff: "Transmettre", "create-correction-cycle": "Créer un cycle correctif",
}[key] ?? key.replace(/[_-]/g, " "));
export function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}
const constant = value => () => value;
function control(parent, name, raw, q, fixed) {
  if (fixed !== undefined || raw.const !== undefined) return constant(fixed ?? raw.const);
  const schema = (raw.anyOf ?? raw.oneOf)?.find(s => s.type !== "null") ?? raw;
  const label = fieldNames[name] ?? name;
  if (schema.properties) {
    const group = element("fieldset");
    group.append(element("legend", label));
    parent.append(group);
    const members = Object.entries(schema.properties).map(([k, s]) => [k, control(group, k, s, q)]);
    return () => Object.fromEntries(members.map(([k, read]) => [k, read()]));
  }
  if (schema.type === "array" && schema.items.properties) {
    const risks = name === "risk_acceptances";
    const ids = risks ? q.review.pending.risk_findings_requiring_human_decision : q.subject.reported_cycles;
    const rows = ids.map(id => {
      const group = element("fieldset");
      group.append(element("legend", label + " · " + id));
      parent.append(group);
      const members = Object.entries(schema.items.properties).map(([k, s]) =>
        [k, control(group, k, s, q, k === (risks ? "finding_id" : "cycle_id") ? id : undefined)]);
      return () => Object.fromEntries(members.map(([k, read]) => [k, read()]));
    });
    return () => rows.map(read => read());
  }
  const field = element("label", label);
  let options = schema.enum;
  if (name === "cycle_id" && q.subject?.candidate_cycles) {
    options = q.subject.candidate_cycles.filter(c => ["OPEN", "IMPLEMENTING", "VERIFYING"].includes(c.state)
      && c.branch_head && (c.session_owner === q.subject.session_id || q.subject.reported_cycles.includes(c.cycle_id))).map(c => c.cycle_id);
  }
  const lines = schema.type === "array";
  const input = element(options ? "select" : lines || name === "rationale" ? "textarea" : "input");
  if (options) {
    input.append(new Option("Choisir…", ""));
    options.forEach((v, index) => input.append(new Option(v === null ? "Sans objet" : String(v), String(index))));
  } else {
    if (schema.maxLength) input.maxLength = schema.maxLength;
    if (schema.minLength) input.minLength = schema.minLength;
    if (lines) input.placeholder = "Un élément par ligne";
  }
  input.required = Boolean(options || schema.minLength);
  field.append(input);
  parent.append(field);
  return () => options ? options[Number(input.value)] : lines ? input.value.split(/\r?\n/).map(s => s.trim()).filter(Boolean) : input.value.trim();
}

export function decisionFields(parent, offer, choice, rationale) {
  const q = offer.question;
  const fields = [];
  const active = { selection: ["select_cycle", "convert-to-spike"], selected_cycle: ["select_cycle", "create-correction-cycle"],
    session_report: ["close"], promotion: ["promote"], risk_acceptances: ["retain"], handoff: ["handoff"] };
  for (const [name, schema] of Object.entries(offer.fields)) {
    if (name === "cycle_sha256") continue;
    let read;
    if (name === "rationale") read = () => rationale.value.trim();
    else if (active[name] && !active[name].includes(choice)) read = constant(name === "risk_acceptances" ? [] : null);
    else read = control(parent, name, schema, q);
    fields.push([name, read]);
  }
  return async () => {
    const values = Object.fromEntries(fields.map(([name, read]) => [name, read()]));
    if (Object.hasOwn(offer.fields, "cycle_sha256")) {
      const cycle = q.candidate_cycle ?? values.selected_cycle;
      values.cycle_sha256 = cycle ? await digest(cycle) : null;
    }
    return values;
  };
}
