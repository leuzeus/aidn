# StockFlow: what the benchmarks show about AIDN 0.19.0

Report consolidated on 1 November 2026. It covers the PostgreSQL backend,
functional UI, identity design and brand application. StockFlow is a fictional
multi-site, multi-tenant inventory application. All displayed data is demo data.

AIDN 0.19.0 is beginning to show its value on work beyond a small coding exercise.
Using a temporary installation, its opt-in agentic engine ran compatible
activities in the same context, followed by review in an independent context.
The resulting applications pass the common functional checks. The user has
also confirmed that human review was performed and approved at every stage.
In the retained UI executions, AIDN consumed fewer tokens than the runs without
AIDN.

The results are encouraging, with a counterexample to keep in view: the backend
consumed 9.7% more tokens with AIDN. The campaigns include stops and separately
authorized completion runs. They demonstrate a usable execution profile and
early signs of efficiency, without establishing a general productivity gain.

## How to read the results

The [measurement data](mesures.json) contains the counters and clocks used here.
The [source index](sources.json) identifies the original receipts by their
SHA-256 hashes. The operator retains these archives; raw logs, execution
identities and private paths are not published. The repository provides
extracts, not a self-contained package for replaying the experiments.

Both arms use `gpt-6.1-sol` with `high` effort. Arm A uses AIDN 0.19.0, its opt-in
agentic engine and PostgreSQL for governance. Arm B uses an external launcher,
with no AIDN client or workflow activated in its project. Both StockFlow
applications use PostgreSQL. Each stage starts from its prescribed baseline;
later stages receive the frozen deliverables intended for them.

The common launcher also imposes controls on B: author-context reuse for
compatible activities, separate review and common acceptance oracles. The
comparison therefore evaluates AIDN against a setup without AIDN that already
has these controls. It does not measure independent review against no review.

None of these comparisons establishes identical initial provider and cache
states. The trials are neither repeated nor counterbalanced. Their differences
remain descriptive, even where the brief and checks are shared.

The labels have specific meanings: OBSERVED means data retained in a receipt;
CALCULATED means an operation on that data; HYPOTHESIS means an explanation that
still needs evidence; NOT MEASURED means missing data; REFUTED means an
interpretation contradicted by a check. An automatic verdict and a human choice
remain separate results.

### Human approval confirmed by the user

On 1 November 2026, the user confirmed that human checks had been performed at
each stage and that the results were approved. This covers the retained backend,
UI, identity-design and brand-application results in this report. The
[confirmation record](human-validation.json) preserves the user's statement
verbatim, with an English translation.

The report therefore records these stage results as human-approved. The sealed
automated receipts still contain the human-review flags recorded when they were
produced, including `NOT_RUN` and a pending-selection status. Those historical
values are retained as source-snapshot fields in the measurement data, alongside
the user-confirmed approval. The confirmation date does not replace the dates
of the reviews themselves. Human approval does not change recorded technical
stops, budget deviations or the limits of the performance comparison.

## Overview

The tokens in this table include the stages needed for the retained result,
including B's completion runs in the backend and UI rows. Earlier interrupted
attempts are accounted for separately below.

| Stage | AIDN: observed tokens | Without AIDN: observed tokens | Responses A / B | Final technical result |
| --- | ---: | ---: | ---: | --- |
| PostgreSQL backend | 1 145 213 | 1 043 655 | 23 / 27 | 28/28 checks and accepted review in each arm |
| Functional UI | 891 139 | 1 071 949 | 19 / 27 | 20/20 checks and accepted review in each arm |
| C1: identity design | 1 161 092 | 1 106 049 | 24 / 33 | 8/8 checks and accepted review in each arm |
| C2: brand application | 1 470 339 | 2 056 833 | 24 / 26 | 20/20 functional, 8/8 identity checks and accepted review in each arm |

For C1, A describes the completed recovery run; B includes several review
recovery runs. For C2, A received its remaining brand checks in a later local
verification without a model, on unchanged files. These differences prevent
reading the table as four fully controlled A/B experiments.

### Durations and their measurement boundaries

