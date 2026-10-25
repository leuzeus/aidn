# Runtime performance campaign â€” 2026-10-24

## Current execution scope (2026-10-25)

The owner requires all project clients and experimental work to remain on the
original non-system volume. System-volume workarounds are excluded. Previously
created temporary system-volume clients are retired diagnostic evidence only;
the request to review their hooks is withdrawn. Their bytes have verified
recoverable archives on the permitted evidence volume. Automatic cleanup was
rejected by policy, so the original copies remain inert; the personal Codex
profile was neither moved nor removed.

The current native application campaign has **no valid comparative samples**.
The smallest non-system-volume reproduction now fails native physical-path
resolution with both the official `:workspace` profile and a custom profile,
on the same binary, cwd and Node executable. Replaying the historical inherited
environment pattern also fails. These are separate OS-only executions with no
AIDN, model, main-profile launch, setup or login. JavaScript realpath, lstat and
read/write/remove pass; `fs.realpathSync.native` returns EPERM under MXC while
the host call succeeds. All retained owned process trees close with zero
descendants and the main configuration stays unchanged. This excludes the custom AIDN
profile and its closed host-variable list as sufficient explanations; it does
not identify a repaired client version or justify removing physical identity.
An explicit selected workspace-roots mapping, relocating identical executable
bytes to the permitted volume, and an official older-client comparison also
fail the same native operation. The older public executable carries the
historical version label but differs from the archived application binary;
this is not a bit-for-bit historical replay.

Source/native preparation measurements below remain valid within their stated
scope. No system-volume diagnostic, stopped application attempt or microbenchmark
is a successful end-to-end task measurement. Public native worker/rollover
promotion and a default-startup replacement remain unqualified.

## Baseline and scope

Source: `origin/dev` at `04753926d342a72af58d415e605aec532cd84d3a`, version
0.16.0. Dedicated implementation branch: `perf/runtime-context-transactions`.
Existing untracked directories were preserved. This is package-source work,
not a change to a personal installed client.

Historical [034](../qualification/benchmarks/2026-10-20-034.md) and
[036](../qualification/benchmarks/2026-10-20-036.md) are retained independent
native pairs on earlier candidates. In 036, 119 model responses, 13,533,955
cumulative input tokens (13,183,104 cached), 350,851 uncached input tokens and
1,691.904 seconds accompany a 20/20 application oracle. The paired baseline
has 24 responses and 405.902 seconds. Both report zero actual `new_context`
calls. Two conversations establish continuation, not native context replacement.
These historical results are not a current-candidate baseline or causal proof.

The retained local campaign directories contain `prepare-benchmark.mjs`,
`run-benchmark.mjs`, `native-phase.mjs`, the fixed `BRIEF.md`, `oracle.mjs`,
provider events and cost analysis. Their old frozen candidates and exception
controls must not be replayed as current qualification.

## Reproducible source baseline

Run `node tools/perf/measure-workflow-preparation.mjs --samples 3 --out <new-absolute-file>`.
It builds a fresh activated tracked fixture, explicitly indexes its canonical
state and installs an accepted synthetic one-unit task policy. It rotates three
variants on unchanged inputs and asserts every admission and coordinator
recommendation matches. Setup and cleanup are outside measured CLI clocks.
Raw samples are in [the baseline](../qualification/runtime-performance/baseline.json).

| Variant | p50 ms | p95 ms | Complete JSON bytes | Hydrations |
| --- | ---: | ---: | ---: | ---: |
| Historical agent view | 1312.5 | 1314.8 | 71908 | 2 |
| Grouped compact.v2 | 2882.0 | 2915.0 | 40458 | 1 |
| Grouped compact.v2 with scoped policy | 2840.5 | 2961.6 | 9882 | 1 |

These are source-fixture observations, not native token or end-to-end gains.
With three trials, p95 is the maximum observed sample. CLI clocks include
startup, configuration, canonical reads, parsing, projection and revision
fences. A scoped projection reduces bytes by 86.3% here but does not establish
faster task completion. Actual model responses, provider tokens, internal
residency, DB transaction/round-trip counts and application quality are unknown
in this microbenchmark and explicitly null in its report.

## Confirmed code paths and priorities

1. `tools/codex/workflow-step.mjs:computeWorkflowStep` already composes admission,
   hydration and coordinator advice. The legacy route hydrates once per skill;
   grouped consultation hydrates once after admissions and global-stop checks.
2. `workflow-observation-service.mjs` already shares canonical reads within an
   invocation, clones consumer snapshots and rereads sources before publication.
   Preserve those fences and sequential admissions; naive parallel admission is
   not justified.
3. `task-context-profile.mjs:buildTaskContextRequest` currently permits managed
   skills with missing accepted policies to fall back to full hydration. The
   workflow even raises selection limits to 256 KiB/1 MiB. Remove this implicit
   expansion in the bounded path; retain explicit full diagnostics.
4. Compact profiles, token budgets, targeted artifact consultations and history
   transitions are independent opt-ins. Compose them as a single bounded
   preparation entry point using the existing public versioned output.
5. Working-memory capsules already verify scope, evidence, versions and canonical
   revisions. Native lifecycle dispatch is qualification-gated. Verify host
   capabilities before adding continuation; never equate a resume/fork with a
   fresh window.
