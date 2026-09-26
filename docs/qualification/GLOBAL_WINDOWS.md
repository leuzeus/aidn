# Global Windows evidence boundaries

Record reviewed on 2026-09-26. Global installation was published in 0.10.0;
publication does not complete an individual project's migration. The source
`VERSION`, a published release manifest, repository fixtures, live PostgreSQL
tests and native client traces answer different questions.

## Targeted native connector correction

The retained local report `qualification-corrected.local.json` records four
native checks completed at `2026-09-25T19:22:37.562Z` on candidate
`101fed5594e51a2020e3bdf41d8789e8241cb818` (package 0.10.2).

- Tarball SHA-256: `1a3f3b42caba668688498ecd5457346093a858e3b7fba2b6da0fe9231d6fc9a9`.
- Backend: Windows Codex CLI `0.155.0-alpha.16.3`, SHA-256
  `a19f8f6c3c9dd5b71b6b1e3eb1ec55d75aafb2fdfb686d9e1f7a5f47db07d0d2`.
- Windows elevated `workspace-write` sandbox; human-reviewed temporary hooks;
  scripted loopback provider without external model calls.

| Native case | Result | Observed effect | Trace SHA-256 |
| --- | --- | --- | --- |
| Missing global engine | PASS | Explicit PreToolUse denial; marker absent | `5f77a4b7316fe8460231b9303653d350026d5f0da6b9756a178c82d522bf4280` |
| Admissible note | PASS | Native apply_patch created the marker | `9743b1605d8ba56c1f4c70a2a60f3fe0ab6bd9391ba0048f0817ef792a422665` |
| Product edit in THINKING | PASS | Canonical refusal; marker absent | `261e5173ef0760915b23bbec16c5213cd85d8786a255b946b7fc645c9f72c238` |
| Revoked project after sandbox repair | PASS | Ordinary native edit completed; no new AIDN admission context | `c5457c9d2f7809e98b9cc818ecc6c68a25ce141ce55fbf377be38f154e2bdfe9` |

Earlier revoked-project attempts timed out and remain INTERRUPTED/UNAVAILABLE.
Official sandbox setup changed readiness from `updateRequired` to `ready` before
the final distinct attempt. This does not rewrite those failures as successes.
The original unavailable-engine N06 failure is also retained as historical
evidence for the earlier connector, not erased by the targeted correction.

Raw traces remain private because they contain local paths and client state.
The hashes above identify the observations without publishing that content.
This is an attested bounded record, not a claim that CI replayed native trust.
It does not automatically qualify changed assets in a later package.

## Full matrix and other evidence

The extended [N01–N17 protocol](../CODEX_NATIVE_QUALIFICATION.md) is not fully
closed. Its local matrix contains successful targeted observations for startup,
covered admission/refusal, branch changes, human-disabled hooks, fault behavior,
multiple matching hooks, spaces/accents and linked worktrees, and atomic mixed
patch refusal. Composite cases remain open where subcases were not executed:
clear/compaction, other package-failure variants, task/scope changes,
repair-after-revocation and every skill on inactive targets.

- Windows app/IDE: UNAVAILABLE or SKIP for native execution; CLI evidence does
  not transfer to those clients.
- Unix/WSL and cloud: unqualified by these Windows runs.
- Shell/write_stdin: observed outside the edit-only matcher coverage. MCP was
  not exercised. No blanket prevention claim applies.
- Fault characterization: malformed output/ordinary errors/timeouts could allow
  tools in the tested native client. A PASS for observing this behavior is not
  fail-closed protection. Disabled or client-terminated hooks cannot emit denial.
- Global management fixtures inject npm, server/reboot conditions and failure
  points. They do not prove real server installation, native trust or data safety.