| Stage | AIDN | Without AIDN | Correct interpretation |
| --- | --- | --- | --- |
| Backend | 17 min 52.613 s workflow; 16 min 36.338 s native execution | 17 min 32.144 s reconstructed native execution; 34 min 02.954 s through completion-run closure | B's native-stage sum is not a continuous workflow. Waiting time does not become an AIDN gain. |
| UI | 11 min 57.685 s workflow; 10 min 49.497 s native execution | 17 min 07.452 s initially, then 2 min 11.751 s for the completion run | 19 min 19.203 s is a reconstruction of active time; B's calendar duration reaches 68 min 17.242 s. |
| C1 | 15 min 17.283 s for the completed recovery run | 22 min 48.804 s cumulatively | Recovery runs and budgets differ. The interrupted A attempt precedes the reported A duration. |
| C2 | 12 min 50.616 s native author and review | 15 min 13.792 s native author and review | These clocks exclude oracles and preparation. They are the durations compared below. |

## 1. Backend: a functional result with higher token consumption

The task requires a transactional multi-tenant API: inventory, orders,
reservations, idempotency, CSV import, events and reconciliation. The common
oracle checks 28 obligations. Both implementations satisfy them and receive
accepted source reviews.

The token breakdown shows where the effort went:

| Activity | AIDN | Without AIDN |
| --- | ---: | ---: |
| Analysis | 32 222 | 14 603 |
| Implementation, increment on the same author context | 903 801 | 819 349 |
| Independent review | 209 190 | 209 703 |
| Total | 1 145 213 | 1 043 655 |

CALCULATED: AIDN consumes 101 558 more tokens here, or 9.7%. Its uncached input
is lower, 93 604 versus 110 628, but this observation is insufficient to calculate
a bill. No provider price or financial amount was measured.

The initial cohort stopped on `UNDECLARED_PRODUCT_DIRECTORY`. Node had created
a compilation cache inside the product. B's review and oracle were then
completed under a separate authorization, on the ten unchanged files, without
recoding. This completion run adds 209 703 tokens and seven responses, already
included in column B.

The 42 generated tests with AIDN and 104 without AIDN describe the delivered
test suites. Their counts do not rank quality. The oracle's 151 requests per
arm exercise functional scenarios, including errors and concurrency; their
latencies do not qualify production throughput or load performance.

Primary source: `backend` in the [index](sources.json).

## 2. UI: fewer tokens, with review friction to account for separately

Both interfaces expose the same functions: tenant switching, inventory, orders,
imports, events and reconciliation. They pass 20/20 common checks. Their
independent reviews are ultimately accepted.

OBSERVED: AIDN uses 891 139 tokens, compared with 1 071 949 for B. CALCULATED:
the difference is 16.9% in favor of the retained AIDN execution. However, B
includes 81 255 tokens of identified friction: 48 652 for a review blocked by
file access and 32 603 to qualify that access. Generation and the eventually
accepted review account for the remaining 990 694 tokens. Against that
partition, the descriptive difference is 10.0%. Both views are retained.

B's completion run reads all nine files, then delivers its verdict without
modifying the product. Its nine responses and 313 763 tokens are included in
B's total; the access check and verdict share one new reviewer context. They
are not added a second time.

The initial `QUALITY_FAIL` status concealed an incomplete review caused by denied
access. That status did not establish a poor interface. The consolidation also
retains a deviation from the original stop rule; authorization for the
completion run does not retroactively validate that deviation. Waiting time and
launcher corrections remain part of the campaign record.

Primary source: `ui` in the [index](sources.json).

## 3. C1: create directions, then leave the choice to the user

The brief targets multi-site businesses with a reliable, structured, premium
identity. Each arm creates two directions: strategy, symbols and SVG variants,
colors, typography, guides and HTML/CSS boards. The reviewer must access all
twenty files before issuing a quality verdict.

Both kits pass 8/8 checks and their technical reviews. The user then selects
Relais for AIDN and Cadence for the arm without AIDN. This H1 approval chooses
a direction to apply. It neither names an aesthetic winner nor accepts the
interfaces that will follow.

The completed AIDN recovery run consumes 1 161 092 tokens in 24 responses. An
earlier A attempt retains 65 273 observed tokens, with unknown additional
consumption and a missing worker summary. A's observed lower bound is therefore
1 226 365 tokens. B accumulates 1 106 049 tokens and 33 responses across several
review recovery runs. Unequal budgets prevent an efficiency comparison under
equal conditions.

Two further limits remain in the record: B exceeded its initial twenty-minute
cap by 35.246 seconds before the later amendment; the bytes of the first
governance export were lost during recovery. The pinned replacement export
does not restore that original. The design files, final review and captures
remain verified.

