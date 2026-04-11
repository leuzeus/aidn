#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { removePathWithRetry } from "./test-git-fixture-lib.mjs";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function runAidn(repoRoot, args, env = {}, expectStatus = 0) {
  const cli = path.resolve(repoRoot, "bin", "aidn.mjs");
  const result = spawnSync(process.execPath, [cli, ...args], {
    cwd: repoRoot,
    env: { ...process.env, ...env },
    encoding: "utf8",
    timeout: 180000,
    maxBuffer: 10 * 1024 * 1024,
  });
  if ((result.status ?? 1) !== expectStatus) {
    throw new Error(`Command failed (aidn ${args.join(" ")}): ${String(result.stderr ?? result.stdout ?? "").trim()}`);
  }
  return JSON.parse(String(result.stdout ?? "{}"));
}

function writeMalformedLocator(targetRoot) {
  const locatorFile = path.join(targetRoot, ".aidn", "project", "shared-runtime.locator.json");
  fs.mkdirSync(path.dirname(locatorFile), { recursive: true });
  fs.writeFileSync(locatorFile, "{\n  \"version\": 1,\n  \"enabled\": true,\n", "utf8");
}

function writeInvalidLocator(targetRoot, {
  projectId = "project-locator",
  workspaceId = "workspace-locator",
  backendKind = "sqlite-file",
  root = "docs/audit/shared-runtime",
  connectionRef = "",
} = {}) {
  const locatorFile = path.join(targetRoot, ".aidn", "project", "shared-runtime.locator.json");
  fs.mkdirSync(path.dirname(locatorFile), { recursive: true });
  fs.writeFileSync(locatorFile, `${JSON.stringify({
    version: 2,
    enabled: true,
    projectId,
    workspaceId,
    project: {
      root: ".",
      rootRef: "target-root",
    },
    backend: {
      kind: backendKind,
      root,
      connectionRef,
    },
    projection: {
      localIndexMode: "preserve-current",
    },
  }, null, 2)}\n`, "utf8");
}

function writeValidLocator(targetRoot, {
  projectId,
  workspaceId = "",
  backendKind = "postgres",
  connectionRef = "env:AIDN_PG_URL",
} = {}) {
  const locatorFile = path.join(targetRoot, ".aidn", "project", "shared-runtime.locator.json");
  fs.mkdirSync(path.dirname(locatorFile), { recursive: true });
  fs.writeFileSync(locatorFile, `${JSON.stringify({
    version: 2,
    enabled: true,
    projectId,
    workspaceId: workspaceId || projectId,
    project: {
      root: ".",
      rootRef: "target-root",
    },
    backend: {
      kind: backendKind,
      root: "",
      connectionRef,
    },
    projection: {
      localIndexMode: "preserve-current",
    },
  }, null, 2)}\n`, "utf8");
}

