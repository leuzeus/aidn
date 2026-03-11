# Audit Gate Coverage - 2026-03-10

## Follow-Up Status - 2026-03-11

This audit is now partially superseded by remediation work already landed on the runtime path.

Remediated after the audit:

- `close-session`
- `cycle-create`
- `requirements-delta`
- `promote-baseline`
- `convert-to-spike`
- `handoff-close` runtime exposure mismatch

Clarified after the audit:

- `drift-check` remains intentionally backed by generic gating, but hook output now exposes the real gate result instead of masking blocked states behind `ok=true`

## Scope

Audit trace to detect other workflow gates/features that are in the same failure class as the gate recently restored for `start-session`:

- the contract/documentation describes a blocking business gate or mandatory arbitration
- the actual runtime route delegates only to a generic hook/checkpoint
- the specialized decision is therefore not enforced by the runtime path

Audited surface:

- `template/codex/*/SKILL.md`
- `template/root/AGENTS.md`
- `template/docs_audit/PROJECT_WORKFLOW.md`
- `src/core/skills/skill-policy.mjs`
- `src/application/runtime/*`
- selected `tools/perf/*` verification scripts
- selected fixture executions

## Method

1. Map each skill to its runtime route from `src/core/skills/skill-policy.mjs`.
2. Compare each skill contract against the actual routed implementation.
3. Run spot executions on fixtures when a documented gate looked at risk.
4. Classify each gap as:
   - `confirmed-runtime-gap`: contract says mandatory blocking gate, runtime path demonstrably does not enforce it
   - `confirmed-structural-gap`: contract/template exists but runtime exposure is missing or inconsistent
   - `watchlist`: likely gap, but not yet proven by execution

## Runtime Route Map

- `context-reload` -> `reload-check.mjs`
- `branch-cycle-audit` -> `branch-cycle-audit-hook.mjs`
- `drift-check` -> `gating-evaluate.mjs`
- `start-session` -> `start-session-hook.mjs`
- `close-session` -> `workflow-hook.mjs --phase session-close`
- `cycle-create` -> `checkpoint.mjs`
- `cycle-close` -> `checkpoint.mjs`
- `promote-baseline` -> `checkpoint.mjs`
- `requirements-delta` -> `checkpoint.mjs`
- `convert-to-spike` -> `checkpoint.mjs`

## Baseline

The recently corrected pattern is now properly covered for:

- `start-session`
- `branch-cycle-audit`

Their contracts now explicitly say the runtime hook applies admission before delegating to the generic checkpoint/gating path, and the runtime routes match that design.

## Findings

### 1. `close-session` still has the same missing business gate

Classification: `confirmed-runtime-gap`

Contract requires a mandatory gate before close:

- `template/codex/close-session/SKILL.md` says open cycles must be resolved before session close.
- It also says each open cycle needs an explicit decision.
- It explicitly says: if one open cycle has no explicit decision, stop session close.

Runtime route does not implement that gate:

- `src/core/skills/skill-policy.mjs` routes `close-session` to generic `workflow-hook.mjs --phase session-close`.
- `src/application/runtime/workflow-hook-use-case.mjs` only runs generic checkpoint/index/constraint-loop machinery.
- `src/application/runtime/workflow-session-service.mjs` only manages run-id persistence for `session-close`.

Execution trace confirms the gap:

- Fixture: `tests/fixtures/perf-structure/session-multi-cycle-explicit`
- Session `S103-multi` attaches cycles `C103` and `C104`
- `C103` state is `IMPLEMENTING`
- `C104` state is `VERIFYING`
- No explicit close decisions are recorded before the hook runs
- Command:

```powershell
node tools/perf/skill-hook.mjs --skill close-session --target tests/fixtures/perf-structure/session-multi-cycle-explicit --mode COMMITTING --json
```

Observed result:

- runtime returned `ok`
- routed tool was `workflow-hook.mjs`
- no business decision payload about open-cycle resolution was produced
- gate was skipped as `SKIPPED_NO_SIGNAL_GATE`

Conclusion:

- `close-session` is in the same failure class as the pre-fix `start-session`

### 2. `cycle-create` still has the same missing continuity gate

Classification: `confirmed-runtime-gap`

Contract requires a continuity decision before creation:

- `template/codex/cycle-create/SKILL.md` says to run a continuity gate before creating files/branch
- if requested source branch is neither latest active cycle branch nor current session tip, it must stop
- the user must select exactly one continuity rule `R1 | R2 | R3`
- no cycle artifacts should be created until that selection is made

Runtime route does not implement that gate:

- `src/core/skills/skill-policy.mjs` routes `cycle-create` to generic `checkpoint.mjs`
- `src/application/runtime/checkpoint-use-case.mjs` only does reload/gate/index sync
- there is no `cycle-create` admission use case or continuity-specific decision layer in `src/application/runtime`

Execution trace confirms the gap:

- Fixture: `tests/fixtures/perf-structure/session-multi-cycle-explicit`
- Command:

```powershell
node tools/perf/skill-hook.mjs --skill cycle-create --target tests/fixtures/perf-structure/session-multi-cycle-explicit --mode COMMITTING --json
```

Observed result:

- runtime returned `ok`
- routed tool was `checkpoint.mjs`
- payload contains only generic reload/gate/index data
- no continuity rule selection, no blocking decision, no source-branch arbitration

Conclusion:

- `cycle-create` is in the same failure class as the pre-fix `start-session`

### 3. `requirements-delta` likely has the same missing branch/cycle arbitration gate

Classification: `watchlist`

Contract requires a business stop:

