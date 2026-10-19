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
