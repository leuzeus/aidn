# Project Workflow Adapter (Stub)

This file is a project-level adapter for `codex-audit-workflow`.
It records local constraints and decisions for this repository.
It is not the official workflow spec and must not redefine core workflow rules.

## Setup Checklist

- [ ] Set `project_name`
- [ ] Set `source_branch`
- [ ] Fill constraints (SSR/WASM/etc)
- [ ] Confirm cycle policy
- [ ] Confirm snapshot policy

## Adapter Metadata

```yaml
workflow_product: codex-audit-workflow
workflow_version: {{VERSION}}
installed_pack: core
project_name: {{PROJECT_NAME}}
source_branch: {{SOURCE_BRANCH}}
```

## Project Constraints

Document practical constraints for this repository only.

- Runtime/Platform constraints: `{{RUNTIME_CONSTRAINTS}}`
- Architecture constraints: `{{ARCH_CONSTRAINTS}}`
- Delivery constraints (CI, release, compliance): `{{DELIVERY_CONSTRAINTS}}`

## Branch & Cycle Policy

- Source branch for long-lived work: `{{SOURCE_BRANCH}}`
- Branch naming format for cycle work: `CXXX-<type>-<slug>`
- Cycle mapping rule: exactly one active cycle per committing branch
- Allowed cycle types in this project: `{{ALLOWED_CYCLE_TYPES}}`

## Snapshot Discipline

- Snapshot update trigger: `{{SNAPSHOT_TRIGGER}}`
- Snapshot owner/responsibility: `{{SNAPSHOT_OWNER}}`
- Required freshness before commit/review: `{{SNAPSHOT_FRESHNESS_RULE}}`

## Local Paths

- Baseline: `docs/audit/baseline/current.md`
- Snapshot: `docs/audit/snapshots/context-snapshot.md`
- Parking lot: `docs/audit/parking-lot.md`

## Warning

Do not redefine core workflow rules here.
If this file conflicts with workflow product rules, the product rules win.
