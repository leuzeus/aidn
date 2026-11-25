import fs from "node:fs";
import path from "node:path";
import { agentRunPhysicalPath, readAgentRunFile } from "../../application/runtime/agent-run-configuration-service.mjs";
import { resolveStandardWorkflowConfiguration, runStandardWorkflowEntry } from "../../application/runtime/standard-workflow-entry.mjs";
import { createStandardHostAuthority, readStandardHostInstance } from "../runtime/standard-host-authority.mjs";
import { shadowHash, checkShadowJson } from "../../core/workflow/shadow-json.mjs";
import { writeFileAtomicSync } from "../../lib/fs/atomic-write-lib.mjs";
import { operatorOffer, assertOperatorClaim } from "./standard-operator-offer.mjs";
import { createOperationJournalSigner } from "../../core/workflow/process-operation-journal.mjs";
import { createAgenticProcessStore } from "../runtime/agentic-process-store.mjs";
import { createProcessOperationJournalStore } from "../runtime/process-operation-journal-store.mjs";
import { readAidnProjectConfig, resolveConfigStateMode } from "../../lib/config/aidn-config-lib.mjs";
import { decisionInboxId } from "../../core/workflow/process-decision-inbox.mjs";
import { bindOperatorChat, codexMessageEvidence, assertCodexMessageEvidence } from "./codex-message-recovery.mjs";

const fail = code => { throw Error(code); };
const read = file => readAgentRunFile(file, { maxBytes: 262144 }).value;

