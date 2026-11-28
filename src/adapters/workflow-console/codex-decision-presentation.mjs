const names = {
  THINKING: "THINKING — réfléchir et cadrer", EXPLORING: "EXPLORING — expérimenter",
  COMMITTING: "COMMITTING — réaliser et livrer", refused: "Refuser", deferred: "Reporter la décision",
  cancelled: "Annuler la demande", retain: "Retenir le résultat et clore le cycle",
  no_go: "Ne pas retenir le résultat", drop: "Abandonner le résultat", close: "Clore la session",
  continue: "Poursuivre", confirm: "Confirmer", diagnose: "Demander un diagnostic complémentaire",
  replan: "Revoir le plan", reanchor: "Revenir à l’objectif", select_cycle: "Reprendre le cycle sélectionné",
  create_cycle: "Créer un cycle", "create-correction-cycle": "Créer un cycle correctif",
  "convert-to-spike": "Convertir l’exploration en SPIKE", promote: "Promouvoir la proposition",
  not_requested: "Continuer sans promotion", merge: "Fusionner la PR sur ce commit",
  accept: "Accepter", reject: "Refuser", wait: "Attendre", sync: "Synchroniser après la fusion",
  fast_forward: "Mettre à jour par avance rapide", handoff: "Préparer le relais", carry_over: "Reporter le cycle",
  accept_resolution_exception: "Accepter l’exception de revue", acknowledge_external_merge_for_r09: "Consigner la fusion et synchroniser",
  approve_merge: "Autoriser la fusion de cette PR sur ce commit", confirm_alignment: "Confirmer l’alignement et poursuivre",
  continue_analysis: "Poursuivre l’analyse", "integrate-to-session": "Intégrer le cycle dans la session",
  new_cycle: "Ouvrir un nouveau cycle", reconcile_manually: "Préparer une réconciliation manuelle",
  request_diagnosis: "Demander un diagnostic complémentaire", requirements_delta: "Revoir les exigences", rollback: "Revenir à l’état précédent",
};
const titles = {
  mode: "Choisir le mode de travail", "cycle-closure": "Clôture du cycle",
  "baseline-promotion": "Faire du résultat une nouvelle référence", "session-closure": "Clôture de la session",
  "session-branch-integration": "Intégrer le résultat à la session", "drift-recovery": "Traiter l’écart à l’objectif",
  "pr-merge-consent": "Fusion de la pull request", "pr-post-merge-decision": "Synchronisation après la fusion",
  "pr-correction": "Suite de la revue de la pull request", "cycle-entry-choice": "Choisir le cycle à reprendre",
  "pr-external-merge-disposition": "Qualifier la fusion déjà effectuée", spike: "Suite de l’exploration",
};
const labels = {
  session_id: "Session", cycle_id: "Cycle", original_objective: "Objectif initial", current_objective: "Objectif actuel",
  objective: "Objectif", title: "Sujet", summary: "Résumé", rationale: "Explication", current_version: "Référence actuelle",
  work_complete: "Travail terminé", pending: "Points en attente", requirements: "Exigences", usages: "Usages",
  documents: "Documents", tests: "Tests", findings: "Constats", category: "Sujet", severity: "Importance",
  blocking_findings: "Points bloquants", risk_findings_requiring_human_decision: "Risques à accepter explicitement",
  risk_acceptances: "Acceptation des risques", recommendation: "Recommandation", reported_cycles: "Cycles reportés",
  cycle_state: "État du cycle", branch: "Branche", branch_name: "Branche", source_branch: "Branche à intégrer",
  target_branch: "Branche cible", base_ref: "Branche cible", head_ref: "Branche source", head_oid: "Commit concerné",
  pull_request_number: "Pull request", state: "État", status: "État", protection: "Protection de la branche",
  drift_level: "Écart constaté", objective_changed: "Objectif modifié", changes: "Changements", keep: "À conserver",
  discard: "À abandonner", open_loops: "Points ouverts", blockers: "Blocages", next_entry_point: "Prochaine étape",
};
const omitted = new Set(["contract_version", "evidence_refs", "scope_id", "instance_id", "occurrence_id", "intent_sha256",
  "operation_id", "authority_id", "source_event_id", "source_ref", "repository_id", "cycle_path", "target_root",
  "state_mode", "skill_completion", "implementation_sha256"]);
const readable = value => value.replace(/[_-]/g, " ").replace(/^./u, c => c.toUpperCase());
export const codexChoiceLabel = choice => names[choice] ?? readable(choice);

