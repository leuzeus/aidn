# Global Windows evidence boundaries

Record reviewed on 2026-09-25. Global installation was published in 0.10.0;
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
