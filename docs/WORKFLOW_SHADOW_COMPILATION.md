# Shadow workflow compilation

Lot 2 compiles the current reference workflow and the diagnostic/correction
workflow without changing execution. See ADR-0016. The compiler is an internal
package-source API, with no standalone CLI command or automatic discovery.
Lot 3 adds an explicit run-local consumer; see
[segment selection](WORKFLOW_SEGMENT_EXECUTION.md). The compiler itself stays pure.

## Inputs and output

Call `compileShadowWorkflow(definition, context)` from
`src/core/workflow/workflow-shadow-compiler.mjs`. Supply a parsed
`workflow-definition.v1` value and this explicit context shape:

```json
{
  "contract_version": "workflow-shadow-context.v1",
  "authority": "caller_supplied",
  "product_version": "0.11.0",
  "workflow_version": 7,
  "state_mode": "files"
}
```

The product/workflow versions must exactly match the definition. `dual` and
`db-only` also compile without contacting a backend. The context is supplied
data; it does not establish canonical freshness or native availability.

Success returns `{ ok: true, issues: [], compilation }`. The compilation pins
definition ID/revision/hash, registry version/hash, compiler and primitive
versions, context/hash and normalized steps/transitions. It reports no execution,
no writes, no effects and no produced artifacts. Failure returns
`{ ok: false, issues, compilation: null }`; no partial plan escapes a refusal.

`validateShadowWorkflow` runs the same schema and semantic validation.
`explainShadowTransition` additionally accepts `step_id` and either a symbolic
`outcome` or a JSON `observation` from a supported existing helper. It returns
the selected edge and next step, preserving the observed result. Optional
`traversals` is the count of previous traversals of that exact edge. Two previous
review-to-correction traversals exhaust the alternate loop and select `stop`.
These are single-step explanations, not approvals or durable execution cursors.

## Compatibility evidence

| Usage | Evidence | Limit |
|---|---|---|
| Current workflow | Fixed nominal, refusal, THINKING and drift/readmission traces; 28 compiled helper observations retain actions, reasons and full payloads. | Helper inputs are fixtures; procedural obligations still require their own evidence. |
| Other topology | Diagnosis, human approval, correction, human review, completion/refusal and bounded return; graph-only edits and identity renaming use the same registry/compiler. | The compiler produces no agent plan; lot 3 connects an explicitly supplied plan through separate admission. |
| Adversarial | Unknown primitive/source/outcome/condition, malformed JSON, incompatible context, unreachable steps, missing terminal result, incomplete bounds and unbounded returns refuse. | Graph validity alone does not prove SPEC compliance of arbitrary custom workflows. |
| Determinism | Fixed hashes and byte-identical results after object/set ordering changes; context and graph changes alter hashes. | Registry/compiler versions and supplied context are part of the fingerprint. |
| Effects | Tests deny filesystem access, process launch, network connection, clock and randomness during calls; family runner checks checkout preservation. | This proves the internal compiler boundary, not future handler purity. |

Run `npm run perf:verify-workflow-compilation` and the existing
`npm run perf:verify-workflow-shadow`. The required gates are
`contracts-workflow-compilation` and `contracts-workflow-shadow`. The matrix in
`docs/WORKFLOW_SHADOW_PARITY.md` keeps assertions, external suites, procedural
evidence and reference declarations distinct.

## Deferred boundaries

SPEC and existing handlers retain their authority. The registry references
those sources and carries finite macro output vocabularies; it dispatches none.
Binding remains `null`, parameters remain empty and arbitrary executable
expressions are rejected. Lot 3 adds a separate run-local binding and selection
envelope, exact action approval and lifecycle connection. Project binding
discovery, macro activation, native qualification, durable macro instance state
and migration remain outside this compiler. Existing default execution is unchanged.
