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
workflow_version: 0.4.0
installed_pack: core
project_name: gowire
source_branch: dev
```

## Project Constraints

- Runtime/platform constraints: `Go-first codebase, TinyGo-compatible WASM runtime, avoid reflection-heavy patterns, and keep wasm bundle size under project limits.`
- Architecture constraints: `SSR-first custom elements, serializable props/events, lifecycle hooks consistency, and minimal SSR/hydration template divergence.`
- Dependency minimization constraints: `Imports must follow the minimal-dependency principle: remove unused imports, avoid broad provider root packages when a service-specific package exists, preserve side-effect imports only when justified, and validate module hygiene with go mod tidy -diff in each active module scope (root and tools).`
- Delivery constraints (CI/release/compliance): `Local quality gates include go fmt/go vet/staticcheck, explicit root+tools test coverage, Go+Node tests, and tinygo lint refresh when WASM/runtime dependencies change. CI orchestration is managed by Drone (.drone.yml).`
- Generality-first constraints: `Any runtime/hydration/dispatch fix must be component-agnostic by default. Feature-specific branches are allowed only when a feature contract is explicitly unique and documented in cycle decisions.`
- Mutation ordering constraints: `Client dispatch handling must preserve per-marker execution order (FIFO) and prevent stale result application when out-of-order responses occur.`
- Revision contract constraints: `Proxy/runtime mutation responses should carry stable marker/session metadata (markerId, sessionId, revision), and the client must ignore stale revisions.`
- Input integrity constraints: `User in-progress edits must not be lost by async mutation patches; active control value preservation must be generic and keyed by stable control identity (model key/id/name).`
- No hardcoded selectors constraints: `Avoid hardcoding business selectors tied to a single feature in shared runtime paths; prefer protocol attributes and generic model metadata.`
- Shared runtime naming constraints: `In shared/runtime files, function and variable names must remain feature-agnostic (no feature-specific naming in public helpers or orchestration paths). Feature-specific behavior, when unavoidable, must be expressed through data contracts/selectors/tags rather than helper naming.`
- Shared runtime controls constraints: `Shared runtime behavior must remain generic and reactive. Component-specific behavior is expressed through standardized feature controls/signals contracts (typed metadata + model/event descriptors), not through feature-specific branches or ad-hoc runtime policies.`
- Shared codegen boundary constraints: `internal/builder/engines/components.go` is a build-time generator driven by `internal/components/manifest.json`. It generates shared artifacts (component registers, shared client bridge `web/ce/elements.js`, wasm metadata, and generated SSR tests). Changes in this generator MUST remain generic and contract-level (events/reactivity/hydration/dispatch/patch pipeline). Component-specific DOM debugging/fixes/selectors MUST NOT be implemented in this generator or in its shared generated bridge code. If DOM behavior must change for one component, implement it in patch/mutation/component layer and record rationale in cycle decisions.`
- TC39-Go enforcement constraints: `Once TC39-Go is declared FUNCTIONAL, its implementation is non-negotiable: all components in scope must use TC39-Go contracts, and no reactivity workaround is tolerated in app/feature/example paths. Enforcement must stay blocking in CI via tc39policy and lint-reactivity-tc39.`
- Generated artifact constraints: `Do not patch generated files directly as source of truth; update generator/template sources and regenerate artifacts in the same change.`
- Concurrency test constraints: `Any runtime concurrency fix must add deterministic tests covering rapid dispatch bursts, out-of-order completion, and retry-after-failure behavior.`
- Regression safety constraints: `Every hotfix touching hydration/dispatch must pass targeted runtime JS tests, proxy tests, and at least one browser stress scenario before merge.`
- Backward compatibility constraints: `Proxy debug behavior must remain API-compatible with wasm runtime contracts unless an explicit migration decision is recorded in audit artifacts.`
- Observability constraints: `Runtime warnings/errors should stay actionable and low-noise; expected transient retry paths must not spam console errors.`

## Branch & Cycle Policy

