# Project Workflow Adapter (Stub)

This file is the project adapter for `aidn-workflow`.
Use it to record repository-specific constraints and operating policy.
Core workflow rules belong to `docs/audit/SPEC.md`, not here.
Its role is to reduce local ambiguity and keep AI behavior stable.
In installed repositories, this document is generated from `.aidn/project/workflow.adapter.json`.
Durable local policy changes should be made through that adapter config, not by editing generated sections here.

## Recommended Read Order (Fast Reload)

0. `docs/audit/HANDOFF-PACKET.md` when another agent already prepared a relay
1. `docs/audit/CURRENT-STATE.md`
2. `docs/audit/WORKFLOW-KERNEL.md`
3. `docs/audit/WORKFLOW_SUMMARY.md`
4. `docs/audit/RUNTIME-STATE.md` when runtime freshness or repair signals matter
5. `docs/audit/WORKFLOW.md`
6. `docs/audit/SPEC.md` only when a canonical rule must be checked precisely

## Canonical Rule References

Adapter rules in this file extend (but do not redefine) canonical mechanics from `docs/audit/SPEC.md`:
- Session start and mode gates: `SPEC-R01`, `SPEC-R02`, `SPEC-R03`
- DoR and drift: `SPEC-R04`, `SPEC-R05`
- Continuity and session close: `SPEC-R06`, `SPEC-R07`
- PR/local sync and incidents: `SPEC-R08`, `SPEC-R09`, `SPEC-R10`
- Invariants and anti-duplication: `SPEC-R11`

## Rule Ownership Map

| Rule Domain | Canonical Owner | Local Extension Owner | State Owner |
|---|---|---|---|
| Session lifecycle / mode / commit gating | `docs/audit/SPEC.md` | `docs/audit/WORKFLOW.md` (adapter extensions only) | `docs/audit/sessions/` |
| DoR / Drift / Continuity | `docs/audit/SPEC.md` | `docs/audit/WORKFLOW.md` (adapter extensions only) | `docs/audit/cycles/` |
| PR review / post-merge sync / incidents | `docs/audit/SPEC.md` | `docs/audit/WORKFLOW.md` (adapter extensions only) | `docs/audit/sessions/`, `docs/audit/incidents/` |
| Snapshot/baseline memory | `docs/audit/SPEC.md` (mechanics) | `docs/audit/WORKFLOW.md` (discipline/policy) | `docs/audit/snapshots/`, `docs/audit/baseline/` |

## Adapter Metadata

```yaml
workflow_product: aidn-workflow
workflow_version: {{VERSION}}
installed_pack: core
project_name: {{PROJECT_NAME}}
source_branch: {{SOURCE_BRANCH}}
```

## Project Constraints

{{PROJECT_CONSTRAINTS_BLOCK}}

## Branch & Cycle Policy

- Source branch: `{{SOURCE_BRANCH}}`
- Source branch classification: `source` (reload/reference branch only; never a cycle ownership branch).
- Session branch naming: `SXXX-<short-slug>`
- Cycle branch naming: `<cycle-type>/CXXX-<slug>`
- Intermediate branch naming: `<cycle-type>/CXXX-I##-<slug>`
- Allowed cycle types: `feature | hotfix | spike | refactor | structural | migration | security | perf | integration | compat | corrective`
- DoR policy: `{{DOR_POLICY}}`

## Runtime State Policy (Project Adapter)

- Preferred runtime state mode: `{{PREFERRED_STATE_MODE}}`.
- Default install/runtime index store: `{{DEFAULT_INDEX_STORE}}`.
- In `dual`/`db-only`, workflow skill perf hooks are mandatory and executed in strict mode.
- In `dual`/`db-only`, session close must run the DB-backed constraint chain and produce constraint artifacts under `.aidn/runtime/perf/`.
- `files` mode is allowed only as an explicit fallback profile; it is not the primary execution path for this adapter.

### Session Start Branch Base Gate (Mandatory, adapter extension to `SPEC-R01`/`SPEC-R03`)

