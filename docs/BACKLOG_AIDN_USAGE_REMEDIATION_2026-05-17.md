# Executable Backlog - Real Usage `aidn`

Date: 2026-05-17

Plan: `docs/PLAN_AIDN_USAGE_REMEDIATION_2026-05-17.md`

## AUR-1 P0 - Record Remediation Plan/Backlog

Status: done

Scope:

- Create the usage remediation plan.
- Create this executable backlog.
- Cross-link both documents.

Done when:

- both documents exist under `docs/`
- both documents reference each other

## AUR-2 P0 - Package Leak Guard

Status: done

Scope:

- Narrow package docs to consumer/runtime documentation.
- Keep internal rollout plans, local pilot evidence, and sensitive local validation paths out of the npm tarball.
- Add a tarball inspection guard covering `gowire`, `G:\projets\`, `pilot-main`, `pilot-linked`, and local validation path terms.

Done when:

- `npm pack --dry-run --json` package file paths and text payloads do not contain the guarded terms
- `npm run perf:verify-pack-topology` runs the leak guard

## AUR-3 P0 - Non-Interactive Init Path

Status: done

Scope:

- Add `aidn project config --init-defaults --project-name <name> --json`.
- Add `aidn install --init-defaults --project-name <name>`.
- Document the headless clean install flow in README and INSTALL.

Done when:

- a clean temp repo can run install with `--init-defaults --verify` without a TTY or `--adapter-file`
- the created adapter config preserves the requested project name
- a follow-up `aidn install --verify` succeeds

## AUR-4 P1 - Git Identity Correctness

Status: done

Scope:

- Detect empty Git repositories as Git worktrees even when `HEAD` is unresolved.
- Expose `head_commit=unknown` separately from `is_git_repo`.
- Add fixture coverage for a freshly initialized no-commit repository.

Done when:

- workspace resolution reports `is_git_repo=true`
- workspace resolution reports `head_commit=unknown`
- runtime surfaces that include `workspace` inherit those fields

## AUR-5 P1 - Session-Start Admission Alignment

Status: done

Scope:

- Route `aidn perf session-start` to the dedicated start-session admission hook.
- Keep blocked admission as the primary result when session/cycle/branch state is invalid.
- Add regression coverage comparing direct hook execution and CLI alias execution.

Done when:

- `aidn perf session-start` and `tools/perf/start-session-hook.mjs` return matching admission action/result
- blocked cases do not run the workflow checkpoint hook

## AUR-6 P2 - CLI Help Polish

Status: done

Scope:

- Add concise group-specific help for `runtime`, `perf`, `project`, and `codex`.
- Return exit code `0` for group help.
- Cover help status and content in CLI alias fixtures.

Done when:

- `aidn runtime --help`, `aidn perf --help`, `aidn project --help`, and `aidn codex --help` exit `0`
- help output contains group-specific usage and subcommand lists
