#!/usr/bin/env node
import {
  CRITICAL_MARKDOWN_CONTRACT_VERSION,
  deriveGovernedRuntimeArtifactMetadata,
} from "../../src/application/runtime/governed-runtime-artifact-metadata-lib.mjs";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function main() {
  try {
    const workspace = {
      project_id: "project-1",
    };
    const ready = deriveGovernedRuntimeArtifactMetadata({
      workspace,
      runtimeStateMode: "db-only",
      lifecycleStatus: "ready",
    });
    const fallback = deriveGovernedRuntimeArtifactMetadata({
      workspace: {},
      runtimeStateMode: "files",
      lifecycleStatus: "",
      owner: "",
      steward: "",
    });

    assert(ready.contract_version === CRITICAL_MARKDOWN_CONTRACT_VERSION, "helper should expose critical markdown contract version");
    assert(typeof ready.source_of_truth === "string" && ready.source_of_truth.length > 0, "helper should expose source_of_truth");
    assert(ready.source_mode === "explicit", "helper should expose explicit source_mode");
    assert(ready.lifecycle_status === "ready", "helper should preserve lifecycle_status");
    assert(ready.owner === "project-1", "helper should default owner from workspace project_id");
    assert(ready.steward === "aidn-runtime", "helper should default steward");

    assert(fallback.contract_version === CRITICAL_MARKDOWN_CONTRACT_VERSION, "helper fallback should keep contract version");
    assert(fallback.lifecycle_status === "refreshed", "helper fallback should default lifecycle_status");
    assert(fallback.owner === "unknown", "helper fallback should provide owner");
    assert(fallback.steward === "aidn-runtime", "helper fallback should provide steward");

    console.log("PASS");
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    process.exit(1);
  }
}

main();
