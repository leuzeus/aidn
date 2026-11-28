import fs from "node:fs";
import { randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { codexDecisionForm } from "./codex-decision-channel.mjs";
import { assertOperatorClaim } from "./standard-operator-offer.mjs";
import {
  windowsOperatorChoices, windowsOperatorId, windowsPanelChallenge, windowsPanelEvidence, windowsPanelSourceVersion,
} from "../runtime/standard-windows-operator-authority.mjs";

const page = new URL("./standard-windows-decision-panel.html", import.meta.url);
const script = new URL("./standard-windows-decision-page.mjs", import.meta.url);
const fail = code => { throw Error(code); };
const token = () => randomBytes(32).toString("base64url");

export function prepareWindowsPanelAnswer(policy, offer, content, issued = Date.now()) {
  const { question } = offer;
  const { choice, fields, minutes } = codexDecisionForm(offer).read(content);
  if (!windowsOperatorChoices(policy, question).includes(choice)) fail("STANDARD_WINDOWS_OPERATOR_DECISION_REFUSED");
  const expires = question.expires_at_ms ?? issued + minutes * 60_000;
  if (issued < (question.issued_at_ms ?? 0) || issued >= expires) fail("OPERATOR_QUESTION_CHANGED");
  const body = {
    contract_version: windowsPanelSourceVersion, kind: "human", authority_id: windowsOperatorId,
    source_ref: offer.source_ref, subject_sha256: offer.question_sha256, issued_at_ms: issued, expires_at_ms: expires, nonce: token(),
    payload: { ...fields, contract_version: offer.claim_version, source_kind: "human", authority_id: windowsOperatorId,
      source_event_id: offer.source_ref, subject_sha256: offer.subject_sha256, question_sha256: offer.question_sha256, choice },
  };
  body.payload.evidence_refs = [windowsPanelEvidence(policy, body)];
  assertOperatorClaim(body.payload, question, offer.source_ref);
  return { body, options: { challenge: windowsPanelChallenge(policy, body), rpId: "localhost",
    allowCredentials: [{ type: "public-key", id: policy.credential_id, transports: ["internal"] }],
    userVerification: "required", timeout: 120_000 } };
}

async function readJson(request) {
  if (request.headers["content-type"] !== "application/json") fail("INVALID_CONTENT_TYPE");
  let size = 0;
  const chunks = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 32_768) fail("REQUEST_TOO_LARGE");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

export async function serveWindowsDecisionPanel({ session, threadId, lifetimeMs = 1_800_000 }) {
  const policy = session.windowsOperatorPolicy?.();
  if (!policy || policy.thread_id !== threadId) fail("STANDARD_WINDOWS_OPERATOR_CHAT_CHANGED");
  const origin = new URL(policy.origin);
  const pathPrefix = "/" + token() + "/";
  const tickets = new Map();
  let offered, active = false, receipt;

  function renderOffer(state) {
    if (state.status !== "question") return state.status === "retained" ? state : session.session().last_receipt ?? state;
    const { offer } = state;
    const choices = windowsOperatorChoices(policy, offer.question);
    if (!choices.length) fail("STANDARD_WINDOWS_OPERATOR_DECISION_REFUSED");
    const { requestedSchema, message } = codexDecisionForm(offer).request;
    requestedSchema.properties.choice.enum = choices;
    offered = offer;
    return { status: "question", question_sha256: offer.question_sha256, message, requestedSchema };
  }

  const sendJson = (res, data, status = 200) => res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" }).end(JSON.stringify(data));
  const server = createServer(async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Security-Policy",
      "default-src 'none'; connect-src 'self'; script-src 'self'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");
    if (req.headers.host !== origin.host || !req.url?.startsWith(pathPrefix)) return res.writeHead(404).end();
    const route = req.url.slice(pathPrefix.length);
    try {
      if (req.method === "GET") {
        if (!route) return res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }).end(fs.readFileSync(page));
        if (route === "panel.mjs") return res.writeHead(200, { "Content-Type": "text/javascript; charset=utf-8" }).end(fs.readFileSync(script));
        if (route === "offer") return sendJson(res, receipt ?? renderOffer(await session.question()));
      }
      if (req.method !== "POST" || req.headers.origin !== origin.origin) return res.writeHead(404).end();
      const data = await readJson(req);
      if (route === "challenge") {
        if (!offered || receipt || active || data?.question_sha256 !== offered.question_sha256) fail("OPERATOR_QUESTION_CHANGED");
        const { body, options } = prepareWindowsPanelAnswer(policy, offered, data.fields);
        for (const [id, ticket] of tickets) if (ticket.expires_at_ms <= Date.now()) tickets.delete(id);
        if (tickets.size >= 32) fail("OPERATOR_DECISION_IN_PROGRESS");
        tickets.set(body.nonce, body);
        return sendJson(res, { nonce: body.nonce, options });
      }
      if (route === "confirm") {
        const body = tickets.get(data?.nonce);
        if (!body || body.expires_at_ms <= Date.now() || receipt || active) fail("OPERATOR_QUESTION_CHANGED");
        active = true;
        try {
          const accepted = await session.submit({ ...body, assertion: data.assertion });
          if (accepted?.status !== "received") fail("OPERATOR_RECEIPT_PENDING");
          receipt = accepted;
          tickets.clear();
          return sendJson(res, receipt);
        } finally { active = false; }
      }
      return res.writeHead(404).end();
    } catch (error) {
      const code = /^[A-Z][A-Z_0-9]{0,100}$/.test(error.message) ? error.message : "OPERATOR_PANEL_UNAVAILABLE";
      return sendJson(res, { status: "refused", code }, 409);
    }
  });

  await new Promise((resolve, reject) => server.once("error", reject).listen({
    host: "127.0.0.1", port: Number(origin.port), exclusive: true,
  }, resolve));
  const close = () => server.close();
  const timer = setTimeout(close, lifetimeMs);
  server.once("close", () => clearTimeout(timer));
  return { url: origin.origin + pathPrefix, close, server };
}