- [Real PostgreSQL smoke](../TESTING.md#targeted-canonical-artifact-writes) creates
  dedicated disposable scopes and proves source/CLI behavior plus cleanup. Its
  result is separate from server provisioning and each real client migration.

For any new release, retain its exact manifest/commit/checksums and relevant gate
outputs. For a real project, separately verify connection identity, unchanged
data, root-specific receipts, integration and native review. No source version,
installation success or documentation edit turns SKIP into PASS.

A later real-project review attempt identified an additional host boundary:
the app's AppData view contained the global installation while an ordinary
Windows PowerShell console could not resolve its launcher support module.
The review preflight stopped before the native client opened. This is a failed
visibility prerequisite, not native execution evidence, and does not invalidate
the four earlier disposable-client observations. A non-redirected home and a
fresh cross-context diagnosis are required before resuming that qualification.
After explicit consolidation, the ordinary console verified the same 0.10.8
package and exposed assets. The subsequent native client startup refused because
its background server lacked a complete local package. Its documented standalone
mode was selected for the next attempt. Cross-context visibility is established;
this startup failure still provides no native hook execution or trust evidence.
Standalone configuration inspection then found the project layer disabled by
an extended-path versus canonical-path trust-key mismatch. After explicit user
authorization of the canonical key for the same physical repository, the native
`hooks/list` API discovered both definitions as untrusted. Discovery and project
trust are therefore established for that client; human hook review and native
execution remain separate steps.

## Later real-client startup observation

After the human reviewed both unchanged definitions, the native API reported
`SessionStart` and `PreToolUse` as enabled and trusted. A subsequent bounded
diagnostic turn exercised `SessionStart` with package 0.10.8 on Windows Codex CLI
`0.158.0-alpha.2` in documented standalone mode. Client executable SHA-256:
`0122378c15dc0c3c0af0d6addf2dd278125c19676b41fadaa520f89d2c9e0079`.

The real client emitted `hook/started` and `hook/completed` for `sessionStart`;
the command completed in 5,856 ms and supplied an admitted read-only context.
The diagnostic turn completed without a tool call. This is a **PASS for that
SessionStart event only**. `PreToolUse` was **NOT_EXERCISED** by this turn; it
must not be inferred from the trust entry or startup success.

The retained private report has SHA-256
`7040bb900ff2352545aba6d4597ee7dc96553dcf28e3b1ef2923ea9149a89038`;
its retained notification record has SHA-256
`32286c3359be07ce90d7e916a512be2dee2dbcf860674c1b6a1d136b215cd4ba`.
Notifications were transcribed from the captured client stdout, not collected
in a later rerun. The probe compared three workflow files and normalized rows
from 21 PostgreSQL tables before and after, reporting no changes. Individual
before/after fingerprints were not retained; later current-state fingerprints
in the report are separate observations and are not substituted for preimages.

This attestation does not close the earlier full matrix, prove native write
admission, or transfer native qualification to 0.10.9/0.10.10. Their terminal
closure and drift-check regressions have separate source/CLI, SQLite and real
PostgreSQL evidence, described in [the testing guide](../TESTING.md).

## Later real-client note admission on 0.10.10

A separate bounded probe used the published 0.10.10 engine and the same Windows
Codex CLI `0.158.0-alpha.2` executable identified above, in standalone mode.
The previously human-reviewed hook definitions remained unchanged. A read-only
specific admission check preceded the native attempt; that preflight is not
the native execution evidence.

The real client then emitted `hook/started` and `hook/completed` for both
`sessionStart` (5,653 ms) and `preToolUse` (5,750 ms). PreToolUse rechecked scope
for the exact patch and returned `admitted_with_warnings`: a session branch
with no active cycle allowed this diagnostic note. One native `apply_patch`
created the expected marker, with one completed `fileChange` and no other tool
operation, retry or fallback. The result is **PASS for this note admission and
the observed startup event**, not a blanket native write qualification.

The private report contains notifications captured directly from this client's
stdout, the matching file-change result and the exact marker comparison. Its
SHA-256 is
`13b7757d29c0795b141812ff2fdf388e80a911b39a505276fb8feb7e86ab8a07`.
After verifying the marker's path and content, cleanup removed that file only;
the retained cleanup record has SHA-256
`8a24381e860832e3735e8bfa07d1e08d38e8a8f9a896eacba92c51f51ed11d8c`.
Saved before/after snapshots compare equal for 1,647 project file entries,
normalized rows from 21 PostgreSQL tables, global assets and the project
registry. The marker is absent after cleanup. These private records contain
project and connection context and are not published with the documentation.

No product edit, negative admission case, other tool, client or platform was
tested by this probe. It does not close the remaining full-matrix cases or
substitute for a principal checkout's own migration and final diagnosis.
