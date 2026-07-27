# Synthetic Workflow Adapter Migration Fixture

This tracked file is a deliberately synthetic parser corpus. It is not an
installed client and contains no external project evidence.

## Adapter Metadata

```yaml
workflow_product: aidn-workflow
workflow_version: 0.6.0
installed_pack: core
project_name: synthetic-migration-fixture
source_branch: dev
```

## Project Constraints

- Runtime/platform constraints: `Portable runtime with deterministic startup and bounded resource use.`
- Architecture constraints: `Layered components with serializable boundaries and minimal projection divergence.`
- Delivery constraints (CI/release/compliance): `CI orchestration is capacity-limited, deterministic, and serial for conflicting changes.`
- Dependency minimization constraints: `Imports must follow the minimal-dependency principle and unused dependencies must be removed.`
- Shared codegen boundary constraints: `The generator at src/generators/shared-component.mjs reads src/contracts/component-manifest.json and produces dist/runtime-elements.js plus tests/generated/runtime-rendering.test.mjs. Changes must remain generic and component-specific fixes MUST NOT be implemented in this generator.`
- Generated artifact constraints: `Update generator sources and regenerate outputs; do not patch generated files as canonical sources.`

## Branch & Cycle Policy

- Source branch: `dev`
- DoR policy: `Session branch commits are limited to integration/handover/PR orchestration.`

## Runtime State Policy

- Preferred runtime state mode: `dual`
- Default install/runtime index store: `dual-sqlite`

### Session Transition Cleanliness Gate (Mandatory)

Before a new session starts, unresolved artifacts require one explicit decision:

  - `adopt-to-current-session`
  - `archive-non-retained`
  - `drop-with-rationale`

## Workflow Incident Handling (Project Policy, adapter extension to `SPEC-R10`)

### Incident Trigger Conditions

Open an incident when a mandatory gate fails repeatedly or policy sources
contradict each other.

### Noise Control (Anti-Noise)

Keep trivial one-shot repairs out of incident tracking unless they repeat.

### Temporary Incident Tracking File

Record context, severity, decision path, and `resume_from_step`.

### Authorization Gate (Mandatory for L3/L4)

Choose `authorize-now`, `defer-with-risk`, or `abort-current-flow`.

### Workflow Self-Improvement Scope

Preserve canonical precedence and record prevention rationale.

### Resume and Cleanup

Resume the recorded step and archive resolved temporary evidence.

## Execution Speed Policy (Project Optimization)

Evaluate fast-path eligibility at the concrete dispatch/local execution scope.
In multi-agent contexts, evaluate fast-path eligibility at the concrete
dispatch/local execution scope before assigning parallel work.

### 1) Gate classes: Hard vs Light

- Hard gates (always mandatory): branch/cycle mapping validity, continuity rule selection, and stop conditions.
- Light gates (risk-adaptive): breadth of validation commands, artifact detail, and reporting granularity.

### 2) Fast Path for micro-changes

Fast Path is allowed when all conditions are true:

- touch scope is small (`<= 2` files changed).
- no API/contract/schema/security change.
- no shared codegen boundary impact.
- no continuity ambiguity.

Fast Path auto-escalation:

- touched files exceed threshold.
- requirement/scope drift appears.
- shared runtime/codegen boundary is touched.

### 3) Risk-based validation profile

- `LOW` risk: targeted tests.
- `MEDIUM` risk: targeted validations plus cross-package checks.
- `HIGH` risk: full validation stack.

## Cycle Continuity Gate (Project Policy, adapter extension to `SPEC-R06`)

### Rule Set (choose exactly one)

- `R1_STRICT_CHAIN`
- `R2_SESSION_BASE_WITH_IMPORT`
- `R3_EXCEPTION_OVERRIDE`

### Mode mapping

Use the canonical mode policy for the selected rule.

### Interactive Stop Prompt (selection list)

Stop until one continuity rule is selected and recorded.

## Shared Codegen Boundary Gate (Mandatory, adapter extension to `SPEC-R03`/`SPEC-R04`)

Treat this area as a shared integration surface.

Generator surfaces:

- `src/generators/shared-component.mjs`
- `src/contracts/component-manifest.json`
- `dist/runtime-elements.js`
- `tests/generated/runtime-rendering.test.mjs`

Required evidence in cycle artifacts:

- `decisions.md`: why behavior is generic.
- `traceability.md`: mapping from requirements to generated outputs.
- explicit note that the change lives in patch/mutation/component layer when it
  is component-specific.
- impact >= medium and user approval for an exception.

Component-specific inside generator/shared generated bridge code is forbidden.

## Cross-Usage Convergence Policy (Project Policy, adapter extension to `SPEC-R04` / `SPEC-R11`)

Shared-surface defaults apply to:

  - `runtime`
  - `hydration`
  - `dispatch`
  - `codegen`

Expected evidence artifacts:

  - `plan.md`
  - `traceability.md`
  - `status.md`

- Minimum distinct usage classes for a shared surface: `2`.
- Minimum distinct usage classes for a high-risk surface: `3`.
- At least one non-primary usage should exercise the shared behavior.
- High-risk changes should include at least one context, edge, or adversarial usage.
- If the primary scenario passes but another required usage fails, treat it as overfitted and block closure.

## CI Capacity Gate (Mandatory, project policy extension)

- CI capacity is limited: only one conflicting change may consume the constrained lane at a time.
- Automated dependency/security batches must be sequential.

## Snapshot Discipline

- Snapshot update trigger: `At session close and whenever baseline, active cycles, or next entry point changes.`
- Snapshot owner: `Current session agent, validated during review.`
- Freshness rule before commit/review: `Review the snapshot at session start and update it when branch-cycle state changes.`
- Parking lot rule for non-essential ideas (entropy isolation): `Record non-essential ideas in docs/audit/parking-lot.md.`
