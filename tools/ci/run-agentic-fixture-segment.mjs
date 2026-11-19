#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { runNodeFixtureCases } from "../verify/node-fixture-runner-lib.mjs";
import { verificationEvidenceDirectory } from "../verify/owned-verification-process-lib.mjs";
import {
  agenticFixtureSegment,
  hostedAgenticIdentity,
  readAgenticFixtureManifest,
  saveAgenticSegmentReceipt,
} from "./agentic-fixture-segments-lib.mjs";

if (process.argv.length !== 2 || !process.env.RUNNER_TEMP) throw Error("AGENTIC_SEGMENT_INVOCATION_INVALID");
const repoRoot = path.resolve(import.meta.dirname, "..", "..");
const identity = hostedAgenticIdentity(repoRoot, process.env.AIDN_GATE_CONTEXT);
const manifest = readAgenticFixtureManifest(repoRoot);
const segment = agenticFixtureSegment(manifest, Number(process.env.AIDN_AGENTIC_SEGMENT));
if (segment.platform !== process.platform) throw Error(`AGENTIC_SEGMENT_PLATFORM_MISMATCH:${segment.number}`);
const dir = fs.realpathSync(process.env.RUNNER_TEMP);
const evidenceRoot = verificationEvidenceDirectory(repoRoot, dir);

console.error(`Running required agentic fixture cases ${segment.first}–${segment.last}`);
const result = await runNodeFixtureCases(segment.cases, { cwd: repoRoot, evidenceRoot });
hostedAgenticIdentity(repoRoot, identity.context);
if (result.signal || result.exit_code !== 0) {
  if (result.signal) process.kill(process.pid, result.signal);
  process.exit(result.exit_code || 1);
}

const entries = fs.readdirSync(evidenceRoot, { withFileTypes: true });
if (entries.length !== 1 || !entries[0].isDirectory()) throw Error("AGENTIC_SEGMENT_EVIDENCE_MISMATCH");
saveAgenticSegmentReceipt({ dir, manifest, number: segment.number, identity, evidenceDir: path.join(evidenceRoot, entries[0].name) });
console.log(`Required agentic fixture cases ${segment.first}–${segment.last} passed`);
