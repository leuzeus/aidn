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
| 7 | Exercise THINKING, EXPLORING and SPIKE, including existing-cycle choice, defer and conversion. |
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
both record COMMITTING. The public path continued through session admission to
its first Native activity. This recovery required zero new mode answers and zero
manual signing steps.

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