- `template/codex/requirements-delta/SKILL.md` says medium/high impact with unclear branch ownership must stop and request a cycle/branch decision

Runtime route does not show any specialized enforcement:

- `src/core/skills/skill-policy.mjs` routes it to `checkpoint.mjs`
- `src/application/runtime/checkpoint-use-case.mjs` has no `requirements-delta` ownership arbitration logic

Why this is not yet marked fully confirmed:

- I did not execute a dedicated fixture that forces `medium/high impact + unclear branch ownership`

Assessment:

- very likely same class of gap
- should be the next audit-to-fix candidate after `close-session` and `cycle-create`

### 4. `promote-baseline` likely has a partial admission gap

Classification: `watchlist`

Contract requires validation-driven stop:

- `template/codex/promote-baseline/SKILL.md` says if validation fails, produce missing checklist and do not promote

Runtime route remains generic:

- `src/core/skills/skill-policy.mjs` routes it to `checkpoint.mjs`
- no specialized promotion validation admission exists in runtime

Assessment:

- similar pattern exists
- severity is lower than `close-session` and `cycle-create` because this gate is more artifact-validation-centric than branch-topology-centric
- still worth aligning if promotion must become reliably machine-enforced

### 5. `drift-check` is not proven broken, but the runtime coverage is only generic

Classification: `watchlist`

Contract says:

- severe/structural drift must stop and request arbitration before continuing implementation

Runtime route:

- `drift-check` goes to `gating-evaluate.mjs`

Assessment:

- this may be acceptable if the generic gating policy is intended to be the source of truth for drift signals
- unlike `close-session` and `cycle-create`, I did not find a clearly separate business admission protocol that must exist before delegation
- keep on watch, but not currently the strongest candidate for the same bug class

### 6. `convert-to-spike` is indirectly exposed through `cycle-create`

Classification: `watchlist`

Contract says:

- convert the current exploration into a new SPIKE cycle through `cycle-create`

Runtime route:

- `convert-to-spike` itself goes to `checkpoint.mjs`

Assessment:

- the main risk is inherited from `cycle-create`
- if `cycle-create` continuity admission is missing, `convert-to-spike` is also under-protected for branch continuity decisions
- lower priority than fixing `cycle-create` directly

### 7. `handoff-close` has a structural exposure mismatch

Classification: `confirmed-structural-gap`

Template/contract exists:

- `template/codex/handoff-close/SKILL.md`
- `template/codex/skills.yaml` lists `handoff-close`

Runtime exposure is missing from the supported skill map:

- `src/core/skills/skill-policy.mjs` does not list `handoff-close`

Execution trace confirms the mismatch:

```powershell
node tools/perf/skill-hook.mjs --skill handoff-close --target tests/fixtures/perf-handoff/blocked --mode COMMITTING --json
```

Observed result:

- CLI rejected the skill as unsupported

Conclusion:

- this is not the exact same gate-loss bug as `start-session`
- it is still a documented-runtime inconsistency that should be tracked

### 8. `cycle-close` does not currently show the same missing-gate pattern

Classification: `no-evidence-of-same-class-gap`

Reason:

- the contract mostly describes an exit checklist and status updates
- I did not find a missing branch/session admission layer analogous to `start-session` or `cycle-create`
- current route through `checkpoint.mjs` may be sufficient for the generic pre-write/runtime checks it advertises

## Priority

Recommended fix order:

1. `close-session`
2. `cycle-create`
3. `requirements-delta`
4. `handoff-close` exposure gap
5. `promote-baseline`
6. `convert-to-spike`
7. `drift-check` only if you want stronger business-specific arbitration beyond generic gating

## Recommended Remediation Pattern

Reuse the pattern already applied to `start-session` and `branch-cycle-audit`:

1. Add a dedicated admission use case for the skill.
2. Return an explicit machine decision such as `proceed | stop | choose | resume`.
3. Delegate to generic `checkpoint` or `workflow-hook` only after admission succeeds.
4. Add contract fixtures that fail on the documented blocking cases.
5. Update `SKILL.md`, `AGENTS.md`, and workflow docs in the same change set.

## Proposed Next Audit/Fix Batch

Minimal coherent batch:

- `close-session` admission
- `cycle-create` admission
- `requirements-delta` admission or explicit decision helper
- `handoff-close` route exposure alignment

Reason:

- these four items are the tightest cluster of contract/runtime drift with practical workflow impact

## Trace Summary

Commands used in this audit included:

```powershell
rg -n "start-session|close-session|cycle-create|cycle-close|promote-baseline|requirements-delta|drift-check|branch-cycle-audit|handoff-close|convert-to-spike" src/core/skills/skill-policy.mjs template/codex -S
rg -n "mandatory gate|STOP|blocked|arbitration|choose|choice|open cycles|source branch|continuity|do not promote|no explicit decision|unclear branch ownership|severe|structural drift|select exactly one continuity rule|already exists" template/codex template/docs_audit template/root/AGENTS.md -S
node tools/perf/skill-hook.mjs --skill close-session --target tests/fixtures/perf-structure/session-multi-cycle-explicit --mode COMMITTING --json
node tools/perf/skill-hook.mjs --skill cycle-create --target tests/fixtures/perf-structure/session-multi-cycle-explicit --mode COMMITTING --json
node tools/perf/skill-hook.mjs --skill handoff-close --target tests/fixtures/perf-handoff/blocked --mode COMMITTING --json
```

## Bottom Line

Yes: there are other cases in the same family.

Confirmed:

- `close-session`
- `cycle-create`

Strong next suspects:

- `requirements-delta`
- `promote-baseline`

Related structural mismatch:

- `handoff-close`