- Source branch: `dev`
- Source branch classification: `source` (reload/reference branch only; never a cycle ownership branch).
- Session branch naming: `SXXX-<short-slug>` (no `<cycle-type>/` prefix, no cycle id in the branch name).
- Session branch policy:
  - A session is a long-lived container and MAY include multiple cycles.
  - A session branch is created once at session open from an up-to-date `dev`.
  - Reopening work in the same session MUST reuse the same session file + session branch.
  - Session PR target is `dev`; cycles are integrated into the session branch before final merge to `dev`.
  - Session handover metadata MUST be recorded in the session file (`session_branch`, `parent_session`, `parent_branch`, `continuity_basis`).

### Session Start Branch Base Gate (Mandatory, adapter extension to `SPEC-R01`/`SPEC-R03`)

- Before creating a new session branch `SXXX-*`, the agent MUST check the previous session PR status against `dev`.
- Decision order (mandatory, exclusive):
  - `PR OPEN`: default action is to continue on the existing session branch. Do not open a new session branch.
  - `PR OPEN` + explicit user override: a new session branch may be opened only after recording rationale in both session artifacts (previous + new session).
  - `PR MERGED` or `no previous session`: open the new session branch from up-to-date `dev`.
  - `PR CLOSED (not merged)`: require explicit user decision before opening a new session branch (resume/replace/drop continuity path), then record rationale.
- Session transition gate:
  - moving to a new session requires processing the previous session PR first (review/resolve/merge-or-close decision), unless explicit user override is recorded as above.
- Hard stop:
  - do not create a new session branch from another session branch by default.
- Cycle branch policy:
  - Naming: `<cycle-type>/CXXX-<slug>` (example: `feature/C037-dsl-cli-grammar-v1plus`).
  - Branch-to-cycle rule: one active cycle per cycle branch.
  - Cycle branch base MUST follow the selected continuity rule set (`R1`/`R2`/`R3`).
  - `status.md.branch_name` MUST always point to the cycle branch (never the session branch).
- Intermediate branch policy:
  - Naming: `<cycle-type>/CXXX-I##-<slug>` (must use one prefix from allowed cycle types).
  - Intermediate branches MUST be linked to a parent cycle in session/cycle artifacts.
  - Retained work path: `intermediate -> cycle -> session`.
  - Non-retained work path: no merge to session; mark cycle outcome (`NO_GO` or `DROPPED`) with rationale and archive/delete the branch.
- Allowed cycle types: `feature | hotfix | spike | refactor | structural | migration | security | perf | integration | compat | corrective`
- DoR policy: minimal core gate + adaptive checks by cycle type: `For COMMITTING on cycle/intermediate branches, require one active mapped cycle with status.md + brief.md + plan.md + decisions.md + traceability.md, scope freeze respected in IMPLEMENTING, and CR logging for requirement/scope/objective changes. Session branch commits are limited to integration/handover/PR orchestration.`

## Runtime State Policy

- Preferred runtime state mode: `dual`.
- Default install/runtime profile for this repository is `dual` with `dual-sqlite` index storage.
- `files` mode is fallback-only for local recovery or exceptional troubleshooting, not the normal execution path.
- In `dual`, workflow hooks, hydration, and DB-backed runtime checks are expected before mutating workflow state.

## Git Hygiene Gate (Mandatory, adapter extension to `SPEC-R03`)

- Goal: prevent orphan `untracked` files and cross-branch contamination while preserving existing branch/cycle gates.
- Trigger moments (all mandatory):
  - before creating any `session|cycle|intermediate` branch
  - before any branch switch used for session/cycle transitions
  - before `cycle-close`
  - before `close-session`
- Required check:
  - run `git status --porcelain`
- Decision rules:
  - if `??` entries exist outside current cycle/session scope -> STOP and require explicit decision: `commit-now | stash-now | drop-now`.
  - if `?? docs/audit/cycles/CXXX-*` belongs to the active cycle scaffold -> temporarily allowed only until first implementation starts.
  - if modified files outside current scope are present at transition time -> STOP unless user override is explicitly documented in session + CR.
- Exception policy:
  - override allowed only with explicit rationale in session artifacts and `change-requests.md` (impact `low|medium|high`).

