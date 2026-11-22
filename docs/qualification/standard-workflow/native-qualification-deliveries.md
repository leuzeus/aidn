# STANDARD Native qualification deliveries

## Decision in an authenticated project session

On candidate `edd5dd22`, S001 consumed one signed COMMITTING decision and applied the mode. The pilot operator used a signing script with a key passphrase. Two valid envelopes carried the same choice for the same question. The public host received one through `--decision-source`, verified its `standard-host-source.v1` signature against the enrolled principal and recorded one result. Capture from the authenticated project interface was unavailable on this pilot. [Windows attempt 2](native-committing-edd5dd22-attempt-2.json) · [Host verification](../../../src/adapters/runtime/standard-host-authority.mjs)

The specification asks for an explicit mode choice and aims to reduce operator effort. It leaves the response channel open. The `signed_mode` check starts with the submitted envelope and follows it through verification, recording and application. It would produce the same result if an interface signed the answer in the background. The pilot treated the operator's signing steps as preparation, so its result contains no measurement of the effort to answer each question. [Operator objective](https://github.com/leuzeus/aidn/blob/edd5dd2294d0a3ecbb84caeee530799657e71403/docs/SPEC.md#L67) · [Explicit mode choice](https://github.com/leuzeus/aidn/blob/edd5dd2294d0a3ecbb84caeee530799657e71403/docs/SPEC.md#L115-L118)

Lot 2b delivers the missing interaction. A person working in their authenticated project session sees one business question and answers it once. For merge consent the question identifies the repository, pull request, target branch and exact head commit and offers approval or refusal. During a decision there are zero terminal launches, PEM selections or passphrase prompts. Any initial enrollment takes place during setup.

The interface records the user's choice and produces the proof in the background. The workflow host must independently verify the principal, the instance and operation, the exact question and subject, the offered choice and freshness. The requesting agent has no access to the signing capability and cannot turn a chat transcript into approval. The host can reuse its existing signed-source verifier. [Decision contracts](../../ADR/ADR-0025-standard-workflow-runtime-binding.md#human-decision-profiles)

## Delivery order

