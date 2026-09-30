import { fileURLToPath } from "node:url";
import path from "node:path";
import { sanitizeCodexMetadataRpcDiagnostic } from "../codex-metadata-rpc-diagnostic.mjs";
import { collectCodexNativeProfileMetadata } from "../../../application/runtime/codex-native-profile-observation-service.mjs";
import { fingerprintAgentExecutionValue as fingerprint } from "../../../core/agents/agent-execution-contracts.mjs";

function bridgeError(cause) {
  const code = /^[A-Z][A-Z0-9_]{0,100}$/u.test(cause.code ?? "") ? cause.code : "PROFILE_TREE_BRIDGE_FAILED";
  const diagnostic = sanitizeCodexMetadataRpcDiagnostic(cause.details?.metadata_rpc);
  return { code, process: cause.process ?? null, ...(diagnostic ? { details: { metadata_rpc: diagnostic } } : {}) };
}

// Executed only as a pinned Node child already assigned to the supervisor Job.
// Import and validation have no effects. Raw metadata remains bounded pipe data;
// readiness never authorizes provisioning, threads or workers.
export async function runCodexProfileMetadataBridge(document, { collect = collectCodexNativeProfileMetadata } = {}) {
  let identity = { protocol: "aidn-controlled-profile-metadata.v1", invocation_id: null, request_sha256: null };
  try {
    const { request_sha256, ...body } = document;
    const fields = ["protocol", "invocation_id", "input", "timeout_ms"];
    if (Object.keys(body).sort().join("|") !== fields.sort().join("|") || fingerprint(body) !== request_sha256 || typeof body.invocation_id !== "string"
      || !Number.isSafeInteger(body.timeout_ms) || body.timeout_ms < 1 || body.timeout_ms > 60000 || typeof collect !== "function") {
      throw Object.assign(new Error(), { code: "PROFILE_TREE_INPUT_INVALID" });
    }
    if (Object.hasOwn(body.input ?? {}, "metadataProfile")) {
      throw Object.assign(new Error(), { code: "PROFILE_METADATA_PROFILE_INVALID" });
    }
    if (body.protocol !== identity.protocol) throw Object.assign(new Error(), { code: "PROFILE_TREE_INPUT_INVALID" });
    identity = { protocol: identity.protocol, invocation_id: body.invocation_id, request_sha256 };
    const result = await collect(body.input, { timeoutMs: body.timeout_ms });
    const output = { ...identity, ok: true, result };
    if (Buffer.byteLength(JSON.stringify(output)) > 2 * 1024 * 1024 + 32768) throw Object.assign(new Error(), { code: "PROFILE_TREE_OUTPUT_LIMIT", process: result.process });
    return output;
  } catch (cause) {
    return { ...identity, ok: false, error: bridgeError(cause) };
  }
}

// No new public command: the existing controller supplies the pinned stdin body.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const chunks = []; let count = 0;
    for await (const chunk of process.stdin) { count += chunk.length; if (count > 262144) throw Object.assign(new Error(), { code: "PROFILE_TREE_INPUT_LIMIT" }); chunks.push(chunk); }
    const document = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks, count)));
    const output = await runCodexProfileMetadataBridge(document);
    process.stdout.write(JSON.stringify(output) + "\n"); if (!output.ok) process.exitCode = 1;
  } catch (cause) {
    process.stdout.write(JSON.stringify({ protocol: "aidn-controlled-profile-metadata.v1", invocation_id: null, request_sha256: null,
      ok: false, error: bridgeError(cause) }) + "\n"); process.exitCode = 1;
  }
}