### Cycle Scaffold Materialization Gate (Mandatory)

- Applies immediately after `cycle-create` and before entering `IMPLEMENTING`.
- Minimum artifacts for the active cycle MUST be tracked (not `untracked`):
  - `status.md`
  - `brief.md`
  - `plan.md`
  - `decisions.md`
  - `traceability.md`
- Enforcement:
  - if one of these files remains `untracked`, `dor_state` MUST stay `NOT_READY` and implementation MUST NOT start.
- Status schema note:
  - cycle `status.md` is state-oriented; reusable DoR policy text stays in `docs/audit/SPEC.md` (`SPEC-R04`) and template references.

### Session Transition Cleanliness Gate (Mandatory)

- Applies before opening a new `SXXX-*` session branch.
- In addition to `Session Start Branch Base Gate (Mandatory)`, no orphan cycle artifacts from previous cycles/sessions may remain `untracked`.
- If orphan artifacts exist, one explicit decision is required before new session start:
  - `adopt-to-current-session`
  - `archive-non-retained`
  - `drop-with-rationale`
- Record decision in both session continuity notes and relevant cycle/session CR notes.

### Dev Branch Alignment Gate (Mandatory, adapter extension to `SPEC-R09`)

- Applies:
  - immediately after any session PR merge to `dev`
  - before creating a new session branch `SXXX-*`
- Required checks:
  - `git switch dev`
  - `git fetch origin dev`
  - `git rev-list --left-right --count dev...origin/dev`
- Pass condition:
  - output must be `0 0`
- If fail (`ahead>0` or `behind>0`):
  - STOP and choose one explicit action:
    - `rebase-dev` (preserve local commits by replay)
    - `reset-dev-to-origin` (authoritative remote align; recommended for clean session start)
    - `abort-session-start`
  - create a local safety backup branch before destructive reconciliation (for example `backup/dev-before-realign-<timestamp>`)
  - record the selected action in the active session notes.

### Post-Merge Reconciliation Gate (Mandatory, adapter extension to `SPEC-R09`)

- Goal: prevent `gh pr merge` side effects from leaving local `dev` in divergent state.
- Trigger moments:
  - after `gh pr merge ...`
  - after API/UI merge while local repo remains open in the same session
- Required checks:
  - confirm PR state is `MERGED`
  - run local dev alignment checks from `Dev Branch Alignment Gate (Mandatory)`
- Enforcement:
  - no cycle/session branch creation until reconciliation succeeds (`0 0`).

## Workflow Incident Handling (Project Policy, adapter extension to `SPEC-R10`)

Canonical rules are defined in `docs/audit/SPEC.md` (`Workflow Incident Management`).
This section defines repository-local execution details.

### Incident Trigger Conditions

Open an incident triage when at least one condition is true:
- a mandatory gate fails in a non-trivial way (not a one-command local fix),
- the same workflow failure repeats in the same session or in consecutive sessions,
- a contradiction is detected between `SPEC.md` and `WORKFLOW.md`,
- branch/session continuity requires undocumented manual arbitration.

### Noise Control (Anti-Noise)

- Do **not** open temporary incident tracking for trivial one-shot fixes.
- Tracking file is required only when:
  - severity is `L2+`, or
  - recurrence count is `>= 2` in the same session.
- `L1` should be auto-fixed directly with a short note in session artifacts.

### Temporary Incident Tracking File

- Path pattern: `docs/audit/incidents/INC-TMP-<YYYYMMDD-HHMMSS>-<slug>.md`
- Content template: `docs/audit/incidents/TEMPLATE_INC_TMP.md`
- Required fields:
  - context, symptoms, root-cause hypothesis,
  - severity (`L1|L2|L3|L4`) and rationale,
  - decision path (`auto-fix` | `needs-authorization`),
  - proposed workflow patch target (`SPEC.md`/`WORKFLOW.md`),
  - `resume_from_step` checkpoint.

### Authorization Gate (Mandatory for L3/L4)

