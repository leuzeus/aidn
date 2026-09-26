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
Raw Codex JSONL, an exit code of zero, a model's statement, a simulated hook
payload or a passing fixture is insufficient. Record PASS, FAIL, SKIP and
UNAVAILABLE separately. Results bind to the exact candidate, executable,
native surface and OS tested; another OS remains unavailable until qualified.

The preparation helper never runs a model, opens a native session, approves
trust, starts PostgreSQL or executes these cases. Its successful status means
only that the concrete review materials and isolated clients are ready.

## Preservation and reruns

Output contains local paths and receipts with possible recovery pre-images.
Keep it local; publish only the bounded redacted result. Preparation failures
retain the owned output and failure.local.json for diagnosis. Existing output
is never reused or deleted. No automatic cleanup or repair is performed.

After source or hook changes, prepare a new output directory from the final
candidate and repeat human review. An earlier package's result cannot qualify
new bytes. Later cleanup must first establish process termination and preserve
the required evidence; it must target only the explicitly owned fixture.
