# Remediation Plan - Real Usage `aidn`

Date: 2026-05-17

Backlog: `docs/BACKLOG_AIDN_USAGE_REMEDIATION_2026-05-17.md`

## Objective

Make first-use `aidn` reliable from a clean client repository, reduce local pilot context leakage in the published npm package, and align CLI gates with the workflow rules enforced by runtime admission.

## Audit Evidence

The simulated client path exposed these gaps:

- `npm pack --dry-run --json` included broad `docs/` and `tools/` content, including internal remediation and pilot-validation material.
- A clean non-interactive install could not create `.aidn/project/workflow.adapter.json` unless a caller supplied `--adapter-file` or had a TTY wizard available.
- Workspace identity treated a freshly initialized Git repository with no commits as `is_git_repo=false` because `HEAD` resolution failed.
- `aidn perf session-start --mode COMMITTING` used the generic workflow hook and could return checkpoint success without first applying start-session admission.
- Group help such as `aidn runtime --help` returned a non-zero exit through the global help path.

## Remediation Scope

### Packaging Hygiene

The published package should include consumer/runtime assets only:

- root `README.md`, `CHANGELOG.md`, `LICENSE`, `VERSION`
- CLI, source, scaffold, packs, manifests, and runtime tools
- public consumer docs: `INSTALL`, `UPGRADE`, `SPEC`, shared-runtime migration guidance, runtime scope matrix, testing, troubleshooting, and performance target JSON files

Internal rollout plans, backlogs, pilot evidence, and local validation paths remain tracked in the product repository but are not package payload.

### Non-Interactive Onboarding

Add a deterministic default adapter initialization path:

```bash
npx aidn project config --target . --init-defaults --project-name my-project --json
npx aidn install --target . --pack core --init-defaults --project-name my-project --verify
```

The default initializer is non-destructive: it creates `.aidn/project/workflow.adapter.json` only when missing.

### Workspace Identity

Git repository detection must use Git worktree membership before commit identity:

- `.git` plus `git rev-parse --is-inside-work-tree=true` means `is_git_repo=true`
- `head_commit` remains `unknown` until the first commit exists

### Admission-First Session Start

`aidn perf session-start` must route through `start-session-hook.mjs`, which runs start-session admission before workflow checkpoint work. Blocked admission returns a stop/block result and does not report successful checkpoint completion as the primary outcome.

The generic workflow hook remains available as `aidn perf hook --phase session-start`; the user-facing session-start command is admission-first.

### CLI Help

Group help must be script-friendly:

- `aidn runtime --help`
- `aidn perf --help`
- `aidn project --help`
- `aidn codex --help`

Each command exits `0` and prints concise group-specific subcommand help.

## Verification Plan

- `npm run perf:verify-pack-topology`
- `npm run perf:verify-install-import`
- `npm run perf:verify-install-idempotence`
- `npm run perf:verify-install-source-branch`
- `npm run perf:verify-workspace-resolution`
- `npm run perf:verify-start-session-admission`
- `npm run perf:verify-pre-write-admit`
- `npm run perf:verify-cli-aliases`

Manual smoke:

```bash
mkdir %TEMP%\aidn-clean-smoke
cd %TEMP%\aidn-clean-smoke
npx aidn install --target . --pack core --init-defaults --project-name clean-smoke --verify
npx aidn runtime db-status --target . --json
npx aidn runtime project-runtime-state --target . --json
npx aidn runtime pre-write-admit --target . --skill cycle-create --json
npx aidn perf session-start --target . --mode COMMITTING --json
```
