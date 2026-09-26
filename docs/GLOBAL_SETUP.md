# Global AIDN setup

The global installation shipped in 0.10.0. Subsequent patches correct PostgreSQL
artifact writes, admission, drift completion and canonical projections. Consult
the [changelog](../CHANGELOG.md) and [published releases](https://github.com/leuzeus/aidn/releases)
for a verified package; the source `VERSION` alone does not establish publication.
ADR-0013 supersedes independent project engine versions; existing 0.9.x receipts
remain migration inputs. [Installation](INSTALL.md) is the practical entry point;
[upgrade](UPGRADE.md) covers migration ownership and delivery order.

An established session may explicitly have no active cycle. For `cycle-create`,
the read-only admission verifies that initial state in the canonical database,
including session, physical branch and parseable state timestamp. It reports
`cycle_create_initial_state_verified` without changing `current_state_freshness`
from `unknown` to `ok`. It does not bypass stale state, repair findings, Git
hygiene, continuity, activation or native write authorization. Once a cycle is
declared, its ordinary freshness requirements apply. Runtime projection reads
canonical db-only/PostgreSQL artifacts rather than local Markdown copies; writing
a projection still requires explicit intent and does not import it into the DB.

## Entry points

From the source checkout or extracted package on Windows, preview installation:

```powershell
.\scripts\setup-global.ps1 -ReleaseVersion latest
```

Apply the displayed plan by repeating those arguments with `-Write -ExpectPlan
PLAN_ID`. Only that explicit installation registers `AIDN_HOME` and `bin` in the
user PATH. Open a new terminal. No administrator rights are used for AIDN.
Node.js and bundled npm are required. `-ReleaseVersion latest` resolves GitHub's
stable release and validates its assets; it does not guess a release on failure.
For offline input, add `-PackagePath FILE -PackageSha256 HASH` and use its exact
`-ReleaseVersion VERSION`. Apply identical arguments with the displayed plan ID;
a changed latest target invalidates the plan instead of silently selecting it.

### Windows path visibility

The default home is `%LOCALAPPDATA%\AIDN`. Some packaged Windows applications
redirect that logical path into an application-private location: a successful
installation inside the app can then be absent in an ordinary PowerShell console.
`GLOBAL_HOME_REDIRECTED` refuses such a home before creating a runtime or lock;
registration also refuses it. No automatic move, alternate engine or receipt
rewrite is performed.

Choose an absolute, non-redirected `AIDN_HOME` before the first preview, for
example `$env:AIDN_HOME = Join-Path $env:USERPROFILE 'AIDN'`, then use the normal
exact-plan installation. Verify from both the app and an ordinary console that
the launcher resolves the same installation ID, generation and managed assets.
Merely finding `aidn` on both PATHs is insufficient.

An existing redirected installation needs a reviewed transfer with a private
backup, a same-version verified package, preserved project registry and explicit
project rebinding. Do not copy or edit machine receipts by hand. There is no
public registry-import or home-relocation command; a registry transfer remains
an explicit maintenance operation with validation and atomic replacement. Keep
the old home resolvable until all dependent bindings have migrated, then retain
its restorable archive and remove its obsolete PATH entry. Neither this transfer
nor a native hook review migrates a PostgreSQL database.

`aidn setup` and `aidn-setup` open the common wizard. Source launch remains
`node tools/setup/global-cli.mjs setup`. The wizard is an interactive executor:
confirmation may apply changes. It is not a read-only consultation;
`aidn setup --json` instead produces a noninteractive setup preview. After a confirmed first common
installation, the wizard also registers the user environment. Its project menu
offers files, provisioned PostgreSQL resources, or an explicitly pinned local
PostgreSQL 17 installer. Missing secrets are requested after confirmation;
plaintext user-environment persistence is optional and disclosed. The
administrator connection is never persisted or passed to WinGet or bootstrap.
Masked input has a Windows terminal probe with a synthetic value and an injected
installer; the value was received without terminal echo. This does not qualify
actual server installation or credential persistence.
The 0.9.x per-project PowerShell setup
is retained for legacy operation and is not a global migration path.

```powershell
aidn project add --target ..\example --json
aidn project migrate --target ..\example --json
aidn doctor --target ..\example --json
aidn project list --json
aidn project remove --id PROJECT_ID --json
aidn update --check --json
aidn update --release latest --json
aidn rollback --json
```

For a new project and local server, add `--postgres-mode install
--postgres-version 17.MINOR-REVISION --connection-ref env:AIDN_PG_PROJECT
--admin-connection-ref env:AIDN_PG_ADMIN` to `project add`. Replace the version
placeholder with an exact published WinGet version. The plan explicitly includes
the official interactive server installer, dedicated role/database preparation,
and initialization of an empty database. Windows may request elevation for the
server. This mode refuses an existing `.aidn` installation and a nonempty
database; it never upgrades or resets someone else's data. Existing-server mode
uses `--connection-ref` alone and only verifies already provisioned resources.

Interrupted local provisioning is journaled without passwords under
`AIDN_HOME/preparations`; it blocks global updates until resumed. Use `project add
--target PATH --resume --json`, then `--write --expect-plan ID`. The original
version and connection references remain frozen. A crash never implies server
or database rollback. The common engine executes bootstrap directly; no npm AIDN
dependency is installed in the new project.

Repeat a planned operation with `--write --expect-plan PLAN_ID` to apply it.
Omitting `--target` resolves the current Git repository, never a remembered
selection. Removing a registry entry does not uninstall or alter that project.
Updates inspect every registered project twice, including through the staged
candidate. An unavailable project, changed observation or required data migration
blocks the switch. Update and rollback do not rewrite project data or files.

## Migration and interrupted operations

### Repairing project hook connectors

The 0.10.2 connector validates the global hook response and emits a native JSON
denial when its child fails, returns invalid or oversized output, or exceeds the
8-second transport deadline. Session startup instead reports degraded read-only
context. Successful admission, canonical refusals and neutral inactive replies
remain unchanged. This does not protect an invocation that Codex never starts,
disables or terminates before the connector can reply; shell and MCP writes
remain outside the covered edit hooks.

A global update does not replace existing project connectors. After switching
to a validated release containing this correction, prepare their explicit repair:

```powershell
aidn bootstrap --target ..\example --repair --json
aidn bootstrap --target ..\example --repair --write --expect-plan PLAN_ID --json
```

Inspect the exact returned plan before applying it. Repair preserves revoked
activation and rejects modified managed files; resolve such conflicts explicitly.
Review the changed executable hooks again in Codex before native execution.
The wire contract remains integration revision 1. An interrupted child may leave
an operation lease: the connector never deletes it or assumes descendants ended.

Migration preserves the project configuration and adapter byte for byte. Receipt
ownership and hashes determine removal of standard skills and agents. Modified
standard assets conflict; unknown extensions stay. Hooks become small connectors
to the verified global package. npm removes `aidn-workflow`; unrelated manifest
dependencies are checked. The private ignored installation store retains backup
preimages and the migration journal. Never commit that store.

`aidn project migrate --target PATH --resume --json` diagnoses an interrupted
migration. Repeat with its plan ID and `--write` to resume. Workflow activation
refuses an unfinished migration. Global switch recovery uses `aidn update
--resume --json` and the same explicit application convention.

Operation leases prevent a switch while an admitted command is running. An
interrupted process may leave descendants, so a missing PID is insufficient proof
for deleting its lease. `aidn update --recover-locks --json` proposes recovery
only for owners from a provably earlier OS boot. A current boot owner requires a
restart. If OS boot identity is unavailable or an older lock has no identity,
recovery refuses and requires diagnosis; it does not silently discard the lock.
Add `--target PATH` to include a project's migration lock. This path has injected
fixture coverage; actual interrupted Windows process qualification is pending.

### Refreshing generated project guides

A global update does not regenerate project documents. After migration, an older
generated view can therefore still describe the local engine. Starting with
0.10.8, installation-scoped repair recovers the global binding from the receipt
for both Codex assets and generated commands:

```powershell
aidn bootstrap --target ..\example --repair --scope installation --persistence-policy verify-only --json
aidn bootstrap --target ..\example --repair --scope installation --persistence-policy verify-only --write --expect-plan PLAN_ID --json
```

Review the entire inventory, not only the document that prompted the repair.
This is an explicit repair of recorded installation assets, not a document-only
command. It uses the current durable adapter, refreshes managed views and records
the successful installation version. It may update installation metadata in
the private config and receipts; persistence references and adapter policy remain
preserved. `verify-only` prevents database adoption/import and refuses a required
data migration. Modified managed files conflict and need explicit reconciliation
with their saved preimages; never discard them as a group.

The default repair scope covers Codex integration only. Do not use
`project config --migrate-adapter` merely to refresh views: that operation extracts
policy from a legacy workflow and writes the adapter. Ordinary config edits do
not implicitly regenerate the views. Versions before 0.10.8 can render local
commands during installation-scoped repair of a global project; update first.

## CI and additional worktrees

In CI, use an explicitly verified release package in the job's temporary
directory as the source entry point. Set `AIDN_HOME` to an absolute job-local
directory, call `node tools/setup/global-cli.mjs update --package FILE --sha256
HASH --release VERSION --json`, then repeat with `--write --expect-plan` and the
returned ID. Add that home’s `bin` directory to the job PATH. Record the package
version and SHA-256 with the job evidence. This does not add an AIDN dependency to
the client manifest. The source entry point and tarball must originate from the
same verified release; do not fetch an unpinned bootstrap script.

A new worktree is a separate physical root. Run `aidn project add --target PATH`
and explicitly select its profile and persistence reference. Do not copy another
root's private receipt or authorization. Its preparation is bound to its own
physical root; linked worktrees share repository authorization and revocation.
Its engine is the same global engine. Register it only when prepared
successfully and explicitly remove abandoned worktrees from the registry before
a global update.

## Evidence boundary

The installer exposes skills under `CODEX_HOME/skills` (default
`~/.codex/skills`), the user location observed by the Windows app-server probe.
The [skills documentation](https://learn.chatgpt.com/docs/build-skills) also
describes `$HOME/.agents/skills`; the installer does not duplicate definitions
there. [Custom agents](https://learn.chatgpt.com/docs/agent-configuration/subagents)
use `CODEX_HOME/agents`. Documentation support alone is not native qualification.
Explicitly disabled managed skills block migration; setup never silently
re-enables them or overwrites the user's Codex configuration.

The global management fixtures exercise initial installation, two clients,
immutable previews, wizard cancellation, exact-plan application, npm failure and
resume. npm and reboot identities in those fixtures are injected. These checks
do not prove native Codex discovery, native hook trust, real server provisioning
or PostgreSQL data conservation. The [bounded Windows evidence](qualification/GLOBAL_WINDOWS.md)
records actual native results separately. Real PostgreSQL source tests and each
client migration still need their own evidence; release availability does not
complete a migration or native review on another root.
