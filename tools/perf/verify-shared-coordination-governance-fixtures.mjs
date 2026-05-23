#!/usr/bin/env node
import {
  SHARED_COORDINATION_ARTIFACT_CONTRACT_VERSION,
  deriveSharedCoordinationArtifactReadGovernance,
  deriveSharedCoordinationArtifactWriteGovernance,
  deriveSharedCoordinationGovernance,
} from "../../src/application/runtime/shared-coordination-governance-lib.mjs";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function main() {
  try {
    const workspace = {
      project_id: "project-governance",
      workspace_id: "workspace-governance",
      worktree_id: "worktree-governance",
      shared_runtime_mode: "shared-runtime",
    };
    const backend = {
      status: "ready",
    };

    const governance = deriveSharedCoordinationGovernance({
      workspace,
      backend,
      updatedAt: "2030-01-01T00:00:00Z",
      hasSharedRecords: true,
    });
    const read = deriveSharedCoordinationArtifactReadGovernance({
      workspace,
      family: "coordination_record",
      readStatus: "found",
      primaryTimestamp: "2030-01-01T00:01:00Z",
      recordCount: 3,
    });
    const write = deriveSharedCoordinationArtifactWriteGovernance({
      workspace,
      family: "handoff_relay",
      writeStatus: "synced",
      primaryTimestamp: "2030-01-01T00:02:00Z",
      recordCount: 1,
    });

    assert(governance.source_of_truth?.concept === "coordination_records", "workspace governance should expose coordination_records source-of-truth");
    assert(governance.metadata?.concept === "workspace", "workspace governance should expose workspace metadata");
    assert(read.contract_version === SHARED_COORDINATION_ARTIFACT_CONTRACT_VERSION, "read governance should expose stable contract version");
    assert(read.artifact_family === "coordination_record", "read governance should preserve family");
    assert(read.lifecycle_status === "active", "read governance should map found to active lifecycle");
    assert(read.record_count === 3, "read governance should preserve record count");
    assert(write.contract_version === SHARED_COORDINATION_ARTIFACT_CONTRACT_VERSION, "write governance should reuse the same contract version");
    assert(write.artifact_family === "handoff_relay", "write governance should preserve family");
    assert(write.lifecycle_status === "active", "write governance should map synced to active lifecycle");
    assert(write.owner === "project-governance", "write governance should derive owner from workspace");

    console.log("PASS");
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    process.exit(1);
  }
}

main();
