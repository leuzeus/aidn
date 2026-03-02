# Installation Guide

## Template-only model

This workflow is installed by copying and merging template files into a client repository.
No compiled binaries are required.
The installer is a Node.js script and supports Node 18+ on Windows, Linux, and macOS.

## Spec vs Project Stub (Why both exist)

- Product spec source: `aidn-workflow/docs/SPEC.md`
  - Defines official workflow rules for the workflow product.
- Installed spec snapshot in client repos: `docs/audit/SPEC.md`
  - Managed snapshot used to keep core instructions in local runtime context.
- Project stub in client repos: `docs/audit/WORKFLOW.md`
  - Adapter file for local constraints and policies.

Client repositories receive template artifacts and a managed spec snapshot.

## Step 1 - Prerequisites

- Node.js 18 or newer
- npm 9+ recommended

## Step 2 - Install aidn as npm package (recommended)

Install from GitHub:

```bash
npm install --save-dev github:leuzeus/aidn#dev
```

Install from local path (offline/local dev):

```bash
npm install --save-dev ../aidn
```

After install, use the package CLI via `npx aidn ...`.

## Step 3 - Install core pack

From your client repository root:

```bash
npx aidn install --target . --pack core
```

Install using workflow defaults (all packs listed in `package/manifests/workflow.manifest.yaml`):

```bash
npx aidn install --target .
```

Windows example:

```powershell
npx aidn install --target C:\path\to\repo --pack core
```

Linux example:

```bash
npx aidn install --target ../repo --pack core
```

Dry run example:

```bash
npx aidn install --target . --pack core --dry-run
```

Artifact import store override example:

```bash
npx aidn install --target . --pack core --artifact-import-store dual-sqlite
```

Notes:
- The installer resolves `depends_on` recursively (for example `extended` installs `core` first).
- Compatibility is validated from product manifests (`node_min`, `os`) before file operations.
- If `codex_online: true`, installer requires the `codex` command to be installed and available in `PATH`.
- If `codex_online: true`, installer also requires Codex authentication (`codex login`).
- Compatibility policy and machine prereq result are printed in installer output (`Compatibility policy`, `Prereq check`).
- `.codex/skills.yaml` is rendered with the current workflow version tag (template `v{{VERSION}}`, rendered at install time using the `VERSION` file) and points to `https://github.com/leuzeus/aidn`.
- The installer also copies local skill sources under `.codex/skills/*` (one folder per skill) for local/offline availability.
- Placeholder policy:
  - installer resolves placeholders across copied templates (not only `{{VERSION}}`),
  - for files created for the first time, missing values are requested interactively,
  - when non-interactive, missing values are auto-filled with safe defaults (for example `TO_DEFINE`),
  - placeholders already present in project files are inferred and reused during updates/migrations.
- `AGENTS.md` non-interference policy:
  - if target `AGENTS.md` already exists, installer preserves it by default (no merge),
  - in `--assist`, preserving existing `AGENTS.md` is enforced by default,
  - use `--force-agents-merge` to explicitly update/insert the managed block,
  - use `--skip-agents` to always skip AGENTS merge.
- Customized project files policy:
  - the installer does not overwrite existing files that are expected to be customized in the client repo,
  - known placeholders (for example `{{VERSION}}`) are still replaced in preserved files when values are available,
  - when `codex` is available, installer attempts an AI-assisted migration for those files,
  - AI migration requires a logged-in Codex session (`codex login status` must be authenticated),
  - if migration is unavailable/fails, files remain unchanged,
  - disable AI migration with `--no-codex-migrate-custom`.
- Artifact import policy:
  - after install (non-verify mode), installer automatically imports `docs/audit/*` artifacts into `.aidn/runtime/index/*`,
  - import store precedence: `--artifact-import-store` > `AIDN_INDEX_STORE_MODE` > `AIDN_STATE_MODE` mapping,
  - `AIDN_STATE_MODE` mapping remains: `files -> file`, `dual -> dual-sqlite`, `db-only -> sqlite`,
  - disable automatic import with `--skip-artifact-import`,
  - installer auto-creates or updates `.aidn/config.json` (non-destructive merge) to persist runtime defaults.

Customizable files preserved by default:
- `.codex/skills.yaml`
- `.codex/skills/*`
- `docs/audit/WORKFLOW.md`
- `docs/audit/index.md`
- `docs/audit/glossary.md`
- `docs/audit/parking-lot.md`
- `docs/audit/baseline/current.md`
- `docs/audit/baseline/history.md`
- `docs/audit/snapshots/context-snapshot.md`

## Step 4 - Customize docs/audit/WORKFLOW.md (Project Stub)

Before customization, review in this order:
1. `docs/audit/SPEC.md`
2. `docs/audit/WORKFLOW_SUMMARY.md`
3. `docs/audit/WORKFLOW.md`

Why it matters:
- Prevents ambiguity around canonical rules vs local adapter policies.
- Forces explicit local branch/cycle and continuity policy.
- Regulates entropy before structural decisions drift.
- Preserves long-term coherence across cycles.

Minimum fields to fill before real work:
- `project_name`
- `source_branch`
- `Project Constraints`
- `Branch & Cycle Policy`
- `Snapshot Discipline`
- `DoR policy`

Short filled example:

```yaml
workflow_product: aidn-workflow
workflow_version: {{VERSION}}
installed_pack: core
project_name: my-product-repo
source_branch: main
```

Recommended practice:
- Treat this stub customization as part of baseline setup and commit it with other initial audit artifacts.

## Step 5 - Verify installation

```bash
npx aidn install --target . --pack core --verify
```

Verification checks required files declared in the pack manifest and returns a non-zero exit code on failure.
When dependencies are resolved, verification covers the union of required files across all installed packs.
Verification also checks expected imported index artifacts under `.aidn/runtime/index/*` using import-store precedence (`--artifact-import-store` > `AIDN_INDEX_STORE_MODE` > `AIDN_STATE_MODE`).
Use `--skip-artifact-import` with `--verify` to skip this import-artifact check.
The installer also prints a warning if the project stub still contains placeholders.

Default config file generated by install (`.aidn/config.json`) example:

```json
{
  "version": 1,
  "profile": "dual",
  "install": {
    "artifactImportStore": "dual-sqlite"
  },
  "runtime": {
    "stateMode": "dual"
  }
}
```

## Step 6 - Commit client repo files

- `AGENTS.md`
- `docs/audit/`
- `.codex/skills.yaml`

## Runtime perf tooling (important)

- `tools/perf/*` stays in the aidn product repository and is not copied into client repositories.
- Use the installed package CLI from the client repo:
  - `npx aidn perf checkpoint --target . --mode COMMITTING --index-store all --index-sync-check --json`
  - `npx aidn perf session-start --target . --mode COMMITTING --json`
  - `npx aidn perf session-close --target . --mode COMMITTING --json`
- Runtime artifacts are written under `<target>/.aidn/runtime/*` (not in `<target>/tools`).
- Optional runtime state mode:
  - `AIDN_STATE_MODE=files|dual|db-only`
  - default mapping: `files -> file`, `dual -> dual-sqlite`, `db-only -> sqlite`
  - explicit CLI `--index-store` still has priority.
  - in `dual`/`db-only`, index payload content embedding is enabled by default so files can be reconstructed from DB.
