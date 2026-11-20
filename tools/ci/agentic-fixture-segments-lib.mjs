import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

// Closing ordinals in the required manifest. The completed nominal at 295
// runs in its own job. The public handoff cases at 364–366 need the Windows
// resource observer. These divisions impose no deadline on a case.
export const agenticSegmentEnds = Object.freeze([
  44, 82, 103, 130, 160, 178, 210, 241, 269, 294, 295, 331, 363, 364, 365, 366, 369, 376,
]);
export const agenticWindowsSegments = Object.freeze([14, 15, 16]);
export const agenticSegmentArtifact = "aidn-agentic-segment-";

const receiptVersion = "hosted-agentic-fixture-segment.v2";
const receiptFile = "aidn-agentic-segment.json";

function hash(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function assertKeys(value, keys, error) {
  if (!value || typeof value !== "object" || Array.isArray(value)
      || Object.keys(value).sort().join(",") !== [...keys].sort().join(",")) throw Error(error);
}

export function readAgenticFixtureManifest(repoRoot) {
  const bytes = fs.readFileSync(path.join(repoRoot, "package/catalogs/agentic-process-fixtures.v1.json"));
  const manifest = JSON.parse(bytes);
  assertKeys(manifest, ["contract_version", "cases"], "AGENTIC_FIXTURE_MANIFEST_INVALID");
  if (manifest.contract_version !== "agentic-process-fixtures.v1" || !Array.isArray(manifest.cases)
      || manifest.cases.length !== agenticSegmentEnds.at(-1)
      || agenticSegmentEnds.some((end, index) => end <= (agenticSegmentEnds[index - 1] ?? 0))) {
    throw Error("AGENTIC_SEGMENT_PLAN_MISMATCH");
  }
  return { cases: manifest.cases, sha256: hash(bytes) };
}

export function agenticFixtureSegment(manifest, number) {
  if (!Number.isInteger(number) || number < 1 || number > agenticSegmentEnds.length) {
    throw Error("AGENTIC_SEGMENT_NUMBER_INVALID");
  }
  const previousEnd = agenticSegmentEnds[number - 2] ?? 0;
  const end = agenticSegmentEnds[number - 1];
  const platform = agenticWindowsSegments.includes(number) ? "win32" : "linux";
  return { number, first: previousEnd + 1, last: end, platform, cases: manifest.cases.slice(previousEnd, end) };
}

export function hostedAgenticIdentity(repoRoot, context, env = process.env) {
  const { GITHUB_ACTIONS, GITHUB_REPOSITORY, GITHUB_RUN_ID, GITHUB_RUN_ATTEMPT, AIDN_AGENTIC_SOURCE_SHA } = env;
  if (GITHUB_ACTIONS !== "true" || !["dev", "main", "release"].includes(context)
      || !/^[\w.-]+\/[\w.-]+$/.test(GITHUB_REPOSITORY ?? "")
      || !/^[1-9]\d*$/.test(GITHUB_RUN_ID ?? "") || !/^[1-9]\d*$/.test(GITHUB_RUN_ATTEMPT ?? "")
      || !/^[0-9a-f]{40}$/.test(AIDN_AGENTIC_SOURCE_SHA ?? "")) throw Error("AGENTIC_SEGMENT_HOST_IDENTITY_REQUIRED");
  const git = (...args) => execFileSync("git", ["--no-optional-locks", ...args], {
    cwd: repoRoot, encoding: "utf8", windowsHide: true,
  });
  if (git("rev-parse", "HEAD").trim() !== AIDN_AGENTIC_SOURCE_SHA
      || git("status", "--porcelain=v1", "-z", "--untracked-files=all") !== "") {
    throw Error("AGENTIC_SEGMENT_SOURCE_CHECKOUT_MISMATCH");
  }
  return { repository: GITHUB_REPOSITORY, run_id: GITHUB_RUN_ID, attempt: GITHUB_RUN_ATTEMPT, source: AIDN_AGENTIC_SOURCE_SHA, context };
}

function verifySegmentObservations(segment, events, summary) {
  assertKeys(summary, ["completed", "required", "exit_code", "signal", "ended_at"], "AGENTIC_SEGMENT_SUMMARY_INVALID");
  if (summary.exit_code !== 0 || summary.signal !== null || summary.completed !== segment.cases.length
      || summary.required !== segment.cases.length || typeof summary.ended_at !== "string"
      || !Array.isArray(events) || events.length !== segment.cases.length * 2) {
    throw Error(`AGENTIC_SEGMENT_INCOMPLETE:${segment.number}`);
  }
  for (const [offset, args] of segment.cases.entries()) {
    const [start, end] = events.slice(offset * 2, offset * 2 + 2);
    assertKeys(start, ["index", "args", "started_at"], "AGENTIC_SEGMENT_START_INVALID");
    assertKeys(end, ["index", "args", "ended_at", "result"], "AGENTIC_SEGMENT_END_INVALID");
    assertKeys(end.result, ["exit_code", "signal"], "AGENTIC_SEGMENT_RESULT_INVALID");
    if (start.index !== offset + 1 || end.index !== offset + 1
        || JSON.stringify(start.args) !== JSON.stringify(args) || JSON.stringify(end.args) !== JSON.stringify(args)
        || typeof start.started_at !== "string" || typeof end.ended_at !== "string"
        || end.result.exit_code !== 0 || end.result.signal !== null) {
      throw Error(`AGENTIC_SEGMENT_CASE_MISMATCH:${segment.first + offset}`);
    }
  }
}

export function saveAgenticSegmentReceipt({ dir, manifest, number, identity, evidenceDir, platform = process.platform }) {
  const segment = agenticFixtureSegment(manifest, number);
  if (platform !== segment.platform) throw Error(`AGENTIC_SEGMENT_PLATFORM_MISMATCH:${number}`);
  const ledger = readJson(path.join(evidenceDir, "cases.json"));
  if (ledger.contract_version !== "node-fixture-observation.v1"
      || JSON.stringify(ledger.cases) !== JSON.stringify(segment.cases)) throw Error("AGENTIC_SEGMENT_LEDGER_MISMATCH");
  const events = fs.readFileSync(path.join(evidenceDir, "events.jsonl"), "utf8").trimEnd().split("\n").map(line => JSON.parse(line));
  const summary = readJson(path.join(evidenceDir, "summary.json"));
  verifySegmentObservations(segment, events, summary);
  fs.writeFileSync(path.join(dir, receiptFile), JSON.stringify({
    contract_version: receiptVersion, ...identity, manifest_sha256: manifest.sha256,
    segment: number, first: segment.first, last: segment.last, platform, events, summary,
  }) + "\n", { flag: "wx" });
}

export function verifyHostedAgenticReceipts({ dir, manifest, identity }) {
  const expected = agenticSegmentEnds.map((_, index) => agenticSegmentArtifact + (index + 1));
  const directories = fs.readdirSync(dir, { withFileTypes: true });
  if (directories.some(entry => !entry.isDirectory()) || directories.length !== expected.length
      || expected.some(name => !directories.some(entry => entry.name === name))) throw Error("AGENTIC_SEGMENT_ARTIFACT_SET_MISMATCH");

  for (const [index, name] of expected.entries()) {
    const segment = agenticFixtureSegment(manifest, index + 1);
    const receiptDir = path.join(dir, name);
    const contents = fs.readdirSync(receiptDir, { withFileTypes: true });
    if (contents.length !== 1 || contents[0].name !== receiptFile || !contents[0].isFile()) {
      throw Error(`AGENTIC_SEGMENT_ARTIFACT_CONTENT_MISMATCH:${segment.number}`);
    }
    const receipt = readJson(path.join(receiptDir, receiptFile));
    assertKeys(receipt, ["contract_version", "repository", "run_id", "attempt", "source", "context", "manifest_sha256",
      "segment", "first", "last", "platform", "events", "summary"], "AGENTIC_SEGMENT_RECEIPT_INVALID");
    // GitHub can rerun a failed job and its dependants in the same run.
    // Successful prerequisites retain their earlier attempt receipts.
    if (receipt.contract_version !== receiptVersion || receipt.repository !== identity.repository
        || receipt.run_id !== identity.run_id || receipt.source !== identity.source || receipt.context !== identity.context
        || typeof receipt.attempt !== "string" || !/^[1-9]\d*$/.test(receipt.attempt)
        || BigInt(receipt.attempt) > BigInt(identity.attempt)
        || receipt.manifest_sha256 !== manifest.sha256 || receipt.segment !== segment.number
        || receipt.first !== segment.first || receipt.last !== segment.last || receipt.platform !== segment.platform) {
      throw Error(`AGENTIC_SEGMENT_IDENTITY_MISMATCH:${segment.number}`);
    }
    verifySegmentObservations(segment, receipt.events, receipt.summary);
  }
  return manifest.cases.length;
}