- Runtime enforcement path: `start-session` admission runs before generic `session-start` checkpoint/index/repair work.
- Before creating a new session branch `SXXX-*`, check previous session PR status against source branch.
- `pr-orchestrate` owns the explicit bridge `push -> PR open/recover -> review/merge -> post-merge sync`.
- Decision order:
  - `PR OPEN`: continue on existing session branch by default.
  - `PR OPEN` + explicit user override: new session branch allowed with documented rationale.
  - `PR MERGED` or `no previous session`: open new session branch from up-to-date source branch.
  - `PR CLOSED (not merged)`: require explicit user decision before opening a new session branch.
- Hard stop: do not chain session branches by default.
- If previous-session status cannot be inferred reliably from local workflow state, STOP and request explicit user arbitration instead of assuming a new session is allowed.

### Git Hygiene Gate (Mandatory, adapter extension to `SPEC-R03`)

- Run `git status --porcelain` before branch creation/switch, `cycle-close`, and `close-session`.
- If out-of-scope untracked/modified files exist, stop and require explicit decision (`commit-now | stash-now | drop-now`).
- Record overrides in session/cycle artifacts with impact level.

{{SESSION_TRANSITION_CLEANLINESS_BLOCK}}

### Cycle Scaffold Materialization Gate (Mandatory)

- Before `IMPLEMENTING`, active cycle artifacts must be tracked:
  - `status.md`
  - `brief.md`
  - `plan.md`
  - `decisions.md`
  - `traceability.md`
- If missing/untracked, keep `dor_state=NOT_READY` and do not start implementation.

### Dev Branch Alignment Gate (Mandatory, adapter extension to `SPEC-R09`)

- After PR merge and before opening a new session branch:
  - `git switch {{SOURCE_BRANCH}}`
  - `git fetch origin {{SOURCE_BRANCH}}`
  - `git rev-list --left-right --count {{SOURCE_BRANCH}}...origin/{{SOURCE_BRANCH}}`
- Require `0 0` divergence before continuing.

### Post-Merge Reconciliation Gate (Mandatory, adapter extension to `SPEC-R09`)

- After merge, verify local/remote alignment before any new cycle/session branch creation.
- If divergence exists, stop and reconcile explicitly.

### Optional Branch Pruning Policy (Project Policy)

- If this repository uses a durable integration branch such as `dev`, branch cleanup SHOULD run only after `dev` is merged into `{{SOURCE_BRANCH}}`.
- Do not prune branches on baseline proposal alone.
- Baseline promotion may mark exploration or spike branches as review candidates, but deletion requires Git-level confirmation.
- CI pruning, when enabled, SHOULD be conservative:
  - only short-lived branches
  - already fully absorbed by `{{SOURCE_BRANCH}}`
  - no open pull request
  - minimum age window
  - protected/kept branch patterns excluded
- Keep the integration branch itself persistent unless an explicit repository decision says otherwise.

## Workflow Incident Handling (Project Policy, adapter extension to `SPEC-R10`)

- Trigger incident triage on repeated workflow failures, rule contradictions, or unresolved branch continuity conflicts.
- Use temporary incident tracking file:
  - `docs/audit/incidents/INC-TMP-<YYYYMMDD-HHMMSS>-<slug>.md`
  - Template: `docs/audit/incidents/TEMPLATE_INC_TMP.md`
- Severity policy:
  - `L1/L2`: auto-fix allowed with traceability.
  - `L3/L4`: explicit user authorization required before workflow rule changes.
- Noise-control policy:
  - trivial one-shot `L1` issues should stay out of temporary incident tracking unless they repeat or widen in scope
  - `L2+` incidents should keep explicit temporary tracking until resolution or defer decision
- If `defer-with-risk` is selected:
  - record rationale in session notes and in the incident file
  - open a follow-up cycle or task before the next session start

## Cycle Continuity Gate (Project Policy, adapter extension to `SPEC-R06`)

- Select exactly one rule per cycle creation mismatch:
  - `R1_STRICT_CHAIN`
  - `R2_SESSION_BASE_WITH_IMPORT`
  - `R3_EXCEPTION_OVERRIDE`
- Record decision in cycle `status.md` continuity fields.
- Reference: `docs/audit/CONTINUITY_GATE.md`

## Branch Ownership Admission Gate (Mandatory)

- `start-session` and `branch-cycle-audit` MUST use the same runtime branch/session/cycle mapping layer.
- Non-owned branches (`source`, `other`, `unknown`) MUST stop `branch-cycle-audit` in `COMMITTING`.
- Missing or ambiguous mapping MUST stop before generic gating/perf evaluation continues.

