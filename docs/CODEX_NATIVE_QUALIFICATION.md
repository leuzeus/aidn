# Codex native qualification for AIDN 0.8.0

This is an executable-test protocol and an unfilled qualification record. It is
not a native acceptance report. The package version, commit and final artifact
hashes must be recorded from the candidate actually tested; a version label or
successful repository gate does not fill these fields automatically.

The 0.8.0 publication gate uses a shorter, human-approved temporary-client
smoke: startup, admitted edit, covered refusal and inactivity in a separate
unauthorized project. Record its result independently with commit, package and
backend hashes. It does not turn unexecuted N01-N14 cases into PASS. After the
published package is used for a controlled pilot migration, run N01-N14 on a
new temporary client, using Windows app UI control where available. If the
published package content differs from the smoked candidate, repeat the smoke
before migrating the pilot. Neither the pilot nor the source checkout is a
fault-injection fixture.

## Current evidence boundary

Historical publication verified on 2026-09-24: PR #62 merged into dev, #63 into
main at `7030f05`, and v0.8.0 was published at 00:48:23 UTC. Publication is not a
native acceptance trace. The new specific-write candidate starts from dev
`d074b52`; its exact final package and backend must be qualified independently.
The original failure and non-execution records below remain unchanged.

The activation and namespaced-skills candidate is qualified Windows-first.
Unix fixture/native execution is UNAVAILABLE for this change and does not block
Windows fixture qualification. A future Unix claim requires its own candidate
run. Earlier Ubuntu results for the base commit do not qualify this delta.

The available machine is a Windows VM. WSL is not available for this work, and
no host configuration change is part of this protocol. Windows fixture wrappers,
package installation and bounded app-server discovery have been exercised in the
[existing evidence](rfc/codex-integration-2026-09-23/CAPABILITIES.md). Those results
are distinct from a native app or IDE session with human-approved project hooks.

| Qualification | Current record | Required next evidence |
| --- | --- | --- |
| Windows fixture/core and distributed wrapper behavior | Existing fixture evidence; rerun against the final candidate | Exact candidate commit/artifact hash and gate output |
| Windows CLI native hooks | OPEN / SKIP | Human trust, real lifecycle/tool trace, refusal and failure behavior |
| Windows app native hooks | OPEN / SKIP | App/backend identity and native UI trust/lifecycle/tool trace |
| Windows IDE native hooks | OPEN / SKIP | Active extension/backend identity and native trust/lifecycle/tool trace |
| Unix native client | OPEN / UNAVAILABLE on this VM | Execution on a separate available Unix host |
| WSL | UNAVAILABLE / not tested | A separately authorized, available WSL environment; Windows results do not transfer |
| Cloud/web environment | OPEN / SKIP | Independent package deployment, trust and native-tool qualification |

A successful generated schema, `skills/list` or `hooks/list` response is discovery
or parsing evidence. It is not a native hook execution, human approval, effective
prevention or live-project result. Keep every unexecuted check below as SKIP;
when a platform is absent, record UNAVAILABLE without converting it into a Windows failure. Do not mark it PASS based
on equivalent-looking fixture behavior.

A pre-release Windows CLI probe against the earlier `b9be1fa` candidate found
that backend 0.155 rejected the complete project hooks file: its root
`version: 1` was unknown. The installer now emits the accepted root shape and
migrates recognized old files. This source correction requires a rebuilt package,
renewed human review of the changed hook definition, and a fresh native trace;
the earlier probe is FAIL for that candidate, not proof of the correction.

## Candidate and environment record

Create one record per native surface, with no private project paths, credentials,
trust-store contents or unrelated user data. Keep raw evidence local and publish
only the bounded, redacted record.

| Field | Value to record |
| --- | --- |
| Record ID / UTC start and end | OPEN |
| AIDN package version | OPEN; expected release line 0.8.0 |
| Package-source Git commit and dirty state | OPEN; record actual commit and any uncommitted candidate delta |
| Tested npm tarball filename and SHA256 | OPEN; hash the exact tarball installed |
| Installed runtime binding | OPEN; package version, entrypoint/VERSION hashes and stable local-path availability |
| Fixture identity | OPEN; synthetic fixture tree hash, branch/HEAD and worktree identity |
| Host | Windows VM for local work; record OS/build and architecture |
| Native surface | CLI, app, IDE, Unix, WSL or cloud; one per record |
| Codex backend version and executable SHA256 | OPEN; verify the executable used by this surface |
| App package or active IDE extension version | OPEN if applicable; distinguish GUI/extension version from backend version |
| Hooks config and handler-script SHA256 | OPEN; exact reviewed definitions and scripts |
| Native sandbox and approval mode | OPEN; record what was actually selected |
| Project trust / individual hook approval | OPEN; human approval origin and time, without exported trust secrets |
| Evidence location | OPEN; local-only raw traces and redacted attachment identifiers |