Primary source: `c1` in the [index](sources.json).

## 4. C2: apply the identities while preserving functionality

This stage takes each frozen interface and applies the chosen identity.
AIDN receives Relais; B receives Cadence. The checks must retain the twenty
functional obligations and verify eight identity obligations.

The first brand oracle did not recognize an approved logo variant. It rejected
A and caused B to stop. REFUTED: this rejection did not establish that A's
product lacked a logo. The correction extended the selector to variants already
covered by the contract, without lowering the requirements. A later local check
on A's sixteen unchanged files establishes 20/20 functional and 8/8 brand checks.
It takes 95.925 seconds, including preparation and checks, without another A
model call.

B was then recoded from its original UI baseline under a new authorization.
It also passes 20/20 and 8/8, with an independent review that read all sixteen
files. Its earlier interrupted coding run is retained separately.

### Results of the retained executions

| Measurement | AIDN / Relais | Without AIDN / Cadence |
| --- | ---: | ---: |
| Input | 1 449 703 | 2 018 475 |
| Of which cached input | 1 312 640 | 1 823 488 |
| Uncached input, calculated | 137 063 | 194 987 |
| Output | 20 636 | 38 358 |
| Total | 1 470 339 | 2 056 833 |
| Responses | 24 | 26 |
| Native author and review | 770 616 ms | 913 792 ms |
| Functional / identity | 20/20 and 8/8 | 20/20 and 8/8 |
| Independent review | Accepted | Accepted |
| Human approval, confirmed by the user | Approved | Approved |

CALCULATED: A uses 586 494 fewer tokens, or 28.5%, and its native author-review
time is lower by 143.176 seconds, or 15.7%. These are the most favorable signals
in this campaign. A's initial workflow takes 13 min 59.648 s, versus
15 min 29.672 s for B; since A's brand verification happened later, this
workflow difference is not a complete time-to-acceptance gain.

The limits are concrete: the UI baselines contain 57 696 and 101 004 bytes,
respectively; the identities differ; identical initial provider and cache
states are not established. The results therefore show a difference between
these executions without isolating a causal effect of the engine or context
reuse. B also benefits from that reuse.

The two retained executions total 3 527 172 tokens. Including the 759 928
observed tokens from the earlier interrupted B run brings the count to
4 287 100. This retained lower bound is not the complete cost: B's in-flight
consumption, interactive CLI activity and preparation-chat consumption remain
unknown or unmeasured.

### The resulting interfaces

AIDN, Relais direction:

![StockFlow interface produced with AIDN and the Relais identity](aidn-relais.png)

Without AIDN, Cadence direction:

![StockFlow interface produced without AIDN and with the Cadence identity](plain-cadence.png)

These captures come from the oracles, without retouching. They illustrate the
deliverables at different times and with different data states. Human approval
is confirmed by the user; automatic scores remain separate from that review.

Sources: `c2`, `c2_original`, `c2_correction`, `c2_retained_a` and `c2_seal`
in the [index](sources.json).

## Stops and costs retained in the record

| Attempt or stage | Retained result | Consumption or limit to retain |
| --- | --- | --- |
| Initial backend preparation | Path defect before native benchmarking | No benchmark model call started; chat cost unmeasured |
| First opt-in backend cohort | `PROCESS_ACTIVITY_FAILED`; the model reports `GLOBAL_RUNTIME_ACCESS_DENIED` | 86 763 tokens and three responses; possible in-flight consumption unknown; precise cause not independently established |
| Backend completed through a separate run | Initial `UNDECLARED_PRODUCT_DIRECTORY` stop, then separately authorized B review/oracle | The completion run's 209 703 tokens are included in B; no recoding |
| First UI cohort | `HUMAN_ACK_CHANGED`, before model trials | 11 min 06.393 s of preparation and waiting; no benchmark model trial |
| UI: B review | Access denied, then access and review qualified separately | 81 255 tokens of identified friction, included in B; original stop-rule deviation retained |
| Initial C1 preflight | `FINAL_PREFLIGHT_REFERENCE_ERROR` | 35 min 34.206 s before trial preparation; chat cost unmeasured |
| C1: recovery runs | B review delayed, A interrupted by the storage threshold, then authorized completion runs | 65 273 additional known A tokens, remaining consumption unknown; B's initial overrun of 35.246 s |
| First C2 cohort | `HUMAN_ACK_CHANGED`, before trials | No author/reviewer trial; interactive approval is not a consumption measurement |
| C2: initial oracle | Incorrect rejection of a logo variant; cohort closed | 759 928 observed B tokens, final response count and in-flight consumption unknown; no silent replacement |
| C2: A verification and new B coding | Unchanged A rechecked without a model; new B completed | A's 95.925 s check remains separate; B is a new cohort, not a repair of the first result |

