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
select the currently operational home explicitly. Historical setup markers in
another home do not prove compatible credentials: the reviewed Windows client
uses shared local accounts with credentials stored per home, and a failed logon
can trigger a password rotation that invalidates the other home's credentials.
Use the operational profile, not an old test home's apparent readiness:


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

Before execution, an explicitly selected local codex-native-profile-policy.v1
or codex-native-profile-policy.v2 document binds the home
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

During metadata observation, `account/updated` is an informational notification
when it has no id and its params value is an object (including an empty object).
The observer ignores its values without retaining them or granting authority;
this envelope check is not full payload validation. Expected responses,
preservation checks, byte limits, deadlines and process closure remain required.
Requests with an id and all other unexpected methods remain refused. A retained
method-only diagnostic cannot establish the contents of an earlier payload.

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
(for example, 60 + 150 seconds). The worker ceiling starts only after preparation
and its canonical preflight complete, and remains fixed through the separate
before-create and before-resume checks. Preparation cannot consume or extend it.

The native timeout scenario does not predict one model invocation's latency from
another. After observing the actual admission-hook descendant, it arms a separate
three-second monotonic deadline inside the fixed 150-second worker ceiling. Both
the hook's own deadline and the worker ceiling must retain the required margin.
The scenario records the arm time and expiry, observes the same descendant again
before expiry, then requires a real timed-out result, a confirmed empty Job and
independent absence of the observed process identities. A missing or late hook
fails the scenario; it never causes an automatic retry.

The internal controller's optional timeoutSignal invokes its existing timeout
stop path. It can only stop work earlier: the fixed timer remains active, normal
signal cancellation remains cancelled, and the first stop reason is retained.
No result is relabeled after execution. The helper protocol, public task request
and production executor's fixed duration remain unchanged.

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
cannot restore or resume an attempt. The first refused activation check also
retains a local diagnostic below 1 KiB: the root role, evaluated boolean
predicates, and a known code or unknown-code digest. Unevaluated predicates are
absent; messages, paths and asset contents are not retained. This evidence does
not retry or relax activation and does not establish an earlier unrecorded cause.
A failed run's marker and evidence remain intact. Any subsequent qualification
uses fresh database and attempt identities.
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

The controlled metadata bridge verifies the complete candidate inventory before
creation and again before resuming its suspended process. Each pass uses at
most four concurrent file readers, retains the physical-path and before/after
identity checks, and stays inside the original observation deadline. There is
no cross-pass hash cache. A failed pass stops assigning reads. If in-flight
reads cannot settle within the original remaining budget, their cleanup stays
unconfirmed and the collector refuses subsequent calls. After a confirmed
empty Job, a callback refusal retains its first bounded integrity or deadline
code; controller timeout,
cancellation and unknown termination retain their own precedence.
Native qualification of this bridge must be retained for the exact candidate
and helper composition before public agent-run execution is admitted.

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
owned cleanup. Retain the campaign evidence with its exact candidate and
composition bindings. Portable fixture PASS, native metadata readiness and human approval
remain distinct from that final result.

Windows process and validation confinement probes are separate explicit tools;
they are not required Linux CI invocations. The current production path selects
Windows preexisting-profile mode only. Unqualified OS/profile/helper/boundary
compositions report UNAVAILABLE and cannot fall back to ordinary subprocesses,
copied trust or a different sandbox. Existing profile setup is a precondition,
never an AIDN setup or repair fallback. Explicit v2 selection separately declares
the official client's sandbox maintenance during execution.

Validation-boundary file inspection streams the selected Codex client up to
512 MiB, matching the worker client bound. Runner, trampoline, controller source
and helper pins retain their 256 MiB limit. Reads use at most 64 KiB chunks and
verify the complete SHA-256 plus unchanged file identity and size; increasing the
client bound does not authorize a client or establish native availability.

The inspected official source for Codex `0.158.0-alpha.2.1` invokes an elevated
setup refresh on the `codex sandbox` path even when sandbox state exists. V1
therefore retains `SANDBOX_EXISTING_ONLY_UNSUPPORTED` before any native process.
Neither setup completion nor a local attestation overrides that refusal.

