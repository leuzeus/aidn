# 03 Information Governance

Operator review copies are derived from the configured canonical artifact
backend and the evidence of the accepted operation bound to the pending
question. They live outside the checkout, under the protected host home, and
retain their question identity and content hashes. They cannot replace canonical
documents, establish a verdict, consume a decision or grant an effect.

Canonical path inventory uses the artifact adapter's `listArtifactPaths`
capability on PostgreSQL and SQLite. It reads names in the selected scope,
without transferring all document bodies or falling back to local projections.
The existing 10,000-entry truncation refusal and path validation remain in
force. Detailed observation and materialization still use their content reads.

Expired merge-capture continuation is derived process-journal evidence. The
original signed capture and reservation remain reserved, with unchanged provider
timestamps and no acknowledgement. A new entry binds their hashes after current
provider and canonical-state revalidation. The existing Human disposition owns
the decision to proceed to R09; this adds no canonical store or merge permission.

Retained session closure uses the same derived journal evidence category. The
old Human receipt remains unaccepted in its immutable technical instance; a new
entry authenticates its exact question and current subject. The original start
run must still be physically open. Canonical session state changes only through
the existing granted close writer, checkpoint and final hook.

Retained completed-cycle provenance remains derived evidence in the current
process operation journal. The original instance, operation receipts, Human
inbox and Native allocations stay under their original authorities. A successor
entry records their finite proof digest; it creates no canonical concept or
receipt migration. Canonical session ownership and cycle state remain in the
configured artifact backend, including optional PostgreSQL and local SQLite.

Reused objective agreement is derived evidence in that same operation journal.
It references the unchanged Human decision and witnessed completion, alongside
the new evaluation. It adds no decision, inbox claim, canonical concept or store.

Recorded-promotion continuation likewise derives its finite proof from the
original operation and Native journals. Its accepted record and first refusal
remain owned by the original instance; PostgreSQL or SQLite still owns the
canonical baseline, history, session and cycle.

## Purpose

AIDN governs information concepts, not just files.

The source of truth, metadata, lifecycle status, and scope of each concept must stay explicit across files, runtime stores, projections, and contracts.

## Core Rules

- source of truth is concept-specific
- metadata is governed, not incidental
- lifecycle status is part of the contract for governed concepts
- concepts can be governed, subsumed, or excluded
- dual / db-only are supported modes and must remain distinguishable
- every exposed concept declares owner, lifecycle, scope, retention, projections, migration, and replacement
- projections, fixtures, caches, and exports are never canonical by implication
- proof distinguishes package source, scaffold, fixture corpus, installed client, and external pilot
- PostgreSQL remains optional and shared synchronization remains opt-in
- owner, retention, migration, replacement, and evidence targets are
  concept-specific policy data; generic fallback text is not acceptable evidence
- governance diagnostics enforce bidirectional closure: every source-of-truth and
  metadata policy is exposed by a governed concept, and every public JSON/effect
  surface links back to governed concepts

## Modes

FILES is retired; legacy records remain readable, and only the explicit
`runtime mode-migrate --write` transition may import legacy state. See
[ADR-0027](../ADR/ADR-0027-retire-files-state-authority.md).

STANDARD decision issuer authorization is owned by the project administrator.
Its signed revisions live in the protected STANDARD host home in each storage
mode. The checkout and canonical workflow database carry decisions and receipts
under their existing authorities. Each execution host applies the same approved
revision explicitly before relying on its authorization.

- `dual`: runtime DB/index is canonical for runtime state and Markdown projection is required
- `db-only`: runtime DB is canonical; minimal re-anchor Markdown anchors may stay visible, while detailed Markdown projections are materialized on demand

## New Concept Rule

Do not introduce a new information concept until you have checked:

- `src/core/source-of-truth/source-of-truth-policy.mjs`
- `src/core/metadata/metadata-policy.mjs`
- governance diagnostics
- `docs/ADR/ADR-0006-information-model.md`
- JSON contracts, if the concept appears in public output

## Concepts To Watch

