import fs from "node:fs";
import { shadowHash } from "../../core/workflow/shadow-json.mjs";
import { assertHumanModeDecision, assertHumanRecoveryDecision } from "../../core/workflow/process-decision-inbox.mjs";
import { assertHumanSpikeDecision } from "../../core/workflow/standard-spike-decision.mjs";
import { assertHumanCycleEntryChoice } from "../../core/workflow/standard-cycle-entry-choice.mjs";
import { assertHumanRecoveryCycleSelection } from "../../core/workflow/standard-drift-recovery-cycle-selection.mjs";
import { assertHumanCycleClosureDecision } from "../../core/workflow/standard-cycle-closure-decision.mjs";
import { assertHumanBaselinePromotionDecision } from "../../core/workflow/standard-baseline-promotion-decision.mjs";
import { assertHumanSessionClosureDecision } from "../../core/workflow/standard-session-closure-decision.mjs";
import { assertHumanSessionBranchIntegrationDecision } from "../../core/workflow/standard-session-branch-integration-decision.mjs";
import { assertHumanMergeConsent } from "../../core/workflow/standard-pr-merge-consent.mjs";
import { assertHumanPrCorrectionDecision } from "../../core/workflow/standard-pr-correction-decision.mjs";
import { assertHumanExternalMergeDisposition } from "../../core/workflow/standard-pr-external-merge.mjs";
import { assertHumanPostMergeDecision } from "../../core/workflow/standard-pr-post-merge-decision.mjs";
import { assertHumanResolutionException } from "../../core/workflow/standard-pr-resolution-exception.mjs";
import { assertHumanModeWorkDecision, modeWorkDecisionSubject } from "../../core/workflow/standard-mode-work-continuation.mjs";

const subject = q => q.subject;
const review = q => q.review;
const whole = q => q;
const profiles = new Map();
function register(name, versions, claim, project, validate, prompt) {
  for (const [version, claimVersion] of versions) {
    profiles.set(`standard-${name}-question.v${version}`, {
      claim: `human-${claim}.v${claimVersion}`, project, validate, prompt,
    });
  }
}
const v1 = [[1, 1]], v12 = [[1, 1], [2, 2]], same = [[1, 1], [2, 1]];
register("mode", v1, "mode-decision", whole, assertHumanModeDecision, "Quel mode veux-tu utiliser pour cette session ?");
register("drift-recovery", v1, "drift-recovery-decision", whole, assertHumanRecoveryDecision, "Comment veux-tu traiter la dérive ?");
register("drift-recovery", [[2, 2]], "drift-recovery-decision", review, assertHumanRecoveryDecision, "Comment veux-tu résoudre cet écart d’objectif ?");
register("drift-recovery-cycle", same, "drift-recovery-cycle-decision", subject, assertHumanRecoveryCycleSelection, "Quel cycle de correction veux-tu ouvrir ?");
register("cycle-entry-choice", v1, "cycle-entry-choice", subject, assertHumanCycleEntryChoice, "Quel cycle veux-tu reprendre ?");
register("spike", v12, "spike-decision", review, assertHumanSpikeDecision, "Veux-tu convertir cette exploration en SPIKE ?");
register("mode-work", v12, "mode-work-decision", modeWorkDecisionSubject, assertHumanModeWorkDecision, "Quelle suite veux-tu donner à ce travail ?");
register("cycle-closure", v1, "cycle-closure-decision", review, assertHumanCycleClosureDecision, "Quel résultat veux-tu retenir pour ce cycle ?");
register("baseline-promotion", v1, "baseline-promotion-decision", review, assertHumanBaselinePromotionDecision, "Veux-tu promouvoir ce résultat en référence ?");
register("session-closure", v1, "session-closure-decision", review, assertHumanSessionClosureDecision, "Veux-tu clore cette session ?");
register("session-branch-integration", v1, "session-branch-integration-decision", review, assertHumanSessionBranchIntegrationDecision, "Veux-tu intégrer cette branche à la session ?");
register("pr-correction", [...v12, [3, 3]], "pr-correction-decision", review, assertHumanPrCorrectionDecision, "Comment veux-tu traiter les corrections de cette PR ?");
register("pr-merge-consent", same, "pr-merge-consent", subject, assertHumanMergeConsent, "Fusionner cette PR sur ce commit ?");
register("pr-post-merge-decision", v1, "pr-post-merge-decision", subject, assertHumanPostMergeDecision, "Quelle suite veux-tu donner à cette fusion ?");
register("pr-external-merge-disposition", same, "pr-external-merge-disposition", subject, assertHumanExternalMergeDisposition, "Comment qualifies-tu cette fusion externe ?");
register("pr-review-resolution-exception", v1, "pr-review-resolution-exception", subject, assertHumanResolutionException, "Acceptes-tu cette exception de revue ?");

const common = new Set(["contract_version", "source_kind", "authority_id", "source_event_id", "subject_sha256", "question_sha256", "choice", "evidence_refs"]);
function profile(q) {
  const result = profiles.get(q.contract_version);
  if (!result) throw Error("OPERATOR_QUESTION_UNSUPPORTED");
  return result;
}
export function operatorOffer(question, sourceRef) {
  const p = profile(question);
  const schema = JSON.parse(fs.readFileSync(new URL(`../../core/contracts/workflow-definition/${p.claim}.schema.json`, import.meta.url)));
  return { question, prompt: p.prompt, claim_version: p.claim, source_ref: sourceRef, question_sha256: shadowHash(question),
    subject_sha256: shadowHash(p.project(question)), fields: Object.fromEntries(schema.required.filter(k => !common.has(k)).map(k => [k, schema.properties[k]])) };
}
export function assertOperatorClaim(claim, q, sourceRef) {
  const p = profile(q);
  if (claim?.contract_version !== p.claim || claim.source_event_id !== sourceRef || claim.source_kind !== "human"
    || claim.question_sha256 !== shadowHash(q) || claim.subject_sha256 !== shadowHash(p.project(q))
    || !q.choices.includes(claim.choice)) throw Error("OPERATOR_DECISION_CHANGED");
  p.validate(claim, q);
}
