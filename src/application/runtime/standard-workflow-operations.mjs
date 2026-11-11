import { runCloseSessionAdmitUseCase } from "./close-session-admit-use-case.mjs";
import { analyzeStructuredArtifact } from "../../lib/workflow/structured-artifact-parser-lib.mjs";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createStandardWorkflowArtifacts, standardFail as fail } from "./standard-workflow-artifacts.mjs";
import { readWorkflowProjectAuthority, readWorkflowProjectExecutionAuthority } from "./workflow-instance-composition.mjs";
import { runStartSessionAdmitUseCase } from "./start-session-admit-use-case.mjs";
import { runReloadCheckUseCase } from "./reload-check-use-case.mjs";
import { preWriteAdmit } from "../../../tools/runtime/pre-write-admit.mjs";
import { shadowHash, checkShadowJson } from "../../core/workflow/shadow-json.mjs";
import { artifactContentHash } from "../../core/workflow/artifact-compare-swap.mjs";
import { assertProcessOperationBinding } from "../../core/workflow/process-operation-contracts.mjs";
import { assertStandardOperationInput, assertStandardOperationOutput, assertStandardSessionPlan, normalizeStandardOperationInput } from "../../core/workflow/standard-operation-contracts.mjs";
import { parseSessionMetadata } from "../../lib/workflow/session-context-lib.mjs";
import { buildCanonicalFromMarkdown } from "../../lib/workflow/markdown-render-lib.mjs";
import { createStandardSessionModeOperations } from "./standard-session-mode-operations.mjs";
import { createStandardCycleOperations } from "./standard-cycle-operations.mjs";
import { readStandardGitHead } from "./standard-drift-git.mjs";

const correctionFiles = ["standard-reconciliation-inventory.mjs",
  "standard-operation-disposition.mjs", "standard-dispatch-context.mjs",
  "local-artifact-resource-fence.mjs", "local-artifact-owner-retirement.mjs",
  new URL("../../core/contracts/workflow-definition/local-artifact-resource-fence.v1.schema.json", import.meta.url),
  ...["request", "grant"].map(kind => new URL(`../../core/contracts/workflow-definition/process-disposition-authorization-${kind}.v1.schema.json`, import.meta.url)),
  new URL("../../adapters/runtime/local-process-identity.mjs", import.meta.url),
  new URL("../../adapters/runtime/process-dispatch-record-store.mjs", import.meta.url),
  new URL("../../core/workflow/process-dispatch-record.mjs", import.meta.url),
  ...["process-dispatch-record.v1", "process-dispatch-record.v2", "process-operation-disposition.v1", "process-operation-disposition-plan.v1", "process-operation-control-intent.v1"].map(name => new URL(`../../core/contracts/workflow-definition/${name}.schema.json`, import.meta.url)),
  new URL("../../lib/fs/exact-file-identity.mjs", import.meta.url),
  new URL("../../core/workflow/process-reconciliation-inventory.mjs", import.meta.url),
  new URL("../../core/contracts/workflow-definition/process-reconciliation-inventory.v1.schema.json", import.meta.url),
  new URL("../../core/contracts/workflow-definition/process-owner-observation.v1.schema.json", import.meta.url),
  "native-human-verification-port.mjs", new URL("../../adapters/runtime/agent-admission-transport.mjs", import.meta.url), "standard-pr-correction-checkpoint.mjs",
  ...["input", "plan", "output"].map(kind => new URL(`../../core/contracts/workflow-definition/standard-pr-correction-checkpoint-${kind}.v1.schema.json`, import.meta.url)), "standard-pr-correction-authority.mjs", "standard-pr-correction-reopen.mjs",
  new URL("../../core/workflow/standard-pr-correction-reopen.mjs", import.meta.url),
  ...["input", "plan", "output"].map(kind => new URL(`../../core/contracts/workflow-definition/standard-pr-correction-reopen-${kind}.v1.schema.json`, import.meta.url))];
const files = ["standard-session-pr-external-merge.mjs", "standard-session-pr-pretriage-merge.mjs",
  new URL("../../core/workflow/standard-drift-recovery-cycle-selection.mjs", import.meta.url),
  ...["standard-drift-recovery-cycle-selection-input.v1", "standard-drift-recovery-cycle-subject.v1", "standard-drift-recovery-cycle-question.v1",
    "standard-drift-recovery-cycle-selection-output.v1", "human-drift-recovery-cycle-decision.v1", "process-decision-inbox.v17"]
    .map(name => new URL(`../../core/contracts/workflow-definition/${name}.schema.json`, import.meta.url)),
  new URL("../../core/workflow/standard-pr-external-merge.mjs", import.meta.url),
  ...["standard-session-pr-merge-observe-input.v2", "standard-pr-checks-accept-input.v2", "standard-pr-premerge-observe-output.v2", "standard-pr-external-merge-observation-output.v1",
    "standard-pr-external-merge-disposition-input.v1", "standard-pr-external-merge-disposition-question.v1", "standard-pr-external-merge-disposition-input.v2", "standard-pr-external-merge-disposition-question.v2", "standard-pr-review-event-route-output.v1", "process-control-inbox.v3", "process-control-reservation.v1", "standard-pr-external-merge-disposition-output.v1",
    "human-pr-external-merge-disposition.v1", "process-decision-inbox.v16", "standard-pr-merge-basis-output.v1"]
    .map(name => new URL(`../../core/contracts/workflow-definition/${name}.schema.json`, import.meta.url)),
  new URL("standard-session-pr-post-merge-decision.mjs", import.meta.url),
  new URL("../../core/workflow/standard-pr-post-merge-decision.mjs", import.meta.url),
  ...["standard-pr-post-merge-measure-output.v1", "standard-pr-post-merge-decision-input.v1",
    "standard-pr-post-merge-decision-question.v1", "standard-pr-post-merge-decision-output.v1",
    "human-pr-post-merge-decision.v1", "process-decision-inbox.v15",
    "standard-pr-post-merge-question-recovery-plan.v1", "standard-pr-post-merge-question-recovery-output.v1"]
    .map(name => new URL(`../../core/contracts/workflow-definition/${name}.schema.json`, import.meta.url)),
  new URL("../../core/workflow/standard-pr-resolution-exception.mjs", import.meta.url),
  new URL("../../core/workflow/standard-pr-merge-consent.mjs", import.meta.url),
  new URL("standard-session-pr-merge-consent.mjs", import.meta.url),
  new URL("standard-session-pr-merge-execute.mjs", import.meta.url),
  new URL("standard-session-pr-post-merge-fetch.mjs", import.meta.url),
  new URL("standard-session-pr-post-merge-completion.mjs", import.meta.url),
  new URL("standard-post-merge-continuity.mjs", import.meta.url),
  new URL("../../adapters/runtime/standard-host-authority.mjs", import.meta.url),
  new URL("../../adapters/runtime/local-workflow-post-merge-fetch.mjs", import.meta.url),
  new URL("../../adapters/runtime/local-git-adapter.mjs", import.meta.url),
  new URL("./standard-session-pr-post-merge-fast-forward.mjs", import.meta.url),
  new URL("../../adapters/runtime/local-workflow-post-merge-fast-forward.mjs", import.meta.url),
  new URL("../../core/workflow/standard-pr-post-merge-fast-forward.mjs", import.meta.url),
  ...["input", "plan", "output"].map(kind =>
    new URL(`../../core/contracts/workflow-definition/standard-pr-post-merge-fast-forward-${kind}.v1.schema.json`, import.meta.url)),
  new URL("../../core/workflow/standard-pr-post-merge-complete.mjs", import.meta.url),
  ...["input", "plan", "output"].map(kind =>
    new URL(`../../core/contracts/workflow-definition/standard-pr-post-merge-complete-${kind}.v1.schema.json`, import.meta.url)),
  new URL("../../core/workflow/standard-pr-post-merge-fetch.mjs", import.meta.url),
  ...["fetch", "alignment"].flatMap(operation => ["input", "output"].map(kind =>
    new URL(`../../core/contracts/workflow-definition/standard-pr-post-merge-${operation}-${kind}.v1.schema.json`, import.meta.url))),
  new URL("../../core/workflow/standard-pr-merge-execute.mjs", import.meta.url),
  new URL("../../adapters/git-provider/github-pr-merge.mjs", import.meta.url),
  ...["github-pr-merge-observation.v2", "github-pr-merge-plan.v1", "github-pr-merge-plan.v2", "standard-pr-merge-execute-input.v1", "standard-pr-merge-execute-output.v1", "standard-pr-merge-execute-output.v2", "standard-pr-post-merge-wait-input.v1", "standard-pr-post-merge-wait-output.v1"].map(name => new URL("../../core/contracts/workflow-definition/" + name + ".schema.json", import.meta.url)),
  new URL("../../adapters/git-provider/github-required-checks.mjs", import.meta.url),
  ...["standard-github-required-checks.v1", "standard-pr-premerge-observe-output.v1", "standard-pr-checks-accept-input.v1",
    "standard-pr-checks-accept-output.v1", "standard-pr-merge-consent-input.v1", "standard-pr-merge-consent-question.v1",
    "standard-pr-merge-consent-question.v2", "standard-pr-merge-consent-output.v1", "standard-pr-merge-consent-output.v2", "human-pr-merge-consent.v1", "process-decision-inbox.v14", "process-decision-inbox.v18"]
    .map(name => new URL(`../../core/contracts/workflow-definition/${name}.schema.json`, import.meta.url)),
  ...["standard-pr-review-resolution-select-output.v2", "standard-pr-review-resolution-exception-input.v1",
    "standard-pr-review-resolution-exception-question.v1", "standard-pr-review-resolution-exception-output.v1",
    "human-pr-review-resolution-exception.v1", "process-decision-inbox.v13"].map(name => new URL(`../../core/contracts/workflow-definition/${name}.schema.json`, import.meta.url)),
  ...["standard-cycle-close-hook-output.v2", "standard-cycle-close-renewal-plan.v1", "standard-cycle-close-selection-output.v1"].map(name => new URL(`../../core/contracts/workflow-definition/${name}.schema.json`, import.meta.url)),new URL("journaled-native-allocation.mjs", import.meta.url), new URL("standard-workflow-mixed-composition.mjs", import.meta.url), new URL("../../core/contracts/workflow-definition/standard-drift-recovery-plan.v3.schema.json", import.meta.url), new URL("standard-drift-route.mjs", import.meta.url), new URL("../../core/contracts/workflow-definition/standard-drift-route-output.v1.schema.json", import.meta.url),new URL("../../core/contracts/workflow-definition/standard-cycle-plan-selection-output.v1.schema.json", import.meta.url),
  new URL("../../core/contracts/workflow-definition/standard-spike-experiment-admission-output.v2.schema.json", import.meta.url),
  new URL("../../core/contracts/workflow-definition/standard-spike-experiment-admission-output.v3.schema.json", import.meta.url),
  "standard-spike-conversion.mjs", "convert-to-spike-admit-use-case.mjs",
  new URL("../../core/workflow/standard-spike-decision.mjs", import.meta.url),
  ...["standard-spike-selection.v1", "standard-spike-review.v1", "standard-spike-question.v1", "human-spike-decision.v1", "process-decision-inbox.v11",
    "standard-spike-review-input.v1", "standard-spike-initialize-input.v1", "standard-spike-finalize-input.v1", "standard-spike-decision-output.v1", "standard-spike-output.v1",
    "standard-cycle-initialize-plan.v3", "standard-spike-initialize-plan.v1", "standard-spike-finalize-plan.v1",
    "standard-spike-experiment-input.v1", "standard-spike-experiment-admission-output.v1"].map(name => new URL(`../../core/contracts/workflow-definition/${name}.schema.json`, import.meta.url)),new URL("../../core/workflow/standard-mode-work-continuation.mjs", import.meta.url),
  ...["standard-mode-work-review.v1", "standard-mode-work-question.v1", "human-mode-work-decision.v1", "standard-mode-work-decision-input.v1", "standard-mode-work-observation-output.v1", "standard-mode-work-decision-output.v1", "process-decision-inbox.v10"].map(name => new URL(`../../core/contracts/workflow-definition/${name}.schema.json`, import.meta.url)),
  "standard-mode-work-context.mjs", new URL("../../core/workflow/standard-mode-work.mjs", import.meta.url),
  ...["report", "preflight-input", "evaluate-input", "output"].map(kind => new URL(`../../core/contracts/workflow-definition/standard-mode-work-${kind}.v1.schema.json`, import.meta.url)),new URL("../../core/workflow/standard-session-closure-history.mjs", import.meta.url),
  ...["standard-session-closure-record.v2", "standard-session-closure-completion.v2"].map(name => new URL(`../../core/contracts/workflow-definition/${name}.schema.json`, import.meta.url)),
  ...correctionFiles, "standard-pr-triage-source.mjs", "standard-pr-triage-context.mjs", new URL("../../core/workflow/standard-pr-triage.mjs", import.meta.url), ...["report", "select-input", "select-output", "evaluate-input", "output"].map(kind => new URL(`../../core/contracts/workflow-definition/standard-pr-triage-${kind}.v1.schema.json`, import.meta.url)), "standard-session-pr-review-receive.mjs", new URL("../../core/contracts/workflow-definition/standard-session-pr-review-receive-input.v1.schema.json", import.meta.url), new URL("../../core/contracts/workflow-definition/standard-session-pr-review-receive-output.v1.schema.json", import.meta.url), "standard-session-pr-successor-authority.mjs", "standard-session-pr-checkpoint.mjs", "standard-session-pr-update-push.mjs", "standard-session-pr-record.mjs", "standard-session-pr-record-authority.mjs", "standard-session-pr-open.mjs", "standard-session-push.mjs", "standard-session-pr-admission.mjs", "pr-orchestrate-admit-use-case.mjs", "standard-session-branch-integration.mjs", "standard-session-branch-integration-authority.mjs", "standard-session-delivery-checkpoint.mjs", "standard-session-preclose-checkpoint.mjs", "close-session-admit-use-case.mjs", "close-session-context-service.mjs","standard-workflow-operations.mjs", "standard-workflow-artifacts.mjs", "start-session-admit-use-case.mjs", "reload-check-use-case.mjs",
  "standard-cycle-operations.mjs", "standard-cycle-checkpoint.mjs", "standard-cycle-plan-context.mjs", "standard-cycle-plan-record.mjs", "runtime-state-projector-use-case.mjs", "cycle-create-admit-use-case.mjs", "cycle-close-admit-use-case.mjs", "branch-cycle-audit-admit-use-case.mjs",
  "standard-drift-recovery.mjs", "standard-drift-change-request.mjs", "standard-drift-rollback.mjs", "standard-drift-cycle.mjs", "requirements-delta-admit-use-case.mjs", "runtime-head-resolution-service.mjs", "agent-run-configuration-service.mjs",
  "standard-workflow-operation-host.mjs", "standard-workflow-entry.mjs", new URL("../../adapters/runtime/standard-host-authority.mjs", import.meta.url),
  new URL("../../adapters/runtime/standard-github-provider-host.mjs", import.meta.url),
  ...["standard-workflow-execution.v1", "standard-workflow-action.v1", "standard-workflow-entry-result.v1", "standard-workflow-call-action.v1", "standard-workflow-call-result.v1"].map(name => new URL(`../../core/contracts/workflow-definition/${name}.schema.json`, import.meta.url)),
  "standard-workflow-mixed-composition.mjs", "standard-process-authority.mjs", "standard-process-inputs.mjs", "standard-drift-report.mjs", "standard-drift-git.mjs", "standard-drift-finalization.mjs",
  "standard-session-mode-operations.mjs", "skill-hook-use-case.mjs", "gating-evaluate-use-case.mjs", "workflow-hook-use-case.mjs", "checkpoint-use-case.mjs",
  "standard-session-pr-merge-observe.mjs", "standard-session-pr-review-source.mjs", "standard-session-pr-review-effects.mjs", "standard-workflow-human-decisions.mjs", "standard-workflow-control-inbox.mjs", "standard-session-pr-review-control-source.mjs",
  "workflow-transition-lib.mjs", "workflow-transition-constants.mjs", "workflow-continuity-context-service.mjs", "pre-write-admit-use-case.mjs"];
