### Session Transition Cleanliness Gate (Mandatory)

- Adapter policy scope: `{{TRANSITION_CLEANLINESS_SCOPE}}`.
- Applies before opening a new `SXXX-*` session branch.
- In addition to `Session Start Branch Base Gate (Mandatory)`, no orphan cycle artifacts from previous cycles/sessions or unresolved relay residue relevant to the current session topology may remain `untracked` or unarbitrated.
- Evaluate the session context as potentially multi-cycle; do not assume a single active cycle.
- If unresolved residue exists, one explicit decision is required before new session start:
{{TRANSITION_REQUIRED_DECISION_OPTIONS_BLOCK}}
- Record the decision in session continuity notes and relevant cycle/session CR notes.
- Runtime note: this remains adapter policy until a dedicated admission gate is implemented.