| Concept | Status | Notes |
|---|---|---|
| project | governed | Project identity and policy surface. |
| project_activation | governed | Repository authorization revision plus validated worktree preparation; separate from workflow state and native client trust. |
| workspace | governed | Workspace identity and worktree identity are explicit. |
| runtime_project_context | governed | Durable runtime scope identity is distinct from legacy absolute-path evidence. |
| session | governed | Session state has a lifecycle and source of truth. |
| cycle | governed | Use the cycle state and cycle status policies. |
| artifact | governed | Artifact inventory and scope are governed. |
| runtime_state | governed | Runtime state is a governed digest surface. |
| handoff_packet | governed | Handoff packet is a governed digest surface. |
| agent_working_memory | governed, derived | Local typed checkpoint claims with revision/evidence invalidation; never permission or canonical decisions. |
| decision | governed | Decision and arbitration records are explicitly governed. |
| incident | governed | Incidents carry lifecycle and ownership rules. |
| coordination_record | governed | Coordination records are a first-class governed family. |
| coordination_summary | governed | Coordination summary is a governed projection. |
| execution_run | governed, `supervision_candidate` | Frozen plan, canonical reservation, supervisor generations, original deadline and final validation; PostgreSQL authority, public commands unavailable. |
| delegated_task | governed, `supervision_candidate` | Run-local task identity, exact file operations, acceptance contract and ordered integration; no synthetic session. |
| execution_attempt | governed, `supervision_candidate` | One attempt owns its delegation, preparation, lease, result and acceptance references; execution, acceptance, integration and cleanup remain distinct. |
| baseline | local-first artifact family | Governed as local-first and checkout-bound unless explicitly projected. |
| snapshot | local-first artifact family | Governed as local-first and checkout-bound unless explicitly projected. |
| gate_result | excluded | CI telemetry, not governed product state. |
| migration_run | excluded | Operational telemetry, not a governed product concept. |
| reference_data | excluded | Test corpus and fixture material, not live workflow state. |
| setup_project_registry | excluded | Host-local project address book; installation receipts, config and packages remain authoritative. |

## Practical Guidance

If a concept already has a parent surface or an orthogonal telemetry layer, do not promote it without an explicit policy update and an ADR check.

Keep the source-of-truth policy, metadata policy, and governance diagnostics in sync with the information model.

Workflow incident tracking follows SPEC-R10. Its configured project artifact
source is distinct from repair findings. Both supported profiles read the configured SQL artifact record. A visible copy never replaces a missing canonical database record. After verified resolution and
confirmed resume, explicit cleanup removes temporary tracking and retains only
the concise session/snapshot trace. The archived lifecycle refers to that trace.
The scaffold Git ignore classifies only `/docs/audit/incidents/INC-TMP-*.md`
at the project root as transient. It preserves their local canonical authority and does not
resolve them, authorize resume or delete them. Permanent incident documents,
templates and session/snapshot traces remain reviewable. Previously tracked
TEMP files stay tracked; the ignore rule performs no history cleanup.
The private `compareAndDeleteArtifact` capability provides transactional deletion
of one UTF-8 artifact, requiring explicit write intent and both content and metadata
revision hashes. It refuses workflow evidence, session/cycle artifacts and runtime
heads, and does not remove visible projections. It supplies no incident executor:
resolution, authorization where required, confirmed resume and a retained concise
trace must be established separately before any caller invokes cleanup.

The private `standard-incident-closure.mjs` candidate consumes fixed trusted
evidence and boundary capabilities. It requires a resolved canonical tracker,
observed STOP for L3/L4 and an authorization witness for actual rule changes.
It writes concise session and snapshot traces before deleting the exact tracker;
cold application retains verified partial progress. Known partial completion is
reported as incomplete, and unknown states retain the effect owner. This candidate
does not provide the production resolution/resume evidence reader, triage or
published incident route, and its controlled fixtures do not qualify those gates.

