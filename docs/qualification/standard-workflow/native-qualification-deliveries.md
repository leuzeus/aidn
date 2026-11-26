# STANDARD Native qualification deliveries

## Decision in an authenticated project session

On candidate `edd5dd22`, S001 consumed one signed COMMITTING decision and applied the mode. The pilot operator used a signing script with a key passphrase. Two valid envelopes carried the same choice for the same question. The public host received one through `--decision-source`, verified its `standard-host-source.v1` signature against the enrolled principal and recorded one result. Capture from the authenticated project interface was unavailable on this pilot. [Windows attempt 2](native-committing-edd5dd22-attempt-2.json) · [Host verification](../../../src/adapters/runtime/standard-host-authority.mjs)

The specification asks for an explicit mode choice and aims to reduce operator effort. It leaves the response channel open. The `signed_mode` check starts with the submitted envelope and follows it through verification, recording and application. It would produce the same result if an interface signed the answer in the background. The pilot treated the operator's signing steps as preparation, so its result contains no measurement of the effort to answer each question. [Operator objective](https://github.com/leuzeus/aidn/blob/edd5dd2294d0a3ecbb84caeee530799657e71403/docs/SPEC.md#L67) · [Explicit mode choice](https://github.com/leuzeus/aidn/blob/edd5dd2294d0a3ecbb84caeee530799657e71403/docs/SPEC.md#L115-L118)

Lot 2b delivers the missing interaction. A person working in their authenticated project session sees one business question in a native form in the current Codex chat and answers it once. The form renders in the conversation itself, with zero browser panels or web pages in the decision path. For mode selection, the initial request and objective inform the proposed mode before the explicit acknowledgement required by SPEC-R01. For merge consent the question identifies the repository, pull request, target branch and exact head commit and offers approval or refusal. Authentication and key enrollment take place only during project installation or an AIDN update. Each subsequent decision has zero Windows Hello prompts, terminal launches, key selections or manual signatures.

The interface records the user's choice and produces the proof in the background. The workflow host must independently verify the principal, the instance and operation, the exact question and subject, the offered choice and freshness. The requesting agent has no access to the signing capability and cannot turn a chat transcript into approval. The host can reuse its existing signed-source verifier. [Decision contracts](../../ADR/ADR-0025-standard-workflow-runtime-binding.md#human-decision-profiles)

### Windows decision panel experiment

