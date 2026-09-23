# Codex integration

AIDN distributes local skills, agent roles and command hooks through its existing
installer. The integration calls the same AIDN CLI and core admission use case as
other adapters. It adds no second workflow engine, persistent server, mandatory
API key or model call to the nominal installation and admission paths.

This page describes unreleased integration changes based on package version
0.7.2; it does not claim those changes have been published. Scaffold assets and
test corpora are not an installed client project. Installation,
discovery, native approval and operational qualification are separate claims.
See [ADR-0011](ADR/ADR-0011-codex-installation-ownership-and-native-boundary.md)
and the dated [capability evidence](rfc/codex-integration-2026-09-23/CAPABILITIES.md).

## Install and inspect

Use the AIDN package version selected for the project. From its package source,
`node bin/aidn.mjs` is equivalent to the installed `aidn` command below.

```sh
aidn bootstrap --target . --profile default --dry-run --json
aidn bootstrap --target . --profile default
aidn bootstrap --target . --diagnose --json
```

The ordinary bootstrap retains its explicit install/upgrade behavior; use
`--dry-run` to preview it. The lifecycle actions below are preview-only by
default. `--json` selects output format and grants no additional write intent.

Nominal installation does not require a Codex CLI on PATH or a Codex login. The
optional `--codex-migrate-custom` path explicitly requests the existing assisted
customization migration and may require Codex authentication and model use. It is
disabled by default. Conflicting managed content is surfaced for resolution.

Open the installed project in the intended native client and review its project
trust and the exact installed hook definitions. AIDN does not modify global Codex
configuration, approve a project, record approved hook hashes or complete that
native review on the user's behalf. Changed definitions can need renewed native
approval. Local installation alone cannot establish that a hook will run.

`--diagnose` combines the read-only ownership plan with a targeted local client
inventory. It reads local metadata and, when available, runs only `--version` on
candidate Codex executables. It does not launch app-server, authenticate, create
a client session or inspect native trust stores. Its output can contain local
package and executable paths; redact those before sharing an external report.

| State | Meaning in this diagnostic |
| --- | --- |
| `installed` | Expected local assets are present, absent or incomplete; the ownership diagnostic additionally checks managed content |
| `detected` | A CLI, desktop/backend or IDE inventory entry was found; absence from PATH alone does not rule out the desktop app |
| `approved` | `unknown`; human native project and hook approval was not inspected |
| `connected` | `not_applicable` for this local command-hook implementation |
| `operational` | `unverified`; version and file presence do not prove native execution |
| `degraded` | A detected local deficiency such as missing assets or no detected client; false is not operational qualification |

Versions other than the two audited versions are reported as unqualified with
unknown hook capabilities. The inventory reports installed IDE extensions and
candidate desktop backends independently; it does not infer which one a running
client uses. Desktop detection is best-effort on Windows and macOS, and an
inaccessible or unsupported inventory remains unknown.

## Ownership and recovery

The managed Codex scope is:

- `.agents/skills/` entries shipped by AIDN;
- AIDN role files in `.codex/agents/`;
- AIDN scripts in `.codex/hooks/` and owned entries in `.codex/hooks.json`;
- the AIDN block in `AGENTS.md`, appended alongside existing client instructions;
- AIDN's `.aidn/codex/skills.yaml` inventory.

The installer records ownership per file, AGENTS block and hook entry under
`.aidn/install/`. Hooks are merged by entry rather than replacing the entire
JSON document; third-party entries and group attributes retain their ownership.
An existing AGENTS file keeps its client text and receives the managed AIDN
block; an unknown or modified marked block remains a conflict. Exact known
legacy fingerprints or identical package assets may be adopted.
Unknown or changed managed content produces a conflict. Repair is not permission
to overwrite such content, and broad force/adopt behavior is not implied.

The local receipt, pending record and transaction pre-images belong to the
`install_assets` concept. They are installation recovery evidence, never
canonical workflow state, shared runtime evidence or native trust. Recovery
history remains local after rollback and uninstall. `.aidn/install/` is ignored
by the installed Git rules and an in-store ignore file created before transaction
pre-images, including an interrupted first install. Pre-images may contain private local content and the
receipt includes a local package path. Do not commit or synchronize this store.
POSIX writes request mode 0600; Windows uses inherited ACLs. Record checksums
catch accidental corruption; they do not authenticate an editor with access to
the same files.

