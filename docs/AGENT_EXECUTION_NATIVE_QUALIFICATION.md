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
- Creates an empty isolated CODEX_HOME and a local REVIEW.md containing the
  exact installed hook definitions and /hooks review instructions.

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
native client's supported controls. Use the recorded isolated home. If native
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
The worker reads its explicitly isolated CODEX_HOME configuration, because
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
Raw Codex JSONL, an exit code of zero, a model's statement, a simulated hook
payload or a passing fixture is insufficient. Record PASS, FAIL, SKIP and
UNAVAILABLE separately. Results bind to the exact candidate, executable,
native surface and OS tested; another OS remains unavailable until qualified.

The preparation helper never runs a model, opens a native session, approves
trust, starts PostgreSQL or executes these cases. Its successful status means
only that the concrete review materials and isolated clients are ready.

The internal qualify-agent-native-worker driver previews by default. Its
explicit write mode permits four bounded calls: acquisition of edit/refusal
evidence, cancellation, timeout and the executor port check. It requires an
explicit model and effort preset, the exact package/helper manifests and a
review proof bound to those choices. Missing prerequisites or incomplete cases
remain NOT_RUN, UNAVAILABLE or FAIL as applicable; a partial run never grants
qualification. Its evidence and failed-attempt markers remain available for
reconciliation. This driver adds no public agent-run command or output contract.

Each scenario uses a distinct ephemeral database, durable launch intent and
attempt. Planning is published at revision zero, then advanced to revision one
by the canonical compare-and-swap writer before reservation. A JSONB reread must
match every request value; object key order is immaterial, while array order is
preserved. PostgreSQL cleanup and native process cleanup are reported separately.

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
three disposable roots and their isolated native home. This bounded operation
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
native hashes. Its candidate, source, executable and isolated home must match the
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
in the original preparation; each package belongs to its own output directory.
New output cannot be inside any previous output, and the preview fingerprint
includes the chain. A missing, changed or cyclic chain is refused. The status
PRESERVED_DEFINITION_RECHECK_REQUIRED means the supported native API must be read
again in the same home for both worker roots; source paths, native hashes, enabled
and trusted state must match the earlier observation. Only unchanged roots and
definitions can retain their existing approval. A difference requires renewed
human review through native controls. Then repeat all native qualification cases
against the new package hash, including allowed and refused edits, descendant
termination and preservation; the old package's results are not transferred.
