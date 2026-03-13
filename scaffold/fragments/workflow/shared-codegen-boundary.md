## Shared Codegen Boundary Gate (Mandatory, adapter extension to `SPEC-R03`/`SPEC-R04`)

When a cycle modifies shared code generation files, the cycle MUST include an explicit boundary check before moving to `VERIFYING`.

{{SHARED_CODEGEN_SHARED_SURFACE_LINE}}
{{SHARED_CODEGEN_OVERLAP_LINE}}
- Relevant generator/shared-output paths:
{{SHARED_CODEGEN_PATHS_BLOCK}}
- Required evidence in cycle artifacts:
{{SHARED_CODEGEN_EVIDENCE_BLOCK}}
{{SHARED_CODEGEN_HARD_STOP_BLOCK}}
- Runtime note: this remains adapter policy until a dedicated runtime overlap gate is introduced.