function main() {
  let tempRoot = "";
  try {
    const repoRoot = process.cwd();
    const readyTarget = path.resolve(repoRoot, "tests", "fixtures", "perf-handoff", "ready");
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aidn-shared-runtime-reanchor-"));
    const malformedTarget = path.join(tempRoot, "malformed-locator");
    const invalidPathTarget = path.join(tempRoot, "invalid-path-locator");
    const mismatchTarget = path.join(tempRoot, "workspace-mismatch-locator");
    const monorepoRoot = path.join(tempRoot, "ambiguous-monorepo");
    const appAlphaRoot = path.join(monorepoRoot, "apps", "alpha");
    const appBetaRoot = path.join(monorepoRoot, "apps", "beta");

    fs.cpSync(readyTarget, malformedTarget, { recursive: true });
    fs.cpSync(readyTarget, invalidPathTarget, { recursive: true });
    fs.cpSync(readyTarget, mismatchTarget, { recursive: true });
    fs.mkdirSync(appAlphaRoot, { recursive: true });
    fs.mkdirSync(appBetaRoot, { recursive: true });

    writeMalformedLocator(malformedTarget);
    writeInvalidLocator(invalidPathTarget);
    writeInvalidLocator(mismatchTarget, {
      workspaceId: "workspace-locator",
      root: "../aidn-shared-before-fix",
    });
    writeValidLocator(appAlphaRoot, {
      projectId: "project-alpha",
    });
    writeValidLocator(appBetaRoot, {
      projectId: "project-beta",
    });

    const inspectMalformed = runAidn(repoRoot, [
      "runtime",
      "shared-runtime-reanchor",
      "--target",
      malformedTarget,
      "--json",
    ], {}, 1);
    assert(inspectMalformed.ok === false, "malformed locator inspect should fail");
    assert(inspectMalformed.current_locator.valid === false, "malformed locator inspect should expose invalid locator state");
    assert(inspectMalformed.current_validation.status === "reject", "malformed locator inspect should expose reject validation");

    const repairedMalformed = runAidn(repoRoot, [
      "runtime",
      "shared-runtime-reanchor",
      "--target",
      malformedTarget,
      "--local-only",
      "--write",
      "--json",
    ]);
    assert(repairedMalformed.ok === true, "malformed locator should be repairable via local-only fallback");
    assert(repairedMalformed.applied === true, "local-only fallback should write a repaired locator");
    assert(repairedMalformed.applied_locator.data.enabled === false, "local-only fallback should disable shared runtime");
    assert(repairedMalformed.applied_locator.data.version === 2, "repair should rewrite malformed locator as v2");
    assert(repairedMalformed.applied_workspace.shared_runtime_mode === "local-only", "local-only fallback should restore local-only mode");

    const malformedAdmission = runAidn(repoRoot, [
      "runtime",
      "pre-write-admit",
      "--target",
      malformedTarget,
      "--skill",
      "requirements-delta",
      "--strict",
      "--json",
    ]);
    assert(malformedAdmission.ok === true, "pre-write admission should pass again after local-only re-anchor");
    assert(malformedAdmission.shared_runtime_validation.status === "clear", "local-only re-anchor should restore clear validation");

    const inspectInvalidPath = runAidn(repoRoot, [
      "runtime",
      "shared-runtime-reanchor",
      "--target",
      invalidPathTarget,
      "--json",
    ], {}, 1);
    assert(inspectInvalidPath.ok === false, "invalid path locator inspect should fail");
    assert(inspectInvalidPath.current_validation.issues.some((item) => String(item).includes("overlaps versioned workflow artifacts")), "invalid path locator inspect should explain docs/audit overlap");

    const repairedInvalidPath = runAidn(repoRoot, [
      "runtime",
      "shared-runtime-reanchor",
      "--target",
      invalidPathTarget,
      "--backend",
      "sqlite-file",
      "--shared-root",
      "../aidn-shared-fixed",
      "--project-id",
      "project-reanchored",
      "--workspace-id",
      "workspace-reanchored",
      "--write",
      "--json",
    ]);
    assert(repairedInvalidPath.ok === true, "invalid path locator should be repairable with a trusted shared root");
    assert(repairedInvalidPath.applied_workspace.project_id === "project-reanchored", "trusted repair should expose the requested project id");
    assert(repairedInvalidPath.applied_workspace.shared_runtime_mode === "shared-runtime", "trusted sqlite-file repair should keep shared-runtime mode");
    assert(repairedInvalidPath.applied_validation.status === "clear", "trusted sqlite-file repair should validate cleanly");

    const repairedInvalidPathAdmission = runAidn(repoRoot, [
      "runtime",
      "pre-write-admit",
      "--target",
      invalidPathTarget,
      "--skill",
      "requirements-delta",
      "--strict",
      "--json",
    ]);
    assert(repairedInvalidPathAdmission.ok === true, "pre-write admission should pass after trusted shared-root repair");
    assert(repairedInvalidPathAdmission.workspace.shared_runtime_mode === "shared-runtime", "repaired shared runtime should remain enabled");

    const mismatchBefore = runAidn(repoRoot, [
      "runtime",
      "pre-write-admit",
      "--target",
      mismatchTarget,
      "--skill",
      "requirements-delta",
      "--strict",
      "--json",
    ], {
      AIDN_WORKSPACE_ID: "workspace-override",
    }, 1);
    assert(mismatchBefore.ok === false, "workspace mismatch should block pre-write admission before repair");
    assert(mismatchBefore.shared_runtime_validation.status === "reject", "workspace mismatch should expose reject validation");

    const repairedMismatch = runAidn(repoRoot, [
      "runtime",
      "shared-runtime-reanchor",
      "--target",
      mismatchTarget,
      "--backend",
      "sqlite-file",
      "--shared-root",
      "../aidn-shared-fixed-2",
      "--project-id",
      "project-override",
      "--workspace-id",
      "workspace-override",
      "--write",
      "--json",
    ], {
      AIDN_WORKSPACE_ID: "workspace-override",
    });
    assert(repairedMismatch.ok === true, "workspace mismatch should be repairable by re-anchoring to the override workspace id");
    assert(repairedMismatch.applied_workspace.project_id === "project-override", "workspace mismatch repair should expose the requested project id");
    assert(repairedMismatch.applied_validation.status === "clear", "workspace mismatch repair should validate cleanly");

    const mismatchAfter = runAidn(repoRoot, [
      "runtime",
      "pre-write-admit",
      "--target",
      mismatchTarget,
      "--skill",
      "requirements-delta",
      "--strict",
      "--json",
    ], {
      AIDN_WORKSPACE_ID: "workspace-override",
    });
    assert(mismatchAfter.ok === true, "workspace mismatch should stop blocking pre-write admission after re-anchor");
    assert(mismatchAfter.shared_runtime_validation.status === "clear", "workspace mismatch repair should restore clear validation");

    const ambiguousMonorepoInspect = runAidn(repoRoot, [
      "runtime",
      "shared-runtime-reanchor",
      "--target",
      monorepoRoot,
      "--json",
    ], {}, 1);
    assert(ambiguousMonorepoInspect.ok === false, "ambiguous monorepo root should fail inspection");
    assert(ambiguousMonorepoInspect.current_validation.status === "reject", "ambiguous monorepo root should expose reject validation");
    assert(
      ambiguousMonorepoInspect.current_validation.issues.some((item) => String(item).includes("multiple nested shared runtime locators")),
      "ambiguous monorepo root should explain nested locator ambiguity",
    );

    const nestedProjectInspect = runAidn(repoRoot, [
      "runtime",
      "shared-runtime-reanchor",
      "--target",
      appAlphaRoot,
      "--json",
    ]);
    assert(nestedProjectInspect.ok === true, "nested project root with its own locator should stay valid");
    assert(nestedProjectInspect.current_validation.status === "clear", "nested project root with its own locator should validate cleanly");

    console.log("PASS");
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    process.exit(1);
  } finally {
    if (tempRoot && fs.existsSync(tempRoot)) {
      const cleanup = removePathWithRetry(tempRoot);
      if (!cleanup.ok) {
        throw cleanup.error;
      }
    }
  }
}

main();
