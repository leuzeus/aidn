# Plan Repair-Layer Traceability - 2026-03-13

Date: 2026-03-13
Status: completed

## 1. Goal

Correct a repair-layer diagnostic defect observed in a client project (`gowire`) when the snapshot references a cycle that exists locally in `docs/audit/cycles/`, but is not yet tracked or indexed by the DB-backed runtime.

The goal is not to relax workflow gates. The goal is to make the diagnosis exact, consistent across runtime outputs, and traceable enough to distinguish:

- an artifact that is actually missing;
- an artifact that exists locally but is untracked;
- an artifact that is tracked but not yet visible in the current index.

## 1.1 Implementation Status

This plan is no longer a proposed change set.

It is now a historical implementation record for work delivered in:

- `docs/BACKLOG_REPAIR_LAYER_TRACEABILITY_2026-03-13.md`
- commit `52c1b5b` (`Tighten repair layer traceability outputs`)

The diagnosis, target behavior, and compatibility constraints below remain useful as design reference, but the implementation phases are no longer pending work.

## 2. Current State

Observed state at the time this plan was written:

- `docs/audit/snapshots/context-snapshot.md` references `C058` and `C059`;
- `docs/audit/cycles/C058-*/status.md` and `docs/audit/cycles/C059-*/status.md` exist locally;
- `CURRENT-STATE.md` may display a coherent context and `repair_layer_status: clean`;
- `RUNTIME-STATE.md` and `repair-layer-triage.json` may simultaneously display `repair_layer_status: warn` with `UNRESOLVED_CYCLE_REFERENCE`.

Likely cause at the time:

- the repair-layer currently reasons over indexed artifacts;
- the snapshot can be updated before new cycles/sessions are tracked in Git or materialized into the SQLite index;
- the current message incorrectly treats "not indexed" as "missing".

Negative effects observed then:

- false-positive `UNRESOLVED_CYCLE_REFERENCE` findings;
- divergence between `CURRENT-STATE.md` and `RUNTIME-STATE.md`;
- misleading handoff/admission output even though the cycle actually exists;
- reduced trust in runtime warnings.

## 3. Target Decision

Adopt the following principles:

1. `UNRESOLVED_CYCLE_REFERENCE` must be reserved for the case where no compatible `status.md` is detected.
2. Local presence of a matching `status.md` must be checked before concluding that a referenced cycle is missing.
3. The runtime must distinguish:
   - `missing`
   - `present_local_untracked`
   - `tracked_not_indexed`
4. Derived outputs (`CURRENT-STATE.md`, `RUNTIME-STATE.md`, `HANDOFF-PACKET.md`, `MULTI-AGENT-STATUS.md`) must share the same primary `repair_layer_status` reason.
5. The guard message shown to users must explain the real cause when the warning is caused by a local artifact that is not yet indexed.

## 4. Target Behavior

### 4.1 Cycle Reference Resolution

When a snapshot or baseline references a `cycle_id`, the runtime must apply the following order:

1. look for an already indexed cycle status;
2. if absent from the index, look for a matching `docs/audit/cycles/CXXX-*/status.md` on disk;
3. if found locally, classify the case as "present but not visible in the index";
4. if not found locally, keep `UNRESOLVED_CYCLE_REFERENCE`.

### 4.2 Target Finding Taxonomy

The runtime must be able to emit distinct findings:

- `UNRESOLVED_CYCLE_REFERENCE`
  - no compatible status artifact detected;
- `UNTRACKED_CYCLE_STATUS_REFERENCE`
  - artifact detected locally but not tracked/materialized;
- `UNINDEXED_CYCLE_STATUS_REFERENCE`
  - tracked or expected artifact, but not visible in the current index.

Default severity remains `warning` for cases not automatically resolved, but the wording must reflect the true nature of the problem.

### 4.3 Runtime Output Consistency

Computation of `repair_layer_status` and its primary reason must be centralized or strictly reused by:

- `docs/audit/CURRENT-STATE.md`
- `docs/audit/RUNTIME-STATE.md`
- `docs/audit/HANDOFF-PACKET.md`
- `docs/audit/MULTI-AGENT-STATUS.md`

Goal:

- avoid `clean` on one side and `warn` on the other for the same runtime state;
- make the causal chain readable between triage JSON, runtime digest, and handoff.

## 5. Technical Impact

### 5.1 Repair-layer

The repair-layer must enrich cycle reference resolution with:

- targeted local scanning of `docs/audit/cycles/CXXX-*/status.md`;
- diagnostic provenance (`index`, `local-scan`, `inference`);
- messaging more precise than "no cycle status artifact was indexed".

### 5.2 Triage JSON

The `repair-layer-triage.json` output must be able to expose additional traceability fields, for example:

- `resolution_basis`
- `index_visibility`
- `detected_local_paths`
- `source`

These fields must remain optional to avoid breaking existing consumers.

### 5.3 Pre-write Guard

`pre-write-admit` must explicitly surface warnings of the form:

- cycle present locally but untracked;
- cycle present but not yet indexed;

The goal is to prevent users from interpreting the warning as workflow corruption or a missing cycle.

## 6. Traceability

The fix must make the following chain visible:

1. source artifact that references a cycle;
2. resolution method used;
3. reason for the emitted finding;
4. impact on `repair_layer_status`;
5. propagation into derived runtime outputs.

The runtime digest should also be able to expose a concise computation basis, for example:

- `repair_layer_basis: indexed-only | indexed+local-presence`

If a run identifier already exists, it should be reused to connect:

- `repair-layer-report.json`
- `repair-layer-triage.json`
- `RUNTIME-STATE.md`

## 7. Implementation Plan

### Phase 1 - Taxonomy and Local Detection

- add absent / local-untracked / unindexed distinction in the repair-layer;
- scan local cycle statuses before emitting the "missing" finding;
- introduce new `finding_type` values if needed.

### Phase 2 - Derived Runtime Output Alignment

- review the `repair_layer_status` computation paths;
- factor or normalize the primary reason;
- align derived documents on that logic.

### Phase 3 - Guard Messaging and Troubleshooting

- update `pre-write-admit`;
- document the scenario in runtime / troubleshooting docs;
- make the difference explicit between a real error and a transient false positive.

Implementation note:

- these three phases have been completed
- the backlog itemization and progress notes in `docs/BACKLOG_REPAIR_LAYER_TRACEABILITY_2026-03-13.md` are the source of truth for what was delivered

## 8. Tests and Validation

Tests must cover at least:

1. cycle referenced in snapshot, absent everywhere
   - expected: `UNRESOLVED_CYCLE_REFERENCE`
2. cycle referenced, `status.md` present locally but `untracked`
   - expected: dedicated finding, not "missing"
3. cycle referenced, `status.md` tracked and indexed
   - expected: no unresolved-reference finding
4. joint generation of `CURRENT-STATE.md` and `RUNTIME-STATE.md`
   - expected: same `repair_layer_status` and same primary reason
5. handoff / pre-write with non-blocking "local but not indexed" warning
   - expected: explicit and non-misleading message

Fixtures must reproduce a `gowire`-like case:

- snapshot updated;
- new cycles/sessions present on disk;
- SQLite index not yet aligned.

## 9. Risks and Compatibility

Risks:

- introducing too much granularity in findings could make triage noisier;
- some JSON consumers may assume a fixed taxonomy;
- local detection must remain targeted to avoid degrading performance.

Constraints:

- do not change DoR policy;
- do not remove genuinely useful warnings;
- preserve compatibility with `dual` and `db-only`.

## 10. Expected Outcome

After the fix:

- the runtime no longer says a cycle is "missing" when it is only not indexed yet;
- runtime outputs are consistent with each other;
- handoff and pre-write guard output become more reliable;
- repair-layer diagnostic traceability becomes usable for debugging and audit.

Outcome status:

- achieved
