import { createHash } from "node:crypto";

const fail = code => { throw Object.assign(new Error(code), { code }); };
export const localContextHash = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");

// Only the host emits chat delimiters. Text from observations cannot create a
// new chat role. This is the complete model input; there is no hidden template.
export function renderLocalContext(document, template = "chatml") {
  if (typeof document?.prefix?.system !== "string" || typeof document?.prefix?.task !== "string"
      || !Array.isArray(document.entries) || /<\|/.test(document.prefix.system)) fail("LOCAL_CLM_DOCUMENT_INVALID");
  const data = JSON.stringify({ task: document.prefix.task, entries: document.entries }).replaceAll("<", "\\u003c");
  if (!["chatml", "qwen3-no-think"].includes(template)) fail("LOCAL_CLM_TEMPLATE_UNSUPPORTED");
  return `<|im_start|>system\n${document.prefix.system}<|im_end|>\n<|im_start|>user\n${data}<|im_end|>\n<|im_start|>assistant\n`
    + (template === "qwen3-no-think" ? "<think>\n\n</think>\n\n" : "");
}

// The caller owns the exact-hash-verified local process. This port never starts
// a model, follows a redirect, discovers a provider or edits a native client.
export function createLocalClmPort({ endpoint, apiKey, identity, capacityTokens, reservedTokens, fetchImpl = fetch,
  observe = async () => {}, template = "chatml" }) {
  const url = new URL(endpoint);
  if (url.protocol !== "http:" || url.hostname !== "127.0.0.1" || !url.port || url.pathname !== "/"
      || url.search || url.hash || url.username || url.password || typeof apiKey !== "string" || !apiKey
      || !["provider", "model", "model_revision", "client", "client_version"].every(k => typeof identity?.[k] === "string" && identity[k])
      || !["chatml", "qwen3-no-think"].includes(template) || typeof observe !== "function" || !Number.isSafeInteger(capacityTokens) || capacityTokens <= 0
      || !Number.isSafeInteger(reservedTokens) || reservedTokens <= 0 || reservedTokens >= capacityTokens)
    fail("LOCAL_CLM_HOST_CONFIGURATION_REQUIRED");
  const binding = structuredClone(identity);
  async function request(route, body) {
    const response = await fetchImpl(new URL(route, url), { method: "POST", redirect: "error",
      // Checkpoint CLI calls can block this process past the server's idle
      // keepalive timeout. Use one connection per request, never retry a turn.
      headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}`, connection: "close" },
      body: JSON.stringify(body), signal: AbortSignal.timeout(180000) });
    if (!response.ok) fail("LOCAL_CLM_NATIVE_REQUEST_REFUSED");
    const text = await response.text();
    if (Buffer.byteLength(text) > 2 * 1024 * 1024) fail("LOCAL_CLM_NATIVE_RESPONSE_TOO_LARGE");
    return JSON.parse(text);
  }
  async function tokenize(serialized) {
    if (typeof serialized !== "string" || Buffer.byteLength(serialized) > 262144) fail("LOCAL_CLM_DOCUMENT_INVALID");
    const prompt = renderLocalContext(JSON.parse(serialized), template);
    const result = await request("tokenize", { content: prompt, add_special: false, parse_special: true });
    if (!Array.isArray(result.tokens) || !result.tokens.length
        || result.tokens.some(t => !Number.isSafeInteger(t) || t < 0)) fail("LOCAL_CLM_TOKENIZATION_INVALID");
    return { tokens: result.tokens, prompt_sha256: createHash("sha256").update(prompt).digest("hex") };
  }
  return {
    identity: structuredClone(binding),
    async count(serialized, tokenizerIdentity) {
      if (!["provider", "model", "model_revision"].every(k => tokenizerIdentity?.[k] === binding[k])
          || tokenizerIdentity.tokenizer_sha256 !== binding.model_revision) fail("LOCAL_CLM_TOKENIZER_BINDING_REQUIRED");
      return (await tokenize(serialized)).tokens.length;
    },
    async complete(document, schema) {
      const { tokens, prompt_sha256 } = await tokenize(JSON.stringify(document));
      if (tokens.length + reservedTokens > capacityTokens) fail("LOCAL_CLM_HARD_LIMIT");
      const started = Date.now();
      await observe({ stage: "input", document: structuredClone(document), token_ids: [...tokens], prompt_sha256 });
      // Explicit token IDs bypass template rendering and implicit BOS insertion.
      const result = await request("completion", { prompt: tokens, n_predict: reservedTokens,
        temperature: 0, seed: 101, cache_prompt: false, stream: false, json_schema: schema });
      await observe({ stage: "output", content: result.content, tokens_evaluated: result.tokens_evaluated,
        tokens_predicted: result.tokens_predicted, truncated: result.truncated, prompt_sha256 });
      if (result.truncated !== false || result.tokens_evaluated !== tokens.length
          || !Number.isSafeInteger(result.tokens_predicted) || result.tokens_predicted > reservedTokens
          || typeof result.content !== "string") fail("LOCAL_CLM_NATIVE_INPUT_MISMATCH");
      return { value: JSON.parse(result.content), input_tokens: tokens.length,
        output_tokens: result.tokens_predicted, prompt_sha256, document_sha256: localContextHash(document),
        elapsed_ms: Date.now() - started, truncated: false };
    },
  };
}
