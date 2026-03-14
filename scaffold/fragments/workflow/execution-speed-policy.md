## Execution Speed Policy (Project Optimization)

This project uses latency optimizations while preserving canonical safety gates from `docs/audit/SPEC.md`.

- Evaluation scope: `{{EXECUTION_EVALUATION_SCOPE}}`.
- In multi-agent contexts, evaluate fast-path eligibility at the concrete dispatch/local execution scope, not as a blanket session-wide shortcut.

### 1) Gate classes: Hard vs Light

- Hard gates (always mandatory):
{{EXECUTION_HARD_GATES_BLOCK}}
- Light gates (risk-adaptive):
{{EXECUTION_LIGHT_GATES_BLOCK}}
- Rule: hard gates cannot be skipped; light gates may be reduced only under Fast Path or low-risk classification.

### 2) Fast Path for micro-changes

{{EXECUTION_FAST_PATH_INTRO}}
{{EXECUTION_FAST_PATH_CONDITIONS_BLOCK}}
{{EXECUTION_FAST_PATH_BODY}}

### 3) Risk-based validation profile

- `LOW` risk: {{EXECUTION_VALIDATION_LOW}}.
- `MEDIUM` risk: {{EXECUTION_VALIDATION_MEDIUM}}.
- `HIGH` risk: {{EXECUTION_VALIDATION_HIGH}}.

- Risk classification should be recorded before `VERIFYING`.
- Runtime note: this remains adapter policy until runtime gate selection consumes it directly.
