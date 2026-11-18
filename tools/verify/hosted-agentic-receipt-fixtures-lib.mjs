import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  agenticFixtureSegment,
  agenticSegmentArtifact,
  agenticSegmentEnds,
  readAgenticFixtureManifest,
  saveAgenticSegmentReceipt,
  verifyHostedAgenticReceipts,
} from "../ci/agentic-fixture-segments-lib.mjs";

export function verifyHostedAgenticReceiptFixtures(repoRoot) {
  const manifest = readAgenticFixtureManifest(repoRoot);
  const segments = agenticSegmentEnds.map((_, index) => agenticFixtureSegment(manifest, index + 1));
  assert.deepEqual(segments.flatMap(segment => segment.cases), manifest.cases);

  const temp = fs.realpathSync.native(os.tmpdir());
  const root = fs.mkdtempSync(path.join(temp, "aidn-agentic-receipt-fixture-"));
  const dir = path.join(root, "artifacts");
  const evidenceDir = path.join(root, "observations");
  fs.mkdirSync(dir);
  fs.mkdirSync(evidenceDir);
  const timestamp = "2026-01-01T00:00:00.000Z";
  const identity = { repository: "fixture/aidn", run_id: "100", attempt: "2", source: "1".repeat(40), context: "dev" };
  const checks = [];
  const writeJson = (file, value) => fs.writeFileSync(file, JSON.stringify(value));
  const verify = () => verifyHostedAgenticReceipts({ dir, manifest, identity });

  try {
    for (const segment of segments) {
      const artifact = path.join(dir, agenticSegmentArtifact + segment.number);
      fs.mkdirSync(artifact);
      const events = segment.cases.flatMap((args, offset) => [
        { index: offset + 1, args, started_at: timestamp },
        { index: offset + 1, args, ended_at: timestamp, result: { exit_code: 0, signal: null } },
      ]);
      writeJson(path.join(evidenceDir, "cases.json"), { contract_version: "node-fixture-observation.v1", cases: segment.cases });
      fs.writeFileSync(path.join(evidenceDir, "events.jsonl"), events.map(event => JSON.stringify(event)).join("\n") + "\n");
      writeJson(path.join(evidenceDir, "summary.json"), { exit_code: 0, signal: null, completed: segment.cases.length,
        required: segment.cases.length, ended_at: timestamp });
      // Successful prerequisites can survive a failed-job rerun of this same run.
      saveAgenticSegmentReceipt({ dir: artifact, manifest, number: segment.number, evidenceDir,
        identity: { ...identity, attempt: segment.number === 1 ? "1" : "2" } });
    }

    assert.equal(verify(), manifest.cases.length);
    checks.push("ordered_manifest_with_prior_successful_attempt");

    const last = path.join(dir, agenticSegmentArtifact + segments.length, "aidn-agentic-segment.json");
    const original = fs.readFileSync(last);
    const reject = (name, change, error) => {
      const receipt = JSON.parse(original);
      change(receipt);
      try {
        writeJson(last, receipt);
        assert.throws(verify, error);
        checks.push(name);
      } finally {
        fs.writeFileSync(last, original);
      }
    };
    reject("foreign_source", receipt => { receipt.source = "2".repeat(40); }, /IDENTITY_MISMATCH/);
    reject("foreign_repository", receipt => { receipt.repository = "foreign/aidn"; }, /IDENTITY_MISMATCH/);
    reject("foreign_run", receipt => { receipt.run_id = "99"; }, /IDENTITY_MISMATCH/);
    reject("foreign_gate_context", receipt => { receipt.context = "main"; }, /IDENTITY_MISMATCH/);
    reject("future_attempt", receipt => { receipt.attempt = "3"; }, /IDENTITY_MISMATCH/);
    reject("different_manifest", receipt => { receipt.manifest_sha256 = "0".repeat(64); }, /IDENTITY_MISMATCH/);
    reject("duplicate_segment", receipt => { receipt.segment -= 1; }, /IDENTITY_MISMATCH/);
    reject("shortened_range", receipt => { receipt.last -= 1; }, /IDENTITY_MISMATCH/);
    reject("missing_case", receipt => { receipt.events.splice(0, 2); }, /INCOMPLETE/);
    reject("reordered_cases", receipt => { receipt.events.push(...receipt.events.splice(0, 2)); }, /CASE_MISMATCH/);
    reject("changed_argv", receipt => { receipt.events[0].args.push("--other"); }, /CASE_MISMATCH/);
    reject("failed_case", receipt => { receipt.events[1].result.exit_code = 1; }, /CASE_MISMATCH/);
    reject("cancelled_case", receipt => { receipt.events[1].result.signal = "SIGTERM"; }, /CASE_MISMATCH/);
    reject("cancelled_segment", receipt => { receipt.summary.signal = "SIGTERM"; }, /INCOMPLETE/);

    fs.renameSync(last, path.join(root, "saved.json"));
    try {
      assert.throws(verify, /ARTIFACT_CONTENT_MISMATCH/);
      checks.push("missing_receipt");
    } finally {
      fs.renameSync(path.join(root, "saved.json"), last);
    }
    fs.mkdirSync(path.join(dir, "unexpected-segment"));
    assert.throws(verify, /ARTIFACT_SET_MISMATCH/);
    checks.push("extra_artifact");
    return checks;
  } finally {
    const physical = fs.realpathSync.native(root);
    assert.equal(path.dirname(physical), temp);
    assert.match(path.basename(physical), /^aidn-agentic-receipt-fixture-[a-zA-Z0-9]+$/);
    fs.rmSync(physical, { recursive: true, force: false });
  }
}
