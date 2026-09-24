# ADR-0012 - Project activation and namespaced skills

## Status

Accepted

## Date

2026-09-23

## Context

Installing globally discoverable workflow skills can expose AIDN instructions in
an unrelated repository. A copied project configuration or an inherited shared
database setting must not activate a project or contact its workflow backend.
Repository authorization also needs to survive branch changes without allowing
one linked worktree to undo a repository-wide revocation during asset repair.

## Decision

AIDN checks project activation before workflow context, admission or backend
access. Activation combines repository authorization with a validated local
installation receipt, completed transaction and owned assets. File presence or
skill discovery alone is insufficient.

For Git repositories, authorization is canonical at
`<git-common-dir>/aidn/authorization.json`. Git worktrees share this authority;
each retains its own `.aidn/install/` receipt and assets. Non-Git installations
use `.aidn/install/authorization.json` in their resolved physical target.
Authorization records contain `schema_version`, `scope`, `authority_id`,
`revision`, `status` and an integrity checksum. A shared authority lock and
compare-and-swap preconditions serialize explicit transitions.

`bootstrap --authorize` and `bootstrap --revoke` preview by default. Applying
the reviewed transition requires `--write --expect-plan PLAN_ID` and the
`codex-integration` scope. These operations do not grant native Codex trust.
Revocation takes precedence over every worktree receipt. Repair, resume and
rollback never implicitly authorize a revoked project. Existing validated
receipts can be reported separately as `legacy-active`; damaged, foreign or
incomplete receipts do not qualify for this compatibility state.

The public names of the thirteen shipped skills use the `aidn-` prefix. The
single identity table in `src/core/skills/skill-policy.mjs` maps these names to
stable internal command identifiers. Each skill first requires active project
activation and admissible read-only admission. Historical CLI aliases remain
supported; duplicate unprefixed skill entrypoints are not installed.

Global skill migration is a separate explicit host operation. The pure planner
inventories only explicit skill roots, identifies exact known AIDN content, and
prepares exact `[[skills.config]]` path disable entries. The public bootstrap
`--migrate-global-skills` and `--restore-global-skills` actions require an
absolute `--codex-home`, preview by default, and apply only with
`--write --expect-plan`. They use the existing project installation journal and
receipt, with a host configuration lock and pre/post-image comparisons. There
is no separate host journal. Skill files, unrelated TOML and native trust remain
preserved. Unknown or modified skills cannot be selected for automatic disabling.
Recovery pre-images remain private; JSON diagnostics expose hashes and paths,
not their contents. Restoration requires an unchanged recorded post-image.

Bootstrap previews and writes use the same installation plan. An explicit
`--expect-plan` on nominal installation or upgrade rejects changed preparation.
Persistence policy `verify-only` validates existing backend compatibility and
never requests schema migration, adoption or import. The `adopt` policy retains
explicit installation effects; neither policy grants workflow activation by
reading configuration.

## Consequences and validation

2026-09-24: activation remains a prerequisite, not patch authorization. Each
covered native edit delegates operation/path admission to the existing runtime
use case. Revocation remains neutral natively and refuses AIDN workflow work;
degraded active installation remains distinguishable. This amendment neither
changes the authority record nor grants native client trust.

Project activation is a governed concept distinct from installation ownership,
workflow state and native client trust. Diagnostic output is limited to state,
active, scope, authority identity, revision and errors. A refused command keeps
its declared effect class and reports that no write was performed.

Deterministic fixtures cover inactive projects, receipt validation, linked
worktrees, revocation and recovery, scope-specific persistence, skill naming and
host planning. Qualification of this activation change is local to the Windows
VM. Unix execution is UNAVAILABLE until a new candidate-specific run supplies
that evidence; it does not block Windows fixture qualification. Native app and
IDE approval/session tests remain separate and unexecuted. Earlier Ubuntu
archive and fixture evidence for the 0.8.0 base commit is historical evidence,
not qualification of these new activation changes.
Rollback cannot restore a nonempty legacy installation whose old hooks lack the
activation boundary. It refuses with
`ROLLBACK_TO_LEGACY_ACTIVATION_REQUIRES_UNINSTALL`; use an explicitly reviewed
uninstall and a compatible installation instead. Rolling back an initial install
to the absence of a prior receipt remains supported. The host migration recovery
binding survives project rollback, including older installation history; only
explicit `--restore-global-skills` releases that binding after restoring the
unchanged host configuration post-image.