V2 is a separate explicit contract, not a relaxation of a v1 proof:

- Select `codex-native-profile-policy.v2` and `backend.provisioning: codex-managed`
  for a worker. Obtain the v2 effect digest through
  `readCodexNativeProfileSharedEffects(home, "codex-native-profile-policy.v2")`.
  Consent includes `approved`, `state_root`, that `shared_effects_sha256` and
  `sandbox_maintenance: codex-managed`. A v1 consent is rejected.
- Select `codex-sandbox-validation-configuration.v2` for validation. Its exact
  protected resource list covers configuration, data, Git and runtime, with
  physical paths and file/directory kinds. The qualification plan fingerprints
  this list and its complete ordered preimages. OneDrive remains excluded.
- Codex owns maintenance of its sandbox accounts, permissions and network rules.
  Setup markers are observations, not immutable v2 authorities. AIDN never
  substitutes `provisioning_performed: false` or a claim that all Windows state
  is unchanged. Configuration sources, hooks, trust and the declared protected
  resources remain frozen.
- Windows v2 declares the official backend's required `:root` read access.
  Only scratch is writable; snapshots remain read-only, the supervisor and
  selected Codex home are explicitly denied, and network is disabled. This is
  not a claim of global OS-level read isolation or a OneDrive read prohibition.
  The named permissions are supplied as structured native CLI overrides from
  the frozen policy, without editing user configuration. Native denial probes
  must confirm the protected boundaries before availability can be granted.
  The reviewed client currently fails this boundary before launch with
  `SANDBOX_SHARED_DENY_READ_UNSUPPORTED`. A signed
  `agent-verification-boundary.v2` report cannot override that incompatibility.
  A future compatible composition still needs all five native proofs.

An unavailable or failed native composition stays unavailable. The final lot 7
campaign remains unexecuted until the exact composition passes these checks.
Portable checks and Job/trampoline fixtures may still pass; they do not close
that confinement requirement or establish merge/release readiness.

## Cooperative qualification (plan v2 / boundary v3)

`agent-execution-plan.v2` selects `assurance_profile: codex-cooperative.v1`.
Its validation configuration is `codex-sandbox-validation-configuration.v3`
and its qualification is `agent-verification-boundary.v3`; both explicitly
declare `read_isolation: not_guaranteed`. Strict plans and evidence remain
separate. The worker continues to use the independently versioned
`codex-native-profile-policy.v2` with its existing home and Codex-managed
maintenance consent. No new profile, history copy or setup path is introduced.

This mode assumes cooperative agents. Reads of the profile, supervisor and
on-disk secrets are not isolated. AIDN's environment allowlist still excludes
PostgreSQL credentials. Named-resource preimages establish observed
preservation, not absence of reads or resistance to a hostile worker. OneDrive
remains excluded from AIDN tasks and resources without changing its permissions.

Worker commands use official `codex exec --sandbox workspace-write`. Validation
commands use official `codex sandbox` with root/snapshot reads and scratch-only
writes, without profile/supervisor read denials. Network access is disabled for
sandboxed commands; native model service traffic and the supervisor admission
transport are distinct. Retain the existing restrictions on integrations,
approval escalation and nested agents. The supervisor, not Codex exit zero,
decides acceptance after scope inspection, integration and exact-SHA checks.

After portable fixtures and an independent review, freeze one source commit and
package and the explicitly selected operational client. Store new evidence
outside the package. Reuse pinned helpers only when their source and binary
hashes match. Do not relabel old reports or run a newer client automatically.
The existing qualification helper accepts an exact approved probe plan to
collect first evidence; it neither signs its own qualification nor relaxes
production admission. Its five cases remain filesystem, network, timeout,
cancel and callback, with at most 60 seconds per cooperative case plus bounded
controller shutdown. Report preparation, observed child startup and actual
probe execution separately.

