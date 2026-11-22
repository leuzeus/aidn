const encoder = new TextEncoder();
const invalid = () => { throw Error("Le fichier doit être une clé Ed25519 PEM chiffrée avec PBES2, PBKDF2 et AES-CBC."); };
const hex = bytes => Array.from(bytes, b => b.toString(16).padStart(2, "0")).join("");
export const base64 = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes)));
function pem(text, name) {
  const lines = text.trim().split(/\r?\n/);
  if (lines.shift() !== `-----BEGIN ${name}-----` || lines.pop() !== `-----END ${name}-----`
    || !lines.length || !lines.every(line => /^[A-Za-z0-9+/]+={0,2}$/.test(line))) invalid();
  return Uint8Array.from(atob(lines.join("")), c => c.charCodeAt(0));
}
// DER reader for the single EncryptedPrivateKeyInfo profile used at enrollment.
// All cipher and key operations are performed by the platform's WebCrypto.
function sequence(bytes) {
  let at = 0;
  function take(tag) {
    if (bytes[at++] !== tag || at >= bytes.length) invalid();
    let length = bytes[at++];
    if (length >= 128) {
      const count = length - 128;
      if (!count || count > 3 || at + count > bytes.length || !bytes[at]) invalid();
      length = 0;
      for (let i = 0; i < count; i++) length = length * 256 + bytes[at++];
      if (length < 128) invalid();
    }
    if (at + length > bytes.length) invalid();
    const value = bytes.subarray(at, at + length);
    at += length;
    return value;
  }
  return {
    take, seq: () => sequence(take(0x30)), oid: () => hex(take(6)), peek: () => bytes[at],
    number() {
      const data = take(2);
      if (!data.length || data.length > 4 || data[0] >= 128 || data.length > 1 && !data[0] && data[1] < 128) invalid();
      return data.reduce((n, b) => n * 256 + b, 0);
    },
    end() { if (at !== bytes.length) invalid(); },
  };
}

export async function unlockOperatorKey(text, password, principals) {
  if (text.length > 16384 || !password) invalid();
  const der = sequence(pem(text, "ENCRYPTED PRIVATE KEY"));
  const root = der.seq();
  der.end();
  const algorithm = root.seq();
  if (algorithm.oid() !== "2a864886f70d01050d") invalid(); // PBES2
  const parameters = algorithm.seq();
  algorithm.end();
  const kdf = parameters.seq();
  if (kdf.oid() !== "2a864886f70d01050c") invalid(); // PBKDF2
  const params = kdf.seq();
  kdf.end();
  const salt = params.take(4), iterations = params.number();
  if (salt.length < 8 || !iterations || iterations > 10000000) invalid();
  const keyBytes = params.peek() === 2 ? params.number() : null;
  let hash = "SHA-1"; // RFC 8018 default PRF
  if (params.peek() === 0x30) {
    const prf = params.seq();
    hash = new Map([["2a864886f70d0207", "SHA-1"], ["2a864886f70d0209", "SHA-256"],
      ["2a864886f70d020a", "SHA-384"], ["2a864886f70d020b", "SHA-512"]]).get(prf.oid());
    if (!hash || prf.peek() === 5 && prf.take(5).length) invalid();
    prf.end();
  }
  params.end();
  const cipher = parameters.seq();
  parameters.end();
  const length = new Map([["608648016503040102", 128], ["608648016503040116", 192], ["60864801650304012a", 256]]).get(cipher.oid());
  const iv = cipher.take(4);
  cipher.end();
  if (!length || iv.length !== 16 || keyBytes !== null && keyBytes !== length / 8) invalid();
  const encrypted = root.take(4);
  root.end();
  const encoded = encoder.encode(password);
  let clear;
  try {
    const secret = await crypto.subtle.importKey("raw", encoded, "PBKDF2", false, ["deriveKey"]);
    const aes = await crypto.subtle.deriveKey({ name: "PBKDF2", hash, iterations, salt }, secret, { name: "AES-CBC", length }, false, ["decrypt"]);
    clear = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-CBC", iv }, aes, encrypted));
    const key = await crypto.subtle.importKey("pkcs8", clear, "Ed25519", false, ["sign"]);
    const nonce = crypto.getRandomValues(new Uint8Array(32));
    const proof = await crypto.subtle.sign("Ed25519", key, nonce);
    for (const principal of principals) {
      const pub = await crypto.subtle.importKey("spki", pem(principal.public_key, "PUBLIC KEY"), "Ed25519", false, ["verify"]);
      if (await crypto.subtle.verify("Ed25519", pub, proof, nonce)) return { key, id: principal.authority_id };
    }
    throw Error("Cette clé ne correspond à aucun signataire humain inscrit.");
  } finally {
    encoded.fill(0);
    clear?.fill(0);
  }
}

function canonical(value) {
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (value && typeof value === "object") return "{" + Object.keys(value).sort().map(k => JSON.stringify(k) + ":" + canonical(value[k])).join(",") + "}";
  return JSON.stringify(value);
}
export async function digest(value) {
  return hex(new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(canonical(value)))));
}

export async function signedAnswer(operator, offer, choice, fields, validMinutes) {
  if (await digest(offer.question) !== offer.question_sha256 || !offer.question.choices.includes(choice)) throw Error("La question a changé.");
  const issued = Date.now();
  if (issued < (offer.question.issued_at_ms ?? 0) || issued >= (offer.question.expires_at_ms ?? Infinity)) throw Error("Cette question a expiré.");
  const payload = { ...fields, contract_version: offer.claim_version, source_kind: "human", authority_id: operator.id,
    source_event_id: offer.source_ref, subject_sha256: offer.subject_sha256, question_sha256: offer.question_sha256, choice,
    evidence_refs: [{ ref: "aidn:question/" + offer.question.operation_id, sha256: offer.question_sha256 }] };
  const expires = offer.question.expires_at_ms ?? issued + validMinutes * 60000;
  const body = { contract_version: "standard-host-source.v1", kind: "human", authority_id: operator.id, source_ref: offer.source_ref,
    subject_sha256: offer.question_sha256, payload, issued_at_ms: issued, expires_at_ms: expires };
  const signature = await crypto.subtle.sign("Ed25519", operator.key, encoder.encode(await digest(body)));
  return { ...body, signature: base64(signature) };
}
