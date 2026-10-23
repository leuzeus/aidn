# CLI Surface Inventory

`runtime artifact-query --profile active-state.v1 --params-file <relative.json>
--json` is an experimental read-only factual consultation. Parameters are a bounded
worktree-relative JSON object with `schema_version: 1`; optional `scope` pins all
four project/workspace/worktree/runtime identities, `expected_revision` pins a
previous observation, `target_bytes` is 256–65,536 (default 16,384), and
`include_optional` defaults to true. No SQL, arbitrary field expression, backend
override, write or migration flag is accepted. `--manifest --json` discovers the
catalog derived from critical Markdown contracts, field identities, extractors,
section dependencies and the registered profile without querying project state.

The active-state profile reads current/runtime state and the referenced session
and cycle from one canonical DB snapshot, or fenced file observations in files
mode. It keeps known empty lists distinct from absent or uninterpretable values,
detects duplicate fields and conflicting state, and includes full required
sections with source hashes. Canonical JSON is verified against complete source
content; incompatible extraction is rebuilt only in memory. An unsupported
artifact contract refuses. Scope/revision/integrity/backend failures do not fall
back to visible projections. Sources and canonical evidence are never written.
The `runtime-artifact-query.v1` output reports `ok`, `incomplete`, `blocked` or
`manifest`; incomplete/blocked exits 2. Optional fields are omitted first, and an
insufficient mandatory budget returns a refusal with expansion references.
Diagnostics may exceed a tiny requested budget and report their actual size.
The result never replaces required workflow authorities, fresh admission or
write CAS/fences. No installed procedure or native benchmark is changed by this
opt-in surface.

Three additional experimental profiles require a bounded `skills` array of
registered skills and the client's effective `governanceAdoption` task policies:
`admission-diagnostic.v1`, `modification-preparation.v1`, and
`verification-closure.v1`. They execute the existing generic pre-write admission
and return its checks, exact refusals, warnings and repair actions. Authority
sections and their dependency closure come from the accepted client bindings;
missing, foreign, changed or unaccepted authorities refuse the consultation.
No package profile accepts or modifies client policy implicitly.

`task` optionally contains `operation` and worktree-relative `paths`. Preparation
requires `task.operation`, bounded audit-relative `artifact_paths`, and semantic
`field_ids`. Targets must resolve to the current/runtime/session/cycle sources
selected by the profile. The engine retains complete canonical content for
extraction; the response exposes preimage hashes, sizes and contract versions.
`ready` means preparation can continue; `write_authorization` remains false.
The actual writer still needs its complete fresh canonical preimage, specific
admission, CAS and execution fence.

Closure requires closure skills and includes the complete session close report,
cycle tracking section, accepted criteria/evidence units and checks actually
executed by pre-write admission. `evidence_status: consulted-not-certified` and
`completion_authorized: false` do not claim that closure-specific checks ran or
that a receipt is valid. Existing closure procedures execute and retain those
checks. Consultation never closes a cycle or session.

`codex workflow-step --view agent --grouped --artifact-query-profile <profile>
--json` opts into a common consultation. Optional
`--artifact-query-params-file <relative.json>` supplies its parameters; the
workflow supplies its own skills. Use that file's `task` rather than a second
`--context-task-file`. Admissions are reused only within the invocation, with
the existing fresh publication fence. Canonical reads are shared, one hydration
serves admitted skills, and identical mandatory authority bodies are referenced
once in the final agent representation. A global coordinator stop suppresses
the consultation and hydration. Failed consultation also prevents hydration.
The default complete-JSON target is 16,384 bytes and maximum 65,536; both include
the query, checks, history, selected units and transport metadata. Optional units
may be omitted explicitly; mandatory units are never truncated. Historical
workflows and default projections remain available.

The internal `createOrderedClosureSequence` research composition adds no public
command. An explicitly bound host can execute its selected terminal segments
through the existing admission, CAS artifact, runtime projector and strict hook
commands below. Each command retains its existing effects and contracts. Pure
preview and explicit execution, supported modes and partial/refusal semantics
are documented in [the experiment](ORDERED_CLOSURE_EXPERIMENT.md).
The internal [artifact intent compiler](ARTIFACT_INTENT_PREPARATION_EXPERIMENT.md)
prepares batch drafts and exact mutations without a new CLI or effect. Its
terminal consumer invokes those existing commands through the same engine;
creation drafts require the existing create-only CAS port, never unchecked upsert.

`aidn runtime pre-write-admit --view agent --json` and
`aidn runtime coordinator-next-action --view agent --json` are read-only,
versioned compact projections. The canonical decision is evaluated first. They
retain scope identities, activation revision, observed sources, checks, policy,
blockers, warnings, repair findings, routing and stop decisions. A specific native
patch's complete `write_decision` is retained unchanged. Admission omits the static
concept-policy inventory and backend driver-distribution descriptions. Coordinator
projection omits the derived packet body; routing, transition, consistency and
repair diagnostics remain. Different packet observations remain distinct.