When severity is `L3` or `L4`, agent MUST stop and request an explicit choice:
- `authorize-now` (recommended): patch workflow docs now.
- `defer-with-risk`: do not patch now; continue only if compliance is not blocked.
- `abort-current-flow`: stop current implementation flow.

If `defer-with-risk` is selected:
- record rationale in session notes and incident file.
- open a follow-up cycle/task before next session start.

### Workflow Self-Improvement Scope

- Without authorization: agent may auto-repair only `L1/L2` incidents.
- With authorization (`L3/L4`): agent may patch `SPEC.md` and/or `WORKFLOW.md`.
- Any workflow patch must include:
  - contradiction check (`SPEC` precedence preserved),
  - concise rationale,
  - expected prevention effect.

### Resume and Cleanup

After incident is resolved:
- continue from `resume_from_step` in the incident file.
- update session notes with incident outcome.
- delete `INC-TMP-*` file after successful resume.
- if unresolved, keep file and mark status `OPEN`.

## Execution Speed Policy (Project Optimization)

This project uses three latency optimizations while preserving canonical safety gates from `docs/audit/SPEC.md`.

### 1) Gate classes: Hard vs Light

- Hard gates (always mandatory): branch/cycle mapping validity, continuity rule selection (`R1`/`R2`/`R3`), stop conditions, and session close validity.
- Light gates (risk-adaptive): depth of artifact updates (`plan.md`/`decisions.md`/`traceability.md` detail), breadth of validation commands, and reporting granularity.
- Rule: hard gates cannot be skipped; light gates may be reduced only under Fast Path or low-risk classification.

### 2) Fast Path for micro-changes

Fast Path is allowed when all conditions are true:
- touch scope is small (`<= 2` files changed, no structural migration).
- no API/contract/schema/security change.
- no shared codegen boundary impact (`internal/builder/engines/components.go` and generated shared bridge outputs untouched).
- no continuity ambiguity (rule already selected and recorded).

Fast Path execution:
- keep mandatory hard gates.
- use concise artifact updates (short decision + traceability entries).
- run targeted validations only (component/module-level) instead of full broad suites.

Fast Path auto-escalation to full path:
- touched files exceed threshold.
- requirement/scope drift appears.
- shared runtime/codegen boundary is touched.
- failing targeted validation indicates broader risk.

### 3) Risk-based validation profile

- `LOW` risk: targeted tests + focused lint on impacted packages/components.
- `MEDIUM` risk: targeted validations plus cross-package checks relevant to the change surface.
- `HIGH` risk: full validation stack (`make lint`, `make test`, and required runtime/browser stress checks by cycle type).

Risk classification must be recorded once in cycle/session notes before `VERIFYING`.

## Cycle Continuity Gate (Project Policy, adapter extension to `SPEC-R06`)

Canonical continuity requirements are defined in `docs/audit/SPEC.md`.
Project adapter policy below defines the preferred defaults and prompts used in this repository.

### Rule Set (choose exactly one)

1) `R1_STRICT_CHAIN` (default in COMMITTING)
- New cycle branch starts from the latest relevant active cycle branch in the same session (`OPEN | IMPLEMENTING | VERIFYING`).
- Use when cycles touch shared runtime/hydration/dispatch or other high-coupling files.

2) `R2_SESSION_BASE_WITH_IMPORT` (allowed in COMMITTING / default in EXPLORING)
- New cycle branch starts from current session branch tip.
- A predecessor cycle to import MUST be declared explicitly and merged/rebased before entering `IMPLEMENTING`.

3) `R3_EXCEPTION_OVERRIDE` (exception only)
- New cycle starts from a custom branch that is neither latest cycle branch nor session tip.
- Requires explicit rationale, risk acceptance, and `change-requests.md` entry (impact at least medium).

### Mode mapping

- `COMMITTING`: choose `R1` or `R2`; `R3` requires explicit user override.
- `EXPLORING`: choose `R2` or `R3`.
- `THINKING`: `R3` only (no production implementation allowed).

### Interactive Stop Prompt (selection list)

If mismatch is detected, the agent MUST pause and ask user to pick one option from this list:

