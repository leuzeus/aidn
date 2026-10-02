# Workflow 0.12.0 qualification and release preparation

Lot 7 combines qualification of the six workflow lots and preparation of a
0.12.0 candidate. Delivery targets `dev` under ASSURED governance. A passing
qualification does not publish a release or install AIDN in this source repo.

## Evidence matrix

| Scope | Required source/package evidence | Limits |
| --- | --- | --- |
| Lot 1: current shadow and parity | `contracts-workflow-shadow`: SPEC-R01 through SPEC-R11, helper decisions, nominal/alternate/adversarial cases | Procedural human obligations retain their own evidence; the descriptor grants no execution authority. |
| Lot 2: pure compilation | `contracts-workflow-compilation`: deterministic hashes, both macros, malformed references, bounded-return exhaustion and denied ambient effects | Historical fixtures stay at 0.11.0. Compilation alone executes no handler. |
| Lot 3: explicit supervisor binding | Segment and lifecycle fixtures: configuration v1 compatibility, v2 pins, revocation, DAG/scope refusal, scheduler concurrency; required PostgreSQL public lifecycle previews | Injected adapters and disposable DB execution do not qualify a native Codex client. |
| Lot 4: durable instances | Instance and PostgreSQL suites: files/SQLite/DB checkpoints, CAS, reconnect, concurrent writers, interruption before/after effect, projection recovery, stale refusal | Recovery observes existing runs; it cannot invent acceptance or dispatch evidence. |
| Lot 5: reviewed definitions | Candidate and PostgreSQL suites: exact review, quiescent checkpoint, immutable history, future-instance selection and fenced selection CAS | No model call or automatic migration. |
| Lot 6: common console | Console and PostgreSQL suites: identical CLI/HTTP observations, pure previews, guarded writes, modes, canonical authority, origin/token rejection and stale UI approval | Loopback fixture service and synthetic activation evidence are distinct from native installation. |
| Cross-lot packaged path | `release-reproducibility`: use its first exact tarball to compile both macros, run the shipped CLI and HTTP server, record a human decision, review/activate a definition, initialize a future instance, reopen and compare observations | Files mode, disposable fixtures only. Separate runtime gates cover SQLite/PostgreSQL and supervised execution. |
| Upgrade refusal | Packaged path: retain an authentic 0.11.0 instance envelope, inspect its version blocker, reject a productive write, prove bytes unchanged; revoke activation after preview and reject application | No instance migration or external-client upgrade is claimed. |
| Release provenance | Version metadata, branch policy, deterministic ZIP/tarball/checksums, exact source commit, tracked allowlist, package topology and publication policy gates | A `dev` PR is preparation; publication must use the separate governed release branch and `main` workflow. |

The integrated package check imports product modules and serves assets only from
the extracted archive. Its CLI runs in a separate Node process with the extracted
entrypoint. Fixture preparation creates neutral install evidence in a separate
temporary directory; it never overwrites the extracted package or activates this
source checkout. Before/after snapshots check preview/refusal purity and package
immutability. Reopening the server and spawning fresh CLI processes check retained
state rather than an in-memory result.

## Running and interpreting qualification

Use `docs/TESTING.md` for the smallest relevant local checks. Run the release
reproducibility gate at a clean commit boundary, with locked dependencies. An
unrelated local attachment is not a release input: use a disposable clean checkout
of the candidate instead of deleting or hiding user files. ASSURED CI selects
all required families once, including the real disposable PostgreSQL suite.

The reproducibility report records `source_commit`, ZIP/tarball SHA-256 and
`workflow_qualification` with named checks, plus Node/zlib/platform provenance.
The gzip header uses neutral OS metadata: an injected Windows/Unix header test
checks identical archive bytes and preserved payload. Compare actual Windows
and CI archive hashes on the same commit; compression across arbitrary future
zlib implementations is not assumed identical. Retain that report and the exact-head
CI results with the PR. A new commit invalidates previous exact-commit provenance;
rerun affected gates and let required CI qualify the new head. Do not copy a prior
lot's native approval, CI result or release archive to the new candidate.

Report PASS, FAIL and SKIP separately. The package scenario reports native Codex,
external-client and PostgreSQL checks as SKIP; the independent required PostgreSQL
gate must pass for source delivery. Native qualification and an external-client
upgrade remain unexecuted in this lot. ADR-0015 through ADR-0020 retain their
experimental status; this qualification introduces no new runtime authority or
architecture decision. ADR-0009 still governs publication.

## Publication handoff

`VERSION` is the authority for candidate 0.12.0; package/lock metadata, workflow
and pack manifests and README tag examples must agree. The changelog is marked
prepared until publication. The default execution path and workflow schema
version 7 are unchanged. No database schema migration is introduced by these lots.

After this preparation is merged and publication is authorized, create the matching
`release/v0.12.0` branch from current `dev`, finalize the release notes and open its
PR to `main`. Validate that exact head under release obligations. The existing
publication workflow proves merged-PR provenance, refuses an existing tag/release,
builds the exact merged commit and publishes its verified artifacts. Synchronize
`main` back to `dev` afterwards. Publishing, installing/updating a client and
candidate-bound native qualification require their own evidence.
