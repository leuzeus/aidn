import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { fingerprintAgentExecutionValue as fingerprint } from "../../src/core/agents/agent-execution-contracts.mjs";
import { createCodexSandboxValidationJournal } from "../../src/adapters/runtime/codex-sandbox-validation-boundary.mjs";
import { createCodexValidationStderr, assertCodexValidationDiagnostics } from "../../src/adapters/runtime/codex-validation-diagnostics.mjs";

export async function verifyCodexValidationDiagnostics({ check, root }) {
  const configurationSha256 = "a".repeat(64), invocationId = "fixture.validation", requestSha256 = "b".repeat(64);
  const launch = { jobName: "Local\\aidn-execution-" + fingerprint({ invocation_id: invocationId, request_sha256: requestSha256 }).slice(0, 32) };
  const intent = { invocationId, requestSha256, launch };
  await check("runtime launch stderr survives restart without promoting an unknown child", async () => {
    const evidenceRoot = path.join(root, "journal-diagnostic"); fs.mkdirSync(evidenceRoot);
    const options = { evidenceRoot, configurationSha256 }, journal = createCodexSandboxValidationJournal(options);
    const prepared = await journal.prepare(intent);
    const content = Buffer.from("Client failed before child handshake.\n"), capture = createCodexValidationStderr();
    capture.consume(content.subarray(0, 11)); capture.consume(content.subarray(11));
    const controller = { termination_state: "confirmed", termination_proof: { active_processes: 0 },
      bytes: { stderr: content.length }, hashes: { stderr_sha256: createHash("sha256").update(content).digest("hex") } };
    const diagnostics = { protocol_failure: "SANDBOX_STOP_UNCONFIRMED", stderr: capture.snapshot(controller) };
    const retained = await journal.record({ prepared, controller, membership: null, child: null, diagnostics });
    assert.equal(retained.terminal.contract_version, "codex-validation-terminal.v2");
    const file = path.join(evidenceRoot, retained.evidence.ref), before = fs.readFileSync(file);
    const restarted = await createCodexSandboxValidationJournal(options).inspect();
    assert.equal(restarted.uncertain_read, null); assert.equal(restarted.operations[0].recovery_required, true);
    assert.equal(restarted.operations[0].termination_state, "unknown");
    assert.deepEqual(restarted.operations[0].terminal.diagnostics, diagnostics); assert.deepEqual(fs.readFileSync(file), before);
    await assert.rejects(journal.record({ prepared, controller, membership: null, child: null, diagnostics }), error => error.code === "EEXIST");
    for (const mutate of [row => { row.stderr.tail_utf8 = "passed"; }, row => { row.stderr.tail_base64 = Buffer.from("forged").toString("base64"); },
      row => { row.stderr.observed_bytes++; }, row => { row.stderr.sha256 = configurationSha256; }, row => { row.protocol_failure = "forged\nerror"; },
      row => { row.stderr.extra = true; }, row => { row.stderr.truncated = true; }]) {
      const changed = JSON.parse(before); mutate(changed.diagnostics); fs.writeFileSync(file, JSON.stringify(changed));
      assert.equal((await journal.inspect()).uncertain_read.reason_code, "SANDBOX_JOURNAL_DIAGNOSTIC_INVALID");
    }
    fs.writeFileSync(file, before);
  });
  await check("diagnostics keep a bound with partial delivery and preserve v1 journals", async () => {
    const capture = createCodexValidationStderr(); capture.consume(Buffer.from("\u00e9".repeat(3000)));
    const controller = { bytes: { stderr: 7000 }, hashes: { stderr_sha256: configurationSha256 } };
    const value = { protocol_failure: null, stderr: capture.snapshot(controller) };
    assertCodexValidationDiagnostics(value, controller); assert.equal(value.stderr.retained_bytes, 4096); assert.equal(value.stderr.truncated, true);
    const partial = createCodexValidationStderr(); partial.consume(Buffer.from([255]));
    assertCodexValidationDiagnostics({ protocol_failure: null, stderr: partial.snapshot() }, {});
    const evidenceRoot = path.join(root, "journal-diagnostic-legacy"); fs.mkdirSync(evidenceRoot);
    const options = { evidenceRoot, configurationSha256 }, journal = createCodexSandboxValidationJournal(options);
    const prepared = await journal.prepare(intent);
    await journal.record({ prepared, controller: { termination_state: "unknown" }, membership: null, child: null });
    const directory = path.join(evidenceRoot, "validation-boundary");
    const files = fs.readdirSync(directory).sort(), before = files.map(file => fs.readFileSync(path.join(directory, file)));
    const observed = await createCodexSandboxValidationJournal(options).inspect();
    assert.equal(observed.uncertain_read, null); assert.equal(observed.operations[0].terminal.contract_version, "codex-validation-terminal.v1");
    assert.equal(observed.operations[0].recovery_required, true);
    assert.deepEqual(files.map(file => fs.readFileSync(path.join(directory, file))), before);
  });
}
