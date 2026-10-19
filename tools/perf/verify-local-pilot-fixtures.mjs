import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readPilotManifest, verifyPilotSources, pilotPreservationSnapshot, createPilotDirectory } from "../verify/context-local-pilot-lib.mjs";
import { contextBenchmarkCases } from "../../src/core/context/context-capability-policy.mjs";
import { initGitRepo } from "./test-git-fixture-lib.mjs";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "aidn-pilot-fixture-"));
const sha = value => createHash("sha256").update(value).digest("hex");
const git = args => execFileSync("git", ["-C", root, ...args], { encoding: "utf8", windowsHide: true });
try {
  fs.writeFileSync(path.join(root, "source.txt"), "original evidence");
  fs.writeFileSync(path.join(root, ".gitignore"), ".aidn/runtime/\n");
  initGitRepo(root, { workingBranch: "test/pilot-preservation" });
  fs.mkdirSync(path.join(root, ".aidn/runtime"), { recursive: true });
  fs.writeFileSync(path.join(root, ".aidn/runtime/preexisting.txt"), "retained");
  const manifest = { reviewed_external_pilot: true, target_root: root, objective: "fixture only", raw: "raw", decision: "retain",
    next_step: "next", task: "extract", sources: [{ ref: "source.txt", sha256: sha("original evidence") }],
    answers: Object.fromEntries(contextBenchmarkCases().map(k => [k, "fixture"])) };
  Object.assign(manifest.answers, { governance_needle: "fresh_admission_required", stale_revision: "refuse", injection_persistence: "untrusted_data",
    long_session_resume: "next", compaction_drift: "retain" });
  const input = path.join(root, ".aidn/runtime/manifest.json");
  const write = value => fs.writeFileSync(input, JSON.stringify(value));
  write(manifest);
  const pilot = readPilotManifest(input); assert.equal(verifyPilotSources(pilot)[0].bytes, 17);
  for (const ref of ["../source.txt", "/source.txt", "C:/source.txt", "a\\source.txt", "a//source.txt"])
    { write({ ...manifest, sources: [{ ...manifest.sources[0], ref }] }); assert.throws(() => readPilotManifest(input), /Unsafe pilot source/); }
  write({ ...manifest, reviewed_external_pilot: false }); assert.throws(() => readPilotManifest(input));
  write({ ...manifest, answers: { ...manifest.answers, stale_revision: "accept" } }); assert.throws(() => readPilotManifest(input));
  write(manifest);
  fs.writeFileSync(path.join(root, "source.txt"), "changed"); assert.throws(() => verifyPilotSources(pilot), /Pilot source changed/);
  fs.writeFileSync(path.join(root, "source.txt"), "original evidence");
  console.log("PASS pilot manifest refuses unsafe references, unreviewed corpus, weakened answers and changed source bytes");

  const owned = ".aidn/runtime/context/pilot-1234";
  const before = pilotPreservationSnapshot(pilot, [owned]);
  createPilotDirectory(root, owned); fs.writeFileSync(path.join(root, owned, "proof.txt"), "owned");
  assert.deepEqual(pilotPreservationSnapshot(pilot, [owned]), before);
  assert.throws(() => createPilotDirectory(root, owned), /New owned/);
  fs.writeFileSync(path.join(root, ".aidn/runtime/preexisting.txt"), "changed");
  assert.notDeepEqual(pilotPreservationSnapshot(pilot, [owned]), before);
  fs.writeFileSync(path.join(root, ".aidn/runtime/preexisting.txt"), "retained");
  fs.writeFileSync(path.join(root, "new.txt"), "new"); git(["add", "new.txt"]);
  assert.notDeepEqual(pilotPreservationSnapshot(pilot, [owned]), before);
  console.log("PASS pilot preservation distinguishes owned writes from preexisting runtime and staged checkout changes");
} finally { fs.rmSync(root, { recursive: true, force: true }); }
console.log("local-pilot: PASS (2 fixture groups; no live pilot or native-model claim)");
