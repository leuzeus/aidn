# Workflow Summary (Quick Reload)

Purpose: fast operational reload after the minimal re-anchor path.

Canonical precedence:
- `docs/audit/SPEC.md` (canonical mechanics)
- `docs/audit/WORKFLOW.md` (project adapter, local extensions)
- `AGENTS.md` (execution contract)

Minimal re-anchor path:
0. `docs/audit/HANDOFF-PACKET.md` when another agent already prepared a relay
0b. run `npx aidn runtime handoff-admit --target . --json` when a relay packet is present
0c. `docs/audit/MULTI-AGENT-STATUS.md` when a short coordinator-facing digest is enough
0d. `docs/audit/INTEGRATION-RISK.md` when several session cycles may converge
1. `docs/audit/CURRENT-STATE.md`
2. `docs/audit/WORKFLOW-KERNEL.md`
3. `docs/audit/WORKFLOW_SUMMARY.md` (this page)
4. `docs/audit/RUNTIME-STATE.md` when runtime freshness or repair signals matter

Detailed read order when more context is needed:
0. `docs/audit/HANDOFF-PACKET.md` when relevant
0b. run `npx aidn runtime handoff-admit --target . --json` when relevant
0c. `docs/audit/MULTI-AGENT-STATUS.md` when relevant
0d. `docs/audit/INTEGRATION-RISK.md` when relevant
1. `docs/audit/CURRENT-STATE.md`
2. `docs/audit/WORKFLOW-KERNEL.md`
3. `docs/audit/WORKFLOW_SUMMARY.md`
4. `docs/audit/RUNTIME-STATE.md`
5. `docs/audit/WORKFLOW.md`
6. `docs/audit/SPEC.md` (Rule Index + canonical rule details)

## Branch Model
- `source`: configured source branch (reload/reference branch; never cycle ownership)
- `session`: `SXXX-<slug>`
- `cycle`: `<cycle-type>/CXXX-<slug>`
- `intermediate`: `<cycle-type>/CXXX-I##-<slug>`

## Mandatory Gates by Phase

Session start:
- Run `context-reload` then `start-session` (`SPEC-R01`)
- `start-session` begins with blocking admission: it may stop for non-compliant branches, unresolved continuity, or multi-cycle arbitration before any new session/cycle creation.
- If mode is COMMITTING: run `branch-cycle-audit` and ensure valid branch ownership mapping (`SPEC-R03`)
- `branch-cycle-audit` reuses the same branch/session/cycle mapping layer and stops before generic gating when ownership is missing or ambiguous.
- If runtime state mode is `dual`/`db-only`: run skill perf hooks in strict mode (DB-backed checks are mandatory)

Committing execution:
- Work must belong to a cycle (`SPEC-R03`)
- DoR core/adaptive checks must be satisfied before implementation (`SPEC-R04`)
- Drift suspicion requires `drift-check` (`SPEC-R05`)
- Cycle continuity rule must be explicit (`R1`/`R2`/`R3`, `SPEC-R06`)

Session close:
- Resolve each open attached cycle explicitly (`integrate-to-session` | `report` | `close-non-retained` | `cancel-close`) (`SPEC-R07`)
- Run `close-session`
- In `dual`/`db-only`, session close MUST execute DB-backed constraint chain (`constraint-report -> thresholds -> actions -> history -> trend -> lot-plan -> summaries`)

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
- Missing mode, active cycle, `dor_state`, or first implementation step before durable write in `COMMITTING`

## State vs Rule Boundary
- Rules live in `SPEC.md` and adapter extensions in `WORKFLOW.md`.
- State files (`snapshot`, `baseline`, `cycles/*/status.md`, `sessions`) stay declarative and reference canonical rules.

## Next Entry Checklist
- Confirm `CURRENT-STATE.md` freshness
- Confirm `HANDOFF-PACKET.md.handoff_status` when another agent left a relay
- Confirm `HANDOFF-PACKET.md.transition_policy_status=allowed` when another agent left a relay
- Confirm `RUNTIME-STATE.md.current_state_freshness` when available
- Confirm current branch kind
- Confirm active cycle/session mapping
- Confirm snapshot freshness
- Confirm intended mode and required gates
- Confirm first implementation step before durable write