function implementation() {
  const refs = [new URL("../../adapters/runtime/local-git-adapter.mjs", import.meta.url),
    new URL("../install/project-activation-service.mjs", import.meta.url),
    new URL("standard-session-pr-redelivery-authority.mjs", import.meta.url),
    ...["input", "plan", "output"].map(kind => new URL(`../../core/contracts/workflow-definition/standard-session-pr-redelivery-push-${kind}.v1.schema.json`, import.meta.url)), new URL("standard-pr-correction-review.mjs", import.meta.url), new URL("standard-pr-correction-cycle.mjs", import.meta.url), new URL("../../core/contracts/workflow-definition/standard-pr-correction-cycle-input.v1.schema.json", import.meta.url), new URL("../../core/contracts/workflow-definition/standard-pr-correction-cycle-plan.v1.schema.json", import.meta.url), new URL("../../core/contracts/workflow-definition/standard-pr-correction-cycle-output.v1.schema.json", import.meta.url), new URL("../../core/workflow/standard-pr-correction-decision.mjs", import.meta.url),
    ...["standard-pr-correction-review-input.v3", "standard-pr-correction-review-plan.v3", "standard-pr-correction-question.v3", "standard-pr-correction-decision-output.v3", "human-pr-correction-decision.v3", "process-decision-inbox.v9"].map(name => new URL(`../../core/contracts/workflow-definition/${name}.schema.json`, import.meta.url)),
    ...["standard-pr-correction-review-input.v2", "standard-pr-correction-review-plan.v2", "standard-pr-correction-question.v2", "standard-pr-correction-decision-output.v2", "human-pr-correction-decision.v2", "process-decision-inbox.v8", "standard-pr-correction-review-input.v1", "standard-pr-correction-review.v1", "standard-pr-correction-review-plan.v1", "standard-pr-correction-question.v1", "standard-pr-correction-decision-output.v1", "human-pr-correction-decision.v1", "process-decision-inbox.v7"].map(name => new URL(`../../core/contracts/workflow-definition/${name}.schema.json`, import.meta.url)),
    new URL("agentic-process-implementation-pins.mjs", import.meta.url), new URL("standard-session-pr-review-observe.mjs", import.meta.url), new URL("standard-session-pr-review-authority.mjs", import.meta.url),
    new URL("standard-session-pr-review-resolution.mjs", import.meta.url),
    new URL("../../adapters/runtime/standard-github-provider-host.mjs", import.meta.url),
    new URL("../../adapters/git-provider/github-pr-review-resolution.mjs", import.meta.url),
    ...["request", "plan", "result"].map(kind => new URL(`../../core/contracts/workflow-definition/github-pr-review-resolution-${kind}.v1.schema.json`, import.meta.url)),
    ...["resolution-select", "thread-resolve"].flatMap(operation => ["input", "output"].map(kind =>
      new URL(`../../core/contracts/workflow-definition/standard-pr-review-${operation}-${kind}.v1.schema.json`, import.meta.url))),
    new URL("../../core/contracts/workflow-definition/github-pr-observation-output.v3.schema.json", import.meta.url),
    new URL("../../adapters/git-provider/github-observation-transport.mjs", import.meta.url), new URL("../../adapters/git-provider/github-review-evidence.mjs", import.meta.url), new URL("../../adapters/git-provider/github-workflow-adapter.mjs", import.meta.url),
    ...["github-pr-merge-observation.v1", "standard-session-pr-merge-observe-input.v1", "standard-session-pr-merge-observe-output.v1", "standard-session-pr-review-effects-input.v1", "standard-session-pr-review-effects-output.v1", "standard-session-pr-review-effects-output.v2", "standard-pr-merge-qualification-proof.v1", "github-review-evidence.v2", "github-pr-observation-request.v2", "github-pr-observation-output.v2", "standard-session-pr-review-content-output.v1", "github-review-evidence-request.v1", "github-review-evidence.v1", "github-pr-observation-request.v1", "github-pr-observation-output.v1", "standard-session-pr-review-observe-input.v1", "standard-session-pr-review-observe-output.v1"].map(name => new URL(`../../core/contracts/workflow-definition/${name}.schema.json`, import.meta.url)),
    new URL("../../core/workflow/standard-session-pr-record.mjs", import.meta.url),
    ...["input", "plan", "output"].map(kind => new URL(`../../core/contracts/workflow-definition/standard-session-pr-record-${kind}.v1.schema.json`, import.meta.url)),new URL("../../adapters/git-provider/github-pull-request-open.mjs", import.meta.url),
    ...["github-pr-open-request.v1", "github-pr-open-plan.v1", "github-pr-link.v1", ...["input", "plan", "output"].map(kind => `standard-session-pr-open-${kind}.v1`)].map(name => new URL(`../../core/contracts/workflow-definition/${name}.schema.json`, import.meta.url)),
    new URL("../../adapters/runtime/local-workflow-session-push.mjs", import.meta.url),
    ...["input", "plan", "output"].map(kind => new URL(`../../core/contracts/workflow-definition/standard-session-push-${kind}.v1.schema.json`, import.meta.url)),
    new URL("../../core/contracts/workflow-definition/standard-session-pr-admission-input.v1.schema.json", import.meta.url), new URL("../../core/contracts/workflow-definition/standard-session-pr-admission-output.v1.schema.json", import.meta.url),
    new URL("../../core/workflow/standard-session-branch-integration-decision.mjs", import.meta.url), new URL("../../adapters/runtime/local-workflow-branch-integration.mjs", import.meta.url), new URL("../../core/ports/workflow-branch-integration-port.mjs", import.meta.url), new URL("../../core/contracts/workflow-definition/human-session-branch-integration-decision.v1.schema.json", import.meta.url), new URL("../../core/contracts/workflow-definition/process-decision-inbox.v6.schema.json", import.meta.url), new URL("../../core/contracts/workflow-definition/standard-session-branch-integrate-input.v1.schema.json", import.meta.url), new URL("../../core/contracts/workflow-definition/standard-session-branch-integrate-output.v1.schema.json", import.meta.url), new URL("../../core/contracts/workflow-definition/standard-session-branch-integrate-plan.v1.schema.json", import.meta.url), new URL("../../core/contracts/workflow-definition/standard-session-branch-integration-decision-output.v1.schema.json", import.meta.url), new URL("../../core/contracts/workflow-definition/standard-session-branch-integration-question.v1.schema.json", import.meta.url), new URL("../../core/contracts/workflow-definition/standard-session-branch-integration-review-input.v1.schema.json", import.meta.url), new URL("../../core/contracts/workflow-definition/standard-session-branch-integration-review-plan.v1.schema.json", import.meta.url), new URL("../../core/contracts/workflow-definition/standard-session-branch-integration-review.v1.schema.json", import.meta.url),...["input","plan","output"].map(kind=>new URL(`../../core/contracts/workflow-definition/standard-session-delivery-checkpoint-${kind}.v1.schema.json`,import.meta.url)), ...["input", "plan", "output"].map(kind => new URL(`../../core/contracts/workflow-definition/standard-session-preclose-checkpoint-${kind}.v1.schema.json`, import.meta.url)), new URL("standard-session-close-hook.mjs", import.meta.url), ...["input", "plan", "output"].map(kind => new URL(`../../core/contracts/workflow-definition/standard-session-close-hook-${kind}.v1.schema.json`, import.meta.url)), new URL("../../../tools/perf/close-session-hook.mjs", import.meta.url), new URL("workflow-session-service.mjs", import.meta.url), new URL("sync-db-first-selective-use-case.mjs", import.meta.url), new URL("standard-session-close-checkpoint.mjs", import.meta.url), ...["input", "plan", "output"].map(kind => new URL(`../../core/contracts/workflow-definition/standard-session-close-checkpoint-${kind}.v1.schema.json`, import.meta.url)), new URL("standard-session-close-record.mjs", import.meta.url), new URL("../../core/workflow/standard-session-close-render.mjs", import.meta.url), ...["input", "plan", "output"].map(kind => new URL(`../../core/contracts/workflow-definition/standard-session-close-${kind}.v1.schema.json`, import.meta.url)), new URL("standard-session-closure-authority.mjs", import.meta.url), new URL("../../core/workflow/standard-session-closure-decision.mjs", import.meta.url), new URL("standard-session-closure-review.mjs", import.meta.url), new URL("standard-session-closure-context.mjs", import.meta.url), new URL("../../core/contracts/workflow-definition/standard-session-closure-review.v1.schema.json", import.meta.url), new URL("../../core/contracts/workflow-definition/standard-session-closure-review-input.v1.schema.json", import.meta.url), new URL("../../core/contracts/workflow-definition/standard-session-closure-review-plan.v1.schema.json", import.meta.url), new URL("../../core/contracts/workflow-definition/standard-session-closure-question.v1.schema.json", import.meta.url), new URL("../../core/contracts/workflow-definition/human-session-closure-decision.v1.schema.json", import.meta.url), new URL("../../core/contracts/workflow-definition/standard-session-closure-decision-output.v1.schema.json", import.meta.url), new URL("../../core/contracts/workflow-definition/process-decision-inbox.v5.schema.json", import.meta.url), new URL("../../adapters/runtime/artifact-store.mjs", import.meta.url), new URL("../../adapters/runtime/postgres-artifact-command-lib.mjs", import.meta.url), new URL("../../lib/workflow/structured-artifact-parser-lib.mjs", import.meta.url), new URL("../../core/contracts/workflow-definition/standard-session-close-admission-output.v1.schema.json", import.meta.url),new URL("standard-baseline-promotion-checkpoint.mjs", import.meta.url),
    ...["input", "plan", "output"].map(kind => new URL(`../../core/contracts/workflow-definition/standard-baseline-promotion-checkpoint-${kind}.v1.schema.json`, import.meta.url)), new URL("standard-cycle-terminal-checkpoint.mjs", import.meta.url),
    ...["input", "plan", "output"].map(kind => new URL(`../../core/contracts/workflow-definition/standard-cycle-terminal-checkpoint-${kind}.v1.schema.json`, import.meta.url)), new URL("standard-workflow-git-checkpoint.mjs", import.meta.url), new URL("../../adapters/runtime/local-workflow-git-checkpoint.mjs", import.meta.url), new URL("../../core/ports/workflow-git-checkpoint-port.mjs", import.meta.url),
new URL("../../core/contracts/workflow-definition/standard-session-git-checkpoint-input.v1.schema.json", import.meta.url), new URL("../../core/contracts/workflow-definition/standard-session-git-checkpoint-output.v1.schema.json", import.meta.url), new URL("../../core/contracts/workflow-definition/standard-session-git-checkpoint-plan.v1.schema.json", import.meta.url),
new URL("standard-workflow-composition.mjs", import.meta.url), new URL("../../core/contracts/workflow-definition/standard-workflow-catalog.v1.schema.json", import.meta.url), new URL("../../core/contracts/workflow-definition/standard-workflow-catalog.v2.schema.json", import.meta.url), new URL("../../core/contracts/workflow-definition/standard-workflow-catalog.v3.schema.json", import.meta.url),
new URL("standard-baseline-promotion-hook.mjs", import.meta.url), new URL("promote-baseline-checkpoint-use-case.mjs", import.meta.url), new URL("../../../tools/perf/promote-baseline-hook.mjs", import.meta.url), new URL("../../core/contracts/workflow-definition/standard-baseline-promotion-hook-input.v1.schema.json", import.meta.url), new URL("../../core/contracts/workflow-definition/standard-baseline-promotion-hook-plan.v1.schema.json", import.meta.url), new URL("../../core/contracts/workflow-definition/standard-baseline-promotion-hook-output.v1.schema.json", import.meta.url),
new URL("standard-baseline-promotion-authority.mjs", import.meta.url), new URL("standard-baseline-promotion.mjs", import.meta.url), new URL("standard-baseline-promotion-review.mjs", import.meta.url), new URL("../../core/workflow/standard-baseline-promotion.mjs", import.meta.url), new URL("../../core/workflow/standard-baseline-promotion-decision.mjs", import.meta.url), new URL("../../core/contracts/workflow-definition/standard-baseline-promotion-input.v1.schema.json", import.meta.url), new URL("../../core/contracts/workflow-definition/standard-baseline-promotion-plan.v1.schema.json", import.meta.url), new URL("../../core/contracts/workflow-definition/standard-baseline-promotion-request.v1.schema.json", import.meta.url), new URL("../../core/contracts/workflow-definition/standard-baseline-promotion-output.v1.schema.json", import.meta.url), new URL("../../core/contracts/workflow-definition/standard-baseline-promotion-question.v1.schema.json", import.meta.url), new URL("../../core/contracts/workflow-definition/standard-baseline-promotion-review-input.v1.schema.json", import.meta.url), new URL("../../core/contracts/workflow-definition/standard-baseline-promotion-review-plan.v1.schema.json", import.meta.url), new URL("../../core/contracts/workflow-definition/standard-baseline-promotion-decision-output.v1.schema.json", import.meta.url), new URL("../../core/contracts/workflow-definition/human-baseline-promotion-decision.v1.schema.json", import.meta.url), new URL("../../core/contracts/workflow-definition/process-decision-inbox.v4.schema.json", import.meta.url),
new URL("standard-cycle-close-hook.mjs", import.meta.url), new URL("standard-cycle-close-checkpoint.mjs", import.meta.url), new URL("../../core/contracts/workflow-definition/standard-cycle-close-hook-input.v1.schema.json", import.meta.url), new URL("../../core/contracts/workflow-definition/standard-cycle-close-hook-plan.v1.schema.json", import.meta.url), new URL("../../core/contracts/workflow-definition/standard-cycle-close-hook-output.v1.schema.json", import.meta.url),
new URL("standard-cycle-close-context.mjs", import.meta.url), new URL("standard-cycle-close-record.mjs", import.meta.url), new URL("../../core/workflow/standard-cycle-close-render.mjs", import.meta.url), new URL("../../core/contracts/workflow-definition/standard-cycle-close-input.v1.schema.json", import.meta.url), new URL("../../core/contracts/workflow-definition/standard-cycle-close-plan.v1.schema.json", import.meta.url), new URL("../../core/contracts/workflow-definition/standard-cycle-close-output.v1.schema.json", import.meta.url),
new URL("standard-cycle-closure-review.mjs", import.meta.url), new URL("../../core/workflow/standard-cycle-closure-decision.mjs", import.meta.url), new URL("../../core/contracts/workflow-definition/human-cycle-closure-decision.v1.schema.json", import.meta.url), new URL("../../core/contracts/workflow-definition/process-decision-inbox.v3.schema.json", import.meta.url), new URL("../../core/contracts/workflow-definition/standard-cycle-closure-question.v1.schema.json", import.meta.url), new URL("../../core/contracts/workflow-definition/standard-cycle-closure-review.v1.schema.json", import.meta.url), new URL("../../core/contracts/workflow-definition/standard-cycle-closure-review-input.v1.schema.json", import.meta.url), new URL("../../core/contracts/workflow-definition/standard-cycle-closure-review-plan.v1.schema.json", import.meta.url), new URL("../../core/contracts/workflow-definition/standard-cycle-closure-decision-output.v1.schema.json", import.meta.url),
new URL("standard-cycle-audit-context.mjs", import.meta.url), new URL("../../core/workflow/standard-cycle-audit.mjs", import.meta.url), new URL("../../core/contracts/workflow-definition/standard-cycle-audit-report.v1.schema.json", import.meta.url), new URL("../../core/contracts/workflow-definition/standard-cycle-audit-output.v1.schema.json", import.meta.url), new URL("../../core/contracts/workflow-definition/standard-cycle-audit-selection-output.v1.schema.json", import.meta.url), new URL("../../core/contracts/workflow-definition/standard-cycle-audit-select-input.v1.schema.json", import.meta.url), new URL("../../core/contracts/workflow-definition/standard-cycle-audit-evaluate-input.v1.schema.json", import.meta.url),
new URL("standard-cycle-task-advance.mjs", import.meta.url), new URL("../../core/workflow/standard-cycle-task-progress.mjs", import.meta.url), new URL("../../core/contracts/workflow-definition/standard-cycle-task-select-input.v1.schema.json", import.meta.url), new URL("../../core/contracts/workflow-definition/standard-cycle-task-advance-input.v1.schema.json", import.meta.url), new URL("../../core/contracts/workflow-definition/standard-cycle-task-advance-plan.v1.schema.json", import.meta.url), new URL("../../core/contracts/workflow-definition/standard-cycle-task-output.v1.schema.json", import.meta.url), new URL("../../core/contracts/workflow-definition/standard-cycle-task-work-report.v1.schema.json", import.meta.url), new URL("../../core/contracts/workflow-definition/standard-cycle-task-work-output.v1.schema.json", import.meta.url), new URL("../../core/contracts/workflow-definition/standard-cycle-validation-evaluate-input.v2.schema.json", import.meta.url),
new URL("standard-cycle-validation-result.mjs", import.meta.url), new URL("standard-cycle-verification.mjs", import.meta.url), new URL("../../core/workflow/standard-cycle-verification.mjs", import.meta.url), new URL("../../core/contracts/workflow-definition/standard-cycle-validation-evaluate-input.v1.schema.json", import.meta.url), new URL("../../core/contracts/workflow-definition/standard-cycle-verification-enter-input.v1.schema.json", import.meta.url), new URL("../../core/contracts/workflow-definition/standard-cycle-verification-plan.v1.schema.json", import.meta.url), new URL("../../core/contracts/workflow-definition/standard-cycle-verification-output.v1.schema.json", import.meta.url),
new URL("standard-cycle-validation.mjs", import.meta.url), new URL("../../core/workflow/standard-cycle-validation.mjs", import.meta.url), new URL("../../adapters/runtime/local-agent-verification.mjs", import.meta.url), new URL("../../adapters/runtime/codex-sandbox-validation-boundary.mjs", import.meta.url), new URL("../../core/contracts/workflow-definition/standard-cycle-validation-profile.v1.schema.json", import.meta.url), new URL("../../core/contracts/workflow-definition/standard-cycle-validation-plan.v1.schema.json", import.meta.url), new URL("../../core/contracts/workflow-definition/standard-cycle-validation-input.v1.schema.json", import.meta.url), new URL("../../core/contracts/workflow-definition/standard-cycle-validation-output.v1.schema.json", import.meta.url),
new URL("../../core/workflow/standard-cycle-work.mjs", import.meta.url), new URL("../../core/contracts/workflow-definition/process-data-bindings.v2.schema.json", import.meta.url), new URL("../../core/contracts/workflow-definition/process-data-bindings.v3.schema.json", import.meta.url), new URL("../../core/contracts/workflow-definition/process-resolved-input.v2.schema.json", import.meta.url), new URL("../../core/contracts/workflow-definition/standard-cycle-work-report.v1.schema.json", import.meta.url), new URL("../../core/contracts/workflow-definition/standard-cycle-work-evaluate-input.v1.schema.json", import.meta.url), new URL("../../core/contracts/workflow-definition/standard-cycle-work-output.v1.schema.json", import.meta.url),
new URL("standard-cycle-implementation.mjs", import.meta.url), new URL("../../core/workflow/standard-cycle-readiness.mjs", import.meta.url), new URL("../../core/contracts/workflow-definition/standard-cycle-readiness-evaluate-input.v1.schema.json", import.meta.url), new URL("../../core/contracts/workflow-definition/standard-cycle-implementation-enter-input.v1.schema.json", import.meta.url), new URL("../../core/contracts/workflow-definition/standard-cycle-readiness-output.v1.schema.json", import.meta.url), new URL("../../core/contracts/workflow-definition/standard-cycle-implementation-plan.v1.schema.json", import.meta.url),
...files.map(name => new URL(name, import.meta.url)), new URL("../../../tools/runtime/pre-write-admit.mjs", import.meta.url), new URL("../../../tools/runtime/project-runtime-state.mjs", import.meta.url),
    new URL("../../core/workflow/standard-cycle-planning.mjs", import.meta.url),
    ...["standard-cycle-plan-proposal.v1", "standard-cycle-plan-evaluate-input.v1", "standard-cycle-plan-record-input.v1", "standard-cycle-plan-record-plan.v1", "standard-cycle-planning-output.v1"].map(name => new URL(`../../core/contracts/workflow-definition/${name}.schema.json`, import.meta.url)),
    new URL("../../../tools/perf/cycle-create-hook.mjs", import.meta.url),
    new URL("cycle-create-hook-use-case.mjs", import.meta.url),
    ...["standard-cycle-checkpoint-input.v1", "standard-cycle-checkpoint-plan.v1", "standard-cycle-checkpoint-output.v1"].map(name => new URL(`../../core/contracts/workflow-definition/${name}.schema.json`, import.meta.url)),
    ...["standard-drift-cycle-context-input.v1", "standard-drift-cycle-checkpoint-input.v1", "standard-drift-cycle-initialize-input.v1", "standard-drift-cycle-output.v1", "standard-drift-cycle-plan.v1", "standard-cycle-initialize-plan.v2", "standard-cycle-context-plan.v2"].map(name => new URL(`../../core/contracts/workflow-definition/${name}.schema.json`, import.meta.url)),
    ...["standard-drift-rollback-input.v1", "standard-drift-rollback-plan.v1", "standard-drift-rollback-output.v1",
      "standard-drift-change-request-input.v1", "standard-drift-change-request-plan.v1", "standard-drift-change-request-output.v1"].map(name => new URL(`../../core/contracts/workflow-definition/${name}.schema.json`, import.meta.url)),
    new URL("../../lib/workflow/markdown-render-lib.mjs", import.meta.url), new URL("../../core/skills/skill-policy.mjs", import.meta.url),
    new URL("../../lib/workflow/session-context-lib.mjs", import.meta.url), new URL("../../../tools/perf/requirements-delta-hook.mjs", import.meta.url),
    new URL("../../lib/workflow/branch-kind-lib.mjs", import.meta.url),
    new URL("../../core/workflow/standard-operation-contracts.mjs", import.meta.url),
    ...["process-data-contracts.mjs", "process-input-resolution.mjs", "process-frame-input.mjs", "process-call-model.mjs", "process-call-data.mjs", "process-frame-input-selection.mjs", "process-call-selection.mjs", "process-replay-data.mjs", "process-operation-contracts.mjs", "agentic-process-model.mjs", "agentic-process.mjs"].map(name => new URL(`../../core/workflow/${name}`, import.meta.url)),
    ...["process-data-bindings.v1", "process-data-bindings.v4", "process-resolved-input.v1", "process-resolved-input.v3", "process-call-transition.v1", "agentic-process-model.v2", "agentic-process-instance.v2"].map(name => new URL(`../../core/contracts/workflow-definition/${name}.schema.json`, import.meta.url)),
    new URL("../../core/workflow/native-activity-output.mjs", import.meta.url),
    ...["standard-drift-report.v1", "standard-drift-evaluate-input.v1", "standard-drift-output.v1", "standard-drift-followup-input.v1", "standard-drift-finalize-plan.v1", "standard-drift-finalize-plan.v2"].map(name => new URL(`../../core/contracts/workflow-definition/${name}.schema.json`, import.meta.url)),
    new URL("../../core/workflow/standard-workflow-model-catalog.mjs", import.meta.url),
    new URL("../../core/workflow/process-operation-journal.mjs", import.meta.url), new URL("../../adapters/runtime/process-operation-journal-store.mjs", import.meta.url),
    new URL("../../core/workflow/process-decision-inbox.mjs", import.meta.url), new URL("../../adapters/runtime/process-decision-inbox-store.mjs", import.meta.url),
      new URL("../../core/workflow/standard-drift-objective-review.mjs", import.meta.url),
  new URL("standard-drift-objective-disposition.mjs", import.meta.url),
  new URL("standard-drift-objective-completion.mjs", import.meta.url),
  new URL("../../core/gating/gating-signal-policy.mjs", import.meta.url),
  new URL("cycle-close-hook-use-case.mjs", import.meta.url),
  ...["standard-drift-objective-disposition.v1", "standard-drift-finalize-plan.v3", "human-drift-recovery-decision.v2", "standard-drift-recovery-question.v2", "standard-drift-recovery-plan.v2", "process-decision-inbox.v12"].map(name => new URL(`../../core/contracts/workflow-definition/${name}.schema.json`, import.meta.url)),
  ...["human-drift-recovery-decision.v1", "standard-drift-recovery-question.v1", "standard-drift-recovery-plan.v1", "standard-drift-recovery-output.v1", "standard-drift-recovery-record-input.v1", "process-decision-inbox.v2"].map(name => new URL(`../../core/contracts/workflow-definition/${name}.schema.json`, import.meta.url)),
    new URL("../../../tools/perf/start-session-hook.mjs", import.meta.url),
    new URL("../../core/workflow/artifact-compare-swap.mjs", import.meta.url), new URL("../../adapters/runtime/workflow-record-store.mjs", import.meta.url),
    new URL("../../core/workflow/process-control-inbox.mjs", import.meta.url), new URL("../../adapters/runtime/process-control-inbox-store.mjs", import.meta.url),
    ...["standard-empty-input.v1", "standard-session-initialize-input.v1", "standard-session-initialize-plan.v1", "standard-operation-output.v1", "process-local-effect-owner.v1", "standard-operation-preview.v1", "process-operation-journal.v1", "standard-operation-output.v2", "standard-operation-output.v3", "standard-session-reference-input.v1", "standard-mode-apply-input.v1", "standard-session-mode-plan.v1", "human-mode-decision.v1", "process-decision-inbox.v1", "standard-mode-question.v1", "standard-session-start-plan.v1", "standard-workflow-startup-catalog.v1", "standard-workflow-model-source.v1", "standard-cycle-initialize-input.v1", "standard-cycle-reference-input.v1", "standard-cycle-initialize-plan.v1", "standard-cycle-output.v1", "standard-cycle-context-plan.v1", "standard-cycle-create-catalog.v1", "process-control-request.v1", "process-control-source.v1", "process-control-inbox.v1", "process-control-inbox.v2", "process-pr-review-payload.v1", "github-pr-review-event.v1"].map(name => new URL(`../../core/contracts/workflow-definition/${name}.schema.json`, import.meta.url))];
  const packageRoot = fileURLToPath(new URL("../../../", import.meta.url));
  return shadowHash(refs.map(url => ({ path: path.relative(packageRoot, fileURLToPath(url)).replaceAll("\\", "/"), sha256: createHash("sha256").update(fs.readFileSync(url)).digest("hex") })));
}
const loadedImplementation = implementation();
export function assertStandardWorkflowImplementation() {
  if (implementation() !== loadedImplementation) fail("STANDARD_IMPLEMENTATION_CHANGED");
}
const definitions = [
  ["cycle_plan_select", "cycle-create", "read-only", ["SPEC-R03", "SPEC-R04"], "standard-empty-input.v1", "deterministic", "standard-cycle-plan-selection-output.v1"],
  ["spike_conversion_admit", "convert-to-spike", "read-only", ["SPEC-R02", "SPEC-R03", "SPEC-R06"], "standard-spike-review-input.v1", "deterministic", "standard-spike-output.v1"],
  ["spike_conversion_decision", "convert-to-spike", "read-only", ["SPEC-R02", "SPEC-R03", "SPEC-R06"], "standard-spike-review-input.v1", "human", "standard-spike-decision-output.v1"],
  ["spike_cycle_initialize", "convert-to-spike", "mutating", ["SPEC-R02", "SPEC-R03", "SPEC-R06"], "standard-spike-initialize-input.v1", "deterministic", "standard-spike-output.v1"],
  ["spike_conversion_finalize", "convert-to-spike", "executor", ["SPEC-R02", "SPEC-R03", "SPEC-R11"], "standard-spike-finalize-input.v1", "deterministic", "standard-spike-output.v1"],
  ["spike_experiment_admit", "convert-to-spike", "read-only", ["SPEC-R02", "SPEC-R04"], "standard-spike-finalize-input.v1", "deterministic", "standard-spike-experiment-admission-output.v2"],
  ["spike_experiment_execution_admit", "convert-to-spike", "read-only", ["SPEC-R02", "SPEC-R04"], "standard-spike-experiment-input.v1", "deterministic", "standard-spike-experiment-admission-output.v3"],
  ["session_pr_redelivery_push", "pr-orchestrate", "executor", ["SPEC-R07", "SPEC-R08", "SPEC-R11"], "standard-session-pr-redelivery-push-input.v1", "deterministic", "standard-session-pr-redelivery-push-output.v1"],
  ["session_pr_correction_cycle_initialize", "cycle-create", "mutating", ["SPEC-R03", "SPEC-R04", "SPEC-R06", "SPEC-R08"], "standard-pr-correction-cycle-input.v1", "deterministic", "standard-pr-correction-cycle-output.v1"],
  ["session_pr_correction_decision", "pr-orchestrate", "read-only", ["SPEC-R03", "SPEC-R04", "SPEC-R07", "SPEC-R08", "SPEC-R11"], "standard-pr-correction-review-input.v3", "human", "standard-pr-correction-decision-output.v3"],
  ["session_pr_correction_checkpoint", "pr-orchestrate", "mutating", ["SPEC-R03", "SPEC-R04", "SPEC-R07", "SPEC-R08", "SPEC-R11"], "standard-pr-correction-checkpoint-input.v1", "deterministic", "standard-pr-correction-checkpoint-output.v1"],
  ["session_pr_review_observe", "pr-orchestrate", "read-only", ["SPEC-R07", "SPEC-R08", "SPEC-R11"], "standard-session-pr-review-observe-input.v1", "deterministic", "standard-session-pr-review-observe-output.v1"],
  ["session_pr_correction_reopen", "pr-orchestrate", "mutating", ["SPEC-R03", "SPEC-R04", "SPEC-R07", "SPEC-R08", "SPEC-R11"], "standard-pr-correction-reopen-input.v1", "deterministic", "standard-pr-correction-reopen-output.v1"],
  ["session_pr_triage_select", "pr-orchestrate", "read-only", ["SPEC-R08", "SPEC-R11"], "standard-pr-triage-select-input.v1", "deterministic", "standard-pr-triage-select-output.v1"],
  ["session_pr_triage_evaluate", "pr-orchestrate", "read-only", ["SPEC-R08", "SPEC-R11"], "standard-pr-triage-evaluate-input.v1", "deterministic", "standard-pr-triage-output.v1"],
  ["session_pr_review_reply_select", "pr-orchestrate", "read-only", ["SPEC-R08", "SPEC-R11"], "standard-pr-review-reply-select-input.v1", "deterministic", "standard-pr-review-reply-select-output.v1"],
  ["session_pr_review_reply_publish", "pr-orchestrate", "executor", ["SPEC-R08", "SPEC-R11"], "standard-pr-review-reply-publish-input.v1", "deterministic", "standard-pr-review-reply-publish-output.v1"],
  ["session_pr_review_resolution_select", "pr-orchestrate", "read-only", ["SPEC-R08", "SPEC-R11"], "standard-pr-review-resolution-select-input.v1", "deterministic", "standard-pr-review-resolution-select-output.v2"],
  ["session_pr_review_resolution_exception", "pr-orchestrate", "read-only", ["SPEC-R08", "SPEC-R11"], "standard-pr-review-resolution-exception-input.v1", "human", "standard-pr-review-resolution-exception-output.v1"],
  ["session_pr_review_thread_resolve", "pr-orchestrate", "executor", ["SPEC-R08", "SPEC-R11"], "standard-pr-review-thread-resolve-input.v1", "deterministic", "standard-pr-review-thread-resolve-output.v1"],
  ["session_pr_review_effects_verify", "pr-orchestrate", "read-only", ["SPEC-R08", "SPEC-R11"], "standard-session-pr-review-effects-input.v1", "deterministic", "standard-session-pr-review-effects-output.v2"],
  ["session_pr_premerge_observe", "pr-orchestrate", "read-only", ["SPEC-R08", "SPEC-R09"], "standard-session-pr-merge-observe-input.v2", "deterministic", "standard-pr-premerge-observe-output.v1"],
  ["session_pr_checks_accept", "pr-orchestrate", "read-only", ["SPEC-R08", "SPEC-R11"], "standard-pr-checks-accept-input.v2", "deterministic", "standard-pr-checks-accept-output.v1"],
  ["session_pr_review_event_route", "pr-orchestrate", "read-only", ["SPEC-R08", "SPEC-R10"], "standard-empty-input.v1", "deterministic", "standard-pr-review-event-route-output.v1"],
  ["session_pr_merge_basis", "pr-orchestrate", "read-only", ["SPEC-R09"], "standard-pr-external-merge-disposition-input.v2", "deterministic", "standard-pr-merge-basis-output.v1"],
  ["session_pr_external_merge_disposition", "pr-orchestrate", "read-only", ["SPEC-R08", "SPEC-R09", "SPEC-R10"], "standard-pr-external-merge-disposition-input.v2", "human", "standard-pr-external-merge-disposition-output.v1"],
  ["session_pr_merge_consent", "pr-orchestrate", "read-only", ["SPEC-R08", "SPEC-R11"], "standard-pr-merge-consent-input.v1", "human", "standard-pr-merge-consent-output.v2"],
  ["session_pr_merge_execute", "pr-orchestrate", "executor", ["SPEC-R08", "SPEC-R11"], "standard-pr-merge-execute-input.v1", "deterministic", "standard-pr-merge-execute-output.v2"],
  ["session_pr_post_merge_fetch", "pr-orchestrate", "executor", ["SPEC-R09", "SPEC-R11"], "standard-pr-post-merge-fetch-input.v1", "deterministic", "standard-pr-post-merge-fetch-output.v1"],
  ["session_pr_post_merge_alignment", "pr-orchestrate", "read-only", ["SPEC-R09"], "standard-pr-post-merge-alignment-input.v1", "deterministic", "standard-pr-post-merge-alignment-output.v1"],
  ["session_pr_post_merge_measure", "pr-orchestrate", "read-only", ["SPEC-R09"], "standard-pr-post-merge-alignment-input.v1", "deterministic", "standard-pr-post-merge-measure-output.v1"],
  ["session_pr_post_merge_decision", "pr-orchestrate", "read-only", ["SPEC-R09", "SPEC-R11"], "standard-pr-post-merge-decision-input.v1", "human", "standard-pr-post-merge-decision-output.v1"],
  ["session_pr_post_merge_fast_forward", "pr-orchestrate", "executor", ["SPEC-R09", "SPEC-R11"], "standard-pr-post-merge-fast-forward-input.v1", "deterministic", "standard-pr-post-merge-fast-forward-output.v1"],
  ["session_pr_post_merge_complete", "pr-orchestrate", "mutating", ["SPEC-R09"], "standard-pr-post-merge-complete-input.v1", "deterministic", "standard-pr-post-merge-complete-output.v1"],
  ["session_pr_post_merge_wait", "pr-orchestrate", "read-only", ["SPEC-R09"], "standard-pr-post-merge-wait-input.v1", "deterministic", "standard-pr-post-merge-wait-output.v1"],
  ["session_pr_merge_observe", "pr-orchestrate", "read-only", ["SPEC-R08", "SPEC-R09"], "standard-session-pr-merge-observe-input.v1", "deterministic", "standard-session-pr-merge-observe-output.v1"],
  ["session_pr_review_receive", "pr-orchestrate", "read-only", ["SPEC-R07", "SPEC-R08", "SPEC-R11"], "standard-session-pr-review-receive-input.v1", "deterministic", "standard-session-pr-review-receive-output.v1"],
  ["session_pr_review_content_observe", "pr-orchestrate", "read-only", ["SPEC-R07", "SPEC-R08", "SPEC-R11"], "standard-session-pr-review-observe-input.v1", "deterministic", "standard-session-pr-review-content-output.v1"],
  ["session_pr_checkpoint", "pr-orchestrate", "mutating", ["SPEC-R07", "SPEC-R08", "SPEC-R11"], "standard-session-pr-checkpoint-input.v1", "deterministic", "standard-session-pr-checkpoint-output.v1"],
  ["session_pr_update_push", "pr-orchestrate", "executor", ["SPEC-R07", "SPEC-R08", "SPEC-R11"], "standard-session-pr-update-push-input.v1", "deterministic", "standard-session-pr-update-push-output.v1"],
  ["session_pr_record", "pr-orchestrate", "mutating", ["SPEC-R07", "SPEC-R08", "SPEC-R11"], "standard-session-pr-record-input.v1", "deterministic", "standard-session-pr-record-output.v1"],
  ["session_pr_open", "pr-orchestrate", "executor", ["SPEC-R07", "SPEC-R08", "SPEC-R11"], "standard-session-pr-open-input.v1", "deterministic", "standard-session-pr-open-output.v1"],
  ["session_push", "pr-orchestrate", "executor", ["SPEC-R07", "SPEC-R08", "SPEC-R11"], "standard-session-push-input.v1", "deterministic", "standard-session-push-output.v1"],
  ["session_pr_admit", "pr-orchestrate", "read-only", ["SPEC-R01", "SPEC-R07", "SPEC-R08"], "standard-session-pr-admission-input.v1", "deterministic", "standard-session-pr-admission-output.v1"],
  ["session_branch_integration_decision", "pr-orchestrate", "read-only", ["SPEC-R03", "SPEC-R07", "SPEC-R08"], "standard-session-branch-integration-review-input.v1", "human", "standard-session-branch-integration-decision-output.v1"],
  ["session_branch_integrate", "pr-orchestrate", "mutating", ["SPEC-R03", "SPEC-R07", "SPEC-R08"], "standard-session-branch-integrate-input.v1", "deterministic", "standard-session-branch-integrate-output.v1"],
  ["session_delivery_checkpoint", "close-session", "mutating", ["SPEC-R07", "SPEC-R08", "SPEC-R11"], "standard-session-delivery-checkpoint-input.v1", "deterministic", "standard-session-delivery-checkpoint-output.v1"],
  ["session_preclose_checkpoint", "close-session", "mutating", ["SPEC-R05", "SPEC-R07", "SPEC-R11"], "standard-session-preclose-checkpoint-input.v1", "deterministic", "standard-session-preclose-checkpoint-output.v1"],
  ["session_close_finalize", "close-session", "executor", ["SPEC-R01", "SPEC-R05", "SPEC-R07", "SPEC-R11"], "standard-session-close-hook-input.v1", "deterministic", "standard-session-close-hook-output.v1"],
  ["session_close_checkpoint", "close-session", "mutating", ["SPEC-R05", "SPEC-R07", "SPEC-R11"], "standard-session-close-checkpoint-input.v1", "deterministic", "standard-session-close-checkpoint-output.v1"],
  ["session_close_record", "close-session", "mutating", ["SPEC-R05", "SPEC-R07", "SPEC-R11"], "standard-session-close-input.v1", "deterministic", "standard-session-close-output.v1"],
  ["session_closure_decision", "close-session", "read-only", ["SPEC-R05", "SPEC-R07", "SPEC-R11"], "standard-session-closure-review-input.v1", "human", "standard-session-closure-decision-output.v1"],
  ["session_close_admit", "close-session", "read-only", ["SPEC-R07", "SPEC-R11"], "standard-session-reference-input.v1", "deterministic", "standard-session-close-admission-output.v1"],
  ["baseline_promotion_checkpoint", "promote-baseline", "mutating", ["SPEC-R04", "SPEC-R05", "SPEC-R07", "SPEC-R11"], "standard-baseline-promotion-checkpoint-input.v1", "deterministic", "standard-baseline-promotion-checkpoint-output.v1"],
  ["baseline_promotion_finalize", "promote-baseline", "executor", ["SPEC-R04", "SPEC-R05", "SPEC-R07", "SPEC-R11"], "standard-baseline-promotion-hook-input.v1", "deterministic", "standard-baseline-promotion-hook-output.v1"],
  ["baseline_promotion_decision", "promote-baseline", "read-only", ["SPEC-R04", "SPEC-R07"], "standard-baseline-promotion-review-input.v1", "human", "standard-baseline-promotion-decision-output.v1"],
  ["baseline_promotion_record", "promote-baseline", "mutating", ["SPEC-R04", "SPEC-R07"], "standard-baseline-promotion-input.v1", "deterministic", "standard-baseline-promotion-output.v1"],
  ["cycle_close_completed_select", "cycle-close", "read-only", ["SPEC-R04", "SPEC-R05", "SPEC-R07", "SPEC-R11"], "standard-empty-input.v1", "deterministic", "standard-cycle-close-selection-output.v1"],
  ["cycle_close_finalize", "cycle-close", "executor", ["SPEC-R04", "SPEC-R05", "SPEC-R07", "SPEC-R11"], "standard-cycle-close-hook-input.v1", "deterministic", "standard-cycle-close-hook-output.v2"],
  ["cycle_close_record", "cycle-close", "mutating", ["SPEC-R04", "SPEC-R07"], "standard-cycle-close-input.v1", "deterministic", "standard-cycle-close-output.v1"],
  ["cycle_closure_decision", "cycle-close", "read-only", ["SPEC-R04", "SPEC-R07"], "standard-cycle-closure-review-input.v1", "human", "standard-cycle-closure-decision-output.v1"],
  ["cycle_audit_select", "cycle-close", "read-only", ["SPEC-R04", "SPEC-R07"], "standard-cycle-audit-select-input.v1", "deterministic", "standard-cycle-audit-selection-output.v1"],
  ["cycle_audit_evaluate", "cycle-close", "read-only", ["SPEC-R04", "SPEC-R07"], "standard-cycle-audit-evaluate-input.v1", "deterministic", "standard-cycle-audit-output.v1"],
  ["cycle_task_select", "start-session", "read-only", ["SPEC-R03", "SPEC-R04"], "standard-cycle-task-select-input.v1", "deterministic", "standard-cycle-task-output.v1"],
  ["cycle_task_work_evaluate", "start-session", "read-only", ["SPEC-R03", "SPEC-R04"], "standard-cycle-work-evaluate-input.v1", "deterministic", "standard-cycle-task-work-output.v1"],
  ["cycle_task_advance", "start-session", "mutating", ["SPEC-R03", "SPEC-R04"], "standard-cycle-task-advance-input.v1", "deterministic", "standard-cycle-task-output.v1"],

  ["cycle_validation_evaluate", "cycle-close", "read-only", ["SPEC-R04", "SPEC-R07"], "standard-cycle-validation-evaluate-input.v2", "deterministic", "standard-cycle-verification-output.v1"],
  ["cycle_verification_enter", "cycle-close", "mutating", ["SPEC-R04", "SPEC-R07"], "standard-cycle-verification-enter-input.v1", "deterministic", "standard-cycle-verification-output.v1"],
  ["cycle_validation_execute", "cycle-close", "executor", ["SPEC-R04", "SPEC-R07", "SPEC-R11"], "standard-cycle-validation-input.v1", "deterministic", "standard-cycle-validation-output.v1"],
  ["cycle_work_evaluate", "start-session", "read-only", ["SPEC-R02", "SPEC-R03", "SPEC-R04"], "standard-cycle-work-evaluate-input.v1", "deterministic", "standard-cycle-work-output.v1"],
  ["cycle_readiness_evaluate", "start-session", "read-only", ["SPEC-R03", "SPEC-R04"], "standard-cycle-readiness-evaluate-input.v1", "deterministic", "standard-cycle-readiness-output.v1"],
  ["cycle_implementation_enter", "cycle-create", "mutating", ["SPEC-R03", "SPEC-R04"], "standard-cycle-implementation-enter-input.v1", "deterministic", "standard-cycle-readiness-output.v1"],
  ["context_reload", "context-reload", "read-only", ["SPEC-R01", "SPEC-R11"], "standard-empty-input.v1"],
  ["session_admit", "start-session", "read-only", ["SPEC-R01", "SPEC-R04"], "standard-empty-input.v1"],
  ["session_initialize", "start-session", "mutating", ["SPEC-R01", "SPEC-R07"], "standard-session-initialize-input.v1"],
  ["mode_work_preflight", "context-reload", "read-only", ["SPEC-R01", "SPEC-R02"], "standard-mode-work-preflight-input.v1", "deterministic", "standard-mode-work-output.v1"],
  ["mode_work_observe", "context-reload", "read-only", ["SPEC-R02", "SPEC-R11"], "standard-mode-work-evaluate-input.v1", "deterministic", "standard-mode-work-observation-output.v1"],
  ["mode_work_continue_decision", "context-reload", "read-only", ["SPEC-R01", "SPEC-R02", "SPEC-R11"], "standard-mode-work-decision-input.v1", "human", "standard-mode-work-decision-output.v1"],
  ["mode_work_evaluate", "context-reload", "read-only", ["SPEC-R02", "SPEC-R11"], "standard-mode-work-evaluate-input.v1", "deterministic", "standard-mode-work-output.v1"],
  ["mode_decision", "start-session", "read-only", ["SPEC-R01", "SPEC-R02"], "standard-session-reference-input.v1", "human", "standard-operation-output.v3"],
  ["session_mode_apply", "start-session", "mutating", ["SPEC-R01", "SPEC-R02"], "standard-mode-apply-input.v1", "deterministic", "standard-operation-output.v2"],
  ["cycle_terminal_checkpoint", "cycle-close", "mutating", ["SPEC-R04", "SPEC-R05", "SPEC-R07", "SPEC-R11"], "standard-cycle-terminal-checkpoint-input.v1", "deterministic", "standard-cycle-terminal-checkpoint-output.v1"],
  ["session_git_checkpoint", "start-session", "mutating", ["SPEC-R01", "SPEC-R03", "SPEC-R07", "SPEC-R11"], "standard-session-git-checkpoint-input.v1", "deterministic", "standard-session-git-checkpoint-output.v1"],
  ["session_start_finalize", "start-session", "executor", ["SPEC-R01", "SPEC-R04", "SPEC-R11"], "standard-session-reference-input.v1", "deterministic", "standard-operation-output.v2"],
  ["cycle_admit", "cycle-create", "read-only", ["SPEC-R03", "SPEC-R06"], "standard-empty-input.v1", "deterministic", "standard-cycle-output.v1"],
  ["cycle_context_refresh", "context-reload", "projector", ["SPEC-R01", "SPEC-R04", "SPEC-R11"], "standard-session-reference-input.v1", "deterministic", "standard-cycle-output.v1"],
  ["cycle_initialize", "cycle-create", "mutating", ["SPEC-R03", "SPEC-R06"], "standard-cycle-initialize-input.v1", "deterministic", "standard-cycle-output.v1"],
  ["branch_cycle_audit", "branch-cycle-audit", "read-only", ["SPEC-R03", "SPEC-R04"], "standard-cycle-reference-input.v1", "deterministic", "standard-cycle-output.v1"],
  ["cycle_checkpoint_finalize", "cycle-create", "executor", ["SPEC-R03", "SPEC-R04", "SPEC-R05", "SPEC-R11"], "standard-cycle-checkpoint-input.v1", "deterministic", "standard-cycle-checkpoint-output.v1"],
  ["cycle_plan_evaluate", "cycle-create", "read-only", ["SPEC-R03", "SPEC-R04"], "standard-cycle-plan-evaluate-input.v1", "deterministic", "standard-cycle-planning-output.v1"],
  ["cycle_plan_record", "cycle-create", "mutating", ["SPEC-R03", "SPEC-R04"], "standard-cycle-plan-record-input.v1", "deterministic", "standard-cycle-planning-output.v1"],
  ["drift_completion_select", "drift-check", "read-only", ["SPEC-R05"], "standard-empty-input.v1", "deterministic", "standard-drift-route-output.v1"],
  ["drift_completion_decision", "drift-check", "read-only", ["SPEC-R05"], "standard-empty-input.v1", "human", "standard-drift-recovery-output.v1"],
  ["drift_followup_select", "drift-check", "read-only", ["SPEC-R05"], "standard-drift-followup-input.v1", "deterministic", "standard-drift-route-output.v1"],
  ["drift_report_evaluate", "drift-check", "read-only", ["SPEC-R05"], "standard-drift-evaluate-input.v1", "deterministic", "standard-drift-output.v1"],
  ["drift_check_finalize", "drift-check", "executor", ["SPEC-R05"], "standard-drift-followup-input.v1", "deterministic", "standard-drift-output.v1"],
  ["drift_recovery_decision", "drift-check", "read-only", ["SPEC-R05"], "standard-drift-followup-input.v1", "human", "standard-drift-recovery-output.v1"],
  ["drift_recovery_record", "drift-check", "mutating", ["SPEC-R05"], "standard-drift-recovery-record-input.v1", "deterministic", "standard-drift-recovery-output.v1"],
  ["drift_change_request_record", "drift-check", "mutating", ["SPEC-R05"], "standard-drift-change-request-input.v1", "deterministic", "standard-drift-change-request-output.v1"],
  ["drift_recovery_rollback_apply", "drift-check", "mutating", ["SPEC-R05"], "standard-drift-rollback-input.v1", "deterministic", "standard-drift-rollback-output.v1"],
  ["drift_recovery_context_refresh", "context-reload", "projector", ["SPEC-R01", "SPEC-R05"], "standard-drift-cycle-context-input.v1", "deterministic", "standard-drift-cycle-output.v1"],
  ["drift_recovery_checkpoint_observe", "cycle-create", "read-only", ["SPEC-R03", "SPEC-R05", "SPEC-R06"], "standard-drift-cycle-checkpoint-input.v1", "deterministic", "standard-drift-cycle-output.v1"],
  ["drift_recovery_cycle_decision", "cycle-create", "read-only", ["SPEC-R03", "SPEC-R05", "SPEC-R06"], "standard-drift-recovery-cycle-selection-input.v1", "human", "standard-drift-recovery-cycle-selection-output.v1"],
  ["drift_recovery_cycle_initialize", "cycle-create", "mutating", ["SPEC-R03", "SPEC-R05", "SPEC-R06"], "standard-drift-cycle-initialize-input.v1", "deterministic", "standard-drift-cycle-output.v1"],
];
export function standardWorkflowOperationBindings() {
  return definitions.map(([id, skill_id, effect_class, rule_refs, input_contract, executor_kind = "deterministic", output_contract = "standard-operation-output.v1"]) => {
    const binding = { contract_version: "process-operation-binding.v1", id, revision: id === "cycle_validation_evaluate" ? 2 : 1, executor_kind, effect_class, skill_id,
      input_contract, output_contract, rule_refs, allowed_modes: ["cycle_plan_select", "drift_recovery_cycle_decision"].includes(id) ? ["COMMITTING"] : id.startsWith("spike_") ? (id === "spike_conversion_finalize" || id === "spike_experiment_admit" || id === "spike_experiment_execution_admit" || id === "spike_experiment_execution_admit" || id === "spike_experiment_execution_admit" ? ["EXPLORING", "COMMITTING"] : ["EXPLORING"]) : ["mode_work_preflight", "mode_work_evaluate", "mode_work_observe", "mode_work_continue_decision"].includes(id) ? ["THINKING", "EXPLORING"] : ["session_delivery_checkpoint", "session_close_admit", "session_closure_decision", "session_close_record", "session_close_checkpoint", "session_close_finalize"].includes(id) ? ["THINKING", "EXPLORING", "COMMITTING"] : ["session_pr_correction_decision", "session_pr_correction_checkpoint", "session_pr_correction_reopen", "session_pr_triage_select", "session_pr_triage_evaluate", "session_pr_review_reply_select", "session_pr_review_reply_publish", "session_pr_review_resolution_select", "session_pr_review_resolution_exception", "session_pr_review_thread_resolve", "session_pr_review_effects_verify", "session_pr_premerge_observe", "session_pr_checks_accept", "session_pr_review_event_route", "session_pr_external_merge_disposition", "session_pr_merge_basis", "session_pr_merge_consent", "session_pr_merge_execute", "session_pr_post_merge_fetch", "session_pr_post_merge_alignment", "session_pr_post_merge_measure", "session_pr_post_merge_decision", "session_pr_post_merge_fast_forward", "session_pr_post_merge_complete", "session_pr_post_merge_wait", "session_pr_merge_observe", "session_pr_review_receive", "session_pr_review_content_observe", "session_pr_review_observe", "session_preclose_checkpoint", "session_branch_integration_decision", "session_branch_integrate", "session_pr_admit", "session_push", "session_pr_open", "session_pr_record", "session_pr_checkpoint", "session_pr_update_push", "session_pr_redelivery_push"].includes(id) ? ["COMMITTING"] : id === "session_initialize" ? ["UNKNOWN"] : ["drift_change_request_record", "drift_recovery_rollback_apply"].includes(id) || ["standard-baseline-promotion-checkpoint-output.v1", "standard-baseline-promotion-hook-output.v1", "standard-baseline-promotion-decision-output.v1", "standard-baseline-promotion-output.v1", "standard-cycle-readiness-output.v1", "standard-cycle-work-output.v1", "standard-cycle-validation-output.v1", "standard-cycle-verification-output.v1", "standard-cycle-task-output.v1", "standard-cycle-task-work-output.v1", "standard-cycle-audit-selection-output.v1", "standard-cycle-audit-output.v1", "standard-cycle-closure-decision-output.v1", "standard-cycle-close-output.v1", "standard-cycle-close-hook-output.v1", "standard-cycle-close-hook-output.v2", "standard-cycle-close-selection-output.v1"].includes(output_contract) ? ["COMMITTING"] : ["standard-cycle-output.v1", "standard-drift-cycle-output.v1", "standard-cycle-checkpoint-output.v1", "standard-cycle-planning-output.v1"].includes(output_contract) ? ["EXPLORING", "COMMITTING"] : ["UNKNOWN", "THINKING", "EXPLORING", "COMMITTING"], implementation_sha256: loadedImplementation };
    assertProcessOperationBinding(binding); return binding;
  });
}
const scalar = value => typeof value === "string" && value.length > 0 && value.length <= 512 && !/[\r\n\0]/.test(value);
function sessionInput(input) {
  assertStandardOperationInput("session_initialize", input);
  if (checkShadowJson(input) || !input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).some(key => !["session_id", "session_branch", "objective", "mode"].includes(key))
    || !/^S[0-9]{3,6}$/.test(input.session_id) || !scalar(input.session_branch) || !new RegExp(`^${input.session_id}-[a-z0-9][a-z0-9-]{0,47}$`).test(input.session_branch)
    || !scalar(input.objective) || !["UNKNOWN", "THINKING", "EXPLORING", "COMMITTING"].includes(input.mode ?? "UNKNOWN")) fail("STANDARD_SESSION_INPUT_INVALID");
  return normalizeStandardOperationInput("session_initialize", input);
}
function replaceField(text, key, value) {
  const pattern = new RegExp("^([ \t]*-?[ \t]*)" + key + ":[^\r\n]*(?:\r?\n[ \t]+-[^\r\n]*)*", "gm");
  const matches = [...text.matchAll(pattern)];
  if (matches.length !== 1) throw Object.assign(new Error(matches.length ? "STANDARD_TEMPLATE_FIELD_AMBIGUOUS" : "STANDARD_TEMPLATE_FIELD_MISSING"),
    { code: matches.length ? "STANDARD_TEMPLATE_FIELD_AMBIGUOUS" : "STANDARD_TEMPLATE_FIELD_MISSING", field: key });
  return text.replace(pattern, (_match, prefix) => `${prefix}${key}: ${value}`);
}
function renderSession(template, input, at, base, predecessor) {
  let text = template.replaceAll("SXXX", input.session_id).replace(/^# Session[^\r\n]*/, `# Session ${input.session_id} â€” ${at.slice(0, 10)}`);
  text = text.replace(/\[ \] (THINKING|EXPLORING|COMMITTING)/g, (_match, mode) => `[${input.mode === mode ? "x" : " "}] ${mode}`);
  const fields = { session_branch: input.session_branch, parent_session: predecessor?.session_id ?? "none", parent_branch: predecessor?.session_branch ?? base,
    continuity_basis: `ff-from ${base}`, continuity_check: "pass", branch_kind: "session", cycle_branch: "none", intermediate_branch: "none",
    integration_target_cycles: "\n  - none", integration_target_cycle: "none", primary_focus_cycle: "none", attached_cycles: "\n  - none", reported_from_previous_session: "none",
    carry_over_pending: "no", pr_status: "none", pr_url: "none", pr_number: "none", pr_base_branch: base, pr_head_branch: input.session_branch,
    pr_review_status: "unknown", post_merge_sync_status: "not_needed", post_merge_sync_basis: "none",
    // The historical parser expands double whitespace before field-looking
    // text into a new line. Preserve the objective as one data scalar.
    session_objective: input.objective.replace(/\s+/gu, " ").trim() };
  for (const [key, value] of Object.entries(fields)) text = replaceField(text, key, value);
  const metadata = { contract_version: "critical-markdown-v1", session_id: input.session_id, state: "OPEN", mode: input.mode,
    started_at: at, updated_at: at, owner: "aidn-start-session", source_of_truth: "session_state", lifecycle_status: "active" };
  const absent = [];
  for (const [key, value] of Object.entries(metadata)) {
    const declared = new RegExp("^[ \t]*-?[ \t]*" + key + ":", "m").test(text);
    if (declared) text = replaceField(text, key, value).replace(new RegExp("^[ \t]*-[ \t]*" + key + ":", "gm"), key + ":");
    else absent.push(`${key}: ${value}`);
  }
  return text.replace(/^(# [^\n]+\r?\n)/, (_match, title) => `${title}\n${absent.join("\n")}\n`);
}
function output(operation, status, effect, observations, facts = {}, evidence = []) {
  return assertStandardOperationOutput({ contract_version: "standard-operation-output.v1", operation_ref: operation, outcome: status, effect_status: effect, facts, observations, evidence_refs: evidence });
}

// Real local application ports. No model or dynamic shell/SQL/module is selected
// by a request. Skill initialization is a component, not full skill completion.
export function createStandardWorkflowOperations({ targetRoot, now = Date.now }) {
  const artifacts = createStandardWorkflowArtifacts({ targetRoot }), root = artifacts.root;
  const git = args => execFileSync("git", ["-C", root, "-c", `core.hooksPath=${process.platform === "win32" ? "NUL" : "/dev/null"}`,
    "-c", "core.fsmonitor=false", "-c", "submodule.recurse=false", ...args],
  { encoding: "utf8", shell: false, windowsHide: true, timeout: 10000, maxBuffer: 1048576, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" } }).trim();
  function observeScope(execution = false) {
    if (implementation() !== loadedImplementation) fail("STANDARD_IMPLEMENTATION_CHANGED");
    if (Object.keys(process.env).some(key => /^GIT_(DIR|WORK_TREE|COMMON_DIR|INDEX_FILE|OBJECT_DIRECTORY|ALTERNATE_OBJECT_DIRECTORIES|NAMESPACE|CONFIG(?:_.*)?)$/i.test(key))) fail("STANDARD_GIT_ENV_SCOPE_CONFLICT");
    const authority = execution ? readWorkflowProjectExecutionAuthority({ targetRoot: root }) : null;
    const project = authority?.project ?? readWorkflowProjectAuthority({ targetRoot: root }), persistence = artifacts.describe();
    // Do this before existing helpers: a missing canonical state must never
    // trigger their historical visible-file compatibility fallback.
    artifacts.read("CURRENT-STATE.md", { required: true });
    return { context: { project, persistence, ...readStandardGitHead(git) }, authority };
  }
  const scope = () => observeScope().context;
  async function admission(mode = "UNKNOWN") {
    const prewrite = await preWriteAdmit({ targetRoot: root, skill: "start-session" });
    const lifecycle = await runStartSessionAdmitUseCase({ targetRoot: root, mode });
    return { prewrite, lifecycle, allowed: prewrite.ok === true && ["admitted", "admitted_with_warnings"].includes(prewrite.admission_status) && lifecycle.result === "ok" };
  }
  async function build(input, preparedAt, acquired = false) {
    input = sessionInput(input); const context = scope();
    if (!acquired && artifacts.ownerPending()) return { can_apply: false, reason_code: "STANDARD_EFFECT_OWNER_RECONCILIATION_REQUIRED" };
    const admitted = await admission();
    if (!admitted.allowed || admitted.lifecycle.action !== "create_session_allowed") return { can_apply: false, admission: admitted };
    const before = artifacts.read("CURRENT-STATE.md", { required: true }), template = artifacts.read("sessions/TEMPLATE_SESSION_SXXX.md", { required: true });
    const sessionPath = `sessions/${input.session_id}.md`;
    if (artifacts.read(sessionPath).sha256 !== null) fail("STANDARD_SESSION_ALREADY_EXISTS");
    const latest = artifacts.sessions().at(-1);
    if (latest && BigInt(input.session_id.slice(1)) <= BigInt(latest.session_id.slice(1))) fail("STANDARD_SESSION_SEQUENCE_INVALID");
    const predecessor = latest ? { path: latest.path, session_id: latest.session_id, sha256: latest.sha256, session_branch: parseSessionMetadata(latest.content).session_branch } : null;
    try { git(["show-ref", "--verify", "--quiet", `refs/heads/${input.session_branch}`]); fail("STANDARD_SESSION_BRANCH_ALREADY_EXISTS"); }
    catch (cause) { if (cause.code === "STANDARD_SESSION_BRANCH_ALREADY_EXISTS") throw cause; if (cause.status !== 1) throw cause; }
    const at = new Date(preparedAt).toISOString();
    const session = renderSession(template.content, input, at, context.branch, predecessor);
    const canonical = buildCanonicalFromMarkdown(session, { relativePath: sessionPath, classification: { kind: "session", family: "normative", subtype: "session" } });
    if (canonical.contract_status !== "conformant") fail("STANDARD_SESSION_TEMPLATE_NOT_CONFORMANT");
    let current = before.content;
    for (const [key, value] of Object.entries({ active_session: input.session_id, session_branch: input.session_branch, branch_kind: "session", mode: input.mode,
      updated_at: at, session_pr_status: "none", session_pr_review_status: "unknown", post_merge_sync_status: "not_needed" })) current = replaceField(current, key, value);
    const changes = [{ path: sessionPath, before_sha256: null, after: session }, { path: before.path, before_sha256: before.sha256, after: current }]
      .map(row => ({ ...row, after_sha256: artifactContentHash(row.after) }));
    const plan = { contract_version: "standard-session-initialize-plan.v1", operation_ref: "session_initialize", input, prepared_at_ms: preparedAt,
      scope: context, template_sha256: template.sha256, predecessor, changes };
    assertStandardSessionPlan(plan);
    return { can_apply: true, plan, plan_sha256: shadowHash(plan) };
  }
  async function postconditions(plan) {
    const expected = plan.changes.every(change => artifacts.read(change.path).sha256 === change.after_sha256);
    const branch = git(["branch", "--show-current"]), head = git(["rev-parse", "HEAD"]);
    const active = expected ? await runStartSessionAdmitUseCase({ targetRoot: root, mode: plan.input.mode }) : null;
    return { satisfied: expected && branch === plan.input.session_branch && head === plan.scope.head && active?.result === "ok"
      && active.action === "resume_current_session" && active.active_session === plan.input.session_id,
      branch, head, admission: active };
  }
  return Object.freeze({
    ...createStandardSessionModeOperations({ artifacts, scope, admission, replaceField, now }),
    ...createStandardCycleOperations({ artifacts, scope, git, replaceField, now }),
    bindings: standardWorkflowOperationBindings,
    observeScope: scope,
    // One synchronous observation, never an input-supplied or retained authority.
    observeExecutionScope: () => observeScope(true),
    async reload(input = {}) {
      assertStandardOperationInput("context_reload", input);
      const current = scope(), documents = ["baseline/current.md", "snapshots/context-snapshot.md", "CURRENT-STATE.md", "SPEC.md", "WORKFLOW.md", "WORKFLOW-KERNEL.md"]
        .map(name => {
          const { path, sha256 } = artifacts.read(name, { required: true });
          return { path, sha256 };
        });
      const result = await runReloadCheckUseCase({ targetRoot: root, args: { cache: ".aidn/runtime/cache/reload-state.json", stateMode: current.persistence.state_mode,
        stateModeExplicit: true, indexFile: ".aidn/runtime/index/workflow-index.sqlite", indexBackend: "auto", writeCache: false } });
      const loaded = result.decision !== "stop" && !result.missing_required_artifacts?.length;
      return output("context_reload", loaded ? "completed" : "blocked", "no_effect", { reload: result, documents }, loaded ? { context_loaded: true } : {},
        documents.map(row => ({ ref: "docs/audit/" + row.path, sha256: row.sha256 })));
    },
    async admitSession(input = {}) {
      assertStandardOperationInput("session_admit", input);
      scope();
      if (artifacts.ownerPending()) return output("session_admit", "blocked", "no_effect", { reason_code: "STANDARD_EFFECT_OWNER_RECONCILIATION_REQUIRED" });
      const observed = await admission();
      return output("session_admit", observed.allowed ? "completed" : "blocked", "no_effect", observed, observed.allowed ? {
        session_creation_allowed: observed.lifecycle.action === "create_session_allowed", session_resume_allowed: ["resume_current_session", "resume_current_cycle"].includes(observed.lifecycle.action),
      } : {});
    },
    async admitSessionClose(input) {
      assertStandardOperationInput("session_close_admit", input);
      const emit = (allowed, observations, evidence_refs = []) => assertStandardOperationOutput({
        contract_version: "standard-session-close-admission-output.v1", operation_ref: "session_close_admit", outcome: allowed ? "completed" : "blocked",
        effect_status: "no_effect", facts: allowed ? { session_close_admission_satisfied: true } : {}, observations, evidence_refs });
      if (artifacts.ownerPending()) return emit(false, { reason_code: "STANDARD_EFFECT_OWNER_RECONCILIATION_REQUIRED" });
      const prewrite = await preWriteAdmit({ targetRoot: root, skill: "close-session" });
      if (!prewrite.ok || !["admitted", "admitted_with_warnings"].includes(prewrite.admission_status))
        return emit(false, { reason_code: "STANDARD_SESSION_CLOSE_ADMISSION_BLOCKED", prewrite });
      const before = scope(), current = artifacts.read("CURRENT-STATE.md", { required: true });
      const fields = analyzeStructuredArtifact(current.content).key_values, sessions = artifacts.sessions().filter(row => row.session_id === input.session_id);
      if (fields.active_session !== input.session_id || sessions.length !== 1 || !["THINKING", "EXPLORING", "COMMITTING"].includes(fields.mode))
        return emit(false, { reason_code: "STANDARD_SESSION_CLOSE_OWNER_REQUIRED" });
      const session = sessions[0], admission = await runCloseSessionAdmitUseCase({ targetRoot: root, mode: fields.mode });
      if (shadowHash(scope()) !== shadowHash(before) || artifacts.read("CURRENT-STATE.md").sha256 !== current.sha256
        || artifacts.read(session.path).sha256 !== session.sha256 || artifacts.ownerPending())
        return emit(false, { reason_code: "STANDARD_SESSION_CLOSE_CONTEXT_CHANGED" });
      const allowed = admission.ok === true && admission.action === "close_session_allowed" && admission.active_session === input.session_id
        && admission.mapped_session?.session_id === input.session_id && admission.branch === before.branch;
      return emit(allowed, { prewrite, admission, scope_sha256: shadowHash(before), session_id: input.session_id,
        closure_effects: "not_executed", skill_completion: "pending" },
        [{ ref: "docs/audit/CURRENT-STATE.md", sha256: current.sha256 }, { ref: "docs/audit/" + session.path, sha256: session.sha256 }]);
    },
    prepareSession: input => build(input, now()),
    async initializeSession(prepared, { write = false, expectPlan = null } = {}) {
      if (write !== true || !prepared?.can_apply || prepared.plan_sha256 !== expectPlan || shadowHash(prepared.plan) !== expectPlan) fail("STANDARD_EXPLICIT_EFFECT_REQUIRED");
      assertStandardSessionPlan(prepared.plan);
      return artifacts.withLocalEffectOwner(expectPlan, async () => {
        try {
          const observed = await build(prepared.plan.input, prepared.plan.prepared_at_ms, true);
          if (!observed.can_apply || observed.plan_sha256 !== expectPlan || shadowHash(scope()) !== shadowHash(prepared.plan.scope)) fail("STANDARD_PREVIEW_CHANGED");
        } catch (cause) { cause.effect_status = "no_effect"; throw cause; }
        const committed = []; let attempted = false;
        try {
          attempted = true; git(["switch", "-c", prepared.plan.input.session_branch]);
          for (const change of prepared.plan.changes) { artifacts.compareAndSwap(change); committed.push(change.path); }
          const after = await postconditions(prepared.plan);
          if (!after.satisfied) fail("STANDARD_SESSION_POSTCONDITION_FAILED");
          const projection = artifacts.project(committed);
          return output("session_initialize", "completed", "confirmed", { postconditions: after, projection, committed },
            { session_initialized: true, session_mode_pending: prepared.plan.input.mode === "UNKNOWN" }, prepared.plan.changes.map(change => ({ ref: "docs/audit/" + change.path, sha256: change.after_sha256 })));
        } catch (cause) {
          if (!attempted) throw cause;
          return output("session_initialize", "reconciliation_required", "unknown", { committed, reason_code: /^[A-Z][A-Z0-9_]+$/.test(cause.code ?? "") ? cause.code : "STANDARD_SESSION_EFFECT_UNCONFIRMED" });
        }
      });
    },
    async reconcileSession(prepared) {
      if (!prepared?.plan || prepared.plan_sha256 !== shadowHash(prepared.plan)) fail("STANDARD_PLAN_INVALID");
      assertStandardSessionPlan(prepared.plan);
      const context = scope();
      if (shadowHash(context.project) !== shadowHash(prepared.plan.scope.project) || shadowHash(context.persistence) !== shadowHash(prepared.plan.scope.persistence)) fail("STANDARD_AUTHORITY_CHANGED");
      if (artifacts.ownerPending()) return output("session_initialize", "reconciliation_required", "unknown", { reason_code: "STANDARD_EFFECT_OWNER_RECONCILIATION_REQUIRED" });
      const after = await postconditions(prepared.plan);
      return output("session_initialize", after.satisfied ? "completed" : "reconciliation_required", after.satisfied ? "confirmed" : "unknown", { postconditions: after },
        after.satisfied ? { session_initialized: true, session_mode_pending: prepared.plan.input.mode === "UNKNOWN" } : {},
        prepared.plan.changes.map(change => ({ ref: "docs/audit/" + change.path, sha256: change.after_sha256 })));
    },
  });
}
