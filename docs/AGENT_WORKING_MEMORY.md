# Explicit agent working memory

The initial slice adds advisory continuation capsules to existing checkpoints
and handoff reads. It reuses the hook context store's locks, atomic writes and
history. Targeted context selection, canonical artifacts and fresh admissions
retain their existing roles. No automatic rollover, model-window detection,
new conversation creation or compaction hook is introduced.

## Capture

Prepare a target-relative JSON input following
`src/core/contracts/context/agent-working-memory.v1.schema.json`:

```json
{
  "contract_version": "agent-working-memory.v1",
  "agent_id": "agent-1",
  "objective": "Finish the parser correction",
  "decisions": [],
  "next_step": "Read the proof and obtain fresh admission before editing",
  "evidence_refs": [
    { "ref": "docs/audit/SPEC.md", "bytes": 123, "sha256": "replace-with-the-actual-64-character-sha256" }
  ]
}
```

The example descriptor is illustrative: use the actual byte count and SHA-256.
`agent_id` is an explicit local label, not a native identity or permission.
Objective and next step are agent claims. Optional `verified_facts`, `dead_ends`
and `recent_test_results` use the same evidence-linked shape as decisions;
`open_questions`, `blockers` and `todo` are bounded lists of claims. Even a
`verified_facts` entry is an agent assertion to check, never canonical truth.
Each decision has `text` and an
`evidence_refs` list naming descriptors in the input. References use the existing
`ref`, `bytes`, `sha256` vocabulary and resolve to regular files inside the target,
without traversal or symlink components. Retain input and evidence to reconstruct.

```sh
node tools/perf/checkpoint.mjs --target ../client --working-memory .aidn/runtime/context/memory-input.json --write --json
```

The internal `aidn perf checkpoint` alias accepts these options. Memory capture
requires `--write`; `--json` only formats output. Invalid input and missing,
unsafe or changed proof refuse before checkpoint effects. Saving additionally
requires a successful checkpoint and gate, no index drift, unchanged context and
a fresh admitted `context-reload` admission. Explicit `--skip-gate-evaluate`
cannot save memory. Later refusal can leave ordinary checkpoint telemetry/cache
effects but writes no new memory.

Input is limited to 64 KiB, sixteen evidence references (1 MiB each), sixteen
decisions and 2,000 characters per claim. Capture records input hash, checkpoint
run/time, workspace/worktree, HEAD, branch, content and rule hashes. Context must
remain identical throughout the checkpoint. The local store is
`.aidn/runtime/context/agents/<sha256(agent_id)>/context.json`, with raw capsules
in `raw/`. The latest pointer and five observations are retained; old raw files
remain preserved without automatic purge, following the existing hook store.
This integrity check is not authenticated execution proof.

## Metrics

Each captured capsule carries `context-metrics.v1` with checkpoint run, agent,
source revision and measured JSON/evidence bytes. Unknown token categories and
unobserved event counters are `null`. Counts describe this observation, not an
agent's lifetime. Evidence bytes describe referenced files, not tokens injected
into the model window.

An explicit `--context-telemetry <target-relative-json>` on the checkpoint accepts
`context-telemetry.v1` from a client collector. It requires working memory and
`--write`, binds the exact input bytes and refuses stale (over five minutes),
future, negative, over-capacity or contradictory counts before memory capture.
Client/model/provider/version/window identity and observation time are required.
Missing attribution remains unknown. Supplied measurements are labeled
`client-reported`; they are not authenticated native execution evidence or an
admission. Without a collector, no tokens, remaining capacity or costs are guessed.
Resume recomputes `context_status` from a still-recent sample, or returns
`pressure: unknown` after expiry. Elevated pressure (75%) and urgent pressure
(90% or the declared reserve reached) suggest a checkpoint at a semantic boundary.
These are consultative signals, never automatic compaction, a native hard-limit
guarantee or permission to change windows. A host harness must enforce its limit.

