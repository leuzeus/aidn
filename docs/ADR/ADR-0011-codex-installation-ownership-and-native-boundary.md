# ADR-0011 - Codex Installation Ownership and Native Boundary

## Status

Accepted for implementation. Native client qualification is a separate evidence
boundary and is not implied by this decision.

## Date

2026-09-23

## Context

AIDN already has canonical workflow policies, admission and CLI transitions.
Codex adds client-specific skills, roles, project hooks and trust decisions. File
presence and successful schema parsing do not prove that the intended native
client has approved or executed an integration. The audited Windows client
versions also differ: command hooks are available in both, while the inspected
0.146 client rejects MCP hook handlers accepted by 0.155.

Installation must preserve user content and third-party hooks across retries,
upgrades and interrupted writes. Source templates cannot be treated as runtime
state, and a bootstrap cannot silently approve executable hooks in a user's
native client. Hydrated context cannot become a second workflow authority.

## Decision

AIDN keeps its existing core and CLI as workflow authority. The first native
integration uses local command hooks and distributed skills/roles. No MCP server,
plugin, alternate governance engine, mandatory Codex login or model call is
introduced on the nominal install/admission path. Assisted customization migration
remains an explicit optional action.

The installer owns individual Codex files, the AIDN AGENTS block and exact hook
entries. Complete local installation ownership extends the same receipt and
transaction store with an optional installation section; it does not introduce
a second journal or workflow authority. Legacy Codex-only receipts remain
compatible. The `install_assets` concept records receipt, package binding and
recoverable transaction pre-images under `.aidn/install/` in one physical target
worktree. This store is local-only, ignored by installed Git rules and excluded
from shared runtime. It may contain private pre-images and local paths. It is
recovery evidence, not native trust or workflow state. Checksums detect accidental
corruption and are not signatures against an editor of the same files.

Preflight validates ownership and conflicts before writes. Lifecycle repair,
resume, rollback and uninstall default to preview; application requires explicit
`--write --expect-plan` with a matching preview plan. A lock and per-file
pre-image checks serialize the transaction; pending recovery records survive
interruption. Individual atomic file writes do not make the multi-file operation
filesystem-wide atomic. Divergent user content is a conflict, not implicit
permission to overwrite. Rollback/uninstall preserve content outside recorded
ownership and retain local recovery history. Uninstall removes the Codex
integration, not the whole AIDN runtime or audit history. An explicit
`--scope installation` selects complete recorded installation assets for
lifecycle actions using the same lock and recoverable transaction history.
Runtime and seed artifacts remain preserved by that broader rollback/uninstall
scope.

Root config `version` remains schema 1. The optional `install.aidnVersion`
projects the last complete successful requested installation from the executing
package's `VERSION`, bound to the receipt. Finalization or successful resume
records it only after required installation work and verification complete.
The receipt and completed transaction become durable before this final marker
write. A later recovery-metadata cleanup failure is reported as
`complete-cleanup-pending`; resume completes that cleanup. Before the marker
commit, failures retain the previous recorded version.
Preview, diagnostics and incomplete attempts do not establish success. Full
installation rollback restores the previous marker. Missing legacy markers stay
unknown; diagnostics distinguish this recorded fact from the executing version,
receipt binding and current asset drift. [ADR-0009](ADR-0009-release-versioning-provenance.md)
defines product version authority.

A native hook resolves its installed project from local paths and uses the
receipt-bound AIDN entrypoint with an explicit target. It never downloads a
latest runtime. The binding checks version and entrypoint/VERSION hashes; it is
not a full integrity attestation of transitive source modules. Stable package
location and source availability are required.

`SessionStart` obtains a bounded read-only canonical admission summary, including
resume/compaction entry paths. It never implicitly hydrates or creates workflow
artifacts. `PreToolUse` covers the audited `apply_patch` path and its matcher
aliases `Edit` and `Write`, rechecking generic core admission. It translates a
blocked admission or recoverable child failure into supported explicit-deny JSON.
It does not classify arbitrary shells or MCP tools, replace transition-specific
core prerequisites, rewrite tool input or grant reusable write authority.

The native client remains responsible for project/hook trust and execution.
Upstream command-hook errors, timeouts, disabled hooks and unavailable handlers
can fail open. A valid deny from a running adapter is narrower evidence than
universal prevention. Concurrent handlers cannot depend on ordering. Post-tool
feedback does not undo completed effects. These limits must appear in product
diagnostics and qualification reports.

Capabilities are scoped per client/backend version. Read-only nominal diagnostics
use local inventory and bounded `--version` calls, with no app-server session or
trust-store change. Installed/detected, approved, connected, operational and
degraded states remain distinct; unobserved approval stays unknown and native
operation stays unverified. A desktop app can exist without a CLI on PATH.
Distributed roles use the client's model default rather than an unjustified
model pin.

## Consequences

- Installation and recovery reuse the package source and current CLI while
  preserving recorded ownership and third-party content.
- A local command hook removes an MCP readiness dependency but cannot change
  Codex's native failure semantics or cover alternate tool paths.
- Context is compact and derived; each covered edit and each governed transition
  still requires current canonical evaluation.
- Local runtime package movement or drift can degrade integration and must be
  diagnosed/repaired explicitly.
- Windows fixture evidence, native client proof, Unix/WSL execution and cloud
  deployment remain separate qualification obligations.

## Alternatives

A thin MCP adapter may later improve structured tool access, but it is not a
universal interceptor and is incompatible with the inspected older client's MCP
hook schema. Plugin packaging can group integration assets but does not grant
native trust. A separate app-server runner can own explicitly delegated sessions;
it does not take over arbitrary existing desktop sessions. All three remain
optional designs requiring a measured benefit and their own qualification.

## Verification

The focused fixture set checks ownership, merge preservation, repeated install,
interruption/recovery, preview nonmutation, stale-plan refusal, uninstall scope,
read-only canonical resume, per-edit admission, Unicode/subfolder launch,
isolation, discovery false positives and adapter timeout/error translation.
Those results are fixture evidence, not native client denial proof. The
[capability report](../rfc/codex-integration-2026-09-23/CAPABILITIES.md) supplies
version-pinned source/schema evidence and the remaining human-reviewed native
E2E protocol. The [integration guide](../CODEX_INTEGRATION.md) describes delivered
commands and support boundaries. Final delivery/release readiness still follows
the repository governance route and required gates.

## Rollback

For an installed target, preview and apply the recorded Codex transaction rollback
with a matching plan; stop if later user edits conflict. The package-source change
can be reverted normally on an implementation branch. Rollback does not remove
workflow databases, audit history or global client configuration, and cannot undo
native human approval history.
