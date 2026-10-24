# Runtime performance campaign — 2026-10-24

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

## Lot 1 — bounded policy refusal

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

## Lot 2 — one bounded preparation

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

## Lot 3 — supported continuation and actual native limits

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
