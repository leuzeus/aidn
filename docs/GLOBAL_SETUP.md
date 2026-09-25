# Global AIDN setup candidate

The 0.10.0 implementation is being qualified. Do not use it to migrate a real
client until release validation is complete. ADR-0013 supersedes independent
project engine versions; existing 0.9.x receipts remain migration inputs.

## Entry points

From the source checkout or extracted package on Windows, preview installation:

```powershell
.\scripts\setup-global.ps1 -ReleaseVersion 0.10.0 -PackagePath C:\packages\aidn-workflow-0.10.0.tgz -PackageSha256 SHA256
```

Apply the displayed plan by repeating those arguments with `-Write -ExpectPlan
PLAN_ID`. Only that explicit installation registers `AIDN_HOME` and `bin` in the
user PATH. Open a new terminal. No administrator rights are used for AIDN.
Node.js and bundled npm are required. `-ReleaseVersion latest` resolves GitHub's
stable release and validates its assets; it does not guess a release on failure.

`aidn setup` and `aidn-setup` open the common wizard. Source launch remains
`node tools/setup/global-cli.mjs setup`. The wizard's PostgreSQL option uses an
existing environment reference, requests a missing secret after confirmation and
offers explicitly disclosed plaintext user-environment persistence. Native input
qualification and local server provisioning are still release blockers. The
0.9.x per-project PowerShell setup
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

Repeat a planned operation with `--write --expect-plan PLAN_ID` to apply it.
Omitting `--target` resolves the current Git repository, never a remembered
selection. Removing a registry entry does not uninstall or alter that project.
Updates inspect every registered project twice, including through the staged
candidate. An unavailable project, changed observation or required data migration
blocks the switch. Update and rollback do not rewrite project data or files.

## Migration and interrupted operations

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
root's private receipt or authorization. Its configuration and activation are
independent; its engine is the same global engine. Register it only when prepared
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
or PostgreSQL data conservation. Those release checks and the separate real
client migration remain required.
