import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { preWriteAdmit } from "../runtime/pre-write-admit.mjs";
import { runStartSessionAdmitUseCase } from "../../src/application/runtime/start-session-admit-use-case.mjs";
import { observeContextCanonicalRevision } from "../../src/application/runtime/context-canonical-revision-service.mjs";
import { contextBenchmarkCases } from "../../src/core/context/context-capability-policy.mjs";

const sha = value => createHash("sha256").update(value).digest("hex");
const git = (root, args) => execFileSync("git", ["-C", root, ...args], { encoding: "utf8", windowsHide: true,
  timeout: 10000, maxBuffer: 32 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] });

// Operator-reviewed, local-only corpus; never an executable plan or authority.
export function readPilotManifest(file) {
  assert.ok(path.isAbsolute(file), "Absolute pilot manifest required");
  const bytes = fs.readFileSync(file);
  assert.ok(bytes.length <= 64 * 1024, "Pilot manifest too large");
  const value = JSON.parse(bytes.toString("utf8").replace(/^\uFEFF/, ""));
  assert.equal(value.reviewed_external_pilot, true);
  assert.ok(path.isAbsolute(value.target_root));
  for (const field of ["objective", "raw", "decision", "next_step", "task"])
    assert.ok(typeof value[field] === "string" && value[field].length > 0 && value[field].length <= 4096, `Invalid pilot ${field}`);
  assert.ok(Array.isArray(value.sources) && value.sources.length > 0 && value.sources.length <= 20);
  assert.equal(new Set(value.sources.map(s => s.ref)).size, value.sources.length);
  for (const source of value.sources) {
    assert.ok(typeof source.ref === "string" && !source.ref.includes("\\") && !source.ref.includes(":")
      && !source.ref.startsWith("/") && source.ref.split("/").every(p => p && p !== "." && p !== ".."), "Unsafe pilot source");
    assert.match(source.sha256, /^[a-f0-9]{64}$/);
  }
  assert.deepEqual(Object.keys(value.answers).sort(), contextBenchmarkCases().sort());
  assert.ok(Object.values(value.answers).every(v => typeof v === "string" && v.length > 0 && v.length <= 512));
  assert.equal(value.answers.governance_needle, "fresh_admission_required");
  assert.equal(value.answers.stale_revision, "refuse");
  assert.equal(value.answers.injection_persistence, "untrusted_data");
  assert.equal(value.answers.long_session_resume, value.next_step);
  assert.equal(value.answers.compaction_drift, value.decision);
  return { ...value, manifest_sha256: sha(bytes) };
}

export function verifyPilotSources(pilot) {
  return pilot.sources.map(source => {
    let cursor = pilot.target_root;
    assert.ok(!fs.lstatSync(cursor).isSymbolicLink(), "Unsafe pilot root");
    for (const part of source.ref.split("/")) {
      cursor = path.join(cursor, part);
      assert.ok(!fs.lstatSync(cursor).isSymbolicLink(), "Unsafe pilot source link");
    }
    const stat = fs.statSync(cursor);
    assert.ok(stat.isFile() && stat.size <= 1024 * 1024, "Pilot source must be bounded regular file");
    assert.equal(sha(fs.readFileSync(cursor)), source.sha256, "Pilot source changed");
    return { ...source, bytes: stat.size };
  });
}

export async function admitPilot(pilot) {
  verifyPilotSources(pilot);
  const admission = await preWriteAdmit({ targetRoot: pilot.target_root, skill: "context-reload" });
  assert.equal(admission.ok, true, "Pilot fresh admission refused");
  assert.equal(admission.activation?.active, true);
  const session = await runStartSessionAdmitUseCase({ targetRoot: pilot.target_root, mode: "THINKING" });
  assert.equal(session.ok, true, "Pilot session admission refused");
  assert.deepEqual(session.blocking_reasons, []);
  assert.equal(session.workflow_state.active_cycle, pilot.answers.cycle_sketchpad, "Pilot task must bind canonical cycle");
  const canonical = await observeContextCanonicalRevision({ targetRoot: pilot.target_root, stateMode: session.state_mode });
  // This manual path deliberately requires an existing canonical PG project.
  // Files fixtures remain the separate synthetic path; no pilot is converted.
  assert.equal(canonical.backend, "postgres", "Existing PostgreSQL pilot required");
  return { admission, session, canonical };
}

export function pilotPreservationSnapshot(pilot, excluded = []) {
  verifyPilotSources(pilot);
  const runtime = [];
  const visit = ref => {
    if (excluded.some(skip => ref === skip || ref.startsWith(skip + "/"))) return;
    const file = path.join(pilot.target_root, ref);
    if (!fs.existsSync(file)) return;
    const stat = fs.lstatSync(file);
    assert.ok(!stat.isSymbolicLink(), "Pilot runtime link unsupported");
    if (stat.isDirectory()) for (const name of fs.readdirSync(file).sort()) visit(ref + "/" + name);
    else { assert.ok(stat.isFile()); runtime.push([ref, sha(fs.readFileSync(file))]); }
  };
  visit(".aidn/runtime");
  return { head: git(pilot.target_root, ["rev-parse", "HEAD"]).trim(),
    branch: git(pilot.target_root, ["branch", "--show-current"]).trim(),
    status_sha256: sha(git(pilot.target_root, ["status", "--porcelain=v1", "--untracked-files=all"])),
    diff_sha256: sha(git(pilot.target_root, ["diff", "HEAD", "--binary", "--no-ext-diff", "--no-textconv"])),
    staged_sha256: sha(git(pilot.target_root, ["diff", "--cached", "--binary", "--no-ext-diff", "--no-textconv"])),
    runtime_sha256: sha(JSON.stringify(runtime)) };
}

export function createPilotDirectory(target, ref) {
  assert.match(ref, /^\.aidn\/runtime\/context\/pilot-[a-f0-9-]+$/);
  let cursor = target;
  for (const part of ref.split("/")) {
    cursor = path.join(cursor, part);
    if (fs.existsSync(cursor)) assert.ok(fs.lstatSync(cursor).isDirectory() && !fs.lstatSync(cursor).isSymbolicLink());
  }
  assert.equal(fs.existsSync(path.join(target, ref)), false, "New owned pilot directory required");
  assert.equal(git(target, ["check-ignore", "--", ref + "/proof.txt"]).trim(), ref + "/proof.txt", "Ignored pilot directory required");
  fs.mkdirSync(path.join(target, ref), { recursive: true });
}
