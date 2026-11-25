import fs from "node:fs";
import { createHash } from "node:crypto";
import { shadowHash as H } from "../../core/workflow/shadow-json.mjs";
import { assertValidationLaunchRecoveryRequest } from "../../core/workflow/standard-validation-launch-recovery.mjs";
import { createOperationJournalSigner } from "../../core/workflow/process-operation-journal.mjs";
import { readStandardHostInstance } from "../../adapters/runtime/standard-host-authority.mjs";
import { createValidationLaunchRecoveryStore } from "../../adapters/runtime/standard-validation-launch-recovery-store.mjs";
import { readWorkflowProjectAuthority } from "./workflow-instance-composition.mjs";
import { createLocalArtifactResourceFence } from "./local-artifact-resource-fence.mjs";
import { retireInterruptedReopenLock } from "./local-artifact-owner-retirement.mjs";
import { createStandardValidationLaunchRecoveryObserver } from "./standard-validation-launch-recovery.mjs";
import { createValidationRecoveryWriter } from "./standard-validation-recovery-writer.mjs";
import { assertStandardWorkflowImplementation, standardWorkflowOperationBindings } from "./standard-workflow-operations.mjs";

// Separate historical recovery implementation: changing current workflow pins
// never makes the old model executable. This entry creates only a disposition.
const sources = ["./standard-validation-recovery-entry.mjs", "./standard-validation-launch-recovery.mjs", "./standard-validation-recovery-writer.mjs", "./workflow-run-service.mjs",
  "./local-artifact-resource-fence.mjs", "./local-artifact-owner-retirement.mjs",
  "../../adapters/runtime/codex-validation-startup-failure.mjs", "../../adapters/runtime/codex-validation-process-observation.mjs",
  "../../adapters/runtime/codex-sandbox-validation-boundary.mjs", "../../adapters/runtime/standard-validation-launch-recovery-store.mjs",
  "../../core/workflow/standard-validation-launch-recovery.mjs",
  ...["standard-validation-launch-recovery", "standard-validation-launch-recovery-record", "standard-validation-launch-recovery-plan", "standard-validation-launch-recovery-result"]
    .map(name => `../../core/contracts/workflow-definition/${name}.v1.schema.json`)];
const implementation = () => {
  assertStandardWorkflowImplementation();
  return H({ standard: standardWorkflowOperationBindings()[0].implementation_sha256,
    recovery: sources.map(source => [source, createHash("sha256").update(fs.readFileSync(new URL(source, import.meta.url))).digest("hex")]) });
};
const loadedImplementation = implementation();

export async function runStandardValidationRecoveryEntry({ request, execute = false, expectPlan = null, environment = process.env }) {
  assertValidationLaunchRecoveryRequest(request);
  const targetRoot = request.target_root, { stateMode } = readWorkflowProjectAuthority({ targetRoot });
  const options = { targetRoot, stateMode, env: environment };
  const signer = createOperationJournalSigner(readStandardHostInstance({ targetRoot, instanceId: request.instance_id, environment }).readKey);
  const store = createValidationLaunchRecoveryStore(options), fence = createLocalArtifactResourceFence(options);
  const observer = createStandardValidationLaunchRecoveryObserver({ targetRoot, stateMode, environment });
  const writer = createValidationRecoveryWriter({ request, signer, store, fence,
    implementationSha256: loadedImplementation, assertImplementation() {
      if (implementation() !== loadedImplementation) throw Object.assign(Error("STANDARD_VALIDATION_RECOVERY_IMPLEMENTATION_CHANGED"), { code: "STANDARD_VALIDATION_RECOVERY_IMPLEMENTATION_CHANGED" });
    },
    observe: recovery => observer({ instanceId: request.instance_id, operationId: request.operation_id,
      originalConfiguration: request.original_configuration, validationProfile: request.validation_profile }, { recovery }),
    retire: ({ observed, dispositionLease, assertPermit }) => retireInterruptedReopenLock({ targetRoot, operationId: request.operation_id,
      intention: observed.owner.intention, originalLease: observed.owner.lease, fence, dispositionLease,
      expectedLockSha256: observed.owner.lock.sha256, assertPermit, write: true }),
  });
  if (execute) return { result: await writer.execute({ expectPlan }) };
  const { plan, action_sha256 } = await writer.preview();
  return { preview: plan, action_sha256, can_apply: !plan.already_completed };
}
