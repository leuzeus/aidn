import { createPublicKey, generateKeyPairSync, sign } from "node:crypto";
import { shadowHash } from "../../core/workflow/shadow-json.mjs";
import { assertOperatorClaim } from "./standard-operator-offer.mjs";

const fail = code => { throw Error(code); };

// Each live MCP connection owns a separate key. Starting a copy of this
// process and fabricating a client reply produces a different public key.
// Enrollment belongs to the authenticated host, outside this tool surface.
export function createCodexDecisionChannel({ session, elicit, formSupported }) {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const publicPem = publicKey.export({ format: "pem", type: "spki" });
  const publicDer = publicKey.export({ format: "der", type: "spki" });
  let active = false;
  const enrolled = principals => principals.find(p => publicDer.equals(createPublicKey(p.public_key).export({ type: "spki", format: "der" })));
  async function present() {
    const state = await session.question();
    if (state.status !== "question") return state;
    const { question, question_sha256, prompt, repository } = state.offer;
    return { status: "question", question_sha256, prompt, session: question.session_id ?? null,
      instance: question.instance_id, operation: question.operation_id, options: question.choices,
      repository, subject: question.subject ?? question.review ?? null };
  }
  async function decide() {
    if (active) fail("CODEX_DECISION_IN_PROGRESS");
    active = true;
    try {
      const state = await session.question();
      if (state.status === "retained") return session.resume();
      if (state.status !== "question") return state;
      if (!formSupported()) fail("CODEX_FORM_UNAVAILABLE");
      const principal = enrolled(session.session().principals);
      if (!principal) fail("CODEX_DECISION_CHANNEL_NOT_ENROLLED");
      const { offer } = state, q = offer.question;
      const form = codexDecisionForm(offer);
      const reply = await elicit(form.request);
      if (!reply || !["accept", "decline", "cancel"].includes(reply.action)) fail("CODEX_DECISION_REPLY_INVALID");
      if (reply.action !== "accept") return { status: "unanswered" };
      const { choice, fields, minutes } = form.read(reply.content);
      const latest = await session.question();
      if (latest.status !== "question" || latest.offer.source_ref !== offer.source_ref || latest.offer.question_sha256 !== offer.question_sha256)
        fail("OPERATOR_QUESTION_CHANGED");
      const issued = Date.now(), expires = q.expires_at_ms ?? issued + minutes * 60000;
      if (issued < (q.issued_at_ms ?? 0) || issued >= expires) fail("OPERATOR_QUESTION_CHANGED");
      const payload = { ...fields, contract_version: offer.claim_version, source_kind: "human", authority_id: principal.authority_id,
        source_event_id: offer.source_ref, subject_sha256: offer.subject_sha256, question_sha256: offer.question_sha256, choice,
        evidence_refs: [{ ref: "aidn:question/" + q.operation_id, sha256: offer.question_sha256 }] };
      assertOperatorClaim(payload, q, offer.source_ref);
      const body = { contract_version: "standard-host-source.v1", kind: "human", authority_id: principal.authority_id,
        source_ref: offer.source_ref, subject_sha256: offer.question_sha256, payload, issued_at_ms: issued, expires_at_ms: expires };
      return session.submit({ ...body, signature: sign(null, Buffer.from(shadowHash(body)), privateKey).toString("base64") });
    } finally { active = false; }
  }
  return { present, decide, describe() {
    const current = session.session();
    return { instance: current.instance, form_supported: formSupported(), enrolled: Boolean(enrolled(current.principals)),
      public_key: publicPem, ...(current.project_authorization ? { project_authorization: current.project_authorization } : {}),
      last_receipt: current.last_receipt };
  } };
}

const labels = { rationale: "Motif", cycle_id: "Cycle", cycle_type: "Type du cycle", title: "Titre", objective: "Objectif",
  summary: "Résumé", next_entry_point: "Prochain point de reprise", open_loops: "Points ouverts", blockers: "Blocages",
  version: "Version", action: "Traitement", outcome: "Résultat", severity: "Gravité", chosen_mode: "Mode",
  branch_action: "Branche", learning_goal: "Objectif d’apprentissage", timebox: "Durée", decision_target: "Décision visée" };
const conditional = { selected_cycle: ["select_cycle", "create-correction-cycle"], selection: ["select_cycle", "convert-to-spike"],
  risk_acceptances: ["retain"], session_report: ["close"], handoff: ["handoff"], promotion: ["promote"] };

export function codexDecisionForm(offer) {
  const q = offer.question;
  const properties = { choice: { type: "string", title: "Ta décision", enum: q.choices } }, required = ["choice"];
  const readers = [], message = [offer.prompt, q.session_id ?? q.instance_id];
  if (q.subject?.head_oid) message.push(`${offer.repository ?? q.subject.repository_id} · PR #${q.subject.pull_request_number} → ${q.subject.base_ref}\n${q.subject.head_oid}`);
  const subject = q.review ?? q.subject;
  if (subject) message.push(JSON.stringify(subject, null, 2));
  message.push("Sujet " + offer.question_sha256);
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
    const choices = conditional[name];
    const title = (labels[name] ?? name) + (choices ? " (" + choices.join(", ") + ")" : "");
    const read = field(name, spec, name, title, Boolean(choices));
    readers.push([name, (data, choice) => !choices || choices.includes(choice) ? read(data) : name === "risk_acceptances" ? [] : null]);
  }
  // Duration is a disclosed issuer limit. The business form has one answer
  // field for mode; the operator need not confirm technical signing settings.
  const minutes = 60;
  if (!q.expires_at_ms) message.push("Validité de la réponse : 1 heure.");
  return {
    request: { mode: "form", message: message.join("\n\n"), requestedSchema: { type: "object", properties, required } },
    read(content) {
      if (!content || typeof content !== "object" || Object.keys(content).some(k => !Object.hasOwn(properties, k))
        || !q.choices.includes(content.choice) || required.some(k => typeof content[k] !== "string" || !content[k].trim())) fail("CODEX_DECISION_FIELDS_INVALID");
      const fields = Object.fromEntries(readers.map(([name, read]) => [name, read(content, content.choice)]));
      if (Object.hasOwn(offer.fields, "cycle_sha256")) {
        const selected = q.candidate_cycle ?? fields.selected_cycle;
        fields.cycle_sha256 = selected ? shadowHash(selected) : null;
      }
      return { choice: content.choice, fields, minutes };
    },
  };
}
