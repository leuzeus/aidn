#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { defaultCommandRunner, formatGateFamilySummary, runGateFamily } from "../verify/gate-runner-lib.mjs";
import { hostedAgenticIdentity, readAgenticFixtureManifest, verifyHostedAgenticReceipts } from "./agentic-fixture-segments-lib.mjs";

const [requested, context] = process.argv.slice(2);
const runtimeAdmission = requested === "runtime" && ["dev", "release", "main"].includes(context);
const mainPublication = requested === "obligations" && context === "main"
  && process.env.GITHUB_EVENT_NAME === "push" && process.env.GITHUB_REF === "refs/heads/main";
if (process.argv.length !== 4 || !(runtimeAdmission || mainPublication) || !process.env.RUNNER_TEMP) {
  throw Error("HOSTED_GATE_FAMILY_INVOCATION_INVALID");
}
if (process.env.AIDN_AGENTIC_CHAIN_RESULT !== "success") throw Error("HOSTED_AGENTIC_FIXTURE_CHAIN_NOT_SUCCESSFUL");

const repoRoot = path.resolve(import.meta.dirname, "..", "..");
const identity = hostedAgenticIdentity(repoRoot, context);
const manifest = readAgenticFixtureManifest(repoRoot);
const count = verifyHostedAgenticReceipts({
  dir: path.join(process.env.RUNNER_TEMP, "aidn-agentic-segments"), manifest, identity,
});
const catalog = JSON.parse(fs.readFileSync(path.join(repoRoot, "package/catalogs/gates.v1.json"), "utf8"));
const packageJson = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"));
const output = runGateFamily({
  repoRoot, catalog, packageJson, requested, context, admission: runtimeAdmission,
  commandRunner(invocation) {
    if (invocation.gate.id !== "runtime-agentic-process") return defaultCommandRunner(invocation);
    if (invocation.script !== "perf:verify-agentic-process") throw Error("HOSTED_AGENTIC_GATE_DISPATCH_MISMATCH");
    return { status: 0, signal: null, stdout: `Verified ${count} required agentic fixture cases in manifest order for ${identity.source}\n` };
  },
});
const agentic = output.results.filter(gate => gate.id === "runtime-agentic-process");
if (agentic.length !== 1 || agentic[0].obligation !== "required" || agentic[0].status !== "PASS") {
  throw Error("HOSTED_REQUIRED_AGENTIC_GATE_NOT_ACCEPTED");
}
process.stdout.write(formatGateFamilySummary(output));
if (!output.ok) process.exitCode = 1;
