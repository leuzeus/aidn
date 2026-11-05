import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { createAgenticProcess } from "../../src/core/workflow/agentic-process.mjs";
import { agenticPolicyPins } from "../../src/core/workflow/agentic-process-model.mjs";
import { createStandardProcessAuthority } from "../../src/application/runtime/standard-process-authority.mjs";
import { nativeEvidenceFile } from "../../src/application/runtime/native-allocation-evidence.mjs";
import { processParameterOptions } from "../../src/core/workflow/process-data-contracts.mjs";

// Snapshot the complete disposable checkout and owned execution tree. Symlinks
// are observed, never followed into shared dependencies or another arena.
export function diagnosticFixtureWitness(configuration) {
  const rows = []; let bytes = 0;
  const roots = [...new Set([configuration.target_root, configuration.control_root,
    configuration.product_root, configuration.review_root, configuration.native.home])];
  function walk(file, depth = 0) {
    assert.ok(depth <= 64 && rows.length < 10000, "DIAGNOSTIC_FIXTURE_WITNESS_BOUND");
    if (!fs.existsSync(file)) { rows.push({ path: file, kind: "absent" }); return; }
    const stat = fs.lstatSync(file), row = { path: file, mode: stat.mode, dev: stat.dev, ino: stat.ino };
    if (stat.isSymbolicLink()) rows.push({ ...row, kind: "link", target: fs.readlinkSync(file) });
    else if (stat.isDirectory()) {
      const names = fs.readdirSync(file).sort(); rows.push({ ...row, kind: "directory", names });
      for (const name of names) walk(path.join(file, name), depth + 1);
    } else {
      assert.ok(stat.isFile(), "DIAGNOSTIC_FIXTURE_FILE_REQUIRED");
      bytes += stat.size; assert.ok(bytes <= 33554432, "DIAGNOSTIC_FIXTURE_BYTE_BOUND");
      rows.push({ ...row, kind: "file", bytes: stat.size, sha256: createHash("sha256").update(fs.readFileSync(file)).digest("hex") });
    }
  }
  for (const root of roots) walk(root);
  return rows;
}

export function verifyTerminalDiagnosticRefusals({ host, configuration, readSigningKey, humanSource, state }) {
  const model = state.record.model;
  const authority = createStandardProcessAuthority({ configuration, model, readSigningKey, humanSource,
    readProductSha256: () => host.previewNative().product_sha256 });
  assert.throws(() => authority.authenticate(state.record, { diagnostic: true }), { code: "STANDARD_PROCESS_NATIVE_ALLOCATION_ACTIVE" });
  const candidate = (instanceId, scopeId) => createAgenticProcess({ instanceId, model, scopeId, policyPins: agenticPolicyPins(model), facts: {}, ...processParameterOptions(state.record) });
  assert.throws(() => authority.inspectDiagnostic(candidate("foreign", state.record.scope_id)), { code: "STANDARD_PROCESS_AUTHORITY_CHANGED" });
  assert.throws(() => authority.inspectDiagnostic(candidate(configuration.instance_id, "f".repeat(64))), { code: "STANDARD_PROCESS_AUTHORITY_CHANGED" });
  const latest = state.native.journal.allocations.at(-1), file = latest.checkpoint.path, original = fs.readFileSync(file);
  try {
    fs.appendFileSync(file, "\n");
    assert.throws(() => host.inspectDiagnostic(), { code: "NATIVE_ALLOCATION_EVIDENCE_CHANGED" });
    fs.unlinkSync(file);
    assert.throws(() => host.inspectDiagnostic());
  } finally { fs.writeFileSync(file, original); }
  // Authenticate a result from the earlier closed generation as well as the
  // failed generation's assignment. No synthetic replay replaces its origin.
  const evidence = state.native.journal.allocations.slice(0, -1).find(entry => entry.phase === "closed");
  assert.ok(evidence);
  const checkpoint = host.readCheckpoint(evidence.generation), reference = checkpoint.state.results[0]?.reference;
  assert.ok(reference);
  const resultFile = nativeEvidenceFile(configuration, reference, evidence.generation), resultBytes = fs.readFileSync(resultFile);
  try {
    fs.appendFileSync(resultFile, "\n");
    // The latest checkpoint includes earlier results, whose exact retained
    // evidence bytes must still authenticate against their signed references.
    assert.throws(() => host.inspectDiagnostic(), { code: "NATIVE_ALLOCATION_EVIDENCE_CHANGED" });
  } finally { fs.writeFileSync(resultFile, resultBytes); }
  return { checks: 6, phase: latest.phase, first_failure: latest.first_failure,
    resume_authority: "NOT_ESTABLISHED", business_resource_disposition: "NOT_PERFORMED" };
}
