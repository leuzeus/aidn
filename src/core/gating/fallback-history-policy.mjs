export const FALLBACK_WINDOW_MS = 45 * 60 * 1000;

const EXPECTED_RELOAD_REASONS = new Set([
  "MISSING_CACHE", "HEAD_CHANGED", "BRANCH_CHANGED", "ARTIFACTS_CHANGED",
  "ACTIVE_CYCLES_CHANGED", "STRUCTURE_PROFILE_CHANGED",
]);

export function countsAsRecentAnomalousFallback(event, { nowMs = Date.now(), branch = "" } = {}) {
  if (event?.skill !== "reload-check" || event.result !== "fallback") return false;
  if (branch && event.branch && event.branch !== branch) return false;
  const timestamp = Date.parse(String(event.ts ?? ""));
  // Missing/invalid/future timestamps cannot prove that an anomaly is old.
  if (Number.isFinite(timestamp) && timestamp < nowMs - FALLBACK_WINDOW_MS) return false;
  const reasons = Array.isArray(event.reason_codes) ? event.reason_codes
    : String(event.reason_code ?? "").split(/[|,;]/);
  const codes = reasons.map(code => String(code).trim()).filter(Boolean);
  const explainedDigestChange = codes.some(code => EXPECTED_RELOAD_REASONS.has(code));
  return codes.length === 0 || codes.some(code => !EXPECTED_RELOAD_REASONS.has(code)
    && !(code === "DIGEST_MISS" && explainedDigestChange));
}