The filesystem case must witness a second native launch while checking write
denials on the snapshot and supervisor, then check again after that launch has
stopped. Both process identities and confirmed Job termination belong to the
evidence. Reading the supervisor is an observation, not a required denial.
Any forbidden write, unexpected named-resource change, network access or
unknown termination still fails qualification. A failed case stops the campaign
and retains its resources; there is no automatic repair or retry.

After these cases pass, run the existing real-worker admission campaign with
fresh candidate bindings, then the neutral three-task campaign using three
independently prepared `verify-only` worktrees and disposable PostgreSQL.
Concurrency is two, each task has at most five minutes and the run at most
fifteen minutes. Two workers must actually overlap; the dependent task must
start from the integrated predecessor SHA. Integration, validation, audit,
reconciliation and controlled cleanup retain their original proof requirements.
Publish fixture, PostgreSQL, Windows process/sandbox and real-Codex results
separately. Cooperative native availability remains unqualified until these
reports agree; portable PASS never supplies missing native evidence.

## Cooperative network limitation (plan v3 / boundary v4)

An explicit `agent-execution-plan.v3` selects `codex-cooperative.v2`.
Its configuration `codex-sandbox-validation-configuration.v4` and qualification
`agent-verification-boundary.v4` declare both `read_isolation` and
`network_isolation` as `not_guaranteed`. Qualification requires
`network_disabled: false`, meaning denial is not attested. Earlier plans and
the v3 boundary above keep their original network-denial requirement.

The selected Windows composition reached a loopback canary despite
`network.enabled=false`. Its failed report is preserved; it does not establish
Internet access. This new profile removes only network denial from delivery
and activation criteria. Official Codex invocations still request disabled
networking. AIDN adds no firewall repair, proxy, setup or new native home.

The v4 probe plan selects four required `cases`: filesystem, timeout, cancel and
callback. Its separate `diagnostic_cases` contains network and runs only when
explicitly selected. That diagnostic retains its actual PASS or FAIL and is
never accepted as qualification evidence. The four required reports must bind
to the v4 profile, candidate, policy, process identities and named resources;
old reports cannot be relabeled. A failed required case still stops the campaign.

Concurrent write protection, scratch-only validation writes, immutable snapshots,
confirmed descendant termination, real admission hooks, exact-SHA acceptance,
the three-task parallel campaign, reconciliation and controlled cleanup are
unchanged requirements. A missing proof keeps this composition unavailable.
Previews expose the network limitation and include it in the action fingerprint.
Do not advertise network isolation or full qualification from this exception.

## Reviewed Windows client incompatibility

The following finding applies to the strict validation contracts v1/v2. Their
refusal is retained. It does not qualify or prohibit the separate cooperative
contracts above, whose retained guarantees need new native evidence.

