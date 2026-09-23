# Codex integration

AIDN distributes local skills, agent roles and command hooks through its existing
installer. The integration calls the same AIDN CLI and core admission use case as
other adapters. It adds no second workflow engine, persistent server, mandatory
API key or model call to the nominal installation and admission paths.

This page describes unreleased activation changes based on package version
0.8.0; it does not claim those changes have been published. Scaffold assets and
test corpora are not an installed client project. Installation,
discovery, native approval and operational qualification are separate claims.
See [ADR-0011](ADR/ADR-0011-codex-installation-ownership-and-native-boundary.md)
and the dated [capability evidence](rfc/codex-integration-2026-09-23/CAPABILITIES.md).

## Project activation and skill names

Before loading workflow context, run `aidn runtime pre-write-admit --target . --skill context-reload --json`. Continue only when `activation.active` is true and admission is admissible. The thirteen public skills now use `aidn-*` names, such as `aidn-context-reload` and `aidn-start-session`; their internal CLI `--skill context-reload` and `--skill start-session` identifiers stay compatible.

Git repositories keep their canonical authorization in `<git-common-dir>/aidn/authorization.json`. Linked worktrees share its revision and revocation, while their receipts and owned assets remain local to each worktree. Non-Git targets use a local authorization under `.aidn/install/`. A configured database, discovered skill, copied config or cached context does not prove activation. Validated legacy receipts are reported separately as `legacy-active`.

`bootstrap --diagnose --json` exposes compact activation fields: `state`, `active`, `scope`, `authority_id`, `revision` and `errors`. It remains read-only and does not contact a workflow backend to establish authorization. An inactive project stops AIDN workflow execution before loading that context.

```sh
aidn bootstrap --target . --authorize --json
aidn bootstrap --target . --authorize --write --expect-plan PLAN_ID --json
aidn bootstrap --target . --revoke --json
aidn bootstrap --target . --revoke --write --expect-plan PLAN_ID --json
```

These actions use `codex-integration` scope; combining them with `--scope installation` is rejected. Repair, resume and rollback cannot implicitly restore authorization after revocation. Project authorization is independent of native Codex project/hook approval. See [ADR-0012](ADR/ADR-0012-project-activation-and-namespaced-skills.md).

Global skill migration requires an explicit host target. The public action inventories only known AIDN directory names under `<codex-home>/skills`; it does not scan every possible native skill root. It identifies exact known global AIDN skills and prepares path-specific `[[skills.config]]` entries with `enabled = false`, preserving skill files and unrelated TOML. An unknown or customized homonym is not automatically adopted. These actions use the existing project installation journal, a host configuration lock, and checks of both the reviewed configuration and selected skill content. Restore requires the recorded configuration post-image to remain unchanged. Pre-images stay in private local recovery data and are omitted from public diagnostics.

```sh
aidn bootstrap --target . --migrate-global-skills --codex-home /absolute/codex-home --json
aidn bootstrap --target . --migrate-global-skills --codex-home /absolute/codex-home --write --expect-plan PLAN_ID --json
aidn bootstrap --target . --restore-global-skills --codex-home /absolute/codex-home --json
aidn bootstrap --target . --restore-global-skills --codex-home /absolute/codex-home --write --expect-plan PLAN_ID --json
```