| Lot | Delivery and qualification |
| --- | --- |
| 1 | Freeze the candidate and archive, prepare the private pilot and record host capabilities. |
| 2a | Run the real Windows FILES COMMITTING path from public entry to post-merge. Record the human capture channel used for each decision. [Campaign PR](https://github.com/leuzeus/aidn/pull/197) |
| 2b | Deliver a product PR to `dev` for the authenticated interface, background proof and submission to the host. Exercise one live decision and its receipt. Route the change as ASSURED because it crosses the human authority boundary. |
| 3 | Qualify cold resume, capability and independence refusals, and an interrupted effect. Exercise the signed interface decision on both sides of host acceptance. |
| 4 | Install the frozen archive in a clean Windows client. Repeat the nominal and resume with the authenticated interface and publish the P0 verdict for the tested candidate. |
| 5 | Exercise multiple tasks on FILES and PostgreSQL. Refuse stale responses and a changed HEAD, binding or provider before effect. |
| 6 | Exercise incidents, concurrency and corrective delivery. Change the head of a real private pull request after consent and obtain a fresh answer for the new commit. |
| 7 | Exercise THINKING, EXPLORING and SPIKE, including existing-cycle choice, defer and conversion. Qualify the [cycle branch collision decisions](#cycle-branch-collisions) on the COMMITTING entry. |
| 8 | Complete R05 and R07–R10 and the L1–L8/A1–A10 evidence. Include a mixed resume with a previously accepted human decision. |
| 9 | Qualify supervised Native execution and descendant closure on Windows and Linux. |
| 10 | Run the same installed archive on both hosts. Report nominal, resume, UNKNOWN reconciliation, costs and the human interface actually used per host. |

The two parts of lot 2 let the current Windows trace keep its frozen candidate. Once 2b merges, freeze the new candidate and archive and repeat the complete path. Record the end-to-end host result and the authenticated-interface result separately. A project-ready verdict requires evidence of the one-answer interaction.

For a fresh Windows pilot, observe both installed hooks as enabled and trusted in a real thread before preparing the validator plan for approval. On revision 425, trusting the project updated the client configuration included in the plan. Its previous fingerprint was stale before the first control ran. [Windows preparation report](native-committing-c79bf0d7.json)

## Acceptance evidence for lots 2b–4

The initial Windows recovery trial retained zero receipts for the mode question.
A fresh Codex process discovered the installed connector and resolved the original
user message. A disposable enrolled connection exercised the public host through
cold delivery.

The operator subsequently accepted a local-history evidence exception for the
S001 pilot. A dedicated local observer read the original COMMITTING message and
the exception consent through Codex, signed one source and submitted it through
the public host. The mode occurrence now has one completed receipt. A separate
process recovered the same receipt, and the session and canonical current state
both record COMMITTING. The public path completed two genuine Native drift
activities, initialized the cycle and accepted its objective alignment through
one answer in the chat, with zero manual signing steps. Both Native generations
closed their journals and observed zero active Job Object processes.

The shared checkpoint call then requested a second alignment opinion for the
same evaluation and context after the confirmed physical finalizer. The pilot
retains that first unexpected transition. No second answer was requested from
the operator or submitted to the runtime. [Product PR #204](https://github.com/leuzeus/aidn/pull/204)
merged the correction after the original model reproduced the duplicate and
the corrected model passed the cold checkpoint with one source and one receipt.
The checkpoint keeps its original source, completion and effect checks.
Governance Admission and its ten selected families passed on the reviewed head.
The original candidate remains stopped at that question; its receipts are retained.
[Resumed Windows evidence](native-committing-c79bf0d7.json)

The successor is `2fe9c20caffce69e7c888f4d04975e85ca20d2b8`, catalog revision
426. Its frozen archive has SHA-256
`ae8f5b6f13b8c3e0daacdbb7b1da09d5461a5482a4fb15b12c030b7eeef0731f`.
The installed model, provider inventory and implementation pins match source.
A fresh local pilot starts from the same product baseline. Its hook trust,
validation boundary and Native allocation are observed separately; earlier
candidate receipts are not migrated into this new instance.

The `2fe9c20c` run passed its four Windows boundary controls and the local chat review, applied the preserved COMMITTING choice, and consumed two genuine Native responses. The operator then chose `request_diagnosis` for the differing objective formulations. Its accepted receipt survives cold reopening. The following public preview refused `STANDARD_OBJECTIVE_ALIGNMENT_NOT_CONFIRMED`: the fresh-cycle graph tried to finalize that choice. No further Native response, finalization or product write followed. [Candidate evidence](native-committing-2fe9c20c.json) preserves this first failure. [Product PR #205](https://github.com/leuzeus/aidn/pull/205) merged the bounded diagnosis loop after its FILES regression and all ten CI families passed. The successor `6b6437c4` (catalog 429) is installed from archive SHA-256 `8b24ebdcf497f65aff765099c65b09b20802c3b9ec6162432f5f5fede4f09957`. Its hooks and four Windows boundary controls passed. The operator accepted the validator review in the chat; the qualified profile is linked to the frozen configuration. S001 applied the preserved COMMITTING choice with one receipt and no manual signing. A fresh process recovered that receipt using the candidate runtime: the older installed connector reader rejected the enlarged model, so the local composition now reads process instances with the frozen candidate kernel while retaining the pinned connector’s authority verification. A broader import composition lacked the connector’s envelope-verification method and was narrowed before valid diagnosis submission. This is not installed-connector qualification. The explicit continuation request has now supplied `request_diagnosis` on the successor’s current evaluation. One accepted receipt survives cold reopening; a tampered alignment choice is refused. The next public action is a new Native turn, with no intervening cycle finalizer. Three genuine responses closed with zero active processes. The additional diagnosis produced a distinct second-iteration evaluation and a new human alignment subject; no cycle finalizer ran between the diagnosis request and that evaluation. The operator confirmed alignment on that new report in the chat. Its single receipt survives cold reopening; the finalizer consumes the second evaluation and the physical checkpoint produces one matching event and the workflow index. No duplicate completion question appears before the genuine planner starts. [Successor evidence](native-committing-6b6437c4.json). No new human decision is pending on the failed candidate.

The fresh local clone also retained the previous pilot’s inactive cycle branch. The public entry correctly refused `STANDARD_CYCLE_BRANCH_EXISTS` before cycle creation. The preparation repair preserves that old commit under a distinct local reference, prunes obsolete remote references and leaves the current HEAD unchanged. The first refusal remains in the candidate evidence. Future pilot preparation must verify the proposed session and cycle branches against both local and actual remote refs before public entry.

The exception establishes what the local observer read. Independent proof of
the original message author and the product-level authenticated interface remain
open. Lot 2b retains those requirements, and P0 remains pending.
[Lot 2b evidence](codex-operator-decisions-lot-2b.json) · [Product PR](https://github.com/leuzeus/aidn/pull/203)

Begin observation in the authenticated project session before the pending question appears. Retain a redacted observation of the question as displayed, its offered answers and the subject the person can see. Follow the same occurrence through the answer, background submission, host acceptance and the next workflow step. Count each business answer and any extra steps the person has to take, including opening a terminal, choosing a key, entering a passphrase or returning to repeat a choice. Record the same counts after a cold restart. One-time setup can be reported separately when the run shows it took place before the question.

| Scenario | Required observation |
| --- | --- |
| Answer in the authenticated session | Match the displayed subject to the subject in the independently verified receipt. Observe one business answer, zero extra signing steps and automatic continuation after acceptance. A response produced solely by the requesting agent is refused before effect. |
| Restart after capture, before acknowledgement | A fresh process resumes the same instance, resolves the authenticated event and consumes it once. Re-delivery of that event keeps the same decision and receipt. |
| Restart after acceptance | A fresh process finds the accepted decision on the same occurrence. The person sees zero repeated questions. Approval produces one physical effect, verified against the private provider. Refusal produces none. |
| Change the pull request HEAD | The old consent cannot authorize the new commit. Verify zero merge effects under that consent. The interface presents a new question naming the new commit. |

Report each observation in order with the tested SHA and archive digest, the interface used, the question and subject digests, the source event, the accepted receipt and the independently observed effect. The S001 trace is the control for interpreting incomplete evidence. A CLI preview, valid envelope and accepted receipt establish the runtime result. With only these artifacts, record the interface counts as unknown and skip the one-answer and cold-resume verdicts.

## Cycle branch collisions

On `6b6437c4`, the local clone inherited a cycle branch from an earlier pilot. Before the collision, AIDN admitted creation and reported resumption unavailable. The public preview returned only `STANDARD_CYCLE_BRANCH_EXISTS` and wrote nothing. It left the operator to identify the conflicting branch, determine whether the cycle could be resumed and choose how to proceed. The later creation succeeded after a manual Git repair. [Candidate report](native-committing-6b6437c4.json)

Both pilots used FILES. The installed `runtime db-status` found no SQLite index in either pilot. After the repair, `runtime artifact-store list --view agent` returned complete file inventories with identical cycle brief hashes. The two objectives matched. Each pilot had its own S001 session record and session branch. At the earlier refusal, the new project's state showed no active cycle. The open cycle records still lived in the previous pilot's working tree, outside the inherited Git commit.

Use the configured source for the lookup. FILES with SQLite indexing reads the project files. Canonical SQLite and PostgreSQL require a read in the configured database scope. Resolve the active session in that project first. For direct resumption, verify that the cycle names the active session in `session_owner` and that the session lists the cycle in `attached_cycles`. Compare objectives after verifying that attachment. [Cycle-entry admission](../../../src/application/runtime/standard-cycle-entry-admission.mjs)

| Observed at entry | Expected public behavior to qualify |
| --- | --- |
| The branch name is taken | In a read-only preview, show the requested cycle and objective, the conflicting local branch and tip, the intended base, and what AIDN found in the configured project's canonical cycle inventory. Distinguish a complete lookup with no record from an unavailable or incomplete lookup. |
| Same objective, cycle attached to the active session and resumable | Verify the branch, lifecycle state and point of resumption. Use the existing resume path, with a single in-session choice if needed. Verify the same session and cycle IDs and zero additional cycle or branch creations. |
| Same objective, cycle owned by another session | Identify its owning session and refuse direct resumption in the active session. Preserve the attachment. A cycle explicitly reported from a previous session follows the existing carryover decision. [Reported-cycle decisions](../../../src/core/workflow/standard-cycle-entry-choice-record.mjs) |
| A different objective is established and a new cycle is wanted | Offer the next available cycle ID and branch with the active session as owner. Obtain acceptance of that specific creation plan and recheck the session and availability before writing. Preserve the existing cycle and its history. |
| Only a Git reference exists, ownership or objective is uncertain, or the cycle cannot be resumed | Explain which evidence is missing or which admission failed. Offer recovery or deferral. Keep the existing reference intact and require fresh admission for any later creation. |

Lot 2a retains the original refusal and the manual repair. Lot 3 checks that a retry after an interrupted creation reconciles the same occurrence. Lot 5 checks the lookup in FILES and on isolated PostgreSQL with a stale local projection. Lot 7 verifies the resume, new-cycle and unresolved choices above. These product scenarios remain open.