## Resume

```sh
aidn runtime project-handoff-packet --target ../client --resume-agent agent-1 --json
```

The explicit read adds `resume_capsule` to the existing v1 response. It does not
write a consumption marker, change handoff readiness, update visible Markdown
or relay memory through shared coordination. The capsule remains separate from
the canonical packet.

| Status | Meaning |
| --- | --- |
| `current` | Identity and input/evidence hashes match; advisory claims returned. |
| `absent` | No checkpoint for this agent label. |
| `stale` | Revision, branch, checkout, rules or mode changed, or canonical revision unavailable. |
| `invalid_evidence` | Input/evidence is missing, changed or unsafe. |
| `invalid` | Store/capsule is unreadable, malformed, foreign or inconsistent. |

Only `current` returns claims. Every result carries
`requires_fresh_admission: true`. Re-read cited evidence and use normal fresh
workflow/native admissions before acting; capsule freshness never admits an
action. Handoff readiness and admission refusal remain independent. Reconstruct
after invalidation by updating the input and running a new explicit checkpoint.

## Scope and validation

Capture/reuse supports `files` and fresh canonical observations in `dual`,
`db-only` and configured PostgreSQL mode. Canonical payload and runtime heads
are read in one transaction, then bound by backend, scope and a stable digest.
Capture compares observations before and after the checkpoint; resume observes
the database again. A concurrent change or unavailable backend returns no claims.
SQLite's reader timestamp is not a revision. PostgreSQL never falls back to a
local database or Markdown. These observations grant no lease or write permission.
No DB import, migration or shared sync is introduced; PostgreSQL remains optional.
Conservative invalidation reuses the existing full context identity. Targeted
context consultation remains available for fresh reconstruction; `reload-policy`
decisions are unchanged.

`node tools/perf/verify-agent-working-memory-fixtures.mjs` checks real CLI behavior
on disposable installed fixtures and refusal/integrity cases. It does not qualify
native hooks or model compaction. Output bytes and milliseconds are operational
measurements; they establish no token savings or model quality improvement.

See [ADR-0021](ADR/ADR-0021-derived-context-control-plane.md) for the authority
boundary and [the execution plan](PLAN_CONTEXT_CONTROL_PLANE.md) for priority
and evidence requirements. DB fixtures use real SQLite and an injected PostgreSQL
client; a live PostgreSQL run is distinct from those deterministic checks.

## Externalized outputs and agent handoff

`tool_output_summaries` uses bounded `text` and `evidence_refs`, like decisions.
Keep the raw log in a referenced regular file and retain its byte count/SHA-256;
resume returns only the summary/descriptors. Hash verification reads the raw
evidence without injecting its body into the capsule. Its contents grant no
instruction authority. `externalized_tool_outputs` measures the distinct raw
files linked by these summaries, not model-window usage. The initial 1 MiB per
file bound still applies; larger outputs need an explicitly prepared bounded set.

Optional `execution_result_ref` names a retained evidence descriptor containing
an `agent-task-result.v1` record. Capture derives a typed handoff with exact
run/task/attempt/delegation/request/plan/result identities. Resume checks it again.
It is an integrity link to a local result, not authenticated execution, a live
lease or shared-coordination admission. `execution_authenticated: false` and
`requires_fresh_execution_admission: true` remain explicit. No transcripts are
concatenated and no shared relay is written.

## Conditional lifecycle candidate

