# Project Workflow Adapter (Stub)

This file is the project adapter for `aidn-workflow`.
Use it to record repository-specific constraints and operating policy.
Core workflow rules belong to `docs/audit/SPEC.md`, not here.
Its role is to reduce local ambiguity and keep AI behavior stable.

## Recommended Read Order (Fast Reload)

1. `docs/audit/SPEC.md`
2. `docs/audit/WORKFLOW_SUMMARY.md`
3. `docs/audit/WORKFLOW.md`

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

- Runtime/platform constraints: `{{RUNTIME_CONSTRAINTS}}`
- Architecture constraints: `{{ARCH_CONSTRAINTS}}`
- Dependency/data constraints: `{{DEPENDENCY_CONSTRAINTS}}`
- Delivery constraints (CI/release/compliance): `{{DELIVERY_CONSTRAINTS}}`
- Generated artifact constraints: `{{GENERATED_ARTIFACT_CONSTRAINTS}}`
- Testing/regression constraints: `{{TEST_REGRESSION_CONSTRAINTS}}`

## Branch & Cycle Policy

- Source branch: `{{SOURCE_BRANCH}}`
- Source branch classification: `source` (reload/reference branch only; never a cycle ownership branch).
- Session branch naming: `SXXX-<short-slug>`
- Cycle branch naming: `<cycle-type>/CXXX-<slug>`
- Intermediate branch naming: `<cycle-type>/CXXX-I##-<slug>`
- Allowed cycle types: `feature | hotfix | spike | refactor | structural | migration | security | perf | integration | compat | corrective`
- DoR policy: `{{DOR_POLICY}}`

### Session Start Branch Base Gate (Mandatory, adapter extension to `SPEC-R01`/`SPEC-R03`)

- Before creating a new session branch `SXXX-*`, check previous session PR status against source branch.
- Decision order:
  - `PR OPEN`: continue on existing session branch by default.
  - `PR OPEN` + explicit user override: new session branch allowed with documented rationale.
  - `PR MERGED` or `no previous session`: open new session branch from up-to-date source branch.
  - `PR CLOSED (not merged)`: require explicit user decision before opening a new session branch.
- Hard stop: do not chain session branches by default.

### Git Hygiene Gate (Mandatory, adapter extension to `SPEC-R03`)

- Run `git status --porcelain` before branch creation/switch, `cycle-close`, and `close-session`.
- If out-of-scope untracked/modified files exist, stop and require explicit decision (`commit-now | stash-now | drop-now`).
- Record overrides in session/cycle artifacts with impact level.

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

## Workflow Incident Handling (Project Policy, adapter extension to `SPEC-R10`)

- Trigger incident triage on repeated workflow failures, rule contradictions, or unresolved branch continuity conflicts.
- Use temporary incident tracking file:
  - `docs/audit/incidents/INC-TMP-<YYYYMMDD-HHMMSS>-<slug>.md`
  - Template: `docs/audit/incidents/TEMPLATE_INC_TMP.md`
- Severity policy:
  - `L1/L2`: auto-fix allowed with traceability.
  - `L3/L4`: explicit user authorization required before workflow rule changes.

## Cycle Continuity Gate (Project Policy, adapter extension to `SPEC-R06`)

- Select exactly one rule per cycle creation mismatch:
  - `R1_STRICT_CHAIN`
  - `R2_SESSION_BASE_WITH_IMPORT`
  - `R3_EXCEPTION_OVERRIDE`
- Record decision in cycle `status.md` continuity fields.
- Reference: `docs/audit/CONTINUITY_GATE.md`

## Session Close & PR Review

- Session close and PR review gates are canonical in `docs/audit/SPEC.md` (`SPEC-R07`, `SPEC-R08`).
- Add local CI/review capacity policy here if your repository needs it.

## Snapshot Discipline

- Snapshot update trigger: `{{SNAPSHOT_TRIGGER}}`
- Snapshot owner: `{{SNAPSHOT_OWNER}}`
- Freshness rule before commit/review: `{{SNAPSHOT_FRESHNESS_RULE}}`
- Parking lot rule for non-essential ideas (entropy isolation): `{{PARKING_LOT_RULE}}`

## Local Paths

- Spec snapshot: `docs/audit/SPEC.md`
- Baseline: `docs/audit/baseline/current.md`
- Snapshot: `docs/audit/snapshots/context-snapshot.md`
- Parking lot: `docs/audit/parking-lot.md`
- Continuity guide: `docs/audit/CONTINUITY_GATE.md`
- Rule/state guide: `docs/audit/RULE_STATE_BOUNDARY.md`
- Workflow summary: `docs/audit/WORKFLOW_SUMMARY.md`
- Incidents: `docs/audit/incidents/`

## Warning

Do not redefine core workflow rules here.
If this file conflicts with `docs/audit/SPEC.md`, the spec wins.
When uncertain, reference `SPEC-Rxx` instead of re-stating canonical mechanics.