function facts(value, depth = 0) {
  if (!value || typeof value !== "object") return [];
  const rows = [];
  for (const [key, item] of Object.entries(value)) {
    if (omitted.has(key) || /(?:sha256|operation_id|execution_id|authority_id|prepared_at_ms|model_id|binding_id)$/.test(key)) continue;
    const name = labels[key] ?? readable(key);
    if (item === null || item === undefined) continue;
    if (typeof item === "string") {
      if (/^[0-9a-f]{40,64}$/i.test(item)) {
        if (/oid|commit|head/.test(key)) rows.push(`${name} : ${item.slice(0, 8)}`);
      } else if (!/^(?:op_|receipt_|native_)[0-9a-f]{32,}$/i.test(item)) rows.push(`${name} : ${item}`);
    } else if (typeof item === "boolean") rows.push(`${name} : ${item ? "oui" : "non"}`);
    else if (typeof item === "number") rows.push(`${name} : ${item}`);
    else if (Array.isArray(item)) {
      if (!item.length) continue;
      const children = item.flatMap(row => typeof row === "object" ? facts(row, depth + 1)
        : /^(?:[a-f0-9]{40,64}|(?:op_|receipt_|native_)[0-9a-f]{32,})$/i.test(String(row)) ? [] : [String(row)]);
      if (children.length) rows.push(`${name}\n${children.map(row => "• " + row).join("\n")}`);
    } else if (depth < 5) {
      const children = facts(item, depth + 1);
      if (children.length) rows.push(`${name}\n${children.join("\n")}`);
    }
  }
  return rows;
}

function nextVersion(current) {
  const match = /^v(\d+)\.(\d+)(?:\.(\d+))?$/.exec(current ?? "");
  if (!match || match.slice(1).filter(Boolean).some(part => !Number.isSafeInteger(Number(part)))) return null;
  const parts = match.slice(1).filter(part => part !== undefined).map(Number);
  if (!Number.isSafeInteger(++parts[parts.length - 1])) return null;
  return "v" + parts.join(".");
}

// This is a view of an already prepared question. It never grants an effect
// or changes the canonical question, its identifiers or allowed choices.
export function presentCodexDecision(offer, allowedChoices = offer.question.choices) {
  const q = offer.question, kind = q.contract_version.replace(/^standard-/, "").replace(/-question\.v\d+$/, "");
  const choices = allowedChoices.map(id => ({ id, label: codexChoiceLabel(id) }));
  if (new Set(choices.map(row => row.label)).size !== choices.length) throw Error("CODEX_DECISION_LABEL_AMBIGUOUS");
  const lines = [titles[kind] ?? offer.prompt];
  const review = q.review ?? q.subject;
  const cycle = review?.cycle_id ?? q.cycle_id;
  lines.push([q.session_id && "Session " + q.session_id, cycle && "Cycle " + cycle].filter(Boolean).join(" · "));
  let proposal = null;
  if (kind === "baseline-promotion") {
    const version = nextVersion(review?.current_version);
    if (version && cycle) proposal = Object.freeze({ version, summary: `Résultat validé et clôturé du cycle ${cycle}.` });
    lines.push(`Le résultat de ${cycle ?? "ce cycle"} est terminé et retenu.`);
    lines.push(`Référence actuelle : ${review.current_version}.`);
    if (proposal) lines.push(`Proposition : ${proposal.version}\nRésumé : ${proposal.summary}`,
      "Promouvoir inscrira cette proposition comme nouvelle référence. Continuer sans promotion conservera la référence actuelle et permettra de poursuivre la session.",
      "Refuser rejette la proposition. Reporter conserve la décision pour plus tard. Annuler abandonne cette demande.",
      "Votre choix valide la version et le résumé affichés. Pour proposer d’autres valeurs, reportez la décision et indiquez la modification souhaitée dans le chat.");
  } else if (kind === "cycle-closure") {
    lines.push(review.work_complete ? "Le travail est terminé." : "Des éléments restent à terminer.");
    const pending = Object.entries(review.pending ?? {}).filter(([, rows]) => rows.length);
    lines.push(pending.length ? pending.map(([key, rows]) => `${labels[key] ?? readable(key)} : ${rows.join(", ")}`).join("\n") : "Aucun élément en attente ni risque à accepter.");
    for (const finding of review.findings ?? []) lines.push(`${{ informational: "Information", risk: "Risque", blocking: "Point bloquant" }[finding.severity] ?? "Constat"} : ${finding.rationale}`);
    lines.push("Retenir conserve le résultat et demande la clôture. Les autres choix permettent de ne pas le retenir, de l’abandonner ou de reporter la décision.");
  } else {
    if (offer.repository) lines.push("Dépôt : " + offer.repository);
    if (/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(offer.repository ?? "") && /^[a-f0-9]{40}$/i.test(review?.head_oid ?? ""))
      lines.push(`Commit à examiner : [${review.head_oid.slice(0, 8)}](https://github.com/${offer.repository}/commit/${review.head_oid})`);
    lines.push(...facts(review));
  }
  if (q.expires_at_ms) lines.push("Décision attendue avant le " + new Intl.DateTimeFormat("fr-CA", { dateStyle: "medium", timeStyle: "short" }).format(q.expires_at_ms) + ".");
  return { message: lines.filter(Boolean).join("\n\n"), choices, proposal };
}
