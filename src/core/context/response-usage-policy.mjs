import { isDeepStrictEqual } from "node:util";

const FIELDS = {
  input_tokens: "inputTokens", cached_input_tokens: "cachedInputTokens",
  output_tokens: "outputTokens", reasoning_output_tokens: "reasoningOutputTokens",
};

// Provider response usage is a cumulative-work observation, not window pressure,
// an admission receipt, or a financial charge. No document-byte estimate enters it.
export function createResponseUsageObserver() {
  const responses = new Map();
  let duplicates = 0;
  return {
    observe(event) {
      if (event?.method !== "rawResponse/completed") return;
      const { threadId, responseId, usage } = event.params ?? {};
      if (typeof threadId !== "string" || !threadId || typeof responseId !== "string" || !responseId)
        throw new Error("RESPONSE_USAGE_IDENTITY_REQUIRED");
      const row = Object.fromEntries(Object.entries(FIELDS).map(([key, source]) => {
        const value = usage?.[source] ?? null;
        if (value !== null && (!Number.isSafeInteger(value) || value < 0))
          throw new Error("RESPONSE_USAGE_COUNTER_INVALID");
        return [key, value];
      }));
      for (const [subset, total] of [["cached_input_tokens", "input_tokens"], ["reasoning_output_tokens", "output_tokens"]]) {
        if (row[subset] !== null && row[total] !== null && row[subset] > row[total])
          throw new Error("RESPONSE_USAGE_SUBSET_INVALID");
      }
      const key = JSON.stringify([threadId, responseId]);
      if (responses.has(key)) {
        if (!isDeepStrictEqual(responses.get(key), row)) throw new Error("RESPONSE_USAGE_DUPLICATE_CONFLICT");
        duplicates += 1;
      } else responses.set(key, row);
    },
    summary() {
      const rows = [...responses.values()];
      const totals = Object.fromEntries(Object.keys(FIELDS).map(key => {
        if (!rows.length || rows.some(row => row[key] === null)) return [key, null];
        const total = rows.reduce((sum, row) => sum + row[key], 0);
        if (!Number.isSafeInteger(total)) throw new Error("RESPONSE_USAGE_SUM_OVERFLOW");
        return [key, total];
      }));
      totals.uncached_input_tokens = totals.input_tokens !== null && totals.cached_input_tokens !== null
        ? totals.input_tokens - totals.cached_input_tokens : null;
      return {
        contract_version: "response-usage-observation.v1", proof_class: "caller-supplied-events",
        observation_scope: "unique-completed-responses", model_responses: rows.length,
        duplicate_observations: duplicates, tokens: totals,
        token_source: rows.length ? "client-reported" : "unknown",
        complete_counters: rows.length > 0 && Object.values(totals).every(value => value !== null),
        window_pressure: "not_evaluated", admission_evidence: false,
      };
    },
  };
}
