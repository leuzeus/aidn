# Artifact Manifest

Purpose: tell an assistant where to read each workflow concern after installation.

Use this file when the workflow context is incomplete or when an assistant must decide which artifact to open next.

## Minimal Re-Anchor Path

If another agent prepared a handoff:

1. `docs/audit/HANDOFF-PACKET.md`
2. `docs/audit/CURRENT-STATE.md`
3. `docs/audit/WORKFLOW-KERNEL.md`

Default path:

1. `docs/audit/CURRENT-STATE.md`
2. `docs/audit/WORKFLOW-KERNEL.md`
3. `docs/audit/WORKFLOW_SUMMARY.md`

If more detail is needed:

4. `docs/audit/WORKFLOW.md`
5. `docs/audit/SPEC.md`

## State Map

### Current operational summary

- Primary file: `docs/audit/CURRENT-STATE.md`
- Agent-to-agent handoff digest: `docs/audit/HANDOFF-PACKET.md`
- Agent adapter roster: `docs/audit/AGENT-ROSTER.md`
- Agent adapter contract: `docs/audit/AGENT-ADAPTERS.md`
- Agent adapter health summary: `docs/audit/AGENT-HEALTH-SUMMARY.md`
- Agent selection summary: `docs/audit/AGENT-SELECTION-SUMMARY.md`
- Multi-agent status digest: `docs/audit/MULTI-AGENT-STATUS.md`
- Example external adapters: `.aidn/runtime/agents/`
- Coordination digest: `docs/audit/COORDINATION-SUMMARY.md`
- Coordinator routing history: `docs/audit/COORDINATION-LOG.md`
- User arbitration trace: `docs/audit/USER-ARBITRATION.md`
- Fallbacks:
  - `docs/audit/snapshots/context-snapshot.md`
  - `docs/audit/baseline/current.md`
  - active session file
  - active cycle `status.md`

### Canonical workflow rules

- Primary file: `docs/audit/SPEC.md`
- Local extensions: `docs/audit/WORKFLOW.md`
- Execution contract: `AGENTS.md`

### Session state

- Files: `docs/audit/sessions/SXXX*.md`
- Read for:
  - current mode
  - session branch continuity
  - attached cycles
  - carry-over state
  - session close decisions

### Cycle state

- Primary file: `docs/audit/cycles/CXXX-*/status.md`
- Read for:
  - branch mapping
  - `dor_state`
  - continuity data
  - outcome/state
  - next step

### Intent and implementation path

- `docs/audit/cycles/CXXX-*/brief.md`
- `docs/audit/cycles/CXXX-*/plan.md`

Read for:

- objective
- scope / non-scope
- first implementation step

### Decisions

- File: `docs/audit/cycles/CXXX-*/decisions.md`
- Read for:
  - accepted tradeoffs
  - rejected options
  - rationale and impacts

### Hypotheses

- File: `docs/audit/cycles/CXXX-*/hypotheses.md`
- Read for:
  - active assumptions
  - validation plans
  - confirmed / rejected status

### Gaps

- File: `docs/audit/cycles/CXXX-*/gap-report.md`
- Read for:
  - missing requirements
  - unresolved defects
  - open root-cause hypotheses

### Change Requests

- File: `docs/audit/cycles/CXXX-*/change-requests.md`
- Read for:
  - scope change
  - impact level
  - decision to accept now / split / open new cycle

### Traceability

- File: `docs/audit/cycles/CXXX-*/traceability.md`
- Read for:
  - REQ to TEST links
  - affected files
  - planned vs verified coverage

### Baseline memory

- Current baseline: `docs/audit/baseline/current.md`
- Baseline history: `docs/audit/baseline/history.md`

### Fast reload memory

- Snapshot: `docs/audit/snapshots/context-snapshot.md`

### Entropy isolation

- Parking lot: `docs/audit/parking-lot.md`

### Incident handling

- Incident files: `docs/audit/incidents/`
- Template: `docs/audit/incidents/TEMPLATE_INC_TMP.md`

### Runtime context in `dual` / `db-only`

- Runtime digest: `docs/audit/RUNTIME-STATE.md`
- Handoff digest: `docs/audit/HANDOFF-PACKET.md`
- Agent adapter roster: `docs/audit/AGENT-ROSTER.md`
- Agent adapter contract: `docs/audit/AGENT-ADAPTERS.md`
- Agent adapter health summary: `docs/audit/AGENT-HEALTH-SUMMARY.md`
- Agent selection summary: `docs/audit/AGENT-SELECTION-SUMMARY.md`
- Multi-agent status digest: `docs/audit/MULTI-AGENT-STATUS.md`
- Example external adapters: `.aidn/runtime/agents/`
- Coordination log: `docs/audit/COORDINATION-LOG.md`
- Coordination summary: `docs/audit/COORDINATION-SUMMARY.md`
- User arbitration log: `docs/audit/USER-ARBITRATION.md`
- Runtime context root: `.aidn/runtime/context/`
- Read for:
  - `runtime_state_mode`
  - `repair_layer_status`
  - `current_state_freshness`
  - handoff readiness for a second agent
  - latest coordination outcome without reading raw history
  - prioritized artifacts
  - continuity hints
  - blocking findings
  - structured coordination history in `.aidn/runtime/context/coordination-history.ndjson`

## Read Strategy By Situation

### Need to decide whether writing is allowed

Read:

1. `HANDOFF-PACKET.md` when another agent already prepared a relay
2. `CURRENT-STATE.md`
3. `WORKFLOW-KERNEL.md`
4. active cycle `status.md`
5. active session file
6. runtime context if `dual` / `db-only`

### Need to understand why the current approach exists

Read:

1. `decisions.md`
2. `hypotheses.md`
3. `WORKFLOW.md`
4. `SPEC.md` if rule precision is needed

### Need to understand missing or unstable parts

Read:

1. `gap-report.md`
2. `change-requests.md`
3. `parking-lot.md`

### Need to confirm implementation readiness

Read:

1. cycle `status.md`
2. `brief.md`
3. `plan.md`
4. `traceability.md`

## Reminder

If the workflow context remains incomplete after these reads:

- stay read-only
- state hypotheses explicitly
- report the smallest compliant next step
