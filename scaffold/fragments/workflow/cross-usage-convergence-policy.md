## Cross-Usage Convergence Policy (Project Policy, adapter extension to `SPEC-R04` / `SPEC-R11`)

- Treat cross-usage convergence as a validation rule for shared or high-risk implementation surfaces.
- A shared or high-risk change SHOULD declare a minimal `usage_matrix` before `IMPLEMENTING`.
- A shared or high-risk change MUST NOT be considered stable from single-usage evidence only.
- Default minimum usage classes:
  - shared surface: `{{CROSS_USAGE_SHARED_MIN}}`
  - high-risk surface: `{{CROSS_USAGE_HIGH_RISK_MIN}}`
{{CROSS_USAGE_RULE_LINES}}
{{CROSS_USAGE_SURFACE_BLOCK}}
{{CROSS_USAGE_EVIDENCE_BLOCK}}