Some incidents originate in the test harness: paths, receipts, reviewer access,
collection and the oracle. These corrections improve measurement; they do not
all represent progress in the AIDN product. Where the cause is not established,
the report retains the unknown rather than blaming the product or model.

Global time includes installation, human waiting and closure according to each
authorization. The later removal of the global storage quota does not erase
earlier stops. For C1, cumulative accounted bytes included temporary PostgreSQL
clusters that had already been removed, so they differed from the space still
occupied on disk.

The new C2 B run finishes its workflow in 15 min 29.672 s, within its cap of
25 minutes and 60 responses. Its 26 responses remain below that cap. The final
seal, including reporting, is produced at 29 min 46.608 s, within the authorized
40 minutes. Validation resources are closed. The demo servers opened at the
user's request serve a separate purpose.

## Progress in the current version

### An agentic process that executes and enforces its controls

Version 0.19.0 introduces an explicit model of activities, roles and gateways.
In the native cases covered here, analysis and implementation share an author
context, then review uses a fresh read-only context. Execution identity, rights
and role remain distinct. This separation is now observed behavior in the
tested profile.

The practical value is to embed these rules in the project's runtime. The arm
without AIDN must receive equivalent rules from the external launcher. The time
needed to develop and maintain that launcher has not been measured as an AIDN
gain.

### Broader coverage than the initial reservation service

The [prerequisite qualification](../../agentic-process/v0.19.0.md) covered a
Node/SQLite service with PostgreSQL for governance. StockFlow adds a
transactional PostgreSQL API, a UI, identities and their application. AIDN is
installed in a temporary environment and used there. The opt-in profile remains
explicit; the results do not automatically apply to the default installed
workflow.

The native evidence still covers one sequential participant with separate
author and reviewer contexts. It does not qualify every gateway, distributed
concurrency or adversarial confinement of the complete client. Fresh-context
and restricted-tool guarantees do not establish complete operating-system
isolation.

### Early efficiency signals in UI work

The UI and C2 stages show favorable token results for the retained executions.
C2 also has a shorter native author-review duration. Common functional quality
remains at the expected level in both arms. That makes the profile relevant to
work that needs a separate review while letting the author perform several
activities in sequence.

The backend's higher token consumption and C1 recovery runs prevent extending
this finding to every project. The explanation that AIDN saves through reuse
remains a HYPOTHESIS: B's launcher also reuses its author. Differences in initial
code, design and context may contribute to the gaps.

## Historical references and scope of the conclusion

Earlier cases remain available in the [20 October reports](../README.md) and the
[0.19.0 release qualification](../../agentic-process/v0.19.0.md). Comparisons
034/036, which predate the current agentic engine, showed substantially worse
durations and token consumption with AIDN. Attempt 035 was incomplete. These
cases are retained and do not become comparable to StockFlow: tasks, candidate
versions, applications and contexts differ.

Revision 006 reached implementation, then failed before effective review:
734 967 observed tokens, without workflow validation. Revision 010 then
completed the reservation case, oracle 20/20, with 779 103 tokens, twenty
responses and 947.723 seconds through oracle closure. The subsequent release
candidate retained a `STORAGE_UNVERIFIABLE` stop, then completed a trial at
857 482 tokens and 22 responses. These observations document progress in
qualification; they do not form a cross-version performance curve.

Earlier investigations into capture, cache or tool-result representation remain
closed in their own records. They are neither resumed nor counted as StockFlow
benchmarks. This consolidation gives no earlier A/B comparison causal validity.

At this stage, AIDN 0.19.0 has demonstrated that it can take this agentic work
profile through to verified deliverables, with controlled reuse and separate
review. The user has also confirmed human approval at each stage. That is the
established progress. The UI stages provide a measured
reason to continue using it within this scope. General superiority in quality,
overall time savings and financial savings remain NOT MEASURED or unvalidated.

This publication consolidates existing evidence. It launches no new trial or
installation.
