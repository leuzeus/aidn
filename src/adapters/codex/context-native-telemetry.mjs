import { validateContextTelemetry } from "../../core/context/context-metrics-policy.mjs";

// Only the trusted host calls this adapter with a native event and separately
// observed window identity. Thread IDs and lifetime totals are not window usage.
export function contextTelemetryFromNativeUsage({ event, windowId, model, provider, client, clientVersion,
  reservedTokens = 0, counts, now = Date.now() } = {}) {
  if (event?.method !== "thread/tokenUsage/updated" || typeof windowId !== "string" || !windowId) return null;
  const usage = event.params?.tokenUsage;
  if (!Number.isSafeInteger(usage?.last?.totalTokens) || !Number.isSafeInteger(usage?.modelContextWindow)
      || !Number.isSafeInteger(event.emittedAtMs) || event.emittedAtMs > now + 5000 || now - event.emittedAtMs > 300000) return null;
  const telemetry = { contract_version: "context-telemetry.v1", window_id: windowId, model, provider, client,
    client_version: clientVersion, observed_at: new Date(event.emittedAtMs).toISOString(),
    used_tokens: usage.last.totalTokens, capacity_tokens: usage.modelContextWindow, reserved_tokens: reservedTokens,
    ...(counts ? { counts: structuredClone(counts) } : {}) };
  try { validateContextTelemetry(telemetry, now); return telemetry; } catch { return null; }
}
