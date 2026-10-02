# ADR-0016 - Pure shadow workflow compilation

## Status

Proposed for review, 2026-10-01. Implements lot 2 after ADR-0015's reference
corpus. SPEC remains canonical; no production authority or execution is enabled.
ADR-0017 subsequently adds an explicit run-local consumer through the existing
agent lifecycle. The statements below describe the historical lot 2 boundary;
the compiler remains pure and descriptive.

## Decision

Add an internal compiler in `src/core/workflow/workflow-shadow-compiler.mjs`.
It accepts a definition and an explicit `workflow-shadow-context.v1` value and
returns a `workflow-compilation.v1` envelope or diagnostics with no compilation.
The context declares its authority as `caller_supplied`. It is not a canonical
snapshot, a lease, a qualification, an activation or a claim that a backend is
available. The compiler never resolves context from the checkout or environment.

The existing definition schema gains optional `primitive_ref` additively.
Lot 1 descriptors without it remain structurally valid, but cannot compile:
semantic validation reports `UNKNOWN_PRIMITIVE`. The two reference descriptors
advance to revision 2 with explicit references. No active instance is migrated.

`package/catalogs/workflow-shadow.v1.json` is one immutable reference registry
for both graphs. Each entry binds a primitive ID/version, kind, finite output
vocabulary and existing source references. It does not duplicate the CLI or gate
command catalogs, register an executor or contain callable handlers. Source
anchors and evidence references are checked against package source in the gate.
Procedural steps remain procedural; the segment references the existing plan v3
contract and reports `SEGMENT_PLAN_AND_ADMISSION_REQUIRED`. No fake cycle, plan
or run is manufactured to make an unsupported step appear executable.

Validation proceeds through bounded JSON, closed schemas, unique identities,
registered references and output types, compatibility, outcome coverage,
reachability, terminal paths and return boundaries. Each symbolic outcome has
exactly one edge. Conditions compile to typed equality on the known `outcome`
field. Arbitrary conditions, expressions, shell, parameters and permissions in a
definition refuse. There is no expression language or production policy copy.

Removing explicitly bounded edges and outgoing registered admission boundaries
must leave an acyclic graph. The current DoR boundary retains procedural
readmission after drift/incident; it does not acquire a new retry limit. The
alternate review-to-correction return is bounded to two traversals and then
targets a terminal stop. This is a model check, not durable retry enforcement.
It does not certify arbitrary graph changes as compliant with every SPEC rule.

Normalization sorts object keys, steps/edges by ID and set-valued outcome/rule/
evidence arrays. It does not normalize identifiers, change revision or coerce
input types. SHA-256 covers the normalized definition, explicit context, fixed
empty parameters, registry and complete compilation content. The compilation
hash excludes only its own hash field. Compiler version and primitive versions
are explicit. Identical normalized inputs produce byte-identical JSON; changes
to context, graph or revision change its fingerprint. Input and output objects
are never mutated; returned registry and results are deeply frozen.

`explainShadowTransition` explains one edge using a known outcome or an observed
helper result. The start/close mappings preserve the complete supplied result
and map its finite `action` vocabulary to macro outcomes. Existing helpers still
make decisions. Tests compare actual helper results to independent expectations;
the compiler does not reimplement admission. Retry counters supplied to this
function are observations, never durable state or permission to retry.

## Authority, effects and deferred work

The envelope always reports `authority: shadow`, `execution_available: false`,
`written: false`, no effects and no produced artifacts. The empty effects list
describes compilation itself, not the effects of a future handler execution.
Every nonterminal step reports its remaining handler/segment admission boundary.
Import, validation, compilation and explanation create no reservation, heartbeat,
worktree, migration, native observation or runtime storage. PostgreSQL is not a
compiler dependency. The existing CLI, adapter and sequential state modes retain
their current execution paths; no production consumer imports the compiler.

There is no project binding discovery or precedence. `binding: null` and empty
parameters make that limitation explicit. Typed project parameters, binding
storage and immutable selection, current-authority revalidation, revocation,
safe-point activation, segment plan production and durable instances belong to
later lots. A future execution change requires its own contract and authority
review; a valid shadow compilation cannot authorize it.

These transient envelopes and fixtures remain excluded `reference_data` under
ADR-0006, not a new governed runtime concept. Definitions remain maintainer-owned
reference corpus. Removing the compiler, registry, new schemas and compilation
gate reverses this lot without touching installed state or active work.

## Validation

`contracts-workflow-compilation` is a required cataloged gate. It checks both
macro graphs, fixed fingerprints, reordered inputs, graph-only changes and
renamed identities, 28 actual start/mapped/close helper results, bounded-return
exhaustion, malformed inputs and denial of ambient I/O/clock calls. The lot 1
gate still checks all 34 helper cases and the rule/evidence matrix. Existing
public-contract, no-implicit-write, policy and admission gates remain required
by ASSURED routing. Fixture evidence does not qualify native execution or prove
that a live PostgreSQL instance is reachable.
