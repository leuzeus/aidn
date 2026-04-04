#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  readSharedRuntimeLocator,
  resolveSharedRuntimeLocatorPath,
  resolveSharedRuntimeLocatorRef,
  writeSharedRuntimeLocator,
} from "../../src/lib/config/shared-runtime-locator-config-lib.mjs";
import { removePathWithRetry } from "./test-git-fixture-lib.mjs";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function main() {
  let tempRoot = "";
  try {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aidn-shared-runtime-locator-"));
    const targetRoot = path.join(tempRoot, "repo");
    fs.mkdirSync(targetRoot, { recursive: true });

    const missing = readSharedRuntimeLocator(targetRoot);
    assert(missing.exists === false, "expected missing locator to report exists=false");
    assert(missing.ref === resolveSharedRuntimeLocatorRef(), "expected logical locator ref for missing locator");
    assert(missing.data.enabled === false, "expected missing locator to default to disabled");
    assert(missing.data.version === 2, "expected missing locator to normalize to v2");
    assert(missing.data.backend.kind === "none", "expected missing locator backend kind to default to none");
    assert(missing.data.projectId === "", "expected missing locator projectId to default to empty");

    const writtenPath = writeSharedRuntimeLocator(targetRoot, {
      enabled: true,
      projectId: "project-locator",
      workspaceId: "workspace-locator",
      project: {
        root: ".",
        rootRef: "target-root",
      },
      backend: {
        kind: "postgres",
        connectionRef: "env:AIDN_PG_URL",
      },
      projection: {
        localIndexMode: "preserve-current",
      },
    });
    assert(writtenPath === resolveSharedRuntimeLocatorPath(targetRoot), "expected locator path to match the canonical project path");

    const roundTrip = readSharedRuntimeLocator(targetRoot);
    assert(roundTrip.exists === true, "expected written locator to exist");
    assert(roundTrip.data.enabled === true, "expected written locator to stay enabled");
    assert(roundTrip.data.projectId === "project-locator", "expected written projectId to round-trip");
    assert(roundTrip.data.workspaceId === "workspace-locator", "expected written workspaceId to round-trip");
    assert(roundTrip.data.project.root === ".", "expected project root to round-trip");
    assert(roundTrip.data.backend.kind === "postgres", "expected backend kind to round-trip");
    assert(roundTrip.data.backend.connectionRef === "env:AIDN_PG_URL", "expected connection ref to round-trip");
    assert(roundTrip.data.projection.localIndexMode === "preserve-current", "expected projection policy to round-trip");

    const invalidPath = resolveSharedRuntimeLocatorPath(targetRoot);
    fs.writeFileSync(invalidPath, `${JSON.stringify({
      version: 1,
      enabled: true,
      workspaceId: "workspace-legacy",
      backend: {
        kind: "sqlite-file",
        root: "../shared-legacy",
      },
      projection: {
        localIndexMode: "preserve-current",
      },
    }, null, 2)}\n`, "utf8");
    const legacyRoundTrip = readSharedRuntimeLocator(targetRoot);
    assert(legacyRoundTrip.data.version === 2, "expected v1 locator to normalize to v2");
    assert(legacyRoundTrip.data.projectId === "workspace-legacy", "expected v1 locator projectId to default from workspaceId");
    assert(legacyRoundTrip.data.compat.legacyWorkspaceIdentity === "workspace-legacy", "expected legacy workspace identity to be preserved");

    fs.writeFileSync(invalidPath, `${JSON.stringify({
      version: 2,
      enabled: true,
      projectId: "project-invalid",
      backend: {
        kind: "mysql",
      },
    }, null, 2)}\n`, "utf8");

    let invalidError = "";
    try {
      readSharedRuntimeLocator(targetRoot);
    } catch (error) {
      invalidError = String(error.message ?? error);
    }
    assert(invalidError.includes("Invalid shared runtime backend kind"), "expected invalid backend kind to be rejected");

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
