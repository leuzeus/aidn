import { createHash } from "node:crypto";

// Diagnostic vocabulary only; it grants no RPC execution or notification acceptance.
// Generated from the official Codex 0.158.0-alpha.2.1 experimental server schemas:
// ServerNotification.json SHA256 871046f308da617d6cbfb372ff0260a778d8b959ae7eca8757a2edcb4c5f3900
// ServerRequest.json SHA256 3d7bc481f84dc042984a74420e65c5a8d3c423f37a91b7d5df2365c903a12ac6
const METHODS = new Set([
  "account/chatgptAuthTokens/refresh", "account/gatewayOAuth/changed", "account/login/completed",
  "account/rateLimits/updated", "account/updated", "app/list/updated",
  "applyPatchApproval", "attestation/generate", "autoApprovalReview/strictReviewRequired",
  "command/exec/outputDelta", "configWarning", "currentTime/read",
  "deprecationNotice", "error", "execCommandApproval",
  "externalAgentConfig/import/completed", "externalAgentConfig/import/progress", "fs/changed",
  "fuzzyFileSearch/sessionCompleted", "fuzzyFileSearch/sessionUpdated", "guardianWarning",
  "hook/completed", "hook/started", "item/agentMessage/delta",
  "item/autoApprovalReview/completed", "item/autoApprovalReview/started", "item/commandExecution/outputDelta",
  "item/commandExecution/requestApproval", "item/commandExecution/terminalInteraction", "item/completed",
  "item/fileChange/outputDelta", "item/fileChange/patchUpdated", "item/fileChange/requestApproval",
  "item/mcpToolCall/progress", "item/permissions/requestApproval", "item/plan/delta",
  "item/reasoning/summaryPartAdded", "item/reasoning/summaryTextDelta", "item/reasoning/textDelta",
  "item/started", "item/tool/call", "item/tool/requestUserInput",
  "mcpServer/elicitation/request", "mcpServer/event/stream/notification", "mcpServer/oauthLogin/completed",
  "mcpServer/startupStatus/updated", "model/rerouted", "model/safetyBuffering/updated",
  "model/verification", "modelProvider/authRecoveryCompleted", "modelProvider/authRecoveryStarted",
  "process/exited", "process/outputDelta", "project/changed",
  "remoteControl/status/changed", "serverRequest/resolved", "skills/changed",
  "thread/archived", "thread/attachment/updated", "thread/closed",
  "thread/compacted", "thread/deleted", "thread/environment/connected",
  "thread/environment/disconnected", "thread/goal/cleared", "thread/goal/updated",
  "thread/name/updated", "thread/project/updated", "thread/queue/changed",
  "thread/realtime/closed", "thread/realtime/error", "thread/realtime/item/completed",
  "thread/realtime/item/started", "thread/realtime/item/transcript/delta", "thread/realtime/itemAdded",
  "thread/realtime/outputAudio/delta", "thread/realtime/sdp", "thread/realtime/started",
  "thread/realtime/transcript/delta", "thread/realtime/transcript/done", "thread/reverted",
  "thread/settings/updated", "thread/started", "thread/status/changed",
  "thread/tokenUsage/updated", "thread/unarchived", "turn/completed",
  "turn/diff/updated", "turn/moderationMetadata", "turn/plan/updated",
  "turn/started", "warning", "windows/worldWritableWarning",
  "windowsSandbox/setupCompleted",
]);

const FIELDS = ["version", "kind", "method_type", "method", "method_sha256", "id_type", "phase", "expected_method", "request_index"];
const VALUE_TYPES = new Set(["null", "boolean", "number", "string", "object", "array"]);
const REQUEST_METHODS = new Set(["initialize", "config/read", "hooks/list", "windowsSandbox/readiness"]);
const valueType = value => value === null ? "null" : Array.isArray(value) ? "array" : typeof value;

// Copy only a closed, bounded diagnostic. Invalid data is absent, never a new
// failure reason: diagnostics cannot override process termination or RPC refusal.
export function sanitizeCodexMetadataRpcDiagnostic(value) {
  try {
    if (!value || typeof value !== "object" || Array.isArray(value)
      || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) return null;
    const names = Reflect.ownKeys(value), descriptors = Object.getOwnPropertyDescriptors(value);
    if (names.length !== FIELDS.length || !FIELDS.every(name => names.includes(name)
      && Object.hasOwn(descriptors[name], "value"))) return null;
    const clean = Object.fromEntries(FIELDS.map(name => [name, descriptors[name].value]));
    if (clean.version !== 1 || !["notification", "server_request"].includes(clean.kind)
      || !VALUE_TYPES.has(clean.method_type) || !(clean.id_type === "absent" || VALUE_TYPES.has(clean.id_type))
      || (clean.kind === "notification") !== (clean.id_type === "absent")
      || !Number.isInteger(clean.request_index) || clean.request_index < 1 || clean.request_index > 7
      || !(clean.phase === "awaiting_response" && REQUEST_METHODS.has(clean.expected_method)
        || clean.phase === "after_responses" && clean.expected_method === "complete")) return null;
    if (clean.method_type === "string") {
      if (!(typeof clean.method === "string" && METHODS.has(clean.method) && clean.method_sha256 === null
        || clean.method === null && typeof clean.method_sha256 === "string" && /^[a-f0-9]{64}$/.test(clean.method_sha256))) return null;
    } else if (clean.method !== null || clean.method_sha256 !== null) return null;
    return Buffer.byteLength(JSON.stringify(clean)) < 1024 ? clean : null;
  } catch { return null; }
}

// The input message is already parsed by the stock transport. Never retain its
// params, result, error, id value, or arbitrary method text.
export function createCodexMetadataRpcDiagnostic({ message, expectedMethod, requestIndex, phase } = {}) {
  try {
    const methodType = valueType(message.method), idType = message.id === undefined ? "absent" : valueType(message.id);
    const known = methodType === "string" && METHODS.has(message.method);
    return sanitizeCodexMetadataRpcDiagnostic({ version: 1, kind: idType === "absent" ? "notification" : "server_request",
      method_type: methodType, method: known ? message.method : null,
      method_sha256: methodType === "string" && !known ? createHash("sha256").update(message.method).digest("hex") : null,
      id_type: idType, phase, expected_method: expectedMethod, request_index: requestIndex });
  } catch { return null; }
}
