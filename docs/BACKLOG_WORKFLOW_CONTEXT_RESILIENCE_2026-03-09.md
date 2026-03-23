# Backlog Workflow Context Resilience - 2026-03-09

## Goal

Track concrete follow-up changes for the installed `aidn` workflow resilience plan.

Reference plan:

- `docs/PLAN_WORKFLOW_CONTEXT_RESILIENCE_2026-03-09.md`

## Backlog Items

### WCR-01 - Add `WORKFLOW-KERNEL.md` Template

Status: completed
Priority: high

Files:

- `scaffold/docs_audit/WORKFLOW-KERNEL.md`

Why:

- create a shortest safe reload path

Done when:

- installed repo contains the file
- file is shorter than `WORKFLOW_SUMMARY.md`
- file contains hard stop rules and minimal read order

Progress note:

- `WORKFLOW-KERNEL.md` exists in scaffold and installed fixtures as the shortest safe reload path
- template and fixture verification confirm it is present and referenced by the surrounding workflow docs

### WCR-02 - Add `CURRENT-STATE.md` Template

Status: completed
Priority: high

Files:

- `scaffold/docs_audit/CURRENT-STATE.md`

Why:

- unify operational state for humans and assistants

Done when:

- file structure is defined
- active session / cycle / DoR / runtime mode fields exist
- top decisions / hypotheses / gaps / CRs are represented

Progress note:

- `CURRENT-STATE.md` now exists in scaffold and installed fixtures with active session/cycle, mode, DoR, repair/runtime fields, and top operational summaries
- dedicated consistency and skill-coverage verifiers keep it aligned with snapshot/session/cycle artifacts

### WCR-03 - Add `REANCHOR_PROMPT.md`

Status: completed
Priority: high

Files:

- `scaffold/docs_audit/REANCHOR_PROMPT.md`

Why:

- standardize restart behavior after context loss

Done when:

- file defines mandatory read list
- file defines explicit restatement before write
- file defines stop condition on missing context

Progress note:

- `REANCHOR_PROMPT.md` now exists in scaffold and installed fixtures and defines the mandatory read order, pre-write restatement, and stop-on-missing-context behavior

### WCR-04 - Add `ARTIFACT_MANIFEST.md`

Status: completed
Priority: medium

Files:

- `scaffold/docs_audit/ARTIFACT_MANIFEST.md`

Why:

- reduce missed artifact classes during partial reload

Done when:

- decisions, hypotheses, CR, traceability, runtime signals are all mapped

Progress note:

- `ARTIFACT_MANIFEST.md` now maps the main workflow artifact classes and is referenced by current-state and index/reload paths

### WCR-05 - Update `WORKFLOW_SUMMARY.md`

Status: completed
Priority: high

Files:

- `scaffold/docs_audit/WORKFLOW_SUMMARY.md`

Why:

- route assistants toward the new minimal reload path

Done when:

- summary references `WORKFLOW-KERNEL.md`
- summary references `CURRENT-STATE.md`
- first-entry checklist is aligned with pre-write behavior

Progress note:

- `WORKFLOW_SUMMARY.md` now routes readers toward `CURRENT-STATE.md`, `WORKFLOW-KERNEL.md`, and the pre-write discipline

### WCR-06 - Update `index.md`

Status: completed
Priority: medium

Files:

- `scaffold/docs_audit/index.md`

Why:

- make the audit root self-routing

Done when:

- fast reload section includes kernel and current state

Progress note:

- `index.md` now self-routes toward the fast reload artifacts, including `WORKFLOW-KERNEL.md`, `CURRENT-STATE.md`, and `ARTIFACT_MANIFEST.md`

### WCR-07 - Add `Pre-Write Gate` To `AGENTS.md`

Status: completed
Priority: high

Files:

- `scaffold/root/AGENTS.md`

Why:

- prevent durable writes from bypassing workflow re-anchoring

Done when:

- required fields before durable write are explicit
- durable write examples include `apply_patch`
- incomplete workflow context becomes a hard stop for writing

Progress note:

- root `AGENTS.md` now contains an explicit pre-write gate with durable write examples including `apply_patch`
- installed fixtures and template verification cover that contract

### WCR-08 - Add `No Plan, No Write` Wording

Status: completed
Priority: high

Files:

- `scaffold/root/AGENTS.md`
- `scaffold/docs_audit/WORKFLOW-KERNEL.md`
- `scaffold/docs_audit/WORKFLOW_SUMMARY.md`

Why:

- reduce coding without explicit implementation readiness

Done when:

- assistants must state the first implementation step before durable write

Progress note:

- the root contract and kernel/summary docs now enforce the “no plan, no durable write” rule through first-step restatement before writing

### WCR-09 - Surface Runtime Digest For `dual` / `db-only`

Status: completed
Priority: medium

Files:

- `scaffold/docs_audit/CURRENT-STATE.md`
- or a dedicated runtime digest artifact if needed

Why:

- make DB-backed workflow context readable in one place

Done when:

- `runtime_state_mode`
- `repair_layer_status`
- `blocking_findings`
- `last hydration`

are visible in the operational summary path

Progress note:

- runtime digest visibility was implemented through the dedicated short artifact `RUNTIME-STATE.md`, referenced directly from `CURRENT-STATE.md`, `AGENTS.md`, skills, and re-anchor docs

### WCR-10 - Define `apply_patch` Guidance For Recent Codex Windows Usage

Status: completed
Priority: high

Files:

- `scaffold/root/AGENTS.md`
- `scaffold/docs_audit/REANCHOR_PROMPT.md`

Why:

- observed tool behavior lowers friction to write before thinking

Done when:

- `apply_patch` is treated as durable write
- guidance is workflow-first, not tool-blaming
- read-only next step is mandated when context is incomplete

Progress note:

- `AGENTS.md`, `REANCHOR_PROMPT.md`, `README_CodexOnline.md`, and troubleshooting now treat `apply_patch` as a durable write
- the guidance is framed as workflow drift and re-anchor discipline, not as a tool-specific blame model

## Sequencing Recommendation

1. WCR-01
2. WCR-02
3. WCR-03
4. WCR-05
5. WCR-06
6. WCR-07
7. WCR-08
8. WCR-10
9. WCR-04
10. WCR-09

## Open Questions

- Should `CURRENT-STATE.md` be updated directly by skills, by runtime projection, or both?
- Should runtime digest live inside `CURRENT-STATE.md` or in a separate short file?
- How strict should the pre-write gate be for `THINKING` doc-only edits?
- Should `apply_patch` wording stay generic for all local Codex environments or explicitly mention Windows?