```sh
aidn bootstrap --target . --repair --json
aidn bootstrap --target . --repair --write --expect-plan PLAN_ID --json
```

Replace `PLAN_ID` with the `plan_id` returned by that action's preview. Apply
recomputes the plan and rejects a changed target or source. A lock serializes the
owned transaction, and each write checks its current pre-image. Individual file
writes are atomic; a multi-file installation is recoverable through its journal,
not one filesystem-wide atomic operation.

| Action | Preview and application behavior |
| --- | --- |
| `--repair` | Requires an existing managed installation; restores missing owned assets or plans a compatible package update; divergent owned content remains a conflict |
| `--resume` | Continues the interrupted Codex transaction when its package binding and target pre/post-images still match |
| `--rollback` | Restores the last or interrupted Codex transaction's pre-images; later conflicting user changes stop restoration |
| `--uninstall` | Removes only recorded AIDN Codex assets and managed blocks/entries; retains unrelated hooks, user content, workflow runtime and audit history |

Every lifecycle action follows the same two calls: preview the selected action,
then repeat it with `--write --expect-plan PLAN_ID`. A pending transaction requires
resume or rollback before another managed change. A stale primary lock left
before journal creation can be recovered explicitly through resume/rollback. An
interrupted recovery lock returns `INTERRUPTED_LOCK_RECOVERY_REQUIRES_INSPECTION`
and keeps the store intact; inspect ownership and recovery evidence before any
manual repair. No pending transaction or
nothing to uninstall is reported explicitly. Uninstall is not removal of the
whole AIDN workflow, database, project configuration, `.aidn/` directory or Git
checkout. It also retains recovery records and can leave empty directories.

The public JSON surfaces are `bootstrap-diagnostics.v1` and
`bootstrap-lifecycle.v1`; see [CLI inventory](CLI_SURFACE_INVENTORY.md) and the
[effect policy](agents/02-cli-effect-policy.md).

## Native hooks and core authority

The distributed hook file uses only command handlers for `SessionStart` and
`PreToolUse`. It is compatible at the schema level with the two inspected Codex
versions. It does not emit the newer `mcp_tool` handler, which the inspected
0.146 client rejects for the whole mixed hooks file.

The launcher resolves the nearest Git root from the invocation directory using
Node filesystem paths, including worktree `.git` files. It does not parse Git's
stdout or interpolate project paths into a shell command. The installed script
resolves its own project root and rejects an invocation outside that root or
inside a nested Git repository. The receipt selects a local AIDN package path;
wrappers check its `VERSION`, entrypoint hash and VERSION-file hash, then execute
that entrypoint with an argument array and explicit `--target`.

The runtime binding is local and versioned. It is not a cryptographic attestation
of every imported source module: the recorded hashes cover the entrypoint and
VERSION file. Keep a source-bound checkout available and stable, or use a stable
installed npm package path. Moving it, removing it or changing either checked
file degrades resume and denies a covered edit while the wrapper can run. No
hook downloads or resolves `npx ...@latest` at execution time.

| Event / path | Implemented behavior | Boundary |
| --- | --- | --- |
| `SessionStart`, sources startup/resume/clear/compact | Calls `runtime pre-write-admit --skill start-session --json` and adds a compact canonical summary | Read-only orientation, not session creation or a write authorization; runtime failure becomes degraded context |
| `PreToolUse` matcher `^(apply_patch|Edit|Write)$` | Uses the canonical `apply_patch` payload's `tool_input.command`, rechecks generic core admission, emits supported explicit deny JSON when blocked | `Edit` and `Write` are native matcher aliases; canonical stdin uses `apply_patch` on the audited client |
| Admitted patch | Adds compact context for this invocation without rewriting the patch or emitting an unconditional allow | A generic admission is not a validated close-cycle, publication or other governed transition |
| AIDN transition invoked through its CLI | Existing core prerequisites remain authoritative | Model text, cached PASS claims and hook presence cannot authorize a transition |
| Shell, `write_stdin`, MCP and other tools | No classification or interception by the shipped matcher | Arbitrary shell writes and alternate adapters are outside this native prevention coverage |

