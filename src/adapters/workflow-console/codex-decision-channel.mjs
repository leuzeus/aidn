import { createPublicKey, generateKeyPairSync, sign } from "node:crypto";
import { shadowHash } from "../../core/workflow/shadow-json.mjs";
import { assertOperatorClaim } from "./standard-operator-offer.mjs";
import { codexFormEvidence, codexFormThreadId } from "./codex-form-evidence.mjs";
import { presentCodexDecision, codexChoiceLabel } from "./codex-decision-presentation.mjs";

const fail = code => { throw Error(code); };

// The installed issuer is available only to the trusted launcher. Legacy
// connections keep their own disposable key.
export function createCodexDecisionChannel({ session, elicit, formSupported, formIssuer, observeReply = null }) {
  const privateKey = formIssuer?.privateKey ?? generateKeyPairSync("ed25519").privateKey;
  const publicKey = createPublicKey(privateKey);
  const publicPem = publicKey.export({ format: "pem", type: "spki" });
  const publicDer = publicKey.export({ format: "der", type: "spki" });
  let active = false;
  const enrolled = principals => principals.find(principal =>
    publicDer.equals(createPublicKey(principal.public_key).export({ type: "spki", format: "der" }))
      && (formIssuer ? principal.authority_id === formIssuer.authority_id
        && principal.codex_form?.thread_id === formIssuer.thread_id && principal.codex_form.client === formIssuer.client
        : !principal.codex_form));
  const matchesChat = meta => !formIssuer || codexFormThreadId(meta) === formIssuer.thread_id;
  function requireChat(meta) {
    if (!matchesChat(meta)) fail("CODEX_DECISION_CHAT_CHANGED");
  }
  async function present(meta) {
    requireChat(meta);
    const state = await session.question();
    if (state.status !== "question") return state;
    const { question, question_sha256, prompt, repository } = state.offer;
    return { status: "question", question_sha256, prompt, session: question.session_id ?? null,
      instance: question.instance_id, operation: question.operation_id, options: question.choices,
      repository, subject: question.subject ?? question.review ?? null };
  }
  async function decide(meta) {
    requireChat(meta);
    if (active) fail("CODEX_DECISION_IN_PROGRESS");
    active = true;
    try {
      const state = await session.question();
      if (state.status === "retained") return session.resume();
      if (state.status !== "question") return state;
      if (!formSupported()) fail("CODEX_FORM_UNAVAILABLE");
      const current = session.session();
      const principal = enrolled(current.principals);
      if (!principal || current.project_authorization && !formIssuer) fail("CODEX_DECISION_CHANNEL_NOT_ENROLLED");
      const { offer } = state, q = offer.question;
      const rule = principal.decisions?.find(row => row.question_contract === q.contract_version);
      const choices = formIssuer ? q.choices.filter(choice => rule?.choices.includes(choice)) : q.choices;
      if (!choices.length) fail("STANDARD_AUTHORIZATION_DECISION_REFUSED");
      const form = codexDecisionForm(offer, choices);
      const reply = await elicit(form.request);
      if (!reply || !["accept", "decline", "cancel"].includes(reply.action)) fail("CODEX_DECISION_REPLY_INVALID");
      const reviewer = reply._meta?.approvals_reviewer;
      if (reply.action !== "accept" || reviewer === "auto_review" || reviewer === "guardian_subagent")
        return { status: "unanswered" };
      if (observeReply) await observeReply(structuredClone({ question: q, request: form.request, reply }));
      const { choice, fields, minutes } = form.read(reply.content);
      const latest = await session.question();
      if (latest.status !== "question" || latest.offer.source_ref !== offer.source_ref || latest.offer.question_sha256 !== offer.question_sha256)
        fail("OPERATOR_QUESTION_CHANGED");
      const issued = Date.now(), expires = q.expires_at_ms ?? issued + minutes * 60000;
      if (issued < (q.issued_at_ms ?? 0) || issued >= expires) fail("OPERATOR_QUESTION_CHANGED");
      const payload = { ...fields, contract_version: offer.claim_version, source_kind: "human", authority_id: principal.authority_id,
        source_event_id: offer.source_ref, subject_sha256: offer.subject_sha256, question_sha256: offer.question_sha256, choice };
      payload.evidence_refs = formIssuer ? [codexFormEvidence(formIssuer.thread_id, reply.request_id, q, payload)]
        : [{ ref: "aidn:question/" + q.operation_id, sha256: offer.question_sha256 }];
      assertOperatorClaim(payload, q, offer.source_ref);
      const body = { contract_version: "standard-host-source.v1", kind: "human", authority_id: principal.authority_id,
        source_ref: offer.source_ref, subject_sha256: offer.question_sha256, payload, issued_at_ms: issued, expires_at_ms: expires };
      return session.submit({ ...body, signature: sign(null, Buffer.from(shadowHash(body)), privateKey).toString("base64") });
    } finally { active = false; }
  }
  return { present, decide, describe(meta) {
    const current = session.session();
    return { instance: current.instance, form_supported: formSupported(), enrolled: Boolean(enrolled(current.principals)),
      public_key: publicPem, ...(current.project_authorization ? { project_authorization: current.project_authorization } : {}),
      ...(formIssuer && { form_chat_matches: matchesChat(meta), issuer_client: formIssuer.client }),
      last_receipt: matchesChat(meta) ? current.last_receipt : null };
  } };
}