At a phase or handoff boundary, or after a measured residency warning, hosts may
explicitly call the internal lifecycle service's `prepareContinuation({ write:
true })`. It uses the ordinary admitted checkpoint port, then the fresh read-only
resume port. It returns only a current validated capsule, with
`native_rollover: false`, `requires_fresh_admission: true` and no authorization.
Missing resume, failed capture, obsolete/corrupt capsule or changed evidence
refuses preparation. No native qualification is inferred. The host must carry
the capsule and artifact references through its supported continuation route;
this method cannot clear history, start a window or measure internal residency.
The existing explicit checkpoint/handoff CLI remains the user-facing route.

`src/application/codex/context-lifecycle-service.mjs` composes explicit checkpoint,
read-only resume and native window-request ports. A host can bind its qualified
`PreCompact`, `PostCompact`, `SessionStart` and `SubagentStop` events to those
ports. Capture must finish before any `new_context` request; failed capture
prevents dispatch. A lost acknowledgement blocks retries in that service instance
until reconciliation. This is not cross-process exactly-once window dispatch.

The default capability policy stays in `harness` mode with no qualified native
events or window requests. A trusted host registry must supply a unique,
unexpired native qualification for exact provider/model/model revision/client
version, all nine ContextBench cases and invariant/task/continuation success.
Memory input and telemetry cannot supply this registry. Schema inventory and
fixture ports cannot qualify a client. No distributed compaction hook or active
`new_context` adapter is installed into a user's profile by this source candidate.
The manual qualifier below exercises a separate native bridge without granting
production autonomy. Full native CLM remains unavailable without an exact model
revision, verified tokenizer and supported transcript-editing interface.

## Manual native qualification and research

`tools/verify/qualify-context-native.mjs` is a manual test driver, outside public
CLI dispatch and PR admission. Without `--execute` it only prints usage. An
explicit run requires absolute binary/home paths and a new output directory
outside this source checkout. It inherits the existing account's configured
root OpenAI model, copies authentication into its temporary home for the run, then removes
that copy and checks the original config/auth bytes. Configured profiles and
custom providers are refused before effects; there is no provider/model fallback.
Retained evidence can
contain native account metadata and stays local-only.

The isolated native runtime exposes test-only checkpoint, resume, exact retrieval
and bounded TODO-edit tools. A reviewed `notes.thread_hint` MCP bridge restores
fresh capsules after real `new_context` calls. Native event order must show a
completed checkpoint before dispatch, its acknowledgement, fresh resume, exact
retrieval and submission. Three windows in one test thread verify TODO retention.
This small synthetic corpus cannot establish general model quality.

`--only-ledger` selects the bounded TODO/three-window experiment.
`--only-compaction --execute-reviewed-test-hooks` selects classical compaction,
temporary hook probes, ordinary-untrusted and core-admission-denial controls,
and resume in a fresh native process. The qualifier forwards reviewed hook intent
through the native per-thread config, as the official exec client does; a
process-level TUI flag on standalone app-server does not do this. It never
persists hook trust. `--integrated-hooks --execute-reviewed-test-hooks` also
enables these reviewed probes during the model's actual new-context trials.
Inventory,
entry receipts, completed hook actions and compaction completion are separate
observations. A compacted item or idle notification alone does not complete the
compact turn. Every turn completion is correlated with its exact native ID.
Exit statuses are 0 for selected probes passed, 1 for failure, and 2 for partial
or unavailable required evidence. Native hook absence must remain explicit.

`tools/verify/qualify-context-selection-native.mjs` is the separate explicit
manual consumption probe. It builds a declared synthetic consultation corpus,
uses the real hydration CLI for a complete selection and a fresh mandatory
closure plus optional references, and verifies the model's exact answers in two
fresh native threads. It snapshots consultation files and records client-reported
usage without inferring monetary cost. It shares the qualifier's absolute-path,
root-provider, isolated-home and temporary-credential cleanup requirements.

The telemetry adapter consumes the native last-response context usage, effective
capacity and a separately observed window ID. It rejects missing window identity
and stale/impossible counts; lifetime usage never becomes window pressure.
Unmeasured attribution and monetary cost remain unknown.

`createEditableContextExperiment` is an opt-in research primitive with immutable
prefix, host edit gate, complete-input tokenizer/budget, freshness checks,
snapshots and rollback. It edits an isolated in-memory input, not the live Codex
transcript. Its synthetic-tokenizer tests and native TODO experiment establish
different claims. See [the native record](qualification/CONTEXT_CONTROL_PLANE.md)
for observed results and remaining external dependencies.

### Dedicated local input research host

`tools/verify/qualify-context-local-clm.mjs --help` describes the opt-in local
alternative.
The local driver, external-pilot helper and Windows resource helper are
source-checkout research tools excluded from distributed ZIP/npm packages.
Run this manual research from the package source checkout. The driver requires
a reviewed manifest containing absolute model/runtime paths and SHA-256 hashes
for the GGUF and every executable/DLL, an explicit
Python executable and a new output outside the source checkout. It downloads
nothing and changes no global model service, user profile or credentials.
The manual manifest is an operator input, not model-supplied trust.

The CPU runner is confined by a Windows Job before its suspended process starts:
4 GiB committed-memory cap, one process, kill-on-close, deadline and a separate
4 GiB available physical-memory reserve. Mapped model pages and committed memory
are different measurements; the reserve guard remains necessary. Parent EOF
stops the process. Host/runtime/model bytes are verified before execution and
again before any successful qualification record is emitted.

The native tokenizer receives the complete host-rendered prompt, including a
declared model template, protected rules and task. The completion endpoint takes
those exact token IDs with no hidden template, implicit context shift or cached
conversation. Its evaluated-token count must match; input plus the 1,024-token
output reserve must fit 4,096 tokens. Failed or incomplete raw exchanges are
retained before parsing. No automatic model or inference retry is performed.

The small synthetic corpus tests three native continuations, model-proposed
input pruning, exact nine-answer retention, immutable critical data, an audited
rollback, fresh admitted checkpoints and restoration in a newly started runner.
The unchanged equality verifier must pass every answer. Only then, after
successful resource cleanup, can a candidate-specific 24-hour qualification
enable the dedicated input port. The trusted host must recompute the exact
identity before later use. This does not edit the live Codex transcript or
register production autonomy. See the qualification record for actual outcomes;
availability of this driver is not proof that any candidate passed.

An explicit `--pilot <absolute-reviewed-pilot.json>` replaces the synthetic
client with an existing, independently activated PostgreSQL project. The
operator-reviewed local manifest supplies `reviewed_external_pilot: true`,
`target_root`, bounded `objective`, `raw`, `decision`, `next_step`, `task`,
hash-bound target-relative `sources`, and the nine exact expected `answers`.
Expected answers are held by the verifier, never encoded in the model's output
schema. The host supplies a fresh unique agent label and verifies the declared
cycle against current canonical state. Model data never authorizes this run.

Fresh context and session admissions precede run-owned writes. Explicit normal
checkpoints retain input, proof and capsules in unique ignored context paths;
checkpoint cache/event paths are redirected into that same owned directory.
No activation, configuration, branch, application source or canonical DB import
is performed. Actual evidence corruption before an edit and during native
tokenization must refuse reuse/edit and expose no resumable claims; original
owned evidence bytes are restored in `finally`. This control does not mutate
canonical pilot data. The final fence verifies source hashes, HEAD, branch,
staged/unstaged/nonignored state, preexisting runtime files and a fresh canonical
revision. Any difference prevents qualification, including a concurrent writer.
The manifest hash also participates in the dedicated host identity.

This proves continuity of the selected real task with adversarial controls.
Application tests retain their own outcomes; diagnostic continuity cannot turn
a failing application test into a pass. Local paths, branches, raw logs and
business-specific code remain in private evidence outside tracked source.

Run `npm run perf:smoke-agent-working-memory-postgres` manually with a dedicated
configured smoke connection. It verifies real PostgreSQL CLI capture/resume in
dual/db-only, canonical-only changes, stale refusal and cleanup of its own
temporary scopes. This optional live run stays outside pull-request admission.