On Windows, use an absolute Windows path for `--codex-home`. These two actions accept only `codex-integration` scope and are never part of nominal install, repair or authorization. Only temporary host fixtures have been used for their qualification; no live Codex home was changed. The [official Codex instructions](https://learn.chatgpt.com/docs/build-skills#enable-or-disable-local-codex-skills) describe these disable entries and require restarting Codex after a configuration change.

## Install and inspect

Use the AIDN package version selected for the project. From its package source,
`node bin/aidn.mjs` is equivalent to the installed `aidn` command below.

```sh
aidn bootstrap --target . --profile default --dry-run --json
aidn bootstrap --target . --profile default
aidn bootstrap --target . --diagnose --json
```

The ordinary bootstrap retains its explicit install/upgrade behavior; use
`--dry-run` to preview it and `--expect-plan PLAN_ID` to bind application to that reviewed plan. The lifecycle actions below are preview-only by
default. `--json` selects output format and grants no additional write intent.

Nominal installation does not require a Codex CLI on PATH or a Codex login. The
optional `--codex-migrate-custom` path explicitly requests the existing assisted
customization migration and may require Codex authentication and model use. It is
disabled by default. Conflicting managed content is surfaced for resolution.

Open the installed project in the intended native client and review its project
trust and the exact installed hook definitions. Nominal project installation does not modify global Codex
configuration. Explicit global skill migration changes only reviewed disable entries; it does not approve a project, record approved hook hashes or complete that
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

The default managed scope is `codex-integration`:

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
nothing to uninstall is reported explicitly. In the default scope, uninstall is not removal of the
whole AIDN workflow, database, project configuration, `.aidn/` directory or Git
checkout. It also retains recovery records and can leave empty directories.

The public JSON surfaces are `bootstrap-diagnostics.v1` and
`bootstrap-lifecycle.v1`; see [CLI inventory](CLI_SURFACE_INVENTORY.md) and the
[effect policy](agents/02-cli-effect-policy.md).

### Complete local installation scope

Use `--scope installation` on diagnostic, repair, resume, rollback or uninstall
to include the other locally owned installer assets in the same receipt and
transaction journal. Preview reports creation, change, preservation, no-op and
conflict decisions; it also declares import and persistence operations separately
without opening a database. A preview is not proof that a later database operation
will succeed.

```sh
aidn bootstrap --target . --profile default --dry-run --json
aidn bootstrap --target . --diagnose --scope installation --json
aidn bootstrap --target . --repair --scope installation --json
aidn bootstrap --target . --repair --scope installation --write --expect-plan PLAN_ID --json
```

Files, managed blocks and configuration fields can be restored only while their
recorded post-images still match. Changes to unrelated configuration fields are
preserved. Older receipts prove ownership only for the objects they actually
recorded; reading a receipt does not adopt neighboring files. Sessions, cycles,
project history, business data and databases remain outside asset removal and
rollback. Persistence migrations are separate effects and are never undone by
an asset rollback.

`VERSION` is the product version authority. Client configuration keeps its
schema `version: 1`; `install.aidnVersion` records the last complete successful
installation and is tied to the installation receipt. Preview, diagnostic,
failure and interruption leave that value unchanged. Successful resume finalizes
it; complete installation rollback restores its previous value. A legacy client
without the field has an unknown installed version until a successful install.

Finalization has an explicit commit point: required effects and verification
finish, the receipt and transaction are durably recorded, then the version marker
is written last. Failure before that marker leaves its previous value. If only
journal cleanup is interrupted after this commit point, the result reports
`complete-cleanup-pending`; resume finishes cleanup without repeating successful
effects. This is a completed installation with pending cleanup, not a claim that
an unfinished installation succeeded.

External import, SQLite schema and persistence-adoption effects keep individual
checkpoints in the same local installation transaction. Completed effects are
not replayed by resume. An uncertain PostgreSQL import returns
`ARTIFACT_IMPORT_REQUIRES_INSPECTION` before further writes; inspect the external
effect before choosing recovery. Asset rollback does not undo database changes.

Persistence policy `--persistence-policy verify-only` verifies an existing backend without requesting migration, adoption or artifact import. An incompatible or missing backend fails before installation writes. The `adopt` policy allows the planned installation effects; preview still does not contact the backend.

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

The [Windows client migration guide](CODEX_CLIENT_MIGRATION.md) separates the
package switch, managed-asset transaction and optional legacy global-skill migration.

The candidate record and native acceptance cases for release line 0.8.0 are in
[Codex native qualification](CODEX_NATIVE_QUALIFICATION.md). That record remains
OPEN; it is a protocol with unfilled evidence fields, not an execution result.
Publication requires a bounded human-approved temporary-client smoke showing
startup, an admitted edit, a covered denial and inactivity outside authorized
projects. N01-N14 remain separate cases and are scheduled on a fresh temporary
client after the pilot migration; the smoke does not close unexecuted cases.

For the current activation changes, qualification is limited to disposable Windows VM fixtures. Unix execution is UNAVAILABLE and is recorded separately rather than blocking those local fixtures. Native app/IDE qualification remains open. The following inventory and probes are retained from the 0.8.0 base; they do not qualify the new activation behavior:

Observed as of 2026-09-23 on the Windows VM:

| Surface | Available evidence | Native AIDN session qualification |
| --- | --- | --- |
| Windows local wrappers and distributed `commandWindows` | PASS on disposable fixtures, including spaces, accents, subdirectory launch, isolation, core refusal, read-only resume and adapter error/timeout deny | Does not exercise native Codex hook dispatch |
| Windows temporary-client pre-release smoke | OPEN / SKIP until human-approved native trace exists | Startup, admitted edit, covered denial, unauthorized-project inactivity; not full N01-N14 qualification |
| Windows CLI on PATH `0.125.0` | Local launcher/version inventory | SKIP: hook capabilities and native execution unverified for this version |
| Windows CLI/backend `0.155.0-alpha.9.2` | Binary/version inventory, generated schema, real app-server `skills/list` and unapproved `hooks/list` probes; tarball fixture discovery of 13 skills | SKIP: no human project/hook approval or native tool/session exercise |
| Windows desktop app | App and candidate backend inventory; backend schema/probes above | SKIP: GUI startup/resume/compaction/tool refusal not exercised |
| Other installed Windows IDE backend `0.146.0-alpha.3.1` | Local extension/backend inventory; active extension unknown | SKIP: hook capabilities and native execution unverified for this version |
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

Rollback cannot restore a nonempty legacy installation whose old hooks lack the
activation boundary. It refuses with
`ROLLBACK_TO_LEGACY_ACTIVATION_REQUIRES_UNINSTALL`; use an explicitly reviewed
uninstall and a compatible installation instead. Rolling back an initial install
to the absence of a prior receipt remains supported. The host migration recovery
binding survives project rollback, including older installation history; only
explicit `--restore-global-skills` releases that binding after restoring the
unchanged host configuration post-image.
