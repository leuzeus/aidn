import fs from "node:fs";
import { createHash } from "node:crypto";
import { shadowHash as H } from "../../core/workflow/shadow-json.mjs";
import { assertSessionCloseRecoveryRequest } from "../../core/workflow/standard-session-close-recovery.mjs";
import { createOperationJournalSigner } from "../../core/workflow/process-operation-journal.mjs";
import { readStandardHostInstance } from "../../adapters/runtime/standard-host-authority.mjs";
import { createSessionCloseRecoveryStore } from "../../adapters/runtime/standard-session-close-recovery-store.mjs";
import { readWorkflowProjectAuthority } from "./workflow-instance-composition.mjs";
import { createLocalArtifactResourceFence } from "./local-artifact-resource-fence.mjs";
import { retireInterruptedReopenLock } from "./local-artifact-owner-retirement.mjs";
import { createStandardSessionCloseRecoveryObserver } from "./standard-session-close-recovery.mjs";
import { createSessionRecoveryWriter } from "./standard-session-recovery-writer.mjs";
import { assertStandardWorkflowImplementation, standardWorkflowOperationBindings } from "./standard-workflow-operations.mjs";

// Separate historical recovery implementation: changing current workflow pins
// never makes the old model executable. This entry creates only a disposition.
const sources = ["./standard-session-recovery-entry.mjs", "./standard-session-close-recovery.mjs", "./standard-session-recovery-writer.mjs", "./workflow-run-service.mjs",
  "./local-artifact-resource-fence.mjs", "./local-artifact-owner-retirement.mjs",
  "../../adapters/runtime/local-handoff-process-discovery.mjs", "../../adapters/runtime/local-handoff-process-discovery.ps1",
  "./standard-retained-session-closure-source.mjs", "./session-close-objective-completion.mjs", "../../adapters/runtime/standard-session-close-recovery-store.mjs",
  "../../core/workflow/standard-session-close-recovery.mjs",
  ...["standard-session-close-recovery", "standard-session-close-recovery-record", "standard-session-close-recovery-plan", "standard-session-close-recovery-result"]
    .map(name => `../../core/contracts/workflow-definition/${name}.v1.schema.json`)];
const implementation = () => {
  assertStandardWorkflowImplementation();
  return H({ standard: standardWorkflowOperationBindings()[0].implementation_sha256,
    recovery: sources.map(source => [source, createHash("sha256").update(fs.readFileSync(new URL(source, import.meta.url))).digest("hex")]) });
};
const loadedImplementation = implementation();

export async function runStandardSessionRecoveryEntry({ request, execute = false, expectPlan = null, environment = process.env }) {
  assertSessionCloseRecoveryRequest(request);
  const targetRoot = request.target_root, { stateMode } = readWorkflowProjectAuthority({ targetRoot });
  const options = { targetRoot, stateMode, env: environment };
  const signer = createOperationJournalSigner(readStandardHostInstance({ targetRoot, instanceId: request.instance_id, environment }).readKey);
  const store = createSessionCloseRecoveryStore(options), fence = createLocalArtifactResourceFence(options);
  const observer = createStandardSessionCloseRecoveryObserver({ targetRoot, stateMode, environment });
  const writer = createSessionRecoveryWriter({ request, signer, store, fence,
    implementationSha256: loadedImplementation, assertImplementation() {
      if (implementation() !== loadedImplementation) throw Object.assign(Error("STANDARD_SESSION_RECOVERY_IMPLEMENTATION_CHANGED"), { code: "STANDARD_SESSION_RECOVERY_IMPLEMENTATION_CHANGED" });
    },
    observe: recovery => observer({ instanceId: request.instance_id, operationId: request.operation_id,
      originalConfiguration: request.original_configuration }, { recovery }),
    retire: ({ observed, dispositionLease, assertPermit }) => retireInterruptedReopenLock({ targetRoot, operationId: request.operation_id,
      intention: observed.owner.intention, originalLease: observed.owner.lease, fence, dispositionLease,
      expectedLockSha256: observed.owner.lock.sha256, assertPermit, write: true }),
  });
  if (execute) return { result: await writer.execute({ expectPlan }) };
  const { plan, action_sha256 } = await writer.preview();
  return { preview: plan, action_sha256, can_apply: !plan.already_completed };
}