Source review at Codex commit
[0d9c7cbfa6cf1489f55a8a9542b75ddd2c061807](https://github.com/openai/codex/commit/0d9c7cbfa6cf1489f55a8a9542b75ddd2c061807)
identifies a separate v2 blocker. The elevated path calls an ordinary refresh,
including with valid existing credentials. The refresh skips account provisioning
but still reconciles persistent deny-read ACLs for the common sandbox group.
The registry is keyed by Codex home and group SID, without an active-process
lease. Another launch in the same home with no deny paths can remove the
validation's denials while its process still runs. See the
[refresh call](https://github.com/openai/codex/blob/0d9c7cbfa6cf1489f55a8a9542b75ddd2c061807/codex-rs/windows-sandbox-rs/src/identity.rs#L269-L280),
[shared-group reconciliation](https://github.com/openai/codex/blob/0d9c7cbfa6cf1489f55a8a9542b75ddd2c061807/codex-rs/windows-sandbox-rs/src/setup_provisioning.rs#L896-L930)
and [removal of previous denials](https://github.com/openai/codex/blob/0d9c7cbfa6cf1489f55a8a9542b75ddd2c061807/codex-rs/windows-sandbox-rs/src/deny_read_state.rs#L38-L65).

For this client, v2 is refused before observation, intent writes or process
creation with `SANDBOX_SHARED_DENY_READ_UNSUPPORTED`. One-time canary success
and signed evidence cannot make this shared state into a per-process guarantee.
AIDN introduces no global lock, ACL repair, alternate profile or fallback to
circumvent the refusal. Extending a startup timeout does not fix this property.

The local root-read attempt ended at its 15-second process limit without the
probe handshake. Its containing Job reached zero active processes and the named
protected files were unchanged. This is failed native evidence, not a successful
confinement test. The source finding above is independent of the timeout; it does
not establish which startup operation consumed those 15 seconds. No later native
case or final concurrent-worker campaign was executed for that candidate.

## Use Codex setup; qualify AIDN separately

Codex provides the sandbox and its setup/repair flow. Use the
[official Windows sandbox controls](https://learn.chatgpt.com/docs/windows/windows-sandbox)
or the documented
[`windowsSandbox/setupStart` API](https://learn.chatgpt.com/docs/app-server#windows-sandbox-setup-windowssandboxsetupstart)
as an explicit operator action outside `agent-run*`. AIDN does not implement a
second setup path, administer Windows security state or attempt repairs after a
failed availability check. The former managed-setup experiment is withdrawn;
its source history remains in Git.

| Codex responsibility | AIDN responsibility |
| --- | --- |
| Sandbox installation, configuration and native execution | Check the selected backend's availability and refuse incompatibility |
| Native authentication and project/hook trust | Bind the reviewed configuration and verify real hooks and delegated admission |
| `codex exec` and its JSONL task events | Bound inputs/output, explicit cwd/configuration, timeout and independent descendant-stop proof |
| Native process behavior | PostgreSQL claims/leases, dependency order, file scopes, Git integration and audit of the exact SHA |

Follow these steps without introducing a new preparation subsystem:

1. Establish an operational sandbox through Codex's supported controls. Record
   the selected client/profile; do not copy history, credentials or trust as a
   workaround. No additional profile bootstrap is required by this correction.
2. Prepare the exact candidate package and dedicated worktrees outside OneDrive
   using the procedure above. Each worktree retains its own `verify-only`
   installation and native review.
3. Freeze the selected contract and check native prerequisites. V1 remains
   refused for the reviewed client. An explicit v2 plan declares Codex-managed
   maintenance and binds the protected resource observations; never switch
   versions or sandboxes after failure. AIDN performs no automatic setup or repair.
4. Run the distinct native confinement and worker probes: authorized edit,
   forbidden edit, observed hooks, timeout/cancellation, descendant termination
   and preservation of unrelated worktrees, Git and runtime state.
5. Only after those proofs, run the lot 7 campaign: two simultaneous workers,
   their dependent task, integration, validation and read-only audit on the exact
   integrated SHA. Record PostgreSQL, process and native Codex results separately.

`setupCompleted`, a successful `/hooks` review, a zero exit code and fixture PASS
are different evidence. None proves the next step automatically. Codex's
`turn/interrupt` requests an interruption; AIDN must still confirm that the
worker's descendants stopped before accepting cleanup or relaunch. The actual
supervised worker continues to use `codex-cli-task`, not a new App Server backend.

The final lot 7 campaign is **UNAVAILABLE / not executed** for this candidate
until the distinct native evidence is retained and reviewed. The v2 contract
correction alone is not a native qualification or merge-readiness claim.

## OneDrive exclusion in AIDN

The agent execution boundary rejects OneDrive workspaces, task scopes, request
paths and evidence/configuration paths before observing the excluded target.
It covers standard personal and business directory names, case variants, Win32
trailing-dot/space aliases and short-name spellings. Other short-name paths are
refused without resolving them. An ordinary filename such as `OneDriveConnector.mjs`
is not a OneDrive directory. Explicit excluded roots can also describe a renamed
cloud location; no provider scan discovers those roots implicitly.

Before delegated worktree activation, a bounded local precheck inspects Git and
installation pointers and refuses excluded destinations before following them.
It rereads pointer fingerprints after activation and grants no activation trust.
This remains an application policy with an external concurrent-change limitation.
It neither edits OneDrive ACLs nor proves that Windows, a shell or another client
denies reads. Native write admission retains its existing supported tool scope.