- `R1_STRICT_CHAIN (Recommended)` — rebase/create the new cycle from latest active cycle branch.
- `R2_SESSION_BASE_WITH_IMPORT` — keep session base and declare mandatory predecessor import.
- `R3_EXCEPTION_OVERRIDE` — continue from custom base with explicit risk acceptance.

No cycle branch may be created until one option is selected and recorded in `status.md`.

Reference:
- `docs/audit/CONTINUITY_GATE.md`

## Shared Codegen Boundary Gate (Mandatory, adapter extension to `SPEC-R03`/`SPEC-R04`)

When a cycle modifies shared code generation files (including `internal/builder/engines/components.go` and its generated shared bridge outputs), the cycle MUST include an explicit boundary check before moving to `VERIFYING`.

Required evidence in cycle artifacts:
- `decisions.md`: why the change is generic codegen/bridge behavior (not component-specific debugging).
- `traceability.md`: mapping from requirement/bug to generic contract (event/reactivity/marker/session/revision), with implementation location.
- If DOM manipulation changed: explicit note that the change lives in patch/mutation/component layer (or documented exception with risk).

Hard stop:
- If proposed change is component-specific inside generator/shared generated bridge code, STOP and either:
  1. relocate change to patch/mutation/component layer, or
  2. open an explicit exception CR with impact >= medium and user approval.

## Cross-Usage Convergence Policy (Project Policy, adapter extension to `SPEC-R04` / `SPEC-R11`)

- Treat cross-usage convergence as a validation rule for shared or high-risk implementation surfaces.
- A shared or high-risk change SHOULD declare a minimal `usage_matrix` before `IMPLEMENTING`.
- A shared or high-risk change MUST NOT be considered stable from single-usage evidence only.
- Default minimum usage classes:
  - shared surface: `2`
  - high-risk surface: `3`
- At least one non-primary usage should exercise a different caller, business path, or contract shape.
- High-risk changes should include at least one context, edge, or adversarial usage.
- If a fix resolves the triggering scenario but regresses another declared usage class, treat it as overfitted and block closure.
- Prefer reusing canonical scenarios for shared surfaces instead of multiplying near-duplicate tests.
- Shared-surface defaults apply to:
  - `runtime`
  - `hydration`
  - `dispatch`
  - `codegen`
- Expected evidence artifacts:
  - `plan.md`
  - `traceability.md`
  - `status.md`

## Session Close & PR Review

- Session close and PR review gates are canonical in `docs/audit/SPEC.md` (`SPEC-R07`, `SPEC-R08`).

### CI Capacity Gate (Mandatory, project policy extension)

- Drone capacity is limited: only one PR may consume `continuous-integration/drone/pr` at a time.
- Before opening/updating/rebasing/auto-merging a PR, ensure no other PR is `pending|running` on that check.
- Dependency/security batches (Dependabot included) must be sequential: update one PR, wait CI, merge/close, then move to the next.
- Session start priority: before opening a new session branch, triage and process open security PRs first (merge/close/defer decision recorded).
- If multiple active CI PRs are detected: STOP and reduce to one.

## Snapshot Discipline

- Snapshot update trigger: `At session close and whenever baseline, active cycles, or next entry point changes.`
- Snapshot owner: `Current session agent, validated during review.`
- Freshness rule before commit/review: `Snapshot reviewed at session start and updated in the same session if branch-cycle mapping or cycle state changed.`
- Parking lot rule for non-essential ideas (entropy isolation): `Record non-essential ideas in docs/audit/parking-lot.md as IDEA-xxx and keep them out of active cycle scope.`

## Local Paths

- Spec snapshot: `docs/audit/SPEC.md`
- Baseline: `docs/audit/baseline/current.md`
- Snapshot: `docs/audit/snapshots/context-snapshot.md`
- Parking lot: `docs/audit/parking-lot.md`
- Incidents (temporary tracking): `docs/audit/incidents/`

## Warning

Do not redefine core workflow rules here.
If this file conflicts with `docs/audit/SPEC.md`, the spec wins.
When uncertain, reference `SPEC-Rxx` instead of re-stating canonical mechanics.