export function createStandardOperatorSession({ targetRoot, configuration, environment = process.env, operatorChat },
  { resolve = resolveStandardWorkflowConfiguration, enter = runStandardWorkflowEntry } = {}) {
  const request = readAgentRunFile(path.resolve(configuration)).value;
  const resolved = resolve(request).configuration;
  if (path.relative(agentRunPhysicalPath(targetRoot, { directory: true }), resolved.target_root) !== "") fail("OPERATOR_TARGET_CHANGED");
  const authority = createStandardHostAuthority({ configuration: resolved, environment }, { useProvider: false });
  const chat = operatorChat && bindOperatorChat(operatorChat.thread_id, operatorChat.authority_id);
  const { identity } = readStandardHostInstance({ targetRoot: resolved.target_root, instanceId: resolved.instance_id, environment });
  const lastAnswer = path.join(authority.home, identity + ".operator-answer.json");
  const inbox = path.join(authority.home, "inbox");
  function repositoryFor(q) {
    if (!q.subject?.repository_id) return null;
    const binding = readAgentRunFile(path.join(authority.home, identity + ".github.json"), { optional: true })?.value;
    const repo = binding?.repository;
    return repo?.node_id === q.subject.repository_id ? repo.owner + "/" + repo.name : null;
  }
  function checkedInbox() {
    return agentRunPhysicalPath(inbox, { directory: true, missing: true });
  }
  function authenticate(envelope, q, sourceRef, now) {
    if (!envelope || checkShadowJson(envelope) || Buffer.byteLength(JSON.stringify(envelope)) > 262144 || envelope.issued_at_ms < (q.issued_at_ms ?? 0)
      || q.expires_at_ms !== undefined && (now >= q.expires_at_ms || envelope.expires_at_ms < q.expires_at_ms))
      fail("OPERATOR_SIGNED_ANSWER_REQUIRED");
    authority.verifyHumanEnvelope(envelope, sourceRef, q);
    assertOperatorClaim(envelope.payload, q, sourceRef);
  }
  // A nonempty directory is published by rename: competing servers cannot
  // replace a winner. Both the pending answer and the ordinary host source
  // live under the enrolled host's protected inbox. No project journal is edited.
  function slotFor(q) {
    const prefix = "ui-" + shadowHash(q);
    for (let sequence = 1; ; sequence++) {
      const ref = prefix + "-" + sequence;
      const slot = path.join(checkedInbox(), ref + ".pending");
      if (!fs.existsSync(slot)) return { ref, slot, envelope: null };
      const envelope = read(path.join(slot, "answer.json"));
      if (envelope.expires_at_ms > Date.now()) return { ref, slot, envelope };
    }
  }
  function retain(slot, envelope) {
    if (!slot.envelope) {
      fs.mkdirSync(checkedInbox(), { recursive: true, mode: 0o700 });
      const temp = fs.mkdtempSync(path.join(checkedInbox(), ".answer-"));
      try {
        writeFileAtomicSync(path.join(temp, "answer.json"), JSON.stringify(envelope), { mode: 0o600 });
        try { fs.renameSync(temp, slot.slot); } catch (err) { if (!fs.existsSync(slot.slot)) throw err; }
      } finally {
        fs.rmSync(path.join(temp, "answer.json"), { force: true });
        if (fs.existsSync(temp)) fs.rmdirSync(temp);
      }
    }
    const winner = read(path.join(slot.slot, "answer.json"));
    if (shadowHash(winner) !== shadowHash(envelope)) fail("OPERATOR_ANSWER_ALREADY_RECORDED");
    return winner;
  }
  const run = options => enter({ request, environment, ...options });
  function recordedReceipt(pointer, messageEvidence) {
    if (!pointer) return null;
    const options = {
      targetRoot: resolved.target_root,
      stateMode: resolveConfigStateMode(readAidnProjectConfig(resolved.target_root).data) ?? "files",
      env: environment,
    };
    const record = createProcessOperationJournalStore(options).read(pointer.operation_id).record;
    if (!record?.results.length || record.intent.instance_id !== resolved.instance_id) return null;
    createOperationJournalSigner(authority.readKey).verify(record);
    const prefix = "ui-" + pointer.question_sha256 + "-";
    const result = record.results.find(row => {
      const ref = row.output?.observations?.source_ref;
      return pointer.source_ref ? ref === pointer.source_ref : typeof ref === "string" && ref.startsWith(prefix);
    });
    if (!result) return null;
    const instance = createAgenticProcessStore(options).read(resolved.instance_id).record;
    if (!instance?.events.some(event => event.kind === "operation_result" && event.occurrence_id === record.intent.occurrence_id
      && shadowHash(event.receipt) === shadowHash(result.receipt))) return null;
    const observed = result.output.observations;
    if (!observed.source_ref.startsWith(prefix)) fail("OPERATOR_SOURCE_CHANGED");
    if (messageEvidence) {
      const id = decisionInboxId({ source_kind: "human", authority_id: chat.authority_id, source_event_id: observed.source_ref });
      if (id !== observed.inbox_id) fail("CODEX_MESSAGE_AUTHOR_CHANGED");
      assertCodexMessageEvidence(result.output.evidence_refs, messageEvidence);
    }
    return { status: "received", operation_id: record.operation_id, question_sha256: pointer.question_sha256,
      choice: result.output.observations.choice, receipt_id: result.receipt.receipt_id, outcome: result.receipt.outcome };
  }
  async function pending() {
    const { preview } = await run({});
    const q = preview.kind === "dispatch" && preview.payload.question;
    if (!q) return { status: "workflow", next: preview.kind };
    if (q.expires_at_ms !== undefined && q.expires_at_ms <= Date.now()) return { status: "expired" };
    const slot = slotFor(q);
    return { q, slot };
  }
  async function receive(envelope) {
    const state = await pending();
    if (!state.q) {
      if (envelope) fail("OPERATOR_QUESTION_CHANGED");
      return state;
    }
    const { q, slot } = state;
    const answer = envelope ?? slot.envelope;
    if (!answer) return { status: "awaiting" };
    authenticate(answer, q, slot.ref, Date.now());
    const planned = await run({ decisionSource: slot.ref });
    if (planned.preview.kind !== "decision" || shadowHash(planned.preview.payload.question) !== shadowHash(q)
      || planned.preview.payload.operation_id !== q.operation_id) fail("OPERATOR_QUESTION_CHANGED");
    retain(slot, answer);
    const file = path.join(checkedInbox(), slot.ref + ".json");
    if (!fs.existsSync(file)) writeFileAtomicSync(file, JSON.stringify(answer), { mode: 0o600 });
    // Both writers materialize only the immutable winning envelope.
    if (shadowHash(read(file)) !== shadowHash(answer)) fail("OPERATOR_SOURCE_CHANGED");
    writeFileAtomicSync(lastAnswer, JSON.stringify({ operation_id: q.operation_id, source_ref: slot.ref, question_sha256: answer.subject_sha256 }), { mode: 0o600 });
    const result = await run({ decisionSource: slot.ref, preparedAction: planned.preview, execute: true, expectPlan: planned.action_sha256 });
    const receipt = result.result?.details?.receipt;
    if (!receipt || !result.result.details.accepted) fail("OPERATOR_RECEIPT_PENDING");
    return { status: "received", operation_id: q.operation_id, question_sha256: shadowHash(q), choice: answer.payload.choice,
      receipt_id: receipt.receipt_id, outcome: receipt.outcome };
  }
  async function recoverMessage(selector) {
    const evidence = codexMessageEvidence(chat, selector);
    const receipt = () => recordedReceipt(selector, evidence);
    const accepted = receipt();
    if (accepted) return accepted;
    if (!authority.humanPrincipals().some(principal => principal.authority_id === chat.authority_id))
      fail("CODEX_CHAT_PRINCIPAL_NOT_ENROLLED");
    const state = await pending();
    if (!state.q || state.q.operation_id !== selector.operation_id || shadowHash(state.q) !== selector.question_sha256)
      return receipt() ?? fail("OPERATOR_QUESTION_CHANGED");
    const { q, slot } = state;
    const published = readAgentRunFile(path.join(checkedInbox(), slot.ref + ".json"), { optional: true, maxBytes: 262144 })?.value;
    if (slot.envelope && published && shadowHash(slot.envelope) !== shadowHash(published)) fail("OPERATOR_SOURCE_CHANGED");
    const envelope = slot.envelope ?? published;
    if (!envelope) return { status: "awaiting_attestation", operation_id: q.operation_id, question_sha256: selector.question_sha256,
      source_ref: slot.ref, authority_id: chat.authority_id, evidence };
    authenticate(envelope, q, slot.ref, Date.now());
    if (envelope.authority_id !== chat.authority_id) fail("CODEX_MESSAGE_AUTHOR_CHANGED");
    assertCodexMessageEvidence(envelope.payload.evidence_refs, evidence);
    try {
      await receive(envelope);
    } catch (error) {
      const concurrent = receipt();
      if (concurrent) return concurrent;
      throw error;
    }
    return receipt() ?? fail("OPERATOR_RECEIPT_PENDING");
  }
  return {
    session: () => ({ instance: resolved.instance_id, principals: authority.humanPrincipals(),
      last_receipt: recordedReceipt(readAgentRunFile(lastAnswer, { optional: true })?.value) }),
    async question() {
      const state = await pending();
      if (!state.q) return state;
      if (state.slot.envelope) return { status: "retained", question_sha256: shadowHash(state.q) };
      return { status: "question", offer: { ...operatorOffer(state.q, state.slot.ref), repository: repositoryFor(state.q) } };
    },
    submit: envelope => receive(envelope),
    resume: () => receive(null),
    ...(chat && { recoverMessage }),
  };
}
