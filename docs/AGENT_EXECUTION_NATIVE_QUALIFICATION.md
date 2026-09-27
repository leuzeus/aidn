# Bounded agent execution: native qualification

This protocol prepares the Lot 4 native worker milestone. Preparation, fixture
results, activation, native trust and actual hook execution are distinct
evidence. None alone qualifies an operating system for supervised execution.

The [existing native protocol](CODEX_NATIVE_QUALIFICATION.md#preparation-and-trust-boundary)
requires human review of the disposable project and exact executable hook
definition through the client's supported controls. Do not copy authentication
or trust, seed trusted projects, inject approval hashes or disable a sandbox.
If review is unavailable, stop the dependent native execution. A changed
definition requires renewed review.

## Prepare the exact candidate

Use the internal source tool with an explicitly resolved Codex executable and
an absolute output directory that does not yet exist. Its parent must exist;
output inside the source checkout, aliases and existing output are refused.
The default operation and the JSON flag do not authorize writes.

~~~text
node tools/verify/prepare-agent-native-qualification.mjs --output-root <new-absolute-directory> --codex-binary <absolute-native-executable>
node tools/verify/prepare-agent-native-qualification.mjs --output-root <new-absolute-directory> --codex-binary <absolute-native-executable> --write
~~~

If npm is not beside Node, supply --npm-cli with an absolute npm-cli.js path.
The tool uses argument arrays and the bound Node executable; a Windows shell
launcher is not an acceptable Codex binary.

Preview reads source identity and the executable hash. It creates no directory,
does not pack or install, and does not invoke Codex. Codex version interrogation
occurs only in the write path, with a separate temporary metadata home.

The write path:

- Packs the current candidate with lifecycle scripts disabled, retains its
  tarball and SHA-256, and refuses source changes observed during packing.
- Installs that tarball at a stable private engine path inside the output,
  retaining the npm lockfile. It imports installation services from that exact
  installed package. It does not select or modify the workstation's global AIDN.
- Creates a neutral Git repository and two linked worktrees with spaces and
  accents. Each root receives its own installation plan and receipt with
  persistencePolicy=verify-only, runtimeStateMode=files,
  artifactImportStore=file, initDefaults=true and the core pack.
  Receipts and authorization are never copied between roots.
- Records candidate package inventory, source HEAD and dirty diff, Codex binary
  identity, activation root IDs, receipt and hook hashes, worktree contents,
  runtime sentinels and Git metadata baselines.
- By default, creates an empty isolated CODEX_HOME and a local REVIEW.md
  containing the exact installed hook definitions and /hooks review instructions.
  Explicit preexisting-profile selection records an existing home identity
  instead; preparation neither reads its contents nor launches that profile.

The fresh files installation prepares local assets only. It is not a substitute
for the supervised path's authoritative PostgreSQL state. The later supervisor
must acquire the real claim and create .codex/aidn-agent-attempt.json with
protocol_version=1, attempt_id and request_sha256; this preparation leaves
the marker absent. Native tool authorization still requires the live delegated
admission service, activation and ownership checks.

## Review and qualify one native surface

Retain manifest.local.json, baseline.local.json, REVIEW.md, the archive,
installed engine and root-specific receipts. The manifest's candidate object
contains packageRoot, archivePath, sha256, version and inventory;
worktree IDs are the physical root_id reported by activation.

Review the exact binary, disposable target and installed hooks through the
native client's supported controls. Use the recorded explicit home. If native
authentication is needed, handle it explicitly through supported human login;
do not copy a user's existing authentication or trust store. Record native
surface, OS/build, binary version/hash, package hash, definition hashes, reviewer
and approval time. A listed or parsed hook does not establish that it ran.

After those prerequisites and a real PostgreSQL claim, obtain separate evidence:

| Case | Required native evidence |
| --- | --- |
| Allowed edit | Covered hook execution and exactly the authorized file change |
| Forbidden edit | Explicit refusal and unchanged forbidden marker; include a mixed patch |
| Descendant termination | Confirmed stop of the actual worker process tree after cancellation or timeout |
| Isolation | Other worktree, runtime sentinels, receipts, Git metadata and refs preserved |
| Stale authority | Revoked activation or lost ownership refuses a subsequent covered edit |

Use the native tool trace and independent before/after hashes as the oracle.
The worker reads its explicitly selected CODEX_HOME configuration, because
ignoring that file would also omit project trust. It never falls back to the
operator's default profile. Model, effort and sandbox remain explicit command
arguments, and native subagent delegation is disabled for a bounded worker.
The CLI also fixes approval_policy to never, additional writable_roots to an
empty list and network_access to false, and excludes both the environment's
temporary directory and /tmp from workspace write permission. A narrow OS
sandbox probe is separate evidence. Windows executions explicitly select the
elevated sandbox backend and require its supported setup to succeed; profile
defaults cannot choose another backend. An unavailable native client helper still
leaves the complete native milestone unavailable.
An isolated CODEX_HOME does not isolate the Windows sandbox's OS accounts,
firewall rules or filtering state. Qualify their coexistence with existing
profiles on the selected host, or use a dedicated disposable test host. Scoped
worktree preservation does not establish host preservation. Reprovisioning that
invalidates another profile blocks host qualification even when the native
edit, refusal and termination scenarios pass. Do not repeatedly reprovision
competing profiles or relax the sandbox to turn that condition into a PASS.
Raw Codex JSONL, an exit code of zero, a model's statement, a simulated hook
payload or a passing fixture is insufficient. Record PASS, FAIL, SKIP and
UNAVAILABLE separately. Results bind to the exact candidate, executable,
native surface and OS tested; another OS remains unavailable until qualified.

The preparation helper never runs a model, opens a native session, approves
trust, starts PostgreSQL or executes these cases. Its successful status means
only that the concrete review materials and disposable worktrees are ready.

## Explicit preexisting native profile

An isolated configuration home is not an OS sandbox boundary on Windows. When
another home would contend with an existing provisioned backend, preparation can
select that existing home explicitly:

~~~text
node tools/verify/prepare-agent-native-qualification.mjs --output-root <new-absolute-directory> --codex-binary <absolute-native-executable> --native-profile-mode preexisting --codex-home <existing-absolute-home>
~~~

Add --write only to prepare the candidate and disposable worktrees. Preparation
never creates, copies or provisions the selected home. It records its physical
directory identity and refuses output overlapping the home or source checkout.
Selecting a home does not authorize metadata probes or model calls in it.

After that consent, the internal discoverCodexNativeProfileMetadata step can
return sanitized integration identifiers and observed readiness/trust statuses
without requiring trusted project hooks yet. It returns discovery_only and
NOT_GRANTED, never a runnable policy. Use those identifiers to disable each
integration in the interactive review session. After human /hooks review and
closure of that session, inspectCodexNativeProfileProposal performs the strict
observation and freezes the resulting configuration and hook fingerprints.
This ordering keeps fresh untrusted roots from requiring an unrestricted native
session merely to discover the inherited integrations.

An explicitly consented `bootstrapMetadata: true` option prepares the same
attempt's native metadata before discovery or proposal, with at most 60 seconds.
The following strict observation still has its own ten-second budget. Bootstrap
does not grant trust, admission or qualification, and cannot replace that fresh
observation. It never retries a failed preparation automatically.

Before execution, a local codex-native-profile-policy.v1 document binds the home
identity, client hash, elevated backend, configuration-source and effective-setting
hashes, integration identifiers, reviewed hooks, separate attempt-state directory
and allowed shared native effects. Only its fingerprint enters the versioned
plan and request as execution.native_profile. Missing or changed policy refuses
the request; there is no profile or model fallback. The existing contract without
this field remains valid.

The preexisting mode uses Codex's ordinary configuration loader for both metadata
observation and exec. It does not pass --strict-config: a home can contain inert
historical keys, including unused named-profile fields. Their presence does not
justify deleting user settings. The complete source bytes and effective settings
remain fingerprinted, and every required sandbox, provider, integration and hook
condition is still checked. Configuration warnings are not successful validation.
Isolated profiles retain strict parsing. This choice follows the explicit bound
mode; a failed launch never retries with relaxed arguments.

Codex may emit a nonterminal `item.completed` error diagnostic after
`thread.started` but before `turn.started`, including for ignored historical
settings. The bounded JSONL reader accepts only the well-formed diagnostic in
that position. It neither starts a turn nor completes the task. Other work
items before a turn remain invalid, and the first protocol or callback failure
is retained instead of being replaced by a later incomplete-stream error.

The preexisting mode requires separately recorded consent for native profile
effects and new human review of the disposable roots through /hooks. Native log,
cache and authentication-refresh activity is distinct from project mutation;
the effect document must name the permitted activity. Configuration, trust,
reviewed executable hooks, provisioning preimages and AIDN/Git state remain
protected after review. No setup, repair, credential copy or automatic trust
approval belongs to this path. Existing-only is the supervisor's rule, not a
guarantee that the native client cannot attempt repair; failed preservation or
backend health checks invalidate qualification.

Native initialization of a new attempt SQLite directory can copy historical
conversation metadata from the selected profile, including titles, first
messages and previews. This requires explicit consent bound to the current
shared-effects digest and local state directory. Keep these copies outside Git
and PR artifacts. The qualifier preview reads only filesystem evidence, checks
that the reviewed effect digest is current, and declares this copy and its
preparation budget before execution. Do not disable SQLite, alter backfill
metadata or erase failed state to bypass a startup failure.
This SQLite directory is Codex's local native index. PostgreSQL remains the
exclusive authority for AIDN supervised runs and claims; the native index is
neither their storage nor a replacement backend.

Each preexisting-profile scenario reserves 60 seconds for metadata bootstrap
and the subsequent fresh canonical preflight together. The heartbeat continues
during this preparation. Its result binds the exact request, policy, attempt
state directory and confirmed metadata-process termination, and remains
`NOT_GRANTED` / `NOT_RUN`. Missing bootstrap, refusal, cancellation, expiration
or an identity mismatch prevents worker creation; no automatic retry resets
this deadline. Evidence and failed attempt state are preserved.
Metadata-process cleanup is recorded separately from worker cleanup. If a
deadline or cancellation wins before the observer confirms closure and PID
absence, metadata cleanup remains `UNCONFIRMED` even when the worker is
`NOT_STARTED`. Final observation is then suppressed, including observation of
an older successful attempt, until termination is reconciled. No extra wait
extends the preparation budget and no later callback authorizes a new launch.

The frozen run duration includes preparation plus the unchanged worker duration
(for example, 60 + 150 seconds). Worker latency and timeout measurement start
only after preparation and its canonical preflight complete. The smaller timeout
scenario budget is derived from the cancellation case's worker latency alone.
Preparation cannot consume or extend the worker budget; the worker deadline
then remains fixed through its separate before-create and before-resume checks.

The supervisor checks the effective configuration and hooks before creation and
again before resuming a suspended worker. Responses bind a fresh challenge,
phase, request and policy; an earlier probe cannot authorize a later launch.
Each check has at most ten seconds within the task deadline, then canonical
admission rechecks ownership before launch. MCP, plugins, apps, notifications
and memory use are explicitly disabled for the attempt. Empty configuration
tables are not evidence of neutralization: native configuration merging can
retain entries, and hooks/list can expose hooks absent from config/read.
Unexpected hooks, integrations or configuration drift refuse execution.

The policy also freezes the names of inherited `shell_environment_policy.set`
entries, without retaining their values in discovery output. Per-process
arguments replace those values with empty strings and impose an exact final
include filter for the worker's OS, native-home, temporary-directory and
admission variables. The final filter removes other names; an empty value alone
does not establish absence. Names are bounded and compared case-insensitively
on Windows. A collision with a required variable, a new or duplicate name, a
nonempty effective value, or a wider inherited filter refuses execution.
The selected profile is never rewritten to remove its custom environment.

Fixtures prove these bindings and refusals with synthetic inputs. They do not
qualify an actual profile, backend or OS. The four native cases and preservation
checks must pass on the exact candidate before this capability is available.
The refresh helper below also supports a previously reviewed preexisting home.
It preserves its physical identity and exact hook definitions, reads no profile
contents, and requires fresh native observation and policy review after refresh.

The internal qualify-agent-native-worker driver previews by default. Its
explicit write mode permits four bounded calls: acquisition of edit/refusal
evidence, cancellation, timeout and the executor port check. It requires an
explicit model and effort preset, the exact package/helper manifests and a
review proof bound to those choices. Missing prerequisites or incomplete cases
remain NOT_RUN, UNAVAILABLE or FAIL as applicable; a partial run never grants
qualification. Its evidence and failed-attempt markers remain available for
reconciliation. This driver adds no public agent-run command or output contract.

After all four cases and final file observations pass, the driver records
native_cases_status=PASS but leaves qualification=UNAVAILABLE with
HOST_CONFIRMATION_REQUIRED. The immutable qualification.json is followed by a
host-confirmation-request.json binding its hash, candidate, client and a fresh
challenge. Through the existing principal native Codex client, run a strictly
read-only command in its ordinary sandbox that emits the challenge. Preserve the
real tool event reference, hash, time, client/surface/build and sandbox mode for
independent review. No escalation, setup or bypass qualifies this check. A
self-declared record or an arbitrary child process's exit zero is insufficient.
Retain this confirmation separately; never rewrite the terminal case result.
This proves continued principal sandbox operation and the observed preservation
scope, not that every Windows account, ACL or firewall entry is globally identical.

Each scenario uses a distinct ephemeral database, durable launch intent and
attempt. Planning is published at revision zero, then advanced to revision one
by the canonical compare-and-swap writer before reservation. A JSONB reread must
match every request value; object key order is immaterial, while array order is
preserved. PostgreSQL cleanup and native process cleanup are reported separately.
The overall process-cleanup status includes every attempted launch, even if a
later scenario fails before creating its worker. Each scenario keeps its own
termination status; a non-started port cannot hide earlier launched processes.

An admission record proves the supervisor's decision. A refusal also requires
a correlated native client trace and unchanged file hashes. The client may expose
a failed file_change event or a native router rejection on stderr. The latter
must identify the exact patch, hook refusal reason and admission interval without
ambiguity. Model prose is never a refusal oracle. Retain the native stream with
its byte count and hash. An allowed server decision without the intended file
effect fails qualification.

HTTP request-ingestion deadlines and bounded admission evaluation are distinct.
A fully received authenticated request must not be disconnected merely because
its body-ingestion timer remains active during evaluation. Client, canonical
evaluation and transport shutdown limits still bound failure handling.

The executor's mandatory admitLaunch dependency is separate from durable intent
and runner observation. It rechecks canonical admission before process creation
and again while the observed runner remains suspended, before resume. Each
decision binds the attempt and request. Its dedicated maximum ten-second budget
is also bounded by the task's remaining duration; ordinary event, evidence and
supervisor callbacks retain their five-second maximum. Refusal, cancellation or
late completion cannot authorize resume. The native qualification driver wires
both phases to the canonical preflight with the supplied abort signal.

## Preservation and reruns

Output contains local paths and receipts with possible recovery pre-images.
Keep it local; publish only the bounded redacted result. Preparation failures
retain the owned output and failure.local.json for diagnosis. Existing output
is never reused or deleted. No automatic cleanup or repair is performed.

After hook or installed-asset changes, prepare a new output directory from the
final candidate and repeat human review. An earlier package's result cannot
qualify new bytes. Later cleanup must first establish process termination and
preserve the required evidence; it must target only the explicitly owned fixture.

The qualifier preserves a bounded diagnostic snapshot before removing its owned
ephemeral PostgreSQL cluster. This snapshot is not operational authority and
cannot restore or resume an attempt. A failed run's marker and evidence remain
intact. Any subsequent qualification uses fresh database and attempt identities.
Removing an owned marker requires preserving its exact bytes and a reviewed
reconciliation record: confirmed process termination, independent absence of
the observed runner and descendants, and unchanged roots and Git metadata apart
from explicitly accounted effects. Unknown processes or unexplained changes
block removal. No failed evidence is converted to PASS after a source fix.

## Refresh a candidate without changing the reviewed definitions

Before the first delegated attempt, a package-only correction can retain the
three disposable roots and their selected native home. This bounded operation
uses a new output directory for the new archive, installed engine and evidence.
It never rewrites authentication or trust, copies a profile, authorizes a revoked
root, or treats a previous package's native result as evidence for the new package.
Any existing .codex/aidn-agent-attempt.json marker blocks refresh, including a
failed or indeterminate attempt. Reconcile that attempt before considering any
later reuse; this tool neither removes its marker nor replaces its baseline to
hide a failed native run.

~~~text
node tools/verify/refresh-agent-native-candidate.mjs --manifest <reviewed-manifest.local.json> --trust-evidence <native-trust-observed.local.json> --output-root <new-absolute-directory>
node tools/verify/refresh-agent-native-candidate.mjs --manifest <reviewed-manifest.local.json> --trust-evidence <native-trust-observed.local.json> --output-root <new-absolute-directory> --write --expect-plan <preview-plan-id>
~~~

The native evidence records a human confirmation and the supported hooks/list
API response for both worker roots, with enabled, trusted project hooks and their
native hashes. Its candidate, source, executable and selected home must match the
reviewed preparation, and its discovery process must be closed. With linked Git
worktrees the client may resolve the hook source in the coordinator root; the
refresh verifies that exact source as well as each worker's handlers. A listed
trusted hook still does not establish an executed hook.

Preview creates no files, invokes no package manager or Codex client, and grants
no native trust. Its fingerprint binds the source snapshot, observed review,
root/receipt/Git/runtime preimages, native home directory identity and output
path. Changed preimages invalidate the explicit write request. Apply requires a
clean source checkout. The tool never reads or copies profile contents: native
databases, locks, authentication and logs are outside its inventory. Its writes
are bounded to the new output and the three canonical installation receipts.
Native trust is verified through the separate API observations.

Before any write, the source installation plans must preserve every installed
asset, including the exact hook definition and handler bytes. The same condition
is checked again using the packaged candidate before touching an existing root.
Only root-specific receipts and new canonical installation transactions may
change, via planInstallation and executeInstallation with verify-only. Each root
must remain active under its existing authorization revision; activation drift,
revocation, an attempt marker, changed Git state or an asset update stops the
refresh. Failure preserves the new output and any partial installation state;
it never silently rolls back, repairs or deletes earlier evidence.
The worktrees' .git pointer files have a separate type, size and content-hash
preimage, checked before and after installation. This evidence supplements the
original baseline without silently rewriting it.

The resulting manifest and baseline retain the preparation format and point to
the new exact candidate. Native execution remains NOT_RUN. The status
of each later refresh is bound to its complete prior chain, limited to 32
manifests. Every prior manifest and trust observation is checked by hash, with
unchanged root, activation and hook identities. Roots and the native home stay
in their original locations; each package belongs to its own output directory.
The isolated home remains inside the original preparation. A preexisting home
must keep its exact physical identity and stay disjoint from outputs, engines
and qualification worktrees. It cannot be inside the source checkout. A source
checkout managed below that home is allowed: packing reads that selected
checkout, without traversing the surrounding profile. Its mode and identity are
immutable across the lineage;
the helper never inspects its contents or copies a runnable profile policy.
New output cannot be inside any previous output, and the preview fingerprint
includes the chain. A missing, changed or cyclic chain is refused. The status
PRESERVED_DEFINITION_RECHECK_REQUIRED means the supported native API must be read
again in the same home for both worker roots; source paths, native hashes, enabled
and trusted state must match the earlier observation. Only unchanged roots and
definitions can retain their existing approval. A difference requires renewed
human review through native controls. Then repeat all native qualification cases
against the new package hash, including allowed and refused edits, descendant
termination and preservation; the old package's results are not transferred.
For preexisting mode, also observe the effective configuration and consented
effects again, freeze the local policy and bind the new review to the refreshed
manifest and candidate. Fresh launch-time observations remain mandatory.

## Public lifecycle qualification (lot 7 candidate)

The production composition now reuses the metadata observer and bounded
bootstrap from `src/application/runtime/codex-native-profile-observation-service.mjs`
and `codex-native-profile-bootstrap-service.mjs`. The historical tool exports
remain compatible. `codex-agent-attempt-service.mjs` performs actual delegated
admission, authenticated transport and pinned execution. Import and construction
do not probe a profile. Preview verifies pinned local evidence and PostgreSQL
readiness without launching Codex; fresh native observations still precede an
explicit worker launch.
The production metadata bridge uses a separately pinned Node executable
(`native.metadata_runner`) inside the controlled Job. Its journal distinguishes
closed parent observations from actual descendant termination. Historical
`closed`/`pid_absent` flags cannot satisfy recovery of that tree; every invocation
needs a matching candidate/helper/Node/bridge proof, including after an error.
This new bridge has not received native qualification for the lot 7 candidate.

Prepare a new catalogue for the campaign before reserving the run. It needs one
distinct pristine worker root per attempt, including the dependent task; do not
reuse a dirty root or a previous campaign's marker. Canonical installation is
verify-only with an independent receipt at each root. Freeze base SHA, task
contract hashes, root identities and complete preimages, then review the exact
native hook definitions and observe trust for every root through the supported
native API. Linked worktrees may legitimately share the coordinator's hook
source; this never substitutes for observing trust at each worker root. The
initial native capacity is one to four worker roots, separately from concurrency.

Claim and placement occur later. The supervisor may place a pristine reviewed
root at a dependent task's integrated SHA only under current authority and an
immutable placement intent, preserving installed controls. Unexpected state,
conflict or interrupted placement stops the run without reset. Each native
metadata bootstrap has its own retained intent/terminal evidence. A never-started
worker does not prove the distinct metadata process stopped.

The public configuration pins the candidate, runtime, helper, preparation,
native profile/consent, Git executable and validation boundary. A helper or
trampoline change requires new native evidence. Earlier lot 4 results qualify
only their original bytes. The final lot 7 campaign must run two actual Codex
workers concurrently, integrate their independent scopes, run a dependent task
on that integrated SHA, validate and audit it, and demonstrate preservation and
owned cleanup. This campaign has not been executed for the current lot 7
candidate. Portable fixture PASS, native metadata readiness and human approval
remain distinct from that final result.

Windows process and validation confinement probes are separate explicit tools;
they are not required Linux CI invocations. The current production path selects
Windows preexisting-profile mode only. Unqualified OS/profile/helper/boundary
compositions report UNAVAILABLE and cannot fall back to ordinary subprocesses,
copied trust or a different sandbox. Existing profile setup is a precondition,
never an implicit lifecycle effect.

Validation-boundary file inspection streams the selected Codex client up to
512 MiB, matching the worker client bound. Runner, trampoline, controller source
and helper pins retain their 256 MiB limit. Reads use at most 64 KiB chunks and
verify the complete SHA-256 plus unchanged file identity and size; increasing the
client bound does not authorize a client or establish native availability.

The validation backend currently fails that prerequisite. The inspected official
source for Codex `0.158.0-alpha.2.1` invokes an elevated setup refresh on the
`codex sandbox` path even when sandbox state exists. Its current implementation
therefore returns `SANDBOX_EXISTING_ONLY_UNSUPPORTED` before any native process,
including qualification probes. A positive local attestation cannot override
that refusal. The final lot 7 native campaign is UNAVAILABLE until an explicitly
authorized compatible backend is implemented and independently qualified.
Portable checks and Job/trampoline fixtures may still pass; they do not close
that confinement requirement or establish merge/release readiness.

## Managed elevated preparation: review before effects

The `managed-elevated` preparation model is distinct from the historical
existing-only path above. It declares that the official Windows backend may
refresh setup on every launch, including when provisioned state already exists.
It does not weaken `SANDBOX_EXISTING_ONLY_UNSUPPORTED` or enable a managed
executor. Preparing a reviewable plan is the present scope; the native campaign
remains UNAVAILABLE.

Before the first proposed native operation, obtain a read-only inventory for the
exact host, client and profile, then review a versioned effects manifest. The
manifest names pinned executables, physical roots, exact resource identities and
permitted create/update operations. Inventory all eleven categories: local
accounts, local groups, filesystems, filesystem ACLs, WFP rules, firewall rules,
desktops, device ACLs, local policies, services and registry state. Each category
binds its observation scope and digest; a complete category describes that
bounded scope, never the whole OS. Missing coverage produces
`PREPARATION_BLOCKED`; it cannot be silently treated as complete. Protected
resources and everything outside the allowed effects within the declared
observation scope must retain their observed state. Host inventory and project
preservation are distinct from native hooks or confinement evidence.

The pure contracts in `src/core/agents/codex-managed-sandbox-contracts.mjs`
validate the effects manifest, inventory, preparation plan and scoped approval.
They use distinct versioned `codex-managed-sandbox-*` records and perform no
filesystem, process or clock reads. The read-only preview consumes explicit local
documents:

~~~text
node tools/verify/prepare-codex-managed-sandbox.mjs --manifest <effects.json> --inventory <inventory.json> --json
~~~

It does not collect host information, invoke Codex or accept an execution flag.
The separate PowerShell collector
`tools/verify/codex-managed-sandbox-inventory.ps1 -RequestPath <request.json>`
performs explicitly selected read-only observations. Incomplete WFP or policy
visibility remains partial coverage; the collector never repairs privileges or
changes those resources to make inventory succeed. Its additive
`dimension_candidates` field retains typed projections already observed for the
two selected accounts and groups, explicit files, DACLs and UserList values.
Candidates bind the unchanged v1 inventory and final observer context, including
selected modules. They stay partial: missing flags, physical file identity or
descendant expansion are not invented, and only proven not-found observations
represent absence. Credential contents are never exposed. These candidates do
not become exhaustive operation receipts. Keep the actual inventory local and
use neutral fixture data in tracked examples.

A complete preparation preview has status `PREPARED_NOT_AUTHORIZED` and a canonical
fingerprint; it reports no available execution capability. A separate explicit
user approval must reference that exact plan and its manifest/inventory/host/client
bindings, with a bounded validity interval. A changed inventory, executable,
root or manifest invalidates that approval. The pure approval validator uses an
explicit observation time; inventory freshness and the approval interval are
bounded to five minutes. A preparation tool never manufactures approval or
writes native trust or configuration.

The initial collector intentionally reports partial coverage. A projected
account or DACL inventory does not need credential contents or an inventory of
the whole OS. Before operational use, a reviewed policy must map the exact
client and phase (setup, refresh or command launch) to the observed dimensions
it requires, including justified non-applicable categories. Structural
completeness alone does not establish that those observations cover the effects.
The separate pure policy in
`src/core/agents/codex-managed-sandbox-operation-policy.mjs` now defines those
requirements for the pinned client's legacy `windowsSandbox/setupStart` phase.
It distinguishes reviewability from authorization and operational availability.
The initial collector does not yet emit exhaustive dimension receipts. A caller
cannot supply a replacement requirements list or turn partial coverage into
complete evidence. Even structurally valid receipts do not prove authenticated
collection or establish that an operation is authorized.

An optional read-only assessment uses explicit operation and observation documents:

~~~text
node tools/verify/prepare-codex-managed-sandbox.mjs --manifest <effects.json> --inventory <inventory.json> --operation <operation.json> --at <ISO-time> --coverage <coverage.json> --json
~~~

Omitting `--coverage` reports the missing evidence. This mode returns the
separate `codex-managed-sandbox-operation-preview.v1` envelope. The historical
preview shape is unchanged when `--operation` is absent. Neither mode has an
execute switch. Legacy cleanup, transactional replacement and log retention have
explicitly unsupported mechanisms under the create/update-only manifest.

Separate internal setup-effect recipes now represent the closed mechanisms
needed for review without changing that manifest. Their model checks bind the
operation, observations and preimages and retain missing postconditions as gaps.
They cannot turn model inputs into authenticated host evidence or approval.

The internal setup protocol and injected duplex channel describe one fresh
connection, initialize it and request only the fixed elevated setup operation.
Streaming input, callbacks and stop requests are bounded. Setup completion is
recorded separately from transport termination; a transport receipt is still an
injected assertion until an actual controller proves the stopped Job. These
modules contain no process launcher and are not a managed native backend.

A separate candidate transport and bridge now describe the concrete app-server
launch, with pinned executables and source inventory, closed arguments and
environment, prerequisite bindings and a fresh read-only containing-Job
preflight. The controlling parent creates the bridge suspended through the
process-controller port and requires authorization and preflight again before
resume. It keeps channel completion, natural app-server closure, actual empty-Job
proof and observed effects distinct. An uncertain operation blocks further
operations in that parent instance. Neither the bridge nor the parent is
registered as a native executor.

The pure shared constructor in `src/core/agents/codex-startup-arguments.mjs`
preserves the historical worker settings and order. It disables each explicitly
listed MCP/plugin/app integration, notifications and memory features without
erasing hook configuration. Empty tables do not neutralize inherited entries;
the complete observed identifier lists must be fixed before startup. The
managed startup record contains exactly `state_root`, `mcp_server_ids`,
`plugin_ids`, `app_ids` and `environment_override_names`. It selects the closed
12-name environment profile, places logs in `state_root/logs` and SQLite in
`state_root/sqlite`, and binds `TEMP` and `TMP` to `state_root`. This root must be
physically distinct from the profile, operation cwd and candidate; the parent
and bridge require the directories to exist and do not create them implicitly.
Authentication refresh, profile caches and native historical metadata backfill
remain explicitly reviewed startup effects; redirecting SQLite is not a promise
of no profile effects or a bound on native disk consumption.

Internal protocol `aidn-controlled-managed-setup.v2` requires that startup record.
`aidn-managed-setup-prerequisites.v2` includes its `startup_sha256` alongside the
argument, environment and configuration hashes. Version 1 inputs are refused
without migration or inferred defaults. A managed metadata observation must use
the same full startup arguments, profile, cwd and environment as the setup it
describes. A hash from differently overridden metadata cannot authorize setup.
The controlled metadata collector now accepts the explicit
`metadataProfile: "managed-setup.v1"` option for one root. It adds only the
`configRequirements/read` RPC and returns that response separately. Its bridge
uses internal protocol v2 for this option; the absent-profile historical path
retains v1, its output shape and response count. It does not start a thread,
worker or setup. Natural app-server closure and an observed empty Job are still
required. Raw configurations and layers remain transient, not retained evidence.

`config/read` exposes merged TOML values and their layers, not the compiled
`PermissionProfile`. If a named permission profile applies, the legacy
`sandbox_mode` and `sandbox_workspace_write` values alone do not establish its
effective filesystem or network permissions. Resolving and checking that exact
permission configuration remains separate from argument construction.
The pure `assessManagedSetupConfiguration` checks only a restricted Legacy
source configuration. The reviewed client's `configRequirements/read` must return
exactly `{requirements: null}`; every object is refused, including an object of
null visible fields, because the RPC does not expose all managed filesystem and
profile constraints. Non-null permission profiles are refused. Source files,
the unique session override layer, origins and each startup setting must agree.
An explicitly absent source can cover only an empty layer. A successful assessment
retains `PERMISSION_SCOPE_UNRESOLVED`: Windows path expansion, previous deny-read
state, runtime ACL effects and physical preservation require separate observation.
It supplies no setup prerequisite receipt, authorization or native availability.

The separate pure Legacy scope projector recomputes that assessment and derives
the setup path lists from the closed environment and explicit physical facts.
Its supported subset requires a new cwd without `.git`, `.agents` or `.codex`,
absent SSH configuration, an absent or empty prior deny-read state, and complete
runtime enumeration without aliases or reparse points. Up to 4,096 descendants
and three runtime roots are represented individually; a limit hit is a refusal,
never partial authority.
Present path facts use canonical hexadecimal volume and 128-bit file identities
with unique identity pairs; files require an observed link count of exactly one.
These remain caller-supplied facts, not a substitute for a physical observer.
The derived preimage binds configuration, environment and observations to the
six lists. A caller-supplied digest alone cannot substitute for that derivation.
These facts remain structural inputs until an actual bounded observer supplies
and authenticates them. The projector neither grants setup permission nor closes
ACL, network, failure-path or process-provenance gaps. The historical Windows
inventory request remains capped at 512 paths; the larger pure projection is not
a qualification of that collector or a complete setup composition. Facts/scope
v2 supports up to 32 immediate USERPROFILE directory junctions: the original
listing remains complete, link identities are obtained without following the
reparse point, and targets are canonical observed directories strictly inside
that profile with no reparse ancestors. The pinned client canonicalizes these
targets; the projector applies its exclusions and deduplication. Chains, cycles,
outside targets and aliases elsewhere remain refused. V1 retains its refusal.

The separate `tools/verify/codex-managed-setup-scope-facts.ps1` producer observes
only this closed physical subset. Its versioned request binds roots, observer
context and duration; FileIdInfo and link counts use the same handle. Two bounded
passes compare identities, complete listings and junction targets. Only Win32
NotFound establishes absence. The only file content accepted is the small empty
prior deny-read state; no SSH configuration or credential content is read.
The parent must pin and contain this producer and bind its request, PID, creation
time, output digest and stopped Job. A syntactically valid observation or supplied
context hash alone supplies no authenticated authority. This producer does not
collect ACL/network effects and does not launch setup or qualify a native executor.

The portable transport/bridge and parent fixtures use doubles and perform no
setup. The separate Windows preflight campaign has 89 checks with mocked token,
process, Job and helper observations; native declarations are compiled but never
called. Those results do not establish actual token privileges, containment or
helper absence. The production authority ports `authorizeOperation`, `preflight`
and `compareEffects` still need their approved composition. Startup and effective
configuration, complete observed effects and exact-operation authorization remain
required before any first native setup operation. No candidate or fixture result
satisfies those prerequisites implicitly.

A separate locally retained native preflight campaign exercised `before_create`,
`before_resume` and `inside_bridge` with inert Node processes. It also rejected
a 100 ns process-creation mismatch and a wrong Job. Six Jobs were observed empty
in 12.057 seconds, and 124 audit checks passed. The exact PowerShell preflight
producer SHA-256 was
`3a6070533c4ae6eb2cd88f79d1cc709c2da5d7339e215cf5419236a5dd44052f`.
The private plan, process identities and host paths remain outside the repository.
This evidence covers the observed preflight script and process/token checks; it
ran no Codex, setup or worker and does not qualify the startup/bridge changes,
complete setup effects or the managed backend. The 89 mocked PowerShell checks
above remain a distinct evidence set.

Collector diagnostics identify the observer's token context and projection
digest, provider duration, exit code and privilege-related failures without
returning raw WFP XML, credentials or provider error messages. Scope digests
include the observer context: observations under different tokens cannot be
silently compared as equivalent. Registry reads target only the two documented
UserList values; this projection is not registry completeness.

For controlled setup, an app-server started without elevation is insufficient:
the official provisioning path may use UAC, whose helper is not proven to belong
to the AIDN Job. A future broker must already be elevated before creating the Job,
exclude service and Registered Core routes, and reconcile external ACL helpers.
The Job's empty-process proof covers only its members. It cannot prove that a
pre-existing helper or service stopped. First collect privileged diagnostics in
a separately reviewed read-only operation; no setup or worker belongs in that
collection.

For the pinned client above, setup also refreshes ACLs, persists configuration
and can start an asynchronous read-ACL helper. Its completion notification does
not prove the termination of that helper or the stabilization of its effects.
Legacy cleanup and WFP replacement also require phase-specific treatment; the
preparatory create/update manifest grants no general deletion authority.

A future managed operation must observe the effects of every launch, including
setup refresh, and accept only the declared resource changes. Unexpected,
unobserved or indeterminate effects stop subsequent launches and preserve the
evidence for reconciliation. The same profile's continued operation must also
be observed; successful setup alone is insufficient.

After the managed backend is implemented and an exact operation is approved,
qualify its filesystem denial, disabled network, timeout, cancellation and
callback-failure behavior. Then qualify the worker and run the two-worker plus
dependent-task campaign on the exact candidate. Neither a project pilot nor an
older worker result replaces these requirements. Current preparation artifacts
perform none of these native operations.
