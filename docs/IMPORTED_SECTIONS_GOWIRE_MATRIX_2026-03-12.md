# Imported Sections Mapping Matrix - `gowire`

Date: 2026-03-12
Status: active reference
Scope: classify each current `gowire` imported section by native target, parity status, and multi-agent scope before legacy retirement.

Reference plan:

- `docs/PLAN_IMPORTED_SECTIONS_NATIVE_MIGRATION_2026-03-12.md`

## Matrix

| Legacy Section | Classification | Native Target | Multi-Agent Scope | Canonical Parity | Notes |
|---|---|---|---|---|---|
| `Session Transition Cleanliness Gate (Mandatory)` | `adapter-structured` | `sessionPolicy.transitionCleanliness` | `session-topology` | `project-only` | Retain as project adapter policy. Must not assume one session = one cycle. |
| `Incident Trigger Conditions` | `native-core` | `docs/SPEC.md#SPEC-R10` + `template/docs_audit/PROJECT_WORKFLOW.md` | `dispatch-scope` | `covered` | Imported duplication can be removed after migration. |
| `Noise Control (Anti-Noise)` | `native-core` | `docs/SPEC.md#SPEC-R10` + `template/docs_audit/PROJECT_WORKFLOW.md` | `dispatch-scope` | `covered` | Canonical behavior covers `L1` low-noise handling and `L2+` tracked incidents. |
| `Temporary Incident Tracking File` | `native-core` | `template/docs_audit/incidents/TEMPLATE_INC_TMP.md` + `template/docs_audit/PROJECT_WORKFLOW.md` | `dispatch-scope` | `covered` | Required fields already live in the template. |
| `Authorization Gate (Mandatory for L3/L4)` | `native-core` | `docs/SPEC.md#SPEC-R10` + `template/docs_audit/incidents/TEMPLATE_INC_TMP.md` | `dispatch-scope` | `covered` | `authorize-now`, `defer-with-risk`, `abort-current-flow` are already canonicalized. |
| `Workflow Self-Improvement Scope` | `native-core` | `docs/SPEC.md#SPEC-R10` + `template/docs_audit/PROJECT_WORKFLOW.md` | `dispatch-scope` | `covered` | Project-local duplication only. |
| `Resume and Cleanup` | `native-core` | `docs/SPEC.md#SPEC-R10` + `template/docs_audit/incidents/TEMPLATE_INC_TMP.md` | `dispatch-scope` | `covered` | Resume path and cleanup are already native. |
| `Execution Speed Policy (Project Optimization)` | `adapter-structured` | `executionPolicy` | `dispatch-scope` | `project-only` | Valuable local optimization policy. Must be evaluated per dispatch/local scope. |
| `1) Gate classes: Hard vs Light` | `adapter-structured` | `executionPolicy.hardGates` + `executionPolicy.lightGates` | `dispatch-scope` | `project-only` | Promoted with conservative multi-agent escalation. |
| `2) Fast Path for micro-changes` | `adapter-structured` | `executionPolicy.fastPath` | `dispatch-scope` | `project-only` | Must escalate when parallel cycles or shared surfaces are present. |
| `3) Risk-based validation profile` | `adapter-structured` | `executionPolicy.validationProfiles` | `dispatch-scope` | `project-only` | Remains project policy unless generalized later. |
| `Rule Set (choose exactly one)` | `native-core` | `docs/SPEC.md#SPEC-R06` + `template/docs_audit/CONTINUITY_GATE.md` | `dispatch-scope` | `covered` | Already canonical. |
| `Mode mapping` | `native-core` | `docs/SPEC.md#SPEC-R06` + `template/docs_audit/CONTINUITY_GATE.md` | `dispatch-scope` | `covered` | Already canonical. |
| `Interactive Stop Prompt (selection list)` | `native-core` | `template/docs_audit/CONTINUITY_GATE.md` + cycle-create skill wording | `dispatch-scope` | `covered` | Already canonical. |
| `Shared Codegen Boundary Gate (Mandatory, adapter extension to \`SPEC-R03\`/\`SPEC-R04\`)` | `adapter-structured` | `specializedGates.sharedCodegenBoundary` | `shared-integration-surface` | `project-only` | High-value project rule. Must stay adapter-owned and multi-agent aware. |

## Parity Notes

### Incident Blocks

Canonical parity is considered sufficient because:

- `docs/SPEC.md` already defines:
  - incident trigger conditions
  - severity model
  - decision policy
  - resume and cleanup
- `template/docs_audit/PROJECT_WORKFLOW.md` already defines project-facing incident entry rules
- `template/docs_audit/incidents/TEMPLATE_INC_TMP.md` already carries the required incident tracking fields

The only acceptable migration direction is:

- keep these rules canonical
- stop preserving them as legacy imported prose

### Continuity Blocks

Canonical parity is considered sufficient because:

- `docs/SPEC.md` defines `R1/R2/R3`
- `template/docs_audit/CONTINUITY_GATE.md` defines:
  - rule descriptions
  - mode mapping
  - selectable prompt
- cycle-create runtime/skill docs already use the same selection model

The only acceptable migration direction is:

- keep continuity wording canonical
- stop preserving the duplicate project legacy blocks

## Multi-Agent Interpretation

The matrix deliberately distinguishes:

- `session-topology`
- `dispatch-scope`
- `shared-integration-surface`

Reason:

- `aidn` already supports plural session topology and explicit dispatch scope
- promoted adapter fields must reuse that philosophy
- execution policy must not become a session-wide shortcut when several cycles or agents are active
- shared codegen must be treated as a high-collision integration surface in multi-agent contexts
