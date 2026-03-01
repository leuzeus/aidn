# Workflow Summary (Quick Reload)

Purpose: fast operational reload before reading full `docs/audit/WORKFLOW.md`.

Canonical precedence:
- `docs/audit/SPEC.md` (canonical mechanics)
- `docs/audit/WORKFLOW.md` (project adapter, local extensions)
- `AGENTS.md` (execution contract)

Read order for session start:
1. `docs/audit/SPEC.md` (Rule Index + start/commit/close gates)
2. `docs/audit/WORKFLOW_SUMMARY.md` (this page)
3. `docs/audit/WORKFLOW.md` (full local policy details)

## Branch Model
- `source`: configured source branch (reload/reference branch; never cycle ownership)
- `session`: `SXXX-<slug>`
- `cycle`: `<cycle-type>/CXXX-<slug>`
- `intermediate`: `<cycle-type>/CXXX-I##-<slug>`

## Mandatory Gates by Phase

Session start:
- Run `context-reload` then `start-session` (`SPEC-R01`)
- If mode is COMMITTING: run `branch-cycle-audit` and ensure valid branch ownership mapping (`SPEC-R03`)

Committing execution:
- Work must belong to a cycle (`SPEC-R03`)
- DoR core/adaptive checks must be satisfied before implementation (`SPEC-R04`)
- Drift suspicion requires `drift-check` (`SPEC-R05`)
- Cycle continuity rule must be explicit (`R1`/`R2`/`R3`, `SPEC-R06`)

Session close:
- Resolve each open attached cycle explicitly (`integrate-to-session` | `report` | `close-non-retained` | `cancel-close`) (`SPEC-R07`)
- Run `close-session`

Merge/review:
- Codex review threads triaged with evidence (`SPEC-R08`)
- Post-merge local sync required before new branch creation (`SPEC-R09`)
- Project-specific CI capacity gates may apply (if defined in `WORKFLOW.md`)

Incident handling:
- Severity-based incident policy applies (`SPEC-R10`)

## Stop Conditions (Quick)
- Branch mapping ambiguous/unmapped in COMMITTING
- Structural/architecture, DB schema, security, or medium/high-impact CR without explicit decision
- Contradictory requirements requiring arbitration

## State vs Rule Boundary
- Rules live in `SPEC.md` and adapter extensions in `WORKFLOW.md`.
- State files (`snapshot`, `baseline`, `cycles/*/status.md`, `sessions`) stay declarative and reference canonical rules.

## Next Entry Checklist
- Confirm current branch kind
- Confirm active cycle/session mapping
- Confirm snapshot freshness
- Confirm intended mode and required gates
