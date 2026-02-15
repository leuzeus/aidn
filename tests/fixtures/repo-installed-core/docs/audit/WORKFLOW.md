# Project Workflow Adapter (Stub)

This file is the project adapter for `codex-audit-workflow`.
Use it to record repository-specific constraints and operating policy.
Core workflow rules belong to the product spec (`docs/SPEC.md` in the product repo), not here.

## Setup Checklist

- [ ] Fill `project_name`
- [ ] Fill `source_branch`
- [ ] Add project constraints
- [ ] Confirm branch & cycle policy
- [ ] Confirm snapshot discipline

## Adapter Metadata

```yaml
workflow_product: codex-audit-workflow
workflow_version: {{VERSION}}
installed_pack: core
project_name: {{PROJECT_NAME}}
source_branch: {{SOURCE_BRANCH}}
```

## Project Constraints

- Runtime/platform constraints: `{{RUNTIME_CONSTRAINTS}}`
- Architecture constraints: `{{ARCH_CONSTRAINTS}}`
- Delivery constraints (CI/release/compliance): `{{DELIVERY_CONSTRAINTS}}`

## Branch & Cycle Policy

- Source branch: `{{SOURCE_BRANCH}}`
- Cycle branch naming: `CXXX-<type>-<slug>`
- Branch-to-cycle rule: one active cycle per committing branch
- Allowed cycle types: `{{ALLOWED_CYCLE_TYPES}}`

## Snapshot Discipline

- Snapshot update trigger: `{{SNAPSHOT_TRIGGER}}`
- Snapshot owner: `{{SNAPSHOT_OWNER}}`
- Freshness rule before commit/review: `{{SNAPSHOT_FRESHNESS_RULE}}`

## Local Paths

- Baseline: `docs/audit/baseline/current.md`
- Snapshot: `docs/audit/snapshots/context-snapshot.md`
- Parking lot: `docs/audit/parking-lot.md`

## Warning

Do not redefine core workflow rules here.
If this file conflicts with product rules, the product rules win.