6. Artifact queries rebuild Markdown and repeatedly inspect fields. Measure
   repeated parsing before adding an invocation-local cache. No persistent cache,
   schema migration, pooling change or CI coverage reduction is assumed useful.

## Delivery plan and evidence boundaries

Lot 0 records this baseline before runtime edits. Lot 1 removes implicit managed
policy fallback and keeps exact final JSON budget checks. Lot 2 composes one
transaction-style preparation with compact defaults and current admissions.
Lot 3 reuses the capsule and implements only supported continuation. Lot 4
retains measured, bounded read/parse optimizations. Lot 5 runs selected contract,
effect, runtime, security and integration gates and records before/after trials.

No preparation output authorizes a write. Every action still requires its
prescribed fresh admission, scope, revision, CAS and execution fence. Full
diagnostics remain available through explicit full views or `--write` receipts;
receipts are never injected automatically. Missing mandatory context blocks
preparation and supplies remediation rather than truncating authority.

Native paired task measurements, installed-package qualification and live
PostgreSQL isolation are separate evidence obligations. Unexecuted measurements
will be reported separately from PASS. No numerical engineering target is
claimed achieved by the baseline.

## Lot 1 â€” bounded policy refusal

Managed and unknown skills with absent/uncovered task policies now return
`selection_policy.mode: blocked` with explicit remediation, zero hydration and
no implicit full selection. The 256 KiB/1 MiB override is removed. Explicit
legacy/full diagnostics remain available without the bounded profile. Public
agent schemas add the optional `remediation` string; existing fields and full
defaults are unchanged. ADR-0021 records the amendment.

`node tools/perf/verify-task-context-profile-fixtures.mjs`: PASS, 19 fixture/source
CLI groups, including missing-policy/multi-skill refusal, final UTF-8 byte
accounting, dependency completeness, stale/foreign baseline invalidation and
explicit diagnostic receipts. The first run exposed a closed-schema rejection
of the added remediation field; the schema was aligned and the full focused
suite then passed. No native timing/token improvement is attributed to this fix.

## Lot 2 â€” one bounded preparation

`workflow-step --transaction` composes the existing grouped observation,
compact.v2, accepted token-efficiency policy and transition history. Defaults
are 16 KiB/64 KiB; conflicting full selectors refuse. It returns current
admissions, required units, blockers and coordinator advice in one invocation,
with an additive `workflow-transaction.v1` preparation descriptor inside the
existing compact.v2 output. Failure exits nonzero. There is no write transaction
or reusable admission. Legacy full interfaces remain unchanged. The bounded
experimental procedure now names this entry point; installed personal skills
are not silently changed.

`node tools/perf/verify-workflow-transaction-fixtures.mjs`: PASS. Four real-source
CLI variants preserve every admission and coordinator recommendation. Preset
conflicts, effect classes, exact final budget, null implicit receipt, unchanged
cache, missing-policy zero hydration and over-limit refusal are verified.
Single-trial transaction output was 10,264 bytes, one hydration and two distinct
canonical observation keys. Its 3,265 ms clock does not establish a speed gain;
the value is bounded preparation and fewer required client consultations.
Actual model-turn reduction still requires a native paired task.

## Lot 3 â€” supported continuation and actual native limits

The existing versioned working-memory capsule already binds project/worktree,
checkout and canonical revisions, objective, decisions, next step, typed TODO,
test claims and exact evidence references. Existing resume rejects stale,
corrupt, incompatible or changed evidence instead of replaying a transcript.
The lifecycle service now offers explicit `prepareContinuation({write:true})`:
ordinary admitted capture followed by fresh read-only resume, with no native
window request. Its result requires fresh admission and explicitly reports
`native_rollover: false`. It cannot clear host history. No installed trust,
configuration or production native qualification changes.

`node tools/perf/verify-context-lifecycle-fixtures.mjs`: PASS, 20 lifecycle
scenarios plus the existing local/research fixture controls. Missing ports,
stale/invalid capsules, capture intent, unknown/expired qualifications and lost
native acknowledgements remain fail-closed.

Host inspection and isolated native experiments on 2026-10-24:

- The npm CLI 0.125.0 could generate app-server schemas including
  `thread/start` and `thread/compact/start`, but refused the configured
  `service_tier: default` before model execution. This failure is retained.
- The running app binary is 0.164.0-alpha.11.1. The existing three-window ledger
  qualifier observed **two actual native new_context calls**. Both later rounds
  have ordered checkpoint/acknowledgement/restore/retrieval/submission evidence;
  all nine retained-answer cases eventually pass. The complete qualifier is
  **FAIL**: the first round did not request a new context, the second round
  lacked a required continuity detail, and final window number is two instead
  of three. No retry or weakened criterion converts it to PASS. The capability
  registry remains unqualified; a real native operation being available is not
  reliable autonomous lifecycle qualification.
- The separate existing native full/delta selection probe is **PASS** for its
  small synthetic consumption oracle. It does not qualify this transaction's
  end-to-end task performance or production rollover.
- All three isolated probes stopped their app-server process, removed temporary
  credential copies and verified the original config/auth bytes unchanged.

