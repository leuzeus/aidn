#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import {
  findSensitivityMatches,
  sensitivityRuleAllowedAtPath,
  verifySensitivityNegativeProbes,
} from "./sensitivity-policy.mjs";

const repoRoot = path.resolve(import.meta.dirname, "..", "..");
const trackedPaths = execFileSync("git", ["ls-files", "-z"], {
  cwd: repoRoot,
  encoding: "utf8",
  stdio: ["ignore", "pipe", "pipe"],
})
  .split("\0")
  .filter(Boolean);

const violations = [];
const missingTrackedPaths = [];
let binarySkipped = 0;

for (const relativePath of trackedPaths) {
  const absolutePath = path.join(repoRoot, relativePath);
  if (!fs.existsSync(absolutePath)) {
    missingTrackedPaths.push(relativePath);
    continue;
  }

  for (const rule of findSensitivityMatches(relativePath).filter(
    (ruleId) => !sensitivityRuleAllowedAtPath(ruleId, relativePath),
  )) {
    violations.push({ path: relativePath, scope: "path", rule });
  }

  const content = fs.readFileSync(absolutePath);
  if (content.includes(0)) {
    binarySkipped += 1;
    continue;
  }
  for (const rule of findSensitivityMatches(content.toString("utf8")).filter(
    (ruleId) => !sensitivityRuleAllowedAtPath(ruleId, relativePath),
  )) {
    violations.push({ path: relativePath, scope: "content", rule });
  }
}

const negativeProbes = verifySensitivityNegativeProbes();
const probesPass = Object.values(negativeProbes).every(Boolean);
const ok = probesPass && violations.length === 0 && missingTrackedPaths.length === 0;
const output = {
  ok,
  status: ok ? "PASS" : "FAIL",
  tracked_files_scanned: trackedPaths.length - missingTrackedPaths.length,
  binary_files_skipped: binarySkipped,
  negative_probes: negativeProbes,
  violations,
  missing_tracked_paths: missingTrackedPaths,
};

console.log(JSON.stringify(output, null, 2));
if (!ok) {
  process.exitCode = 1;
}