On `d0148e3a`, Codex in the Windows pilot reports `providerUnavailable` for native user verification. A top-level browser panel opened in the same chat reports a secure context, WebAuthn permission and an available user-verifying platform authenticator. The panel probe did not enroll a credential or request a decision. An embedded browser frame requires a separate host permission, verified in a controlled browser fixture. [Codex verification API](https://github.com/openai/codex/blob/main/codex-rs/app-server/README.md#user-verification-experimental) · [WebAuthn embedded usage](https://www.w3.org/TR/webauthn-3/#sctn-iframe-guidance)

An isolated prototype bound a virtual platform credential's assertion to one exact question and choice. A test user interface click yielded one verified proof. A separate fixture fed WebAuthn evidence through the signed-source verifier in the installed archive. It recorded one decision and recovered the same receipt with a fresh operator adapter. The live PostgreSQL session still has the original mode question staged and zero enrolled principals or decision receipts. [Windows panel experiment evidence](windows-decision-panel-d0148e3a.json)

Qualification still requires an enrollment bound to the project installation authority, an issuer outside the requesting agent's control, and an accepted evidence format for a panel decision. The fixture used a synthetic message reference to exercise the existing contract. A genuine panel confirmation must carry its own evidence and preserve the exact question, subject, choice and freshness. The actual enrollment, live confirmation and continuation after the mode decision remain SKIP.

Candidate `cb2c3ea1` packages the exact-plan Windows enrollment and the panel's direct WebAuthn proof. Source and installed verification passed. The installed browser fixture produced one verified source from one selection with a virtual authenticator and read the same result after reload. The first real installation reached the Windows administrator prompt, which returned cancellation before credential creation. The existing PostgreSQL mode question remains staged with zero receipts. [Product PR](https://github.com/leuzeus/aidn/pull/203) · [Installed candidate evidence](windows-operator-enrollment-cb2c3ea1.json)

The retry enrolled a real Windows key. A medium-integrity process was denied write access to its administrator-owned registry record. The first installed entry with that key stopped on stale catalog bindings. The corrected archive `6cad6196` reused the enrollment and reached the mode question for the same PostgreSQL session in a new technical instance. The original journals were preserved. The Codex panel displays a read-only preview while the consent channel is resolved. [Continuation evidence](windows-operator-continuation-6cad6196.json)

The direct WebAuthn panel requires user verification for every assertion. The approved production interaction requires verification only when installing or updating AIDN in the project, so the direct panel is an experimental path. The ordinary installed Codex input and form response schemas expose answers or form content and optional metadata. Qualification still requires a supported issuer that can attest the exact user action from the authenticated chat and use the project authority enrolled at installation. AIDN already verifies the signed source and recovers its accepted receipt. The active mode question waits for that channel with zero decision receipts. [Codex form response](https://learn.chatgpt.com/docs/app-server) · [Signed message recovery](https://github.com/leuzeus/aidn/blob/6cad6196a8dc4abad9c36fedea37445e39ff7715/docs/WORKFLOW_CONSOLE.md#enroll-a-decision-issuer-at-installation)

## Delivery order

| Lot | Delivery and qualification |
| --- | --- |
| 1 | Freeze the candidate and archive, prepare the private pilot and record host capabilities. Prepare an isolated PostgreSQL database shared by two pilot checkouts. |
| 2a | Stabilize the real Windows COMMITTING workflow on shared PostgreSQL using the [targeted correction loop](#targeted-corrections-and-final-qualification) and evaluate the [cycle continuation strategies](#cycle-continuation-strategies) from the blocked boundary. Then run the complete public journey through independent audit, pull request, review, merge and synchronization on the frozen candidate. Read the session and its cycle from the second checkout and verify the Git and provider effects. Record the human capture channel. [Campaign PR](https://github.com/leuzeus/aidn/pull/197) |
| 2b | Deliver a product PR to `dev` for the native in-chat Codex form, background proof and submission to the host. Exercise one live decision and recover its receipt. Route the change as ASSURED because it crosses the human authority boundary. |
| 3 | Qualify cold resume on PostgreSQL, capability and independence refusals, and reconciliation of an interrupted effect. Verify the same instance, one accepted decision and one physical effect. |
| 4 | Install the same frozen archive in a clean Windows client. Repeat the PostgreSQL nominal and cold resume with the authenticated interface. Publish the Windows/PostgreSQL P0 verdict for that candidate and archive digest. |
| 5 | Exercise multiple tasks on shared PostgreSQL, stale local data, an unavailable database and a changed project scope. Refuse stale responses and a changed HEAD, binding or provider before effect. |
| 6 | Exercise incidents, concurrency and corrective delivery. Change the head of a real private pull request after consent and obtain a fresh answer for the new commit. |
| 7 | Exercise THINKING, EXPLORING and SPIKE, including existing-cycle choice, defer and conversion. Qualify the [cycle branch collision decisions](#cycle-branch-collisions) on the COMMITTING entry. |
| 8 | Complete R05 and R07–R10 and the L1–L8/A1–A10 evidence. Include a mixed resume with a previously accepted human decision. |
| 9 | Qualify supervised Native execution and descendant closure on Windows and Linux. |
| 10 | Run the same installed archive with PostgreSQL on both hosts. Report nominal, resume, UNKNOWN reconciliation, costs and the human interface actually used per host. |

Prepare the shared database now and retain the Windows/FILES attempts under their original verdicts. Test corrections from the blocked step while stabilizing the journey; reserve complete source and installed runs for the final frozen candidate. Follow the [full-run measurement order](#full-run-measurement-before-optimization) before performance optimization. The P0 verdict still requires those complete runs on one candidate, including the authenticated one-answer interaction. If the database blocks a transition, retain the first failure and its scope. Apply the same PostgreSQL priority to the later THINKING, EXPLORING and SPIKE runs and to qualification on both operating systems.

## Targeted corrections and final qualification

The operator selected this delivery order on 2026-11-22. It supersedes the earlier campaign instruction to restart the complete journey after every correction. Historical attempts keep their original verdicts and provenance.

1. Preserve the first failed transition and its actual inputs, expected result, candidate and archive digests, canonical session/cycle identity, accepted decisions and receipts, and observed resource and effect state. Keep a checkpoint that can reproduce the boundary. Private inputs and raw traces remain outside the public repository.
2. Deliver the focused correction and regression. Replay the blocked step from those retained inputs on the corrected candidate, then exercise the following steps. When the issue concerns actual Native behavior, use a genuine Native actor for that targeted replay under the applicable authorization; a fixture alone does not establish that behavior. Re-run predecessors only when their outputs or admission are invalidated by the change, and record that dependency.
3. Prefer an admitted continuation of the same instance. If a changed model, implementation or subject makes it incompatible, retain the refusal and use an isolated targeted replay or the nearest valid predecessor. Identify reconstructed or fixture state explicitly; it is not evidence that the earlier workflow steps executed on the corrected candidate. If the missing checkpoint entry prevents the targeted replay, treat that capability as a bounded prerequisite instead of automatically creating another full pilot. Do not rewrite historical journals, receipts, version pins or terminal outcomes to manufacture a continuation.
4. Before repeating a dispatched action, reconcile its actual effects and resource closure. UNKNOWN remains unresolved until the supported reconciliation proves its outcome. Preserve cumulative Native consumption and the applicable grants. Reuse accepted human decisions when their exact subject, authority and admission remain valid; explain a changed subject before requesting a new decision. A targeted replay does not by itself justify repeating an unchanged business question or manual signing.
5. Once the remaining nominal stages have been exercised, the blocking defects are resolved and the intended runtime/model changes are incorporated, freeze the final candidate and archive. Run and measure the full public source journey without corrections during the run, before performance optimization. Run the lot 3 resume/refusal/reconciliation cases and the lot 4 installed nominal and resume on that same candidate. Record source and installed evidence separately. Only this final campaign can support the P0 verdict; successful fragments from several candidates cannot be combined into a complete-run PASS.

Each correction report distinguishes the retained failure, focused regression, genuine targeted replay and final end-to-end qualification with separate PASS, FAIL, SKIP or UNAVAILABLE results. It names the entry checkpoint, inherited prerequisites, invalidated evidence, tested candidate and archive, and the next unqualified step. Until the final campaign passes, full nominal qualification and P0 remain open even when a targeted step succeeds. If the final campaign exposes another defect, return to the focused correction loop, then repeat the complete qualification after stabilization.

This is the campaign strategy, not a claim that arbitrary cross-version instance migration is implemented. The current runtime checks model/policy identity and implementation pins; the chosen checkpoint entry must satisfy those checks or be delivered and qualified as a separate capability. [Instance authority](../../../src/application/runtime/agentic-process-service.mjs) · [Implementation binding](../../../src/application/runtime/agentic-process-execution-composition.mjs)

For a fresh Windows pilot, observe both installed hooks as enabled and trusted in a real thread before preparing the validator plan for approval. On revision 425, trusting the project updated the client configuration included in the plan. Its previous fingerprint was stale before the first control ran. [Windows preparation report](native-committing-c79bf0d7.json)

Candidate `914f34e8` starts the PostgreSQL/db-only campaign after [PR #206](https://github.com/leuzeus/aidn/pull/206). The four Windows validator controls and their local chat review passed. Both installed checkouts read the same 44 canonical artifacts and one S001 under a stable project scope. COMMITTING was accepted once and its receipt recovered in a new process. Fresh installation created the database schema without canonical project rows: the first public preview refusal is retained, followed by an explicit import of the 35 untouched bootstrap artifacts into the empty scope. No historical session was migrated. Cross-checkout resumption, the full nominal, installed replay and independent interface proof remain open. [PostgreSQL campaign report](native-committing-914f34e8.json)

## Full-run measurement before optimization

The operator selected this order: finish stabilization, measure a complete journey on a frozen candidate without corrections during the test, then evaluate performance improvements. This takes precedence over starting performance-only experiments from the partial timing analysis. Correctness and continuation fixes needed to stabilize the current journey remain in scope.

1. **Finish stabilization through targeted corrections.** Continue from the failed step or its nearest admitted predecessor. Preserve the current session/cycle history, decisions, effects and Native accounting. Do not restart the complete pilot after each fix, and do not expand this prerequisite into completing every later delivery lot.
2. **Freeze the reference run.** Retain the reviewed Git SHA, archive digest, catalog, configuration, model and effort, provider/binding and executable identities, OS/backend, product starting revision, scenario and acceptance criteria. Fix the measurement boundaries before execution. Any telemetry change needed for the measurement must be incorporated before this freeze. "Without corrections" means using the corrected candidate unchanged during the test; it does not mean reverting the delivered fixes.
3. **Execute one complete measured journey.** Start from public workflow entry on the small product scenario and follow one new measurement run through planning, implementation, validation, independent audit, closure, pull request, review, merge and independently observed synchronization. Preserve the earlier session and attempts. Normal product/state writes and business decisions are part of the workflow; replacing runtime code, changing the frozen configuration, manually repairing state, importing a successful intermediate step or skipping a gate is not a nominal measurement. Keep the usual human channel and record its actual guarantees and interaction counts.
4. **Publish the reference measurement before optimizing.** Report elapsed time from first public entry to final synchronization, separately from preparation outside that interval. Identify human waits, external waits, Native execution, deterministic checks/writes, product tests and orchestration. Use observed interval boundaries; label missing timing as unknown, and do not add overlapping spans or subtract unmeasured waits to manufacture a net duration. Record calls and tokens where available. A single successful run is a reference observation, not an SLA or a statistically established performance distribution.
5. **Only then select optimization experiments.** Retain the frozen reference and compare one change at a time under the same scenario, criteria, host/backend and model conditions, unless the changed model itself is the declared experiment. Preserve all required refusals, independent review, human authority and effect guarantees. Optimization proposals remain hypotheses until their measured comparison is conclusive. Performance-only prototypes and implementations wait for the complete reference run.

If the measured run encounters a defect requiring correction, keep its first failure, timing and provenance. It is not a successful nominal performance reference. Return to the targeted correction loop, finish stabilization, freeze the successor and repeat the complete measurement then. Do not splice timings or successful stages from different candidates into a nominal result, or change the candidate while keeping the same reference-run claim.

The earlier roughly fourteen-minute figure is a reconstructed subtotal of selected successful actor and test intervals across several attempts and candidates. It excludes some deterministic runtime/orchestration work and the remaining session delivery. Keep it as exploratory evidence only, not as the full workflow duration or the comparator for an optimization claim.

Use an already required complete P0 run for this measurement when its scope matches, rather than adding a duplicate campaign. Keep source and installed measurements distinct, and keep the lot 3 and lot 4 qualification obligations. Measuring duration does not close any remaining P0 requirement. This measurement order adds no permanent long-running CI suite and no extra manual signing step. Until the complete measured journey exists, its verdict remains SKIP and no speedup is claimed.

## Cycle continuation strategies

This addition separates experiments, implementation decisions and qualification. The strategies below are proposed work, not delivered capabilities or a blanket migration authorization. Evaluate the smallest useful slice first; later slices must not delay the current targeted correction. They serve correctness and continuity stabilization; any performance-only extension follows the complete reference measurement above.

The retained `020382a9` report establishes the immediate boundary: entry admits the owned OPEN cycle, then canonical plan projection refuses `STANDARD_CANONICAL_PLAN_UNREPRESENTABLE`. The genuine Native correction replay passed in isolation; `live_instance_resumed` remains false in the original campaign report. The current owned-plan path expects representable planning documents. The projector also requires an exact rendering match, so one generic refusal covers several causes. [Targeted replay](native-prework-replay-020382a9.json) · [Original campaign](native-committing-a2ebe874.json) · [Canonical projection](../../../src/core/workflow/standard-canonical-plan-projection.mjs)

### Strategy 1: select the continuation from observed progress

Test whether current canonical data and authenticated operation history identify the earliest unfinished admissible step. Lifecycle state alone is insufficient: OPEN can mean untouched planning templates or an existing plan awaiting readiness. The selector must also observe the cycle owner, work intent, task progress, pending decisions and unresolved effects.

Start with the owned OPEN cycle whose planning documents are untouched templates. Reuse the bounded correction already in progress rather than create a competing implementation. Compare it with the existing canonical-plan path using the same inputs. The expected next action is planning on the same session, cycle and branch, with no new cycle creation. A partial or changed plan must not be treated as an empty template or silently replaced. Integration-only intent must not gain planning or implementation permission.

The first implementation decision is GO only when controlled-host tests preserve the existing planned-cycle path and pass the negative cases relevant to that entry: partial planning, changed source, foreign ownership, integration-only intent and an unresolved effect owner. After delivery, qualify the exact public entry on the retained PostgreSQL cycle with a genuine Native actor, then observe plan recording and the following admission. An isolated evaluator PASS does not qualify this continuation. Extend to interrupted planning, completed task prefixes and verification only as separate tested slices in lots 3 and 8.

### Strategy 2: diagnose and recover plan representation failures

First prototype a read-only diagnosis that distinguishes untouched templates, partial planning, unsupported document shape, conflicting task progress and changed canonical source. It should identify the relevant artifact or field, the expected next step and which prerequisite is invalid. It must read the configured authority; a stale local projection cannot repair the database implicitly.

Compare two approaches on the same corpus:

- Keep strict admission and give a precise diagnosis with an explicit, separately admitted repair path where needed. This is the first implementation candidate because it preserves current acceptance semantics.
- Add a versioned lossless projection for explicitly supported presentation variants. Probe LF/CRLF, a final blank line, extra sections, duplicate task IDs, reordered or missing tasks, changed write scope and retained verification history. Presentation tolerance is acceptable only if all semantic content and provenance are preserved; unknown content must remain visible and cannot be discarded to obtain a valid plan.

A tolerant projection receives GO only if the comparison shows fewer false refusals with zero acceptance of the altered-scope, progress-conflict and unknown-content counterexamples. Otherwise retain strict admission and deliver only the useful diagnosis. Neither variant rewrites raw hashes, accepted receipts or canonical documents during preview. Any later repair uses explicit write intent, current content/metadata comparison and its own effect evidence. A new structured canonical plan store would require a separate authority/migration decision; it is not a prerequisite for this experiment. [Current plan contract and renderer](../../../src/core/workflow/standard-cycle-planning.mjs)

### Strategy 3: qualify compatibility across runtime updates

Distinguish a cold restart of the same compatible instance from a new technical instance continuing the same business session and cycle. Prototype an explicit comparison of retained and current model, implementation, policy, backend/scope, Git HEAD, provider/binding and decision subjects. Classify each retained prerequisite as reusable, requiring revalidation or incompatible, with the dependency that explains the classification. Equal version labels or an unchanged high-level objective do not establish compatibility.

Use disposable instances first. Compare an unchanged package restart, a compatible declared reader change, an unsupported schema/model transition, a changed decision subject, revoked authority and an unresolved dispatched effect. If a supported transition needs a new instance, keep the old instance immutable and link the continuation to its actual origin. Importing historical task progress as data must not invent current validation or Native-work receipts. Retain consumed Native budget and original applicable grant limits.

GO is limited to individually tested transitions for which the public host authenticates the retained evidence, revalidates affected prerequisites and refuses all incompatible cases before effect. No generic upgrade bypass is implied. The existing same-instance path remains preferred when admitted; an unsupported transition retains its refusal and uses the targeted replay strategy. A product implementation crossing these identity or authority boundaries uses ASSURED and the smallest corresponding contract/ADR updates. [Instance authority](../../../src/application/runtime/agentic-process-service.mjs) · [Implementation binding](../../../src/application/runtime/agentic-process-execution-composition.mjs)

### Shared experiments and implementation order

Create reproducible cases from retained redacted inputs, with an expected next operation and expected physical effects declared before each experiment. First characterize the frozen baseline, then compare a disposable prototype on the identical corpus. Controlled ports establish routing and contract behavior; genuine Native and provider checks remain separate. Publish an evidence-based GO or NO-GO for each slice before promoting its prototype into product code. Existing authorizations still apply; this technical decision adds no new operator signing ceremony.

| Boundary or variation | Required observation |
| --- | --- |
| Owned OPEN cycle, untouched templates | Planning continues with the same project, session, cycle and branch; zero duplicate creations. |
| Partial plan or failed plan recording | Preserve existing bytes and metadata; explain the missing evidence. Reconcile any dispatched write before deciding whether to retry. |
| Valid plan with a presentation-only variation | Diagnosis identifies the variation. Any proposed tolerant reader preserves the complete meaning and historical raw bytes. |
| IMPLEMENTING with a completed task prefix | Authenticate retained progress, select the first unfinished task and obtain current admission; no repeated accepted task effect. |
| VERIFYING with historical results | Preserve those results as history and obtain the current evidence actually required; no inferred audit or closure. |
| Human answer captured or already accepted | Cold recovery consumes the same answer once and recovers its receipt; zero repeated questions for an unchanged valid subject and zero manual signing steps. |
| Effect dispatched, confirmation missing | Keep UNKNOWN and its owner until supported reconciliation resolves that exact occurrence; independently observe at most one physical effect. |
| Another session owns the cycle, or intent is integration-only | No direct work continuation or permission expansion; identify the owner or permitted intent. |
| Second checkout, stale projection, unavailable database or changed scope | Read the configured authority, retain identity where valid, and refuse unavailable or wrong-scope continuation without creating replacement state. |
| Changed HEAD, provider, policy, binding or decision subject | Identify the affected prerequisite; reject stale evidence before effect. A genuinely new human subject is presented once with its reason. |

Use PostgreSQL for the shared-project cases and SQLite without PostgreSQL for local continuation. Preserve the supported dual and db-only projection behavior. Run the small deterministic regressions in PR admission; keep database, real actors, interruption campaigns and installed-package measurements in separate bounded reports.

The delivery order is:

1. **Lot 2a, current correction:** finish and qualify Strategy 1 for an owned unplanned cycle. Preserve the existing correction's ownership and evidence.
2. **Lots 2a/3, separate product PR if conclusive:** implement Strategy 2 diagnostics; add presentation tolerance only if its own experiment passes. Do not make a broad parser rewrite a dependency of the nominal run.
3. **Lots 3/5/8, separate product PRs per supported transition if conclusive:** implement the necessary Strategy 3 handoffs and extend Strategy 1 to later boundaries. Same-instance cold resume remains a distinct lot 3 requirement.
4. **Lots 4/10:** replay the selected capabilities from the final installed archive, including both operating systems where available. Keep the final full-run requirement in the preceding section.

For each comparison retain candidate/archive digests, canonical identity and backend, predecessor/continuation instance IDs, the failed boundary, reused and invalidated evidence, next operation, original failure and new verdict. Measure repeated steps, human answers and extra signing actions, Native calls/tokens when observable, duration and independently observed effects. Report unavailable token counts as unknown. Success requires correct continuation with zero unauthorized effects, duplicate creations, silent data loss or repeated unchanged human questions; reduced time or calls alone is insufficient. Keep PASS, FAIL, SKIP and UNAVAILABLE separate. The experiments in this section remain SKIP until their reports exist; the referenced historical results keep their narrower scopes.

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

The `2fe9c20c` run passed its four Windows boundary controls and the local chat review, applied the preserved COMMITTING choice, and consumed two genuine Native responses. The operator then chose `request_diagnosis` for the differing objective formulations. Its accepted receipt survives cold reopening. The following public preview refused `STANDARD_OBJECTIVE_ALIGNMENT_NOT_CONFIRMED`: the fresh-cycle graph tried to finalize that choice. No further Native response, finalization or product write followed. [Candidate evidence](native-committing-2fe9c20c.json) preserves this first failure. [Product PR #205](https://github.com/leuzeus/aidn/pull/205) merged the bounded diagnosis loop after its FILES regression and all ten CI families passed. The successor `6b6437c4` (catalog 429) is installed from archive SHA-256 `8b24ebdcf497f65aff765099c65b09b20802c3b9ec6162432f5f5fede4f09957`. Its hooks and four Windows boundary controls passed. The operator accepted the validator review in the chat; the qualified profile is linked to the frozen configuration. S001 applied the preserved COMMITTING choice with one receipt and no manual signing. A fresh process recovered that receipt using the candidate runtime: the older installed connector reader rejected the enlarged model, so the local composition now reads process instances with the frozen candidate kernel while retaining the pinned connector’s authority verification. A broader import composition lacked the connector’s envelope-verification method and was narrowed before valid diagnosis submission. This is not installed-connector qualification. The explicit continuation request has now supplied `request_diagnosis` on the successor’s current evaluation. One accepted receipt survives cold reopening; a tampered alignment choice is refused. The next public action is a new Native turn, with no intervening cycle finalizer. Three genuine responses closed with zero active processes. The additional diagnosis produced a distinct second-iteration evaluation and a new human alignment subject; no cycle finalizer ran between the diagnosis request and that evaluation. The operator confirmed alignment on that new report in the chat. Its single receipt survives cold reopening; the finalizer consumes the second evaluation and the physical checkpoint produces one matching event and the workflow index. No duplicate completion question appeared before the fourth Native activity. That initial prework proposal and intent/architecture assessment failed with `PROCESS_SESSION_ANSWER_INVALID`. Its two responses bring the campaign to five responses; Windows confirms zero remaining processes and product bytes are unchanged. The ephemeral rejected answer was not retained, so its precise cause is unclassified. A synthetic counterexample separately establishes that the strict transport projection accepts text forbidden by the full host schema; it does not recover the real answer. A targeted correction will communicate the full bound constraints and retain bounded refusal evidence without weakening validation or retrying the failed occurrence. The post-failure public preview remains fenced with `NATIVE_OWNER_DISPOSITION_UNPROVEN_EFFECTS`. The nominal on this candidate is FAIL; the installed nominal remains SKIP. [Successor evidence](native-committing-6b6437c4.json). No new human decision is pending on the failed candidate.

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

Both pilots used FILES. The installed `runtime db-status` found no SQLite index in either pilot. After the repair, `runtime artifact-store list --view agent` returned complete file inventories with identical cycle brief hashes. The two cycle objectives matched. At the earlier refusal, the active session in the second checkout had no active cycle. The open cycle records still lived in the first pilot's working tree, outside the inherited Git commit.

Both checkouts pointed to the same pilot repository. Each preparation script explicitly requested `S001`. The installed runtimes reported different `project_id` values, both derived from the local Git directory (`legacy-git-common-dir`). The second run started on a base commit with no session record. Its clone had inherited a separate branch containing the first run's `sessions/S001.md`. The second run committed a different record at that same path on its own session branch. These were two fresh runs of the scenario. Continuity of one session across checkouts remains untested. [Project identity resolution](../../../src/application/runtime/workspace-resolution-service.mjs) · [Canonical session inventory](../../../src/application/runtime/standard-workflow-artifacts.mjs)

Use the configured source for the lookup. FILES with SQLite indexing reads the project files. Canonical SQLite and PostgreSQL require a read in the configured database scope. Resolve the active session in that project first. For direct resumption, verify that the cycle names the active session in `session_owner` and that the session lists the cycle in `attached_cycles`. Compare objectives after verifying that attachment. [Cycle-entry admission](../../../src/application/runtime/standard-cycle-entry-admission.mjs)

| Observed at entry | Expected public behavior to qualify |
| --- | --- |
| The branch name is taken | In a read-only preview, show the requested cycle and objective, the conflicting local branch and tip, the intended base, and what AIDN found in the configured project's canonical cycle inventory. Distinguish a complete lookup with no record from an unavailable or incomplete lookup. |
| Same objective, cycle attached to the active session and resumable | Verify the branch, lifecycle state and point of resumption. Use the existing resume path, with a single in-session choice if needed. Verify the same session and cycle IDs and zero additional cycle or branch creations. |
| Same objective, cycle owned by another session | Identify its owning session and refuse direct resumption in the active session. Preserve the attachment. A cycle explicitly reported from a previous session follows the existing carryover decision. [Reported-cycle decisions](../../../src/core/workflow/standard-cycle-entry-choice-record.mjs) |
| A different objective is established and a new cycle is wanted | Offer the next available cycle ID and branch with the active session as owner. Obtain acceptance of that specific creation plan and recheck the session and availability before writing. Preserve the existing cycle and its history. |
| Only a Git reference exists, ownership or objective is uncertain, or the cycle cannot be resumed | Explain which evidence is missing or which admission failed. Offer recovery or deferral. Keep the existing reference intact and require fresh admission for any later creation. |

Lot 2a retains the original refusal and the manual repair. Lot 3 checks that a retry after an interrupted creation reconciles the same occurrence. Lot 5 checks the PostgreSQL lookup with a stale local projection. Lot 7 verifies the resume, new-cycle and unresolved choices above. These product scenarios remain open.

For lot 2a, verify that both checkouts resolve the same stable `project_id` and `runtime_scope_id` on the isolated PostgreSQL database. After cycle creation, read the authoritative records independently. Both checkouts must see the same session and the cycle attached to it. Record that observation alongside the full COMMITTING trace. [Runtime persistence and scope](../../MIGRATION_RUNTIME_PERSISTENCE_POSTGRESQL.md)

In lot 5, give the second checkout a stale local session file and request continuation there. Verify directly in the database that it recovered the original session, preserved the cycle's owner and created no duplicate. A request for a new session must use an unused ID in that history. Repeat the continuation with the database unavailable and with a different resolved project scope. Each case must report the cause before any write and create zero local replacement sessions.

## Retiring FILES across AIDN

Start the product work alongside PostgreSQL qualification in lot 2. The retirement applies to `runtime.stateMode=files`. SQLite remains a supported runtime backend for local projects, including the existing `dual` and `db-only` profiles. PostgreSQL is the primary qualification target for projects sharing sessions and cycles across checkouts. Keep the historical FILES campaign results and the fixtures needed to migrate existing installations.

1. Deliver and qualify the migration from an existing FILES project to SQLite for local use or PostgreSQL for shared use. Preview the import, surface conflicting records and verify the applied result after restart. Compare the session and cycle IDs, ownership links and history against the source. A retry must preserve what was already imported. [Installation and import profiles](../../INSTALL.md) · [SQLite to PostgreSQL migration](../../MIGRATION_RUNTIME_PERSISTENCE_POSTGRESQL.md)
2. Once that migration is available, remove FILES as a supported runtime state mode throughout AIDN. Align installation, configuration and environment selectors, CLI, runtime defaults and fallbacks, contracts, documentation and active tests. A legacy FILES installation must receive migration guidance before a workflow writes state. Verify this through the public entry points and the installed package. [Installation profiles](../../INSTALL.md) · [Current runtime state selection](../../../src/application/runtime/standard-workflow-artifacts.mjs)

Keep an installed SQLite regression for fresh installations and upgrades with PostgreSQL unconfigured. Open a session and cycle, restart the client and verify their IDs and ownership in SQLite. Exercise the existing projection contracts for both SQLite profiles.