Reproduction uses the existing manual qualifiers with `--execute --binary
<actual-app-binary> --codex-home <existing-home> --output <new-external-dir>`;
add `--only-ledger` for `qualify-context-native.mjs`. Retained reports are
local-only because native evidence includes account and machine details.
See the [official app-server documentation](https://developers.openai.com/codex/app-server/)
for supported thread and compaction methods; schema inspection alone never
establishes a fresh-window lifecycle or model qualification.

## Lot 4 â€” measured parsing and existing shared snapshots

Field extraction previously invoked `analyzeStructuredArtifact` and stripped
fenced examples again for every requested field of the same source. A map local
to one synchronous `selectArtifactQuery` now reuses normalized fence-filtered
text by source path, verified content SHA and extractor kind. Backend/scope and
source revision remain owned by that invocation; a later invocation starts
empty. Complete source hash/contract/canonical verification still runs before
extraction. No persistent cache or stale canonical JSON shortcut was added.

Five warmed batches of forty complete active-state.v2 selections on the same
four-source corpus: p50 **7.545 ms before / 4.810 ms after** (-36.2%); observed
p95 **7.835 / 5.418 ms**. Input is 45,195 JSON bytes and output is 4,939 bytes in
both cases. The output is checked for exact determinism at every iteration.
`verify-artifact-query-fixtures.mjs`: PASS, 90 checks, including real SQLite
dual/db-only and injected PostgreSQL. These are CPU microbenchmark gains only.

The common snapshot/read sharing requested by the mission already exists in
`workflow-observation-service.mjs` and `runtime-snapshot-service.mjs`. The retained
grouped source CLI suite is PASS (19 groups), including three modes, multi-skill
refusals, global stop, real concurrent SQLite revision change, changed ignored
local authority, foreign scopes and configured PostgreSQL outage with no fallback.
No naive Promise.all admission change was made. Reads are shared for preparation
only, then freshly fenced, and every later writer still re-admits independently.

Serialization stabilization, PostgreSQL pooling, CLI process pooling and CI
coverage reduction are not retained optimizations: the baseline supplies no
isolated evidence that changing them would safely improve task completion.
Existing exact-size accounting and all required qualification gates remain.

## Canonical continuation defect found by live qualification

The optional live smoke initially passed dual checkpoint/resume, then failed
db-only handoff with canonical backend unavailable. A bounded diagnostic on a
second isolated attempt showed `backend: sqlite`, `exists: false`: the generic
asynchronous DB-first continuity reader inherited the compatibility projection
default when the client omitted `localProjectionPolicy`. The configured
PostgreSQL backend had not failed; the wrong reader was selected.

The continuity helper now defaults its local projection preference to `none`,
which selects configured PostgreSQL. SQLite remains the backend when PostgreSQL
is not configured. Explicit compatibility diagnostics retain their separate
options; no outage fallback, migration or implicit synchronization was added.
The existing shared-backend suite now checks this omitted-preference case with
an injected PostgreSQL store and no local SQLite projection: PASS. The subsequent
real PostgreSQL smoke passes dual and db-only checkpoint/resume, canonical-change
rejection and verified cleanup of its own random scopes. The first two failures
remain retained and are not rewritten as product qualification PASS.

## Lot 5 â€” native preparation comparison

The final manual experiment freezes executable source at
`be59c824789bec1404ce55c42c1f84946913fabd`, with an empty tracked diff.
The current app binary is fingerprinted. Ten fresh native threads use the same
`gpt-6.1-sol`, high reasoning profile, default service tier, task, exact-field
oracle, canonical fixture and tool/output limits. Two trials per variant rotate
execution order. Actual CLI calls run inside the native task clock. No provider
fallback, trust override, nested agent, external app or native transcript edit
is permitted. Runtime source hashes are checked before every consultation.

Fixture/index setup and the rotating source CLI trials precede the native arms:
this is a warm preparation comparison. Authentication and `thread/start` are
outside the measured clock; `turn/start` through native turn completion,
including actual CLI consultations, is inside it. These boundaries differ from
the independent cold application budgets in 034/036.

[Redacted samples and counters](../qualification/runtime-performance/native-preparation.json)
retain unique completed-response observations, actual CLI and transmitted tool
JSON byte counts, hydration counts, timings, source/binary fingerprints and
cleanup. Native events remain local-only. Cached input is a subset of cumulative
input; uncached input is their difference. Counts are not billed standard-rate
tokens or unique document tokens.

| Native preparation variant | CLI consultations | Model responses per trial | Mean cumulative input | Mean uncached input | Mean seconds | Seconds range |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| Separate historical microsteps | 5 | 7 | 191091.5 | 39411.5 | 24.050 | 21.998â€“26.103 |
| Existing composed historical interface | 1 | 3 | 80832 | 33600 | 10.136 | 9.970â€“10.302 |
| Grouped compact.v2 | 1 | 3 | 64605 | 25437 | 12.026 | 11.598â€“12.455 |
| Grouped compact.v2 and scoped policy | 1 | 3 | 48872.5 | 17640.5 | 10.583 | 9.747â€“11.419 |
| Bounded transaction | 1 | 3 | 49048 | 17752 | 12.208 | 12.145â€“12.272 |

Every trial passes the same preparation extraction oracle: skill identities,
admission booleans, mode, coordinator action and absence of write authority.
The separate path actually invokes two pre-write admissions, two hydrations
and coordinator advice. The combined path retains the admissions and advice,
with one common hydration and a publication fence. It is not a mock admission.

Relative to separate microsteps, this bounded task observes 57.1% fewer model
responses, 74.3% less cumulative input, 55.0% less uncached input and 49.2% less
mean elapsed time. These are descriptive observations from two unblinded trials,
not statistical or whole-product causal estimates. Concurrent source
qualification load was not controlled; elapsed time includes model/service,
transport and CLI work. Exact raw CLI result bytes are 94,885 versus 10,264;
transmitted tool JSON, including wrapper/submission responses, is 95,580 versus
10,463. Internal provider body residency remains unavailable.

Relative to the already composed historical interface, responses stay at three,
cumulative input drops 39.3%, but mean time increases 20.4%. Compact/grouped
selection alone therefore does not prove a latency gain. The mechanism is the
reduction of separate consultations plus smaller resident results. This supports
the conversational-amplification mechanism on preparation, not a conclusion
that it is the dominant remaining cause across the entire 036 workflow.

A [separate earlier ten-trial campaign](../qualification/runtime-performance/native-preparation-replication.json)
at source `74236e75a2918b849a9c4e541424eb4067e0786a` observes the same
seven-versus-three response pattern: transaction mean 9.769 seconds versus
22.128 for microsteps and 8.976 for already composed historical preparation.
The later campaign includes the typed transaction argument-refusal correction.
These candidates are not pooled. With two samples per variant, p50 is the mean
of the pair and nearest-rank p95 is its maximum, not a stable tail estimate.

The full 034/036 application oracle, development, handoff, resumed execution,
cycle/session closure and cleanup were not requalified on this candidate.
The newer retained application reference is itself incomplete for continuity,
workflow closure and relay despite application success. Its historical
qualification and successful application score cannot be transferred to the
current client/package. No whole-development numerical target is claimed met.

### Remaining measurements and reproducible full-task protocol

- Internal model tokens, hidden provider residency, exact DB transaction and
  round-trip counts: unknown. No byte-to-token or billing estimate is substituted.
- Transaction plus production rollover: NOT EXECUTED. The exact native lifecycle
  qualification failed; its two observed later window calls do not authorize
  bypassing that qualification.
- Current installed-client full application A/B: ATTEMPTED, NO VALID SAMPLES.
  Later native attempts and the G-only physical-identity precondition failure
  are retained below and in the follow-up ledger. They do not provide a current
  comparative application oracle. Old prepared runners, temporary homes,
  databases, partial references and arms are never reused.
- Pack the exact candidate with a provenance manifest and archive SHA; install
  separate disposable clients and prepare independent empty PostgreSQL scopes.
  Bind the real mandatory authority units/dependencies through a genuinely
  accepted client policy. Missing mappings remain blocking; the small synthetic
  policy above cannot become production acceptance.
- Freeze one current binary, model/reasoning setting, brief, fixed independent
  application oracle, time/output constraints and initial state for all arms.
  Run separate, composed, compact/grouped and transaction arms with rotated order.
  Keep full native admission, actual edit, CAS, coordination, handoff/reprise,
  cycle/session closure and owned-process cleanup evidence. Count actual
  completed provider responses and union overlapping wall intervals.
- Reject incomplete application/workflow/closure proof even when application
  tests pass. Add transaction plus rollover only after the exact lifecycle
  qualification passes. Run multiple fresh pairs and report dispersion.

No extrapolated gain is reported. The best next impact/risk step is to qualify
adoption of the bounded preparation in complete installed procedures, eliminate
duplicate read preflights only when the same live evaluator is consumed, and
run that controlled full-task campaign. Removing a mandatory write guard,
accepting a synthetic policy on behalf of a client, weakening closure or
pretending a fork/resume is a new context are rejected approaches.

### Compatibility, risks and CI

Legacy full and agent interfaces remain available; the new transaction is an
explicit composition with compact defaults. The existing compact.v2 schema adds
its preparation descriptor, and three agent schemas accept optional policy
remediation. No canonical/shared schema migration, persistent cache, source of
truth change or automatic personal installation is introduced. ADR-0021 and
the runtime authority guide describe these boundaries.

An absent accepted managed policy now refuses in the bounded path by design.
A real required closure can exceed the 16 KiB target and then needs explicit
expansion/remediation, never silent 256 KiB/1 MiB selection or truncated success.
The common observation can be slower than legacy composed preparation because
its fresh revision fences are preserved. A current capsule grants no write
authority and explicit continuation alone cannot clear a host transcript.

Development uses focused behavioral/schema fixtures first. The ASSURED route
selects nine PR families, each once; the complete source campaign retains all
required gates. Installed/package reproducibility, real PostgreSQL smoke and
native experiments retain separate evidence labels. Expensive native application
benchmarks stay manual and outside PR admission; no mandatory CI coverage is
removed to make performance look better.

## Qualification outcome and targeted fixture audit

The first nine-family local run reports **56 PASS / 6 FAIL / 0 SKIP** across
62 gates (59 required, three optional). That run remains failed. Redacted result identities, durations
and replay references are retained in
[the qualification ledger](../qualification/runtime-performance/qualification.json).
A local family invocation is not the remote branch-protection Governance
Admission rollup and grants no merge authorization.

The six initial failures have distinct causes and separately retained replays:

- `contracts-surface-catalog`: the new CLI selector was absent from the generated
  catalog. The official generator added it; the exact gate replay passes.
- `codex-context-admission` and `codex-context-coordination`: warm tracked fixture
  directories contained ignored indexes/runtime observations left by earlier
  checks. Unfiltered filesystem copies imported those non-corpus files into new
  clients. Cold copies passed while equivalent warm copies failed. Existing
  tracked-file filters now bound branch audit, cycle-close admission, coordinator
  resume, orchestration and both dispatch fixtures. Warm direct cases and both
  complete gate scripts pass; no expected outcome or production admission changed.
- `runtime-agent-execution-postgres`: the initial run lacked its required portable
  binary prerequisite. A private-cluster replay then exposed a fixture clock race:
  releasing a blocker 5.5 seconds after request creation did not establish five
  seconds of actual canonical lock wait. The test now observes its own backend
  blocker before timing bounded success or timeout rejection. Production lock,
  statement and coordination deadlines are unchanged. The full real-PostgreSQL
  gate passes with no focused scenario selection, confirmed process termination
  and cleanup. Missing prerequisites and an insufficient contention stimulus do
  not establish a production lock-timeout defect.
- `release-reproducibility` and `cleanliness-worktree`: the source checkout had
  preexisting untracked local files. They were preserved. Qualification uses a
  separate clean worktree. The first detached cleanliness replay correctly refused
  missing detached provenance; a real named development branch passes all five
  cleanliness gates without fabricated remote refs or deleted local files.

This was a TARGETED attempt-outcome integrity audit using the existing governance
skill, not a change to acceptance criteria. Facts are the observed cold/warm
asymmetry, copied ignored runtime state and lock-wait timing. The inferred causes
were tested by controlled warm replays and observed contention. No lower lane,
exception, retry relabeling, relaxed deadline or omitted case was introduced.
PostgreSQL exposes the blocker relation through
[`pg_blocking_pids`](https://www.postgresql.org/docs/17/functions-info.html);
observing that relation prevents connection/setup latency from consuming the
intended lock stimulus. The generic GFD evidence validator is not applicable to
these local gate-runner records; this narrative does not turn them into its
versioned evidence format or a product verdict.

The retained tests cover full/compact decision parity, public JSON schemas,
read-only effects, exact UTF-8 budgets, stale/foreign scope/revision refusals,
shared snapshot fences, CAS-sensitive writes, canonical backend outage, real
PostgreSQL concurrency and package installation. Unchanged passing gates are
not rerun solely to erase the first failed campaign. Each relevant replay and
its source boundary remains explicit.

Final post-report checks at clean commit
`ebd6cf3e2d296d786007c4db5b0206b7998a1241`: documentation **3 PASS**, cleanliness
**5 PASS**, package reproducibility **1 PASS**, zero FAIL/SKIP. The last check
builds the exact tracked candidate twice and exercises its packaged CLI/HTTP
fixtures. It does not run native Codex or an external installed-client model
task. The ASSURED resolver also passes for all nine selected families. These
results precede this evidence-only addition; they do not silently qualify a
changed native archive. Remote PR/merge checks remain NOT EXECUTED.

## P2 diagnostic sampling

After structural changes, a separate V8 sampling run instruments three rotated
source trials per preparation variant plus refusal controls, with unchanged
source at `9aa43cfd3b583d10073a3c64aeac8db83294e138`.
[Redacted sample sites and profile hashes](../qualification/runtime-performance/cpu-profile.json)
keep launcher and workflow-process groups separate. The workflow group has
25,688 samples: synchronous child-process sites account for 52.0%, `lstat` for
20.1% and `existsSync` for 6.2%; module compilation also appears. The budget
finalizer is present in five inclusive samples and runtime project resolution
in eighteen. These are sampling sites, including blocking work, not exact CPU
or task-time attribution. Native serialization can be attributed to its caller,
so few named stringify samples do not establish zero serialization cost.

The initial launcher-only profile mostly observed its synchronous child wait;
it could not attribute the unprofiled child's work. The final run propagates
`--cpu-prof` through `NODE_OPTIONS` to actual workflow children. Do not sum parent
and child elapsed clocks. To reproduce, create a new external profile directory,
set `NODE_OPTIONS=--cpu-prof --cpu-prof-dir=<absolute-external-directory>` only
for the manual source benchmark process, run three samples with
`--include-transaction`, then restore the caller's environment. Profile outputs
contain local paths and stay outside Git. Group workflow profiles by observed
`tools/codex/workflow-step.mjs` frames rather than pooling launcher waits.

This files-mode diagnostic does not profile production PostgreSQL queries or
separate its network round trips. Live DB smoke and contention gates prove
behavior, not a pooling speedup. No isolated result justifies a new connection
pool, persistent runtime cache, weaker path verification or a rewrite of exact
budget stabilization. Those remain unimplemented hypotheses. A next controlled
experiment can isolate subprocess/path-verification cost while preserving the
existing revision and activation fences; the current samples are insufficient
to promise a gain from such a change.

## Exact native application prerequisite

A fresh 0.16.0 candidate was packed and installed from clean source
`9aa43cfd3b583d10073a3c64aeac8db83294e138`, archive SHA-256
`01c14eeea7cdcc2f51a9ab3b7f9ccb2a56009343c05deb0691a5b3a44d509257`.
The native preparation tool created a neutral repository, two separate activated
worktrees, exact root receipts, hook/handler hashes, an empty isolated home,
manifest, preservation baseline and human review sheet. It reports
`native_execution: NOT_RUN`, `human_trust: NOT_RECORDED`, zero model calls.
No user authentication or trust was copied by this preparation; no sandbox was
provisioned. Later report-only commits do not silently replace this reviewed
archive or transfer its identity to another package.

The current
[native qualification authority](../AGENT_EXECUTION_NATIVE_QUALIFICATION.md)
requires human review of the exact executable hooks through native `/hooks`
controls before dependent execution. Human approval was not yet recorded at
that initial preparation checkpoint.
Native edit/refusal,
termination, host coexistence, current PostgreSQL claims, accepted full task
policies and the full application A/B remain **NOT EXECUTED** until their actual
prerequisites are met. The source-preparation experiment above has a separate
read-only boundary and cannot substitute for them.

## Native follow-up after owner approval

The owner subsequently approved the exact hooks, the existing native profile's
bounded local effects, and then the already implemented v2 Codex-managed sandbox
maintenance boundary. Actual native API observation confirmed trusted/enabled
project hooks on the three reviewed roots. The package was reproduced unchanged
at SHA-256 `01c14eeea7cdcc2f51a9ab3b7f9ccb2a56009343c05deb0691a5b3a44d509257`.
No approval hashes, authentication copies or personal configuration were written
by the qualification tooling. Raw profile/account evidence remains local-only.

A real supervised-worker qualification ran on that candidate. The first native
patch was admitted but did not produce the authorized file effect. The two
out-of-scope patches and subsequent lost-ownership patch were refused. The
worker exited, its Windows Job confirmed zero remaining descendants, and its
private PostgreSQL cluster was removed. The attempt is FAIL with
`QUALIFICATION_AUTHORIZED_EFFECT_MISSING`; cancellation, timeout and later port
cases were not executed. Native Codex also updated its sandbox executable cache
and deny-read ACL state, so v1's exact setup preservation failed. The later v2
metadata preflight ran but refused worker execution with
`PROFILE_BACKEND_NOT_READY` and a legacy
`updateRequired` observation. Neither refusal is rewritten as PASS.

A TARGETED authority review corrected the evidence routing: the bounded-agent
protocol explicitly qualifies the supervised `elevated` worker milestone. The
034/036 runtime campaigns used ordinary native MXC sessions and have separate
candidate-specific hook/workflow evidence. Their benchmark does not enable the
public supervised-agent capability. Its controls still require human-reviewed
hooks, actual specific write admission, canonical scope/revision/CAS, strict
handoff and closure, native permissions and owned cleanup. Legacy-agent failure
cannot become MXC qualification, and OS readiness alone cannot become either.
No gate or public backend policy was weakened or changed by this distinction.

A discriminating MXC command probe found an independent source defect: the
bounded metadata and worker environments omitted Windows `SystemDrive`. The
native executable refused startup with `MXC requires nonempty Unicode host
SystemDrive`. Adding only that non-secret OS value to the otherwise unchanged
environment made explicit MXC startup pass, then permitted workspace
write/read/remove while refusing an outside write. The same probe using the
corrected source host-filter function also passes. All probe process trees
terminate and personal configuration hashes remain unchanged. These are
**OS-only** observations with zero model calls, not application performance.
The initial admitted patch failure's complete cause is not established by this
separate command test.

The source correction centralizes the non-secret host allowlist, preserves
`SystemDrive` in metadata/worker preparation and admits it in the exact final
shell filter. Private credentials, inherited native-home/temp selection and
unknown variables remain excluded; native profile bindings and all action
fences remain required. Focused results: startup 50 checks PASS, executor 69
fixtures PASS, native qualification fixture suite 395 checks PASS. Controlled
metadata bridge and validation-launcher fixtures also pass. The verifier child
environment remains narrower than the native launcher. These are
source/fixture checks; the old native attempt cannot qualify the corrected
archive. No architectural authority or backend migration is introduced.

[Redacted follow-up observations](../qualification/runtime-performance/native-followup.json)
retain the layer-specific results and source hashes. Full installed application
A/B and production native rollover remain NOT EXECUTED. The next native runtime
trial must freeze the corrected package and use fresh scope/workflow evidence
under the actual MXC surface, rather than transferring the historical pair or
enabling an unqualified public agent executor.

### Fresh installed MXC application integration attempts

The corrected source at `09043656e1295cae2ee2152ff7d9addcff6eb6c7`
was packed and independently installed. Archive SHA-256:
`6893c21c81a3e294173850d1ea38f34590c78205145f70e3cee4bc46f49ec8c0`.
The current source release family passes three gates, including reproducibility
(169,972 ms). The internal route remains ASSURED. External harness controls pass
291 tests, then 307 after adding the current transport regression cases. These
checks do not qualify the application.

Two fresh native integration pilots used the actual approved project hooks,
gpt-6.1-sol/high and explicit MXC. Both stopped on their first actual canonical
CLI refusal before any product edit, test or HANDOFF. Neither is an A/B sample:

| Pilot | Execution | Evidence verdict | Application verdict |
| --- | --- | --- | --- |
| 001 | Native model, SessionStart, PreToolUse and CLI executed | FAIL: `GLOBAL_RUNTIME_ACCESS_DENIED` | NOT EVALUATED |
| 002 | Native model, hooks and leased protected-package CLI executed | FAIL: `ACTIVATION_READ_FAILED` | NOT EVALUATED |

Pilot 001's initial summary incorrectly used `PHASE1_PASS` for a completed
native transport. A separate retained correction applies the existing semantic
phase guard: canonical failure and missing first-phase HANDOFF make the pilot
FAIL. Its raw summary remains unchanged; successful process exit is not
successful workflow. Pilot 002 applies that semantic guard directly and stops.
Both Windows Jobs confirm zero descendants; both owned PostgreSQL clusters are
removed; personal configuration and authentication hashes remain unchanged.

Independent OS probes separate two preconditions. First, a readonly runtime
with a grant for the absent admission-lock file still refuses lock creation.
A broader writable runtime permits the lock, but also permits creation of
absent control files despite their readonly entries. That profile is rejected;
existing control-file write denials alone were insufficient evidence.
A disposable supervisor adapter instead acquires the genuine installed runtime
lease, verifies the selected generation and executes its exact package CLI
under MXC, retaining the actual argv and released-lease proof. This is an
external transport experiment, not public worker qualification.

Second, a native syscall probe identifies the activation failure: Node's
`fs.realpathSync.native` returns EPERM for the pilot directory on the non-system
NTFS volume under MXC. Ordinary read/write/remove, `lstat` and JavaScript
realpath succeed there; native realpath succeeds outside MXC. A fresh owned
system-volume directory passes all four operations under the same MXC profile.
Adding explicit `:root` read access does not fix native realpath on the
non-system volume. An explicit volume-root entry is refused by MXC as not
representable losslessly. No identity resolver, activation rule or sandbox is
weakened to conceal these observations.

The identical archive was also prepared in a fresh disposable system-volume
repository before the owner's G-only correction. Native physical identity and
real AIDN activation passed there; metadata reported ready. Exact hook
definitions and all three handler hashes matched the reviewed definitions,
but native discovery excluded that new untrusted project layer. The review
request is withdrawn and this candidate is retired. No trust entry or approved
hash was injected. Its OS/activation success remains historical preparation
evidence, with zero model calls and no application verdict.

### Historical method and subsequent G-only diagnosis

Inspection of both retained `prepared.json` and `execution.json` establishes
that campaigns 034/036 stored source and evidence on the non-system volume,
but actually ran their application clients, installed runtime and two isolated
Codex homes on the system volume. They used Codex 0.163.0-alpha.10.2,
gpt-6.1-sol/medium and an explicit MXC profile extending `:workspace` with
`network_proxy = true`. The historical Python controller inherited the host
environment and overrode only the declared trial values. Native project hooks
used the explicit reviewed invocation mode. Private PostgreSQL governed AIDN;
both applications used SQLite, two actual conversations and the same fixed
oracle. Each completed 20/20 on that oracle. The later published 0.14.0 native
continuity pilot also used system-volume clients. Those paths are historical
facts, not permission to use that volume now.

The attempted current baseline 004 used Codex 0.164.0-alpha.11.1 with
gpt-6.1-sol/high. Its actual pre-dispatch observations confirmed zero hooks,
the selected model/effort and MXC readiness. Native `apply_patch` repeatedly
failed before a required write; the model then tried its underlying CLI helper
through the shell. The operator stopped the owned Job and excluded the attempt.
Phase 2 and the fixed external oracle were not run. The stopped baseline is
not reused as a successful comparator, even though some shell-helper writes
occurred. The Job confirms zero remaining descendants and the frozen controls
remain unchanged.

A new trusted-project entry appeared in the personal configuration during
that attempt. It is not human hook approval. The
[public server processor](https://github.com/openai/codex/blob/970111f6cb62cc02fe36a82ea7d71b37a2889c97/codex-rs/app-server/src/request_processors/thread_processor.rs#L1408)
contains an automatic project-trust write when an explicit requested cwd is
writable and lacks a trust decision. That branch is consistent with the observed
change; the selected executable is not claimed bit-identical to this public
source commit. Later single-marker diagnostics omit the redundant thread cwd
while starting the server in the exact owned directory. The returned cwd/roots
match and the configuration stays unchanged. No agent config/trust write or
reconciliation was attempted. Their native edit still fails, including with
explicit relative and absolute root grants and a sibling workspace outside the
readonly runtime tree. Each stops on its first native failure, with no shell
fallback. These negative component cases do not establish a shared cause with
the non-system-volume identity failure.

The historical profile also explicitly enabled the network proxy. A loopback
HTTP success alone does not establish outbound-domain enforcement for the
current experimental profile; that profile has no such qualification. A future
campaign must verify its actual proxy/network controls as well as native edits.

The source/selection preparation continues independently: six complete installed
authority documents total 42,139 bytes. A pure current-engine test using the
official formatter retains all six and all declared dependencies. It refuses
the 16 KiB nominal target and requires an explicit expansion; the tested
64 KiB response is 64,608 bytes. Missing/changed units, unaccepted policies and
unknown skills refuse. This is a controlled fixture-policy probe with zero
client-configuration writes or model calls, not acceptance on behalf of a real
client, replacement of mandatory startup reads, or application evidence.
The external control suite passes 312 tests, including refusal of untrusted,
wrong-source or unexpected integration hooks before `thread/start` can invoke
SessionStart. These controls remain preparation evidence.

The decisive G-only minimal reproduction uses an empty owned Codex home and
temporary directory on the permitted volume. Both `:workspace` and custom
profiles reproduce EPERM for native realpath. Both the bounded non-secret host
environment and the historical full-inheritance pattern reproduce it as well;
past environment values are not reconstructed. No authentication is copied.
A separate system-volume worktree linked to the already reviewed original Git
common directory still fails native identity on that common directory; it was
removed after the OS-only probe. That route cannot transfer the original trust
while preserving the current physical-identity check. No fallback to JavaScript
identity, weaker sandbox, setup, alternate client installation or public native
promotion is claimed.

The final G-only discriminating probes additionally retain the following:

| Controlled change | Native physical identity | Other file operations |
| --- | --- | --- |
| Explicit selected `workspace_roots` for the exact cwd | EPERM | PASS |
| Current executable on system volume versus identical SHA-256 copy on G | EPERM in both | PASS in both |
| Current 0.164.0-alpha.11.1 versus official 0.163.0-alpha.10.2, both executable images on G | EPERM in both | PASS in both |

The official older archive and extracted executable match the digests published
by [the exact upstream release](https://github.com/openai/codex/releases/tag/rust-v0.163.0-alpha.10.2).
Its executable SHA-256 is
`76b4bfc83785f31c59ec384760003109410132bab602a2115d83e88e04a6dc47`,
whereas the historical installed application executable was
`f6dbf48cb70f62649c645f26c87dc9bf84cc36986202dfad8e12fb5b8ca70312`.
Only the version label matches. The current executable copy retains SHA-256
`1103e9e09c71fa2cd0afd6d8f3b9a2d63174fe8efd7cb5bd09f1cb14ef58a098`.
The probes use no model, copied authentication, setup, login or global
installation. Their homes, temporary state, binaries and receipts are all on G;
the main configuration is preserved and every owned Job closes with zero
remaining descendants. These controls rule out executable placement and this
older public version as sufficient repairs in the present environment.

A [public upstream issue](https://github.com/openai/codex/issues/52593) reports
the same JavaScript/native-realpath split inside Windows sandboxing. That is
external corroboration, not proof of this host's Windows syscall cause or a
verified fixed build. The present native application comparison is unavailable
because a required physical-identity precondition fails before the workflow;
its application oracle and end-to-end engineering targets remain unevaluated.
The retained controls provide a reproducible precondition check for a future
compatible runtime, without removing the identity check or changing storage
scope.


### Remaining mission requirements and validation cost

The mission remains incomplete. This assessment preserves the requested scope;
it does not equate a supported opt-in route with default installed adoption.

| Requirement | Current evidence | Remaining acceptance |
| --- | --- | --- |
| Compact nominal agent preparation | Bounded transaction defaults, complete-unit policy validation and no implicit broad fallback pass source/preparation checks | Native qualification and promotion of the ordinary installed skill/startup route |
| Fewer model interactions | Repeated native preparation oracle passes with seven versus three responses | Complete installed-task A/B with the same functional and workflow oracle |
| Supported continuation | Explicit admitted capsule capture and fresh validated resume; native limitations retained | Native rollover remains unqualified and is not promoted |
| Mutualized reads and parsing | Existing observation fences retained, invocation-local parse gain measured, canonical backend correction verified | No end-to-end gain is inferred from the CPU result |
| Final source qualification | Targeted checks and retained initial failures/replays; a fresh complete run is active at clean source `02e40f5854cdb141553e9d14d2281760ee33c228` | Inspect its terminal result before any full-source PASS claim |

The initial source campaign's retained individual gate clocks total
3,090,127 ms (51.50 minutes). This is a sum of script clocks from the failed
campaign, not parallel CI elapsed time or a complete passing qualification.
Codex accounts for 1,855,312 ms (30.92 minutes) and runtime for 953,788 ms
(15.90 minutes); together they account for 90.9% of that measured sum.
Contracts account for 191,454 ms. The missing PostgreSQL prerequisite and
zero-duration release refusal make those initial costs incomplete. Detailed
family sums are retained in the qualification ledger; they are not substituted
for the terminal result of the fresh run.

Development should select the transaction/task-policy/lifecycle behavior checks
for the affected path. The transaction fixture is imported by the existing
task-context-profile fixture, so its standalone npm wrapper does not imply a
missing PR gate. Governance Admission resolves the nine affected families once;
complete clean-source qualification keeps all 59 required and three optional
gates. Native application/model campaigns remain distinct manual evidence.
No gate is removed, obligation lowered, deadline relaxed or coverage reduction
claimed from this cost analysis.