`aidn codex workflow-step --view agent --projection-profile compact.v1 --json`
selects `codex-workflow-step-agent-compact.v1`. It reuses the existing compact
admissions and exact selected context units, projecting only the bulky next action.
It composes with grouped selection, total JSON budgets, history and delta; the
original full default and `codex-workflow-step-agent.v1` remain unchanged.
Effects and explicit `--write` receipt intent remain those of the selected workflow
invocation. A complete diagnostic receipt still retains the full original observation.

The standalone projections use `runtime-pre-write-admit-agent.v1` and
`runtime-coordinator-next-action-agent.v1`. Their unavailable/invalid-input form
is a complete JSON refusal with `ok: false` and `stop_required: true`, without
invented scope, source revision or proof. `full_output` describes a fresh full
read and explicitly says `retained: false`; it is not a receipt or replay promise.
The view neither performs repairs nor adds persistence, fallback, approval or
reusable admission. Native token gains require a separate native comparison.

`codex workflow-step --view agent --json` is an opt-in, versioned projection of
the existing per-skill workflow. It retains admissions, blockers, scope, source
revisions and complete selected excerpts, sharing exact duplicate artifact bodies
without combining different revisions. Default full output remains unchanged.
It keeps the existing hidden-projector effect. Adding `--write` explicitly stores
a complete local diagnostic receipt with a `mutating` invocation rule;
selecting a view alone adds no writes.

Adding `--grouped` to the agent view selects invocation-local shared observation,
separate admissions, coordinator-stop handling and one common hydration for the
admitted skills. Blocked skills have no rich context. The result is fenced
against fresh local, activation, canonical and shared-state revisions before
publication. It currently requires initialized Git and canonical runtime paths.
It never grants reusable write authorization or changes the legacy default.

`--context-profile token-efficiency.v1` additionally selects client-accepted task
policies and a binding final JSON target (16,384 bytes, maximum 65,536). Its optional
`--context-task-file` contains additive operation/affected-path query data. It
requires the grouped agent path. Known configured skills use complete sections
and dependency closure; unknown/unconfigured skills retain historical selection.
The final JSON includes refusals, history, provenance, transport and receipt
metadata. Optional closure is omitted first; an insufficient mandatory target
returns an explicit blocked result with expansion references. Refusal metadata
can exceed a tiny requested limit and reports that fact. No authority is silently
truncated, accepted or written by this selector.

`--context-baseline-file` adds optional-unit differential consultation to that
profile. It accepts a complete prior agent response or complete worktree-local
workflow receipt previously retained with explicit `--write`; the receipt remains
an untrusted hint and reading it adds no write. Invalid prior observations fall
back to fresh complete selection and
mandatory authority closure is always sent. `--history-view transitions` groups
only well-bound identical typed decisions while retaining distinct execution
references. Unknown canonical history revisions remain separate. Both remain
read-only without explicit diagnostic retention. Argument-validation or dispatch
exceptions after common CLI activation use
`codex-workflow-step-agent-error.v1`, with repair actions and no claimed source
revision or admission. Grouped reads reject stale checkout-rule copies and use
canonical dual-mode runtime state instead of stale visible digests.

The internal `codex run-json-hook` wrapper also accepts `--view agent --json`:
flat decisions, errors and refusal/sync/exit semantics remain intact, with the
existing raw evidence available by hash and reference. Optional `--write` retains
the complete diagnostic outcome. `--verbose` and `--include-raw` conflict with
this view. It remains a mutating hook wrapper; formatting never grants admission.
Neither projection changes installed procedures or proves native token savings.

`runtime artifact-store list --view agent --limit 10000 --json` is an opt-in
compact project inventory. It resolves configured canonical authority (files,
SQLite or PostgreSQL), exposes references/revisions without bodies or canonical
duplicates, and explicitly reports `inventory.complete`, total count and limit.
Only a complete observation supports conditional absence. Alternate audit roots,
SQLite overrides and template-selector combinations are rejected for this view.
Default full list output is unchanged. Inventory is consultative, not admission.

Canonical `db-first-artifact --replace ... --expect-sha256 ...` performs the
preimage read, exact replacement, metadata preservation, canonical reconstruction
and write inside one existing adapter transaction. PostgreSQL uses one worker
exchange rather than a detached get plus CAS. The public command/output and
ordinary full-content CAS capability remain unchanged. Scope reservation fences,
revision conflicts and explicit projection policy remain enforced.

Date: 2026-05-23
Status: current codebase inventory

Purpose:

- make the user-facing CLI surface explicit
- distinguish stable public entrypoints from experimental and internal surfaces
- keep the inventory aligned with `bin/aidn.mjs`, `package.json`, `README.md`, and `src/core/cli/effect-policy.mjs`

## Stable public entrypoints

These are the durable surfaces exposed through `aidn` today:

- `aidn install`
- `aidn bootstrap`
- `aidn build-release`
- `aidn setup`
- `aidn update`
- `aidn rollback`
- `aidn doctor`
- `aidn help` / `aidn --help` / `aidn -h`
- `aidn version` / `aidn --version` / `aidn -v`
- `aidn codex`
- `aidn runtime`
- `aidn project`

The single dispatch registry is `src/core/cli/command-registry.mjs`.
`bin/aidn.mjs` and the machine-readable catalog import that same structured
registry. Options are derived only from each command's effective `parseArgs`
function. `tools/verify/verify-surface-catalog.mjs` enforces the closure in both
directions, rejects incomplete or duplicate descriptors and unknown options
through the real entrypoints, and excludes arguments passed to child processes.

## Stable public command families

These command families are intended for users and are covered by public effect policies and/or JSON contracts:

- `aidn project config --list --json`
- `aidn project add --target PATH --json`
- `aidn project migrate --target PATH --json`
- `aidn project list --json`
- `aidn project remove --id ID --json`
- `aidn update --check --json`
- `aidn update --release latest --json`
- `aidn rollback --json`
- `aidn doctor --target PATH --json`

Global management applies only with `--write --expect-plan ID`; a wizard
confirmation invokes that same exact plan. `--json` is formatting only and never
authorizes writes. Global commands use `global-management.v1`. See
[global setup](GLOBAL_SETUP.md) for installation and qualification boundaries.
`aidn setup` is an interactive executor; its confirmation can apply changes.
`aidn setup --json` instead previews noninteractively. Source development and
legacy bootstrap remain explicit entry points, never launcher fallbacks.
`project add --postgres-mode install --postgres-version VERSION --connection-ref
env:NAME --admin-connection-ref env:ADMIN` additionally plans local PostgreSQL
provisioning and explicit empty-database initialization. Existing PostgreSQL
resources use `--connection-ref` alone with `verify-only`; global updates always
retain that policy. `--resume` resumes the frozen provisioning transaction.

- `aidn bootstrap --json`
- `aidn bootstrap --dry-run --json`
- `aidn bootstrap --diagnose --json`
- `aidn bootstrap --authorize --json`
- `aidn bootstrap --authorize --write --json`
- `aidn bootstrap --revoke --json`
- `aidn bootstrap --revoke --write --json`
- `aidn bootstrap --repair --json`
- `aidn bootstrap --repair --write --json`
- `aidn bootstrap --resume --json`
- `aidn bootstrap --resume --write --json`
- `aidn bootstrap --rollback --json`
- `aidn bootstrap --rollback --write --json`
- `aidn bootstrap --uninstall --json`
- `aidn bootstrap --uninstall --write --json`

Bootstrap diagnostic and lifecycle commands accept `--scope installation` to
select all recorded local installer assets. The default `codex-integration`
scope remains limited to Codex assets. The scope changes the selected ownership
set, never write intent: lifecycle applies still require both `--write` and
`--expect-plan PLAN_ID`. Diagnostic stays read-only in either scope. The common
`installation_plan` in ordinary bootstrap previews covers local assets,
generated documents, configuration and separately declared persistence effects.
`aidn install --verify-after-install` includes verification in successful-install
finalization; `--verify` retains its read-only verification behavior.

- `aidn project config --wizard --write`
- `aidn project config --adapter-file <file> --json` (preview)
- `aidn project config --adapter-file <file> --write --json` (apply)
- `aidn project config --init-defaults --project-name <name> --json` (preview)
- `aidn project config --init-defaults --project-name <name> --write --json`
- `aidn project config --migrate-adapter --json` (preview)
- `aidn project config --migrate-adapter --write --json`
- `aidn runtime db-status --json`
- `aidn runtime db-only-readiness --json`
- `aidn runtime persistence-status --json`
- `aidn runtime persistence-adopt --json`
- `aidn runtime db-migrate --json` (preview) and `--write --json` (apply)
- `aidn runtime persistence-migrate --json` (preview alias) and `--write --json` (apply)
- `aidn runtime db-backup --json`
- `aidn runtime persistence-backup --json`
- `aidn runtime persistence-source-diagnose --json`
- `aidn runtime persistence-source-normalize --json`
- `aidn runtime artifact-fetch --json`
- `aidn runtime visible-artifacts-cleanup --json`
- `aidn runtime visible-artifacts-restore --json`
- `aidn runtime state-reanchor --json`
- `aidn runtime shared-coordination-status --json`
- `aidn runtime shared-coordination-projects --json`
- `aidn runtime agent-run --configuration <file> --plan <file> --json`
- `aidn runtime workflow-inspect --target <root> --json`
- `aidn runtime workflow-action --target <root> --request <file> --json`
- `aidn runtime workflow-dashboard --target <root> --json`
- `aidn runtime agent-run-status --configuration <file> --run <id> --json`
- `aidn runtime agent-run-resume --configuration <file> --run <id> --json`
- `aidn runtime agent-run-cancel --configuration <file> --run <id> --json`
- `aidn runtime agent-run-cleanup --configuration <file> --run <id> --json`
- `aidn runtime governance-diagnostics --json`
  - Additive `governance_adoption` separates package/client declarations, dated
    applicability, declared control kinds, human responsibilities and omissions;
    conformance, execution and native qualification remain unevaluated.