The fixed private `standard-pr-incident-evidence.mjs` reader supplies a first
source profile for accepted L1/L2 external-merge dispositions followed by the
matching accepted R09 completion. The operation host authenticates the retained
Human source; the reader reconstructs the canonical session, fetch and alignment
chain and compares the original SPEC/WORKFLOW pins with current canonical rules.
The TEMP marker is a lookup key, bound to an incident identity derived from the
original question and operation. It cannot establish resolution by itself.
This read creates no tracker, resolution write, cleanup or published R10 route.
Other incidents, high-severity recovery and rule changes still need their own
authenticated source profiles. Existing historical question expiry is preserved;
reading an accepted history adds no preparation-age ceiling.

The registered private `session_pr_incident_record` and
`session_pr_incident_resolve` business bindings use ordinary host effect grants
in COMMITTING mode. The first records the accepted L2 source and checkpoint in
an ignored canonical TEMP tracker; L1 has no mandatory tracker. The second
changes that same tracker only after the matching accepted R09 source verifies
resolution and resume. The Human principal supplies its owner. Existing notes
and canonical artifact metadata remain preserved. A known partial write can be
completed from the exact retained preparation; an unknown postimage retains
the actual owner. The bindings add no source authority, backend or implicit
projection import. They do not delete tracking or write the required concise
trace. Their published R10 routing and owned unknown-state recovery remain due.

GFD adoption is scoped project policy, not a new runtime concept. The package
source declaration and client opt-in compatibility boundary are documented in
[GFD_ADOPTION.md](../GFD_ADOPTION.md). Proposed detection cannot become an
effective authority, and structural declaration validity grants no permission.
Preserve earlier adoption references and distinguish material claim changes
from editorial or observational additions. `gate_result` remains excluded CI
telemetry; its failure alone supplies no verdict about an unexecuted product.

ADR-0014 introduces internal contracts, transactional persistence and an injected
supervisor candidate. `supervision_candidate` marks complete policy coverage
without advertising public supervised commands or native qualification. Policy
completeness does not establish observed run, task or attempt instances. Evidence
targets include the internal contracts, `agent-execution-store-port.mjs`, the
PostgreSQL adapter, the v3/v4 SQL migrations and the supervisor and Git services.
Supervisor generations, acceptance, integration and final validation remain
records of these three concepts; they do not create independent authorities.
PostgreSQL is optional globally, but exclusive for supervised execution;
there is no SQLite, file or in-memory authority fallback. Local transcripts
remain local with bounded hash/size references in shared results and no automatic
purge in V1.

Reservation requires canonical runtime and shared planning in the same
PostgreSQL database transaction, with a positive planning revision; the first
historical planning write remains revision zero. Activation and termination
fixture doubles validate persistence decisions only. They do not qualify a
native executor, delegated admission or process-tree confinement.


The unreturned handoff candidate retains its new controller disposition under
the existing process_operation_journal concept and configured artifact backend.
The original signed dispatch capsule remains running and unchanged. The common
operation journal may append a genuine controller result and advance its phase;
this does not fabricate an original publisher return. No new canonical parent,
store or migration is introduced. DUAL may materialize only the already-canonical
packet projection; DB-only creates no visible packet. A matching visible copy
never replaces canonical content, metadata or the exact owner/witness evidence.


Before-effect disposition v5 remains in process_operation_journal and the
existing disposition/control stores. It retains a null original output/receipt
and one genuine current-controller blocked/no-effect result at index zero.
The immutable original running capsule is not rewritten. Separate acceptance
permits a fresh operation intention under the existing reducer; no new record
concept, backend, projection, shared capability or Native allocation is added.

## Session recovery evidence

Checkpoint-only session recovery belongs to `process_operation_journal` and is
stored by the same canonical FILES/SQLite/PostgreSQL record-store authority. Its
signed attempts retain exact original scope, configuration, journals, physical
event/run/document digests and lock/fence identity. It does not rewrite session
state, historical operation results, Human decisions or Native accounting.

Retained post-merge completion remains derived process-journal evidence. It
creates neither a new canonical session nor copied receipts. The independent
reader discovers one matching successor from a bounded canonical inventory,
authenticates its entry and predecessor lineage, and refuses ambiguity. A
PostgreSQL project never falls back to a checkout file for that discovery.