For source candidates, `git rev-parse HEAD` identifies the commit and
`git status --porcelain` identifies a dirty checkout. Run `--version` on the
explicit backend path and hash that file, rather than substituting whichever
`codex` happens to be on PATH. On Windows, `Get-FileHash -Algorithm SHA256` can
record tarball, config, script and executable hashes. These are read-only checks.
A source tag matching the version is a comparison anchor, not proof that the
installed binary was built byte-for-byte from that tag.

## Preparation and trust boundary

1. Prepare a new disposable Git project from neutral fixtures. Install the
   candidate from its local tarball and retain the package at a stable path.
   Use a separate native profile or temporary home where the client supports it.
   Never use a live external project or copy its private content for this test.
2. Capture the candidate/environment record. Run the documented bootstrap
   diagnostic and record local installed/detected states and native unknowns.
   Native trust is not inferred from these states.
3. Capture discovery before trust. Confirm expected skill names, YAML errors,
   and which hook source/scope is listed or excluded. A parsed but unapproved
   handler is not operational. Project-scope and temporary user-scope results
   must remain distinguishable.
4. The human reviews the disposable project and exact executable hook definition
   through the native client's supported controls. Record that approval. Do not
   seed trusted-project entries, inject approved hashes, bypass the sandbox or
   treat this document as approval. Stop dependent native execution if that step
   is unavailable. Repeat review after any changed hook definition.
5. Use one bounded session and a new harmless marker path per case. Preserve the
   native event/tool trace and before/after marker evidence. A scripted adapter
   invocation or homemade event simulator remains fixture evidence.

### Bounded Windows preparation commands

These commands prepare a disposable local client and a local-only review sheet;
**they do not execute N01-N14 or approve a native project**. Run them from the
candidate package-source checkout in PowerShell. They reuse the same local
`npm pack`/tarball installation path as
`tools/verify/verify-codex-client-install.mjs`, without its fixture prerequisite
stubs. A real missing prerequisite or failed install is a failed preparation,
not permission to replace it with a stub. The package manager can obtain package
dependencies; no Codex model invocation is part of this preparation.

