// Fixed read-only verification workload. These instructions belong to the
// benchmark; they do not change ordinary work, admission or review policy.
export const verificationBatch = "Get-Content -LiteralPath @('ledger.mjs','ledger.test.mjs')\nnode --test ledger.test.mjs";

export function controlledAgenticBenchmarkInstructions(model, firstWorkNodeId) {
  const policies = new Map(model.policies.map(p => [p.id, p]));
  const activities = model.nodes.filter(n => n.kind === "activity");
  const first = activities.find(n => n.id === firstWorkNodeId);
  if (!first || policies.get(first.policy_ref)?.independent_review) throw Error("BENCHMARK_FIRST_WORK_INVALID");
  const common = "Controlled immutable ledger verification benchmark. Product files and criteria are pinned and checked by the host before each activity. All applicable project/common authority and skills are already supplied in developer instructions; do not search for AGENTS.md or workflow setup. Do not create files, change product/workflow state, use networking or create agents. Return an honest concise JSON outcome and summary. A material defect must fail or reject; never report tests as newly executed when reusing evidence.";
  const batch = `Read both files and execute the tests in ONE tool cell using this single PowerShell command:\n${verificationBatch}\nUse yield_time_ms: 10000 for the shell call and allow the surrounding tool cell 30000 ms so the normal command can finish. If it really yields, wait on the returned live handle instead of restarting it. Report the observed exit code and test counts. Do not split file reads and tests into separate model/tool round trips. Additional checks for a concrete concern remain permitted and must be reported.`;
  return Object.fromEntries(activities.map(node => {
    const policy = policies.get(node.policy_ref);
    const review = policy.independent_review || policy.context_isolation_required;
    const action = review
      ? `Independent review of your fresh snapshot and the common criteria. Do not use author transcripts or the author's evidence as your review verdict. ${batch} This is a machine review, not human acceptance.`
      : node.id === firstWorkNodeId ? `Establish the author's observed verification evidence. ${batch}`
        : "Apply this distinct control obligation using the verification evidence already observed in this same author context. The host has checked unchanged product and criteria. Reuse that evidence without rereading files or rerunning identical tests. Explicitly say evidence was reused, not newly executed. If prior evidence is absent or a concrete inconsistency needs investigation, report it honestly and perform only the needed checks; do not invent a PASS.";
    return [node.id, `${common}\n${action}`];
  }));
}