When the running wrapper encounters an AIDN child-process exception, timeout,
missing runtime binding or invalid admission output, it translates that condition
into valid explicit-deny JSON for the covered edit. This is adapter behavior.
Codex itself fails open for a command handler that cannot start, times out before
returning, returns malformed output or is disabled/unapproved. A wrapper cannot
guarantee refusal when it never runs. The audited upstream implementation's
explicit deny blocks; ordinary failure does not. See the pinned
[source analysis](rfc/codex-integration-2026-09-23/CAPABILITIES.md#control-failure-and-bypass-matrix).

Multiple matching native handlers may execute concurrently. AIDN uses one
multi-alias entry and installation ownership avoids duplicating it. It does not
depend on ordering against unrelated hooks, rewrite tool input or claim to undo
already completed effects. An MCP adapter, plugin and separate app-server runner
remain optional future integration choices; none is needed by this implementation.

## Context after resume and compaction

Canonical workflow state stays in its configured files/database backend. A
hydrated context is a derived, regenerable cache. SessionStart reads canonical
admission and does not run hydrate, project state, create a session or update a
snapshot. Compact context contains selected branch/session/cycle/runtime signals,
blockers and a bounded next action, then directs the agent back to `AGENTS.md`.

Admission is rechecked for every covered patch. A context snapshot or successful
prior invocation is not reusable transition authority. Branch, worktree, content
or runtime changes require fresh canonical evaluation. The context-store adapter
tracks invalidation evidence separately; uncertain database revision/freshness
cannot be promoted to proof of current state. See the
[context-store fixtures](../tools/perf/verify-codex-context-store-fixtures.mjs).

## Qualification and evidence scope

Observed as of 2026-09-23 on the Windows VM:

| Surface | Available evidence | Native AIDN session qualification |
| --- | --- | --- |
| Windows local wrappers and distributed `commandWindows` | PASS on disposable fixtures, including spaces, accents, subdirectory launch, isolation, core refusal, read-only resume and adapter error/timeout deny | Does not exercise native Codex hook dispatch |
| Windows CLI/backend `0.155.0-alpha.9.2` | Binary/version inventory, generated schema, real app-server `skills/list` and unapproved `hooks/list` probes; tarball fixture discovery of 13 skills | SKIP: no human project/hook approval or native tool/session exercise |
| Windows desktop app | App and candidate backend inventory; backend schema/probes above | SKIP: GUI startup/resume/compaction/tool refusal not exercised |
| Windows IDE backend `0.146.0-alpha.9.2` | Bundled version inventory, generated schema and real discovery probes; MCP handler unsupported | SKIP: IDE session not exercised |
| Unix native clients | UNAVAILABLE in this Windows-host qualification run | No Unix support claim from Windows fixtures; launcher path remains to be exercised |
| WSL | Not available as an execution environment on this Windows VM | UNAVAILABLE / not tested; no WSL-native hooks/session trace |
| Cloud/web | Separate sandbox, package availability and trust context | Unqualified; local app installation does not deploy executable hooks into cloud sessions |

`schema_verified` means the exact version's generated schema/source was inspected;
it does not mean native approval or operational success. The earlier app-server
probe discovered skills in an untrusted disposable project; project hooks were
excluded until trust. Temporary user-scope definitions were parsed but remained
unapproved. No trusted-project entry or approved hook hash was injected.

Run `node tools/perf/verify-codex-native-integration-fixtures.mjs` for the bounded
adapter/discovery regression set. Its fake JSONL peer tests the discovery helper's
rejection of empty, incomplete, disabled or missing-cwd results; that peer is not
Codex proof. The installed-client verification also builds/installs the npm tarball in a
temporary project, checks four roles without model pins, runs SessionStart from
three directories against that package and discovers its 13 skills through real
app-server `skills/list`. It does not approve or execute a native agent tool.
The installer and bootstrap lifecycle fixtures cover ownership and
recovery. The package gate `perf:verify-codex-integration` composes these with the
context-store fixtures. This document does not assert final repository gates,
release readiness or a live external pilot result.

Native acceptance remains the human-reviewed disposable protocol in the
[capability report](rfc/codex-integration-2026-09-23/CAPABILITIES.md#remaining-native-e2e-protocol-skip-in-this-session).
In particular, disabled hooks and native runtime failure must remain visible as
SKIP until exercised. The nominal diagnostic cannot observe a UI disable or
approval change; it keeps approval unknown and operational status unverified.
