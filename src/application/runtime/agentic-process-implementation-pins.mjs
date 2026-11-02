import fs from "node:fs";
import { createHash } from "node:crypto";
import { shadowHash } from "../../core/workflow/shadow-json.mjs";

// Bounded direct implementation closure. Existing runtime dependencies retain
// their separately retained build-lock/installed-version pins. npm distributions
// exclude package-lock.json; direct code pins must use distributed assets only.
const files = [
  "src/application/runtime/agentic-process-implementation-pins.mjs",
  "src/application/runtime/agentic-process-persistence.mjs", "src/application/runtime/runtime-persistence-service.mjs",
  "src/application/runtime/project-artifact-store-service.mjs", "src/application/runtime/project-artifact-store-worker.mjs",
  "src/adapters/runtime/postgres-runtime-artifact-store.mjs", "src/adapters/runtime/postgres-artifact-command-lib.mjs",
  "src/adapters/runtime/agent-execution-fence.mjs", "src/core/workflow/artifact-compare-swap.mjs",
  "src/application/runtime/agentic-process-execution-composition.mjs", "src/application/runtime/agentic-process-execution-host.mjs",
  "src/application/runtime/agentic-process-owned-run.mjs", "src/application/runtime/agentic-process-service.mjs",
  "src/application/runtime/journaled-native-allocation.mjs", "src/adapters/runtime/native-allocation-journal-store.mjs",
  "src/application/runtime/native-allocation-evidence.mjs", "src/application/runtime/native-allocation-worker-authority.mjs", "src/application/runtime/native-allocation-controls.mjs",
  "src/application/runtime/standard-process-authority.mjs", "src/application/runtime/standard-workflow-mixed-composition.mjs",
  "src/application/runtime/standard-drift-report.mjs", "src/application/runtime/standard-drift-git.mjs", "src/core/workflow/native-activity-output.mjs",
  "src/core/contracts/workflow-definition/standard-drift-report.v1.schema.json", "src/core/contracts/workflow-definition/standard-drift-evaluate-input.v1.schema.json",
  "src/core/contracts/workflow-definition/standard-drift-output.v1.schema.json", "scaffold/codex/aidn-drift-check/SKILL.md",
  "src/application/runtime/standard-workflow-operation-host.mjs", "src/application/runtime/standard-workflow-operations.mjs",
  "src/application/runtime/standard-workflow-human-decisions.mjs", "src/adapters/runtime/process-operation-journal-store.mjs", "src/adapters/runtime/process-decision-inbox-store.mjs",
  "src/core/contracts/workflow-definition/standard-operation-preview.v1.schema.json",
  "src/application/runtime/standard-workflow-control-inbox.mjs", "src/adapters/runtime/process-control-inbox-store.mjs", "src/core/workflow/process-control-inbox.mjs",
  "src/core/contracts/workflow-definition/process-control-inbox.v1.schema.json", "src/core/contracts/workflow-definition/process-control-request.v1.schema.json",
  "src/core/contracts/workflow-definition/process-control-source.v1.schema.json",
  "src/core/workflow/native-allocation-journal.mjs", "src/core/contracts/workflow-definition/native-allocation-journal.v1.schema.json",
  "src/core/workflow/process-operation-journal.mjs", "src/core/contracts/workflow-definition/process-operation-journal.v1.schema.json",
  "src/application/runtime/agent-reuse-decision-service.mjs", "src/application/runtime/workflow-instance-composition.mjs",
  "src/adapters/agents/agentic-process-worker.mjs", "src/adapters/agents/agentic-codex-rpc.mjs", "src/adapters/agents/agentic-codex-session.mjs",
  "src/adapters/agents/process-tree/windows-process-tree-controller.mjs", "src/adapters/runtime/agentic-process-store.mjs",
  "src/adapters/runtime/workflow-record-store.mjs", "src/core/agents/agent-reuse-policy.mjs", "src/core/agents/agent-transition-policy.mjs",
  "src/core/agents/agent-role-model.mjs", "src/core/agents/codex-startup-arguments.mjs",
  "src/core/workflow/agentic-process-model.mjs", "src/core/workflow/agentic-process.mjs", "src/core/workflow/shadow-json.mjs",
  "src/core/workflow/agentic-process-control-scenario.mjs",
  "src/core/workflow/process-operation-contracts.mjs",
  "src/core/contracts/workflow-definition/agentic-process-model.v2.schema.json",
  "src/core/contracts/workflow-definition/agentic-process-instance.v2.schema.json",
  "src/core/contracts/workflow-definition/process-operation-binding.v1.schema.json",
  "src/core/contracts/workflow-definition/process-operation-intent.v1.schema.json",
  "src/core/contracts/workflow-definition/process-operation-receipt.v1.schema.json",
  "src/core/contracts/workflow-definition/process-control-event.v1.schema.json",
  "src/core/workflow/agentic-process-start.mjs", "src/core/workflow/workflow-engine-policy.mjs",
  "src/core/workflow/native-host-state.mjs", "src/core/contracts/workflow-definition/native-host-state.v1.schema.json",
  "src/core/contracts/workflow-definition/agentic-process-control-scenario.v1.schema.json",
  "src/adapters/runtime/broker-product-file.mjs",
  "src/core/contracts/workflow-definition/agentic-process-model.v1.schema.json",
  "src/core/contracts/workflow-definition/agentic-process-instance.v1.schema.json", "VERSION", "package.json",
];
export function agenticProcessImplementationPins() {
  const source = files.map(name => {
    const data = fs.readFileSync(new URL(`../../../${name}`, import.meta.url));
    return { path: name, sha256: createHash("sha256").update(data).digest("hex") };
  });
  return { files: source, sha256: shadowHash(source), coverage: "direct distributed process implementation plus package manifest/version; dependency lock and installed versions require separate pins" };
}
