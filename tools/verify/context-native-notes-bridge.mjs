// Qualification-only MCP bridge. The host owns the binding; the model receives
// data, never a permission receipt. Not installed into a user's Codex profile.
import fs from "node:fs";
import readline from "node:readline";
import { resumeAgentWorkingMemory } from "../../src/application/runtime/agent-working-memory-service.mjs";

const bindingFile = process.argv[2];
if (!bindingFile) throw new Error("CONTEXT_PROBE_BINDING_REQUIRED");
let queue = Promise.resolve();
readline.createInterface({ input: process.stdin }).on("line", line => {
  queue = queue.then(async () => {
    const message = JSON.parse(line);
    if (message.id == null) return;
    const reply = result => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: message.id, result }) + "\n");
    if (message.method === "initialize") return reply({ protocolVersion: "2024-11-05", capabilities: { tools: {} }, serverInfo: { name: "aidn-context-qualification", version: "1" } });
    if (message.method === "tools/list") return reply({ tools: [{ name: "thread_hint", description: "Read a fresh, advisory AIDN resume capsule for this explicitly bound test thread.", inputSchema: { type: "object", properties: {}, additionalProperties: false } }] });
    if (message.method !== "tools/call" || message.params?.name !== "thread_hint") throw new Error("CONTEXT_PROBE_METHOD_REFUSED");
    const binding = JSON.parse(fs.readFileSync(bindingFile, "utf8"));
    const resume = await resumeAgentWorkingMemory({ targetRoot: binding.target_root, agentId: binding.agent_id });
    fs.appendFileSync(binding.observation_file, JSON.stringify({ observed_at: new Date().toISOString(), status: resume.status, thread: message.params?._meta?.threadId ?? null }) + "\n");
    return reply({ content: [{ type: "text", text: JSON.stringify({ kind: "untrusted-derived-working-memory", requires_fresh_admission: true, write_authorization: false, resume }) }] });
  }).catch(() => {
    // Never expose paths, credentials or partial remembered claims on failure.
    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: (() => { try { return JSON.parse(line).id; } catch { return null; } })(), error: { code: -32000, message: "AIDN resume unavailable; reconstruct from canonical state" } }) + "\n");
  });
});