## Additional Admission-First Runtime Gates (Mandatory)

- `close-session` MUST stop before generic `session-close` runtime work when open attached cycles still lack explicit close decisions.
- `cycle-create` MUST stop before scaffold creation when continuity rule or mode-gate compatibility is unresolved.
- `requirements-delta` MUST stop before artifact mutation when medium/high-impact ownership is unclear.
- `promote-baseline` MUST stop before promotion when target cycle selection, gap closure, or traceability readiness is incomplete.
- `convert-to-spike` MUST reuse cycle continuity admission in `EXPLORING` mode before creating spike artifacts.
- `handoff-close` may keep generic checkpoint semantics, but the runtime skill result MUST expose the real blocking checkpoint outcome.
- `drift-check` continues to use generic gating as the drift source of truth; blocked gating outcomes are authoritative runtime stops.

{{EXECUTION_POLICY_BLOCK}}

{{SHARED_CODEGEN_BOUNDARY_BLOCK}}

## Cross-Usage Convergence Policy (Project Policy, adapter extension to `SPEC-R04` / `SPEC-R11`)

- Treat cross-usage convergence as a validation rule for shared or high-risk implementation surfaces.
- A shared or high-risk change SHOULD declare a minimal `usage_matrix` before `IMPLEMENTING`.
- A shared or high-risk change MUST NOT be considered stable from single-usage evidence only.
- The `usage_matrix` should reason in usage classes, not raw scenario count:
  - nominal usage
  - alternate business or caller usage
  - context, edge, or adversarial usage relevant to the touched surface
- Shared runtime, hydration, dispatch, codegen, migration, or concurrency-sensitive changes SHOULD validate at least three usage classes before closure.
- If a fix resolves the triggering scenario but regresses another declared usage class, treat it as overfitted and keep the cycle out of `DONE`.
- Prefer reusing canonical scenarios for shared surfaces instead of multiplying near-duplicate tests.

## Session Close & PR Review

- Session close and PR review gates are canonical in `docs/audit/SPEC.md` (`SPEC-R07`, `SPEC-R08`).
- Local runtime order after a review-ready session close:
  - `close-session`
  - `pr-orchestrate`
  - push session branch
  - create/recover PR
  - review / merge
  - post-merge local sync
- Add local CI/review capacity policy here if your repository needs it.
{{CI_CAPACITY_BLOCK}}

## Snapshot Discipline

- Snapshot update trigger: `{{SNAPSHOT_TRIGGER}}`
- Snapshot owner: `{{SNAPSHOT_OWNER}}`
- Freshness rule before commit/review: `{{SNAPSHOT_FRESHNESS_RULE}}`
- Parking lot rule for non-essential ideas (entropy isolation): `{{PARKING_LOT_RULE}}`
- If context is partial or stale after restart/window switch, run `docs/audit/REANCHOR_PROMPT.md` before any durable write.

## Local Paths

- Current state: `docs/audit/CURRENT-STATE.md`
- Handoff packet: `docs/audit/HANDOFF-PACKET.md`
- Runtime digest: `docs/audit/RUNTIME-STATE.md`
- Workflow kernel: `docs/audit/WORKFLOW-KERNEL.md`
- Spec snapshot: `docs/audit/SPEC.md`
- Baseline: `docs/audit/baseline/current.md`
- Snapshot: `docs/audit/snapshots/context-snapshot.md`
- Parking lot: `docs/audit/parking-lot.md`
- Continuity guide: `docs/audit/CONTINUITY_GATE.md`
- Rule/state guide: `docs/audit/RULE_STATE_BOUNDARY.md`
- Workflow summary: `docs/audit/WORKFLOW_SUMMARY.md`
- Re-anchor prompt: `docs/audit/REANCHOR_PROMPT.md`
- Artifact manifest: `docs/audit/ARTIFACT_MANIFEST.md`
- Incidents: `docs/audit/incidents/`

## Warning

Do not redefine core workflow rules here.
If this file conflicts with `docs/audit/SPEC.md`, the spec wins.
When uncertain, reference `SPEC-Rxx` instead of re-stating canonical mechanics.
