import { collectCodexNativeProfileMetadata } from "../../../application/runtime/codex-native-profile-observation-service.mjs";
import { fingerprintAgentExecutionValue as fingerprint } from "../../../core/agents/agent-execution-contracts.mjs";

// Executed only as a pinned Node child already assigned to the supervisor Job.
// No log, evidence file, shell, profile edit or native worker is launched here.
// Raw metadata is transient pipe data; all descendants inherit the existing Job.
const protocol = "aidn-controlled-profile-metadata.v1";
let identity = { protocol, invocation_id: null, request_sha256: null };
try {
  const chunks = []; let count = 0;
  for await (const chunk of process.stdin) { count += chunk.length; if (count > 262144) throw Object.assign(new Error(), { code: "PROFILE_TREE_INPUT_LIMIT" }); chunks.push(chunk); }
  const document = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks, count)));
  const { request_sha256, ...body } = document;
  if (body.protocol !== protocol || fingerprint(body) !== request_sha256 || typeof body.invocation_id !== "string"
    || !Number.isSafeInteger(body.timeout_ms) || body.timeout_ms < 1 || body.timeout_ms > 60000) throw Object.assign(new Error(), { code: "PROFILE_TREE_INPUT_INVALID" });
  identity = { protocol, invocation_id: body.invocation_id, request_sha256 };
  const result = await collectCodexNativeProfileMetadata(body.input, { timeoutMs: body.timeout_ms });
  const output = JSON.stringify({ ...identity, ok: true, result });
  if (Buffer.byteLength(output) > 2 * 1024 * 1024 + 32768) throw Object.assign(new Error(), { code: "PROFILE_TREE_OUTPUT_LIMIT", process: result.process });
  process.stdout.write(output + "\n");
} catch (cause) {
  const code = /^[A-Z][A-Z0-9_]{0,100}$/u.test(cause.code ?? "") ? cause.code : "PROFILE_TREE_BRIDGE_FAILED";
  process.stdout.write(JSON.stringify({ ...identity, ok: false, error: { code, process: cause.process ?? null } }) + "\n");
  process.exitCode = 1;
}