const labels = { rationale: "Motif", cycle_id: "Cycle", cycle_type: "Type du cycle", title: "Titre", objective: "Objectif",
  summary: "Résumé", next_entry_point: "Prochain point de reprise", open_loops: "Points ouverts", blockers: "Blocages",
  version: "Version", action: "Traitement", outcome: "Résultat", severity: "Gravité", chosen_mode: "Mode",
  branch_action: "Branche", learning_goal: "Objectif d’apprentissage", timebox: "Durée", decision_target: "Décision visée",
  risk_acceptances: "Risques à accepter", selected_cycle: "Cycle à reprendre", selection: "Sélection",
  session_report: "Bilan de la session", promotion: "Proposition de référence", handoff: "Relais" };
const conditional = { selected_cycle: ["select_cycle", "create-correction-cycle"], selection: ["select_cycle", "convert-to-spike"],
  risk_acceptances: ["retain"], session_report: ["close"], handoff: ["handoff"], promotion: ["promote"] };

export function codexDecisionForm(offer, allowedChoices = offer.question.choices) {
  const q = offer.question;
  const view = presentCodexDecision(offer, allowedChoices);
  const choiceByLabel = new Map(view.choices.map(row => [row.label, row.id]));
  const properties = { choice: { type: "string", title: "Votre choix", enum: view.choices.map(row => row.label) } }, required = ["choice"];
  const readers = [], message = [view.message];
  const nominalClosure = q.contract_version === "standard-cycle-closure-question.v1" && q.review?.work_complete === true
    && ["requirements", "usages", "documents", "tests", "blocking_findings", "risk_findings_requiring_human_decision"]
      .every(key => Array.isArray(q.review.pending[key]) && q.review.pending[key].length === 0);
  const proposalForm = q.contract_version === "standard-baseline-promotion-question.v1" && view.proposal !== null;
  function field(name, spec, chain, title, optional) {
    if (Object.hasOwn(spec, "const")) return () => spec.const;
    const schema = (spec.oneOf ?? spec.anyOf)?.find(s => s.type !== "null") ?? spec;
    if (schema.properties) {
      const children = Object.entries(schema.properties).map(([key, value]) => [key, field(key, value, chain + "_" + key, title + " · " + (labels[key] ?? key), optional)]);
      return data => Object.fromEntries(children.map(([key, read]) => [key, read(data)]));
    }
    if (schema.type === "array" && schema.items.properties) {
      const risk = name === "risk_acceptances", ids = risk ? q.review.pending.risk_findings_requiring_human_decision : q.subject.reported_cycles;
      const rows = ids.map((id, i) => {
        const members = Object.entries(schema.items.properties).map(([k, s]) => [k, k === (risk ? "finding_id" : "cycle_id") ? () => id
          : field(k, s, `${chain}_${i}_${k}`, id + " · " + (labels[k] ?? k), optional)]);
        return data => Object.fromEntries(members.map(([key, read]) => [key, read(data)]));
      });
      return data => rows.map(read => read(data));
    }
    const list = schema.type === "array", choices = schema.enum;
    properties[chain] = { type: "string", title, ...(choices ? { enum: choices.map(v => v ?? "sans_objet") } : {}),
      ...(list ? { description: "Un élément par ligne." } : {}), ...(schema.maxLength ? { maxLength: schema.maxLength } : {}) };
    if (!optional && !list && (choices || schema.minLength)) required.push(chain);
    return data => {
      const value = data[chain] ?? "";
      if (typeof value !== "string") fail("CODEX_DECISION_FIELDS_INVALID");
      return list ? value.split(/\r?\n/).map(s => s.trim()).filter(Boolean) : choices?.includes(null) && value === "sans_objet" ? null : value.trim();
    };
  }
  for (const [name, spec] of Object.entries(offer.fields)) {
    if (name === "cycle_sha256") continue;
    if (name === "rationale" && (nominalClosure || proposalForm)) {
      readers.push([name, (_data, choice) => "Choix exprimé dans le formulaire Codex sur le résultat présenté : " + codexChoiceLabel(choice) + "."]);
      continue;
    }
    if (name === "promotion" && proposalForm) {
      readers.push([name, (_data, choice) => choice === "promote" ? { ...view.proposal } : null]);
      continue;
    }
    const choices = conditional[name];
    const title = (labels[name] ?? name.replace(/_/g, " ")) + (choices ? " — " + choices.map(codexChoiceLabel).join(" / ") : "");
    const read = field(name, spec, name, title, Boolean(choices));
    readers.push([name, (data, choice) => !choices || choices.includes(choice) ? read(data) : name === "risk_acceptances" ? [] : null]);
  }
  // Duration is a disclosed issuer limit. The business form has one answer
  // field for mode; the operator need not confirm technical signing settings.
  const minutes = 60;
  return {
    request: { mode: "form", _meta: { codex_requires_user_input: true }, message: message.join("\n\n"),
      requestedSchema: { type: "object", properties, required } },
    read(content) {
      if (!content || typeof content !== "object" || Object.keys(content).some(k => !Object.hasOwn(properties, k))
        || !choiceByLabel.has(content.choice) || required.some(k => typeof content[k] !== "string" || !content[k].trim())) fail("CODEX_DECISION_FIELDS_INVALID");
      const choice = choiceByLabel.get(content.choice);
      const fields = Object.fromEntries(readers.map(([name, read]) => [name, read(content, choice)]));
      if (Object.hasOwn(offer.fields, "cycle_sha256")) {
        const selected = q.candidate_cycle ?? fields.selected_cycle;
        fields.cycle_sha256 = selected ? shadowHash(selected) : null;
      }
      return { choice, fields, minutes };
    },
  };
}