- `aidn runtime list-agent-adapters --json`
- `aidn runtime verify-agent-roster --json`
- `aidn runtime handoff-admit --json`
  - configured PostgreSQL is the canonical admission source, including with
    visible bootstrap anchors; db-only SQLite also selects the canonical store.
    The packet, current/runtime heads, cycle consistency and required audit
    artifacts share that source priority. Unavailable or ambiguous canonical
    state stops admission without falling back to visible files or local SQLite.
    Files mode without PostgreSQL and dual SQLite retain visible-file precedence.
- `aidn runtime pre-write-admit --json`

  `cycle-create` resolves canonical DB-backed context. A verified session with an
  explicit `active_cycle: none` can report `cycle_create_initial_state_verified`
  when cycle timestamp comparison is not applicable. Freshness remains `unknown`;
  stale state, missing canonical facts, repair and Git gates still block. This
  generic admission never authorizes an arbitrary native write.
  - Optional `--native-request-stdin` reads native V4A request JSON and returns
    specific scope admission. It remains read-only; generic admission is not
    universal write permission. See [specific admission](CODEX_INTEGRATION.md#specific-native-write-admission).
- `aidn codex hydrate-context --json`
  - `--context-selection-file <request.json>` is an opt-in read-only consultation
    with complete scoped units; it refuses output/projection writes and returns
    exit 2 with a complete JSON response when required knowledge is unavailable
  - hidden bundle output defaults to `.aidn/runtime/context/hydrated-context.json`
  - strict `db-only` does not auto-project visible files
  - use `--materialize-visible-artifacts` to intentionally write managed visible exports
- `aidn codex workflow-step --json`
  - batches pre-write admission, hidden context hydration, and coordinator next-action computation in one process
  - does not execute skill hooks or materialize visible artifacts
  - shared runtime synchronization remains explicit and is not implied by `--json`

## Advanced public command families

The three experimental `workflow-*` console commands share one application
service with the loopback dashboard; see [the console guide](WORKFLOW_CONSOLE.md).
Inspection is read-only. Actions require the exact preview hash and explicit
`--write` or `--execute`, plus `--sync-relay` for run effects. Dashboard startup
requires `--serve`; JSON alone opens no listener. Their self-guarded adapters
preserve current instance/selection admission and the existing supervisor,
including historical status/cancellation after revocation. No SQL or alternate
execution route is exposed by the browser.

The five `agent-run*` commands are opt-in supervision candidates. They use
`tools/runtime/agent-run-cli.mjs` and one schema per command under `cli-output`.

The explicit plan v2 profile `codex-cooperative.v1` preserves the same commands
and mutation flags. Its preview adds the assurance profile, required guarantees,
read-isolation limitations and qualification status to
`action.preconditions.native`, all covered by `action_sha256`. `not_checked`
is a declaration only; `qualified` requires the exact native worker and
validation evidence. V1 plans retain their historical shape and semantics.
Cancellation and status do not run a native qualification probe.
Plan v3/profile `codex-cooperative.v2` additionally declares
`network_isolation: not_guaranteed`, removes network denial from its required
guarantees and binds only to boundary configuration/qualification v4. The
limitation participates in the action hash. Existing profiles and flags retain
their semantics; there is no implicit profile replacement or availability grant.
Each output is one JSON document; raw Codex events remain local evidence. Existing
workflow adapters and sequential commands retain their contracts.

| Command | Default effect | Explicit application |
| --- | --- | --- |
| `agent-run` | Preview a frozen plan and local configuration | `--execute --expect-plan <action_sha256> --sync-relay` |
| `agent-run-status` | Read execution, attempts, validation, integration and cleanup separately | No write selector |
| `agent-run-resume` | Preview reconciliation and remaining work | `--execute --expect-plan <action_sha256> --sync-relay` |
| `agent-run-cancel` | Preview a durable stop request for the current generation | `--execute --expect-plan <action_sha256> --sync-relay` |
| `agent-run-cleanup` | Preview eligible, retained resources of a completed run | `--write --expect-plan <action_sha256> --sync-relay` |

All accept `--target <root>`, `--configuration <file>` and `--json`.
Explicit `agent-run-configuration.v2` adds a frozen workflow segment binding.
Its contracted selection appears at `action.preconditions.workflow` and enters
the exact action hash. V1 configuration remains unchanged. Selection preserves
canonical admission, scope/DAG authority, reservation and native qualification;
it does not traverse the macro graph. See
[segment preparation and evidence](WORKFLOW_SEGMENT_EXECUTION.md).
`agent-run` requires `--plan <file>`; the other four require `--run <id>`.
`--help`/`-h` is read-only and returns before configuration or native discovery.
`--dry-run` is preview-only and cannot combine with effect selectors or
`--sync-relay`. Duplicate, unknown and contradictory options are refused.
`--expect-plan` names the preview's **action_sha256**, not merely the execution
plan digest: target, configuration, base, activation, generation and material
preconditions are re-observed before any apply. Heartbeat timestamps alone do
not invalidate the action.

OneDrive workspaces, task scopes and configuration/evidence paths are excluded
by the agent execution path policy. Excluded destinations are rejected before
target observation, including known local Git and installation pointers. No
OneDrive ACL is changed; this policy is not a Windows read-denial guarantee.

Preview creates no run, claim, lease, heartbeat, worktree, archive or schema, and
does not launch a native metadata observer. PostgreSQL read-only readiness and
canonical state must be available. The local configuration pins the prepared
catalogue, engine, client, helper, native profile/consent, Git executable and
verification authority. Its canonical digest is bound by
`plan.supervision.configuration_sha256`. Model and effort have no silent fallback.

Cancellation records a request; it does not report stopped descendants until the
supervisor observes their termination. Resume first reconciles uncertain work.
Cleanup is restricted to completed runs after every supervisor and child has
stopped. It archives exact owned worktree bytes before the durable cleanup
intention and removes only that intention's resources. It preserves source
commits and evidence; failed runs, conflicts and indeterminate processes remain
available for diagnosis. No general worktree administration command is added.

Sandbox installation and repair, native authentication and hook trust use Codex's
official controls outside `agent-run*`. No lifecycle command invokes Windows
setup, modifies sandbox accounts/ACLs/network policy or copies profile history
as a repair. AIDN retains admission, PostgreSQL ownership, task dependencies,
bounded execution, observed descendant termination, integration and exact-SHA
audit. An availability failure is a refusal, never an implicit setup request.

The native initial capacity is four prepared worker roots on Windows with an
explicit preexisting profile. Every root requires actual native trust observation,
and the exact candidate still needs separate execution and confinement evidence.
See [native qualification](AGENT_EXECUTION_NATIVE_QUALIFICATION.md).
The current validation backend refuses with `SANDBOX_EXISTING_ONLY_UNSUPPORTED`
before launching a native process: its existing-state path cannot satisfy the
required absence of provisioning. These public candidates remain previewable;
the final native run is UNAVAILABLE.

These surfaces are public and contract-backed, but they are more operational or coordination-sensitive than the stable core families above:

- `aidn runtime shared-runtime-reanchor --json`
- `aidn runtime shared-coordination-bootstrap --json`
- `aidn runtime shared-coordination-backup --json`
- `aidn runtime shared-coordination-restore --json` (preview) and
  `--write --json` (apply)
- `aidn runtime shared-coordination-doctor --json`
- `aidn runtime shared-coordination-migrate --json`
- `aidn runtime project-agent-health-summary --json`
- `aidn runtime project-agent-selection-summary --json`
- `aidn runtime project-integration-risk --json`
- `aidn runtime project-multi-agent-status --json`
- `aidn runtime project-coordination-summary --json`
- `aidn runtime sync-db-first --json`
- `aidn runtime sync-db-first-selective --json`
- `aidn runtime mode-migrate --json` previews the config, schema, and projection plan; add `--write` to apply it
- `aidn runtime session-plan --json`
- `aidn runtime db-first-artifact --json`
- `aidn runtime artifact-store list --json`
- `aidn runtime artifact-store list --templates --json` discovers exact standard model references
- `aidn runtime artifact-store get --json`
- `aidn runtime artifact-store upsert --json`
- `aidn runtime artifact-store materialize --json`

Artifact commands select the configured runtime backend. PostgreSQL upserts
write only the named artifact, its blob/head and associated session/cycle row
inside one transaction, using an existing compatible schema and unambiguous
scope. They do not adopt a store or rebuild its index. `--path` is relative to
the audit root (for example `sessions/S001-example.md`); do not prefix it
with the audit root. The additive `backend` field identifies
the store; the legacy v1 `sqlite_file` field is empty for PostgreSQL.
When the resolved durable runtime scope and its legacy path scope coexist,
artifact commands select the durable scope, like canonical snapshot reads.
The legacy scope is eligible only when durable-scope metadata is absent. A
missing artifact within the selected scope never falls back to legacy content;
no implicit merge, deletion or migration of either scope occurs.
`list`, `get` and materialization previews remain read-only. JSON formatting
does not authorize an upsert or materialization; their existing effect rules
remain unchanged. PostgreSQL checkpoints read the canonical backend and skip
implicit index imports with reason `postgres_canonical_backend`.

For conditional project artifacts, `artifact-store list --limit 10000 --json`
returns the selected canonical scope up to the existing supported PostgreSQL
limit. Fewer than 10000 returned rows establishes completeness for that read;
a full limit is inconclusive, never evidence of absence. Use exact returned
paths and read every required or positively present conditional artifact. This
does not downgrade a later missing read, authorize a write or establish future
freshness. Standard models use the dedicated complete `--templates` selector.

`artifact-store list --templates` derives its complete standard asset membership
from the executing package's `scaffold/docs_audit` distribution (ADR-0013), without
a parallel name mapping. It returns exact audit-relative `path`, contextual title,
distribution and current source hashes, `read_method` and `projection_path`.
Project template contents remain governed artifacts: files in files mode,
canonical SQLite in dual/db-only, and configured PostgreSQL regardless of visible
anchors. This inventory reads one fresh database snapshot without list truncation;
it never imports, repairs, aliases or materializes. Missing distributed project
models, duplicate references, unavailable scope/backend and unsafe links fail.
The returned observation is consultative: obtain the required complete models via
batch `artifact-fetch` in database modes or grouped file reads in files mode.
Admission, freshness, revision and closure checks remain separate and mandatory.
Artifact consultation and writes support an explicit `--view agent`. This v1
view keeps the existing result envelope, backend, identity, SHA256, verdict and
materialization evidence. Fetch retains text while omitting duplicate canonical
rendering; writes return metadata without either document body. The default JSON
remains complete. Expand a receipt with `runtime artifact-fetch --path <path>
--json`; a receipt is an observation, not a stored snapshot of a future revision.

`runtime artifact-fetch --path <path> --view agent --heading "## Exact heading"
returns `context_excerpt` separately from artifact metadata: the complete ATX
section includes nested headings and exceptions, with line range, full-source
SHA256 and excerpt SHA256. Missing/duplicate headings and non-text content stop
the request. Omit `--heading` to expand. This is consultative, without dependency
closure or write authorization; the governed `codex hydrate-context
--context-selection-file` path remains required when accepted authority bindings,
scope and dependency closure are needed. Never substitute an excerpt for a
mandatory complete authority. Re-read when the source hash changes.

`runtime artifact-fetch --paths-json '["CURRENT-STATE.md","RUNTIME-STATE.md"]'
--view agent --json` consults 1-32 explicitly named documents from one fresh
canonical snapshot, preserving complete text, per-entry identity, content SHA,
source revision and request order. Backend and project context are shared in the
envelope. Each `artifacts` entry reports its requested `path`, `found`,
`source_revision` and `artifact`; root `artifact`/`source_revision` are null and
root `found` requires every entry. Missing entries retain null artifact/revision
and exit 2; backend/scope errors return no partial result or silent fallback.
The bounded JSON input rejects duplicates (including audit-prefix/slash aliases),
empty paths and mixed selectors/headings. `--metadata-only` omits every body.
This is read-only consultation, not write admission or dependency closure.
Single-selector behavior and default complete output remain compatible. Batching
avoids one model round trip per known required document; it neither omits required
reads nor caches future canonical observations.

`runtime db-first-artifact --path <path> --replace '[{"old":"unique exact text",
"new":"replacement"}]' --expect-sha256 <full-content-sha256> --no-materialize
--view agent --json` changes an existing canonical UTF-8 artifact without
re-emitting it. Replacements run in order; every old string must match exactly
once, including overlapping occurrences. At most 32 replacements and 128 KiB of
replacement JSON are accepted. They cannot be mixed with content/source or
identity/classification flags. Metadata is preserved; canonical rendering and
relational projections are rebuilt through the ordinary writer. SQLite and
PostgreSQL commit with the existing atomic compare-and-swap capability, binding
both content and observed metadata to reject concurrent changes, including
metadata-only changes. A missing source, unavailable backend or ambiguous
scope never falls back to visible projections. The write remains mutating;
`--json` and `--view` do not authorize anything. Existing workflow admissions,
phase, transition and final closure checks remain required. Multiple edits to
one artifact may share one replacement call after the required admission.

Replacements require a configured canonical database: SQLite in `dual` or
`db-only`, or canonical PostgreSQL. In `files`, SQLite is only an index and a
delta must not overwrite a newer authoritative file. The new option therefore
refuses this case before opening a writable store. Ordinary complete-source
writes and materialization retain their existing behavior. A projection-mode
override cannot transfer authority, and a conflicting SQLite backend override
cannot replace configured PostgreSQL for a replacement.

Selective DB-first writes preserve cycle/session identity derived from standard
artifact paths and the cycle status subtype; contradictory explicit identity
is rejected before mutation on either backend.

The `cycle-close` skill checkpoint accepts terminal ownership only for its
post-transition check and the explicit COMMITTING drift-check needed to finish
it. Both verify canonical exit evidence and intent. Generic gating, reload and
THINKING drift checks retain ordinary mapping. This does not relax reload or mark a
closed cycle active. Its specific admission, nested checkpoint and overall
result remain distinct; warnings and refusals propagate through the Codex JSON
wrapper. No public skip flag or alias is added for this closure context.
The wrapper skips post-hook DB synchronization on closure warning/refusal with
reason `cycle_close_not_completed`; it must not replace the canonical evidence
that prevented completion with local projections.

The final `close-session` hook reads current state, session close decisions and
cycle ownership from one canonical snapshot in db-backed or configured
PostgreSQL mode. Stale bootstrap projections cannot satisfy admission. On the
terminal cycle branch, its checkpoint verifies that cycle's session owner using
the same bounded completion mapping as cycle closure. Keep the session reference
selected until its final hook has confirmed closure; a cleared reference on a
cycle branch must not select an arbitrary historical session. Backend failure
or ambiguous ownership stops the hook. Overall
and nested success remain required; this final check grants no ordinary write
admission and does not reactivate a cycle.
The wrapper also skips post-hook DB synchronization on session closure warning
or refusal (`session_close_not_completed`), preserving the canonical refusal evidence.

The `pr-orchestrate` hook diagnoses delivery from canonical session artifacts in
dual/db-only and configured PostgreSQL modes, including review and post-merge
sync. An unavailable, ambiguous or inconsistent canonical session produces
`PR_ORCHESTRATE_CANONICAL_RUNTIME_INVALID` instead of reading a stale local copy.
It performs no provider action or default post-hook DB import. The Codex wrapper
still persists its diagnostic context; an explicit `--db-sync` remains a separate
requested effect and must not be confused with read-only admission.

The `start-session` hook uses the shared canonical continuity reader. In db-only
or with configured PostgreSQL, unavailable authority stops with
`START_SESSION_CANONICAL_RUNTIME_INVALID`; malformed artifact/head identity is
a hook error, never a fallback to Markdown. Canonical session artifacts retain
closure, PR/post-merge metadata and full cycle lists. The hook and wrapper retain
their mutating classification for telemetry, but do not import projections by
default. As for PR orchestration, explicit `--db-sync` is a separate effect.
Checkpoints preserve an existing canonical SQLite store in dual/db-only as well
as configured PostgreSQL. Creating or editing session artifacts requires the
separate DB-first write operation; a successful admission does not create them.

- `aidn runtime coordinator-select-agent --json`
- `aidn runtime coordinator-next-action --json`
- `aidn runtime coordinator-loop --json`
- `aidn runtime coordinator-dispatch-plan --json`
- `aidn runtime coordinator-dispatch-execute --json`
  - with explicit execution, built-in adapters run each child in the resolved
    target worktree; the caller's current directory does not select the child's
    working directory. This is execution context, not a filesystem sandbox.
- `aidn runtime coordinator-orchestrate --json`
- `aidn runtime coordinator-resume --json`
- `aidn runtime coordinator-suggest-arbitration --json`
- `aidn runtime coordinator-record-arbitration --json`
- `aidn runtime project-runtime-state --json` and `--write` for projection writes
  - DB-backed repair status is read from the current canonical snapshot, never
    inferred from an old successful hook or a missing findings collection.
  - `--write --out <reviewed-digest>` writes only that projection file. In
    `db-only`, persist a reviewed digest separately with
    `aidn runtime db-first-artifact --path RUNTIME-STATE.md --content-file <reviewed-digest> --no-materialize --json`.
    Consultation never persists the digest or updates canonical findings.
  - Canonical head pointers select exact artifacts even when historical path
    aliases coexist. An inconsistent pointer or ambiguous unheaded alias is a
    diagnostic requiring repair; consultation never deletes or merges the history.
- `aidn runtime project-handoff-packet --json`, `--write` for projection writes, and `--sync-relay` for shared relay sync writes
  - optional `--resume-agent <id>` verifies advisory working memory against checkout evidence and the configured canonical revision without changing the command's read-only effect or handoff readiness; see [working memory](AGENT_WORKING_MEMORY.md)
- `aidn runtime state-reanchor --json` and `--write` for explicit repair of `CURRENT-STATE.md`, `RUNTIME-STATE.md`, and `HANDOFF-PACKET.md` from the active runtime backend

## Repository-internal aliases

The `aidn perf` dispatcher and every alias declared as internal in
`src/core/cli/command-registry.mjs`
are repository tooling. They remain executable for maintainers and fixtures, but
they are classified explicitly as internal/non-public in the machine-readable
surface catalog. In particular, this includes:

- `aidn perf checkpoint`
  - optional `--working-memory <target-relative-json> --write` captures advisory agent context after checkpoint, unchanged checkout/canonical revision and fresh admission succeed
  - optional `--context-telemetry <target-relative-json>` binds recent client-reported token/window measurements to that explicit memory capture; unavailable categories remain unknown

Consultative `aidn codex hydrate-context --context-selection-file <request.json>`
also accepts `--context-baseline-file <prior-complete-response.json>`. It sends
fresh mandatory authority/dependencies and changed optional units; unchanged
optional bodies become exact references. Incompatible baselines fall back to
full selection. The option is read-only and requires the selection variant.
- `aidn perf session-start`
- `aidn perf session-close`
- `aidn perf delivery-start`
- `aidn perf delivery-end`
- `aidn perf audit-review`
- every other alias in the closed internal registry

## Experimental or internal

These are currently implemented as package scripts, tools, or internal wrappers, but they are not treated as stable public product contracts unless a specific doc or policy says otherwise:

- direct `tools/runtime/*.mjs` entrypoints
- direct `tools/perf/*.mjs` entrypoints
- `aidn perf` and its explicitly catalogued internal aliases
- `aidn codex run-json-hook` and `aidn codex normalize-hook-payload`
  - `run-json-hook` executes commands, including an explicit command after `--`,
    in the resolved target directory and records that directory in its command
    provenance. Relative child paths are resolved there, including through the
    daemon adapter. Existing effect and explicit-execution requirements remain.
  - its summary preserves the existing workflow reason code; an actual command
    failure retains `HOOK_COMMAND_FAILED`. Normalization reads reasons and repair
    observations from one selected nested gate, including checkpoint and workflow
    wrappers. Missing repair evidence remains unknown: a null diagnostic is not
    evidence that the repair layer is clean.
- `aidn runtime local-daemon` (public, experimental)
  - experimental opt-in local daemon prototype
  - `--start`, `--status`, and `--stop` use a worktree-local endpoint file under `.aidn/runtime/daemon/`
  - `--status` is always read-only, whether the daemon is present or absent;
    `--start`, `--serve`, and `--stop` are executor invocations
  - current stable behavior remains batch unless a client command is explicitly run with daemon flags
  - first supported delegated operations are `aidn codex workflow-step --use-daemon ...` and `aidn codex run-json-hook --use-daemon ...`
  - no command starts the daemon implicitly
- `node tools/runtime/repair-layer.mjs`
- `node tools/runtime/repair-layer-query.mjs`
- `node tools/runtime/repair-layer-resolve.mjs`
- `node tools/runtime/repair-layer-triage.mjs`
- `node tools/runtime/repair-layer-autofix.mjs`
- implementation helpers under `src/application/`, `src/adapters/`, and `src/lib/`

Repair-layer commands are operational/internal surfaces. They may be used by CI, recovery tooling, or fixture-driven tests, but they are not promoted as stable public contracts in this backlog.

## Source Of Truth

This inventory is derived from:

- `bin/aidn.mjs`
- `src/core/cli/command-registry.mjs`
- `package.json`
- `README.md`
- `src/core/cli/effect-policy.mjs`
- `src/core/contracts/cli-output/README.md`

When these disagree, the code and policy files take precedence over this inventory.

## Project activation boundary

The internal perf drift skill uses `gating-evaluate --complete-drift-check` to
record an explicit completed review only when its other checks pass. Generic
gate invocations do not record drift completion; `--no-emit-event` remains
observational. This stays within the internal perf surface and does not change
stable public JSON contracts or grant write admission.

`bootstrap --authorize|--revoke` uses `codex-integration` scope and previews by default; application requires `--write --expect-plan PLAN_ID`. A revoked project stays revoked through repair, resume and rollback. Diagnostic and pre-write admission outputs include compact activation state before backend access. Native Codex trust is separate.

Nominal bootstrap or upgrade accepts `--expect-plan PLAN_ID` from its matching preview. `--persistence-policy verify-only` checks existing backend compatibility without requesting migration, adoption or import; `adopt` retains declared installation effects. `--verify` remains the read-only verification option.

Host skill maintenance is explicit: `aidn bootstrap --migrate-global-skills --codex-home <absolute-path> --json` and `aidn bootstrap --restore-global-skills --codex-home <absolute-path> --json` preview only. Applying either requires `--write --expect-plan PLAN_ID`, uses `codex-integration` scope, and preserves the skill files. The host path is required only for these two actions; nominal project installation never migrates global skills.

## Windows host setup wrapper

`scripts/setup-project.ps1` is a Windows host wrapper, not a new aidn CLI command.
Without arguments or with `-Wizard`, it opens the multi-project menu, collects inputs, runs the
same read-only preflight, and requires the literal `INSTALLER` before invoking
the explicit `-Write` path. Cancellation and declining confirmation do not apply.
It previews local inputs by default and applies only with `-Write`. Explicit
`latest` selection and `-CheckUpdate` read GitHub metadata without writing.
`-Update` preserves existing project settings and stages the candidate before
project npm replacement; application requires `-Write`. `-InstallSetup` previews
the user launcher installation; `-Write` also sets AIDN_HOME and the user PATH.
Registry remembering/removal are explicit menu writes, separate from consultation.
The Node bridges in tools/setup are internal subprocess protocols, not public
JSON interfaces. It orchestrates
an exact published GitHub release (verified manifest/checksums and npm integrity)
or a pinned local npm tarball, optional WinGet PostgreSQL installation and database
preparation, then the existing bootstrap preview/apply/diagnose and persistence
status commands. It has human-readable output, no public JSON contract.
`-PersistUserConnection` is an explicit optional Windows user-environment write;
native Codex trust is never changed. See [the setup guide](WINDOWS_PROJECT_SETUP.md).
