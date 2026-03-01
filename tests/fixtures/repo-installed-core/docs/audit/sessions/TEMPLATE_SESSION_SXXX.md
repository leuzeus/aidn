# Session SXXX — 2026-02-07

Rule/State boundary:
- This file is a state artifact (session facts, decisions, pointers).
- Canonical workflow rules stay in `docs/audit/SPEC.md` and local extensions in `docs/audit/WORKFLOW.md`.
- Keep rule text as references, not duplicated policy prose.

------------------------------------------------------------
## WORK MODE (required)

[ ] THINKING      (documentation only, no durable code)
[ ] EXPLORING     (code allowed, may be throwaway)
[ ] COMMITTING    (production intent, cycle required)

### Auto-detected mode (agent)
- Proposed:
- Confidence: low | medium | high
- Reasons:
  1)
  2)
- User override: (if needed)

If COMMITTING:
- Active Cycle ID: (current focus; optional if integration-only)
- Branch:
- scope_frozen: true | false

### Session Branch Continuity (required)
- session_branch: `SXXX-<short-slug>`
- parent_session: SXXX (or `none` for first session in chain)
- parent_branch:
- continuity_basis: `rebase-from <commit>` | `merge-from <branch>` | `ff-from <branch>`
- continuity_check: pass | fail

### Branch Context (required for COMMITTING)
- branch_kind: `session` | `cycle` | `intermediate`
- cycle_branch: `<cycle-type>/CYYY-<short-slug>` | `none`
- intermediate_branch: `<cycle-type>/CYYY-I##-<short-slug>` | `none`
- integration_target_cycle: `CYYY` | `none`

### Session Cycle Tracking (required for COMMITTING)
- attached_cycles: `CYYY, CZZZ` | `none`
- reported_from_previous_session: `none` | `CYYY, CZZZ`
- carry_over_pending: yes | no

------------------------------------------------------------
## CONTEXT RELOAD (auto)

- Baseline version:
- Active cycles:
- Current branch:
- Snapshot reviewed: yes/no
- Open gaps:
- Critical hypotheses:

------------------------------------------------------------
## SESSION OBJECTIVE (1 clear sentence)

------------------------------------------------------------
## TIME BUDGET
- 30 min | 1h | 2h | other:

------------------------------------------------------------
## PLANNED OUTPUTS
- [ ] Code
- [ ] Documentation
- [ ] Update audit-spec
- [ ] Update hypotheses
- [ ] Create/Update cycle
- [ ] Parking lot entry
- [ ] Recovery clarification

------------------------------------------------------------
## ACTIVE WORK (during session)

### Changes made
- 

### Decisions taken
- 

### Hypotheses added/updated
- HYP-XXX:

### Change Requests (if any)
- CR-XXX:

------------------------------------------------------------
## OVERFLOW / DRIFT CHECK

1) Can I explain the objective in 1 sentence?
2) Did I expand scope?
3) Did I touch unexpected modules?
4) Would future-me understand this in 2 weeks?

If drift detected → fill Recovery section.

------------------------------------------------------------
## RECOVERY (if needed)

### What changed?
- 

### What is the real objective now?
- 

### Keep / Discard
Keep:
- 
Discard:
- 

### Split suggestion
- New cycle?
- Spike?
- Structural?

------------------------------------------------------------
## SESSION CLOSE REPORT (required)

### Outputs
- 

### Open loops
- 

### Blockers
- 

### Cycle Resolution At Session Close (required)
- `CYYY` | state: `OPEN|IMPLEMENTING|VERIFYING|DONE` | decision: `integrate-to-session|report|close-non-retained|cancel-close` | target session: `SXXX|none` | rationale:

### Next Entry Point (resume in <5 minutes)
1) 
2) 
3) 

### Session close gate satisfied?
- [ ] Yes

### Snapshot updated?
- [ ] Yes