```powershell
$ErrorActionPreference = 'Stop'
$sourceRoot = (Get-Location).Path
$nodePath = (Get-Command node -CommandType Application | Select-Object -First 1).Source
$npmCliPath = Join-Path (Split-Path $nodePath) 'node_modules/npm/bin/npm-cli.js'
if (-not (Test-Path -LiteralPath $npmCliPath)) { throw 'Resolve the real npm CLI before continuing' }
$sourceCommit = (& git rev-parse HEAD).Trim()
if ($LASTEXITCODE -ne 0) { throw 'Candidate source must be a Git checkout' }
$sourceDirty = @(& git status --porcelain)
if ($LASTEXITCODE -ne 0) { throw 'Cannot capture candidate status' }
if ($sourceDirty.Count -ne 0) { throw 'Commit the candidate before native qualification preparation' }
$candidateVersion = (Get-Content -LiteralPath (Join-Path $sourceRoot 'VERSION') -Raw).Trim()
$proofRoot = Join-Path ([IO.Path]::GetTempPath()) ('aidn-native-review-' + [guid]::NewGuid().ToString('N'))
$clientRoot = Join-Path $proofRoot 'client espace accent-Ã©'
$null = New-Item -ItemType Directory -Path $clientRoot
$packedText = & $nodePath $npmCliPath pack --json --pack-destination $proofRoot
if ($LASTEXITCODE -ne 0) { throw 'npm pack failed' }
$packed = ($packedText -join "`n") | ConvertFrom-Json
$tarball = Join-Path $proofRoot $packed[0].filename
$utf8 = [Text.UTF8Encoding]::new($false)
$null = [IO.File]::WriteAllText((Join-Path $clientRoot 'package.json'), '{"name":"aidn-native-review","private":true}', $utf8)
& git -C $clientRoot init --quiet
if ($LASTEXITCODE -ne 0) { throw 'Fixture Git initialization failed' }
Push-Location $clientRoot
try {
  & $nodePath $npmCliPath install --ignore-scripts --no-audit --no-fund $tarball
  if ($LASTEXITCODE -ne 0) { throw 'Candidate tarball installation failed' }
  $installedRoot = Join-Path $clientRoot 'node_modules/aidn-workflow'
  $installedBin = Join-Path $installedRoot 'bin/aidn.mjs'
  $previewText = & $nodePath $installedBin bootstrap --target $clientRoot --profile default --dry-run --json
  if ($LASTEXITCODE -ne 0) { throw 'Bootstrap preview failed' }
  $preview = ($previewText -join "`n") | ConvertFrom-Json
  if (-not $preview.installation_plan.plan_id) { throw 'Bootstrap preview did not identify its plan' }
  # Explicitly install only into this newly created disposable fixture.
  & $nodePath $installedBin bootstrap --target $clientRoot --profile default --expect-plan $preview.installation_plan.plan_id --no-codex-migrate-custom
  if ($LASTEXITCODE -ne 0) { throw 'Bootstrap installation failed' }
  $diagnostic = & $nodePath $installedBin bootstrap --target $clientRoot --diagnose --json
  if ($LASTEXITCODE -ne 0) { throw 'Bootstrap diagnostic failed' }
  $null = [IO.File]::WriteAllText((Join-Path $proofRoot 'diagnostic.local.json'), ($diagnostic -join "`n"), $utf8)
} finally { Pop-Location }
$hookHashes = @('.codex/hooks.json', '.codex/hooks/aidn-hook-runtime.mjs',
  '.codex/hooks/aidn-session-start.mjs', '.codex/hooks/aidn-pre-tool-use.mjs') | ForEach-Object {
  @{ relative_path = $_; sha256 = (Get-FileHash -LiteralPath (Join-Path $clientRoot $_) -Algorithm SHA256).Hash }
}
$review = [ordered]@{
  status = 'OPEN'; proof_class = 'preparation-only'; utc = [DateTime]::UtcNow.ToString('o')
  source_commit = $sourceCommit; source_dirty = $sourceDirty; version = $candidateVersion
  installed_version = (Get-Content -LiteralPath (Join-Path $installedRoot 'VERSION') -Raw).Trim()
  tarball_sha256 = (Get-FileHash -LiteralPath $tarball -Algorithm SHA256).Hash
  entry_sha256 = (Get-FileHash -LiteralPath $installedBin -Algorithm SHA256).Hash
  version_sha256 = (Get-FileHash -LiteralPath (Join-Path $installedRoot 'VERSION') -Algorithm SHA256).Hash
  hooks = $hookHashes; native_surface = 'OPEN'; native_backend = 'OPEN'
  human_trust = 'NOT_RECORDED'; native_cases = 'N01-N14 NOT_EXECUTED'; llm_calls = 0
}
$null = [IO.File]::WriteAllText((Join-Path $proofRoot 'review.local.json'), ($review | ConvertTo-Json -Depth 8), $utf8)
Write-Output $proofRoot
```

Check the hook filenames against the installed candidate before running the
hash step; a missing or newly renamed handler is a preparation discrepancy to
resolve explicitly. Retain the tarball, installed package and fixture for the
human review so their receipt binding stays valid. Do not copy `.aidn/install/`
or raw diagnostics to a tracked/shared evidence folder; they contain local paths
and can contain recovery pre-images. This snippet neither initializes a Codex
home nor reads or modifies native trust stores.

For each intended client surface, resolve its actual executable through targeted
installation metadata, then run the following separately. Replace the explicit
path after inspection; do not infer that CLI-on-PATH is the app or IDE backend.

```powershell
$backendPath = 'C:\REPLACE-WITH-VERIFIED-SURFACE-BACKEND\codex.exe'
$backendVersion = & $backendPath --version
if ($LASTEXITCODE -ne 0) { throw 'Backend version query failed' }
@{ version = ($backendVersion -join "`n"); sha256 = (Get-FileHash -LiteralPath $backendPath -Algorithm SHA256).Hash }
```

Copy that version/hash and the observed app or active extension version into the
record. Native approval and N01-N14 remain open. After human qualification and
preserving the required redacted evidence, remove only this exclusively created
`aidn-native-review-<id>` directory, checking its resolved absolute path is a
child of the system temporary directory before any recursive removal. Never
use a derived project path or generic temporary-directory wildcard for cleanup.

## Native acceptance cases

| ID | Case | Required observation |
| --- | --- | --- |
| N01 | Start the approved disposable session | Native SessionStart event and bounded canonical summary; no implicit session creation, hydration or checkout write |
| N02 | Resume the session, then exercise supported clear/compaction paths | Actual source/event recorded; current state is re-anchored rather than granted authority by an earlier summary |
| N03 | Native `apply_patch` with admissible canonical state | Covered PreToolUse runs once for its multi-alias definition; intended harmless marker appears exactly once |
| N04 | Native `apply_patch` after canonical admission becomes blocked | Explicit deny reaches the native client; target marker remains absent; trace identifies the refusal |
| N05 | Change branch, worktree or relevant canonical content after admission | Fresh evaluation for the next covered edit; earlier PASS/context is not reused as authorization |
| N06 | Missing/moved/changed bound package and child failure/timeout | Distinguish a running adapter's explicit deny from a handler that never ran or was terminated by the native client |
| N07 | Disable/unapprove the hook in the native client | Record non-execution and actual resulting behavior; metadata-only AIDN diagnosis must not claim it observed approval or operation |
| N08 | Malformed hook output, ordinary exit 1, timeout, exit 2 with/without stderr, valid deny | Capture actual native behavior for each separately; source predicts fail-open for ordinary handler errors and blocking for valid deny |
| N09 | Initial shell, subsequent `write_stdin`, and MCP calls | Demonstrate the shipped edit-only matcher has no blanket prevention claim; classify out-of-coverage paths explicitly |
| N10 | Two matching native hooks and repeated delivery | Observe concurrency/deny behavior; do not depend on handler ordering or duplicate an effect |
| N11 | Same candidate from directories with spaces/accents and a subdirectory, including linked worktree | Native event resolves the correct project; no cross-worktree admission or path corruption |
| N12 | App present with CLI absent from PATH; IDE with a different backend version | Inventory remains per surface; file/schema availability is distinct from native success |
| N13 | Discover the thirteen namespaced skills beside a neutral unprefixed homonym | Public `aidn-*` identities remain distinct; each starts with activation/admission and inactive targets load no AIDN workflow context |
| N14 | Revoke the disposable Git authority while a linked worktree session exists | Next AIDN admission is inactive in both worktrees; stale context or repair does not reauthorize; unrelated native tools are not claimed to be universally blocked |
| N15 | Generic admission succeeds in THINKING; attempt product patch, then allowed planning note | Native product deny with absent marker; native note admission with exactly one marker |
| N16 | Canonical IMPLEMENTING task, DoR and exact path/operation scope | Native admission and exactly one product marker; changing task/scope forces a fresh refusal |
| N17 | Mixed admitted/forbidden files, including move source and destination | Native deny of the entire patch; independent oracle shows neither path changed |

Use the AIDN core's documented workflow transitions to prepare canonical state.
Do not make a model's declaration of PASS the acceptance oracle. For N06-N08,
changed disposable hook definitions require renewed human review. A model call
may be necessary for an authentic agentic tool/compaction case; obtain explicit
scope for that session and record any calls. No synthetic local substitute can
close the native evidence obligation.

The shipped matcher covers canonical `apply_patch` with the native aliases
`Edit` and `Write`; the audited client emits canonical stdin. Explicit-deny
translation by a running wrapper does not make the native client fail-closed.
The source-level failure matrix and its version anchors remain in the
[capability report](rfc/codex-integration-2026-09-23/CAPABILITIES.md#control-failure-and-bypass-matrix).
An MCP adapter or plugin is outside this candidate's required local command-hook
path; test it separately if it becomes part of the delivered implementation.

## Host migration and pilot boundary

Global skill migration is separately qualified with a temporary Codex home using
`bootstrap --migrate-global-skills --codex-home <absolute-path>` and its reviewed
`--write --expect-plan` application. Preserve third-party TOML and skill bytes,
record exact before/after hashes, then exercise explicit restore and stale-config
refusal. A restart and actual native discovery are required to qualify Codex's
interpretation of the disable entries. Deterministic transaction fixtures alone
do not prove that native behavior. No real user Codex home or external pilot has
been modified during the implementation qualification. A live pilot and any host
change require their explicit selected target and reviewed plan.

## Qualification record and decision

For each N01-N17 case, record:

- status: PASS, FAIL, SKIP, UNAVAILABLE or OUTSIDE_COVERAGE;
- exact native surface, candidate identity and fixture/context identity;
- expected behavior, observed behavior and bounded evidence reference;
- whether a hook ran, returned a valid deny, failed, or was not invoked;
- marker before/after hashes and whether any unintended effect occurred;
- remaining limitation and the person who reviewed the result.

Current decision: **OPEN**. Native Windows app/IDE trust and execution remain
unproven; Unix is unavailable on this VM. Repository gates, tarball tests and
source inspection remain valid within their scopes without closing those items.
To close one surface, require its complete candidate identity, human trust
record, native traces for covered lifecycle/refusal/failure cases and explicit
out-of-coverage findings. A discovered fail-open behavior must be documented as
such, not relabeled as prevention. Each other surface remains open independently.
