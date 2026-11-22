import { unlockOperatorKey, signedAnswer } from "./operator-key.mjs";
import { choiceLabel, element, decisionFields } from "./operator-fields.mjs";

const $ = id => document.getElementById(id);
const fragment = new URLSearchParams(location.hash.slice(1));
let token = fragment.get("token") ?? "", operator = null, offerId = "", busy = false, generation = 0;
let minutes = 60, retry = null, timer = null, reading = Promise.resolve(), connecting = Promise.resolve();
history.replaceState(null, "", location.pathname);
$("access").hidden = Boolean(token);
const feedback = message => { $("feedback").textContent = message; };
async function api(route, data = {}) {
  const response = await fetch("/api/" + route, { method: "POST", credentials: "omit", cache: "no-store",
    headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" }, body: JSON.stringify(data) });
  const result = await response.json();
  if (!response.ok || result.errors?.length) throw Error(result.errors?.[0] ?? "Connexion interrompue.");
  return result;
}
function showReceipt(result) {
  if (result?.status !== "received") return;
  $("receipt").textContent = "Réponse reçue · " + choiceLabel(result.choice) + " · Reçu " + result.receipt_id;
  retry = null;
}
function idle(next) {
  offerId = "";
  const message = next === "expired" ? "La question a expiré. En attente de son actualisation."
    : next === "retained" ? "Transmission de la réponse déjà enregistrée…"
    : "En attente d’une question du workflow.";
  $("content").replaceChildren(element("h1", message));
}
function showOffer(offer) {
  const id = offer.source_ref;
  if (offerId === id) return;
  offerId = id;
  const q = offer.question, section = $("content");
  const facts = element("dl");
  const row = (name, value) => {
    if (value !== undefined && value !== null) facts.append(element("dt", name), element("dd", String(value)));
  };
  row("Session", q.session_id ?? q.review?.session_id ?? q.subject?.session_id);
  row("Cycle", q.review?.cycle_id ?? q.subject?.cycle_id);
  const subject = q.subject ?? q.review ?? {};
  row("Dépôt", offer.repository ? offer.repository + " (" + subject.repository_id + ")" : subject.repository_id);
  row("Pull request", subject.pull_request_number); row("Branche cible", subject.base_ref);
  row("Commit", subject.head_oid ?? subject.delivery_head); row("Objectif", subject.objective);
  if (q.expires_at_ms) row("Échéance", new Date(q.expires_at_ms).toLocaleString());
  const full = element("details");
  full.append(element("summary", "Voir le sujet exact"), element("pre", JSON.stringify(q, null, 2)));
  section.replaceChildren(element("h1", offer.prompt), facts, full);
  let rationale;
  if (offer.fields.rationale) {
    const label = element("label", "Motif de ta décision");
    rationale = element("textarea");
    rationale.required = true;
    rationale.maxLength = offer.fields.rationale.maxLength ?? 2048;
    label.append(rationale);
    section.append(label);
  }
  const choices = element("div", undefined, "choices");
  section.append(choices);
  for (const choice of q.choices) {
    const form = element("form"), fields = element("div");
    const read = decisionFields(fields, offer, choice, rationale);
    const label = choiceLabel(choice);
    const button = element("button", label, ["refused", "deferred", "cancelled"].includes(choice) ? "secondary" : "");
    button.type = "submit";
    form.append(fields, button);
    if (fields.childElementCount) {
      const detail = element("details");
      detail.append(element("summary", label), form);
      choices.append(detail);
    } else choices.append(form);
    form.addEventListener("submit", async event => {
      event.preventDefault();
      if (!event.isTrusted || !navigator.userActivation.isActive || busy || !operator || offerId !== id || retry) return;
      if (rationale && !rationale.value.trim()) { rationale.focus(); rationale.reportValidity(); return; }
      busy = true;
      const epoch = generation;
      try {
        await reading;
        if (epoch !== generation || offerId !== id) { feedback("La question a changé. Vérifie le nouveau sujet."); return; }
        const answer = await signedAnswer(operator, offer, choice, await read(), minutes);
        if (epoch !== generation) return;
        retry = answer;
        feedback("Transmission de ta réponse…");
        showReceipt(await api("submit", answer));
        if (epoch === generation) { feedback(""); idle(); }
      } catch (error) { feedback(error.message); }
      finally { busy = false; schedule(100); }
    });
  }
}
function schedule(delay = 12000) {
  clearTimeout(timer);
  if (operator) timer = setTimeout(() => { reading = refresh(); }, delay);
}
async function refresh() {
  if (!operator || busy) { schedule(); return; }
  const epoch = generation;
  try {
    const state = await api("question");
    if (epoch !== generation) return;
    if (state.status === "retained") { idle("retained"); showReceipt(await api("resume")); }
    else if (state.status === "question") {
      if (retry && retry.source_ref !== state.offer.source_ref) retry = null;
      if (retry) {
        const answer = retry;
        // Only transport errors are retried automatically. A typed host refusal
        // leaves the question available for a corrected business answer.
        showReceipt(await api("submit", answer));
      } else showOffer(state.offer);
    } else { retry = null; idle(state.status); }
  } catch (error) {
    if (/^(OPERATOR_|PROCESS_|STANDARD_|AGENT_)/.test(error.message) && error.message !== "OPERATOR_RECEIPT_PENDING") retry = null;
    feedback(error.message);
  } finally { schedule(); }
}
function lock() {
  generation++;
  clearTimeout(timer);
  operator = null; retry = null; offerId = "";
  $("password").value = ""; $("file").value = "";
  $("content").replaceChildren(); $("decision").hidden = true; $("lock").hidden = true; $("login").hidden = false;
  feedback("");
}
$("lock").addEventListener("click", lock);
window.addEventListener("pagehide", lock);
$("unlock").addEventListener("submit", async event => {
  event.preventDefault();
  if (!event.isTrusted || !navigator.userActivation.isActive || busy) return;
  const file = $("file").files[0];
  if (!file || file.size > 16384) { feedback("Choisis une clé PEM chiffrée de moins de 16 Kio."); return; }
  if (!token) token = $("token").value.trim();
  busy = true;
  const epoch = generation;
  let password = $("password").value;
  $("password").value = "";
  try {
    await connecting;
    const session = await api("session");
    showReceipt(session.last_receipt);
    const identity = await unlockOperatorKey(await file.text(), password, session.principals);
    if (epoch !== generation) return;
    operator = identity; minutes = Number($("validity").value);
    $("instance").textContent = session.instance; $("person").textContent = "Connecté en tant que " + operator.id;
    $("file").value = ""; $("token").value = "";
    $("login").hidden = true; $("decision").hidden = false; $("lock").hidden = false;
    idle(); feedback("");
  } catch (error) {
    if (error.message === "WORKFLOW_DASHBOARD_AUTH_REQUIRED") { token = ""; $("access").hidden = false; }
    feedback(error.name === "OperationError" ? "Impossible de déverrouiller cette clé avec la phrase saisie." : error.message);
  } finally { password = ""; busy = false; schedule(0); }
});
if (token) {
  // Redeliver a previously signed answer even if this browser session is locked.
  connecting = api("session").then(session => { $("instance").textContent = session.instance; showReceipt(session.last_receipt); return api("resume"); })
    .then(showReceipt).catch(error => feedback(error.message));
}
